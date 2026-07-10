import { and, eq, gt, gte, inArray, lte, sql } from 'drizzle-orm'
import { accounts, cardInvoicePayments, cardInvoices, categories } from '@previa/db'
import { createError } from '../middlewares/errorHandler.js'
import { syncCardInvoiceSemanticFields } from './cardInvoiceSemantics.js'

type DbLike = {
  select: (...args: any[]) => any
  insert: (...args: any[]) => any
  update: (...args: any[]) => any
}

type CategoryNode = {
  id: string
  name: string
  slug: string
  parentId: string | null
}

function normalizeMatchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

export async function loadCategoryHierarchyById(
  db: DbLike,
  categoryId: string | null | undefined,
): Promise<Map<string, CategoryNode>> {
  const result = new Map<string, CategoryNode>()
  if (!categoryId) return result

  let currentId: string | null = categoryId
  while (currentId && !result.has(currentId)) {
    const rows = (await db
      .select({
        id: categories.id,
        name: categories.name,
        slug: categories.slug,
        parentId: categories.parentId,
      })
      .from(categories)
      .where(eq(categories.id, currentId))
      .limit(1)) as CategoryNode[]

    const row = rows[0]
    if (!row) break

    result.set(row.id, {
      id: row.id,
      name: row.name,
      slug: row.slug,
      parentId: row.parentId ?? null,
    })

    currentId = row.parentId ?? null
  }

  return result
}

export function isCreditCardInvoiceCategory(
  categoryId: string | null | undefined,
  categoryById: Map<string, CategoryNode>,
): boolean {
  if (!categoryId) return false

  let current = categoryById.get(categoryId) ?? null
  let sawPayment = false
  let sawInvoice = false
  let sawCard = false

  while (current) {
    const text = normalizeMatchText(`${current.name} ${current.slug}`)
    if (/(pagament|pagos?)/.test(text)) sawPayment = true
    if (/fatura/.test(text)) sawInvoice = true
    if (/cartao|credito/.test(text)) sawCard = true

    current = current.parentId ? categoryById.get(current.parentId) ?? null : null
  }

  return sawPayment && sawInvoice && sawCard
}

const INSTITUTION_PATTERNS: Array<{ pattern: RegExp; key: string }> = [
  { pattern: /BANCO DO BRASIL|PAG\s*BB\b/i, key: 'Banco do Brasil' },
  { pattern: /ITAU\s+UNIBANCO|ITAU\b|ITAÚ/i, key: 'Itaú' },
  { pattern: /BRADESCO/i, key: 'Bradesco' },
  { pattern: /NUBANK|NU PAG/i, key: 'Nubank' },
  { pattern: /SANTANDER/i, key: 'Santander' },
  { pattern: /CAIXA|C\.E\.F/i, key: 'Caixa' },
  { pattern: /BTG/i, key: 'BTG' },
  { pattern: /\bINTER\b/i, key: 'Inter' },
  { pattern: /\bC6\b/i, key: 'C6' },
  { pattern: /PICPAY/i, key: 'PicPay' },
  { pattern: /SICOOB/i, key: 'Sicoob' },
  { pattern: /SICREDI/i, key: 'Sicredi' },
  { pattern: /XP INVESTIMENTOS|XP INC/i, key: 'XP' },
]

const CARD_PAYMENT_PATTERN =
  /PAG(AMENTO)?\s+(FATURA|CART[A\u00c3]O|FAT|RECEBID[OA])|PAGTO\s+(CART[A\u00c3]O(\s+CR[E\u00c9]DITO)?|RECEBID[OA])|FATURA\s+CART[A\u00c3]O|PAYMENT\s+CREDIT|PAG\s+CARTAO|PAGTO\s+CART\b/i

function detectInvoiceTargetInstitution(
  description: string,
  sourceInstitution: string | null,
): string | null {
  if (!CARD_PAYMENT_PATTERN.test(description)) return null
  for (const { pattern, key } of INSTITUTION_PATTERNS) {
    if (pattern.test(description)) return key
  }
  return sourceInstitution
}

export async function reconcileInvoicePayment(
  db: DbLike,
  userId: number,
  payment: {
    id: number
    amountMinor: bigint
    occurredAt: Date
    description: string
    forceInvoiceMatch?: boolean
    cardInvoiceId?: number | null
  },
  sourceInstitution: string | null,
): Promise<void> {
  const paymentAmount = payment.amountMinor < 0n ? -payment.amountMinor : payment.amountMinor
  if (paymentAmount === 0n) return

  const existing = await db
    .select({ id: cardInvoicePayments.id })
    .from(cardInvoicePayments)
    .where(eq(cardInvoicePayments.transactionId, payment.id))
    .limit(1)
  if (existing.length > 0) return

  const targetCardInvoiceId = payment.cardInvoiceId ?? null

  if (targetCardInvoiceId) {
    const [conflictingPayment] = await db
      .select({
        id: cardInvoicePayments.id,
        transactionId: cardInvoicePayments.transactionId,
      })
      .from(cardInvoicePayments)
      .where(
        and(
          eq(cardInvoicePayments.cardInvoiceId, targetCardInvoiceId),
          eq(cardInvoicePayments.userId, userId),
          sql`${cardInvoicePayments.transactionId} <> ${payment.id}`,
        ),
      )
      .limit(1)

    if (conflictingPayment) {
      throw createError('Esta fatura já está vinculada a outra transação bancária.', 409)
    }

    const [selectedInvoice] = await db
      .select({
        id: cardInvoices.id,
        totalAmountMinor: cardInvoices.totalAmountMinor,
        openAmountMinor: cardInvoices.openAmountMinor,
        paidAmountMinor: cardInvoices.paidAmountMinor,
        effectiveOpenAmountMinor: cardInvoices.effectiveOpenAmountMinor,
        paymentsAllocatedMinor: cardInvoices.paymentsAllocatedMinor,
      })
      .from(cardInvoices)
      .where(
        and(
          eq(cardInvoices.id, targetCardInvoiceId),
          eq(cardInvoices.userId, userId),
        ),
      )
      .limit(1)

    if (!selectedInvoice) return

    const invoiceTotalAmountMinor = BigInt(selectedInvoice.totalAmountMinor ?? 0n)
    const invoiceEffectiveOpenAmountMinor = BigInt(selectedInvoice.effectiveOpenAmountMinor ?? selectedInvoice.openAmountMinor ?? 0n)
    const invoicePaidAmountMinor = BigInt(selectedInvoice.paidAmountMinor ?? 0n)
    const invoicePaymentsAllocatedMinor = BigInt(selectedInvoice.paymentsAllocatedMinor ?? 0n)

    // Se a fatura já foi paga (effectiveOpenAmountMinor=0), usamos o totalAmountMinor
    // como referência para calcular o allocate — a associação manual deve sempre
    // registar o valor real do pagamento, mesmo que a fatura já esteja quitada.
    const invoiceBaseForAllocate = invoiceEffectiveOpenAmountMinor > 0n
      ? invoiceEffectiveOpenAmountMinor
      : invoiceTotalAmountMinor > 0n
        ? invoiceTotalAmountMinor
        : paymentAmount

    const allocate = paymentAmount < invoiceBaseForAllocate ? paymentAmount : invoiceBaseForAllocate

    await db.insert(cardInvoicePayments).values({
      userId,
      cardInvoiceId: selectedInvoice.id,
      transactionId: payment.id,
      allocatedAmountMinor: allocate,
      currencyCode: 'BRL',
      paymentDate: payment.occurredAt,
      source: 'statement_manual_match',
      matchedBy: 'user_selection',
      confidenceScore: '1.0000',
    }).onDuplicateKeyUpdate({ set: { allocatedAmountMinor: allocate } })

    // Actualiza paidAmountMinor/openAmountMinor apenas se a fatura ainda tinha saldo em aberto.
    // Se já estava paga, não revertemos o estado — o sync semântico recalcula tudo.
    if (invoiceEffectiveOpenAmountMinor > 0n) {
      const newPaid = invoicePaidAmountMinor + allocate
      const newOpen = invoiceEffectiveOpenAmountMinor - allocate
      await db.update(cardInvoices)
        .set({
          paidAmountMinor: newPaid,
          openAmountMinor: newOpen > 0n ? newOpen : 0n,
          status: newOpen <= 0n ? 'PAID' : 'OPEN',
        })
        .where(eq(cardInvoices.id, selectedInvoice.id))
    }

    // Recalcula sempre a semântica após qualquer mudança na pivô
    await syncCardInvoiceSemanticFields(db, selectedInvoice.id)
    return
  }

  const targetInstitution = payment.forceInvoiceMatch
    ? sourceInstitution
    : detectInvoiceTargetInstitution(payment.description, sourceInstitution)
  if (!targetInstitution) return

  const windowStart = new Date(payment.occurredAt.getTime() - 60 * 24 * 60 * 60 * 1000)
  const windowEnd = new Date(payment.occurredAt.getTime() + 5 * 24 * 60 * 60 * 1000)

  const isGenericPayment = targetInstitution === sourceInstitution

  const baseConditions = and(
    eq(cardInvoices.userId, userId),
    gt(cardInvoices.openAmountMinor, 0n),
    gte(cardInvoices.dueDate, windowStart),
    lte(cardInvoices.dueDate, windowEnd),
  )

  const openInvoices = await db
    .select({
      id: cardInvoices.id,
      dueDate: cardInvoices.dueDate,
      openAmountMinor: cardInvoices.openAmountMinor,
      paidAmountMinor: cardInvoices.paidAmountMinor,
    })
    .from(cardInvoices)
    .innerJoin(accounts, eq(accounts.id, cardInvoices.accountId))
    .where(
      isGenericPayment
        ? baseConditions
        : and(
            baseConditions,
            sql`LOWER(${accounts.institutionName}) LIKE LOWER(${`%${targetInstitution}%`})`,
          ),
    )
    .orderBy(cardInvoices.dueDate)

  if (openInvoices.length === 0) return

  const sortedInvoices = isGenericPayment
    ? [
        ...openInvoices.filter((inv: { openAmountMinor: bigint }) => BigInt(inv.openAmountMinor) === paymentAmount),
        ...openInvoices.filter((inv: { openAmountMinor: bigint }) => BigInt(inv.openAmountMinor) !== paymentAmount),
      ]
    : openInvoices

  let remaining = paymentAmount
  for (const invoice of sortedInvoices as Array<{ id: number; dueDate: Date; openAmountMinor: bigint; paidAmountMinor: bigint }>) {
    if (remaining <= 0n) break
    const invoiceOpenAmountMinor = BigInt(invoice.openAmountMinor)
    const invoicePaidAmountMinor = BigInt(invoice.paidAmountMinor)
    const allocate = remaining < invoiceOpenAmountMinor ? remaining : invoiceOpenAmountMinor

    await db.insert(cardInvoicePayments).values({
      userId,
      cardInvoiceId: invoice.id,
      transactionId: payment.id,
      allocatedAmountMinor: allocate,
      currencyCode: 'BRL',
      paymentDate: payment.occurredAt,
      source: isGenericPayment ? 'statement_reconciliation_generic' : 'statement_reconciliation_institution',
      matchedBy: invoiceOpenAmountMinor === paymentAmount ? 'exact_open_amount' : 'oldest_due_open_invoice',
      confidenceScore: invoiceOpenAmountMinor === paymentAmount ? '1.0000' : '0.7000',
    }).onDuplicateKeyUpdate({ set: { allocatedAmountMinor: allocate } })

    const newPaid = invoicePaidAmountMinor + allocate
    const newOpen = invoiceOpenAmountMinor - allocate
    await db.update(cardInvoices)
      .set({
        paidAmountMinor: newPaid,
        openAmountMinor: newOpen,
        status: newOpen === 0n ? 'PAID' : 'OPEN',
      })
      .where(eq(cardInvoices.id, invoice.id))

    await syncCardInvoiceSemanticFields(db, invoice.id)

    remaining -= allocate
  }
}

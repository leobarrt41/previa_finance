import { eq, sql } from 'drizzle-orm'
import { cardInvoicePayments, cardInvoices } from '@previa/db'

type CardInvoiceSemanticSnapshot = {
  reportedPreviousBalanceMinor: bigint
  reportedPaidAmountMinor: bigint
  carriedOpenAmountMinor: bigint
  paymentsAllocatedMinor: bigint
  effectiveOpenAmountMinor: bigint
}

type NullableBigIntLike = bigint | number | string | null | undefined

export type CardInvoiceSemanticView = {
  reportedPreviousInvoiceTotalMinor: bigint
  reportedPreviousInvoicePaidMinor: bigint
  carriedOpenMinor: bigint
  paymentsAllocatedMinor: bigint
  effectiveOpenMinor: bigint
  currentCyclePurchasesMinor: bigint
  totalInvoiceMinor: bigint
}

function maxBigInt(a: bigint, b: bigint): bigint {
  return a > b ? a : b
}

function toBigIntValue(value: NullableBigIntLike): bigint {
  if (value === null || value === undefined) return 0n
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return BigInt(Math.trunc(value))
  if (typeof value === 'string') {
    if (!value.trim()) return 0n
    return BigInt(value)
  }
  return 0n
}

export function buildCardInvoiceSemanticView(
  invoice: {
    totalAmountMinor?: NullableBigIntLike
    previousBalanceMinor?: NullableBigIntLike
    paidAmountMinor?: NullableBigIntLike
    openAmountMinor?: NullableBigIntLike
    reportedPreviousBalanceMinor?: NullableBigIntLike
    reportedPaidAmountMinor?: NullableBigIntLike
    carriedOpenAmountMinor?: NullableBigIntLike
    paymentsAllocatedMinor?: NullableBigIntLike
    effectiveOpenAmountMinor?: NullableBigIntLike
  },
  purchasesMinor: NullableBigIntLike = 0n,
): CardInvoiceSemanticView {
  const totalInvoiceMinor = toBigIntValue(invoice.totalAmountMinor)
  const reportedPreviousInvoiceTotalMinor = maxBigInt(
    toBigIntValue(invoice.reportedPreviousBalanceMinor) || toBigIntValue(invoice.previousBalanceMinor),
    0n,
  )
  const reportedPreviousInvoicePaidMinor = maxBigInt(
    toBigIntValue(invoice.reportedPaidAmountMinor) || toBigIntValue(invoice.paidAmountMinor),
    0n,
  )
  const carriedOpenMinor = maxBigInt(
    toBigIntValue(invoice.carriedOpenAmountMinor) || maxBigInt(reportedPreviousInvoiceTotalMinor - reportedPreviousInvoicePaidMinor, 0n),
    0n,
  )
  const paymentsAllocatedMinor = maxBigInt(
    toBigIntValue(invoice.paymentsAllocatedMinor),
    0n,
  )
  const effectiveOpenMinor = maxBigInt(
    toBigIntValue(invoice.effectiveOpenAmountMinor) || toBigIntValue(invoice.openAmountMinor),
    0n,
  )
  const currentCyclePurchasesMinor = maxBigInt(toBigIntValue(purchasesMinor), 0n)

  return {
    reportedPreviousInvoiceTotalMinor,
    reportedPreviousInvoicePaidMinor,
    carriedOpenMinor,
    paymentsAllocatedMinor,
    effectiveOpenMinor,
    currentCyclePurchasesMinor,
    totalInvoiceMinor,
  }
}

export async function syncCardInvoiceSemanticFields(
  db: any,
  cardInvoiceId: number,
): Promise<CardInvoiceSemanticSnapshot | null> {
  console.log('[cardInvoiceSemantics] sync start', { cardInvoiceId })
  const [invoice] = await db
    .select({
      id: cardInvoices.id,
      totalAmountMinor: cardInvoices.totalAmountMinor,
      previousBalanceMinor: cardInvoices.previousBalanceMinor,
      paidAmountMinor: cardInvoices.paidAmountMinor,
      openAmountMinor: cardInvoices.openAmountMinor,
      reportedPreviousBalanceMinor: cardInvoices.reportedPreviousBalanceMinor,
      reportedPaidAmountMinor: cardInvoices.reportedPaidAmountMinor,
      carriedOpenAmountMinor: cardInvoices.carriedOpenAmountMinor,
      effectiveOpenAmountMinor: cardInvoices.effectiveOpenAmountMinor,
      paymentsAllocatedMinor: cardInvoices.paymentsAllocatedMinor,
    })
    .from(cardInvoices)
    .where(eq(cardInvoices.id, cardInvoiceId))
    .limit(1)

  if (!invoice) {
    console.log('[cardInvoiceSemantics] invoice not found', { cardInvoiceId })
    return null
  }

  console.log('[cardInvoiceSemantics] invoice loaded', {
    cardInvoiceId,
    invoice: {
      id: invoice.id,
      totalAmountMinor: invoice.totalAmountMinor?.toString?.() ?? String(invoice.totalAmountMinor),
      previousBalanceMinor: invoice.previousBalanceMinor?.toString?.() ?? String(invoice.previousBalanceMinor),
      paidAmountMinor: invoice.paidAmountMinor?.toString?.() ?? String(invoice.paidAmountMinor),
      openAmountMinor: invoice.openAmountMinor?.toString?.() ?? String(invoice.openAmountMinor),
      reportedPreviousBalanceMinor: invoice.reportedPreviousBalanceMinor?.toString?.() ?? String(invoice.reportedPreviousBalanceMinor),
      reportedPaidAmountMinor: invoice.reportedPaidAmountMinor?.toString?.() ?? String(invoice.reportedPaidAmountMinor),
      carriedOpenAmountMinor: invoice.carriedOpenAmountMinor?.toString?.() ?? String(invoice.carriedOpenAmountMinor),
      effectiveOpenAmountMinor: invoice.effectiveOpenAmountMinor?.toString?.() ?? String(invoice.effectiveOpenAmountMinor),
      paymentsAllocatedMinor: invoice.paymentsAllocatedMinor?.toString?.() ?? String(invoice.paymentsAllocatedMinor),
    },
  })

  const [paymentAgg] = await db
    .select({
      allocatedMinor: sql<bigint>`COALESCE(SUM(${cardInvoicePayments.allocatedAmountMinor}), 0)`,
    })
    .from(cardInvoicePayments)
    .where(eq(cardInvoicePayments.cardInvoiceId, cardInvoiceId))

  console.log('[cardInvoiceSemantics] payment aggregation loaded', {
    cardInvoiceId,
    allocatedMinor: paymentAgg?.allocatedMinor?.toString?.() ?? String(paymentAgg?.allocatedMinor),
  })

  const totalAmountMinor = BigInt(invoice.totalAmountMinor ?? 0n)
  const previousBalanceMinor = BigInt(invoice.previousBalanceMinor ?? 0n)
  const paidAmountMinor = BigInt(invoice.paidAmountMinor ?? 0n)
  const openAmountMinor = BigInt(invoice.openAmountMinor ?? 0n)
  const paymentsAllocatedMinor = BigInt(paymentAgg?.allocatedMinor ?? 0n)

  const reportedPreviousBalanceMinor = previousBalanceMinor
  const reportedPaidAmountMinor = paidAmountMinor
  const carriedOpenAmountMinor = maxBigInt(previousBalanceMinor - paidAmountMinor, 0n)

  const paidDerivedOpen = maxBigInt(totalAmountMinor - paidAmountMinor, 0n)
  const effectiveOpenAmountMinor =
    paymentsAllocatedMinor > 0n
      ? maxBigInt(totalAmountMinor - paymentsAllocatedMinor, 0n)
      : paidAmountMinor > 0n && openAmountMinor === paidDerivedOpen
        ? totalAmountMinor
        : maxBigInt(openAmountMinor, 0n)

  console.log('[cardInvoiceSemantics] before update', {
    cardInvoiceId,
    reportedPreviousBalanceMinor: reportedPreviousBalanceMinor.toString(),
    reportedPaidAmountMinor: reportedPaidAmountMinor.toString(),
    carriedOpenAmountMinor: carriedOpenAmountMinor.toString(),
    paymentsAllocatedMinor: paymentsAllocatedMinor.toString(),
    effectiveOpenAmountMinor: effectiveOpenAmountMinor.toString(),
  })

  await db.execute(sql`
    update card_invoices
    set
      reported_previous_balance_minor = ${reportedPreviousBalanceMinor.toString()},
      reported_paid_amount_minor = ${reportedPaidAmountMinor.toString()},
      carried_open_amount_minor = ${carriedOpenAmountMinor.toString()},
      payments_allocated_minor = ${paymentsAllocatedMinor.toString()},
      effective_open_amount_minor = ${effectiveOpenAmountMinor.toString()},
      updated_at = CURRENT_TIMESTAMP
    where id = ${cardInvoiceId}
  `)

  console.log('[cardInvoiceSemantics] update completed', { cardInvoiceId })

  return {
    reportedPreviousBalanceMinor,
    reportedPaidAmountMinor,
    carriedOpenAmountMinor,
    paymentsAllocatedMinor,
    effectiveOpenAmountMinor,
  }
}

export async function syncCardInvoiceSemanticFieldsForUser(
  db: any,
  userId: number,
): Promise<number> {
  const invoices = await db
    .select({ id: cardInvoices.id })
    .from(cardInvoices)
    .where(eq(cardInvoices.userId, userId))

  for (const invoice of invoices) {
    await syncCardInvoiceSemanticFields(db, invoice.id)
  }

  return invoices.length
}

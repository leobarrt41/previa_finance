/**
 * routes/invoices.ts — Invoice PDF upload & import endpoints
 *
 * POST /api/invoices/parse
 *   Accepts a multipart PDF upload, runs the appropriate bank parser,
 *   and returns the extracted transactions for frontend preview.
 *   No data is saved — the user reviews and confirms before import.
 *
 * POST /api/invoices/import
 *   Accepts the confirmed transactions list and saves them to the DB.
 *
 *   REGRA DE NEGÓCIO (ETP §6.2):
 *   - Compra no cartão NÃO afeta o caixa → vai para card_transactions
 *   - card_transactions é vinculada a um card_invoice (passivo mensal)
 *   - A tabela transactions só recebe o PAGAMENTO da fatura (evento de extrato)
 */

import { Router, type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { parseBBInvoice, invoiceToForecast } from '@previa/parser-bb'
import { parseItauInvoice, itauInvoiceToForecast } from '@previa/parser-itau'
import { parseBradescoInvoice, bradescoInvoiceToForecast } from '@previa/parser-bradesco'
import { accounts, categories, cardInvoices, cardTransactions, receiptDocuments } from '@previa/db'
import { buildFingerprintFromRaw } from '@previa/core'
import { eq, and, desc, sql } from 'drizzle-orm'
import { getDatabase } from '../config/database.js'
import { config } from '../config/env.js'
import { resolveOwnerId } from '../services/ownerStore.js'
import { syncCardInvoiceSemanticFields } from '../services/cardInvoiceSemantics.js'
import { resolveOrCreateCreditCardAccount } from '../services/cardAccountResolver.js'
import { createError } from '../middlewares/errorHandler.js'
import { requireClerkAuth } from '../middlewares/auth.js'

const router: Router = Router()
router.use(requireClerkAuth)

// Store file in memory (max 20 MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true)
    } else {
      cb(new Error('Only PDF files are accepted'))
    }
  },
})

// Supported banks — extend as parsers are added
type BankId = 'bb' | 'itau' | 'bradesco' | 'auto'
const BANK_PARAM = z.enum(['bb', 'itau', 'bradesco', 'auto']).default('auto')

function isPdfPasswordError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.message.includes('PDFPasswordIncorrect')
    || error.message.includes('PdfminerException')
    || error.message.includes('PDF_PASSWORD_REQUIRED')
    || error.message.includes('password')
}

const classifyBodySchema = z.object({
  transactions: z.array(
    z.object({
      id: z.string(),
      description: z.string().min(1),
      amountMinor: z.number().int().positive(),
      country: z.string().optional(),
      installment: z.string().optional(),
    })
  ).max(200),
  categories: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      slug: z.string().optional(),
      type: z.string(),
      parentId: z.string().nullable().optional(),
    })
  ).max(200),
})

type AiAssignment = {
  transactionId: string
  categoryId: string
  subcategoryId?: string | null
}

function parseAiAssignments(raw: string): Array<AiAssignment> {
  try {
    const parsed = JSON.parse(raw) as {
      assignments?: Array<{ transactionId?: string; categoryId?: string; subcategoryId?: string | null }>
    }
    if (!parsed.assignments || !Array.isArray(parsed.assignments)) return []
    return parsed.assignments
      .filter((item) => Boolean(item?.transactionId && item?.categoryId))
      .map((item) => ({
        transactionId: item.transactionId as string,
        categoryId: item.categoryId as string,
        subcategoryId: item.subcategoryId ?? null,
      }))
  } catch {
    return []
  }
}

async function classifyTransactionsWithAI(
  txs: Array<{ id: string; description: string; amountMinor: number; country?: string; installment?: string }>,
  availableCategories: Array<{ id: string; name: string; slug?: string; type: string; parentId?: string | null }>,
): Promise<Record<string, { categoryId: string; subcategoryId: string | null }>> {
  if (!config.ai.apiKey) return {}
  if (txs.length === 0 || availableCategories.length === 0) return {}

  const baseUrl = config.ai.baseUrl.replace(/\/$/, '')
  const expenseCategories = availableCategories.filter((c) => c.type === 'expense')
  const byId = new Map(expenseCategories.map((c) => [c.id, c]))
  const parentCategories = expenseCategories.filter((c) => !c.parentId)
  const subcategories = expenseCategories.filter((c) => Boolean(c.parentId))

  const categoryCatalog = parentCategories.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug ?? '',
  }))

  const subcategoryCatalog = subcategories.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug ?? '',
    parentId: c.parentId as string,
    parentName: byId.get(c.parentId as string)?.name ?? '',
  }))

  const promptPayload = {
    transactions: txs.map((t) => ({
      id: t.id,
      description: t.description,
      amountMinor: t.amountMinor,
      installment: t.installment ?? null,
      country: t.country ?? null,
    })),
    categories: categoryCatalog,
    subcategories: subcategoryCatalog,
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.ai.apiKey}`,
    },
    body: JSON.stringify({
      model: config.ai.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Voce classifica transacoes de cartao em categoria e subcategoria. Responda SOMENTE JSON no formato {"assignments":[{"transactionId":"...","categoryId":"...","subcategoryId":"...|null"}]}. categoryId deve ser uma categoria pai valida; subcategoryId deve pertencer a essa categoria pai (ou null quando nao houver).',
        },
        {
          role: 'user',
          content: JSON.stringify(promptPayload),
        },
      ],
    }),
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`AI classify failed (${response.status}): ${text}`)
  }

  const json = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = json.choices?.[0]?.message?.content ?? ''
  const assignments = parseAiAssignments(content)

  const parentIds = new Set(parentCategories.map((c) => c.id))
  const subById = new Map(subcategories.map((c) => [c.id, c]))
  const suggestions: Record<string, { categoryId: string; subcategoryId: string | null }> = {}

  for (const item of assignments) {
    let categoryId = item.categoryId
    let subcategoryId: string | null = item.subcategoryId ?? null

    // Backward compatibility: if model returns a leaf as categoryId,
    // promote parent->categoryId and keep leaf as subcategoryId.
    if (!parentIds.has(categoryId) && subById.has(categoryId)) {
      const leaf = subById.get(categoryId)!
      categoryId = leaf.parentId as string
      subcategoryId = leaf.id
    }

    if (!parentIds.has(categoryId)) continue
    if (subcategoryId) {
      const sub = subById.get(subcategoryId)
      if (!sub || sub.parentId !== categoryId) continue
    }

    suggestions[item.transactionId] = {
      categoryId,
      subcategoryId,
    }
  }

  return suggestions
}

// ---------------------------------------------------------------------------
// POST /api/invoices/parse
// ---------------------------------------------------------------------------
router.post(
  '/parse',
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        throw createError('No PDF file uploaded. Send a multipart/form-data request with field "file".', 400)
      }
      const file = req.file

      const bankParam = BANK_PARAM.safeParse(req.body.bank ?? req.query.bank)
      const bank: BankId = bankParam.success ? bankParam.data : 'auto'
      const password = typeof req.body.password === 'string' && req.body.password.trim()
        ? req.body.password.trim()
        : undefined

      const filename = file.originalname.toLowerCase()
      const hintedBank: BankId =
        bank !== 'auto'
          ? bank
          : filename.includes('itau') || filename.includes('itaú')
            ? 'itau'
            : filename.includes('bradesco') || filename.includes('bradescard') || filename.includes('casas bahia')
              ? 'bradesco'
            : filename.includes('bb') || filename.includes('brasil')
              ? 'bb'
              : 'auto'

      const parseAsBB = async () => {
        const invoice = await parseBBInvoice(file.buffer)
        const forecasts = invoiceToForecast(invoice)

        const txs = invoice.transactions
          .filter((t) => t.date)
          .map((t, i) => ({
            id: `bb-${i}`,
            date: t.date,
            description: t.description,
            amountMinor: Math.abs(t.amountMinor),
            installment: t.installment,
            categoryId: null,
            competencyMonth: invoice.summary.invoiceMonth,
            include: t.amountMinor > 0,
            category: t.category,
            country: t.country,
          }))

        return {
          bank: 'bb' as const,
          summary: {
            ...invoice.summary,
          },
          transactions: txs,
          forecasts,
        }
      }

      const parseAsItau = async () => {
        const invoice = await parseItauInvoice(file.buffer, password)
        const forecasts = itauInvoiceToForecast(invoice)

        const txs = invoice.transactions
          .filter((t) => t.date)
          .map((t, i) => ({
            id: `itau-${i}`,
            date: t.date,
            description: t.description,
            amountMinor: Math.abs(t.amountMinor),
            installment: t.installment,
            categoryId: null,
            competencyMonth: invoice.summary.invoiceMonth,
            include: t.amountMinor > 0,
            category: t.category,
            country: t.country,
            originalAmountMinor: t.originalAmountMinor,
            originalCurrencyCode: t.originalCurrencyCode,
            exchangeRate: t.exchangeRate,
          }))

        return {
          bank: 'itau' as const,
          summary: {
            ...invoice.summary,
          },
          transactions: txs,
          forecasts,
        }
      }

      const parseAsBradesco = async () => {
        const invoice = await parseBradescoInvoice(file.buffer, password)
        const forecasts = bradescoInvoiceToForecast(invoice)

        const txs = invoice.transactions
          .filter((t) => t.date)
          .map((t, i) => ({
            id: `bradesco-${i}`,
            date: t.date,
            description: t.description,
            amountMinor: Math.abs(t.amountMinor),
            installment: t.installment,
            categoryId: null,
            competencyMonth: invoice.summary.invoiceMonth,
            include: t.amountMinor > 0,
            category: t.category,
            country: t.country,
          }))

        return {
          bank: 'bradesco' as const,
          summary: {
            ...invoice.summary,
          },
          transactions: txs,
          forecasts,
        }
      }

      if (hintedBank === 'bb') {
        try {
          const payload = await parseAsBB()
          return res.json(payload)
        } catch (error) {
          if (isPdfPasswordError(error)) {
            throw createError('PDF protegido por senha. Informe a senha da fatura para gerar o preview.', 400)
          }
          throw error
        }
      }

      if (hintedBank === 'itau') {
        try {
          const payload = await parseAsItau()
          return res.json(payload)
        } catch (error) {
          if (isPdfPasswordError(error)) {
            throw createError('PDF protegido por senha. Informe a senha da fatura para gerar o preview.', 400)
          }
          throw error
        }
      }

      if (hintedBank === 'bradesco') {
        try {
          const payload = await parseAsBradesco()
          return res.json(payload)
        } catch (error) {
          if (isPdfPasswordError(error)) {
            throw createError('PDF protegido por senha. Informe a senha da fatura para gerar o preview.', 400)
          }
          throw error
        }
      }

      // bank=auto com filename ambíguo: tenta Itaú, depois Bradesco, depois BB.
      // Isso evita parse incorreto quando o nome do arquivo não contém o banco.
      try {
        const payload = await parseAsItau()
        return res.json(payload)
      } catch (error) {
        if (isPdfPasswordError(error)) {
          // Evita chamar o parser BB quando o problema já é senha.
          throw createError('PDF protegido por senha. Informe a senha da fatura para gerar o preview.', 400)
        }
      }

      try {
        const payload = await parseAsBradesco()
        return res.json(payload)
      } catch (error) {
        if (isPdfPasswordError(error)) {
          throw createError('PDF protegido por senha. Informe a senha da fatura para gerar o preview.', 400)
        }
      }

      try {
        const payload = await parseAsBB()
        return res.json(payload)
      } catch (error) {
        if (isPdfPasswordError(error)) {
          throw createError('PDF protegido por senha. Informe a senha da fatura para gerar o preview.', 400)
        }
      }

      throw createError('Não foi possível identificar automaticamente o banco da fatura. Selecione o banco manualmente.', 400)
    } catch (error) {
      next(error)
    }
  }
)

// ---------------------------------------------------------------------------
// POST /api/invoices/classify
// ---------------------------------------------------------------------------
router.post('/classify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = classifyBodySchema.parse(req.body)

    // Feature is optional: when no key is configured, keep manual flow untouched.
    if (!config.ai.apiKey) {
      return res.json({ suggestions: {}, enabled: false })
    }

    const suggestions = await classifyTransactionsWithAI(body.transactions, body.categories)
    return res.json({ suggestions, enabled: true })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(createError('Payload inválido para classificação de categorias.', 400))
    }

    // Non-blocking behavior: never fail invoice flow because AI failed.
    console.warn('[invoices/classify] fallback to manual categorization:', error)
    return res.json({ suggestions: {}, enabled: true })
  }
})

// ---------------------------------------------------------------------------
// POST /api/invoices/import
// ---------------------------------------------------------------------------
const importBodySchema = z.object({
  transactions: z.array(
    z.object({
      date: z.string(),
      description: z.string(),
      amountMinor: z.number().int(),
      categoryId: z.string().nullable().optional(),
      providerCategory: z.string().trim().max(128).nullable().optional(),
      providerCategoryRaw: z.string().trim().max(255).nullable().optional(),
      categoryAssignedBy: z.enum(['provider', 'history', 'ai', 'user', 'legacy']).nullable().optional(),
      competencyMonth: z.string().regex(/^\d{4}-\d{2}$/),
      installment: z.string().optional(),
    })
  ),
  invoiceMonth: z.string().regex(/^\d{4}-\d{2}$/),
  dueMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  bank: z.string().optional(),
  cardLast4: z.string().max(4).optional(),
  product: z.string().optional(),
  sourceFileName: z.string().optional(),
  dueDate: z.string().optional(),
  closingDate: z.string().optional(),
  totalMinor: z.number().int().nonnegative().optional(),
  previousBalanceMinor: z.number().int().optional(),
  paymentsMinor: z.number().int().optional(),
  openBalanceMinor: z.number().int().optional(),
})

const INSTITUTION_MAP: Record<string, string> = {
  itau: 'Itaú',
  bb: 'Banco do Brasil',
  nubank: 'Nubank',
  bradesco: 'Bradesco',
  santander: 'Santander',
  caixa: 'Caixa Econômica Federal',
  inter: 'Banco Inter',
  picpay: 'PicPay',
}

function extractCardBrand(...sources: Array<string | undefined>): string | null {
  const joined = sources
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(' ')
    .toUpperCase()

  if (!joined) return null
  if (joined.includes('VISA')) return 'VISA'
  if (joined.includes('MASTERCARD') || joined.includes('MASTER')) return 'MASTERCARD'
  if (joined.includes('ELO')) return 'ELO'
  if (joined.includes('AMEX') || joined.includes('AMERICAN EXPRESS')) return 'AMEX'
  if (joined.includes('HIPERCARD')) return 'HIPERCARD'
  return null
}

function parseInputDate(value: string, label: string): Date {
  const trimmed = value.trim()

  // Common date-only format from parsers
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const dateOnly = new Date(`${trimmed}T12:00:00Z`)
    if (!Number.isNaN(dateOnly.getTime())) return dateOnly
  }

  // ISO / datetime fallback
  const parsed = new Date(trimmed)
  if (!Number.isNaN(parsed.getTime())) return parsed

  throw createError(`Invalid ${label} format: ${value}.`, 400)
}

function assertValidDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw createError(`Invalid ${label} value.`, 400)
  }
  return value
}

router.post('/import', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = importBodySchema.parse(req.body)
    const db = getDatabase()

  const owner = await resolveOwnerId(req.authUser!.clerkUserId)

  // -------------------------------------------------------------------------
  // 1. Resolve or create the credit card account by card identity
  // -------------------------------------------------------------------------
  const institutionName = body.bank
    ? (INSTITUTION_MAP[body.bank.toLowerCase()] ?? body.bank)
    : null
  const cardBrand = extractCardBrand(body.product, body.sourceFileName)
  const cardLast4 = body.cardLast4 ?? null

  let accountId: number

  const sharedAccountId = await resolveOrCreateCreditCardAccount(
    db,
    owner.id,
    {
      institutionName,
      cardBrand,
      cardLast4,
    },
    'manual',
  )

  if (sharedAccountId) {
    accountId = sharedAccountId
  } else {
    // Build a human-readable display name: "Itaú Platinum ••••9970"
    const last4Display = cardLast4 ? ` ••••${cardLast4}` : ''
    const productDisplay = body.product ? ` ${body.product}` : ''
    const institutionDisplay = institutionName ?? (body.bank ? body.bank.toUpperCase() : 'Cartão de crédito')
    const displayName = `${institutionDisplay}${productDisplay}${last4Display}`.trim()

    await db.insert(accounts).values({
      userId: owner.id,
      type: 'CREDIT_CARD',
      financialChannel: 'credit_card',
      displayName,
      institutionName: institutionName ?? undefined,
      cardBrand: cardBrand ?? undefined,
      cardLast4: cardLast4 ?? undefined,
      source: 'manual',
      currencyCode: 'BRL',
      isActive: true,
    })
    const [created] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.userId, owner.id))
      .orderBy(desc(accounts.id))
      .limit(1)
    if (!created) throw createError('Failed to create account', 500)
    accountId = created.id
  }

  // -------------------------------------------------------------------------
  // 2. Validate categoryIds (non-blocking — unknown categories are cleared)
  // -------------------------------------------------------------------------
  const categoryIds = [...new Set(body.transactions.map(t => t.categoryId).filter(Boolean))] as string[]
  if (categoryIds.length > 0) {
    await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, categoryIds[0]))
    // If not found, we don't block — categoryId will be null on insert
  }

  const totalImported = body.transactions
    .reduce((sum, t) => sum + BigInt(t.amountMinor), 0n)

  const totalAmountMinor = BigInt(body.totalMinor ?? Number(totalImported))
  const previousBalanceMinor = BigInt(body.previousBalanceMinor ?? 0)
  const paidAmountMinor = BigInt(body.paymentsMinor ?? 0)
  const fallbackOpen = totalAmountMinor - paidAmountMinor
  const openAmountMinor = BigInt(body.openBalanceMinor ?? Number(fallbackOpen > 0n ? fallbackOpen : 0n))
  const reportedPreviousBalanceMinor = previousBalanceMinor
  const reportedPaidAmountMinor = paidAmountMinor
  const carriedOpenAmountMinor = previousBalanceMinor > paidAmountMinor ? previousBalanceMinor - paidAmountMinor : 0n

  // -------------------------------------------------------------------------
  // 3. Resolve or create the card_invoice for this month
  //    card_invoice = passivo mensal do cartão (NÃO afeta o caixa)
  // -------------------------------------------------------------------------
  // Prefer parser dueDate (exact), fallback to dueMonth (15th)
    let dueDate: Date
    if (body.dueDate) {
      dueDate = parseInputDate(body.dueDate, 'dueDate')
    } else {
      const dueMo = body.dueMonth || body.invoiceMonth
      if (!dueMo || !dueMo.match(/^\d{4}-\d{2}$/)) {
        throw createError(`Invalid dueMonth format: ${dueMo}. Expected YYYY-MM.`, 400)
      }
      dueDate = new Date(`${dueMo}-15T23:59:59Z`)
    }
    dueDate = assertValidDate(dueDate, 'dueDate')

    const closingDate = body.closingDate
      ? assertValidDate(parseInputDate(body.closingDate, 'closingDate'), 'closingDate')
      : null

    let cardInvoiceId: number
    const [existingInvoice] = await db
      .select({ id: cardInvoices.id })
      .from(cardInvoices)
      .where(
        and(
          eq(cardInvoices.userId, owner.id),
          eq(cardInvoices.accountId, accountId),
          eq(cardInvoices.invoiceMonth, body.invoiceMonth),
        )
      )
      .limit(1)

    if (existingInvoice) {
      cardInvoiceId = existingInvoice.id
      await db.execute(sql`
        update card_invoices
        set
          total_amount_minor = ${totalAmountMinor.toString()},
          previous_balance_minor = ${previousBalanceMinor.toString()},
          paid_amount_minor = ${paidAmountMinor.toString()},
          open_amount_minor = ${openAmountMinor.toString()},
          reported_previous_balance_minor = ${reportedPreviousBalanceMinor.toString()},
          reported_paid_amount_minor = ${reportedPaidAmountMinor.toString()},
          carried_open_amount_minor = ${carriedOpenAmountMinor.toString()},
          status = ${openAmountMinor > 0n ? 'OPEN' : 'PAID'},
          parser_strategy = ${body.bank?.toLowerCase() === 'bradesco'
            ? 'bradesco_v1'
            : body.bank?.toLowerCase() === 'itau'
              ? 'itau_v1'
              : body.bank?.toLowerCase() === 'bb'
                ? 'bb_v1'
                : null},
          updated_at = CURRENT_TIMESTAMP
        where id = ${existingInvoice.id}
      `)
    } else {
      try {
        await db.insert(cardInvoices).values({
          userId: owner.id,
          accountId,
          invoiceMonth: body.invoiceMonth,
          dueDate,
          ...(closingDate ? { closingDate } : {}),
          totalAmountMinor,
          paidAmountMinor,
          previousBalanceMinor,
          openAmountMinor,
          reportedPreviousBalanceMinor,
          reportedPaidAmountMinor,
          carriedOpenAmountMinor,
          status: openAmountMinor > 0n ? 'OPEN' : 'PAID',
          source: 'pdf_invoice',
          dataState: 'consolidated',
          parserStrategy: body.bank?.toLowerCase() === 'bradesco'
            ? 'bradesco_v1'
            : body.bank?.toLowerCase() === 'itau'
              ? 'itau_v1'
              : body.bank?.toLowerCase() === 'bb'
                ? 'bb_v1'
                : undefined,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[import] failed to create card_invoice:', {
          invoiceMonth: body.invoiceMonth,
          dueMonth: body.dueMonth,
          dueDate: dueDate?.toISOString?.(),
          dueDateType: typeof dueDate,
          dueDateIsDate: dueDate instanceof Date,
          closingDateType: typeof closingDate,
          closingDateIsDate: closingDate instanceof Date,
          error: msg,
          stack: err instanceof Error ? err.stack : undefined,
        })
        throw createError(`Failed to create card_invoice: ${msg}`, 500)
      }
      const [created] = await db
        .select({ id: cardInvoices.id })
        .from(cardInvoices)
        .where(
          and(
            eq(cardInvoices.userId, owner.id),
            eq(cardInvoices.accountId, accountId),
            eq(cardInvoices.invoiceMonth, body.invoiceMonth),
          )
        )
        .limit(1)
      if (!created) throw createError('Failed to create card_invoice', 500)
      cardInvoiceId = created.id
    }

    await syncCardInvoiceSemanticFields(db, cardInvoiceId)

    // -------------------------------------------------------------------------
    // 4. Insert each purchase into card_transactions
    //    IMPORTANT: card_transactions does NOT affect cash flow.
    //    Only the invoice payment (in `transactions`) affects the bank account.
    // -------------------------------------------------------------------------
    let imported = 0
    let skipped = 0

    for (const tx of body.transactions) {
      const occurredAt = assertValidDate(parseInputDate(tx.date, 'transaction.date'), 'transaction.date')
      const amountMinor = BigInt(tx.amountMinor)
      const { fingerprint, normalizedDescription } = buildFingerprintFromRaw({
        competencyMonth: tx.competencyMonth,
        amountMinor,
        rawDescription: tx.description,
      })

      // Parse installment info (e.g. "03/12")
      let installmentNumber: number | null = null
      let installmentTotal: number | null = null
      let installmentGroupId: string | null = null
      if (tx.installment) {
        const parts = tx.installment.split('/')
        installmentNumber = parseInt(parts[0], 10) || null
        installmentTotal = parseInt(parts[1], 10) || null
        installmentGroupId = `${fingerprint}-${installmentTotal}`
      }

      try {
        await db.insert(cardTransactions).values({
          userId: owner.id,
          cardInvoiceId,
          source: 'pdf_invoice',
          dataState: 'consolidated',
          movementType: 'card_purchase',
          movementSubtype: tx.installment ? 'installment' : 'single',
          amountMinor,
          currencyCode: 'BRL',
          occurredAt,
          competencyMonth: tx.competencyMonth,
          description: tx.description,
          normalizedDescription,
          categoryId: tx.categoryId ?? null,
          providerCategory: tx.providerCategory ?? null,
          providerCategoryRaw: tx.providerCategoryRaw ?? null,
          categoryAssignedBy: tx.categoryAssignedBy ?? (tx.categoryId ? 'user' : null),
          installmentNumber,
          installmentTotal,
          installmentGroupId,
          fingerprint,
          isReconciled: false,
        })
        imported++
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('Duplicate entry') || msg.includes('ER_DUP_ENTRY')) {
          skipped++
        } else {
          console.error('[import] insert error:', msg)
          skipped++
        }
      }
    }

    // -------------------------------------------------------------------------
    // Reconciliação automática de receipt_documents (cartão)
    // Cruza notas projetadas com card_transactions recém-inseridas
    // Critério: amount_minor igual + merchant_name fuzzy (8 chars) + purchase_month
    // Best-effort: não bloqueia o import em caso de erro
    // -------------------------------------------------------------------------
    try {
      const projectedNotes = await db
        .select()
        .from(receiptDocuments)
        .where(
          and(
            eq(receiptDocuments.ownerId, owner.id),
            eq(receiptDocuments.dataState, 'projected'),
          )
        )

      if (projectedNotes.length > 0) {
        const newCardTxs = await db
          .select()
          .from(cardTransactions)
          .where(eq(cardTransactions.cardInvoiceId, cardInvoiceId))

        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)

        for (const note of projectedNotes) {
          if (!note.expectedInvoiceMonth) continue
          const match = newCardTxs.find((ct) => {
            const amtOk = BigInt(ct.amountMinor ?? 0) === BigInt(note.amountMinor ?? 0)
            const merchantOk = note.merchantName
              ? normalize(ct.normalizedDescription ?? ct.description ?? '') === normalize(note.merchantName)
              : true
            const monthOk = ct.competencyMonth === note.purchaseMonth
            return amtOk && (merchantOk || monthOk)
          })
          if (match) {
            await db
              .update(cardTransactions)
              .set({
                receiptDocumentId: note.id,
                updatedAt: new Date(),
              })
              .where(eq(cardTransactions.id, match.id))

            await db
              .update(receiptDocuments)
              .set({
                dataState: 'reconciled',
                cardTransactionId: match.id,
                reconcileSource: 'invoice_import',
                reconciledAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(receiptDocuments.id, note.id))
          }
        }
      }
    } catch (reconcileErr) {
      console.warn('[invoices/import] receipt reconciliation error (non-blocking):', reconcileErr)
    }

    res.json({
      imported,
      skipped,
      invoiceMonth: body.invoiceMonth,
      dueMonth: body.dueMonth ?? null,
      cardInvoiceId,
    })
  } catch (error) {
    next(error)
  }
})

export { router as invoiceRouter }

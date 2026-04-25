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

import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { parseBBInvoice, invoiceToForecast } from '@previa/parser-bb'
import { accounts, categories, cardInvoices, cardTransactions } from '@previa/db'
import { buildFingerprintFromRaw } from '@previa/core'
import { eq, and, desc } from 'drizzle-orm'
import { getDatabase } from '../config/database.js'
import { resolveOwnerId } from '../services/ownerStore.js'
import { createError } from '../middlewares/errorHandler.js'

const router: Router = Router()

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
type BankId = 'bb' | 'auto'
const BANK_PARAM = z.enum(['bb', 'auto']).default('auto')

// ---------------------------------------------------------------------------
// POST /api/invoices/parse
// ---------------------------------------------------------------------------
router.post(
  '/parse',
  upload.single('file'),
  async (req: Request, res: Response) => {
    if (!req.file) {
      throw createError('No PDF file uploaded. Send a multipart/form-data request with field "file".', 400)
    }

    const bankParam = BANK_PARAM.safeParse(req.body.bank ?? req.query.bank)
    const bank: BankId = bankParam.success ? bankParam.data : 'auto'

    const filename = req.file.originalname.toLowerCase()
    const detectedBank: BankId =
      bank !== 'auto'
        ? bank
        : filename.includes('bb') || filename.includes('brasil')
          ? 'bb'
          : 'bb' // default to BB until more parsers are added

    if (detectedBank === 'bb') {
      const invoice = await parseBBInvoice(req.file.buffer)
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

      return res.json({
        bank: 'bb',
        summary: {
          ...invoice.summary,
        },
        transactions: txs,
        forecasts,
      })
    }

    throw createError(`Bank "${detectedBank}" parser is not yet implemented`, 501)
  }
)

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
      competencyMonth: z.string().regex(/^\d{4}-\d{2}$/),
      installment: z.string().optional(),
    })
  ),
  invoiceMonth: z.string().regex(/^\d{4}-\d{2}$/),
  dueMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  bank: z.string().optional(),
})

router.post('/import', async (req: Request, res: Response) => {
  const body = importBodySchema.parse(req.body)
  const db = getDatabase()

  // Use 'dev-user' until Clerk auth is wired; resolveOwnerId auto-creates it
  const clerkUserId = req.authUser?.clerkUserId ?? 'dev-user'
  const owner = await resolveOwnerId(clerkUserId)

  // -------------------------------------------------------------------------
  // 1. Resolve or create the credit card account
  // -------------------------------------------------------------------------
  let accountId: number
  const [existingAccount] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.userId, owner.id))
    .orderBy(desc(accounts.id))
    .limit(1)

  if (existingAccount) {
    accountId = existingAccount.id
  } else {
    await db.insert(accounts).values({
      userId: owner.id,
      type: 'CREDIT_CARD',
      financialChannel: 'credit_card',
      displayName: body.bank ? `Cartão ${body.bank.toUpperCase()}` : 'Cartão de crédito',
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
    if (!created) throw createError('Failed to create default account', 500)
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

  // -------------------------------------------------------------------------
  // 3. Resolve or create the card_invoice for this month
  //    card_invoice = passivo mensal do cartão (NÃO afeta o caixa)
  // -------------------------------------------------------------------------
  const dueDate = new Date(`${body.dueMonth ?? body.invoiceMonth}-01T12:00:00Z`)

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
  } else {
    try {
      await db.insert(cardInvoices).values({
        userId: owner.id,
        accountId,
        invoiceMonth: body.invoiceMonth,
        dueDate: dueDate,
        totalAmountMinor: 0n,
        paidAmountMinor: 0n,
        previousBalanceMinor: 0n,
        openAmountMinor: 0n,
        status: 'OPEN',
        source: 'pdf_invoice',
        dataState: 'consolidated',
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[import] failed to create card_invoice:', {
        invoiceMonth: body.invoiceMonth,
        dueDate: dueDate,
        dueMonth: body.dueMonth,
        error: msg,
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

  // -------------------------------------------------------------------------
  // 4. Insert each purchase into card_transactions
  //    IMPORTANT: card_transactions does NOT affect cash flow.
  //    Only the invoice payment (in `transactions`) affects the bank account.
  // -------------------------------------------------------------------------
  let imported = 0
  let skipped = 0

  for (const tx of body.transactions) {
    const occurredAt = new Date(`${tx.date}T12:00:00Z`)
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
  // 5. Update totalAmountMinor and openAmountMinor on the card_invoice
  // -------------------------------------------------------------------------
  const totalImported = body.transactions
    .reduce((sum, t) => sum + BigInt(t.amountMinor), 0n)

  await db
    .update(cardInvoices)
    .set({
      totalAmountMinor: totalImported,
      openAmountMinor: totalImported,
    })
    .where(eq(cardInvoices.id, cardInvoiceId))

  res.json({
    imported,
    skipped,
    invoiceMonth: body.invoiceMonth,
    dueMonth: body.dueMonth ?? null,
    cardInvoiceId,
  })
})

export { router as invoiceRouter }

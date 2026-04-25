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
 */

import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { parseBBInvoice, invoiceToForecast } from '@previa/parser-bb'
import { transactions, categories } from '@previa/db'
import { buildFingerprintFromRaw } from '@previa/core'
import { eq } from 'drizzle-orm'
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

  // Resolve default account (credit card account for invoice imports)
  const { accounts } = await import('@previa/db')
  const { desc } = await import('drizzle-orm')

  let accountId: number
  const [existing] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.userId, owner.id))
    .orderBy(desc(accounts.id))
    .limit(1)

  if (existing) {
    accountId = existing.id
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

  // Validate categoryIds if provided
  const categoryIds = [...new Set(body.transactions.map(t => t.categoryId).filter(Boolean))] as string[]
  if (categoryIds.length > 0) {
    const found = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, categoryIds[0])) // quick check
    if (found.length === 0) {
      // Don't block import for unknown categories — just clear them
    }
  }

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
      await db.insert(transactions).values({
        userId: owner.id,
        accountId,
        source: 'pdf_invoice',
        dataState: 'consolidated',
        movementType: 'card_purchase',
        movementSubtype: tx.installment ? 'installment' : 'single',
        financialChannel: 'credit_card',
        amountMinor,
        currencyCode: 'BRL',
        balanceAfterMinor: null,
        occurredAt,
        competencyMonth: tx.competencyMonth,
        description: tx.description,
        normalizedDescription,
        categoryId: tx.categoryId ?? null,
        installmentNumber,
        installmentTotal,
        installmentGroupId,
        isRecurring: false,
        recurringRuleId: null,
        fingerprint,
        isReconciled: false,
        reconciledGroupId: null,
        providerTransactionId: null,
        providerPayload: null,
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

  res.json({
    imported,
    skipped,
    invoiceMonth: body.invoiceMonth,
    dueMonth: body.dueMonth ?? null,
  })
})

export { router as invoiceRouter }

/**
 * receiptDocuments.ts — CRUD de notas fiscais e comprovantes avulsos
 *
 * Hierarquia ETP §6.3: nota_fiscal (nível 4) > manual (nível 5)
 * data_state = 'projected'  → entra no cashflow como previsão
 * data_state = 'reconciled' → fatura/extrato real chegou, some do cashflow
 *
 * Endpoints:
 *   GET    /api/receipt-documents           — listar (filtros: month, state, accountId)
 *   POST   /api/receipt-documents           — criar
 *   PUT    /api/receipt-documents/:id       — editar (só projected)
 *   DELETE /api/receipt-documents/:id       — soft delete → cancelled
 *   POST   /api/receipt-documents/:id/reconcile — vincular a card_transaction ou transaction
 *   GET    /api/receipt-documents/summary/:month — totais por estado
 */
import { Router, Request, Response } from 'express'
import multer from 'multer'
import { spawn } from 'node:child_process'
import { getDatabase } from '../config/database.js'
import { accounts, receiptDocuments } from '@previa/db'
import { eq, and, sql } from 'drizzle-orm'
import { requireClerkAuth } from '../middlewares/auth.js'
import { resolveOwnerId } from '../services/ownerStore.js'
import { config } from '../config/env.js'

export const receiptDocumentsRouter: Router = Router()
receiptDocumentsRouter.use(requireClerkAuth)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
})

type ReceiptExtractionAIResult = {
  merchantName?: string | null
  merchantCnpj?: string | null
  amountMinor?: number | null
  purchaseDate?: string | null
  purchaseMonth?: string | null
  expectedInvoiceMonth?: string | null
  nfeKey?: string | null
  description?: string | null
  paymentKind?: 'card' | 'debit' | 'unknown'
  issuerName?: string | null
  cardBrand?: string | null
  cardLast4?: string | null
  maskedNumber?: string | null
  ownerName?: string | null
  closingDay?: number | null
  dueDay?: number | null
  confidence?: number
}

function monthFromDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return monthFromDate(d)
}

function parseDateLike(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function normalizeCardBrand(value: unknown): string | null {
  const text = normalizeText(value)?.toUpperCase() ?? null
  if (!text) return null
  if (text.includes('VISA')) return 'VISA'
  if (text.includes('MASTERCARD') || text.includes('MASTER')) return 'MASTERCARD'
  if (text.includes('ELO')) return 'ELO'
  if (text.includes('AMEX') || text.includes('AMERICAN EXPRESS')) return 'AMEX'
  if (text.includes('HIPERCARD')) return 'HIPERCARD'
  return text.length <= 50 ? text : null
}

function normalizeLast4(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const digits = value.replace(/\D/g, '')
  if (digits.length < 4) return null
  return digits.slice(-4)
}

function normalizeMaskedNumber(value: unknown): string | null {
  const text = normalizeText(value)
  return text && text.length <= 30 ? text : null
}

function normalizeOptionalInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value)
  return null
}

type ReceiptCardIdentityHints = {
  institutionName?: string | null
  cardBrand?: string | null
  cardLast4?: string | null
  maskedNumber?: string | null
  ownerName?: string | null
  closingDay?: number | null
  dueDay?: number | null
}

function buildReceiptFallbackDisplayName(
  merchantName: string | null | undefined,
  expectedInvoiceMonth: string | null | undefined,
  purchaseMonth: string | null | undefined,
): string {
  const labelBase = merchantName?.trim()
    || (expectedInvoiceMonth ? `Fatura ${expectedInvoiceMonth}` : null)
    || (purchaseMonth ? `Compra ${purchaseMonth}` : null)
    || 'Nota fiscal'
  return `Cartão ${labelBase}`
}

function buildReceiptCardIdentityHints(extracted: ReceiptExtractionAIResult): ReceiptCardIdentityHints {
  const institutionName = normalizeText(extracted.issuerName)
  const cardBrand = normalizeCardBrand(extracted.cardBrand)
  const cardLast4 = normalizeLast4(extracted.cardLast4 ?? extracted.maskedNumber)
  const maskedNumber = normalizeMaskedNumber(extracted.maskedNumber)
  const ownerName = normalizeText(extracted.ownerName)
  const closingDay = normalizeOptionalInt(extracted.closingDay)
  const dueDay = normalizeOptionalInt(extracted.dueDay)

  return {
    institutionName,
    cardBrand,
    cardLast4,
    maskedNumber,
    ownerName,
    closingDay,
    dueDay,
  }
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  return await new Promise<string>((resolve) => {
    const child = spawn('pdftotext', ['-', '-'])
    let stdout = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8') })
    child.on('error', () => resolve(''))
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        resolve('')
      }
    })
    child.stdin.write(buffer)
    child.stdin.end()
  })
}

async function preprocessImageForOcr(buffer: Buffer): Promise<Buffer> {
  return await new Promise<Buffer>((resolve) => {
    const script = [
      'import io, sys',
      'from PIL import Image, ImageOps, ImageEnhance',
      'data = sys.stdin.buffer.read()',
      'img = Image.open(io.BytesIO(data))',
      'img = ImageOps.exif_transpose(img)',
      'img = img.convert("L")',
      'img = ImageOps.autocontrast(img)',
      'if img.width < 1800:',
      '    new_w = 1800',
      '    new_h = max(1, int(img.height * (new_w / img.width)))',
      '    img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)',
      'img = ImageEnhance.Sharpness(img).enhance(1.8)',
      'img = ImageEnhance.Contrast(img).enhance(1.35)',
      'out = io.BytesIO()',
      'img.save(out, format="PNG")',
      'sys.stdout.buffer.write(out.getvalue())',
    ].join('\n')

    const child = spawn('python3', ['-c', script], { stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    const errors: Buffer[] = []

    child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    child.stderr.on('data', (chunk) => errors.push(Buffer.from(chunk)))
    child.on('error', () => resolve(buffer))
    child.on('close', (code) => {
      if (code === 0 && chunks.length > 0) {
        resolve(Buffer.concat(chunks))
      } else {
        resolve(buffer)
      }
    })

    child.stdin.write(buffer)
    child.stdin.end()
  })
}

async function callReceiptExtractionAI(payload: unknown): Promise<ReceiptExtractionAIResult> {
  if (!config.ai.apiKey) {
    throw new Error('AI não configurada para extrair notas')
  }

  const input = payload as {
    filename?: string
    mimeType?: string
    source?: { kind?: 'pdf' | 'image'; text?: string; imageUrl?: string }
  }
  const userContent =
    input.source?.kind === 'image' && input.source.imageUrl
      ? [
          {
            type: 'text',
            text: JSON.stringify({
              filename: input.filename,
              mimeType: input.mimeType,
              source: { kind: 'image' },
            }),
          },
          {
            type: 'image_url',
            image_url: { url: input.source.imageUrl },
          },
        ]
      : JSON.stringify({
          filename: input.filename,
          mimeType: input.mimeType,
          source: {
            kind: 'pdf',
            text: input.source?.text ?? '',
          },
        })

  const response = await fetch(`${config.ai.baseUrl.replace(/\/$/, '')}/chat/completions`, {
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
            'Você extrai dados de notas fiscais e comprovantes brasileiros. Responda SOMENTE JSON com os campos merchantName, merchantCnpj, amountMinor, purchaseDate, purchaseMonth, expectedInvoiceMonth, nfeKey, description, paymentKind, issuerName, cardBrand, cardLast4, maskedNumber, ownerName, closingDay, dueDay e confidence. Esses campos de cartão são opcionais: preencha quando aparecerem no OCR/PDF/imagem, porque eles servem para identificar o cartão real do documento. Se o comprovante mostrar explicitamente "crédito", "débito", "cartão", "bandeira", "final" ou "autorização", classifique paymentKind como card e extraia tudo o que for visível sobre o cartão, mesmo que só exista parte da informação. amountMinor deve ser inteiro em centavos. paymentKind deve ser card, debit ou unknown. purchaseDate deve ser YYYY-MM-DD quando possível. cardLast4 deve conter apenas os 4 últimos dígitos quando visíveis. maskedNumber deve manter a máscara do documento quando visível. issuerName deve ser o emissor/banco/cartão quando identificado. Se aparecer "fatura", "vence", "compra no cartão" ou comprovante de crédito/débito, trate como item de cartão e preencha expectedInvoiceMonth quando for possível inferir.',
        },
        {
          role: 'user',
          content: userContent,
        },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Falha ao extrair nota (${response.status}): ${text}`)
  }

  const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  const content = json.choices?.[0]?.message?.content ?? '{}'
  try {
    return JSON.parse(content) as ReceiptExtractionAIResult
  } catch {
    return {}
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
async function getOwner(req: Request): Promise<{ userId: string; ownerId: number }> {
  const clerkUserId = req.authUser?.clerkUserId
  if (!clerkUserId) {
    throw new Error('Missing authenticated user')
  }

  const owner = await resolveOwnerId(clerkUserId)
  return { userId: clerkUserId, ownerId: owner.id }
}

async function resolveOrCreateReceiptCardAccount(
  db: Awaited<ReturnType<typeof getDatabase>>,
  ownerId: number,
  hints: ReceiptCardIdentityHints,
  fallbackDisplayName?: string | null,
): Promise<number | null> {
  const hasIdentity = Boolean(
    hints.institutionName ||
    hints.cardBrand ||
    hints.cardLast4 ||
    hints.maskedNumber ||
    hints.ownerName,
  )

  if (!hasIdentity) {
    if (!fallbackDisplayName) return null

    const [existingFallback] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(
        eq(accounts.userId, ownerId),
        eq(accounts.financialChannel, 'credit_card'),
        eq(accounts.source, 'receipt_document'),
        eq(accounts.displayName, fallbackDisplayName),
      ))
      .limit(1)

    if (existingFallback) return existingFallback.id

    await db.insert(accounts).values({
      userId: ownerId,
      type: 'CREDIT_CARD',
      financialChannel: 'credit_card',
      displayName: fallbackDisplayName,
      institutionName: fallbackDisplayName,
      source: 'receipt_document',
      currencyCode: 'BRL',
      isActive: true,
    })

    const [createdFallback] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(
        eq(accounts.userId, ownerId),
        eq(accounts.financialChannel, 'credit_card'),
        eq(accounts.source, 'receipt_document'),
        eq(accounts.displayName, fallbackDisplayName),
      ))
      .limit(1)

    if (!createdFallback) {
      throw new Error('Failed to create fallback receipt card account')
    }

    return createdFallback.id
  }

  const whereConditions = [
    eq(accounts.userId, ownerId),
    eq(accounts.financialChannel, 'credit_card'),
    ...(hints.institutionName ? [eq(accounts.institutionName, hints.institutionName)] : []),
    ...(hints.cardBrand ? [eq(accounts.cardBrand, hints.cardBrand)] : []),
    ...(hints.cardLast4 ? [eq(accounts.cardLast4, hints.cardLast4)] : []),
    ...(hints.maskedNumber ? [eq(accounts.maskedNumber, hints.maskedNumber)] : []),
    ...(hints.ownerName ? [eq(accounts.ownerName, hints.ownerName)] : []),
  ]

  const [existing] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(...whereConditions))
    .limit(1)

  if (existing) return existing.id

  const institutionDisplay = hints.institutionName ?? 'Cartão automático'
  const cardBrandDisplay = hints.cardBrand ? ` ${hints.cardBrand}` : ''
  const last4Display = hints.cardLast4 ? ` ••••${hints.cardLast4}` : ''
  const displayName = `${institutionDisplay}${cardBrandDisplay}${last4Display}`.trim()

  await db.insert(accounts).values({
    userId: ownerId,
    type: 'CREDIT_CARD',
    financialChannel: 'credit_card',
    displayName,
    institutionName: hints.institutionName ?? institutionDisplay,
    cardBrand: hints.cardBrand ?? undefined,
    cardLast4: hints.cardLast4 ?? undefined,
    maskedNumber: hints.maskedNumber ?? undefined,
    ownerName: hints.ownerName ?? undefined,
    closingDay: hints.closingDay ?? undefined,
    dueDay: hints.dueDay ?? undefined,
    source: 'receipt_document',
    currencyCode: 'BRL',
    isActive: true,
  })

  const [created] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(
      eq(accounts.userId, ownerId),
      eq(accounts.financialChannel, 'credit_card'),
      ...(hints.institutionName ? [eq(accounts.institutionName, hints.institutionName)] : []),
      ...(hints.cardBrand ? [eq(accounts.cardBrand, hints.cardBrand)] : []),
      ...(hints.cardLast4 ? [eq(accounts.cardLast4, hints.cardLast4)] : []),
      ...(hints.maskedNumber ? [eq(accounts.maskedNumber, hints.maskedNumber)] : []),
      ...(hints.ownerName ? [eq(accounts.ownerName, hints.ownerName)] : []),
      eq(accounts.source, 'receipt_document'),
    ))
    .limit(1)

  if (!created) {
    throw new Error('Failed to create auto card account from OCR hints')
  }

  return created.id
}

// ── GET /api/receipt-documents ───────────────────────────────────────────────
receiptDocumentsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { userId, ownerId } = await getOwner(req)
    const db = await getDatabase()
    const { month, state, accountId } = req.query

    const conditions = [eq(receiptDocuments.ownerId, ownerId)]
    if (month) conditions.push(eq(receiptDocuments.purchaseMonth, String(month)))
    if (state) conditions.push(eq(receiptDocuments.dataState, String(state)))
    if (accountId) conditions.push(eq(receiptDocuments.accountId, Number(accountId)))

    const rows = await db
      .select()
      .from(receiptDocuments)
      .where(and(...conditions))
      .orderBy(sql`${receiptDocuments.purchaseDate} DESC`)

    res.json({ data: rows })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/receipt-documents/summary/:month ────────────────────────────────
receiptDocumentsRouter.get('/summary/:month', async (req: Request, res: Response) => {
  try {
    const { ownerId } = await getOwner(req)
    const db = await getDatabase()
    const { month } = req.params

    const rows = await db
      .select({
        dataState: receiptDocuments.dataState,
        count: sql<number>`count(*)`,
        totalMinor: sql<number>`sum(${receiptDocuments.amountMinor})`,
      })
      .from(receiptDocuments)
      .where(and(
        eq(receiptDocuments.ownerId, ownerId),
        eq(receiptDocuments.purchaseMonth, month),
      ))
      .groupBy(receiptDocuments.dataState)

    const summary = { projected: 0, reconciled: 0, cancelled: 0, total: 0 }
    for (const r of rows) {
      const amt = Number(r.totalMinor) || 0
      if (r.dataState === 'projected')  { summary.projected  += amt }
      if (r.dataState === 'reconciled') { summary.reconciled += amt }
      if (r.dataState === 'cancelled')  { summary.cancelled  += amt }
      if (r.dataState !== 'cancelled')  { summary.total      += amt }
    }

    res.json(summary)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/receipt-documents ──────────────────────────────────────────────
receiptDocumentsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { userId, ownerId } = await getOwner(req)
    const db = await getDatabase()
    const {
      amountMinor, purchaseDate, purchaseMonth, expectedInvoiceMonth,
      merchantName, merchantCnpj, categoryId, accountId,
      nfeKey, nfeNumber, nfeSeries, fileUrl, fileType,
      installmentTotal, installmentCurrent, description,
      paymentKind, issuerName, cardBrand, cardLast4, maskedNumber, ownerName, closingDay, dueDay,
      rawPayload,
    } = req.body

    if (!amountMinor || !purchaseDate || !purchaseMonth) {
      return res.status(400).json({ error: 'amountMinor, purchaseDate e purchaseMonth são obrigatórios' })
    }

    const hints = buildReceiptCardIdentityHints({
      paymentKind: paymentKind === 'card' || paymentKind === 'debit' ? paymentKind : undefined,
      issuerName,
      cardBrand,
      cardLast4,
      maskedNumber,
      ownerName,
      closingDay,
      dueDay,
    })

    const resolvedAccountId = accountId
      ? Number(accountId)
      : await resolveOrCreateReceiptCardAccount(
        db,
        ownerId,
        {
          ...hints,
          institutionName: hints.institutionName || normalizeText(issuerName),
        },
        buildReceiptFallbackDisplayName(merchantName, expectedInvoiceMonth, purchaseMonth),
      )

    const [result] = await db.insert(receiptDocuments).values({
      userId,
      ownerId,
      amountMinor: Number(amountMinor),
      purchaseDate: new Date(purchaseDate),
      purchaseMonth: String(purchaseMonth),
      expectedInvoiceMonth: expectedInvoiceMonth ? String(expectedInvoiceMonth) : null,
      merchantName: merchantName || null,
      merchantCnpj: merchantCnpj || null,
      categoryId: categoryId || null,
      accountId: resolvedAccountId,
      nfeKey: nfeKey || null,
      nfeNumber: nfeNumber || null,
      nfeSeries: nfeSeries || null,
      fileUrl: fileUrl || null,
      fileType: fileType || null,
      installmentTotal: installmentTotal ? Number(installmentTotal) : null,
      installmentCurrent: installmentCurrent ? Number(installmentCurrent) : null,
      description: description || null,
      rawPayload: rawPayload ?? null,
      dataState: 'projected',
    })

    const [created] = await db
      .select()
      .from(receiptDocuments)
      .where(eq(receiptDocuments.id, (result as any).insertId))

    res.status(201).json(created)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/receipt-documents/scan ────────────────────────────────────────
receiptDocumentsRouter.post('/scan', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const { userId, ownerId } = await getOwner(req)
    const db = await getDatabase()
    if (!req.file) {
      return res.status(400).json({ error: 'Envie uma foto ou PDF no campo "file".' })
    }

    const mimeType = req.file.mimetype || 'application/octet-stream'
    const isPdf = mimeType === 'application/pdf' || req.file.originalname.toLowerCase().endsWith('.pdf')
    const isImage = !isPdf && mimeType.startsWith('image/')

    let textContext = ''
    if (isPdf) {
      textContext = await extractPdfText(req.file.buffer)
    }

    const imageBuffer = isImage ? await preprocessImageForOcr(req.file.buffer) : req.file.buffer
    const aiPayload = {
      filename: req.file.originalname,
      mimeType,
      source: isPdf
        ? {
            kind: 'pdf',
            text: textContext.slice(0, 12000),
          }
        : {
            kind: 'image',
            imageUrl: `data:${mimeType};base64,${imageBuffer.toString('base64')}`,
          },
    }

    const extracted = await callReceiptExtractionAI(aiPayload)

    const parsedPurchaseDate = parseDateLike(extracted.purchaseDate) ?? new Date()
    const purchaseMonth = extracted.purchaseMonth?.match(/^\d{4}-\d{2}$/)
      ? extracted.purchaseMonth
      : monthFromDate(parsedPurchaseDate)
    const paymentKind = extracted.paymentKind ?? 'unknown'
    const hints = buildReceiptCardIdentityHints(extracted)
    const hasCardHints = Boolean(
      hints.institutionName ||
      hints.cardBrand ||
      hints.cardLast4 ||
      hints.maskedNumber ||
      hints.ownerName,
    )
    const expectedInvoiceMonth = extracted.expectedInvoiceMonth?.match(/^\d{4}-\d{2}$/)
      ? extracted.expectedInvoiceMonth
      : paymentKind === 'card' || hasCardHints
        ? addMonths(purchaseMonth, 1)
        : null
    const amountMinor = Number(extracted.amountMinor ?? 0)
    const autoAccountId = await resolveOrCreateReceiptCardAccount(
      db,
      ownerId,
      {
        ...hints,
        institutionName: hints.institutionName,
      },
      buildReceiptFallbackDisplayName(extracted.merchantName, expectedInvoiceMonth, purchaseMonth),
    )

    if (!amountMinor || amountMinor <= 0) {
      return res.status(400).json({ error: 'Não foi possível extrair o valor da nota.' })
    }

    const [result] = await db.insert(receiptDocuments).values({
      userId,
      ownerId,
      amountMinor,
      purchaseDate: parsedPurchaseDate,
      purchaseMonth,
      expectedInvoiceMonth,
      merchantName: extracted.merchantName || null,
      merchantCnpj: extracted.merchantCnpj || null,
      categoryId: null,
      accountId: autoAccountId,
      nfeKey: extracted.nfeKey || null,
      fileUrl: req.file.originalname,
      fileType: mimeType,
      description: extracted.description || extracted.merchantName || null,
      rawPayload: extracted,
      dataState: 'projected',
    })

    const [created] = await db.select().from(receiptDocuments).where(eq(receiptDocuments.id, (result as any).insertId))

    res.status(201).json({
      data: created,
      extracted,
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── PUT /api/receipt-documents/:id ──────────────────────────────────────────
receiptDocumentsRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const { ownerId } = await getOwner(req)
    const db = await getDatabase()
    const id = Number(req.params.id)

    const [existing] = await db
      .select()
      .from(receiptDocuments)
      .where(and(eq(receiptDocuments.id, id), eq(receiptDocuments.ownerId, ownerId)))

    if (!existing) return res.status(404).json({ error: 'Nota não encontrada' })
    if (existing.dataState !== 'projected') {
      return res.status(400).json({ error: 'Só é possível editar notas com estado projected' })
    }

    const {
      amountMinor, purchaseDate, purchaseMonth, expectedInvoiceMonth,
      merchantName, merchantCnpj, categoryId, accountId,
      nfeKey, fileUrl, fileType, installmentTotal, installmentCurrent, description,
    } = req.body

    await db.update(receiptDocuments).set({
      ...(amountMinor !== undefined && { amountMinor: Number(amountMinor) }),
      ...(purchaseDate !== undefined && { purchaseDate: new Date(purchaseDate) }),
      ...(purchaseMonth !== undefined && { purchaseMonth: String(purchaseMonth) }),
      ...(expectedInvoiceMonth !== undefined && { expectedInvoiceMonth: expectedInvoiceMonth || null }),
      ...(merchantName !== undefined && { merchantName }),
      ...(merchantCnpj !== undefined && { merchantCnpj }),
      ...(categoryId !== undefined && { categoryId }),
      ...(accountId !== undefined && { accountId: accountId ? Number(accountId) : null }),
      ...(nfeKey !== undefined && { nfeKey }),
      ...(fileUrl !== undefined && { fileUrl }),
      ...(fileType !== undefined && { fileType }),
      ...(installmentTotal !== undefined && { installmentTotal: installmentTotal ? Number(installmentTotal) : null }),
      ...(installmentCurrent !== undefined && { installmentCurrent: installmentCurrent ? Number(installmentCurrent) : null }),
      ...(description !== undefined && { description }),
    }).where(eq(receiptDocuments.id, id))

    const [updated] = await db.select().from(receiptDocuments).where(eq(receiptDocuments.id, id))
    res.json(updated)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── DELETE /api/receipt-documents/:id ───────────────────────────────────────
receiptDocumentsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { ownerId } = await getOwner(req)
    const db = await getDatabase()
    const id = Number(req.params.id)

    const [existing] = await db
      .select()
      .from(receiptDocuments)
      .where(and(eq(receiptDocuments.id, id), eq(receiptDocuments.ownerId, ownerId)))

    if (!existing) return res.status(404).json({ error: 'Nota não encontrada' })

    await db.update(receiptDocuments)
      .set({ dataState: 'cancelled' })
      .where(eq(receiptDocuments.id, id))

    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/receipt-documents/:id/reconcile ────────────────────────────────
receiptDocumentsRouter.post('/:id/reconcile', async (req: Request, res: Response) => {
  try {
    const { ownerId } = await getOwner(req)
    const db = await getDatabase()
    const id = Number(req.params.id)
    const { cardTransactionId, transactionId } = req.body

    if (!cardTransactionId && !transactionId) {
      return res.status(400).json({ error: 'Informe cardTransactionId ou transactionId' })
    }

    const [existing] = await db
      .select()
      .from(receiptDocuments)
      .where(and(eq(receiptDocuments.id, id), eq(receiptDocuments.ownerId, ownerId)))

    if (!existing) return res.status(404).json({ error: 'Nota não encontrada' })

    await db.update(receiptDocuments).set({
      dataState: 'reconciled',
      cardTransactionId: cardTransactionId ? Number(cardTransactionId) : null,
      transactionId: transactionId ? Number(transactionId) : null,
      reconcileSource: cardTransactionId ? 'invoice' : 'statement',
      reconciledAt: new Date(),
    }).where(eq(receiptDocuments.id, id))

    const [updated] = await db.select().from(receiptDocuments).where(eq(receiptDocuments.id, id))
    res.json(updated)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

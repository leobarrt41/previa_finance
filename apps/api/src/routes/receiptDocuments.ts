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
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDatabase } from '../config/database.js'
import { cardInvoices, cardTransactions, receiptDocuments } from '@previa/db'
import { eq, and, sql } from 'drizzle-orm'
import { buildFingerprintFromRaw } from '@previa/core'
import { requireClerkAuth } from '../middlewares/auth.js'
import { resolveOwnerId } from '../services/ownerStore.js'
import { sanitizeSensitiveText } from '../services/textSanitizer.js'
import { config } from '../config/env.js'
import { resolveOrCreateCreditCardAccount } from '../services/cardAccountResolver.js'

export const receiptDocumentsRouter: Router = Router()
receiptDocumentsRouter.use(requireClerkAuth)

function getPythonBin(): string {
  return process.env.PREVIA_PYTHON || process.env.PYTHON_BIN || 'python3'
}

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

function normalizeConfidence(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(4)
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed.toFixed(4) : null
  }
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

function buildProjectedInvoiceDueDate(invoiceMonth: string, dueDay?: number | null): Date {
  const [yearText, monthText] = invoiceMonth.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = typeof dueDay === 'number' && dueDay > 0 ? dueDay : 15
  return new Date(Date.UTC(year, month - 1, day, 23, 59, 59))
}

async function syncProjectedCardReceiptArtifacts(
  tx: any,
  receipt: {
    id: number
    ownerId: number
    accountId: number | null
    amountMinor: number
    purchaseDate: Date
    purchaseMonth: string
    expectedInvoiceMonth: string | null
    merchantName: string | null
    description: string | null
    categoryId: string | null
    installmentTotal: number | null
    installmentCurrent: number | null
    paymentKind: string | null
    issuerName: string | null
    cardBrand: string | null
    cardLast4: string | null
    closingDay: number | null
    dueDay: number | null
  },
): Promise<void> {
  if (!receipt.accountId || receipt.paymentKind !== 'card' || !receipt.expectedInvoiceMonth) {
    return
  }

  const invoiceMonth = receipt.expectedInvoiceMonth
  const [existingInvoice] = await tx
    .select({
      id: cardInvoices.id,
      source: cardInvoices.source,
      dataState: cardInvoices.dataState,
    })
    .from(cardInvoices)
    .where(and(
      eq(cardInvoices.userId, receipt.ownerId),
      eq(cardInvoices.accountId, receipt.accountId),
      eq(cardInvoices.invoiceMonth, invoiceMonth),
    ))
    .limit(1)

  const projectedTotalRows = await tx
    .select({
      totalMinor: sql<number>`coalesce(sum(${receiptDocuments.amountMinor}), 0)`,
    })
    .from(receiptDocuments)
    .where(and(
      eq(receiptDocuments.ownerId, receipt.ownerId),
      eq(receiptDocuments.accountId, receipt.accountId),
      eq(receiptDocuments.expectedInvoiceMonth, invoiceMonth),
      eq(receiptDocuments.dataState, 'projected'),
      eq(receiptDocuments.paymentKind, 'card'),
    ))

  const projectedTotalMinor = BigInt(Number(projectedTotalRows[0]?.totalMinor ?? 0))
  const dueDate = buildProjectedInvoiceDueDate(invoiceMonth, receipt.dueDay)
  let cardInvoiceId = existingInvoice?.id ?? null

  if (!existingInvoice) {
    await tx.insert(cardInvoices).values({
      userId: receipt.ownerId,
      accountId: receipt.accountId,
      invoiceMonth,
      dueDate,
      totalAmountMinor: projectedTotalMinor,
      minimumPaymentMinor: null,
      previousBalanceMinor: 0n,
      paidAmountMinor: 0n,
      openAmountMinor: projectedTotalMinor,
      reportedPreviousBalanceMinor: 0n,
      reportedPaidAmountMinor: 0n,
      carriedOpenAmountMinor: 0n,
      paymentsAllocatedMinor: 0n,
      effectiveOpenAmountMinor: projectedTotalMinor,
      status: projectedTotalMinor > 0n ? 'OPEN' : 'PAID',
      source: 'receipt_document',
      dataState: 'projected',
      institutionName: receipt.issuerName ?? undefined,
      cardBrand: receipt.cardBrand ?? undefined,
      cardLast4: receipt.cardLast4 ?? undefined,
    })

    const [createdInvoice] = await tx
      .select({ id: cardInvoices.id })
      .from(cardInvoices)
      .where(and(
        eq(cardInvoices.userId, receipt.ownerId),
        eq(cardInvoices.accountId, receipt.accountId),
        eq(cardInvoices.invoiceMonth, invoiceMonth),
      ))
      .limit(1)

    cardInvoiceId = createdInvoice?.id ?? null
  } else if (existingInvoice.source === 'receipt_document' || existingInvoice.dataState === 'projected') {
    await tx.update(cardInvoices).set({
      totalAmountMinor: projectedTotalMinor,
      openAmountMinor: projectedTotalMinor,
      effectiveOpenAmountMinor: projectedTotalMinor,
      status: projectedTotalMinor > 0n ? 'OPEN' : 'PAID',
      updatedAt: new Date(),
    }).where(eq(cardInvoices.id, existingInvoice.id))

    cardInvoiceId = existingInvoice.id
  }

  if (!cardInvoiceId) return

  const description = receipt.description || receipt.merchantName || 'Nota fiscal'
  const { fingerprint, normalizedDescription } = buildFingerprintFromRaw({
    competencyMonth: invoiceMonth,
    amountMinor: BigInt(receipt.amountMinor),
    rawDescription: description,
  })

  const installmentNumber = receipt.installmentCurrent ?? null
  const installmentTotal = receipt.installmentTotal ?? null
  const installmentGroupId = installmentTotal ? `${fingerprint}-${installmentTotal}` : null

  await tx.insert(cardTransactions).values({
    userId: receipt.ownerId,
    cardInvoiceId,
    source: 'receipt_document',
    dataState: 'projected',
    movementType: 'card_purchase',
    movementSubtype: installmentTotal ? 'installment' : 'single',
    amountMinor: BigInt(receipt.amountMinor),
    currencyCode: 'BRL',
    occurredAt: receipt.purchaseDate,
    competencyMonth: invoiceMonth,
    description,
    normalizedDescription,
    categoryId: receipt.categoryId,
    categoryAssignedBy: receipt.categoryId ? 'user' : 'receipt_document',
    merchantName: receipt.merchantName,
    installmentNumber,
    installmentTotal,
    installmentGroupId,
    fingerprint,
    isReconciled: false,
    receiptDocumentId: receipt.id,
  })
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

async function rasterizePdfToImageDataUrl(buffer: Buffer): Promise<string | null> {
  const workDir = mkdtempSync(join(tmpdir(), 'previa-receipt-'))
  const inputPath = join(workDir, 'input.pdf')
  const outputPrefix = join(workDir, 'page')
  try {
    writeFileSync(inputPath, buffer)

    await new Promise<void>((resolve, reject) => {
      const child = spawn('pdftoppm', ['-png', '-r', '180', inputPath, outputPrefix], { stdio: ['ignore', 'pipe', 'pipe'] })
      let stderr = ''
      child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(stderr.trim() || 'pdftoppm failed'))
      })
    })

    const pageFiles = readdirSync(workDir)
      .filter((name) => /^page-\d+\.png$/i.test(name))
      .sort()
      .slice(0, 4)
      .map((name) => join(workDir, name))

    if (pageFiles.length === 0) return null

    const script = [
      'import io, sys',
      'from PIL import Image',
      'paths = sys.argv[1:]',
      'images = [Image.open(path).convert("RGB") for path in paths]',
      'width = max(img.width for img in images)',
      'height = sum(img.height for img in images)',
      'canvas = Image.new("RGB", (width, height), "white")',
      'y = 0',
      'for img in images:',
      '    canvas.paste(img, (0, y))',
      '    y += img.height',
      'out = io.BytesIO()',
      'canvas.save(out, format="PNG")',
      'sys.stdout.buffer.write(out.getvalue())',
    ].join('\n')

    return await new Promise<string | null>((resolve) => {
      const child = spawn(getPythonBin(), ['-c', script, ...pageFiles], { stdio: ['ignore', 'pipe', 'pipe'] })
      const chunks: Buffer[] = []
      let stderr = ''

      child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
      child.on('error', () => resolve(null))
      child.on('close', (code) => {
        if (code === 0 && chunks.length > 0) {
          resolve(`data:image/png;base64,${Buffer.concat(chunks).toString('base64')}`)
          return
        }
        resolve(null)
      })
    })
  } catch {
    return null
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {
      // best effort cleanup
    }
  }
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

      const child = spawn(getPythonBin(), ['-c', script], { stdio: ['pipe', 'pipe', 'pipe'] })
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

async function ocrImageToText(buffer: Buffer): Promise<string | null> {
  const workDir = mkdtempSync(join(tmpdir(), 'previa-ocr-'))
  const inputPath = join(workDir, 'input.png')
  try {
    writeFileSync(inputPath, buffer)

    return await new Promise<string | null>((resolve) => {
      const child = spawn('tesseract', [inputPath, 'stdout', '--psm', '6', '-l', 'por+eng'], { stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8') })
      child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
      child.on('error', () => resolve(null))
      child.on('close', (code) => {
        if (code === 0) {
          const text = stdout.trim()
          resolve(text || null)
          return
        }
        resolve(null)
      })
    })
  } catch {
    return null
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {
      // best effort cleanup
    }
  }
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
  const sanitizedText = input.source?.text ? sanitizeSensitiveText(input.source.text).sanitizedText : ''
  const userContent =
    input.source?.kind === 'image' && input.source.text
      ? JSON.stringify({
          filename: input.filename,
          mimeType: input.mimeType,
          source: {
            kind: 'image',
            text: sanitizedText,
          },
        })
      : input.source?.kind === 'image' && input.source.imageUrl
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
            text: sanitizedText,
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

    const shouldAutoCreateCardAccount = paymentKind !== 'debit'
      && (paymentKind === 'card' || Boolean(hints.institutionName || hints.cardLast4))

    const resolvedAccountId = accountId
      ? Number(accountId)
      : shouldAutoCreateCardAccount
        ? await resolveOrCreateCreditCardAccount(
        db,
        ownerId,
        {
          institutionName: hints.institutionName || normalizeText(issuerName),
          cardBrand: hints.cardBrand,
          cardLast4: hints.cardLast4,
        },
        'receipt_document',
          )
        : null

    const inferredExpectedInvoiceMonth = expectedInvoiceMonth
      ? String(expectedInvoiceMonth)
      : paymentKind === 'card'
        ? addMonths(String(purchaseMonth), 1)
        : null

    const created = await db.transaction(async (tx) => {
      const [result] = await tx.insert(receiptDocuments).values({
        userId,
        ownerId,
        amountMinor: Number(amountMinor),
        purchaseDate: new Date(purchaseDate),
        purchaseMonth: String(purchaseMonth),
        expectedInvoiceMonth: inferredExpectedInvoiceMonth,
        merchantName: merchantName || null,
        merchantCnpj: merchantCnpj || null,
        paymentKind: paymentKind === 'card' || paymentKind === 'debit' ? paymentKind : null,
        issuerName: normalizeText(issuerName),
        cardBrand: hints.cardBrand ?? null,
        cardLast4: hints.cardLast4 ?? null,
        maskedNumber: hints.maskedNumber ?? null,
        ownerName: hints.ownerName ?? null,
        closingDay: hints.closingDay ?? null,
        dueDay: hints.dueDay ?? null,
        ocrConfidenceScore: normalizeConfidence(rawPayload?.confidence),
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

      const [createdRow] = await tx
        .select()
        .from(receiptDocuments)
        .where(eq(receiptDocuments.id, (result as any).insertId))

      if (createdRow) {
        await syncProjectedCardReceiptArtifacts(tx, {
          id: createdRow.id,
          ownerId: createdRow.ownerId,
          accountId: createdRow.accountId,
          amountMinor: createdRow.amountMinor,
          purchaseDate: createdRow.purchaseDate,
          purchaseMonth: createdRow.purchaseMonth,
          expectedInvoiceMonth: createdRow.expectedInvoiceMonth,
          merchantName: createdRow.merchantName,
          description: createdRow.description,
          categoryId: createdRow.categoryId,
          installmentTotal: createdRow.installmentTotal,
          installmentCurrent: createdRow.installmentCurrent,
          paymentKind: createdRow.paymentKind,
          issuerName: createdRow.issuerName,
          cardBrand: createdRow.cardBrand,
          cardLast4: createdRow.cardLast4,
          closingDay: createdRow.closingDay,
          dueDay: createdRow.dueDay,
        })
      }

      return createdRow
    })

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

    const sanitizedTextContext = textContext ? sanitizeSensitiveText(textContext).sanitizedText : ''
    const pdfHasUsefulText = sanitizedTextContext.replace(/\s+/g, '').length >= 40
    const imageBuffer = isImage ? await preprocessImageForOcr(req.file.buffer) : req.file.buffer
    const imageText = isImage ? await ocrImageToText(imageBuffer) : null
    const sanitizedImageText = imageText ? sanitizeSensitiveText(imageText).sanitizedText : ''
    const imageHasUsefulText = Boolean(sanitizedImageText.replace(/\s+/g, '').length >= 20)
    const pdfImageUrl = isPdf && !pdfHasUsefulText
      ? await rasterizePdfToImageDataUrl(req.file.buffer)
      : null
    if (isPdf && !pdfHasUsefulText && !pdfImageUrl) {
      return res.status(422).json({ error: 'PDF sem texto útil e sem rasterização local disponível.' })
    }
    if (isImage && !imageHasUsefulText) {
      return res.status(422).json({ error: 'Imagem sem OCR local disponível para sanitização.' })
    }

    const aiPayload = isPdf && pdfHasUsefulText
      ? {
          filename: req.file.originalname,
          mimeType,
          source: {
            kind: 'pdf',
            text: sanitizedTextContext.slice(0, 12000),
          },
        }
      : isImage
        ? {
            filename: req.file.originalname,
            mimeType,
            source: {
              kind: 'image',
              text: sanitizedImageText.slice(0, 12000),
            },
          }
      : {
          filename: req.file.originalname,
          mimeType: isPdf ? 'image/png' : mimeType,
          source: {
            kind: 'image',
            imageUrl: isPdf
              ? pdfImageUrl
              : `data:${mimeType};base64,${imageBuffer.toString('base64')}`,
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
    const autoAccountId = paymentKind !== 'debit'
      ? await resolveOrCreateCreditCardAccount(
        db,
        ownerId,
        {
          institutionName: hints.institutionName,
          cardBrand: hints.cardBrand,
          cardLast4: hints.cardLast4,
        },
        'receipt_document',
      )
      : null

    if (!amountMinor || amountMinor <= 0) {
      return res.status(400).json({ error: 'Não foi possível extrair o valor da nota.' })
    }

    const created = await db.transaction(async (tx) => {
      const [result] = await tx.insert(receiptDocuments).values({
        userId,
        ownerId,
        amountMinor,
        purchaseDate: parsedPurchaseDate,
        purchaseMonth,
        expectedInvoiceMonth,
        merchantName: extracted.merchantName || null,
        merchantCnpj: extracted.merchantCnpj || null,
        paymentKind: paymentKind === 'card' || paymentKind === 'debit' ? paymentKind : null,
        issuerName: hints.institutionName ?? null,
        cardBrand: hints.cardBrand ?? null,
        cardLast4: hints.cardLast4 ?? null,
        maskedNumber: hints.maskedNumber ?? null,
        ownerName: hints.ownerName ?? null,
        closingDay: hints.closingDay ?? null,
        dueDay: hints.dueDay ?? null,
        ocrConfidenceScore: normalizeConfidence(extracted.confidence),
        categoryId: null,
        accountId: autoAccountId,
        nfeKey: extracted.nfeKey || null,
        fileUrl: req.file!.originalname,
        fileType: mimeType,
        description: extracted.description || extracted.merchantName || null,
        rawPayload: extracted,
        dataState: 'projected',
      })

      const [createdRow] = await tx.select().from(receiptDocuments).where(eq(receiptDocuments.id, (result as any).insertId))
      if (createdRow) {
        await syncProjectedCardReceiptArtifacts(tx, {
          id: createdRow.id,
          ownerId: createdRow.ownerId,
          accountId: createdRow.accountId,
          amountMinor: createdRow.amountMinor,
          purchaseDate: createdRow.purchaseDate,
          purchaseMonth: createdRow.purchaseMonth,
          expectedInvoiceMonth: createdRow.expectedInvoiceMonth,
          merchantName: createdRow.merchantName,
          description: createdRow.description,
          categoryId: createdRow.categoryId,
          installmentTotal: createdRow.installmentTotal,
          installmentCurrent: createdRow.installmentCurrent,
          paymentKind: createdRow.paymentKind,
          issuerName: createdRow.issuerName,
          cardBrand: createdRow.cardBrand,
          cardLast4: createdRow.cardLast4,
          closingDay: createdRow.closingDay,
          dueDay: createdRow.dueDay,
        })
      }

      return createdRow
    })

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
      paymentKind, issuerName, cardBrand, cardLast4, maskedNumber, ownerName, closingDay, dueDay, ocrConfidenceScore,
    } = req.body

    await db.update(receiptDocuments).set({
      ...(amountMinor !== undefined && { amountMinor: Number(amountMinor) }),
      ...(purchaseDate !== undefined && { purchaseDate: new Date(purchaseDate) }),
      ...(purchaseMonth !== undefined && { purchaseMonth: String(purchaseMonth) }),
      ...(expectedInvoiceMonth !== undefined && { expectedInvoiceMonth: expectedInvoiceMonth || null }),
      ...(merchantName !== undefined && { merchantName }),
      ...(merchantCnpj !== undefined && { merchantCnpj }),
      ...(paymentKind !== undefined && { paymentKind: paymentKind || null }),
      ...(issuerName !== undefined && { issuerName: issuerName || null }),
      ...(cardBrand !== undefined && { cardBrand: cardBrand || null }),
      ...(cardLast4 !== undefined && { cardLast4: cardLast4 || null }),
      ...(maskedNumber !== undefined && { maskedNumber: maskedNumber || null }),
      ...(ownerName !== undefined && { ownerName: ownerName || null }),
      ...(closingDay !== undefined && { closingDay: closingDay ? Number(closingDay) : null }),
      ...(dueDay !== undefined && { dueDay: dueDay ? Number(dueDay) : null }),
      ...(ocrConfidenceScore !== undefined && { ocrConfidenceScore: normalizeConfidence(ocrConfidenceScore) }),
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

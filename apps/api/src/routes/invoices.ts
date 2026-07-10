/**
 * routes/invoices.ts — Invoice PDF upload & import endpoints
 *
 * POST /api/invoices/parse
 *   Accepts a multipart PDF upload, converts it into structural ASCII,
 *   runs sanitization + AI extraction, and returns the extracted data
 *   for frontend preview. No data is saved — the user reviews and
 *   confirms before import.
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
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { accounts, categories, cardInvoiceComponents, cardInvoices, cardInvoiceSettlements, cardTransactions, receiptDocuments } from '@previa/db'
import { buildFingerprintFromRaw, normalizeDescription } from '@previa/core'
import { eq, and, desc, sql, inArray } from 'drizzle-orm'
import { getDatabase } from '../config/database.js'
import { config } from '../config/env.js'
import { resolveOwnerId } from '../services/ownerStore.js'
import { syncCardInvoiceSemanticFields } from '../services/cardInvoiceSemantics.js'
import { buildCreditCardDisplayName, resolveOrCreateCreditCardAccount } from '../services/cardAccountResolver.js'
import { buildInvoiceComponentRows } from '../services/cardInvoiceComponents.js'
import { sanitizeSensitiveText, sanitizeTextForInvoiceDebug } from '../services/textSanitizer.js'
import { runInvoiceAsciiIngestionPipeline } from '../services/invoiceIntake/pipeline.js'
import { createError } from '../middlewares/errorHandler.js'
import { requireClerkAuth } from '../middlewares/auth.js'

const router: Router = Router()
router.use(requireClerkAuth)
const INVOICE_AI_TIMEOUT_MS = 60000

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

type PdfWord = {
  text: string
  x0: number
  x1: number
  top: number
  bottom: number
}

type PdfPageCapture = {
  pageNumber: number
  width: number
  height: number
  words: PdfWord[]
}

type InvoiceManifest = {
  bank?: string | null
  summary: {
    cardLast4: string
    product: string
    invoiceMonth: string
    dueDate: string
    dueMonth: string
    closingDate: string
    totalMinor: number
    previousBalanceMinor: number
    paymentsMinor: number
    nationalPurchasesMinor: number
    internationalPurchasesMinor: number
    chargesMinor: number
    openBalanceMinor: number
  }
  transactions: Array<{
    id?: string
    date: string
    description: string
    amountMinor: number
    installment?: string
    category?: string
    country?: string
  }>
}

type InvoiceDebugStage = {
  label: string
  content: string
}

type InvoiceParseDebug = {
  strategy: 'ascii'
  sourceBank: string
  stages: InvoiceDebugStage[]
}

function getPythonBin(): string {
  return process.env.PREVIA_PYTHON || process.env.PYTHON_BIN || 'python3'
}

function isPdfPasswordError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.message.includes('PDFPasswordIncorrect')
    || error.message.includes('PDF_PASSWORD_REQUIRED')
    || /incorrect password/i.test(error.message)
    || /password\s+required/i.test(error.message)
}

function isPdfDependencyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.message.includes('PDF_DEPENDENCY_MISSING')
    || error.message.includes("No module named 'pdfplumber'")
    || error.message.includes('ModuleNotFoundError')
}

function getPdfParseErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }
  return 'Erro desconhecido ao ler a fatura.'
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toDebugString(value: unknown, maxLength = 12000): string {
  let text = ''
  if (typeof value === 'string') {
    text = value
  } else {
    try {
      text = JSON.stringify(value, null, 2) ?? ''
    } catch {
      text = String(value)
    }
  }

  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}\n… [truncado ${text.length - maxLength} chars]`
}

function normalizeInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Math.trunc(Number(value))
  }
  return 0
}

function normalizeMonth(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return /^\d{4}-\d{2}$/.test(trimmed) ? trimmed : ''
}

function normalizeDate(value: unknown, invoiceMonth?: string): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed

  const slashMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[2]}-${slashMatch[1]}`
  }

  const monthMatch = trimmed.match(/^(\d{2})\/(\d{2})$/)
  if (monthMatch && invoiceMonth) {
    return `${invoiceMonth}-${monthMatch[1]}`
  }

  const parsed = new Date(trimmed)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10)
  }

  return ''
}

function normalizeCardLast4(value: unknown): string {
  const digits = normalizeText(value).replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : ''
}

function normalizeBankId(value: unknown): string {
  const bank = normalizeText(value).toLowerCase()
  if (!bank) return ''
  const mapped: Record<string, string> = {
    banco_do_brasil: 'bb',
    banco_do_brasil_pdf: 'bb',
    bb: 'bb',
    itau: 'itau',
    itaú: 'itau',
    bradesco: 'bradesco',
    picpay: 'picpay',
    nubank: 'nubank',
  }
  return mapped[bank] ?? bank
}

function normalizeInvoiceLineText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function shouldExcludeInvoiceTransaction(description: string): boolean {
  const text = normalizeInvoiceLineText(description)
  if (!text) return true

  return [
    /^saldo anterior\b/,
    /^previous balance\b/,
    /^pagamento\b/,
    /^pagto\b/,
    /^pgto\b/,
    /^creditos?\/pagamentos?\b/,
    /^compras?\/debitos?\b/,
    /^total da fatura\b/,
    /^fatura anterior\b/,
    /^pagamento minimo\b/,
    /^parcelamento da fatura\b/,
    /^encargos\b/,
    /^juros\b/,
    /^multa\b/,
    /^anuidade\b/,
    /^limite\b/,
    /^quitacao\b/,
    /^liquidac/,
    /^payment\b/,
  ].some((pattern) => pattern.test(text))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function median(values: number[]): number {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

function estimateAverageCharWidth(words: PdfWord[]): number {
  const samples = words
    .map((word) => {
      const length = Math.max(1, word.text.replace(/\s+/g, '').length)
      return (word.x1 - word.x0) / length
    })
    .filter((value) => Number.isFinite(value) && value > 0)

  return clamp(median(samples) || 6, 3.5, 14)
}

function groupWordsIntoRows(words: PdfWord[], rowTolerance: number): PdfWord[][] {
  const rows: PdfWord[][] = []
  const ordered = [...words].sort((a, b) => a.top - b.top || a.x0 - b.x0)

  for (const word of ordered) {
    const lastRow = rows[rows.length - 1]
    if (!lastRow) {
      rows.push([word])
      continue
    }

    const rowTop = lastRow[0].top
    if (Math.abs(word.top - rowTop) <= rowTolerance) {
      lastRow.push(word)
      continue
    }

    rows.push([word])
  }

  return rows
}

function renderAsciiRow(words: PdfWord[], charWidth: number): string {
  if (words.length === 0) return ''

  const ordered = [...words].sort((a, b) => a.x0 - b.x0)
  const segments: string[] = []
  let cursor = 0

  for (const word of ordered) {
    const target = Math.max(0, Math.round(word.x0 / charWidth))
    const spaces = segments.length === 0
      ? target
      : Math.max(1, target - cursor)

    if (spaces > 0) {
      segments.push(' '.repeat(spaces))
    }
    segments.push(word.text)
    cursor = target + word.text.length
  }

  return segments.join('').replace(/\s+$/, '')
}

function runPythonScript(script: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(getPythonBin(), ['-c', script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      reject(error)
    })
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }
      reject(new Error(stderr.trim() || stdout.trim() || `Python script failed with exit code ${code ?? 'unknown'}`))
    })
  })
}

async function extractPdfPagesWithCoordinates(buffer: Buffer, password?: string): Promise<PdfPageCapture[]> {
  const workDir = mkdtempSync(join(tmpdir(), 'previa-invoices-'))
  const pdfPath = join(workDir, 'invoice.pdf')
  writeFileSync(pdfPath, buffer)

  const script = String.raw`
import json
import sys
from pathlib import Path

try:
    import pdfplumber
    from pdfminer.pdfdocument import PDFPasswordIncorrect
except ModuleNotFoundError as exc:
    print(f"PDF_DEPENDENCY_MISSING: {exc}", file=sys.stderr)
    sys.exit(4)

pdf_path = Path(sys.argv[1])
password = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None

try:
    pages = []
    with pdfplumber.open(pdf_path, password=password) as pdf:
        for index, page in enumerate(pdf.pages, start=1):
            try:
                words = page.extract_words(
                    keep_blank_chars=False,
                    use_text_flow=False,
                    horizontal_ltr=True,
                    vertical_ttb=True,
                    x_tolerance=2,
                    y_tolerance=2,
                )
            except Exception:
                words = []

            normalized = []
            for word in words:
                text = (word.get("text") or "").strip()
                if not text:
                    continue
                normalized.append({
                    "text": text,
                    "x0": float(word.get("x0") or 0),
                    "x1": float(word.get("x1") or 0),
                    "top": float(word.get("top") or 0),
                    "bottom": float(word.get("bottom") or 0),
                })

            pages.append({
                "pageNumber": index,
                "width": float(page.width or 0),
                "height": float(page.height or 0),
                "words": normalized,
            })

    print(json.dumps({"pages": pages}, ensure_ascii=False))
except PDFPasswordIncorrect as exc:
    print(f"PDF_PASSWORD_REQUIRED: {exc}", file=sys.stderr)
    sys.exit(3)
except Exception as exc:
    message = str(exc)
    if "password" in message.lower():
        print(f"PDF_PASSWORD_REQUIRED: {message}", file=sys.stderr)
        sys.exit(3)
    print(message, file=sys.stderr)
    sys.exit(1)
`

  try {
    const { stdout } = await runPythonScript(script, [pdfPath, password ?? ''])
    const parsed = JSON.parse(stdout) as { pages?: PdfPageCapture[] }
    return Array.isArray(parsed.pages) ? parsed.pages : []
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true })
    } catch {
      // best effort cleanup
    }
  }
}

function buildAsciiMap(pages: PdfPageCapture[]): string {
  const lines: string[] = []

  for (const page of pages) {
    const charWidth = estimateAverageCharWidth(page.words)
    const rowTolerance = clamp(Math.round(charWidth * 0.9), 4, 10)
    const rows = groupWordsIntoRows(page.words, rowTolerance)
    let previousTop: number | null = null

    lines.push(`===== PAGE ${page.pageNumber} | width=${Math.round(page.width)} | height=${Math.round(page.height)} =====`)
    for (const row of rows) {
      const top = row[0]?.top ?? 0
      if (previousTop !== null) {
        const verticalGap = top - previousTop
        const blankLines = clamp(Math.round(verticalGap / (rowTolerance * 1.6)) - 1, 0, 3)
        for (const _ of Array.from({ length: blankLines })) {
          lines.push('')
        }
      }
      lines.push(renderAsciiRow(row, charWidth))
      previousTop = top
    }
  }

  return lines.join('\n').trim()
}

function sanitizeInvoiceAscii(asciiText: string): { sanitizedText: string; debugText: string } {
  const sanitized = sanitizeSensitiveText(asciiText)
  return {
    sanitizedText: sanitized.sanitizedText,
    debugText: sanitizeTextForInvoiceDebug(asciiText),
  }
}

async function callInvoiceLLM(
  asciiText: string,
  meta: { filename: string; passwordProtected: boolean },
): Promise<unknown> {
  if (!config.ai.apiKey) {
    throw new Error('AI não configurada para gerar invoice_manifest.json')
  }

  const baseUrl = config.ai.baseUrl.replace(/\/$/, '')
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
            'Voce recebe um ASCII posicional de fatura PDF. Responda SOMENTE JSON no formato {"bank":"...","summary":{"cardLast4":"...","product":"...","invoiceMonth":"YYYY-MM","dueDate":"YYYY-MM-DD","dueMonth":"YYYY-MM","closingDate":"YYYY-MM-DD","totalMinor":0,"previousBalanceMinor":0,"paymentsMinor":0,"nationalPurchasesMinor":0,"internationalPurchasesMinor":0,"chargesMinor":0,"openBalanceMinor":0},"transactions":[{"id":"...","date":"YYYY-MM-DD","description":"...","amountMinor":0,"installment":"...","category":"...","country":"..."}]}. Use amountMinor em centavos e preserve a ordem das compras. A lista transactions deve conter apenas compras, encargos e ajustes da fatura; nunca inclua linhas de pagamento, saldo anterior, total da fatura ou amortizacao/quitacao. A instituição deve ser identificada pelo cabecalho, logo, titulo ou bloco principal da fatura; nunca pela primeira transacao, merchant, adquirente ou descricao de compra. Se o banco/issuer estiver visivel no cabecalho, preencha bank com bb, itau, bradesco, picpay ou outro identificador curto. Se um campo não existir, envie string vazia ou 0.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            filename: meta.filename,
            passwordProtected: meta.passwordProtected,
            ascii: asciiText,
          }),
        },
      ],
    }),
    signal: AbortSignal.timeout(INVOICE_AI_TIMEOUT_MS),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Falha ao extrair invoice_manifest.json (${response.status}): ${text}`)
  }

  const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  const content = json.choices?.[0]?.message?.content ?? '{}'

  try {
    return JSON.parse(content)
  } catch {
    throw new Error('LLM não retornou JSON válido para invoice_manifest.json.')
  }
}

function validateInvoiceManifest(raw: unknown): InvoiceManifest {
  if (!raw || typeof raw !== 'object') {
    throw new Error('invoice_manifest.json inválido.')
  }

  const manifest = raw as Partial<InvoiceManifest> & { summary?: Record<string, unknown>; transactions?: unknown[] }
  const summary = manifest.summary
  if (!summary || typeof summary !== 'object') {
    throw new Error('invoice_manifest.json sem summary.')
  }

  const normalizedSummary = {
    cardLast4: normalizeCardLast4(summary.cardLast4),
    product: normalizeText(summary.product),
    invoiceMonth: normalizeMonth(summary.invoiceMonth),
    dueDate: normalizeDate(summary.dueDate),
    dueMonth: normalizeMonth(summary.dueMonth),
    closingDate: normalizeDate(summary.closingDate),
    totalMinor: normalizeInt(summary.totalMinor),
    previousBalanceMinor: normalizeInt(summary.previousBalanceMinor),
    paymentsMinor: normalizeInt(summary.paymentsMinor),
    nationalPurchasesMinor: normalizeInt(summary.nationalPurchasesMinor),
    internationalPurchasesMinor: normalizeInt(summary.internationalPurchasesMinor),
    chargesMinor: normalizeInt(summary.chargesMinor),
    openBalanceMinor: normalizeInt(summary.openBalanceMinor),
  }

  if (!normalizedSummary.invoiceMonth && normalizedSummary.dueDate) {
    normalizedSummary.invoiceMonth = normalizedSummary.dueDate.slice(0, 7)
  }
  if (!normalizedSummary.dueMonth && normalizedSummary.dueDate) {
    normalizedSummary.dueMonth = normalizedSummary.dueDate.slice(0, 7)
  }
  if (!normalizedSummary.dueMonth && normalizedSummary.invoiceMonth) {
    const [year, month] = normalizedSummary.invoiceMonth.split('-').map(Number)
    const nextMonth = new Date(Date.UTC(year, month, 1))
    normalizedSummary.dueMonth = `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, '0')}`
  }
  if (!normalizedSummary.invoiceMonth && normalizedSummary.dueMonth) {
    const [year, month] = normalizedSummary.dueMonth.split('-').map(Number)
    const prevMonth = new Date(Date.UTC(year, month - 2, 1))
    normalizedSummary.invoiceMonth = `${prevMonth.getUTCFullYear()}-${String(prevMonth.getUTCMonth() + 1).padStart(2, '0')}`
  }

  if (!normalizedSummary.invoiceMonth || !normalizedSummary.dueMonth) {
    throw new Error('invoice_manifest.json sem invoiceMonth/dueMonth válidos.')
  }

  const fallbackTotal =
    normalizedSummary.previousBalanceMinor
    - normalizedSummary.paymentsMinor
    + normalizedSummary.nationalPurchasesMinor
    + normalizedSummary.internationalPurchasesMinor
    + normalizedSummary.chargesMinor

  if (normalizedSummary.totalMinor <= 0 && fallbackTotal > 0) {
    normalizedSummary.totalMinor = fallbackTotal
  }
  if (normalizedSummary.openBalanceMinor <= 0 && normalizedSummary.totalMinor > 0) {
    normalizedSummary.openBalanceMinor = normalizedSummary.totalMinor
  }

  const transactions = Array.isArray(manifest.transactions)
    ? manifest.transactions
        .map((item, index) => {
          if (!item || typeof item !== 'object') return null
          const tx = item as Record<string, unknown>
          const description = normalizeText(tx.description)
          const date = normalizeDate(tx.date, normalizedSummary.invoiceMonth)
          const amountMinor = normalizeInt(tx.amountMinor)
          if (!description || !date || amountMinor === 0) return null
          if (shouldExcludeInvoiceTransaction(description)) return null

          return {
            id: normalizeText(tx.id) || `llm-${index}`,
            date,
            description,
            amountMinor: Math.abs(amountMinor),
            installment: normalizeText(tx.installment) || undefined,
            category: normalizeText(tx.category),
            country: normalizeText(tx.country) || undefined,
          }
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    : []

  if (transactions.length === 0) {
    throw new Error('invoice_manifest.json sem transactions válidas.')
  }

  return {
    bank: normalizeBankId(manifest.bank) || null,
    summary: {
      cardLast4: normalizedSummary.cardLast4,
      product: normalizedSummary.product,
      invoiceMonth: normalizedSummary.invoiceMonth,
      dueDate: normalizedSummary.dueDate,
      dueMonth: normalizedSummary.dueMonth,
      closingDate: normalizedSummary.closingDate,
      totalMinor: normalizedSummary.totalMinor,
      previousBalanceMinor: normalizedSummary.previousBalanceMinor,
      paymentsMinor: normalizedSummary.paymentsMinor,
      nationalPurchasesMinor: normalizedSummary.nationalPurchasesMinor,
      internationalPurchasesMinor: normalizedSummary.internationalPurchasesMinor,
      chargesMinor: normalizedSummary.chargesMinor,
      openBalanceMinor: normalizedSummary.openBalanceMinor,
    },
    transactions,
  }
}

function manifestToInvoiceParseResult(
  manifest: InvoiceManifest,
  fallbackBank: string,
): {
  bank: string
  summary: {
    cardLast4: string
    product: string
    invoiceMonth: string
    dueDate: string
    dueMonth: string
    closingDate: string
    totalMinor: number
    previousBalanceMinor: number
    paymentsMinor: number
    nationalPurchasesMinor: number
    internationalPurchasesMinor: number
    chargesMinor: number
    openBalanceMinor: number
  }
  transactions: Array<{
    id: string
    date: string
    description: string
    amountMinor: number
    installment?: string
    categoryId: string | null
    competencyMonth: string
    include: boolean
    category: string
    country?: string
  }>
  forecasts: Array<{
    id: string
    competencyMonth: string
    amountMinor: number
    recurrence: 'one-time'
    description: string
  }>
} {
  const bank = manifest.bank || (fallbackBank === 'auto' ? 'unknown' : fallbackBank)
  const summary = manifest.summary
  const transactions = manifest.transactions.map((tx, index) => ({
    id: tx.id || `llm-${index}`,
    date: tx.date,
    description: tx.description,
    amountMinor: Math.abs(tx.amountMinor),
    installment: tx.installment,
    categoryId: null,
    competencyMonth: tx.date.slice(0, 7) || summary.invoiceMonth,
    include: Math.abs(tx.amountMinor) > 0,
    category: tx.category || '',
    country: tx.country,
  }))

  const forecasts: Array<{
    id: string
    competencyMonth: string
    amountMinor: number
    recurrence: 'one-time'
    description: string
  }> = summary.openBalanceMinor > 0
    ? [{
        id: `ascii-invoice-${summary.invoiceMonth}-${summary.cardLast4 || 'na'}`,
        competencyMonth: summary.dueMonth || summary.invoiceMonth,
        amountMinor: -summary.openBalanceMinor,
        recurrence: 'one-time',
        description: `Fatura ${summary.product || bank}`,
      }]
    : []

  return { bank, summary, transactions, forecasts }
}

type InvoicePreviewTransaction = ReturnType<typeof manifestToInvoiceParseResult>['transactions'][number]
type InvoicePreviewPayload = ReturnType<typeof manifestToInvoiceParseResult>

const PREVIEW_DESCRIPTION_NOISE = new Set([
  'PARCELA',
  'PARCELAS',
  'PARC',
  'COMPRA',
  'COMPRAS',
  'CREDITO',
  'DEBITO',
  'PAGAMENTO',
  'PAGAMENTOS',
  'PGTO',
  'PAGTO',
])

const PREVIEW_SUFFIX_TOKENS = [
  'SAOPAULO',
  'SAOPAULOSP',
  'SAOPAULOBR',
  'SAOPAULOBRA',
  'SAOJOSE',
  'SAOJOS',
  'SAOJOSEDO',
  'SAOJOSEDOS',
  'CACAPAVA',
  'NORTHSYDNEY',
  'SYDNEY',
  'BRASIL',
  'BRA',
  'BR',
  'SP',
  'RJ',
  'MG',
  'PR',
  'SC',
  'RS',
  'BA',
  'CE',
  'GO',
  'DF',
  'ES',
  'MT',
  'MS',
  'PA',
  'PE',
  'RN',
  'PB',
  'AL',
  'SE',
  'AM',
  'AP',
  'AC',
  'RO',
  'RR',
  'TO',
]

function stripPreviewSuffixes(token: string): string {
  let current = token
  let changed = true

  while (changed && current.length > 0) {
    changed = false
    for (const suffix of PREVIEW_SUFFIX_TOKENS) {
      if (current === suffix) {
        return ''
      }
      if (current.endsWith(suffix) && current.length > suffix.length) {
        current = current.slice(0, -suffix.length)
        changed = true
        break
      }
    }
  }

  return current
}

function tokenizePreviewDescription(description: string): string[] {
  const base = normalizeDescription(description)
  if (!base) return []

  return base
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !PREVIEW_DESCRIPTION_NOISE.has(token))
    .filter((token) => !/^\d{1,2}\/\d{1,2}$/.test(token))
    .map(stripPreviewSuffixes)
    .filter(Boolean)
}

function canonicalPreviewDescription(description: string): string {
  const tokens = tokenizePreviewDescription(description)
  return tokens.join('')
}

function parsePreviewDate(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const parsed = new Date(`${date}T12:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime()
}

function isSamePreviewTransaction(
  a: InvoicePreviewTransaction,
  b: InvoicePreviewTransaction,
): boolean {
  if (a.amountMinor !== b.amountMinor) return false
  if ((a.installment ?? '').replace(/\s+/g, '') !== (b.installment ?? '').replace(/\s+/g, '')) return false

  const dateA = parsePreviewDate(a.date)
  const dateB = parsePreviewDate(b.date)
  if (dateA !== null && dateB !== null && Math.abs(dateA - dateB) > 2 * 24 * 60 * 60 * 1000) return false

  const normalizedA = canonicalPreviewDescription(a.description)
  const normalizedB = canonicalPreviewDescription(b.description)
  if (!normalizedA || !normalizedB) return false
  if (normalizedA === normalizedB) return true
  if (normalizedA.startsWith(normalizedB) || normalizedB.startsWith(normalizedA)) return true

  const tokensA = tokenizePreviewDescription(a.description)
  const tokensB = tokenizePreviewDescription(b.description)
  if (tokensA.length === 0 || tokensB.length === 0) return false

  const longer = tokensA.length >= tokensB.length ? tokensA : tokensB
  const shorter = tokensA.length >= tokensB.length ? tokensB : tokensA
  let matches = 0
  for (const token of shorter) {
    if (longer.includes(token)) matches += 1
  }

  return matches >= Math.max(1, Math.min(shorter.length, 2))
}

function previewTransactionScore(tx: InvoicePreviewTransaction): number {
  const tokens = tokenizePreviewDescription(tx.description)
  const canonical = canonicalPreviewDescription(tx.description)
  return canonical.length
    + tokens.length * 5
    + (tx.installment ? 12 : 0)
    + (tx.category ? 4 : 0)
    + (tx.country ? 2 : 0)
    + (tx.date ? 2 : 0)
}

function mergePreviewTransactions(
  primary: InvoicePreviewTransaction[],
  secondary: InvoicePreviewTransaction[],
): InvoicePreviewTransaction[] {
  const merged: InvoicePreviewTransaction[] = []
  for (const tx of [...primary, ...secondary]) {
    const existingIndex = merged.findIndex((item) => isSamePreviewTransaction(item, tx))
    if (existingIndex < 0) {
      merged.push(tx)
      continue
    }

    if (previewTransactionScore(tx) > previewTransactionScore(merged[existingIndex])) {
      merged[existingIndex] = tx
    }
  }

  return merged
}

function sumIncludedTransactions(transactions: InvoicePreviewTransaction[]): number {
  return transactions.reduce((sum, tx) => sum + (tx.include ? Math.abs(tx.amountMinor) : 0), 0)
}

function countIncludedTransactions(transactions: InvoicePreviewTransaction[]): number {
  return transactions.reduce((count, tx) => count + (tx.include ? 1 : 0), 0)
}

function getPreviewStats(transactions: InvoicePreviewTransaction[]): {
  includedCount: number
  includedTotalMinor: number
} {
  return {
    includedCount: countIncludedTransactions(transactions),
    includedTotalMinor: sumIncludedTransactions(transactions),
  }
}

function isTruthyRequestValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1'
    || normalized === 'true'
    || normalized === 'yes'
    || normalized === 'on'
}

async function parseInvoiceViaAsciiPipeline(
  buffer: Buffer,
  password: string | undefined,
  meta: { filename: string },
): Promise<{ payload: InvoicePreviewPayload; debug: InvoiceParseDebug }> {
  const result = await runInvoiceAsciiIngestionPipeline(buffer, {
    filename: meta.filename,
    password,
  })
  return {
    payload: result.payload as InvoicePreviewPayload,
    debug: result.debug as InvoiceParseDebug,
  }
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

      const password = typeof req.body.password === 'string' && req.body.password.trim()
        ? req.body.password.trim()
        : undefined

      try {
        const asciiResult = await parseInvoiceViaAsciiPipeline(file.buffer, password, { filename: file.originalname })
        return res.json({
          ...asciiResult.payload,
          debug: {
            ...asciiResult.debug,
            strategy: 'ascii',
          },
        })
      } catch (pipelineError) {
        if (isPdfPasswordError(pipelineError)) {
          throw createError('PDF protegido por senha. Informe a senha da fatura para gerar o preview.', 400)
        }
        if (isPdfDependencyError(pipelineError)) {
          throw createError('Dependência ausente para ler PDFs: pdfplumber. Instale o módulo Python e reinicie a API.', 500)
        }
        throw createError(`Falha ao ler a fatura: ${getPdfParseErrorMessage(pipelineError)}`, 400)
      }
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
      settlesInvoiceId: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
    })
  ),
  installments: z.array(
    z.object({
      date: z.string(),
      description: z.string(),
      amountMinor: z.number().int(),
      categoryId: z.string().nullable().optional(),
      competencyMonth: z.string().regex(/^\d{4}-\d{2}$/),
      installment: z.string().optional(),
    })
  ).optional(),
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
  monthlyExpensesMinor: z.number().int().optional(),
  creditsAndRefundsMinor: z.number().int().optional(),
  chargesMinor: z.number().int().optional(),
  financedBalanceMinor: z.number().int().optional(),
  openBalanceMinor: z.number().int().optional(),
  analysis: z.object({
    installments: z.array(
      z.object({
        date: z.string().optional(),
        description: z.string(),
        amount: z.number(),
        current: z.preprocess(
          (value) => (typeof value === 'number' && value > 0 ? value : undefined),
          z.number().int().positive().optional(),
        ).optional(),
        total: z.preprocess(
          (value) => (typeof value === 'number' && value > 0 ? value : undefined),
          z.number().int().positive().optional(),
        ).optional(),
      }),
    ).optional(),
    fees: z.array(
      z.object({
        description: z.string(),
        amount: z.number(),
        kind: z.string().optional(),
      }),
    ).optional(),
    payments: z.array(
      z.object({
        date: z.string().optional(),
        description: z.string(),
        amount: z.number(),
        source: z.string().optional(),
      }),
    ).optional(),
  }).optional(),
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

function describeDateValue(value: unknown) {
  if (value === null) {
    return { kind: 'null', type: 'object', instanceOfDate: false }
  }
  if (value === undefined) {
    return { kind: 'undefined', type: 'undefined', instanceOfDate: false }
  }
  if (value instanceof Date) {
    return {
      kind: 'Date',
      type: typeof value,
      instanceOfDate: true,
      isValid: !Number.isNaN(value.getTime()),
      iso: value.toISOString(),
      constructorName: value.constructor?.name ?? null,
    }
  }
  return {
    kind: typeof value,
    type: typeof value,
    instanceOfDate: false,
    constructorName: (value as { constructor?: { name?: string } })?.constructor?.name ?? null,
    value,
  }
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
    const displayName = buildCreditCardDisplayName(institutionName ?? body.bank, cardBrand, cardLast4)

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
  // -------------------------------------------------------------------------
  // 2b. Build category history map from previous card_transactions
  //     Matches by normalizedDescription → reuses the last user-assigned category
  //     Only applies to transactions that don't already have a categoryId
  // -------------------------------------------------------------------------
  const txsWithoutCategory = body.transactions.filter(t => !t.categoryId)
  const historyMap = new Map<string, { categoryId: string; assignedBy: string }>()
  const installmentHistoryMap = new Map<string, { categoryId: string; assignedBy: string }>()
  if (txsWithoutCategory.length > 0) {
    const normalizedDescs = [...new Set(
      txsWithoutCategory.map(t => normalizeDescription(t.description))
    )].filter(Boolean)
    if (normalizedDescs.length > 0) {
      const historicTxs = await db
        .select({
          normalizedDescription: cardTransactions.normalizedDescription,
          categoryId: cardTransactions.categoryId,
          categoryAssignedBy: cardTransactions.categoryAssignedBy,
          installmentGroupId: cardTransactions.installmentGroupId,
        })
        .from(cardTransactions)
        .where(
          and(
            eq(cardTransactions.userId, owner.id),
            inArray(cardTransactions.normalizedDescription, normalizedDescs),
          )
        )
        .orderBy(desc(cardTransactions.id))
        .limit(500)
      for (const row of historicTxs) {
        const key = row.normalizedDescription ?? ''
        if (!key || historyMap.has(key)) continue
        if (row.categoryId) {
          historyMap.set(key, {
            categoryId: row.categoryId,
            assignedBy: row.categoryAssignedBy ?? 'history',
          })
        }
        if (row.installmentGroupId && !installmentHistoryMap.has(row.installmentGroupId) && row.categoryId) {
          installmentHistoryMap.set(row.installmentGroupId, {
            categoryId: row.categoryId,
            assignedBy: row.categoryAssignedBy ?? 'history',
          })
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 2c. Classify remaining unclassified transactions with AI
  //     Fetches categories from DB and calls classifyTransactionsWithAI
  //     for transactions that have no categoryId from frontend or history.
  //     Best-effort: never blocks the import on failure.
  // -------------------------------------------------------------------------
  const aiCategoryMap = new Map<string, { categoryId: string; subcategoryId: string | null }>()
  if (config.ai.apiKey) {
    const txsStillUnclassified = body.transactions.filter((t) => {
      if (t.categoryId) return false
      const norm = normalizeDescription(t.description)
      if (historyMap.has(norm)) return false
      return true
    })
    if (txsStillUnclassified.length > 0) {
      try {
        const allCategories = await db
          .select({
            id: categories.id,
            name: categories.name,
            slug: categories.slug,
            type: categories.type,
            parentId: categories.parentId,
          })
          .from(categories)
        const aiTxs = txsStillUnclassified.map((t, i) => ({
          id: `ai-${i}`,
          description: t.description,
          amountMinor: t.amountMinor,
          installment: t.installment,
        }))
        const suggestions = await classifyTransactionsWithAI(aiTxs, allCategories)
        // Map back from ai-{i} index to original description
        txsStillUnclassified.forEach((t, i) => {
          const suggestion = suggestions[`ai-${i}`]
          if (suggestion) {
            const norm = normalizeDescription(t.description)
            aiCategoryMap.set(norm, suggestion)
          }
        })
        console.log(`[import] AI classified ${aiCategoryMap.size}/${txsStillUnclassified.length} transactions`)
      } catch (err) {
        console.warn('[import] AI classification failed (non-blocking):', err)
      }
    }
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

    const dueDateForDb = new Date(dueDate.getTime())
    const closingDateForDb = closingDate ? new Date(closingDate.getTime()) : null

    console.log('[invoices/import] timestamp payload prepared', {
      invoiceMonth: body.invoiceMonth,
      dueDate: describeDateValue(dueDate),
      dueDateForDb: describeDateValue(dueDateForDb),
      closingDate: describeDateValue(closingDate),
      closingDateForDb: describeDateValue(closingDateForDb),
    })

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
          parser_strategy = ${'ascii_ai_v1'},
          updated_at = CURRENT_TIMESTAMP
        where id = ${existingInvoice.id}
      `)
    } else {
      try {
        console.log('[invoices/import] about to insert card_invoice', {
          invoiceMonth: body.invoiceMonth,
          accountId,
          dueDateForDb: describeDateValue(dueDateForDb),
          closingDateForDb: describeDateValue(closingDateForDb),
          totalAmountMinor: totalAmountMinor.toString(),
          previousBalanceMinor: previousBalanceMinor.toString(),
          paidAmountMinor: paidAmountMinor.toString(),
          openAmountMinor: openAmountMinor.toString(),
        })

        await db.insert(cardInvoices).values({
          userId: owner.id,
          accountId,
          invoiceMonth: body.invoiceMonth,
          dueDate: dueDateForDb,
          ...(closingDateForDb ? { closingDate: closingDateForDb } : {}),
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
          parserStrategy: 'ascii_ai_v1',
        })
        console.log('[invoices/import] card_invoice insert completed', {
          invoiceMonth: body.invoiceMonth,
          accountId,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[import] failed to create card_invoice:', {
          invoiceMonth: body.invoiceMonth,
          dueMonth: body.dueMonth,
          dueDate: dueDateForDb?.toISOString?.(),
          dueDateType: typeof dueDate,
          dueDateIsDate: dueDate instanceof Date,
          closingDate: closingDateForDb?.toISOString?.(),
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

    const analysisFeesMinor = (body.analysis?.fees ?? []).reduce(
      (sum, fee) => sum + Math.round(Math.abs(Number(fee.amount) || 0) * 100),
      0,
    )
    const componentRows = buildInvoiceComponentRows({
      userId: owner.id,
      cardInvoiceId,
      summary: {
        previousBalanceMinor: body.previousBalanceMinor ?? null,
        paymentsMinor: body.paymentsMinor ?? null,
        creditsAndRefundsMinor: body.creditsAndRefundsMinor ?? null,
        monthlyExpensesMinor: body.monthlyExpensesMinor ?? Number(totalImported),
        chargesMinor: body.chargesMinor ?? (analysisFeesMinor > 0 ? analysisFeesMinor : null),
        financedBalanceMinor: body.financedBalanceMinor ?? null,
        totalMinor: body.totalMinor ?? Number(totalAmountMinor),
      },
      analysis: {
        installments: body.analysis?.installments ?? body.installments?.map((item) => ({
          date: item.date,
          description: item.description,
          amount: item.amountMinor / 100,
          current: item.installment ? Number(item.installment.split('/')[0]) || undefined : undefined,
          total: item.installment ? Number(item.installment.split('/')[1]) || undefined : undefined,
        })),
        fees: body.analysis?.fees ?? [],
      },
      source: 'pdf_invoice',
    })

    await db.delete(cardInvoiceComponents).where(eq(cardInvoiceComponents.cardInvoiceId, cardInvoiceId))
    if (componentRows.length > 0) {
      await db.insert(cardInvoiceComponents).values(componentRows)
    }

    console.log('[invoices/import] before syncCardInvoiceSemanticFields', {
      cardInvoiceId,
      invoiceMonth: body.invoiceMonth,
    })
    await syncCardInvoiceSemanticFields(db, cardInvoiceId)
    console.log('[invoices/import] after syncCardInvoiceSemanticFields', {
      cardInvoiceId,
      invoiceMonth: body.invoiceMonth,
    })

    // -------------------------------------------------------------------------
    // 4. Insert each purchase into card_transactions
    //    IMPORTANT: card_transactions does NOT affect cash flow.
    //    Only the invoice payment (in `transactions`) affects the bank account.
    // -------------------------------------------------------------------------
    let imported = 0
    let skipped = 0
    const settlementTargetsToSync = new Set<number>()
    const seenImportKeys = new Set<string>()

    const buildCanonicalImportKey = (input: {
      date: string
      competencyMonth?: string | null
      normalizedDescription: string
      amountMinor: bigint
      installment?: string | null
      installmentGroupId?: string | null
    }) => [
      input.date,
      input.competencyMonth ?? '',
      input.normalizedDescription,
      input.amountMinor.toString(),
      input.installment ?? '',
      input.installmentGroupId ?? '',
    ].join('|')

    // Parcels are more specific than the umbrella transaction list.
    // Seed the dedupe set with installments so the same installment does not
    // get inserted twice if the AI pipeline also surfaced it in transactions.
    for (const tx of body.installments ?? []) {
      const amountMinor = BigInt(tx.amountMinor)
      const { fingerprint, normalizedDescription } = buildFingerprintFromRaw({
        competencyMonth: tx.competencyMonth,
        amountMinor,
        rawDescription: tx.description,
      })

      let installmentTotal: number | null = null
      let installmentGroupId: string | null = null
      if (tx.installment) {
        const parts = tx.installment.split('/')
        installmentTotal = parseInt(parts[1], 10) || null
        installmentGroupId = `${fingerprint}-${installmentTotal}`
      }

      seenImportKeys.add(buildCanonicalImportKey({
        date: tx.date,
        competencyMonth: tx.competencyMonth,
        normalizedDescription,
        amountMinor,
        installment: tx.installment ?? '',
        installmentGroupId,
      }))
    }

    for (const tx of body.transactions) {
      const occurredAt = new Date(assertValidDate(parseInputDate(tx.date, 'transaction.date'), 'transaction.date').getTime())
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
      const importKey = buildCanonicalImportKey({
        date: tx.date,
        competencyMonth: tx.competencyMonth,
        normalizedDescription,
        amountMinor,
        installment: tx.installment ?? '',
        installmentGroupId,
      })
      if (seenImportKeys.has(importKey)) {
        skipped++
        continue
      }
      seenImportKeys.add(importKey)
      const historicalCategory =
        tx.categoryId
          ? { categoryId: tx.categoryId, assignedBy: 'user' }
          : historyMap.get(normalizedDescription)
            ?? (installmentGroupId ? installmentHistoryMap.get(installmentGroupId) : undefined)

      try {
        console.log('[invoices/import] card_transaction payload', {
          invoiceMonth: body.invoiceMonth,
          txDate: tx.date,
          occurredAt: describeDateValue(occurredAt),
          amountMinor: amountMinor.toString(),
          description: tx.description,
          installment: tx.installment ?? null,
        })

        const result = await db.insert(cardTransactions).values({
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
          categoryId: historicalCategory?.categoryId
            ?? aiCategoryMap.get(normalizedDescription)?.subcategoryId
            ?? aiCategoryMap.get(normalizedDescription)?.categoryId
            ?? null,
          providerCategory: tx.providerCategory ?? null,
          providerCategoryRaw: tx.providerCategoryRaw ?? null,
          categoryAssignedBy: tx.categoryId
            ? 'user'
            : historicalCategory
              ? historicalCategory.assignedBy
              : aiCategoryMap.get(normalizedDescription)
                ? 'ai'
                : null,
          installmentNumber,
          installmentTotal,
          installmentGroupId,
          fingerprint,
          isReconciled: false,
        })
        const insertedCardTransactionId = Number((result as { insertId?: number }).insertId || 0)

        if (tx.settlesInvoiceId && insertedCardTransactionId > 0) {
          const [targetInvoice] = await db
            .select({
              id: cardInvoices.id,
            })
            .from(cardInvoices)
            .where(
              and(
                eq(cardInvoices.id, tx.settlesInvoiceId),
                eq(cardInvoices.userId, owner.id),
              ),
            )
            .limit(1)

          if (targetInvoice) {
            await db.insert(cardInvoiceSettlements).values({
              userId: owner.id,
              sourceCardTransactionId: insertedCardTransactionId,
              targetCardInvoiceId: targetInvoice.id,
              allocatedAmountMinor: amountMinor,
              currencyCode: 'BRL',
              settlementDate: occurredAt,
              source: 'pdf_invoice',
              matchedBy: 'user_selection',
              confidenceScore: '1.0000',
            })
            settlementTargetsToSync.add(targetInvoice.id)
          }
        }

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

    const installmentEntries = body.installments ?? []
    for (const tx of installmentEntries) {
      const occurredAt = new Date(assertValidDate(parseInputDate(tx.date, 'transaction.date'), 'transaction.date').getTime())
      const amountMinor = BigInt(tx.amountMinor)
      const { fingerprint, normalizedDescription } = buildFingerprintFromRaw({
        competencyMonth: tx.competencyMonth,
        amountMinor,
        rawDescription: tx.description,
      })

      let installmentNumber: number | null = null
      let installmentTotal: number | null = null
      let installmentGroupId: string | null = null
      if (tx.installment) {
        const parts = tx.installment.split('/')
        installmentNumber = parseInt(parts[0], 10) || null
        installmentTotal = parseInt(parts[1], 10) || null
        installmentGroupId = `${fingerprint}-${installmentTotal}`
      }
      const importKey = buildCanonicalImportKey({
        date: tx.date,
        competencyMonth: tx.competencyMonth,
        normalizedDescription,
        amountMinor,
        installment: tx.installment ?? '',
        installmentGroupId,
      })
      if (seenImportKeys.has(importKey)) {
        skipped++
        continue
      }
      seenImportKeys.add(importKey)
      const historicalCategory =
        tx.categoryId
          ? { categoryId: tx.categoryId, assignedBy: 'user' }
          : historyMap.get(normalizedDescription)
            ?? (installmentGroupId ? installmentHistoryMap.get(installmentGroupId) : undefined)

      try {
        console.log('[invoices/import] installment payload', {
          invoiceMonth: body.invoiceMonth,
          txDate: tx.date,
          occurredAt: describeDateValue(occurredAt),
          amountMinor: amountMinor.toString(),
          description: tx.description,
          installment: tx.installment ?? null,
        })

        await db.insert(cardTransactions).values({
          userId: owner.id,
          cardInvoiceId,
          source: 'pdf_invoice',
          dataState: 'consolidated',
          movementType: 'card_purchase',
          movementSubtype: 'installment',
          amountMinor,
          currencyCode: 'BRL',
          occurredAt,
          competencyMonth: tx.competencyMonth,
          description: tx.description,
          normalizedDescription,
          categoryId: historicalCategory?.categoryId
            ?? aiCategoryMap.get(normalizedDescription)?.subcategoryId
            ?? aiCategoryMap.get(normalizedDescription)?.categoryId
            ?? null,
          providerCategory: null,
          providerCategoryRaw: null,
          categoryAssignedBy: tx.categoryId
            ? 'user'
            : historicalCategory
              ? historicalCategory.assignedBy
              : aiCategoryMap.get(normalizedDescription)
                ? 'ai'
                : null,
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
          console.error('[import] installment insert error:', msg)
          skipped++
        }
      }
    }

    for (const invoiceId of settlementTargetsToSync) {
      await syncCardInvoiceSemanticFields(db, invoiceId)
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
            const [projectedTx] = await db
              .select({ id: cardTransactions.id })
              .from(cardTransactions)
              .where(
                and(
                  eq(cardTransactions.receiptDocumentId, note.id),
                  eq(cardTransactions.dataState, 'projected'),
                ),
              )
              .limit(1)

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

            if (projectedTx && projectedTx.id !== match.id) {
              await db.delete(cardTransactions).where(eq(cardTransactions.id, projectedTx.id))
            }
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

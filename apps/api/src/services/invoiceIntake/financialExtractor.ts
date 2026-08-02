import { z } from 'zod'
import { callStructuredJsonAI } from './aiClient.js'
import type { FinancialExtractionResult } from './types.js'

const INVOICE_EXTRACTION_TIMEOUT_MS = 60000

const moneySchema = z.union([z.number(), z.string()])
const installmentIndexSchema = z.preprocess((value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'))
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  return value
}, z.number().int().nonnegative().optional())

const financialResponseSchema = z.object({
  document_type: z.literal('fatura_cartao'),
  institution: z.string().min(1),
  card_last4: z.string().default(''),
  billing_period: z.preprocess((val) => {
    if (typeof val !== 'string') return val
    const trimmed = val.trim()
    // Aceitar YYYY-MM directamente
    if (/^\d{4}-\d{2}$/.test(trimmed)) return trimmed
    // Converter MM/YYYY → YYYY-MM
    const mmyyyy = trimmed.match(/^(\d{2})\/(\d{4})$/)
    if (mmyyyy) return `${mmyyyy[2]}-${mmyyyy[1]}`
    // Converter YYYY/MM → YYYY-MM
    const yyyymm = trimmed.match(/^(\d{4})\/(\d{2})$/)
    if (yyyymm) return `${yyyymm[1]}-${yyyymm[2]}`
    // Converter MM-YYYY → YYYY-MM
    const mmyyyy2 = trimmed.match(/^(\d{2})-(\d{4})$/)
    if (mmyyyy2) return `${mmyyyy2[2]}-${mmyyyy2[1]}`
    return trimmed
  }, z.string().regex(/^\d{4}-\d{2}$/).or(z.string().max(0))).default(''),
  due_date: z.string().min(1),
  total_amount: moneySchema.optional(),
  transactions: z.array(
    z.object({
      date: z.string().min(1).optional(),
      description: z.string().min(1).optional(),
      amount: moneySchema.optional(),
      installment: z.string().optional(),
      category: z.string().optional(),
      country: z.string().optional(),
      originalAmountMinor: moneySchema.optional(),
      originalCurrencyCode: z.string().optional(),
      exchangeRate: z.number().optional(),
    })
  ).default([]),
  installments: z.array(
    z.object({
      description: z.string().min(1).optional(),
      amount: moneySchema.optional(),
      current: installmentIndexSchema,
      total: installmentIndexSchema,
      date: z.string().min(1).optional(),
    })
  ).default([]),
  fees: z.array(
    z.object({
      description: z.string().min(1).optional(),
      amount: moneySchema.optional(),
      kind: z.string().optional(),
    })
  ).default([]),
  payments: z.array(
    z.object({
      date: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().min(1).optional()),
      description: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().min(1).optional()),
      amount: moneySchema.optional(),
      source: z.string().optional(),
    })
  ).default([]),
  warnings: z.array(z.string()).default([]),
})

type FinancialResponse = z.infer<typeof financialResponseSchema>

function normalizeMoney(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const trimmed = String(value).trim()
  if (!trimmed) return 0
  const normalized = trimmed
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeBillingPeriod(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}$/.test(trimmed)) return trimmed

  const monthYear = trimmed.match(/^(\d{2})\/(\d{4})$/)
  if (monthYear) {
    return `${monthYear[2]}-${monthYear[1]}`
  }

  const yearMonth = trimmed.match(/^(\d{4})[/.-](\d{2})$/)
  if (yearMonth) {
    return `${yearMonth[1]}-${yearMonth[2]}`
  }

  return ''
}

function normalizeDate(value: unknown, fallbackBillingPeriod?: string): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed

  const dayMonthYear = trimmed.match(/^(\d{2})[/.-](\d{2})[/.-](\d{4})$/)
  if (dayMonthYear) {
    return `${dayMonthYear[3]}-${dayMonthYear[2]}-${dayMonthYear[1]}`
  }

  const yearMonthDay = trimmed.match(/^(\d{4})[/.-](\d{2})[/.-](\d{2})$/)
  if (yearMonthDay) {
    return `${yearMonthDay[1]}-${yearMonthDay[2]}-${yearMonthDay[3]}`
  }

  const monthYear = trimmed.match(/^(\d{2})[/.-](\d{4})$/)
  if (monthYear) {
    return `${monthYear[2]}-${monthYear[1]}-01`
  }

  const monthDay = trimmed.match(/^(\d{2})[/.-](\d{2})$/)
  if (monthDay && fallbackBillingPeriod) {
    return `${fallbackBillingPeriod.slice(0, 4)}-${monthDay[2]}-${monthDay[1]}`
  }

  const parsed = new Date(trimmed)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10)
  }

  return ''
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function extractCardLast4FromAscii(asciiText: string): string {
  const normalizedText = asciiText
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  const patterns = [
    /\[CARD_LAST4:(\d{4})\]/i,
    /(?:cartao|card|titular|final)[\s\S]{0,120}?\b(?:\d{4}|[xX*#•]{4})(?:[.\s-]*(?:\d{4}|[xX*#•]{4})){2}[.\s-]*(\d{4})\b/i,
    /\b(?:\d{4}|[xX*#•]{4})(?:[.\s-]*(?:\d{4}|[xX*#•]{4})){2}[.\s-]*(\d{4})\b/,
    /\b(?:\d{4}[.\s-]){3}(\d{4})\b/,
    /\bfinal\s*(\d{4})\b/i,
  ]

  for (const pattern of patterns) {
    const match = normalizedText.match(pattern)
    const last4 = match?.[1]
    if (last4) return last4
  }

  return ''
}

function normalizeInstitutionKey(value: string): string {
  const normalized = normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()

  const mapping: Record<string, string> = {
    itau: 'itau',
    'itau unibanco': 'itau',
    credicard: 'itau',
    'banco do brasil': 'bb',
    bb: 'bb',
    ourocard: 'bb',
    bradesco: 'bradesco',
    carrefour: 'carrefour',
    'banco csf': 'carrefour',
    'banco csf s.a.': 'carrefour',
    picpay: 'picpay',
    nubank: 'nubank',
    santander: 'santander',
    caixa: 'caixa',
    inter: 'inter',
  }

  return mapping[normalized] ?? normalized
}

function detectInstitutionHintFromAscii(asciiText: string): string | null {
  const topLines = asciiText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 60)

  for (const line of topLines) {
    const normalized = line
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()

    // OUROCARD é produto exclusivo do Banco do Brasil — prioridade máxima
    if (/ourocard/i.test(normalized)) return 'bb'
    if (/(?:banco do brasil|\bbb\b|pag\s*bb\b|app\s+bb\b)/i.test(normalized)) return 'bb'
    // Credicard é emitida pelo Itaú
    if (/credicard/i.test(normalized)) return 'itau'
    if (/(?:itau\s+unibanco|\bita[uú]\b)/i.test(normalized)) return 'itau'
    if (/bradesco/i.test(normalized)) return 'bradesco'
    // Banco CSF S.A. é o emissor do Carrefour
    if (/(?:carrefour|banco\s+csf)/i.test(normalized)) return 'carrefour'
    if (/picpay/i.test(normalized)) return 'picpay'
    if (/nubank/i.test(normalized)) return 'nubank'
    if (/santander/i.test(normalized)) return 'santander'
    if (/\bcaixa\b/i.test(normalized)) return 'caixa'
    if (/\binter\b/i.test(normalized)) return 'inter'
  }

  return null
}

function normalizeSummaryKeyText(value: string): string {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

function normalizeForClassification(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
  .trim()
  .toUpperCase()
}

function normalizeLineForParsing(value: string): string {
  return value
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeParsedDescription(value: string): string {
  return value
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:.-]+|[\s:.-]+$/g, '')
    .trim()
}

function looksLikeStructuralNoiseDescription(description: string): boolean {
  const normalized = normalizeForClassification(description)
  if (!normalized) return true
  if (!/[A-ZÀ-Ÿ]/.test(normalized)) return true

  const stripped = normalized
    .replace(/\b(?:DATA|OPERACAO|VALOR|ESTABELECIMENTO|US\$|R\$|SUBTOTAL|TOTAL|TARIFAS?|TRANSA[CÇ][ÕO]ES?|INTERNACIONAIS?|NACIONAIS?|PICPAY|CARD)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!stripped) return true
  if (!/[A-ZÀ-Ÿ]{3,}/.test(stripped)) return true

  return false
}

function parseInstallmentMeta(description: string): {
  description: string
  current?: number
  total?: number
} {
  const match = description.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/)
  if (!match) return { description }
  const current = Number(match[1])
  const total = Number(match[2])
  return {
    description: description.replace(match[0], ' ').replace(/\s+/g, ' ').trim(),
    current: Number.isFinite(current) ? current : undefined,
    total: Number.isFinite(total) ? total : undefined,
  }
}

function splitLineByDates(line: string): string[] {
  const matches = [...line.matchAll(/\b\d{2}\/\d{2}\b(?=\s+[A-ZÀ-Ÿ*])/g)]
  if (matches.length === 0) return [line]
  if (matches.length === 1) {
    const start = matches[0].index ?? 0
    const segment = line.slice(start).trim()
    return segment ? [segment] : [line]
  }

  const segments: string[] = []
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index ?? 0
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? line.length) : line.length
    const segment = line.slice(start, end).trim()
    if (segment) segments.push(segment)
  }
  return segments.length > 0 ? segments : [line]
}

function shouldSkipFinancialLine(line: string): boolean {
  return /^(?:TOTAL|LIMITE|JUROS M[ÁA]XIMOS|SIMULA[CÇ][AÃ]O|AO CONTRATAR|VALORES DEVIDOS|PR[ÓO]XIMA FATURA|DEMAIS FATURAS|TOTAL PARA PR[ÓO]XIMAS FATURAS|LIMITES DE CR[ÉE]DITO|ESSES S[ÃA]O OS SEUS LIMITES|ENCARGOS COBRADOS|NOVO TETO|TETO|JUROS DO ROTATIVO|JUROS DE MORA|MULTA POR ATRASO|VALOR EM R\$|D[ÓO]LAR DE CONVERS[ÃA]O|LAN[CÇ]AMENTOS?\s+NO\s+CART[AÃ]O|LAN[CÇ]AMENTOS?\s+PRODUTOS?\s+E\s+SERVI[CÇ]OS|LAN[CÇ]AMENTOS?\s+INTERNACIONAIS)/i.test(line)
}

function parseRecordSegment(
  segment: string,
  billingPeriod: string,
  section: 'payments' | 'purchases' | 'international' | 'fees' | 'installments' | null,
): {
  date: string
  description: string
  amount: number
  installment?: string
  country?: string
  originalAmountMinor?: number
  originalCurrencyCode?: string
  exchangeRate?: number
} | null {
  const line = normalizeLineForParsing(segment)
  const dateMatch = line.match(/^(\d{2}\/\d{2}(?:\/\d{4})?)\s+(.*)$/)
  if (!dateMatch) return null

  const date = normalizeDate(dateMatch[1], billingPeriod)
  if (!date) return null

  const rest = dateMatch[2].trim()
  if (!rest) return null

  const hasInternationalMarker = /\bUSD\b|D[oó]lar|US\$/i.test(rest)
  const commonAmountTail = '(?:\\s+USD\\s+[\\d.,]+)?(?:\\s+D[oó]lar.*)?(?:\\s+.*)?$'

  if (section === 'payments' || looksLikePaymentEntry(normalizeForClassification(rest))) {
    const paymentMatch = rest.match(new RegExp(`^(.*?)(?:\\s+(-?[\\d.,]+))${commonAmountTail}`, 'i'))
    if (!paymentMatch) return null
    return {
      date,
      description: normalizeText(paymentMatch[1]),
      amount: normalizeMoney(paymentMatch[2]),
    }
  }

  if (hasInternationalMarker) {
    const internationalMatch = rest.match(new RegExp(`^(.*?)(?:\\s+(\\d{1,2}\\/\\d{1,2}))?\\s+(-?[\\d.,]+)${commonAmountTail}`, 'i'))
    if (!internationalMatch) return null
    const installment = internationalMatch[2]
    const description = normalizeText(internationalMatch[1])
    if (!description || /^(?:D[oó]lar|C[âa]mbio|CAMBIO)\s*:?$/i.test(description)) {
      return null
    }
    return {
      date,
      description,
      amount: normalizeMoney(internationalMatch[3]),
      installment,
      country: 'international',
    }
  }

  const installmentAwareMatch = rest.match(/^(.*?)(?:\s+(\d{1,2}\/\d{1,2}))?\s+(-?[\d.,]+)(?:\s+.*)?$/i)
  if (!installmentAwareMatch) return null

  const description = normalizeText(installmentAwareMatch[1])
  const installment = installmentAwareMatch[2] || undefined
  const amount = normalizeMoney(installmentAwareMatch[3])
  if (!description) return null

  if (section === 'installments') {
    return { date, description, amount, installment, country: undefined }
  }

  if (section === 'fees') {
    return { date, description, amount, installment, country: undefined }
  }

  return { date, description, amount, installment, country: undefined }
}

const INTERNATIONAL_CURRENCY_CODES = ['USD', 'EUR', 'GBP', 'JPY', 'ARS', 'CLP', 'UYU', 'PYG', 'BOB', 'PEN', 'COP', 'MXN']
const INTERNATIONAL_NOISE_RE = /^(?:D[oó]lar(?:\s+de\s+Convers[aã]o)?|C[âa]mbio(?:\s+do\s+dia)?|US\$|R\$|USD|EUR|GBP|JPY|ARS|CLP|UYU|PYG|BOB|PEN|COP|MXN|CAMBIO|CÂMBIO|DATA|ESTABELECIMENTO|OPERA[CÇ][ÃA]O|VALOR|TRANSA[CÇ][ÕO]ES?\s+INTERNACIONAIS?|TARIFAS|PICPAY\s+CARD|SUBTOTAL|TOTAL)$/i

type PendingInternationalRecord = {
  date: string
  lines: string[]
}

function normalizeInternationalDescriptionLine(line: string): string {
  return line
    .replace(/^\d{2}\/\d{2}(?:\/\d{4})?\s*/i, '')
    .replace(/\bD[oó]lar(?:\s+de\s+Convers[aã]o)?\s*[:\-]?\s*[\d.,]*/gi, ' ')
    .replace(/\bC[âa]mbio(?:\s+do\s+dia)?\s*[:\-]?\s*R\$\s*[\d.,]*/gi, ' ')
    .replace(/\bR\$\s*[\d.,]+/gi, ' ')
    .replace(/\b[\d.,]+\s*(?:USD|EUR|GBP|JPY|ARS|CLP|UYU|PYG|BOB|PEN|COP|MXN)\b/gi, ' ')
    .replace(/\b(?:USD|EUR|GBP|JPY|ARS|CLP|UYU|PYG|BOB|PEN|COP|MXN)\s*[\d.,]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:.-]+|[\s:.-]+$/g, '')
    .trim()
}

function isLikelyInternationalMerchantLine(line: string): boolean {
  if (!line) return false
  if (/\b(?:\d{2}\/\d{2}(?:\/\d{4})?|R\$|US\$|USD|EUR|GBP|JPY|ARS|CLP|UYU|PYG|BOB|PEN|COP|MXN|D[oó]lar|C[âa]mbio|IOF|JUROS|ROTATIVO|PARCELA|SALDO|TOTAL|SUBTOTAL|TARIFAS?|TRANSA[CÇ][ÕO]ES?|PICPAY\s+CARD|LEONARDO\s+B\s+BAPTISTA)\b/i.test(line)) {
    return false
  }
  return /[A-ZÀ-Ÿ]/i.test(line)
}

function extractInternationalMerchantEntries(
  asciiText: string,
  billingPeriod: string,
): FinancialExtractionResult['transactions'] {
  const lines = asciiText.split(/\r?\n/).map((line) => normalizeLineForParsing(line))
  const transactions: FinancialExtractionResult['transactions'] = []

  for (let index = 0; index < lines.length - 1; index += 1) {
    const merchant = lines[index]
    if (!isLikelyInternationalMerchantLine(merchant)) continue

    const dateLine = lines[index + 1]
    const dateMatch = dateLine.match(/^(\d{2}\/\d{2}(?:\/\d{4})?)\s+(.*)$/)
    if (!dateMatch) continue

    const payload = dateMatch[2].trim()
    if (!/\b(?:D[oó]lar|US\$|USD)\b/i.test(payload)) continue

    const numericTokens = payload.match(/-?[\d]{1,3}(?:\.[\d]{3})*,\d{2}|-?\d+,\d{2}/g) ?? []
    if (numericTokens.length < 1) continue

    const amount = normalizeMoney(numericTokens.at(-1))
    if (!amount || amount <= 0) continue

    const originalAmountMinor = numericTokens.length >= 2 ? normalizeMoney(numericTokens[0]) : undefined
    const originalCurrencyCode = 'USD'
    const exchangeLine = lines[index + 2] ?? ''
    const exchangeMatch = exchangeLine.match(/C[âa]mbio(?:\s+.*)?R\$\s*([\d.,]+)/i)
    const exchangeRate = exchangeMatch ? normalizeMoney(exchangeMatch[1]) : undefined

    transactions.push({
      date: normalizeDate(dateMatch[1], billingPeriod) || dateMatch[1],
      description: normalizeText(merchant),
      amount,
      category: undefined,
      country: 'international',
      originalAmountMinor,
      originalCurrencyCode,
      exchangeRate,
    })
  }

  return transactions
}

function looksLikeInternationalFee(description: string): boolean {
  return /\b(?:COMPRA INTERNACIONAL|DIARIO ROTATIVO|IOF|JUROS|TARIFA|TARIFAS|C[âa]MBIO|D[ÓO]LAR)\b/i.test(description)
}

function parseInternationalBlock(
  lines: string[],
  billingPeriod: string,
): {
  date: string
  description: string
  amount: number
  installment?: string
  country?: string
  originalAmountMinor?: number
  originalCurrencyCode?: string
  exchangeRate?: number
} | null {
  const normalized = lines
    .map((line) => normalizeLineForParsing(line))
    .filter(Boolean)

  if (normalized.length === 0) return null

  const dateIndex = normalized.findIndex((line) => /^(\d{2}\/\d{2}(?:\/\d{4})?)\s*(.*)$/.test(line))
  if (dateIndex === -1) return null

  const dateMatch = normalized[dateIndex].match(/^(\d{2}\/\d{2}(?:\/\d{4})?)\s*(.*)$/)
  if (!dateMatch) return null

  const date = normalizeDate(dateMatch[1], billingPeriod)
  if (!date) return null

  const payloadLines = [
    ...normalized.slice(0, dateIndex),
    dateMatch[2].trim(),
    ...normalized.slice(dateIndex + 1),
  ].filter(Boolean)
  let descriptionParts: string[] = []
  let amountMinor: number | undefined
  let originalAmountMinor: number | undefined
  let originalCurrencyCode: string | undefined
  let exchangeRate: number | undefined
  let installment: string | undefined

  for (const part of payloadLines) {
    if (!part) continue

    const exchangeMatch = part.match(/D[oó]lar\s*de\s*Convers[aã]o\s*R\$\s*([\d.,]+)/i)
      ?? part.match(/C[âa]mbio\s*do\s*dia\s*R\$\s*([\d.,]+)/i)
      ?? part.match(/C[âa]mbio\s*R\$\s*([\d.,]+)/i)
    if (exchangeMatch) {
      exchangeRate = normalizeMoney(exchangeMatch[1])
      continue
    }

    const dollarLineMatch = part.match(/D[oó]lar\s*:\s*([\d.,]+)(?:\s+[\d.,]+)?\s+([\d.,]+)$/i)
      ?? part.match(/D[oó]lar\s+([\d.,]+)(?:\s+[\d.,]+)?\s+([\d.,]+)$/i)
    if (dollarLineMatch) {
      originalAmountMinor = normalizeMoney(dollarLineMatch[1])
      originalCurrencyCode = 'USD'
      amountMinor = normalizeMoney(dollarLineMatch[2])
      continue
    }

    const combinedAmountMatch = part.match(/\b([\d.,]+)\s+(USD|EUR|GBP|JPY|ARS|CLP|UYU|PYG|BOB|PEN|COP|MXN)\s+([\d.,]+)\b/i)
    if (combinedAmountMatch) {
      originalAmountMinor = normalizeMoney(combinedAmountMatch[1])
      originalCurrencyCode = combinedAmountMatch[2].toUpperCase()
      amountMinor = normalizeMoney(combinedAmountMatch[3])
      continue
    }

    const originalOnlyMatch = part.match(/\b([\d.,]+)\s+(USD|EUR|GBP|JPY|ARS|CLP|UYU|PYG|BOB|PEN|COP|MXN)\b/i)
    if (originalOnlyMatch) {
      originalAmountMinor = normalizeMoney(originalOnlyMatch[1])
      originalCurrencyCode = originalOnlyMatch[2].toUpperCase()
      continue
    }

    const brlMatch = part.match(/R\$\s*([\d.,]+)/i)
    if (brlMatch) {
      amountMinor = normalizeMoney(brlMatch[1])
      continue
    }

    const installmentMatch = part.match(/\b(\d{1,2}\/\d{1,2})\b/)
    if (installmentMatch) {
      installment = installmentMatch[1]
    }

    const cleaned = normalizeInternationalDescriptionLine(part)
    if (cleaned && !INTERNATIONAL_NOISE_RE.test(cleaned)) {
      descriptionParts.push(cleaned)
    }
  }

  if (!amountMinor && originalAmountMinor && exchangeRate) {
    amountMinor = Math.round(originalAmountMinor * exchangeRate)
  }

  const description = normalizeText(descriptionParts.join(' '))
  if (!description) return null
  if (looksLikeStructuralNoiseDescription(description)) return null
  if (!amountMinor || amountMinor <= 0) return null

  return {
    date,
    description,
    amount: amountMinor,
    installment,
    country: 'international',
    originalAmountMinor,
    originalCurrencyCode,
    exchangeRate,
  }
}

type LocalFinancialExtraction = {
  transactions: FinancialExtractionResult['transactions']
  installments: FinancialExtractionResult['installments']
  fees: FinancialExtractionResult['fees']
  payments: FinancialExtractionResult['payments']
  warnings: string[]
}

export function extractFinancialEntriesFromAscii(
  asciiText: string,
  billingPeriod: string,
): LocalFinancialExtraction {
  const lines = asciiText.split(/\r?\n/)
  const transactions: FinancialExtractionResult['transactions'] = []
  const installments: FinancialExtractionResult['installments'] = []
  const fees: FinancialExtractionResult['fees'] = []
  const payments: FinancialExtractionResult['payments'] = []
  const warnings: string[] = []
  let section: 'payments' | 'purchases' | 'international' | 'fees' | 'installments' | null = null
  let pendingInternational: PendingInternationalRecord | null = null
  let pendingInternationalHeader: string | null = null

  const flushPendingInternational = () => {
    if (!pendingInternational) return
    const parsed = parseInternationalBlock(pendingInternational.lines, billingPeriod)
    pendingInternational = null
    pendingInternationalHeader = null
    if (!parsed) return
    transactions.push({
      date: parsed.date,
      description: parsed.description,
      amount: parsed.amount,
      installment: parsed.installment,
      category: undefined,
      country: parsed.country,
      originalAmountMinor: parsed.originalAmountMinor,
      originalCurrencyCode: parsed.originalCurrencyCode,
      exchangeRate: parsed.exchangeRate,
    })
  }

  for (const rawLine of lines) {
    const line = normalizeLineForParsing(rawLine)
    if (!line) continue
    if (line.startsWith('===== PAGE')) continue
    if (shouldSkipFinancialLine(line)) continue

    if (/pagamentos\s+efetuados/i.test(line)) {
      flushPendingInternational()
      section = 'payments'
      continue
    }
    if (/lan[cç]amentos\s+internacionais/i.test(line) || /transa[cç][oõ]es?\s+internacionais/i.test(line)) {
      flushPendingInternational()
      section = 'international'
      pendingInternationalHeader = null
      continue
    }
    if (/lan[cç]amentos\s+nacionais/i.test(line) || /transa[cç][oõ]es?\s+nacionais/i.test(line)) {
      flushPendingInternational()
      section = 'purchases'
      pendingInternationalHeader = null
      continue
    }
    if (/lan[cç]amentos:\s*produtos\s+e\s+servi[cç]os/i.test(line)) {
      flushPendingInternational()
      section = 'fees'
      continue
    }
    if (/compras\s+parceladas\s*-\s*pr[óo]ximas\s+faturas/i.test(line)) {
      flushPendingInternational()
      section = 'installments'
      continue
    }
    if (/lan[cç]amentos:\s*compras\s+e\s+saques/i.test(line) || /lan[cç]amentos\s+no\s+cart[aã]o/i.test(line)) {
      flushPendingInternational()
      section = 'purchases'
      continue
    }

    if (section === 'international') {
      if (/^total\s*(?:dos?\s*)?lan[cç]amentos?/i.test(line) || /^subtotal/i.test(line)) {
        flushPendingInternational()
        section = null
        continue
      }

      if (/^\d{2}\/\d{2}(?:\/\d{4})?\b/.test(line)) {
        flushPendingInternational()
        pendingInternational = {
          date: '',
          lines: pendingInternationalHeader ? [pendingInternationalHeader, line] : [line],
        }
        pendingInternationalHeader = null
        continue
      }

      if (pendingInternational) {
        pendingInternational.lines.push(line)
        continue
      }

      if (!/^(?:tarifas|data|estabelecimento|valor|transa[cç][oõ]es?\s+(?:internacionais|nacionais)|opera[cç][oõ]es?\s+de\s+cr[eé]dito\s+contratados?|subtotal|total|limite|vencimento|fechamento|pagamento|saldo|fatura|juros|iof|parcela|parcelamento)/i.test(line)) {
        pendingInternationalHeader = line
      }

      continue
    }

    const segments = splitLineByDates(line)

    for (const segment of segments) {
      const parsed = parseRecordSegment(segment, billingPeriod, section)
      if (!parsed) continue

      const description = normalizeParsedDescription(parsed.description)
      if (looksLikeStructuralNoiseDescription(description)) continue
      const amount = parsed.amount
      const date = parsed.date
      const country = parsed.country
      const installmentMeta = parseInstallmentMeta(description)
      const normalizedDescription = normalizeParsedDescription(installmentMeta.description || description)
      if (looksLikeStructuralNoiseDescription(normalizedDescription)) continue
      const installmentCode = installmentMeta.current && installmentMeta.total
        ? `${installmentMeta.current}/${installmentMeta.total}`
        : parsed.installment

      const classification = normalizeForClassification(normalizedDescription)
      const parsedInstallmentMeta = parsed.installment ? parseInstallmentMeta(parsed.installment) : { description: '' }

      if (looksLikePaymentEntry(classification)) {
        payments.push({
          date,
          description: normalizedDescription,
          amount,
          source: country === 'international' ? 'international' : undefined,
        })
        continue
      }

      if (looksLikeFeeEntry(classification)) {
        fees.push({
          description: normalizedDescription,
          amount,
          kind: country === 'international' ? 'câmbio' : undefined,
        })
        continue
      }

      if (parsed.installment || installmentMeta.current && installmentMeta.total) {
        installments.push({
          description: normalizedDescription,
          amount,
          current: installmentMeta.current ?? parsedInstallmentMeta.current,
          total: installmentMeta.total ?? parsedInstallmentMeta.total,
          date,
        })
        continue
      }

      if (looksLikeInstallmentEntry(classification)) {
        installments.push({
          description: normalizedDescription,
          amount,
          current: installmentMeta.current ?? parsedInstallmentMeta.current,
          total: installmentMeta.total ?? parsedInstallmentMeta.total,
          date,
        })
        continue
      }

      if (country === 'international') {
        transactions.push({
          date,
          description: normalizedDescription,
          amount,
          installment: installmentCode,
          category: undefined,
          country: 'international',
          originalAmountMinor: parsed.originalAmountMinor,
          originalCurrencyCode: parsed.originalCurrencyCode,
          exchangeRate: parsed.exchangeRate,
        })
        continue
      }

      transactions.push({
        date,
        description: normalizedDescription,
        amount,
        installment: installmentCode,
        category: undefined,
        country: undefined,
      })
    }
  }

  flushPendingInternational()

  if (transactions.length === 0 && installments.length === 0 && fees.length === 0 && payments.length === 0) {
    warnings.push('IA não encontrou lançamentos estruturais na ASCII.')
  }

  return {
    transactions,
    installments,
    fees,
    payments,
    warnings,
  }
}

function looksLikeFeeEntry(description: string): boolean {
  return /\b(?:IOF|ENCARGOS?|JUROS?|MORA|MORATORIO|MORAT[ÓO]RIO|ANUIDADE|MENSALIDADE|TARIFA|TARIFAS?|TAXAS?|ROTATIVO|D[ÓO]LAR|C[ÂA]MBIO|CAMBIO)\b/.test(description)
}

function looksLikeInstallmentEntry(description: string): boolean {
  return /\b(?:PARC(?:ELA|ELAS|ELAMENTO|\.?)?|PARCELADO|PARCELAMENTO|CR[ÉE]DITO\s+PARC|CREDITO\s+PARC|PARC\s+A?UTOM[ÁA]TICO|FINANCIAM(?:ENTO|ENTO)?|PRINCIPAL\s*\(|JUROS\s*\()/i.test(description)
}

function looksLikePaymentEntry(description: string): boolean {
  return /\b(?:PAGAMENTO|PAGAMENTOS|PAGAMENTO\s+EFETUADO|PIX|TRANSFER[ÊE]NCIA|TRANSFERENCIA|ESTORNO|REEMBOLSO|RESTITUI[ÇC][AÃ]O)\b/.test(description)
}

function looksLikeInvoiceTotalEntry(description: string): boolean {
  return /\bTOTAL\s+(?:DESTA|DA)\s+FATURA\b/i.test(description)
}

function buildFinancialEntryKey(input: {
  date?: string
  description: string
  amount: number
  installment?: string | null
  kind?: string | null
  source?: string | null
  current?: number | null
  total?: number | null
}): string {
  return [
    input.date ?? '',
    normalizeSummaryKeyText(input.description),
    normalizeMoney(input.amount),
    input.installment ?? '',
    input.kind ?? '',
    input.source ?? '',
    input.current ?? '',
    input.total ?? '',
  ].join('|')
}

type FinancialPromptMode = 'standard' | 'strict'

function buildFinancialExtractionPrompt(mode: FinancialPromptMode, institutionHint: string | null): string {
  const baseInstructions = [
    'Voce recebe um ASCII estrutural de uma fatura de cartão já totalmente sanitizado.',
    'Responda SOMENTE JSON canônico no formato:',
    '{"document_type":"fatura_cartao","institution":"Itau","card_last4":"2933","billing_period":"2026-07","due_date":"2026-07-06","total_amount":1955.12,"transactions":[],"installments":[],"fees":[],"payments":[],"warnings":[]}',
    'Não inclua nome, endereço, CPF, CNPJ, telefone, e-mail, agência, conta ou cartão.',
    'Não faça resumo. Não omita linhas relevantes. Não deduplique manualmente itens reais.',
    'A instituição deve ser identificada pelo cabeçalho, logo, título da fatura ou bloco principal da página, nunca pela primeira transação, merchant, adquirente ou descrição de compra.',
    institutionHint
      ? `Pista local do cabeçalho: ${institutionHint}. Use essa pista como fonte primária da instituição e não a substitua por nomes de transações.`
      : 'Se houver dúvida entre banco da fatura e nomes que aparecem apenas nas transações, prefira o banco do cabeçalho e ignore os nomes das transações.',
    'Se a fatura tiver tabelas, cada linha relevante da tabela deve virar um item.',
    'Se uma linha estiver quebrada em duas ou mais linhas, una os trechos antes de classificar.',
    'Algumas compras aparecem em linhas quebradas como: "08 MAI", "IMPRESSIONE - NuPay", "R$ 82,50". Isso é um único transaction com date, description e amount.',
    'Algumas compras aparecem em uma única linha como: "14 MAI ... Wellhub Maria Francine R$ 91,70". Isso também é um único transaction.',
    'Não assuma que apenas linhas com "Parcela" importam. Compras normais sem "Parcela" também devem ir para transactions.',
    'transactions deve conter apenas compras e lançamentos financeiros efetivos da fatura.',
    'NÃO coloque em transactions linhas de parcelamento, financiamento, crédito parcelado automático, IOF, encargos, juros, anuidade ou pagamentos.',
    'installments deve listar parcelas, financiamentos e séries parceladas quando existirem.',
    'fees deve listar encargos, juros, multa, anuidade, IOF e tarifas.',
    'payments deve listar pagamentos efetuados na fatura.',
    'Nunca classifique como transaction linhas com DIARIO ROTATIVO, DIARIO PARCELADO, JUROS, JUROS MORA, IOF, ANUIDADE, TARIFA, TARIFAS, ENCARGOS, ROTATIVO, SALDO FINANCIADO, PARCELAMENTO AUTOMATICO, FIN PARC, PARCxx/yy ou AMORTIZACAO.',
    'Se existir um bloco de transações internacionais, preserve a linha do estabelecimento/merchant como description mesmo quando ela vier na linha anterior à data, ao dólar ou ao valor em reais.',
    'Se a linha mostrar merchant em uma linha e a linha seguinte trouxer data, dolar e valor em reais, una os dois elementos no mesmo item com country="international".',
    'Classifique como fees linhas com IOF, juros, encargos, rotativo, tarifa, anuidade, câmbio ou diário rotativo.',
    'Classifique como installments linhas com parcelamento, parcela, financiamento, crédito parcelado, fin parc ou automático de fatura.',
    'Inclua parcelas mesmo que a data seja de um mês diferente do billing_period — parcelas de compras anteriores aparecem na fatura com a data original da parcela.',
    'Seções como "Nacionais em Reais (R$)", "Lançamentos", "Lançamentos Total parcelado" são seções de transações e devem ser extraídas.',
    'Se aparecer um bloco como "Operações de crédito contratados" ou uma linha como "FIN PARC AUTOM..." ou "PARCxx/yy", classifique como installments e nunca como transaction.',
    'Se a linha de installment mostrar algo como "10/24", "02/24" ou "(10/24)", preencha current=10 e total=24 usando esses números.',
    'Não herde current/total de outra linha próxima, como anuidade, juros, encargos ou lançamento financeiro diferente.',
    'Classifique como payments linhas de pagamento de fatura, pagamento efetuado, PIX ou amortização do saldo.',
    'Não converta linha de subtotal, resumo, limite, saldo ou total em transaction.',
    'warnings deve conter qualquer incerteza ou lacuna detectada.',
    'Se algum valor não existir, use 0, arrays vazias ou string vazia.',
  ]

  const strictInstructions = mode === 'strict' ? [
    'Sua resposta anterior veio incompleta.',
    'Releia a ASCII inteira e devolva todos os itens visíveis das seções tabulares.',
    'Se a fatura mostrar linhas de transações, nenhuma delas pode ficar de fora.',
    'Se existirem linhas com data, merchant e valor em reais, transactions não pode ficar vazia.',
    'Se houver apenas payment e nenhuma transaction/installment/fee, isso indica erro de leitura.',
    'Se o ASCII mostrar qualquer sinal de parcelamento, installments NÃO pode ficar vazio.',
    'Cada linha visível de parcelamento, financiamento, crédito parcelado, parcela automática ou fin parc deve virar um item em installments.',
    'Se a descrição vier com algo como "10/24", "02/24" ou "(10/24)", preserve current e total no JSON.',
    'Use description, amount, date, current e total quando estiverem visíveis.',
    'Concentre-se nos blocos com "Data", "Estabelecimento", "Valor", "US$", "R$", "Pagamentos efetuados", "Transações Nacionais", "Transações Internacionais" e "Compras parceladas - próximas faturas".',
  ] : []

  return [...baseInstructions, ...strictInstructions].join(' ')
}

function isSparseFinancialExtraction(
  parsed: FinancialResponse,
  asciiText: string,
): boolean {
  const hasTabularSections = /transa[cç][oõ]es?\s+internacionais|transa[cç][oõ]es?\s+nacionais|compras parceladas\s*-\s*pr[óo]ximas faturas|opera[cç][oõ]es de cr[eé]dito contratados|pagamentos efetuados|lan[cç]amentos:\s*compras e saques|nacionais\s+em\s+reais|lan[cç]amentos\s+total\s+parcelado/i.test(asciiText)
  const hasPurchaseLikeLines = asciiText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .some((line) =>
      // Linha com R$ e sem padrão de parcela simples
      (/\bR\$\s*[\d.,]+/.test(line) && !/\bPARCELA\b|\bPARC\s*\d{1,2}\/\d{1,2}\b/i.test(line))
      // Ou linha no formato "DD/MM DESCRIÇÃO VALOR" sem R$ (formato Bradesco/Bradescard)
      || /^\d{2}\/\d{2}\s+[A-ZÀ-Ü].{3,}\s+[\d.,]{3,}$/.test(line)
    )
  return hasTabularSections && hasPurchaseLikeLines && (parsed.transactions.length === 0 && parsed.installments.length === 0)
}

function hasInstallmentSignals(asciiText: string): boolean {
  return /(?:\bFIN\s+PARC\b|\bPARC(?:ELA|ELAS|ELAMENTO|ELADO)?\b|\bPARC\s*\d{1,2}\/\d{1,2}\b|compras parceladas\s*-\s*pr[óo]ximas faturas|opera[cç][oõ]es de cr[eé]dito contratados|parcelamento de fatura|cr[eé]dito parcelado|parcelamento autom[aá]tico)/i.test(asciiText)
}

function countAutomaticInstallmentSignals(asciiText: string): number {
  return asciiText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => /\bPARC\s+AUTOMATIC\b/i.test(line))
    .length
}

function countAutomaticInstallments(items: Array<{ description?: string | null }>): number {
  return items.filter((item) => /\bPARC\s+AUTOMATIC\b/i.test(normalizeText(item.description))).length
}

export async function extractFinancialInvoiceWithAI(
  sanitizedAscii: string,
  meta: { filename: string; cardLast4Hint?: string },
): Promise<FinancialExtractionResult> {
  const institutionHint = detectInstitutionHintFromAscii(sanitizedAscii)
  const cardLast4Hint = meta.cardLast4Hint || extractCardLast4FromAscii(sanitizedAscii)
  const prompt = buildFinancialExtractionPrompt('standard', institutionHint)
  const raw = await callStructuredJsonAI(
    prompt,
    {
      filename: meta.filename,
      ascii: sanitizedAscii,
      institutionHint,
      cardLast4Hint,
    },
    INVOICE_EXTRACTION_TIMEOUT_MS,
  )

  const parsed = financialResponseSchema.parse(raw)
  const billingPeriod = normalizeBillingPeriod(parsed.billing_period)
  const dueDate = normalizeDate(parsed.due_date, billingPeriod)
  const warnings = [...parsed.warnings]
  const dueDateBillingPeriod = dueDate ? dueDate.slice(0, 7) : ''

  let normalizedBillingPeriod = billingPeriod
  if (dueDateBillingPeriod && normalizedBillingPeriod && normalizedBillingPeriod !== dueDateBillingPeriod) {
    warnings.push(`billing_period ajustado para o mês do vencimento: ${dueDateBillingPeriod}.`)
    normalizedBillingPeriod = dueDateBillingPeriod
  }
  if (!normalizedBillingPeriod && dueDateBillingPeriod) {
    normalizedBillingPeriod = dueDateBillingPeriod
  }

  let activeParsed: FinancialResponse = parsed
  const needsSparseRetry = isSparseFinancialExtraction(parsed, sanitizedAscii)
  const visibleAutomaticInstallments = countAutomaticInstallmentSignals(sanitizedAscii)
  const parsedAutomaticInstallments = countAutomaticInstallments(parsed.installments)
  const needsInstallmentRetry = hasInstallmentSignals(sanitizedAscii) && parsed.installments.length === 0
  const needsInstallmentCompletionRetry =
    visibleAutomaticInstallments >= 2
    && parsedAutomaticInstallments > 0
    && parsedAutomaticInstallments < visibleAutomaticInstallments

  if (needsSparseRetry || needsInstallmentRetry || needsInstallmentCompletionRetry) {
    const retryRaw = await callStructuredJsonAI(
      buildFinancialExtractionPrompt('strict', institutionHint),
      {
        filename: meta.filename,
        ascii: sanitizedAscii,
        institutionHint,
        cardLast4Hint,
      },
      INVOICE_EXTRACTION_TIMEOUT_MS,
    )
    const retryParsed = financialResponseSchema.parse(retryRaw)
    const retryScore =
      retryParsed.transactions.length * 3
      + retryParsed.installments.length * 2
      + retryParsed.fees.length
      + retryParsed.payments.length
    const retryAutomaticInstallments = countAutomaticInstallments(retryParsed.installments)
    const parsedScore =
      parsed.transactions.length * 3
      + parsed.installments.length * 2
      + parsed.fees.length
      + parsed.payments.length
    if (retryScore > parsedScore || retryAutomaticInstallments > parsedAutomaticInstallments) {
      activeParsed = retryParsed
      warnings.push(
        needsInstallmentCompletionRetry
          ? 'IA refez a leitura para recuperar parcelas automáticas visíveis.'
          : needsInstallmentRetry && !needsSparseRetry
          ? 'IA refez a leitura para recuperar parcelas visíveis.'
          : 'IA refez a leitura após resposta esvaziada.',
      )
    }
  }

  if (institutionHint) {
    const parsedInstitution = normalizeInstitutionKey(activeParsed.institution)
    if (parsedInstitution !== institutionHint) {
      warnings.push(`institution ajustada pelo cabeçalho: ${institutionHint}.`)
      activeParsed = {
        ...activeParsed,
        institution: institutionHint,
      }
    }
  }

  if (cardLast4Hint && activeParsed.card_last4 !== cardLast4Hint) {
    warnings.push(`card_last4 ajustado pelo cabeçalho: ${cardLast4Hint}.`)
    activeParsed = {
      ...activeParsed,
      card_last4: cardLast4Hint,
    }
  }

  if (!billingPeriod) {
    warnings.push('billing_period inválido retornado pela IA.')
  }
  if (!dueDate) {
    warnings.push('due_date inválido ou ausente retornado pela IA.')
  }

  const transactions: FinancialExtractionResult['transactions'] = []
  const installments: FinancialExtractionResult['installments'] = []
  const fees: FinancialExtractionResult['fees'] = []
  const payments: FinancialExtractionResult['payments'] = []

  // installmentSeen: inicializado vazio — as chaves são adicionadas à medida que os itens são processados
  // (não pré-popular com as chaves da IA, pois isso impediria a adição das installments ao array)
  const installmentSeen = new Set<string>()
  const feeSeen = new Set(
    activeParsed.fees.map((item) => buildFinancialEntryKey({
      description: normalizeText(item.description),
      amount: normalizeMoney(item.amount ?? 0),
      kind: normalizeText(item.kind) || undefined,
    })),
  )
  const paymentSeen = new Set(
    activeParsed.payments.map((item) => buildFinancialEntryKey({
      date: item.date ? normalizeDate(item.date, normalizedBillingPeriod) || normalizeText(item.date) : undefined,
      description: normalizeText(item.description),
      amount: normalizeMoney(item.amount ?? 0),
      source: normalizeText(item.source) || undefined,
    })),
  )

  for (const item of activeParsed.transactions) {
    const description = normalizeText(item.description)
    const date = normalizeDate(item.date, normalizedBillingPeriod) || normalizeText(item.date)
    const amount = normalizeMoney(item.amount ?? 0)
    if (!description) {
      continue
    }
    if (!date) {
      continue
    }
    const classification = normalizeForClassification(description)
    if (looksLikePaymentEntry(classification)) {
      warnings.push(`transaction reclassificada como payment: ${description}`)
      const paymentEntry = {
        date,
        description,
        amount,
        source: normalizeText(item.country) === 'international' ? 'international' : normalizeText(item.category) || undefined,
      }
      const key = buildFinancialEntryKey(paymentEntry)
      if (!paymentSeen.has(key)) {
        paymentSeen.add(key)
        payments.push(paymentEntry)
      }
      continue
    }
    if (looksLikeFeeEntry(classification)) {
      warnings.push(`transaction reclassificada como fee: ${description}`)
      const feeEntry = {
        description,
        amount,
        kind: normalizeText(item.country) === 'international' ? 'câmbio' : undefined,
      }
      const key = buildFinancialEntryKey(feeEntry)
      if (!feeSeen.has(key)) {
        feeSeen.add(key)
        fees.push(feeEntry)
      }
      continue
    }
    if (looksLikeInstallmentEntry(classification)) {
      warnings.push(`transaction reclassificada como installment: ${description}`)
      const installmentMeta = parseInstallmentMeta(description)
      const installmentFieldMeta = item.installment ? parseInstallmentMeta(item.installment) : { description: '' }
      const installmentEntry = {
        description: installmentMeta.description || description,
        amount,
        current: installmentMeta.current ?? installmentFieldMeta.current ?? (item.installment ? Number(item.installment.split('/')[0]) || undefined : undefined),
        total: installmentMeta.total ?? installmentFieldMeta.total ?? (item.installment ? Number(item.installment.split('/')[1]) || undefined : undefined),
        date,
      }
      const key = buildFinancialEntryKey(installmentEntry)
      if (!installmentSeen.has(key)) {
        installmentSeen.add(key)
        installments.push(installmentEntry)
      }
      continue
    }
    transactions.push({
      date,
      description,
      amount,
      installment: normalizeText(item.installment) || undefined,
      category: normalizeText(item.category) || undefined,
      country: normalizeText(item.country) || undefined,
    })
  }

  // Processar installments da IA (activeParsed.installments) — fonte primária
  for (const item of activeParsed.installments) {
    const description = normalizeText(item.description)
    if (!description) {
      continue
    }
    const classification = normalizeForClassification(description)
    if (looksLikePaymentEntry(classification) || looksLikeInvoiceTotalEntry(classification)) {
      warnings.push(`resumo removido de installments: ${description}`)
      continue
    }
    const installmentMeta = parseInstallmentMeta(description)
    const installmentEntry = {
      description: installmentMeta.description || description,
      amount: normalizeMoney(item.amount ?? 0),
      current: item.current ?? installmentMeta.current,
      total: item.total ?? installmentMeta.total,
      date: item.date ? normalizeDate(item.date, normalizedBillingPeriod) || normalizeText(item.date) : undefined,
    }
    const key = buildFinancialEntryKey(installmentEntry)
    if (installmentSeen.has(key)) continue
    installmentSeen.add(key)
    installments.push(installmentEntry)
  }

  for (const item of activeParsed.fees) {
    const description = normalizeText(item.description)
    if (!description) {
      continue
    }
    const feeEntry = {
      description,
      amount: normalizeMoney(item.amount ?? 0),
      kind: normalizeText(item.kind) || undefined,
    }
    const key = buildFinancialEntryKey(feeEntry)
    if (feeSeen.has(key)) continue
    feeSeen.add(key)
    fees.push(feeEntry)
  }

  for (const item of activeParsed.payments) {
    const description = normalizeText(item.description)
    if (!description) {
      continue
    }
    const paymentEntry = {
      date: item.date ? normalizeDate(item.date, normalizedBillingPeriod) || normalizeText(item.date) : undefined,
      description,
      amount: normalizeMoney(item.amount ?? 0),
      source: normalizeText(item.source) || undefined,
    }
    const key = buildFinancialEntryKey(paymentEntry)
    if (paymentSeen.has(key)) continue
    paymentSeen.add(key)
    payments.push(paymentEntry)
  }

// ─── Detecção de adiantamento automático de parcelas ───────────────────────────
// Padrão Itaú: quando o utilizador não paga a fatura e o banco adianta as parcelas
// restantes, a fatura mostra:
//   - N linhas "PARC AUTOMATIC XX/YY" (as parcelas antecipadas, com juros crescentes)
//   - 1 linha "CREDITO PARC AUTOMATICO" (crédito de compensação, valor negativo)
//   - 1 linha "IOF REFINANCIAMENTO" (encargo sobre os juros do adiantamento)
//
// Estratégia: se a fatura tiver um payment com descrição contendo
// "credito parc" ou "credito parcelamento", marcar todas as installments
// cujo nome contenha "parc automatic" como isPrepayment=true.
// Isso sinaliza ao frontend/importação para excluí-las dos gastos mensais.
function markPrepaymentInstallments(
  installments: FinancialExtractionResult['installments'],
  payments: FinancialExtractionResult['payments'],
  transactions: FinancialExtractionResult['transactions'],
): FinancialExtractionResult['installments'] {
  const PREPAYMENT_CREDIT_PATTERN = /credito\s+parc|cr[eé]dito\s+parcelamento|credito\s+automatic/i
  const PREPAYMENT_INSTALLMENT_PATTERN = /parc\s*automatic|parcelamento\s*automatic/i

  const hasPrepaymentCredit = payments.some((p) =>
    PREPAYMENT_CREDIT_PATTERN.test(p.description),
  )

  // Também detectar quando há múltiplas parcelas PARC AUTOMATIC na mesma data
  // (sinal de adiantamento mesmo sem crédito explícito na mesma fatura)
  const parcAutoGroups = new Map<string, number>()
  for (const inst of installments) {
    if (PREPAYMENT_INSTALLMENT_PATTERN.test(inst.description)) {
      const dateKey = inst.date ?? 'no-date'
      parcAutoGroups.set(dateKey, (parcAutoGroups.get(dateKey) ?? 0) + 1)
    }
  }
  const hasMultipleParcAutoSameDate = [...parcAutoGroups.values()].some((count) => count >= 2)

  // Também detectar quando PARC AUTOMATIC aparece nas transactions (a IA colocou lá em vez de installments)
  const hasParcAutoInTransactions = transactions.some(
    (t) => PREPAYMENT_INSTALLMENT_PATTERN.test(t.description),
  )

  if (!hasPrepaymentCredit && !hasMultipleParcAutoSameDate && !hasParcAutoInTransactions) {
    return installments
  }

  return installments.map((inst) => {
    if (PREPAYMENT_INSTALLMENT_PATTERN.test(inst.description)) {
      return { ...inst, isPrepayment: true }
    }
    return inst
  })
}

  // Detectar adiantamento automático de parcelas (ex: PARC AUTOMATIC do Itaú)
  // Quando a fatura contém um crédito de compensação (CREDITO PARC AUTOMATICO),
  // todas as parcelas PARC AUTOMATIC são marcadas como isPrepayment=true
  // para que não sejam contabilizadas nos gastos mensais.
  const markedInstallments = markPrepaymentInstallments(installments, payments, transactions)

  return {
    document_type: activeParsed.document_type,
    institution: activeParsed.institution,
    card_last4: activeParsed.card_last4 || cardLast4Hint,
    billing_period: normalizedBillingPeriod || activeParsed.billing_period,
    due_date: dueDate || activeParsed.due_date.trim(),
    total_amount: normalizeMoney(activeParsed.total_amount ?? 0),
    transactions,
    installments: markedInstallments,
    fees,
    payments,
    warnings,
  }
}

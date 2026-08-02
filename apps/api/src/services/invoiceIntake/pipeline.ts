import { sanitizeSensitiveText } from '../textSanitizer.js'
import { extractAsciiStructuralTextFromPdf } from './pdfAsciiExtractor.js'
import { applyPiiRedactionsToAscii, sanitizeInvoiceAsciiDeterministically } from './piiSanitizer.js'
import { detectPiiRedactionsWithAI } from './piiDetector.js'
import { extractFinancialInvoiceWithAI } from './financialExtractor.js'
import type {
  FinancialExtractionResult,
  InvoicePipelineDebug,
  InvoicePreviewPayload,
  InvoicePreviewTransaction,
  PiiDetectionResult,
  SanitizationReport,
} from './types.js'

function toMinor(amount: number): number {
  if (!Number.isFinite(amount)) return 0
  return Math.round(amount * 100)
}

function normalizeAsciiLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function parseMoneyMinorFromText(value: string): number | null {
  const matches = value.match(/-?[\d]{1,3}(?:\.[\d]{3})*,\d{2}|-?\d+,\d{2}/g)
  const token = matches?.at(-1)
  if (!token) return null
  const normalized = token
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.')
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  return Math.round(Math.abs(parsed) * 100)
}

const INSTALLMENT_MONTHS: Record<string, string> = {
  JAN: '01',
  FEV: '02',
  FEB: '02',
  MAR: '03',
  ABR: '04',
  APR: '04',
  MAI: '05',
  MAY: '05',
  JUN: '06',
  JUL: '07',
  AGO: '08',
  AUG: '08',
  SET: '09',
  SEP: '09',
  OUT: '10',
  OCT: '10',
  NOV: '11',
  DEZ: '12',
  DEC: '12',
}

function parseFirstMoneyMinorFromText(value: string): number | null {
  const matches = value.match(/-?[\d]{1,3}(?:\.[\d]{3})*,\d{2}|-?\d+,\d{2}/g)
  const token = matches?.at(0)
  if (!token) return null
  const normalized = token
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.')
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  return Math.round(Math.abs(parsed) * 100)
}

type InstallmentHint = {
  date?: string
  description: string
  amountMinor: number
  current?: number
  total?: number
}

function normalizeInstallmentHintText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

function buildInstallmentHintKey(input: {
  date?: string
  description: string
  amountMinor: number
  current?: number | null
  total?: number | null
}): string {
  return [
    input.date ?? '',
    normalizeInstallmentHintText(input.description),
    Math.round(Math.abs(input.amountMinor)),
    input.current ?? '',
    input.total ?? '',
  ].join('|')
}

function normalizeInstallmentHintDate(value: string | undefined, billingPeriod: string): string {
  if (!value) return ''
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed

  const match = trimmed.match(/^(\d{2})\/(\d{2})(?:\/(\d{4}))?$/)
  if (match) {
    const year = match[3] ?? billingPeriod.slice(0, 4)
    return `${year}-${match[2]}-${match[1]}`
  }

  const textMonthMatch = trimmed.match(/^(\d{1,2})\s+([A-ZÀ-Ÿ]{3,})(?:\s+(\d{4}))?$/i)
  if (!textMonthMatch) return trimmed

  const monthKey = textMonthMatch[2]
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .slice(0, 3)
    .toUpperCase()
  const month = INSTALLMENT_MONTHS[monthKey]
  if (!month) return trimmed

  const day = textMonthMatch[1].padStart(2, '0')
  const year = textMonthMatch[3] ?? billingPeriod.slice(0, 4)
  return `${year}-${month}-${day}`
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

function extractInstallmentHintsFromAscii(asciiText: string): InstallmentHint[] {
  const hints: InstallmentHint[] = []
  const seen = new Set<string>()
  for (const rawLine of asciiText.split(/\r?\n/)) {
    const line = normalizeAsciiLine(rawLine)
    if (!line) continue

    const segments = splitLineByDates(line)
    for (const segment of segments) {
      const normalizedSegment = normalizeAsciiLine(segment)
      if (!normalizedSegment) continue

      const dateMatch = normalizedSegment.match(/^((?:\d{2}\/\d{2}(?:\/\d{4})?)|(?:\d{1,2}\s+[A-ZÀ-Ÿ]{3,}(?:\s+\d{4})?))\s+(.*)$/)
      const rest = dateMatch ? dateMatch[2].trim() : normalizedSegment
      if (!rest) continue

      const amountMatch = rest.match(/-?[\d]{1,3}(?:\.[\d]{3})*,\d{2}|-?\d+,\d{2}/g)?.at(0)
      if (!amountMatch) continue

      const amountIndex = rest.indexOf(amountMatch)
      if (amountIndex < 0) continue

      const descriptionWithInstallment = rest.slice(0, amountIndex).replace(/\s+/g, ' ').trim()
      if (!descriptionWithInstallment) continue

      // A data completa (por exemplo, 07/07/2026) não representa uma parcela.
      // Também evitamos iniciar a captura no segundo algarismo de uma data como
      // 08/12/2025. Quando a linha contém data e "Parcela 7/12", somente 7/12
      // deve ser considerado.
      const installmentMatch = descriptionWithInstallment.match(
        /(?<![\d/])\(?(\d{1,2})\s*\/\s*(\d{1,2})\)?(?!\s*\/\s*\d{2,4})(?!\d)/,
      )
      if (!installmentMatch) continue

      const description = descriptionWithInstallment
        .replace(/\s*R\$\s*$/, '')
        .replace(/\s*\(?\d{1,2}\s*\/\s*\d{1,2}\)?\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim()

      const current = Number(installmentMatch[1])
      const total = Number(installmentMatch[2])
      const amountMinor = parseMoneyMinorFromText(amountMatch) ?? 0
      if (!description || !amountMinor) continue

      const key = [
        dateMatch ? dateMatch[1] : '',
        normalizeInstallmentHintText(description),
        amountMinor,
        Number.isFinite(current) ? current : '',
        Number.isFinite(total) ? total : '',
      ].join('|')
      if (seen.has(key)) continue
      seen.add(key)

      hints.push({
        date: dateMatch ? dateMatch[1] : undefined,
        description,
        amountMinor,
        current: Number.isFinite(current) ? current : undefined,
        total: Number.isFinite(total) ? total : undefined,
      })
    }
  }
  return hints
}

function mergeInstallmentHints(
  extraction: FinancialExtractionResult,
  asciiText: string,
): FinancialExtractionResult {
  const hints = extractInstallmentHintsFromAscii(asciiText)
  if (hints.length === 0) return extraction

  const hintsByExactKey = new Map<string, InstallmentHint[]>()
  const hintsByDescriptionAmount = new Map<string, InstallmentHint[]>()
  const hintsByDescriptionInstallment = new Map<string, InstallmentHint[]>()
  for (const hint of hints) {
    const exactKey = [
      normalizeInstallmentHintDate(hint.date, extraction.billing_period),
      normalizeInstallmentHintText(hint.description),
      hint.amountMinor,
    ].join('|')
    const exactList = hintsByExactKey.get(exactKey) ?? []
    exactList.push(hint)
    hintsByExactKey.set(exactKey, exactList)

    const descAmountKey = [
      normalizeInstallmentHintText(hint.description),
      hint.amountMinor,
    ].join('|')
    const descAmountList = hintsByDescriptionAmount.get(descAmountKey) ?? []
    descAmountList.push(hint)
    hintsByDescriptionAmount.set(descAmountKey, descAmountList)

    const descInstallmentKey = [
      normalizeInstallmentHintText(hint.description),
      hint.current ?? '',
      hint.total ?? '',
    ].join('|')
    const descInstallmentList = hintsByDescriptionInstallment.get(descInstallmentKey) ?? []
    descInstallmentList.push(hint)
    hintsByDescriptionInstallment.set(descInstallmentKey, descInstallmentList)
  }

  const matchedHints = new Set<InstallmentHint>()
  const warnings = [...extraction.warnings]
  const installments = extraction.installments.map((item) => {
    const normalizedItemDescription = normalizeInstallmentHintText(item.description)
    const normalizedItemDate = normalizeInstallmentHintDate(item.date, extraction.billing_period) || item.date
    const itemAmountMinor = Math.round(Math.abs(item.amount) * 100)
    const itemCurrent = item.current ?? undefined
    const itemTotal = item.total ?? undefined
    const exactKey = [
      normalizedItemDate,
      normalizedItemDescription,
      itemAmountMinor,
    ].join('|')

    const exactMatch = hintsByExactKey.get(exactKey)?.find((hint) => !matchedHints.has(hint))
    const descAmountKey = [
      normalizedItemDescription,
      itemAmountMinor,
    ].join('|')
    const descAmountMatch = hintsByDescriptionAmount.get(descAmountKey)?.find((hint) => !matchedHints.has(hint))
    const descInstallmentKey = [
      normalizedItemDescription,
      itemCurrent ?? '',
      itemTotal ?? '',
    ].join('|')
    const descInstallmentMatch = hintsByDescriptionInstallment.get(descInstallmentKey)?.find((hint) => !matchedHints.has(hint))
    const match = exactMatch ?? descAmountMatch ?? descInstallmentMatch
    if (!match) return item

    matchedHints.add(match)

    const normalizedMatchDate = normalizeInstallmentHintDate(match.date, extraction.billing_period) || match.date
    const shouldOverride =
      itemCurrent !== match.current
      || itemTotal !== match.total
      || (normalizedItemDate || '') !== (normalizedMatchDate || '')

    if (shouldOverride) {
      warnings.push(`parcelamento ajustado pelo ASCII: ${match.description}${match.current && match.total ? ` (${match.current}/${match.total})` : ''}.`)
    }

    return {
      ...item,
      amount: item.amount > 0 ? item.amount : Math.abs(match.amountMinor) / 100,
      current: match.current ?? item.current,
      total: match.total ?? item.total,
      date: normalizedMatchDate || item.date,
      // preservar o flag isPrepayment da extracção original
      isPrepayment: item.isPrepayment,
    }
  })

  const installmentKeys = new Set(
    installments.map((item) => buildInstallmentHintKey({
      date: normalizeInstallmentHintDate(item.date, extraction.billing_period) || undefined,
      description: item.description,
      amountMinor: toMinor(item.amount ?? 0),
      current: item.current ?? null,
      total: item.total ?? null,
    })),
  )

  for (const hint of hints) {
    if (matchedHints.has(hint)) continue

    const normalizedHintDate = normalizeInstallmentHintDate(hint.date, extraction.billing_period)
    const key = buildInstallmentHintKey({
      date: normalizedHintDate || undefined,
      description: hint.description,
      amountMinor: hint.amountMinor,
      current: hint.current ?? null,
      total: hint.total ?? null,
    })

    if (installmentKeys.has(key)) continue
    installmentKeys.add(key)
    installments.push({
      description: hint.description,
      amount: Math.abs(hint.amountMinor) / 100,
      current: hint.current,
      total: hint.total,
      date: normalizedHintDate || undefined,
    })
  }

  return {
    ...extraction,
    installments,
    warnings,
  }
}

function removeInvalidInstallments(extraction: FinancialExtractionResult): FinancialExtractionResult {
  const installments = extraction.installments.filter((item) => {
    const description = item.description
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .toLowerCase()

    return !description.includes('pagamento efetuado')
      && !description.includes('total desta fatura')
      && !description.includes('total da fatura')
  })
  if (installments.length === extraction.installments.length) return extraction

  return {
    ...extraction,
    installments,
    warnings: [
      ...extraction.warnings,
      `${extraction.installments.length - installments.length} resumo(s) de pagamento/fatura removido(s) dos parcelamentos.`,
    ],
  }
}

function extractCardLast4FromAscii(asciiText: string): string {
  const normalizedText = asciiText
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  const patterns = [
    /\[CARD_LAST4:(\d{4})\]/i,
    /(?:cart[aã]o|card|titular)[\s\S]{0,120}?\b(?:\d{4}|[xX*#•]{4})(?:[.\s-]*(?:\d{4}|[xX*#•]{4})){2}[.\s-]*(\d{4})\b/i,
    /\b(?:\d{4}|[xX*#•]{4})(?:[.\s-]*(?:\d{4}|[xX*#•]{4})){2}[.\s-]*(\d{4})\b/,
    /\b(?:\d{4}[.\s-]){3}(\d{4})\b/,
  ]

  for (const pattern of patterns) {
    const match = normalizedText.match(pattern)
    const last4 = match?.[1]
    if (last4) return last4
  }

  return ''
}

function extractHeaderSummaryFromAscii(asciiText: string): {
  totalMinor?: number
  previousBalanceMinor?: number
  paymentsMinor?: number
  monthlyExpensesMinor?: number
  creditsAndRefundsMinor?: number
  chargesMinor?: number
  financedBalanceMinor?: number
} {
  const summary: {
    totalMinor?: number
    previousBalanceMinor?: number
    paymentsMinor?: number
    monthlyExpensesMinor?: number
    creditsAndRefundsMinor?: number
    chargesMinor?: number
    financedBalanceMinor?: number
  } = {}

  for (const rawLine of asciiText.split(/\r?\n/)) {
    const line = normalizeAsciiLine(rawLine)
    if (!line) continue
    const normalized = line
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()

    if (/(?:total da fatura anterior|fatura anterior)/.test(normalized)) {
      const amount = parseFirstMoneyMinorFromText(line)
      if (amount !== null) summary.previousBalanceMinor = amount
      continue
    }

    if (/(?:pagamentos?\s*\/\s*creditos?|pagamento efetuado|pagamento recebido)/.test(normalized)) {
      const amount = parseFirstMoneyMinorFromText(line)
      if (amount !== null) summary.paymentsMinor = amount
      continue
    }

    if (/creditos?\s+e\s+estornos?/.test(normalized)) {
      const amount = parseFirstMoneyMinorFromText(line)
      if (amount !== null) summary.creditsAndRefundsMinor = amount
      continue
    }

    if (/despesas.*m[eê]s/.test(normalized)) {
      const amount = parseFirstMoneyMinorFromText(line)
      if (amount !== null) summary.monthlyExpensesMinor = amount
      continue
    }

    if (/saldo financiado/.test(normalized)) {
      const amount = parseFirstMoneyMinorFromText(line)
      if (amount !== null) summary.financedBalanceMinor = amount
      continue
    }

    if (/(?:total desta fatura|total da fatura\b)/.test(normalized)) {
      const amount = parseFirstMoneyMinorFromText(line)
      if (amount !== null) summary.totalMinor = amount
    }

    if (summary.chargesMinor === undefined && /encargos/.test(normalized)) {
      const amount = parseFirstMoneyMinorFromText(line)
      if (amount !== null) summary.chargesMinor = amount
    }
  }

  return summary
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

function normalizeInstitution(value: string): string {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()

  const mapping: Record<string, string> = {
    itau: 'itau',
    'banco do brasil': 'bb',
    bradesco: 'bradesco',
    mastercard: 'mastercard',
    visa: 'visa',
    nubank: 'nubank',
    inter: 'inter',
    santander: 'santander',
    caixa: 'caixa',
    picpay: 'picpay',
  }

  return mapping[normalized] ?? normalized.replace(/\s+/g, '_')
}

function buildPreviewTransactions(
  extraction: FinancialExtractionResult,
): InvoicePreviewTransaction[] {
  const invoiceMonth = extraction.due_date.slice(0, 7) || extraction.billing_period
  const transactions = extraction.transactions.map((tx, index) => ({
    id: `financial-tx-${index}`,
    date: tx.date,
    description: tx.description,
    amountMinor: toMinor(Math.abs(tx.amount)),
    installment: tx.installment,
    categoryId: null,
    competencyMonth: tx.date.slice(0, 7) || invoiceMonth,
    include: true,
    category: tx.category ?? '',
    country: tx.country,
  }))

  const fees = extraction.fees.map((fee, index) => ({
    id: `financial-fee-${index}`,
    date: extraction.due_date,
    description: fee.description,
    amountMinor: toMinor(Math.abs(fee.amount)),
    installment: undefined,
    categoryId: null,
    competencyMonth: invoiceMonth,
    include: true,
    category: fee.kind ?? 'encargos',
  }))

  return [...transactions, ...fees]
}

function buildPreviewPayload(
  extraction: FinancialExtractionResult,
  piiDetection: PiiDetectionResult,
  sanitizationReport: SanitizationReport,
  finalAscii: string,
  cardLast4: string,
): InvoicePreviewPayload {
  const previewTransactions = buildPreviewTransactions(extraction)
  const headerSummary = extractHeaderSummaryFromAscii(finalAscii)
  const invoiceMonth = extraction.due_date.slice(0, 7) || extraction.billing_period
  const totalMinor = headerSummary.totalMinor ?? toMinor(extraction.total_amount)
  const paymentsMinor = headerSummary.paymentsMinor
    ?? extraction.payments.reduce((sum, payment) => sum + toMinor(Math.abs(payment.amount)), 0)
  const feesMinor = extraction.fees.reduce((sum, fee) => sum + toMinor(Math.abs(fee.amount)), 0)
  const purchasesMinor = headerSummary.monthlyExpensesMinor
    ?? extraction.transactions.reduce((sum, tx) => sum + toMinor(Math.abs(tx.amount)), 0)

  return {
    bank: normalizeInstitution(extraction.institution),
    summary: {
      cardLast4,
      product: extraction.institution,
      invoiceMonth,
      dueDate: extraction.due_date,
      dueMonth: invoiceMonth,
      closingDate: '',
      totalMinor,
      previousBalanceMinor: headerSummary.previousBalanceMinor
        ?? Math.max(0, totalMinor - purchasesMinor - feesMinor),
      financedBalanceMinor: headerSummary.financedBalanceMinor,
      paymentsMinor,
      monthlyExpensesMinor: headerSummary.monthlyExpensesMinor ?? purchasesMinor,
      creditsAndRefundsMinor: headerSummary.creditsAndRefundsMinor ?? 0,
      nationalPurchasesMinor: purchasesMinor,
      internationalPurchasesMinor: extraction.transactions
        .filter((tx) => tx.country?.toLowerCase() === 'international')
        .reduce((sum, tx) => sum + toMinor(Math.abs(tx.amount)), 0),
      chargesMinor: headerSummary.chargesMinor ?? feesMinor,
      openBalanceMinor: totalMinor,
    },
    transactions: previewTransactions,
    forecasts: totalMinor > 0
      ? [{
          id: `invoice-${invoiceMonth}`,
          competencyMonth: invoiceMonth,
          amountMinor: totalMinor,
          recurrence: 'one-time' as const,
          description: `Fatura ${extraction.institution}`,
        }]
      : [],
    analysis: extraction,
    piiDetection,
    sanitizationReport,
  }
}

export async function runInvoiceAsciiIngestionPipeline(
  buffer: Buffer,
  meta: { filename: string; password?: string },
): Promise<{
  payload: InvoicePreviewPayload
  debug: InvoicePipelineDebug
}> {
  const asciiExtraction = await extractAsciiStructuralTextFromPdf(buffer, meta.password)
  const deterministic = sanitizeInvoiceAsciiDeterministically(asciiExtraction.asciiText)
  const piiDetection = await detectPiiRedactionsWithAI(deterministic.sanitized_ascii, { filename: meta.filename })
  const piiApplied = applyPiiRedactionsToAscii(deterministic.sanitized_ascii, piiDetection.result.redactions)
  const finalAscii = sanitizeSensitiveText(piiApplied.sanitizedAscii, { includeSemanticRedactions: true }).sanitizedText
  const cardLast4Hint =
    extractCardLast4FromAscii(asciiExtraction.asciiText)
    || extractCardLast4FromAscii(deterministic.sanitized_ascii)
  const extractedFinancial = await extractFinancialInvoiceWithAI(finalAscii, {
    filename: meta.filename,
    cardLast4Hint,
  })
  const extraction = removeInvalidInstallments(extractedFinancial)
  const cardLast4 =
    extraction.card_last4
    || cardLast4Hint
    || extractCardLast4FromAscii(finalAscii)

  const sanitizationReport: SanitizationReport = {
    source_lines: deterministic.source_lines,
    local_redactions: deterministic.local_redactions,
    pii_redactions: piiApplied.appliedCount,
    windows_scanned: piiDetection.windows.length,
    sanitized_ascii: finalAscii,
  }

  const payload = buildPreviewPayload(extraction, piiDetection.result, sanitizationReport, finalAscii, cardLast4)

  return {
    payload,
    debug: {
      strategy: 'ascii',
      sourceBank: payload.bank,
      stages: [
        { label: 'Texto extraído do PDF', content: toDebugString(asciiExtraction.asciiText) },
        { label: 'Pré-sanitização local', content: toDebugString(deterministic.sanitized_ascii) },
        { label: 'Janelas enviadas à IA de PII', content: toDebugString(piiDetection.windows.map((window) => window.content).join('\n\n')) },
        { label: 'Redactions de PII sugeridas', content: toDebugString(piiDetection.result) },
        { label: 'ASCII após PII', content: toDebugString(piiApplied.sanitizedAscii) },
        { label: 'ASCII final sanitizado', content: toDebugString(finalAscii) },
        { label: 'Extração financeira canônica', content: toDebugString(extraction) },
      ],
    },
  }
}

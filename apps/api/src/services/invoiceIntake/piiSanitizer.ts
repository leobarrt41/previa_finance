import { sanitizeSensitiveText } from '../textSanitizer.js'
import type { PiiDetectionResult, Redaction, SanitizationReport } from './types.js'

const ACCOUNT_LABEL_RE = /(?<label>\b(?:ag[eê]ncia|agencia|conta(?:\s+corrente|\s+poupan[cç]a)?|account|cc|c\/c)\b[^:\n]{0,30}[:\-]?\s*)(?<value>[^\n]*?)(?=(?:\s+\b(?:cpf|cnpj|cart[aã]o|card|documento|saldo|fatura|vencimento|fechamento|pagamento|r\$|us\$)\b)|$)/gi
const CARD_RAW_RE = /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g
const ADDRESS_LINE_HINTS = [
  'RUA ',
  'AV ',
  'AVENIDA ',
  'ALAMEDA ',
  'TRAVESSA ',
  'RODOVIA ',
  'ESTRADA ',
  'PRAÇA ',
  'PRACA ',
  'BAIRRO ',
  'CEP ',
  'APTO ',
  'APARTAMENTO ',
  'BLOCO ',
  'SALA ',
]
function maskSameLength(value: string, maskChar = '#'): string {
  return value.replace(/\S/g, maskChar)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function applyLabeledRedaction(
  line: string,
  pattern: RegExp,
  category: Redaction['type'],
  lineNumber: number,
  redactions: Redaction[],
): string {
  return line.replace(pattern, (...args: any[]) => {
    const groups = args.at(-1) as { label?: string; value?: string } | undefined
    const label = groups?.label ?? ''
    const value = groups?.value ?? ''
    if (!value) return `${label}${value}`
    redactions.push({
      type: category,
      text: value,
      replacement: maskSameLength(value),
      line_start: lineNumber,
      line_end: lineNumber,
    })
    return `${label}${maskSameLength(value)}`
  })
}

function applyPatternRedaction(
  line: string,
  pattern: RegExp,
  category: Redaction['type'],
  lineNumber: number,
  redactions: Redaction[],
): string {
  return line.replace(pattern, (original) => {
    redactions.push({
      type: category,
      text: original,
      replacement: maskSameLength(original),
      line_start: lineNumber,
      line_end: lineNumber,
    })
    return maskSameLength(original)
  })
}

function normalizeTextForMatching(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildFlexibleRegex(text: string, separatorPattern = '\\s+'): RegExp | null {
  const parts = normalizeTextForMatching(text)
    .split(' ')
    .filter(Boolean)
    .map(escapeRegex)
  if (parts.length === 0) return null
  return new RegExp(parts.join(separatorPattern), 'gi')
}

function isGlobalSensitiveRedaction(redaction: Redaction): boolean {
  return redaction.type === 'nome_titular'
    || redaction.type === 'nome_dependente'
}

function replacementTokenForRedaction(redaction: Redaction): string {
  if (redaction.type === 'nome_titular') return '[NOME_TITULAR]'
  if (redaction.type === 'nome_dependente') return '[NOME_DEPENDENTE]'
  if (redaction.type === 'endereco') return '[ENDERECO]'
  return redaction.replacement
}

function looksLikeResidualAddressLine(line: string): boolean {
  const upper = normalizeTextForMatching(line).toUpperCase()
  if (!upper) return false

  if (ADDRESS_LINE_HINTS.some((hint) => upper.includes(hint.trim()))) {
    return true
  }

  if (/^\s*(?:R|R\.|AV|AV\.|AL|AL\.|TRAV|TRAV\.|EST|EST\.)\s+[A-ZÀ-Ÿ]/.test(upper)) {
    return true
  }

  return /\b(?:ENDERE[CÇ]O|LOGRADOURO|CEP|BAIRRO|N[ÚU]MERO|NUMERO|APTO|APARTAMENTO|SALA|CASA)\b/.test(upper)
}

function applyGlobalTextRedaction(
  lines: string[],
  redaction: Redaction,
): number {
  const regex = buildFlexibleRegex(redaction.text, '[\\s\\W_]*')
  if (!regex) return 0

  let applied = 0
  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index]
    let replaced = false
    const next = current.replace(regex, () => {
      replaced = true
      applied += 1
      return replacementTokenForRedaction(redaction)
    })
    if (replaced) {
      lines[index] = next
    }
  }

  return applied
}

function applyMultiLineRedaction(
  lines: string[],
  redaction: Redaction,
): void {
  const startIndex = Math.max(0, redaction.line_start - 1)
  const endIndex = Math.min(lines.length - 1, redaction.line_end - 1)
  if (startIndex > endIndex) return

  if (startIndex === endIndex) {
    const regex = buildFlexibleRegex(redaction.text)
    const current = lines[startIndex]
    if (regex && regex.test(current)) {
      lines[startIndex] = current.replace(regex, redaction.replacement)
      return
    }
    lines[startIndex] = maskSameLength(current)
    return
  }

  for (let index = startIndex; index <= endIndex; index += 1) {
    lines[index] = maskSameLength(lines[index])
  }
}

export function sanitizeInvoiceAsciiDeterministically(text: string): SanitizationReport {
  const firstPass = sanitizeSensitiveText(text, { includeSemanticRedactions: false })
  const localRedactions: Redaction[] = []
  const lines = firstPass.sanitizedText.split(/\r?\n/)

  const sanitizedLines = lines.map((rawLine, index) => {
    const lineNumber = index + 1
    let line = rawLine
    line = applyLabeledRedaction(line, ACCOUNT_LABEL_RE, 'outro_pii', lineNumber, localRedactions)
    line = applyPatternRedaction(line, CARD_RAW_RE, 'outro_pii', lineNumber, localRedactions)
    return line
  })

  return {
    source_lines: lines.length,
    local_redactions: firstPass.redactions.length + localRedactions.length,
    pii_redactions: 0,
    windows_scanned: 0,
    sanitized_ascii: sanitizedLines.join('\n'),
  }
}

export function applyPiiRedactionsToAscii(
  asciiText: string,
  redactions: Redaction[],
): { sanitizedAscii: string; appliedCount: number } {
  const lines = asciiText.split(/\r?\n/)
  const sortedRedactions = [...redactions].sort((a, b) => a.line_start - b.line_start || a.line_end - b.line_end)
  let appliedCount = 0

  for (const redaction of sortedRedactions) {
    if (isGlobalSensitiveRedaction(redaction)) {
      appliedCount += applyGlobalTextRedaction(lines, redaction)
      continue
    }
    applyMultiLineRedaction(lines, redaction)
    appliedCount += 1
  }

  for (let index = 0; index < lines.length; index += 1) {
    if (!looksLikeResidualAddressLine(lines[index])) continue
    lines[index] = maskSameLength(lines[index])
    appliedCount += 1
  }

  return {
    sanitizedAscii: lines.join('\n'),
    appliedCount,
  }
}

export function buildInvoiceAsciiWindows(
  asciiText: string,
  windowSize = 20,
  overlap = 0,
): Array<{ window_index: number; line_start: number; line_end: number; content: string }> {
  const lines = asciiText.split(/\r?\n/)
  const windows: Array<{ window_index: number; line_start: number; line_end: number; content: string }> = []
  const step = Math.max(1, windowSize - overlap)
  let windowIndex = 0

  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(lines.length, start + windowSize)
    const content = lines
      .slice(start, end)
      .map((line, index) => `${String(start + index + 1).padStart(4, '0')} | ${line}`)
      .join('\n')
    windows.push({
      window_index: windowIndex,
      line_start: start + 1,
      line_end: end,
      content,
    })
    windowIndex += 1
    if (end >= lines.length) break
  }

  return windows
}

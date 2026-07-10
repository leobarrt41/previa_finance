/**
 * textSanitizer.ts
 *
 * Redação determinística de trechos sensíveis antes de enviar texto bruto
 * para serviços externos.
 */

export type RedactionCategory =
  | 'email'
  | 'cpf'
  | 'cnpj'
  | 'cep'
  | 'phone'
  | 'pix'
  | 'card'
  | 'name'
  | 'address'

export type Redaction = {
  category: RedactionCategory
  original: string
  replacement: string
  lineNumber: number
}

export type SanitizedTextResult = {
  sanitizedText: string
  redactions: Redaction[]
}

export type SanitizationOptions = {
  includeSemanticRedactions?: boolean
}

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const CPF_RE = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g
const CNPJ_RE = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g
const CEP_RE = /\b\d{5}-?\d{3}\b/g
const PHONE_RE = /(?<!\d)(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9?\d{4})[-\s]?\d{4}(?!\d)/g
const PIX_RE = /\bchave\s+(?:de\s+)?pix\b[^:\n]{0,40}[:\-]?\s*[^\n]*/gi
const CARD_CONTEXT_RE = /\b(?:CARTAO|CARTÃO|CARD|FINAL)\b/i
const CARD_LAST4_RE = /\b(\d{4})(?:[.\s-]+(?:[Xx*]{4}|\d{4})){2}[.\s-]+(\d{4})\b/gi
const CARD_CONTIGUOUS_RE = /\b\d{16}\b/g

const INLINE_NAME_RE = /(?<label>\b(?:nome(?:\s+do\s+(?:pagador|cliente|titular))?|titular|cliente|consumidor|pagador|sacado|remetente|destinat[aá]rio|respons[aá]vel)\b[^:\n]{0,30}[:\-]?\s*)(?<value>[^\n]*?)(?=(?:\s+\b(?:cart[aã]o|card|cpf|cnpj|conta|ag[eê]ncia|agencia|documento|endere[cç]o|logradouro|bairro|n[úu]mero|num\.?|nº|n°|limite|total|r\$|us\$|saldo|fatura|vencimento|fechamento|pagamento)\b)|$)/gi
const INLINE_ADDRESS_RE = /(?<label>\b(?:endere[cç]o|logradouro|rua|r\.|avenida|av\.|bairro|n[úu]mero|num\.?|nº|n°|bloco|apto|apartamento|sala)\b[^:\n]{0,20}[:\-]?\s*)(?<value>[^\n]*?)(?=(?:\s+\b(?:cpf|cnpj|conta|ag[eê]ncia|agencia|cart[aã]o|card|documento|limite|total|r\$|us\$|saldo|fatura|vencimento|fechamento|pagamento)\b)|$)/gi
const GREETING_NAME_RE = /^\s*(?<greeting>(?:OL[ÁA]|OLA|BOM\s+DIA|BOA\s+TARDE|BOA\s+NOITE))(?<separator>\s*[,!:.-]?\s*|\s+)(?<name>[A-ZÀ-Ÿ][A-ZÀ-Ÿ'.-]*(?:\s+[A-ZÀ-Ÿ][A-ZÀ-Ÿ'.-]*){1,5})(?<tail>\s*[!.,:]?\s*)$/i

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

const SENSITIVE_LINE_HINTS = [
  'CPF',
  'CNPJ',
  'CEP',
  'ENDERE',
  'NOME',
  'TITULAR',
  'CLIENTE',
  'REMETENTE',
  'DESTINAT',
  'SACADO',
  'PAGADOR',
  'RESPONS',
  'PIX',
]

const INVOICE_SECTION_HINTS = [
  'LANCAMENTOS',
  'LANÇAMENTOS',
  'MOVIMENTOS',
  'MOVIMENTAÇÃO',
  'MOVIMENTACAO',
  'TRANSAÇÕES',
  'TRANSACOES',
  'COMPRAS',
  'PAYMENTS',
  'TRANSACTIONS',
]

const INVOICE_SUMMARY_HINTS = [
  'SALDO',
  'TOTAL',
  'PAGAMENTO',
  'PAGAMENTOS',
  'FATURA',
  'VENCIMENTO',
  'FECHAMENTO',
  'ENCARGOS',
  'JUROS',
  'MORA',
  'MENSALIDADE',
  'ANUIDADE',
  'LIMITE',
  'PARCEL',
  'CARTAO',
  'CARTÃO',
  'PLATINUM',
  'GOLD',
  'BLACK',
]

const PERSON_NAME_STOPWORDS = new Set([
  'BANCO',
  'BRASIL',
  'ITAU',
  'ITAU',
  'ITAÚ',
  'BRADESCO',
  'MASTERCARD',
  'VISA',
  'PLATINUM',
  'GOLD',
  'BLACK',
  'RESUMO',
  'FATURA',
  'SALDO',
  'TOTAL',
  'PAGAMENTO',
  'PAGAMENTOS',
  'LANCAMENTOS',
  'LANÇAMENTOS',
  'COMPRAS',
  'SEGURO',
  'SERVICOS',
  'SERVIÇOS',
  'CARTEIRA',
  'BOLSA',
  'CONTA',
  'CARTAO',
  'CARTÃO',
  'PICPAY',
  'NUBANK',
  'C6',
  'SANTANDER',
  'INTER',
  'NEXT',
  'CAIXA',
  'BRADESCO',
])

function maskSameLength(value: string, maskChar = '#'): string {
  return maskChar.repeat(value.length)
}

function maskPreservingWhitespace(value: string, maskChar = '#'): string {
  return value.replace(/\S/g, maskChar)
}

function normalizeMatchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function isLikelyPersonToken(token: string): boolean {
  const cleaned = normalizeMatchText(token).replace(/[^A-Z0-9'.-]/g, '')
  if (!cleaned || cleaned.length < 2) return false
  if (/^\d+$/.test(cleaned)) return false
  if (PERSON_NAME_STOPWORDS.has(cleaned)) return false
  if (/^(?:SA|S\.A\.|LTDA|EIRELI|ME|EPP|S\/A|S A)$/.test(cleaned)) return false
  return /^[A-ZÀ-Ÿ][A-ZÀ-Ÿ'.-]*$/.test(cleaned)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildPhraseRegex(phrase: string): RegExp {
  const normalized = phrase.trim().split(/\s+/).filter(Boolean)
  const parts = normalized.map((token) => escapeRegex(token))
  return new RegExp(`\\b${parts.join('\\s+')}\\b`, 'gi')
}

function collectDynamicNameTerms(lines: string[]): string[] {
  const terms = new Set<string>()
  let inBody = false

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('===== PAGE')) {
      inBody = false
      continue
    }
    if (looksLikeInvoiceSectionLine(line)) {
      inBody = true
      continue
    }

    const upper = normalizeMatchText(line)
    const words = upper.split(' ').filter(Boolean)
    if (words.length === 0) continue

    const hasExplicitNameLabel = /\b(?:nome(?:\s+do\s+(?:pagador|cliente|titular))?|titular|cliente|pagador|sacado|remetente|destinat[aá]rio|respons[aá]vel)\b/i.test(line)
    if (hasExplicitNameLabel) {
      const valueMatch = line.match(/\b(?:nome(?:\s+do\s+(?:pagador|cliente|titular))?|titular|cliente|pagador|sacado|remetente|destinat[aá]rio|respons[aá]vel)\b[^:\n]{0,30}[:\-]?\s*(?<value>[A-ZÀ-Ÿ][A-ZÀ-Ÿ'\.\-]*(?:\s+[A-ZÀ-Ÿ][A-ZÀ-Ÿ'\.\-]*){1,4})/i)
      const value = valueMatch?.groups?.value?.trim()
      if (value) {
        const candidateTokens = value.split(/\s+/).filter(isLikelyPersonToken)
        if (candidateTokens.length >= 2) {
          terms.add(candidateTokens.join(' '))
          for (const token of candidateTokens) {
            terms.add(token)
          }
        }
      }
    }

    if (!inBody) {
      const prefixTokens: string[] = []
      for (const token of words) {
        if (!isLikelyPersonToken(token)) break
        prefixTokens.push(token)
        if (prefixTokens.length >= 4) break
      }

      if (prefixTokens.length >= 2) {
        const remainder = words.slice(prefixTokens.length).join(' ')
        const hasContext = /(?:RESUMO|FATURA|SALDO|TOTAL|PAGAMENTO|VENCIMENTO|FECHAMENTO|PLANO|TITULAR|NUMERO|NÚMERO|DOCUMENTO|BOLETO|BANCO|CARTAO|CARTÃO|CARTEIRA)/i.test(remainder) || !/\d/.test(line)
        if (hasContext) {
          const candidate = prefixTokens.join(' ')
          terms.add(candidate)
          for (const token of prefixTokens) {
            terms.add(token)
          }
        }
      }
    }
  }

  return [...terms].sort((a, b) => b.length - a.length)
}

function redactDynamicNameTerms(
  line: string,
  nameTerms: string[],
  redactions: Redaction[],
  lineNumber: number,
): string {
  let result = line
  for (const term of nameTerms) {
    const regex = term.includes(' ')
      ? buildPhraseRegex(term)
      : new RegExp(`\\b${escapeRegex(term)}\\b`, 'gi')
    result = result.replace(regex, (original) => {
      const replacement = maskSameLength(original)
      redactions.push({ category: 'name', original, replacement, lineNumber })
      return replacement
    })
  }
  return result
}

function redactHeaderNameRuns(
  line: string,
  lineNumber: number,
  redactions: Redaction[],
): string {
  if (lineNumber > 28) return line

  const headerPatterns: RegExp[] = [
    /(?<prefix>^\s*)(?<name>[A-ZÀ-Ÿ][A-ZÀ-Ÿ'.-]*(?:\s+[A-ZÀ-Ÿ][A-ZÀ-Ÿ'.-]*){1,5})(?=\s+(?:Resumo|Total|Pagamento|Saldo|Encargos|Postagem|Vencimento|Emissão|Previsão|Cart[aã]o|O\s+total|Com\s+vencimento|Limite|Banco|Local|Data|Número|Nome|Titular)|$)/,
    /(?<prefix>\b(?:Nome(?:\s+do\s+(?:Pagador|Cliente|Titular))?|Titular|Cliente|Pagador|Sacado|Remetente|Destinat[aá]rio|Respons[aá]vel)\b[^:\n]{0,30}[:\-]?\s*)(?<name>[A-ZÀ-Ÿ][A-ZÀ-Ÿ'.-]*(?:\s+[A-ZÀ-Ÿ][A-ZÀ-Ÿ'.-]*){1,5})/i,
  ]

  let result = line
  for (const pattern of headerPatterns) {
    result = result.replace(pattern, (...args: any[]) => {
      const groups = args.at(-1) as { prefix?: string; name?: string } | undefined
      const prefix = groups?.prefix ?? ''
      const name = groups?.name ?? ''
      if (!name) return `${prefix}${name}`
      const replacement = maskPreservingWhitespace(name)
      redactions.push({ category: 'name', original: name, replacement, lineNumber })
      return `${prefix}${replacement}`
    })
  }

  return result
}

function redactGreetingNameRuns(
  line: string,
  lineNumber: number,
  redactions: Redaction[],
): string {
  return line.replace(GREETING_NAME_RE, (...args: any[]) => {
    const groups = args.at(-1) as { greeting?: string; separator?: string; name?: string; tail?: string } | undefined
    const greeting = groups?.greeting ?? ''
    const separator = groups?.separator ?? ' '
    const name = groups?.name ?? ''
    const tail = groups?.tail ?? ''
    if (!greeting || !name) return args[0] ?? line

    const replacement = maskPreservingWhitespace(name)
    redactions.push({ category: 'name', original: name, replacement, lineNumber })
    return `${greeting}${separator}${replacement}${tail}`
  })
}

function looksLikeAddressLine(line: string): boolean {
  const upper = line.toUpperCase()
  if (ADDRESS_LINE_HINTS.some((hint) => upper.includes(hint))) {
    return true
  }

  if (/^\s*(?:R|R\.|AV|AV\.|AL|AL\.|TRAV|TRAV\.|EST|EST\.)\s+[A-ZÀ-Ÿ]/.test(upper)) {
    return true
  }

  return /\b\d{1,5}\b/.test(upper) && /\b(?:RUA|AVENIDA|ALAMEDA|TRAVESSA|RODOVIA|ESTRADA|PRA[CÇ]A|BAIRRO|APTO|APARTAMENTO|BLOCO|SALA)\b/.test(upper)
}

function redactPattern(
  text: string,
  pattern: RegExp,
  category: RedactionCategory,
  redactions: Redaction[],
  lineNumber: number,
): string {
  return text.replace(pattern, (original) => {
    const replacement = maskSameLength(original)
    redactions.push({ category, original, replacement, lineNumber })
    return replacement
  })
}

function redactLabelledValue(
  line: string,
  pattern: RegExp,
  category: RedactionCategory,
  redactions: Redaction[],
  lineNumber: number,
): string {
  return line.replace(pattern, (...args: any[]) => {
    const groups = args.at(-1) as { label?: string; value?: string } | undefined
    const label = groups?.label ?? ''
    const value = groups?.value ?? ''
    if (!value) return `${label}${value}`
    const replacement = maskPreservingWhitespace(value)
    redactions.push({ category, original: value, replacement, lineNumber })
    return `${label}${replacement}`
  })
}

function maskCardKeepingLast4(text: string): string {
  let result = text.replace(CARD_LAST4_RE, (_match, _prefix: string, last4: string) => `[CARD_LAST4:${last4}]`)

  result = result.replace(CARD_CONTIGUOUS_RE, (original) => {
    const digits = original.replace(/\D/g, '')
    if (digits.length !== 16) return original
    return `[CARD_LAST4:${digits.slice(-4)}]`
  })

  return result
}

function redactCardLines(line: string, redactions: Redaction[], lineNumber: number): string {
  if (!CARD_CONTEXT_RE.test(line)) {
    return line
  }

  const masked = maskCardKeepingLast4(line)
  if (masked !== line) {
    redactions.push({ category: 'card', original: line, replacement: masked, lineNumber })
  }
  return masked
}

function looksLikeInvoiceSectionLine(line: string): boolean {
  const upper = line.toUpperCase()
  return INVOICE_SECTION_HINTS.some((hint) => upper.includes(hint))
}

function looksLikeInvoiceSummaryLine(line: string): boolean {
  const upper = line.toUpperCase()
  return INVOICE_SUMMARY_HINTS.some((hint) => upper.includes(hint))
}

function looksLikeSensitiveHeaderLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false

  const upper = trimmed.toUpperCase()
  if (looksLikeInvoiceSummaryLine(upper)) return false
  if (/\b\d{4}-\d{2}-\d{2}\b|\b\d{2}\/\d{2}\/\d{4}\b|R\$\s*\d|US\$\s*\d/i.test(trimmed)) {
    return false
  }

  if (/\b(?:nome|titular|cliente|pagador|sacado|remetente|destinat[aá]rio|respons[aá]vel|endere[cç]o|logradouro|bairro|apto|apartamento|bloco|sala|cpf|cnpj|conta|ag[eê]ncia|agencia|cart[aã]o|card|final)\b/i.test(trimmed)) {
    return true
  }

  if (/^[A-ZÀ-Ÿ]{12,}$/.test(trimmed.replace(/[^A-ZÀ-Ÿ]/g, ''))) {
    return true
  }

  const words = trimmed.split(/\s+/).filter(Boolean)
  const alphaWords = words.filter((word) => /^[A-ZÀ-Ÿ][A-ZÀ-Ÿ'.-]*$/i.test(word))

  if (alphaWords.length >= 2 && words.length <= 4 && trimmed.length <= 60) {
    return true
  }

  if (/^[A-ZÀ-Ÿ]{3,}(?:[A-ZÀ-Ÿ]{2,}){2,}$/i.test(trimmed.replace(/[^A-ZÀ-Ÿ]/g, ''))) {
    return true
  }

  if (/^[A-ZÀ-Ÿ]{3,},\d{1,5}$/i.test(trimmed.replace(/\s+/g, ''))) {
    return true
  }

  return false
}

export function sanitizeTextForInvoiceDebug(text: string): string {
  const base = sanitizeSensitiveText(text).sanitizedText
  const lines = base.split(/\r?\n/)
  const redactedLines: string[] = []
  let inTransactions = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed) {
      redactedLines.push(line)
      continue
    }

    if (looksLikeInvoiceSectionLine(trimmed)) {
      inTransactions = true
      redactedLines.push(trimmed)
      continue
    }

    if (!inTransactions) {
      if (looksLikeInvoiceSummaryLine(trimmed)) {
        redactedLines.push(line)
      } else if (looksLikeSensitiveHeaderLine(trimmed)) {
        redactedLines.push('[REDACTED]')
      } else {
        redactedLines.push(line)
      }
      continue
    }

    if (looksLikeSensitiveHeaderLine(trimmed)) {
      redactedLines.push('[REDACTED]')
      continue
    }

    redactedLines.push(line)
  }

  return redactedLines.join('\n')
}

function sanitizeLine(
  line: string,
  lineNumber: number,
  redactions: Redaction[],
  includeSemanticRedactions: boolean,
): string {
  const originalLine = line

  let result = line
  result = redactPattern(result, EMAIL_RE, 'email', redactions, lineNumber)
  result = redactPattern(result, CPF_RE, 'cpf', redactions, lineNumber)
  result = redactPattern(result, CNPJ_RE, 'cnpj', redactions, lineNumber)
  result = redactPattern(result, CEP_RE, 'cep', redactions, lineNumber)
  result = redactPattern(result, PHONE_RE, 'phone', redactions, lineNumber)
  result = redactPattern(result, PIX_RE, 'pix', redactions, lineNumber)
  result = redactCardLines(result, redactions, lineNumber)

  if (includeSemanticRedactions) {
    result = redactGreetingNameRuns(result, lineNumber, redactions)
    result = redactLabelledValue(result, INLINE_NAME_RE, 'name', redactions, lineNumber)
    result = redactLabelledValue(result, INLINE_ADDRESS_RE, 'address', redactions, lineNumber)

    if (looksLikeAddressLine(result)) {
      const replacement = maskSameLength(originalLine)
      redactions.push({ category: 'address', original: originalLine, replacement, lineNumber })
      return replacement
    }

    if (SENSITIVE_LINE_HINTS.some((token) => originalLine.toUpperCase().includes(token))) {
      if (originalLine !== result) {
        return result
      }

      if (/\b[A-ZÁÉÍÓÚÃÕÇ][A-ZÁÉÍÓÚÃÕÇ]+\b/.test(originalLine) && originalLine.split(/\s+/).length <= 8) {
        const replacement = maskSameLength(originalLine)
        redactions.push({ category: 'name', original: originalLine, replacement, lineNumber })
        return replacement
      }
    }
  }

  return result
}

export function sanitizeSensitiveText(
  text: string,
  options: SanitizationOptions = {},
): SanitizedTextResult {
  const redactions: Redaction[] = []
  const lines = text.split(/\r?\n/)
  const includeSemanticRedactions = options.includeSemanticRedactions ?? true
  const dynamicNameTerms = includeSemanticRedactions ? collectDynamicNameTerms(lines) : []
  const sanitizedText = text
    .split(/\r?\n/)
    .map((line, index) => {
      const lineNumber = index + 1
      const headerRedacted = includeSemanticRedactions
        ? redactHeaderNameRuns(line, lineNumber, redactions)
        : line
      const sanitizedLine = sanitizeLine(headerRedacted, lineNumber, redactions, includeSemanticRedactions)
      return includeSemanticRedactions
        ? redactDynamicNameTerms(sanitizedLine, dynamicNameTerms, redactions, lineNumber)
        : sanitizedLine
    })
    .join('\n')

  return { sanitizedText, redactions }
}

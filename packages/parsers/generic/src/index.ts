/**
 * @previa/parser-generic
 *
 * Generic Brazilian credit card invoice parser.
 * Heuristic fallback for banks without a dedicated parser.
 *
 * Strategy:
 *   1. Extract text via pdfplumber (same as all other parsers).
 *   2. Detect due date from common Brazilian patterns.
 *   3. Detect summary values (total, previous balance, payments).
 *   4. Detect card last 4 from common patterns.
 *   5. Parse transactions: any line starting with DD/MM followed by
 *      a description and a Brazilian currency amount.
 *   6. Handle all known installment formats:
 *      - "(09/24)"      — Bradesco / Carrefour style
 *      - "PARC09/12"    — PicPay style
 *      - "Parcela 01/03" or "01/03" — Inter / generic style
 *      - "9/24"         — bare fraction in description
 *   7. Detect credits: leading "-", trailing "-", or payment keywords.
 *   8. Skip noise lines: headers, footers, summary rows, card numbers.
 *
 * Confidence levels:
 *   - "high"   : >5 transactions found
 *   - "medium" : 2-5 transactions found
 *   - "low"    : 0-1 transactions found (likely parse failure)
 */

export interface GenericTransaction {
  date: string
  description: string
  category: string
  amountMinor: number
  installment?: string
  country?: string
  originalAmountMinor?: number
  originalCurrencyCode?: string
  exchangeRate?: number
}

export interface GenericInvoiceSummary {
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

export interface GenericInvoice {
  summary: GenericInvoiceSummary
  transactions: GenericTransaction[]
  rawText: string
  /** Confidence of the parse result */
  confidence: 'high' | 'medium' | 'low'
  /** Detected bank name hint, if any */
  detectedBank?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const amountRegex = /\d{1,3}(?:\.\d{3})*,\d{2}/g

function parseAmountToCents(value: string): number | null {
  const normalized = value.replace(/\./g, '').replace(',', '.')
  const num = Number(normalized)
  if (!Number.isFinite(num) || num < 0) return null
  return Math.round(num * 100)
}

function parseDateFromDMY(value: string): Date | null {
  // Accepts DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const m = /^(\d{2})[\/\-\.](\d{2})[\/\-\.](\d{4})$/.exec(value.trim())
  if (!m) return null
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12, 0, 0, 0)
  return Number.isNaN(d.getTime()) ? null : d
}

function parseDateDM(value: string, fallbackYear: number, dueDate?: Date | null): Date | null {
  const m = /^(\d{2})\/(\d{2})$/.exec(value)
  if (!m) return null
  const day = Number(m[1])
  const month = Number(m[2]) - 1
  if (!Number.isFinite(day) || !Number.isFinite(month) || month < 0 || month > 11) return null
  let year = dueDate ? dueDate.getFullYear() : fallbackYear
  const ref = dueDate ?? new Date()
  if (month > ref.getMonth()) year -= 1
  const date = new Date(year, month, day, 12, 0, 0, 0)
  return Number.isNaN(date.getTime()) ? null : date
}

function normalizeLine(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function sanitizeDescription(raw: string): string {
  return raw
    .replace(/\bR\$\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function isGarbageDescription(raw: string): boolean {
  const normalized = normalizeLine(raw).replace(/R\$/g, '').replace(/[^A-Z0-9]/g, '')
  return normalized.length < 2
}

/**
 * Extract installment from description — covers all known Brazilian formats.
 *
 * Formats handled:
 *   "(09/24)"        — Bradesco / Carrefour
 *   "PARC09/12"      — PicPay
 *   "Parcela 01/03"  — Inter
 *   "- Parcela 1/3"  — Inter variant
 *   "01/03"          — bare fraction (only if not a date: day <= 12 and total > 12 OR context)
 */
function extractInstallment(description: string): { current: number; total: number } | null {
  // Format 1: "(09/24)"
  const f1 = /\((\d{1,2})\/(\d{2,3})\)/.exec(description)
  if (f1) {
    const c = Number(f1[1]); const t = Number(f1[2])
    if (c >= 1 && t >= 1 && c <= t && t <= 120) return { current: c, total: t }
  }

  // Format 2: "PARC09/12" or "PARC 09/12"
  const f2 = /PARC\s*0*(\d{1,2})\s*\/\s*0*(\d{1,3})/i.exec(description)
  if (f2) {
    const c = Number(f2[1]); const t = Number(f2[2])
    if (c >= 1 && t >= 1 && c <= t && t <= 120) return { current: c, total: t }
  }

  // Format 3: "Parcela 01/03" or "Parcela 1/3"
  const f3 = /Parcela\s+0*(\d{1,2})\s*\/\s*0*(\d{1,3})/i.exec(description)
  if (f3) {
    const c = Number(f3[1]); const t = Number(f3[2])
    if (c >= 1 && t >= 1 && c <= t && t <= 120) return { current: c, total: t }
  }

  // Format 4: bare "01/03" — only if total > 1 and it's clearly not a date
  // Heuristic: if total <= 12 and current <= total, treat as installment only
  // when the number is preceded by space/dash and followed by end/space
  const f4 = /(?:^|\s|-)0*(\d{1,2})\s*\/\s*0*(\d{1,3})(?:\s|$)/.exec(description)
  if (f4) {
    const c = Number(f4[1]); const t = Number(f4[2])
    // Avoid matching actual dates (DD/MM where both are <= 31)
    if (c >= 1 && t >= 2 && c <= t && t <= 120 && !(c <= 31 && t <= 12)) {
      return { current: c, total: t }
    }
  }

  return null
}

function cleanInstallmentFromDescription(raw: string): string {
  return raw
    .replace(/\s*\(\d{1,2}\/\d{2,3}\)\s*/g, ' ')
    .replace(/\s*PARC\s*\d{1,2}\s*\/\s*\d{1,3}\s*/gi, ' ')
    .replace(/\s*Parcela\s+\d{1,2}\s*\/\s*\d{1,3}\s*/gi, ' ')
    .replace(/\bR\$\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// Bank detection heuristics
// ---------------------------------------------------------------------------

const BANK_HINTS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /banco inter|inter s\.a\.|077\s*-\s*inter/i, name: 'inter' },
  { pattern: /c6 bank|c6bank|banco c6/i, name: 'c6' },
  { pattern: /santander/i, name: 'santander' },
  { pattern: /caixa econ[oô]mica|cef\b/i, name: 'caixa' },
  { pattern: /nubank/i, name: 'nubank' },
  { pattern: /ita[uú]/i, name: 'itau' },
  { pattern: /bradesco|bradescard/i, name: 'bradesco' },
  { pattern: /banco do brasil|bb s\.a\./i, name: 'bb' },
  { pattern: /carrefour/i, name: 'carrefour' },
  { pattern: /picpay/i, name: 'picpay' },
  { pattern: /xp\s+investimentos|xp\s+cartao/i, name: 'xp' },
  { pattern: /next\s+bank|next\s+cartao/i, name: 'next' },
  { pattern: /will\s+bank|willbank/i, name: 'will' },
  { pattern: /neon\s+bank|neon\s+cartao/i, name: 'neon' },
  { pattern: /mercado pago|mercadopago/i, name: 'mercadopago' },
  { pattern: /ame\s+digital|amedigital/i, name: 'ame' },
  { pattern: /porto\s+seguro|portoseguro/i, name: 'porto' },
  { pattern: /hipercard/i, name: 'hipercard' },
  { pattern: /agibank/i, name: 'agibank' },
  { pattern: /banrisul/i, name: 'banrisul' },
  { pattern: /sicoob|sicredi/i, name: 'cooperativa' },
]

function detectBank(text: string): string | undefined {
  for (const hint of BANK_HINTS) {
    if (hint.pattern.test(text)) return hint.name
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Lines to skip — common noise in Brazilian invoices
// ---------------------------------------------------------------------------

const SKIP_PATTERNS: RegExp[] = [
  /^DATA\s+(DESCRICAO|OPERACAO|ESTABELECIMENTO|LANCAMENTO)/,
  /^LANCAMENTOS/,
  /^TRANSACOES\s+(NACIONAIS|INTERNACIONAIS)/,
  /^COMPRAS\s+(NACIONAIS|INTERNACIONAIS)/,
  /^SUBTOTAL/,
  /^TOTAL\s+(DA\s+FATURA|GERAL|PARCELADO|PROXIMO)/,
  /^RESUMO/,
  /^OPCOES\s+DE\s+PAGAMENTO/,
  /^PAGAMENTO\s+(TOTAL|MINIMO|RECEBIDO|POR\s+PIX|POR\s+BOLETO)$/,
  /^PARCELAMENTO/,
  /^ENCARGOS/,
  /^FINANCIAMENTO/,
  /^IMPOSTOS/,
  /^LIMITE/,
  /^SALDO/,
  /^FATURA\s+ANTERIOR$/,
  /^DESPESAS\s+DO\s+MES$/,
  /^CREDITOS\s+E\s+ESTORNOS$/,
  /^VENCIMENTO$/,
  /^FECHAMENTO/,
  /^MELHOR\s+DATA/,
  /^ANUIDADE$/,
  /^SEGUROS$/,
  /^TARIFAS$/,
  /^MULTA$/,
  /^JUROS/,
  /^IOF\s+SOBRE/,
  /^CET$/,
  /^PAGINA\s+\d/,
  /CAMBIO\s+DO\s+DIA/,
  /^DOLAR:/,
  /CNPJ:/,
  /CENTRAL\s+DE\s+ATENDIMENTO/,
  /SAC\s+0800/,
  /OUVIDORIA/,
  /BANCO\s+EMISSOR/,
  /LINHA\s+DIGITAVEL/,
  /CODIGO\s+DE\s+BARRAS/,
  /BENEFICIARIO:/,
  /PAGADOR:/,
  /VALOR\s+DO\s+DOCUMENTO/,
]

function shouldSkipLine(raw: string): boolean {
  const normalized = normalizeLine(raw)
  if (!normalized || normalized.length < 3) return true
  if (SKIP_PATTERNS.some((p) => p.test(normalized))) return true
  // Skip card number patterns
  if (/\d{4}[\s\*\.]{1,5}\d{4}[\s\*\.]{1,5}\d{4}[\s\*\.]{1,5}\d{4}/.test(raw)) return true
  if (/\*{4,}/.test(raw)) return true
  // Skip lines that are only amounts
  if (/^-?\s*R?\$?\s*[\d.,]+\s*-?$/.test(normalized)) return true
  // Skip percentage lines
  if (/^\d+,\d+\s*%/.test(normalized)) return true
  return false
}

// ---------------------------------------------------------------------------
// Category inference (shared heuristics)
// ---------------------------------------------------------------------------

function inferCategory(description: string): string {
  const text = normalizeLine(description)
  if (/PAGAMENTO|CREDITO\s+SALDO|ESTORNO/.test(text)) return 'Pagamentos'
  if (/^IOF/.test(text)) return 'Impostos'
  if (/ANUIDADE/.test(text)) return 'Tarifas'
  if (/MULTA|JUROS|ENCARGO|FIN\s+PARC|ADESAO\s+FIN|ROTATIVO/.test(text)) return 'Encargos'
  if (/SUPERMERCADO|MERCADO|CARREFOUR|ATACADAO|EXTRA|ASSAI|PORCAO|HORTIFRUTI/.test(text)) return 'Supermercado'
  if (/FARMACIA|DROGARIA|DROGA|ULTRAFARMA|PACHECO/.test(text)) return 'Saúde'
  if (/POSTO|COMBUSTIVEL|GASOLINA|PETROBRAS|SHELL|IPIRANGA/.test(text)) return 'Transporte'
  if (/RESTAURANTE|LANCHONETE|IFOOD|RAPPI|UBER\s*EATS|MCDONALDS|BURGER|PIZZA|SUBWAY/.test(text)) return 'Alimentação'
  if (/UBER|99\s*POP|TAXI|METRO|ONIBUS|BRT|BILHETE/.test(text)) return 'Transporte'
  if (/NETFLIX|SPOTIFY|AMAZON|PRIME|DISNEY|YOUTUBE|APPLE|CANVA|SCRIBD|CAPCUT|PADDLE|OPENAI|CHATGPT|ELEVENLABS|GITHUB|CCBILL|GOOGLE\s*ONE|GOOGLE\s*PLAY/.test(text)) return 'Assinaturas'
  if (/HOSPITAL|CLINICA|MEDICO|ODONTO|PLANO\s+DE\s+SAUDE/.test(text)) return 'Saúde'
  if (/ESCOLA|FACULDADE|UNIVERSIDADE|CURSO|EDUCACAO/.test(text)) return 'Educação'
  if (/HOTEL|POUSADA|AIRBNB|BOOKING/.test(text)) return 'Viagem'
  if (/COMPRA\s+PARCELADA|PARCELA/.test(text)) return 'Parcelado'
  return 'Outros'
}

// ---------------------------------------------------------------------------
// PDF extraction
// ---------------------------------------------------------------------------

async function extractPages(buffer: Buffer, password?: string): Promise<string[]> {
  const { execFileSync } = await import('child_process')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  const { writeFileSync, unlinkSync } = await import('fs')

  const tmpFile = join(tmpdir(), `generic-invoice-${Date.now()}.pdf`)
  writeFileSync(tmpFile, buffer)

  try {
    const script = `
import sys, pdfplumber
path = sys.argv[1]
password = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None
pages = []
try:
    with pdfplumber.open(path, password=password) as pdf:
        for page in pdf.pages:
            pages.append(page.extract_text(x_tolerance=3, y_tolerance=3) or '')
except Exception as exc:
    if 'PDFPasswordIncorrect' in str(exc) or 'password' in str(exc).lower():
        print('PDF_PASSWORD_REQUIRED', file=sys.stderr)
        raise SystemExit(2)
    raise
print('\\n===PAGE===\\n'.join(pages))
`
    const args = password ? ['-c', script, tmpFile, password] : ['-c', script, tmpFile]
    const output = execFileSync('python3', args, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    })
    return output.split('===PAGE===').map((page) => page.trim())
  } catch (error) {
    const message = error instanceof Error
      ? `${error.message} ${(error as Error & { stderr?: Buffer | string }).stderr ?? ''}`
      : String(error)
    if (message.includes('PDF_PASSWORD_REQUIRED') || message.includes('PDFPasswordIncorrect')) {
      throw new Error('PDF_PASSWORD_REQUIRED')
    }
    throw error
  } finally {
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Summary parser
// ---------------------------------------------------------------------------

function parseSummary(fullText: string, detectedBank?: string): GenericInvoiceSummary {
  // --- Card last 4 ---
  let cardLast4 = ''
  const cardPatterns = [
    /final\s+(\d{4})/i,
    /cart[aã]o[:\s]+\*{4,}\s*(\d{4})/i,
    /\*{4}\s*(\d{4})$/m,
    /\d{4}\s+\d{4}\s+\d{4}\s+(\d{4})/,
    /cart[aã]o\s+\d{6}\*{6}(\d{4})/i,
  ]
  for (const p of cardPatterns) {
    const m = fullText.match(p)
    if (m?.[1]) { cardLast4 = m[1]; break }
  }

  // --- Product ---
  const product = detectedBank
    ? detectedBank.charAt(0).toUpperCase() + detectedBank.slice(1)
    : 'Cartão de Crédito'

  // --- Due date ---
  let dueDate: Date | null = null
  const dueDatePatterns = [
    /[Vv]encimento[:\s]+(\d{2}[-\/\.]\d{2}[-\/\.]\d{4})/,
    /[Dd]ata\s+de\s+[Vv]encimento[:\s\n]+(\d{2}[-\/\.]\d{2}[-\/\.]\d{4})/,
    /VENCIMENTO[:\s]+(\d{2}[-\/\.]\d{2}[-\/\.]\d{4})/i,
  ]
  for (const p of dueDatePatterns) {
    const m = fullText.match(p)
    if (m?.[1]) {
      dueDate = parseDateFromDMY(m[1].replace(/[-\.]/g, '/'))
      if (dueDate) break
    }
  }
  // Fallback: first DD/MM/YYYY in text
  if (!dueDate) {
    const m = fullText.match(/(\d{2}\/\d{2}\/\d{4})/)
    if (m?.[1]) dueDate = parseDateFromDMY(m[1])
  }

  const dueMonth = dueDate ? dueDate.toISOString().slice(0, 7) : ''
  const invoiceMonth = dueMonth

  // --- Closing date ---
  let closingDate = ''
  const closingMatch = fullText.match(/[Ff]echamento[:\s]+(\d{2}[-\/\.]\d{2}[-\/\.]\d{4})/i)
  if (closingMatch?.[1]) {
    const cd = parseDateFromDMY(closingMatch[1].replace(/[-\.]/g, '/'))
    if (cd) closingDate = cd.toISOString().slice(0, 10)
  }

  // --- Total ---
  let totalMinor = 0
  const totalPatterns = [
    /Total\s+da\s+fatura\s+atual[:\s]*R\$\s*([\d.,]+)/i,
    /Total\s+da\s+sua\s+fatura[:\s]*R\$\s*([\d.,]+)/i,
    /Total\s+da\s+fatura[:\s]*R\$\s*([\d.,]+)/i,
    /TOTAL\s+DA\s+FATURA[:\s]*R\$\s*([\d.,]+)/i,
  ]
  for (const p of totalPatterns) {
    const m = fullText.match(p)
    if (m?.[1]) { totalMinor = parseAmountToCents(m[1]) ?? 0; break }
  }

  // --- Previous balance ---
  const prevMatch = fullText.match(/[Ff]atura\s+anterior[:\s]+([\d.,]+)/i)
  const previousBalanceMinor = prevMatch ? (parseAmountToCents(prevMatch[1]) ?? 0) : 0

  // --- Payments ---
  const payMatch = fullText.match(/[Pp]agamento\s+recebido[:\s]+-?([\d.,]+)/i)
    ?? fullText.match(/[Pp]agamentos?\s+efetuados[:\s]+-?([\d.,]+)/i)
  const paymentsMinor = payMatch ? (parseAmountToCents(payMatch[1]) ?? 0) : 0

  // --- Purchases ---
  const purchMatch = fullText.match(/[Dd]espesas\s+do\s+m[eê]s[:\s]+([\d.,]+)/i)
    ?? fullText.match(/[Ll]an[çc]amentos\s+atuais[:\s]+([\d.,]+)/i)
  const nationalPurchasesMinor = purchMatch ? (parseAmountToCents(purchMatch[1]) ?? 0) : 0

  return {
    cardLast4,
    product,
    invoiceMonth,
    dueDate: dueDate ? dueDate.toISOString().slice(0, 10) : '',
    dueMonth,
    closingDate,
    totalMinor,
    previousBalanceMinor,
    paymentsMinor,
    nationalPurchasesMinor,
    internationalPurchasesMinor: 0,
    chargesMinor: 0,
    openBalanceMinor: totalMinor,
  }
}

// ---------------------------------------------------------------------------
// Transaction parser
// ---------------------------------------------------------------------------

function parseTransactions(fullText: string, summary: GenericInvoiceSummary): GenericTransaction[] {
  const dueDate = summary.dueDate ? new Date(`${summary.dueDate}T12:00:00.000Z`) : null
  const fallbackYear = dueDate ? dueDate.getUTCFullYear() : new Date().getUTCFullYear()

  const lines = fullText
    .replace(/\u00A0/g, ' ')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const items: GenericTransaction[] = []

  // State for international transactions (multi-line)
  let pendingIntl: { date: string; description: string } | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Detect "Dólar: X,XX  X,XX  R$" — Pattern A (all on same line)
    const dolarMatchA = line.match(/D[oó]lar:\s*([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/i)
    if (dolarMatchA && pendingIntl) {
      const usdAmount = parseAmountToCents(dolarMatchA[1]) ?? 0
      const brlAmount = parseAmountToCents(dolarMatchA[3]) ?? 0
      if (brlAmount > 0) {
        const parsedDate = parseDateDM(pendingIntl.date, fallbackYear, dueDate)
        if (parsedDate) {
          items.push({
            date: parsedDate.toISOString().slice(0, 10),
            description: sanitizeDescription(pendingIntl.description),
            category: inferCategory(pendingIntl.description),
            amountMinor: brlAmount,
            country: 'US',
            originalAmountMinor: usdAmount,
            originalCurrencyCode: 'USD',
            exchangeRate: usdAmount > 0 ? brlAmount / usdAmount : undefined,
          })
        }
      }
      pendingIntl = null
      continue
    }

    // Detect "Dólar: X,XX" — Pattern B (BRL on next line)
    const dolarMatchB = line.match(/D[oó]lar:\s*([\d.,]+)\s*$/i)
    if (dolarMatchB && pendingIntl) {
      const usdAmount = parseAmountToCents(dolarMatchB[1]) ?? 0
      const nextLine = lines[i + 1]?.trim() ?? ''
      const nextAmounts = nextLine.match(/^([\d.,]+)\s+([\d.,]+)$/)
      if (nextAmounts) {
        const brlAmount = parseAmountToCents(nextAmounts[2]) ?? 0
        if (brlAmount > 0) {
          const parsedDate = parseDateDM(pendingIntl.date, fallbackYear, dueDate)
          if (parsedDate) {
            items.push({
              date: parsedDate.toISOString().slice(0, 10),
              description: sanitizeDescription(pendingIntl.description),
              category: inferCategory(pendingIntl.description),
              amountMinor: brlAmount,
              country: 'US',
              originalAmountMinor: usdAmount,
              originalCurrencyCode: 'USD',
              exchangeRate: usdAmount > 0 ? brlAmount / usdAmount : undefined,
            })
          }
          i++ // consume next line
        }
      }
      pendingIntl = null
      continue
    }

    // Skip "Câmbio do dia" lines
    if (/C[aâ]mbio\s+do\s+dia/i.test(line)) continue

    // Clear pending intl on any non-dolar line
    if (pendingIntl) pendingIntl = null

    if (shouldSkipLine(line)) continue

    // Must start with "DD/MM "
    const dateMatch = /^(\d{2}\/\d{2})\s+/.exec(line)
    if (!dateMatch?.[1]) continue

    const rest = line.slice(dateMatch[0].length).trim()
    if (!rest) continue

    // Find first amount
    amountRegex.lastIndex = 0
    const amountMatch = amountRegex.exec(rest)
    amountRegex.lastIndex = 0

    if (!amountMatch?.[0]) {
      // No amount — could be international transaction description
      const descCandidate = sanitizeDescription(rest)
      if (descCandidate && !isGarbageDescription(descCandidate) && !shouldSkipLine(descCandidate)) {
        pendingIntl = { date: dateMatch[1], description: descCandidate }
      }
      continue
    }

    const amountStr = amountMatch[0]
    const amountCents = parseAmountToCents(amountStr)
    if (!amountCents) continue

    // Description is everything before the amount
    let description = sanitizeDescription(rest.slice(0, amountMatch.index).trim())
    if (!description || isGarbageDescription(description) || shouldSkipLine(description)) continue

    // Skip payment lines
    const isPayment = /PAGAMENTO.*FATURA|PAGAMENTO.*PIX|PAGAMENTO.*BOLETO|PAGAMENTO\s+DE\s+FATURA/i.test(description)
    if (isPayment) continue

    // Credit detection
    // Bradesco: trailing "-" after amount
    const afterAmount = rest.slice(amountMatch.index + amountStr.length).trimStart()
    const isCredit =
      afterAmount.startsWith('-') ||
      /ESTORNO|CREDITO\s+SALDO/i.test(description) ||
      /^CREDITO/i.test(description) ||
      // Inter: leading "- R$" before amount
      /^-\s*R\$/.test(rest)

    const amountMinor = isCredit ? -Math.abs(amountCents) : amountCents

    // Extract installment
    const inst = extractInstallment(description)
    description = cleanInstallmentFromDescription(description)
    if (!description) continue

    const parsedDate = parseDateDM(dateMatch[1], fallbackYear, dueDate)
    if (!parsedDate) continue

    items.push({
      date: parsedDate.toISOString().slice(0, 10),
      description,
      category: inferCategory(description),
      amountMinor,
      installment: inst ? `${inst.current}/${inst.total}` : undefined,
      country: 'BR',
    })
  }

  // Deduplicate
  return Array.from(
    new Map(
      items.map((item) => [
        `${item.date}|${normalizeLine(item.description)}|${item.amountMinor}`,
        item,
      ])
    ).values()
  )
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function parseGenericInvoice(buffer: Buffer, password?: string): Promise<GenericInvoice> {
  const pages = await extractPages(buffer, password)
  const fullText = pages.join('\n')
  const detectedBank = detectBank(fullText)
  const summary = parseSummary(fullText, detectedBank)
  const transactions = parseTransactions(fullText, summary)

  const txCount = transactions.filter((t) => t.amountMinor > 0).length
  const confidence: GenericInvoice['confidence'] =
    txCount > 5 ? 'high' : txCount >= 2 ? 'medium' : 'low'

  return {
    summary,
    transactions,
    rawText: fullText,
    confidence,
    detectedBank,
  }
}

export function genericInvoiceToForecast(invoice: GenericInvoice): Array<{
  id: string
  competencyMonth: string
  amountMinor: number
  recurrence: 'one-time'
  description: string
}> {
  const { summary } = invoice
  if (summary.openBalanceMinor <= 0) return []
  const bankLabel = invoice.detectedBank ?? 'Cartão'
  return [
    {
      id: `generic-invoice-${summary.invoiceMonth}-${summary.cardLast4 || 'unknown'}`,
      competencyMonth: summary.dueMonth,
      amountMinor: -summary.openBalanceMinor,
      recurrence: 'one-time',
      description: `Fatura ${bankLabel} (${summary.cardLast4 || '****'}) - venc. ${summary.dueDate}`,
    },
  ]
}

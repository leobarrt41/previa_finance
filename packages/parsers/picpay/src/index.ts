/**
 * @previa/parser-picpay
 *
 * PicPay Mastercard GOLD invoice parser.
 *
 * Real PDF structure observed (PicPay_Fatura_052026.pdf):
 *
 *   Page 1 (summary):
 *     "Vencimento: 10-05-2026 | Fechamento: 04-05-2026"
 *     "PicPay Mastercard® GOLD"
 *     "Total da sua fatura   Vencimento   Limite total"
 *     "R$ 1.047,42           10/05/2026   R$ 11.100,00"
 *     "Resumo - Mês de Maio"
 *     "Fatura anterior                    1.106,86"
 *     "Pagamento recebido                -1.531,69"
 *     "Créditos e estornos                 -424,83"
 *     "Despesas do mês                    1.472,25"
 *     "Total da fatura                R$ 1.047,42"
 *
 *   Pages 2-3 (transactions — TWO COLUMN LAYOUT):
 *     Left column: "Picpay Card" section (card holder + card suffix)
 *       "Picpay Card                     LEONARDO B BAPTISTA"
 *       "                                Picpay Card final 1026"
 *       "Tarifas"
 *       "Data  Operação              Valor (R$)"
 *       "08/04 IOF DIARIO ROTATIVO        0,88"
 *       "Operações de crédito contratados"
 *       "Data  Operação              Valor (R$)"
 *       "10/04 ADESAO FIN FATPARC01/03  423,42"
 *       "Transações Nacionais"
 *       "Data  Estabelecimento       Valor (R$)"
 *       "04/04 IOF COMPRA INTERNACIONAL   2,84"
 *       "10/04 PAGAMENTO DE FATURA      424,83"
 *
 *     Right column (same page, different card):
 *       "LEONARDO B BAPTISTA"
 *       "Picpay Card final 1026"
 *       "Transações Nacionais"
 *       "Data  Estabelecimento       Valor (R$)"
 *       "24/04 GOOGLE ONE                 9,99"
 *       "Transações Internacionais"
 *       "Data  Estabelecimento    US$    R$"
 *       "28/04 OPENAI *CHATGPT SU"
 *       "      Dólar: 20,00       20,00  104,74"
 *       "      Câmbio do dia: R$ 5,24"
 *
 * Key observations:
 *   1. Two-column layout — pdfplumber merges columns into interleaved lines.
 *   2. Multiple cards per invoice (final 1026, final 1034, etc.)
 *   3. International transactions span 2-3 lines: description, "Dólar: X" line, "Câmbio" line.
 *   4. Credit indicator: negative value in summary (e.g. "Pagamento recebido -1.531,69")
 *      or "PAGAMENTO DE FATURA" / "CREDITO" in description.
 *   5. Installment format: "PARC09/12" embedded in description (not parentheses).
 *   6. "Subtotal dos lançamentos" and "Total geral dos lançamentos" — stop parsing card section.
 *   7. Due date: "Vencimento: 10-05-2026" (with dashes) or "10/05/2026" in summary table.
 *   8. Card last 4: "Picpay Card final XXXX" or "final XXXX".
 */

export interface PicPayTransaction {
  date: string
  description: string
  category: string
  amountMinor: number
  installment?: string
  country?: string
  originalAmountMinor?: number
  originalCurrencyCode?: string
  exchangeRate?: number
  cardLast4?: string
}

export interface PicPayInvoiceSummary {
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

export interface PicPayInvoice {
  summary: PicPayInvoiceSummary
  transactions: PicPayTransaction[]
  rawText: string
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
  // Accepts DD/MM/YYYY or DD-MM-YYYY
  const m = /^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/.exec(value.trim())
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
 * Extract installment from PicPay description.
 * PicPay format: "EBN*CANVA0461 PARC09/12" — "PARC" followed by "NN/MM"
 * Returns { current, total } or null.
 */
function extractInstallment(description: string): { current: number; total: number } | null {
  // Format: PARCXX/YY or PARC XX/YY
  const m = /PARC\s*0*(\d{1,2})\s*\/\s*0*(\d{1,3})/i.exec(description)
  if (!m) return null
  const current = Number(m[1])
  const total = Number(m[2])
  if (current >= 1 && total >= 1 && current <= total && total <= 120) {
    return { current, total }
  }
  return null
}

function cleanDescription(raw: string): string {
  return raw
    .replace(/\s*PARC\s*\d{1,2}\s*\/\s*\d{1,3}/i, '')
    .replace(/\bR\$\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function shouldSkipLine(raw: string): boolean {
  const normalized = normalizeLine(raw)
  if (!normalized) return true

  const skipPatterns = [
    /^DATA\s+(OPERACAO|ESTABELECIMENTO)/,
    /^TARIFAS$/,
    /^OPERACOES DE CREDITO/,
    /^TRANSACOES NACIONAIS$/,
    /^TRANSACOES INTERNACIONAIS$/,
    /^SUBTOTAL DOS LANCAMENTOS/,
    /^TOTAL GERAL DOS LANCAMENTOS/,
    /^TOTAL PARCELADO/,
    /^RESUMO/,
    /^OPCOES DE PAGAMENTO/,
    /^PAGAMENTO TOTAL/,
    /^PAGAMENTO MINIMO/,
    /^PARCELAMENTO/,
    /^INFORMACAO IMPORTANTE/,
    /^ENCARGOS/,
    /^FINANCIAMENTO/,
    /^IMPOSTOS/,
    /^MELHOR DATA/,
    /^ANUIDADE/,
    /^SEGUROS/,
    /^LIMITE/,
    /^PICPAY CARD\b/,
    /^PICPAY MASTERCARD/,
    /VENCIMENTO.*FECHAMENTO/,
    /^OLA,/,
    /^ESTA E A SUA FATURA/,
    /^FECHAMENTO DA FATURA/,
    /^PAGAMENTO RECEBIDO$/,
    /^CREDITOS E ESTORNOS$/,
    /^DESPESAS DO MES$/,
    /^FATURA ANTERIOR$/,
    /^TOTAL DA FATURA$/,
    /^TOTAL DA SUA FATURA$/,
    /^SAIBA QUAIS/,
    /^PAGAMENTO PARCIAL/,
    /^SAQUES EM ESPECIE/,
    /^IOF SOBRE/,
    /^JUROS DE MORA/,
    /^MULTA$/,
    /^CET$/,
    /^VALOR TOTAL/,
    /^PAGAMENTO MINIMO:/,
    /^JUROS$/,
    /^SALDO FINANCIADO/,
    /^PARCELAMENTO AUTOMATICO/,
    /^PARCELAMENTO EMISSOR/,
    /CAMBIO DO DIA/,
    /^DOLAR:/,
    /PAGINA \d/,
    /LEONARDO B BAPTISTA/,
    /LEONARDO BARRETO BAPTISTA/,
    /R H12B/,
    /SAO JOSE DOS CAMPOS/,
    /CAMPUS DO CTA/,
  ]

  if (skipPatterns.some((p) => p.test(normalized))) return true

  // Skip "Picpay Card final XXXX" lines
  if (/PICPAY CARD FINAL \d{4}/.test(normalized)) return true

  // Skip lines that are only amounts
  if (/^R?\$?\s*[\d.,]+$/.test(normalized)) return true

  // Skip lines with only dashes/numbers (page separators)
  if (/^[-\d\s.,]+$/.test(normalized) && normalized.length < 20) return true

  return false
}

function inferCategory(description: string): string {
  const text = normalizeLine(description)
  if (/PAGAMENTO.*FATURA|PAGAMENTO.*PIX|CREDITO SALDO/.test(text)) return 'Pagamentos'
  if (/IOF/.test(text)) return 'Impostos'
  if (/ANUIDADE/.test(text)) return 'Tarifas'
  if (/MULTA|JUROS|ENCARGO|FIN PARC|ADESAO FIN/.test(text)) return 'Encargos'
  if (/GOOGLE ONE|GOOGLE PLAY|GOOGLE STORAGE/.test(text)) return 'Assinaturas'
  if (/NETFLIX|SPOTIFY|AMAZON MUSIC|AMAZON PRIME|DISNEY|YOUTUBE|APPLE|CANVA|SCRIBD|CAPCUT|PADDLE|OPENAI|CHATGPT|ELEVENLABS|GITHUB|CCBILL/.test(text)) return 'Assinaturas'
  if (/CARREFOUR|ATACADAO|SUPERMERCADO|MERCADO|EXTRA|ASSAI/.test(text)) return 'Supermercado'
  if (/FARMACIA|DROGARIA|DROGA/.test(text)) return 'Saúde'
  if (/POSTO|COMBUSTIVEL|GASOLINA/.test(text)) return 'Transporte'
  if (/RESTAURANTE|LANCHONETE|IFOOD|RAPPI|UBER EATS|MCDONALDS|BURGUER/.test(text)) return 'Alimentação'
  if (/UBER|99|TAXI|METRO|ONIBUS/.test(text)) return 'Transporte'
  if (/PG \*GOSHME|GOSHME/.test(text)) return 'Serviços'
  return 'Outros'
}

// ---------------------------------------------------------------------------
// PDF extraction via pdfplumber
// ---------------------------------------------------------------------------

async function extractPages(buffer: Buffer, password?: string): Promise<string[]> {
  const { execFileSync } = await import('child_process')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  const { writeFileSync, unlinkSync } = await import('fs')

  const tmpFile = join(tmpdir(), `picpay-invoice-${Date.now()}.pdf`)
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

function parseSummary(fullText: string): PicPayInvoiceSummary {
  // --- Product ---
  const product = 'PicPay Mastercard GOLD'

  // --- Card last 4 ---
  // Pattern: "Picpay Card final 1026"
  let cardLast4 = ''
  const cardMatch = fullText.match(/Picpay Card final\s+(\d{4})/i)
  if (cardMatch?.[1]) cardLast4 = cardMatch[1]

  // --- Due date ---
  // Pattern A: "Vencimento: 10-05-2026"
  // Pattern B: "10/05/2026" in the summary table
  let dueDate: Date | null = null
  const patternA = fullText.match(/Vencimento[:\s]+(\d{2}[-\/]\d{2}[-\/]\d{4})/i)
  if (patternA?.[1]) {
    dueDate = parseDateFromDMY(patternA[1].replace(/-/g, '/'))
  }
  if (!dueDate) {
    const patternB = fullText.match(/(\d{2}\/\d{2}\/\d{4})/)
    if (patternB?.[1]) dueDate = parseDateFromDMY(patternB[1])
  }

  // --- Closing date ---
  let closingDate = ''
  const closingMatch = fullText.match(/Fechamento[:\s]+(\d{2}[-\/]\d{2}[-\/]\d{4})/i)
  if (closingMatch?.[1]) {
    const cd = parseDateFromDMY(closingMatch[1].replace(/-/g, '/'))
    if (cd) closingDate = cd.toISOString().slice(0, 10)
  }

  const dueMonth = dueDate ? dueDate.toISOString().slice(0, 7) : ''
  const invoiceMonth = dueMonth

  // --- Total da fatura ---
  // Pattern: "Total da fatura                R$ 1.047,42"
  let totalMinor = 0
  const totalMatch = fullText.match(/Total da fatura\s+R\$\s*([\d.,]+)/i)
  if (totalMatch?.[1]) totalMinor = parseAmountToCents(totalMatch[1]) ?? 0

  // --- Fatura anterior ---
  const prevMatch = fullText.match(/Fatura anterior\s+([\d.,]+)/i)
  const previousBalanceMinor = prevMatch ? (parseAmountToCents(prevMatch[1]) ?? 0) : 0

  // --- Pagamento recebido ---
  const paymentsMatch = fullText.match(/Pagamento recebido\s+-?([\d.,]+)/i)
  const paymentsMinor = paymentsMatch ? (parseAmountToCents(paymentsMatch[1]) ?? 0) : 0

  // --- Despesas do mês ---
  const debitMatch = fullText.match(/Despesas do m[eê]s\s+([\d.,]+)/i)
  const nationalPurchasesMinor = debitMatch ? (parseAmountToCents(debitMatch[1]) ?? 0) : 0

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

/**
 * PicPay PDFs have a two-column layout that pdfplumber merges into interleaved lines.
 * Strategy:
 *   1. Collect ALL lines from all pages.
 *   2. Look for lines starting with "DD/MM " (date prefix).
 *   3. For each date line, extract description and amount.
 *   4. Handle international transactions (multi-line: description, "Dólar: X" line).
 *   5. Skip credit/payment lines (negative amounts in summary context).
 */
function parseTransactions(fullText: string, summary: PicPayInvoiceSummary): PicPayTransaction[] {
  const dueDate = summary.dueDate ? new Date(`${summary.dueDate}T12:00:00.000Z`) : null
  const fallbackYear = dueDate ? dueDate.getUTCFullYear() : new Date().getUTCFullYear()

  const lines = fullText
    .replace(/\u00A0/g, ' ')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const items: PicPayTransaction[] = []

  // Track current card last 4 (for multi-card invoices)
  let currentCardLast4 = summary.cardLast4

  // State for international transactions (multi-line)
  let pendingIntl: {
    date: string
    description: string
    cardLast4: string
  } | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const normalized = normalizeLine(line)

    // Detect card context: "Picpay Card final XXXX"
    const cardCtxMatch = line.match(/Picpay Card final\s+(\d{4})/i)
    if (cardCtxMatch?.[1]) {
      currentCardLast4 = cardCtxMatch[1]
      pendingIntl = null
      continue
    }

    // Detect "Dólar: X,XX" line — part of international transaction
    // Pattern A: "Dólar: 20,00   20,00   104,74" (all on same line)
    // Pattern B: "Dólar: 5,00" (next line has "5,00  27,03")
    const dolarMatch = line.match(/D[oó]lar:\s*([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/i)
    if (dolarMatch && pendingIntl) {
      // Pattern A: all values on same line
      const usdAmount = parseAmountToCents(dolarMatch[1]) ?? 0
      const brlAmount = parseAmountToCents(dolarMatch[3]) ?? 0
      const exchangeRate = usdAmount > 0 ? brlAmount / usdAmount : undefined

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
            exchangeRate,
            cardLast4: pendingIntl.cardLast4,
          })
        }
      }
      pendingIntl = null
      continue
    }

    // Pattern B: "Dólar: X,XX" with only USD amount — BRL is on next line
    const dolarPartialMatch = line.match(/D[oó]lar:\s*([\d.,]+)\s*$/i)
    if (dolarPartialMatch && pendingIntl) {
      const usdAmount = parseAmountToCents(dolarPartialMatch[1]) ?? 0
      // Look ahead for the BRL amount on the next line (format: "5,00  27,03")
      const nextLine = lines[i + 1]?.trim() ?? ''
      const nextAmounts = nextLine.match(/^([\d.,]+)\s+([\d.,]+)$/)
      if (nextAmounts) {
        const brlAmount = parseAmountToCents(nextAmounts[2]) ?? 0
        const exchangeRate = usdAmount > 0 ? brlAmount / usdAmount : undefined
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
              exchangeRate,
              cardLast4: pendingIntl.cardLast4,
            })
          }
          i++ // skip the next line (already consumed)
        }
      }
      pendingIntl = null
      continue
    }

    // Skip "Câmbio do dia" lines
    if (/C[aâ]mbio do dia/i.test(line)) {
      continue
    }

    // Clear pending intl if we hit a non-dolar line after description
    if (pendingIntl) {
      pendingIntl = null
    }

    if (shouldSkipLine(line)) continue

    // Must start with "DD/MM "
    const dateMatch = /^(\d{2}\/\d{2})\s+/.exec(line)
    if (!dateMatch?.[1]) continue

    const rest = line.slice(dateMatch[0].length).trim()
    if (!rest) continue

    // Find first amount in the rest
    amountRegex.lastIndex = 0
    const amountMatch = amountRegex.exec(rest)
    amountRegex.lastIndex = 0

    if (!amountMatch?.[0]) {
      // No amount on this line — could be international transaction description
      // (amount is on the next "Dólar:" line)
      const descCandidate = sanitizeDescription(rest)
      if (descCandidate && !isGarbageDescription(descCandidate) && !shouldSkipLine(descCandidate)) {
        pendingIntl = {
          date: dateMatch[1],
          description: descCandidate,
          cardLast4: currentCardLast4,
        }
      }
      continue
    }

    const amountStr = amountMatch[0]
    const amountCents = parseAmountToCents(amountStr)
    if (!amountCents) continue

    // Description is everything before the amount
    let description = sanitizeDescription(rest.slice(0, amountMatch.index).trim())
    if (!description || isGarbageDescription(description) || shouldSkipLine(description)) continue

    // Credit detection — skip payment lines entirely (they are not expenses)
    const isPayment =
      /PAGAMENTO.*FATURA|PAGAMENTO.*PIX|PAGAMENTO DE FATURA/i.test(description) ||
      /CREDITO SALDO/i.test(description)
    if (isPayment) continue

    const isCredit =
      /ESTORNO/i.test(description) ||
      /^CREDITO/i.test(description)

    const amountMinor = isCredit ? -Math.abs(amountCents) : amountCents

    // Extract installment (PicPay format: "PARC09/12")
    const inst = extractInstallment(description)
    description = cleanDescription(description)
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
      cardLast4: currentCardLast4,
    })
  }

  // Deduplicate by date|description|amount
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

export function isPicPayInvoice(text: string): boolean {
  return /picpay/i.test(text) && /mastercard/i.test(text)
}

export async function parsePicPayInvoice(buffer: Buffer, password?: string): Promise<PicPayInvoice> {
  const pages = await extractPages(buffer, password)
  const fullText = pages.join('\n')
  const summary = parseSummary(fullText)
  const transactions = parseTransactions(fullText, summary)

  return {
    summary,
    transactions,
    rawText: fullText,
  }
}

export function picPayInvoiceToForecast(invoice: PicPayInvoice): Array<{
  id: string
  competencyMonth: string
  amountMinor: number
  recurrence: 'one-time'
  description: string
}> {
  const { summary } = invoice
  if (summary.openBalanceMinor <= 0) return []
  return [
    {
      id: `picpay-invoice-${summary.invoiceMonth}-${summary.cardLast4}`,
      competencyMonth: summary.dueMonth,
      amountMinor: -summary.openBalanceMinor,
      recurrence: 'one-time',
      description: `Fatura PicPay ${summary.product} (${summary.cardLast4}) - venc. ${summary.dueDate}`,
    },
  ]
}

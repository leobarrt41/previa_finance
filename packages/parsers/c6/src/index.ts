/**
 * @previa/parser-c6
 *
 * C6 Bank credit card invoice parser.
 *
 * Real PDF structure observed (597084748-Fatura-C6-Bank-CH-MP.pdf):
 *
 *   Page 1 (summary):
 *     "Olá, Champ! Sua fatura com vencimento em Agosto chegou no valor de R$ 0,00."
 *     "Vencimento: 10 de Agosto"         ← month by name, NO year on this line
 *     "Valor da fatura: R$ 0,00"
 *     "Pagamento mínimo: R$ 0,00"
 *     "Valor remanescente da fatura anterior: R$ 0,00"
 *
 *   Page 2 (summary table):
 *     "Resumo da fatura"
 *     "Compras e pagamentos feitos até o fechamento desta fatura em 29/07/22."
 *     "Compras nacionais                                                3,50"
 *     "Compras internacionais                                           0,00"
 *     "Valores creditados"
 *     "Pagamento antecipado                                        (-) 23,31"
 *     "Total a pagar                                                    0,00"
 *
 *   Page 3 (transactions — ONE COLUMN, simple):
 *     "Transações dos cartões adicionais"
 *     "Cartão C6 Final 9256 - Mariana        Subtotal deste cartão R$ 3,50"
 *     "                                                    Valores em reais"
 *     "10 jul   APPLE COM BILL                                          3,50"
 *
 * Key observations:
 *   1. Date format: "DD MMM" (e.g. "10 jul") — no year, no slash.
 *   2. Vencimento: "Vencimento: 10 de Agosto" — month by name, year from closing date.
 *   3. Closing date: "fechamento desta fatura em DD/MM/YY" — has year (2-digit).
 *   4. Card section: "Cartão C6 Final XXXX - Name" — last4 = XXXX.
 *   5. Transaction line: "DD MMM   DESCRIPTION   VALUE"
 *      - Value is right-aligned, no "R$" prefix on transaction lines.
 *      - Credits in summary: "(-) VALUE" — not as individual transactions.
 *   6. Parcelamento: likely "DESCRIPTION 01/12" or "(01/12)" — not seen in this sample.
 *   7. International: not seen in this sample — assume same "DD MMM" date format.
 *   8. One column layout — no interleaving issues.
 *   9. "Subtotal deste cartão R$ X,XX" — stop collecting for this card section.
 *  10. Multiple cards per invoice: "Cartão C6 Final XXXX - Name" sections.
 */

export interface C6Transaction {
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
  cardHolder?: string
}

export interface C6InvoiceSummary {
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

export interface C6Invoice {
  summary: C6InvoiceSummary
  transactions: C6Transaction[]
  rawText: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTH_MAP: Record<string, number> = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
  janeiro: 1, fevereiro: 2, março: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
}

function parseAmountToCents(value: string): number | null {
  const normalized = value.replace(/\./g, '').replace(',', '.')
  const num = Number(normalized)
  if (!Number.isFinite(num) || num < 0) return null
  return Math.round(num * 100)
}

function parseDateFromDMY(value: string): Date | null {
  // Accepts DD/MM/YYYY or DD/MM/YY
  const m = /^(\d{2})\/(\d{2})\/(\d{2,4})$/.exec(value.trim())
  if (!m) return null
  let year = Number(m[3])
  if (year < 100) year += 2000
  const d = new Date(year, Number(m[2]) - 1, Number(m[1]), 12, 0, 0, 0)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Parse C6 date format: "DD MMM" (e.g. "10 jul", "28 fev")
 * Year is inferred from the closing date or due date.
 */
function parseDateDMMMM(day: string, monthStr: string, closingDate: Date | null, dueDate: Date | null): Date | null {
  const monthNum = MONTH_MAP[monthStr.toLowerCase().trim()]
  if (!monthNum) return null
  const dayNum = Number(day)
  if (!Number.isFinite(dayNum) || dayNum < 1 || dayNum > 31) return null

  // Infer year: use closing date year; if month is ahead of closing month, use previous year
  const ref = closingDate ?? dueDate ?? new Date()
  let year = ref.getFullYear()
  if (monthNum > ref.getMonth() + 1) year -= 1

  const date = new Date(year, monthNum - 1, dayNum, 12, 0, 0, 0)
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
  const normalized = normalizeLine(raw).replace(/[^A-Z0-9]/g, '')
  return normalized.length < 2
}

/**
 * Extract installment from C6 description.
 * C6 may use "(01/12)" or bare "01/12" in description.
 */
function extractInstallment(description: string): { current: number; total: number } | null {
  // Format 1: "(01/12)"
  const f1 = /\((\d{1,2})\/(\d{2,3})\)/.exec(description)
  if (f1) {
    const c = Number(f1[1]); const t = Number(f1[2])
    if (c >= 1 && t >= 1 && c <= t && t <= 120) return { current: c, total: t }
  }

  // Format 2: bare "01/12" not a date (total > 12 or both <= 12 but context)
  const f2 = /(?:^|\s)0*(\d{1,2})\s*\/\s*0*(\d{1,3})(?:\s|$)/.exec(description)
  if (f2) {
    const c = Number(f2[1]); const t = Number(f2[2])
    if (c >= 1 && t >= 2 && c <= t && t <= 120 && !(c <= 31 && t <= 12)) {
      return { current: c, total: t }
    }
  }

  return null
}

function cleanInstallmentFromDescription(raw: string): string {
  return raw
    .replace(/\s*\(\d{1,2}\/\d{2,3}\)\s*/g, ' ')
    .replace(/\bR\$\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function shouldSkipLine(raw: string): boolean {
  const normalized = normalizeLine(raw)
  if (!normalized || normalized.length < 3) return true

  const skipPatterns = [
    /^OLA,/,
    /^SUA FATURA/,
    /^VENCIMENTO:?\s+\d/,
    /^PAGAMENTO MINIMO/,
    /^DESPESAS FUTURAS/,
    /^VALOR REMANESCENTE/,
    /^RESUMO DA FATURA/,
    /^COMPRAS E PAGAMENTOS/,
    /^COMPRAS NACIONAIS$/,
    /^COMPRAS INTERNACIONAIS$/,
    /^ANUIDADE/,
    /^TARIFA/,
    /^IOF/,
    /^JUROS/,
    /^MULTAS/,
    /^VALORES CREDITADOS/,
    /^PAGAMENTO ANTECIPADO/,
    /^TOTAL A PAGAR/,
    /^TRANSACOES DOS CARTOES/,
    /^LEMBRANDO:/,
    /^SUBTOTAL DESTE CARTAO/,
    /^VALORES EM REAIS/,
    /^PAGAMENTO DA FATURA/,
    /^DETALHES SOBRE/,
    /^PAGAMENTO MINIMO DA FATURA/,
    /^FATURA COM SALDO/,
    /^ANTECIPACAO DA FATURA/,
    /^VOCE PODE PAGAR/,
    /^EM ALGUNS CASOS/,
    /^ATE A DATA/,
    /^VALOR MINIMO/,
    /^AO ESCOLHER/,
    /^CASO VOCE/,
    /^SE PREFERIR/,
    /^DUVIDAS FREQUENTES/,
    /^QUANTO TEMPO/,
    /^POSSO ANTECIPAR/,
    /^COMO FACO/,
    /^SE O PAGAMENTO/,
    /^VOCE PODE ANTECIPAR/,
    /^FALE COM/,
    /^CENTRAL DE RELACIONAMENTO/,
    /^CHAT PARA CLIENTES/,
    /^NO APP DO C6/,
    /^CAPITAIS/,
    /^DEMAIS LOCALIDADES/,
    /^WHATSAPP/,
    /^E-MAIL/,
    /^SAC\b/,
    /^OUVIDORIA/,
    /^CONTRATANDO O DEBITO/,
    /^ENCARGOS/,
    /^FATURA ATUAL/,
    /^TOTAL \(DETALHES/,
    /^DESPESAS DA FATURA/,
    /^SALDO ROTATIVO/,
    /^SALDO REMANESCENTE/,
    /^PAGAMENTO MINIMO OBRIGATORIO/,
    /^VALOR DO PAGAMENTO/,
    /^ENCARGOS DA PROX/,
    /^CASO VOCE REALIZE/,
    /^JUROS ROTATIVO/,
    /^IOF DO ROTATIVO/,
    /^CET DO FINANCIAMENTO/,
    /^ENCARGOS E IOF/,
    /^ENCARGOS COBRADOS/,
    /^PARCELAMENTO DESTA FATURA/,
    /^VALOR DA FATURA ATUAL/,
    /^VALOR DO PAGAMENTO PARCELA/,
    /^JUROS DO PARCELAMENTO/,
    /^IOF DO PARCELAMENTO/,
    /^VALOR TOTAL FINANCIADO/,
    /^VALOR TOTAL A PAGAR/,
    /^ENCARGOS DO PARCELAMENTO/,
    /^ENCARGOS DO FINANCIAMENTO/,
    /^FINANCIAMENTO DO PAGAMENTO/,
    /^ENCARGOS MAXIMOS/,
    /CNPJ:/,
    /C6 BANK/,
    /FALECONOSCO@/,
    /3003\s+6116/,
    /0800\s+660/,
    /^\d+\/\d+$/, // page numbers like "1/5"
  ]

  if (skipPatterns.some((p) => p.test(normalized))) return true

  // Skip card section header lines: "Cartão C6 Final XXXX - Name"
  if (/CARTAO C6 FINAL \d{4}/.test(normalized)) return true

  // Skip lines that are only amounts or percentages
  if (/^-?\s*\(?\s*-?\s*[\d.,]+\s*\)?$/.test(normalized)) return true
  if (/^\d+,\d+\s*%/.test(normalized)) return true

  return false
}

function inferCategory(description: string): string {
  const text = normalizeLine(description)
  if (/PAGAMENTO|CREDITO\s+SALDO|ESTORNO/.test(text)) return 'Pagamentos'
  if (/^IOF/.test(text)) return 'Impostos'
  if (/ANUIDADE/.test(text)) return 'Tarifas'
  if (/MULTA|JUROS|ENCARGO|ROTATIVO/.test(text)) return 'Encargos'
  if (/SUPERMERCADO|MERCADO|CARREFOUR|ATACADAO|EXTRA|ASSAI/.test(text)) return 'Supermercado'
  if (/FARMACIA|DROGARIA|DROGA/.test(text)) return 'Saúde'
  if (/POSTO|COMBUSTIVEL|GASOLINA|PETROBRAS|SHELL|IPIRANGA/.test(text)) return 'Transporte'
  if (/RESTAURANTE|LANCHONETE|IFOOD|RAPPI|UBER\s*EATS|MCDONALDS|BURGER/.test(text)) return 'Alimentação'
  if (/UBER|99\s*POP|TAXI|METRO|ONIBUS/.test(text)) return 'Transporte'
  if (/NETFLIX|SPOTIFY|AMAZON|PRIME|DISNEY|YOUTUBE|APPLE|CANVA|SCRIBD|CAPCUT|PADDLE|OPENAI|CHATGPT|ELEVENLABS|GITHUB|GOOGLE/.test(text)) return 'Assinaturas'
  if (/HOSPITAL|CLINICA|MEDICO|ODONTO/.test(text)) return 'Saúde'
  if (/ESCOLA|FACULDADE|CURSO/.test(text)) return 'Educação'
  if (/HOTEL|POUSADA|AIRBNB|BOOKING/.test(text)) return 'Viagem'
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

  const tmpFile = join(tmpdir(), `c6-invoice-${Date.now()}.pdf`)
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

function parseSummary(fullText: string): C6InvoiceSummary {
  const product = 'Cartão C6'

  // --- Closing date: "fechamento desta fatura em DD/MM/YY" ---
  let closingDate = ''
  let closingDateObj: Date | null = null
  const closingMatch = fullText.match(/fechamento\s+desta\s+fatura\s+em\s+(\d{2}\/\d{2}\/\d{2,4})/i)
  if (closingMatch?.[1]) {
    closingDateObj = parseDateFromDMY(closingMatch[1])
    if (closingDateObj) closingDate = closingDateObj.toISOString().slice(0, 10)
  }

  // --- Due date: "Vencimento: DD de MÊS" ---
  // Year is inferred from closing date year
  let dueDate: Date | null = null
  const dueMatch = fullText.match(/Vencimento:\s+(\d{1,2})\s+de\s+([A-Za-zÀ-ú]+)/i)
  if (dueMatch?.[1] && dueMatch?.[2]) {
    const monthNum = MONTH_MAP[dueMatch[2].toLowerCase().trim()]
    if (monthNum) {
      const refYear = closingDateObj ? closingDateObj.getFullYear() : new Date().getFullYear()
      dueDate = new Date(refYear, monthNum - 1, Number(dueMatch[1]), 12, 0, 0, 0)
      // If due month is before closing month, it's the next year
      if (closingDateObj && monthNum < closingDateObj.getMonth() + 1) {
        dueDate = new Date(refYear + 1, monthNum - 1, Number(dueMatch[1]), 12, 0, 0, 0)
      }
    }
  }

  const dueMonth = dueDate ? dueDate.toISOString().slice(0, 7) : closingDateObj?.toISOString().slice(0, 7) ?? ''
  const invoiceMonth = dueMonth

  // --- Card last 4: "Cartão C6 Final XXXX" ---
  let cardLast4 = ''
  const cardMatch = fullText.match(/Cart[aã]o\s+C6\s+Final\s+(\d{4})/i)
  if (cardMatch?.[1]) cardLast4 = cardMatch[1]

  // --- Total: "Valor da fatura: R$ X,XX" ---
  let totalMinor = 0
  const totalMatch = fullText.match(/Valor\s+da\s+fatura:\s+R\$\s*([\d.,]+)/i)
  if (totalMatch?.[1]) totalMinor = parseAmountToCents(totalMatch[1]) ?? 0

  // --- Previous balance ---
  const prevMatch = fullText.match(/Valor\s+remanescente\s+da\s+fatura\s+anterior[:\s]*([\d.,]+)/i)
  const previousBalanceMinor = prevMatch ? (parseAmountToCents(prevMatch[1]) ?? 0) : 0

  // --- Payments (credited values) ---
  const payMatch = fullText.match(/Pagamento\s+antecipado[:\s]*\(-\)\s*([\d.,]+)/i)
    ?? fullText.match(/Pagamento\s+recebido[:\s]*-?([\d.,]+)/i)
  const paymentsMinor = payMatch ? (parseAmountToCents(payMatch[1]) ?? 0) : 0

  // --- National purchases ---
  const natMatch = fullText.match(/Compras\s+nacionais[:\s]*([\d.,]+)/i)
  const nationalPurchasesMinor = natMatch ? (parseAmountToCents(natMatch[1]) ?? 0) : 0

  // --- International purchases ---
  const intlMatch = fullText.match(/Compras\s+internacionais[:\s]*([\d.,]+)/i)
  const internationalPurchasesMinor = intlMatch ? (parseAmountToCents(intlMatch[1]) ?? 0) : 0

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
    internationalPurchasesMinor,
    chargesMinor: 0,
    openBalanceMinor: totalMinor,
  }
}

// ---------------------------------------------------------------------------
// Transaction parser
// ---------------------------------------------------------------------------

function parseTransactions(fullText: string, summary: C6InvoiceSummary): C6Transaction[] {
  const closingDate = summary.closingDate ? new Date(`${summary.closingDate}T12:00:00.000Z`) : null
  const dueDate = summary.dueDate ? new Date(`${summary.dueDate}T12:00:00.000Z`) : null

  const lines = fullText
    .replace(/\u00A0/g, ' ')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const items: C6Transaction[] = []

  // Track current card context
  let currentCardLast4 = summary.cardLast4
  let currentCardHolder = ''

  // State for international transactions
  let pendingIntl: { day: string; monthStr: string; description: string; cardLast4: string; cardHolder: string } | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const normalized = normalizeLine(line)

    // Detect card section: "Cartão C6 Final XXXX - Name"
    const cardCtxMatch = line.match(/Cart[aã]o\s+C6\s+Final\s+(\d{4})(?:\s*-\s*(.+))?/i)
    if (cardCtxMatch?.[1]) {
      currentCardLast4 = cardCtxMatch[1]
      currentCardHolder = cardCtxMatch[2]?.trim() ?? ''
      pendingIntl = null
      continue
    }

    // Detect international "Dólar: X,XX  X,XX  R$" — Pattern A
    const dolarMatchA = line.match(/D[oó]lar:\s*([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/i)
    if (dolarMatchA && pendingIntl) {
      const usdAmount = parseAmountToCents(dolarMatchA[1]) ?? 0
      const brlAmount = parseAmountToCents(dolarMatchA[3]) ?? 0
      if (brlAmount > 0) {
        const parsedDate = parseDateDMMMM(pendingIntl.day, pendingIntl.monthStr, closingDate, dueDate)
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
            cardLast4: pendingIntl.cardLast4,
            cardHolder: pendingIntl.cardHolder,
          })
        }
      }
      pendingIntl = null
      continue
    }

    // Detect international "Dólar: X,XX" — Pattern B (BRL on next line)
    const dolarMatchB = line.match(/D[oó]lar:\s*([\d.,]+)\s*$/i)
    if (dolarMatchB && pendingIntl) {
      const usdAmount = parseAmountToCents(dolarMatchB[1]) ?? 0
      const nextLine = lines[i + 1]?.trim() ?? ''
      const nextAmounts = nextLine.match(/^([\d.,]+)\s+([\d.,]+)$/)
      if (nextAmounts) {
        const brlAmount = parseAmountToCents(nextAmounts[2]) ?? 0
        if (brlAmount > 0) {
          const parsedDate = parseDateDMMMM(pendingIntl.day, pendingIntl.monthStr, closingDate, dueDate)
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
              cardLast4: pendingIntl.cardLast4,
              cardHolder: pendingIntl.cardHolder,
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

    // C6 transaction format: "DD MMM   DESCRIPTION   VALUE"
    // Date: "10 jul", "28 fev", "3 ago", etc.
    const dateMatch = /^(\d{1,2})\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\s+/i.exec(line)
    if (!dateMatch) continue

    const day = dateMatch[1]
    const monthStr = dateMatch[2]
    const rest = line.slice(dateMatch[0].length).trim()
    if (!rest) continue

    // Find last amount in the rest (right-aligned value)
    // C6 puts value at the end, no "R$" prefix on transaction lines
    const allAmounts = [...rest.matchAll(/\d{1,3}(?:\.\d{3})*,\d{2}/g)]
    if (allAmounts.length === 0) {
      // No amount — could be international transaction description
      const descCandidate = sanitizeDescription(rest)
      if (descCandidate && !isGarbageDescription(descCandidate) && !shouldSkipLine(descCandidate)) {
        pendingIntl = { day, monthStr, description: descCandidate, cardLast4: currentCardLast4, cardHolder: currentCardHolder }
      }
      continue
    }

    // Use the LAST amount found (right-aligned value)
    const lastAmountMatch = allAmounts[allAmounts.length - 1]
    const amountStr = lastAmountMatch[0]
    const amountCents = parseAmountToCents(amountStr)
    if (!amountCents) continue

    // Description is everything before the last amount
    let description = sanitizeDescription(rest.slice(0, lastAmountMatch.index).trim())
    if (!description || isGarbageDescription(description) || shouldSkipLine(description)) continue

    // Skip payment lines
    const isPayment = /PAGAMENTO.*FATURA|PAGAMENTO.*PIX|PAGAMENTO.*BOLETO|PAGAMENTO\s+DE\s+FATURA/i.test(description)
    if (isPayment) continue

    // Credit detection
    const isCredit = /ESTORNO|CREDITO\s+SALDO/i.test(description) || /^CREDITO/i.test(description)
    const amountMinor = isCredit ? -Math.abs(amountCents) : amountCents

    // Extract installment
    const inst = extractInstallment(description)
    description = cleanInstallmentFromDescription(description)
    if (!description) continue

    const parsedDate = parseDateDMMMM(day, monthStr, closingDate, dueDate)
    if (!parsedDate) continue

    items.push({
      date: parsedDate.toISOString().slice(0, 10),
      description,
      category: inferCategory(description),
      amountMinor,
      installment: inst ? `${inst.current}/${inst.total}` : undefined,
      country: 'BR',
      cardLast4: currentCardLast4,
      cardHolder: currentCardHolder,
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

export function isC6Invoice(text: string): boolean {
  return /c6\s+bank|banco\s+c6|cart[aã]o\s+c6/i.test(text)
}

export async function parseC6Invoice(buffer: Buffer, password?: string): Promise<C6Invoice> {
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

export function c6InvoiceToForecast(invoice: C6Invoice): Array<{
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
      id: `c6-invoice-${summary.invoiceMonth}-${summary.cardLast4}`,
      competencyMonth: summary.dueMonth,
      amountMinor: -summary.openBalanceMinor,
      recurrence: 'one-time',
      description: `Fatura C6 Bank (${summary.cardLast4}) - venc. ${summary.dueDate}`,
    },
  ]
}

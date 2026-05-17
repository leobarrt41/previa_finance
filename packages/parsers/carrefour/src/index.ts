/**
 * @previa/parser-carrefour
 *
 * Cartão Carrefour Gold Mastercard invoice parser.
 *
 * Real PDF structure observed (000006701449763920260410.PDF, pwd: 0729):
 *
 *   Page 1 (header):
 *     "FATURA MENSAL CARTÃO CARREFOUR GOLD MASTERCARD   TITULAR:LEONARDO BAPTISTA"
 *     "CARTÃO: 530033******9277"
 *     "TOTAL DA SUA FATURA   VENCIMENTO   LIMITE DE CRÉDITO"
 *     "R$ 0,00               10/04/2026   R$3.410,00"
 *     ...
 *     "RESUMO DA FATURA EM R$"
 *     "Total da fatura anterior:   R$ 69,15"
 *     "(+) Pagamentos efetuados/créditos:   R$ 69,15"
 *     "(-) Lançamentos atuais/débitos:   R$ 0,00"
 *     "TOTAL DA FATURA ATUAL:   R$ 0,00"
 *
 *   Transaction section:
 *     "LANÇAMENTOS NO BRASIL"
 *     "DATA DESCRIÇÃO   VALOR R$"
 *     "      SALDO FATURA ANTERIOR   69,15"
 *     "LEONARDO BAPTISTA   530033******9277"
 *     "06/03   Pagamento de Fatura via PIX   69,15-"
 *     "TOTAL DA FATURA   R$ 0,00"
 *
 * Key observations:
 *   1. Due date: "VENCIMENTO" header on same line as "TOTAL DA SUA FATURA",
 *      date is on the NEXT line in DD/MM/YYYY format.
 *   2. Card last 4: "CARTÃO: 530033******9277" — last 4 digits.
 *   3. Product: "CARTÃO CARREFOUR GOLD MASTERCARD" from the title line.
 *   4. Transactions start after "LANÇAMENTOS NO BRASIL" / "DATA DESCRIÇÃO".
 *   5. Credit indicator: trailing "-" on amount (e.g. "69,15-").
 *   6. "SALDO FATURA ANTERIOR" line has no date prefix — skip it.
 *   7. Card holder line (e.g. "LEONARDO BAPTISTA   530033******9277") — skip.
 *   8. "TOTAL DA FATURA" line — stop parsing.
 */

export interface CarrefourTransaction {
  date: string
  description: string
  category: string
  amountMinor: number
  installment?: string
  country?: string
}

export interface CarrefourInvoiceSummary {
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

export interface CarrefourInvoice {
  summary: CarrefourInvoiceSummary
  transactions: CarrefourTransaction[]
  rawText: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const datePrefixRegex = /^(\d{2}\/\d{2})\s+/
const amountRegex = /\d{1,3}(?:\.\d{3})*,\d{2}/g
const installmentRegex = /\((\d{1,2})\/(\d{2,3})\)/

function parseAmountToCents(value: string): number | null {
  const normalized = value.replace(/\./g, '').replace(',', '.')
  const num = Number(normalized)
  if (!Number.isFinite(num) || num < 0) return null
  return Math.round(num * 100)
}

function parseDateFromDMY(value: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim())
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
  return normalized.length === 0
}

function shouldSkipLine(raw: string): boolean {
  const normalized = normalizeLine(raw)
  if (!normalized) return true

  const skipPatterns = [
    /^DATA\s+DESCRICAO/,
    /^LANCAMENTOS NO BRASIL/,
    /^LANCAMENTOS NO EXTERIOR/,
    /^TOTAL DA FATURA/,
    /^SALDO FATURA ANTERIOR/,
    /^RESUMO DA FATURA/,
    /^PREVISAO PARA FECHAMENTO/,
    /^SALDOS FUTUROS/,
    /^ENCARGOS FINANCEIROS/,
    /^OUTRAS ALTERNATIVAS/,
    /^PARCELE FACIL/,
    /^PAGAMENTO MINIMO/,
    /^LIMITES EM R/,
    /^LIMITE DE CREDITO/,
    /^LIMITE DE RETIRADA/,
    /^USOU, ZEROU/,
    /^FATURA MENSAL/,
    /^TITULAR:/,
    /^CARTAO:/,
    /^TOTAL DA SUA FATURA/,
    /^VENCIMENTO/,
    /^PAGAMENTO MINIMO:/,
    /^ENCARGOS TOTAIS/,
    /PAGAMENTO MINIMO E UM VALOR/,
    /^JUROS ROTATIVO/,
    /^JUROS REMUNERATORIOS/,
    /^SAQUE A VISTA/,
    /^MULTA/,
    /^TIPOS/,
    /^PERIODO ATUAL/,
    /^PROXIMO PERIODO/,
    /^TAXA A\.M\./,
    /^RESUMO DAS DESPESAS/,
    /^SALDO EM DOLAR/,
    /^SALDO CONVERTIDO/,
    /^CONFORME CIRCULAR/,
    /^ATENCAO!/,
    /^NOVA REGRA/,
    /^CASO DESEJE/,
    /^TOTAL DE PARCELAS/,
    /^EXTRATO PARA SIMPLES/,
  ]

  if (skipPatterns.some((p) => p.test(normalized))) return true

  // Skip card number lines like "530033******9277"
  if (/\d{6}\*{6}\d{4}/.test(raw)) return true
  if (/\*{4,}/.test(raw)) return true

  // Skip lines that are only amounts/numbers/R$
  if (/^R\$\s*[\d.,]+$/.test(normalized)) return true

  return false
}

function inferCategory(description: string): string {
  const text = normalizeLine(description)
  if (/PAGAMENTO.*PIX|PAGAMENTO.*FATURA|PAGAMENTO RECEBIDO/.test(text)) return 'Pagamentos'
  if (/ANUIDADE/.test(text)) return 'Tarifas'
  if (/IOF/.test(text)) return 'Impostos'
  if (/MULTA|JUROS|ENCARGO/.test(text)) return 'Encargos'
  if (/CARREFOUR|ATACADAO/.test(text)) return 'Supermercado'
  if (/FARMACIA|DROGARIA|DROGA/.test(text)) return 'Saúde'
  if (/POSTO|COMBUSTIVEL|GASOLINA/.test(text)) return 'Transporte'
  if (/RESTAURANTE|LANCHONETE|IFOOD|RAPPI|UBER EATS/.test(text)) return 'Alimentação'
  if (/UBER|99|TAXI|METRO|ONIBUS/.test(text)) return 'Transporte'
  if (/NETFLIX|SPOTIFY|AMAZON|PRIME|DISNEY|YOUTUBE/.test(text)) return 'Assinaturas'
  if (/PARCELADO|PARCELAMENTO/.test(text)) return 'Parcelado'
  return 'Outros'
}

// ---------------------------------------------------------------------------
// PDF extraction (same pdfplumber strategy as other parsers)
// ---------------------------------------------------------------------------

async function extractPages(buffer: Buffer, password?: string): Promise<string[]> {
  const { execFileSync } = await import('child_process')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  const { writeFileSync, unlinkSync } = await import('fs')

  const tmpFile = join(tmpdir(), `carrefour-invoice-${Date.now()}.pdf`)
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

function parseSummary(fullText: string): CarrefourInvoiceSummary {
  const lines = fullText.split('\n')

  // --- Product ---
  // Pattern: "FATURA MENSAL CARTÃO CARREFOUR GOLD MASTERCARD"
  let product = 'CARREFOUR'
  const productMatch = fullText.match(/CART[AÃ]O\s+(CARREFOUR[^\n]+?)(?:\s{2,}|\n)/i)
  if (productMatch?.[1]) {
    product = `CARTÃO ${productMatch[1].trim()}`
  }

  // --- Card last 4 ---
  // Pattern: "CARTÃO: 530033******9277"
  let cardLast4 = ''
  const cardMatch = fullText.match(/CART[AÃ]O:\s*\d{6}\*{6}(\d{4})/i)
  if (cardMatch?.[1]) {
    cardLast4 = cardMatch[1]
  }

  // --- Due date ---
  // Pattern: "TOTAL DA SUA FATURA   VENCIMENTO   LIMITE DE CRÉDITO"
  //          "R$ 0,00               10/04/2026   R$3.410,00"
  let dueDate: Date | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = normalizeLine(lines[i])
    if (/TOTAL DA SUA FATURA/.test(line) && /VENCIMENTO/.test(line)) {
      // Date is on the next non-empty line
      for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
        const dateMatch = lines[j].match(/(\d{2}\/\d{2}\/\d{4})/)
        if (dateMatch?.[1]) {
          dueDate = parseDateFromDMY(dateMatch[1])
          break
        }
      }
      break
    }
  }

  // Fallback: "VENCIMENTO\n10/04/2026"
  if (!dueDate) {
    const m = fullText.match(/VENCIMENTO\s*\n?\s*(\d{2}\/\d{2}\/\d{4})/i)
    if (m?.[1]) dueDate = parseDateFromDMY(m[1])
  }

  const dueMonth = dueDate ? dueDate.toISOString().slice(0, 7) : ''
  const invoiceMonth = dueMonth

  // --- Total da fatura atual ---
  // Pattern: "TOTAL DA FATURA ATUAL:   R$ 0,00"
  let totalMinor = 0
  const totalMatch = fullText.match(/TOTAL DA FATURA ATUAL[:\s]*R\$\s*([\d.,]+)/i)
  if (totalMatch?.[1]) {
    totalMinor = parseAmountToCents(totalMatch[1]) ?? 0
  }

  // --- Saldo anterior ---
  const prevMatch = fullText.match(/Total da fatura anterior[:\s]*R\$\s*([\d.,]+)/i)
  const previousBalanceMinor = prevMatch ? (parseAmountToCents(prevMatch[1]) ?? 0) : 0

  // --- Pagamentos ---
  const paymentsMatch = fullText.match(/Pagamentos efetuados\/cr[eé]ditos[:\s]*R\$\s*([\d.,]+)/i)
  const paymentsMinor = paymentsMatch ? (parseAmountToCents(paymentsMatch[1]) ?? 0) : 0

  // --- Lançamentos/débitos ---
  const debitMatch = fullText.match(/Lan[çc]amentos atuais\/d[eé]bitos[:\s]*R\$\s*([\d.,]+)/i)
  const nationalPurchasesMinor = debitMatch ? (parseAmountToCents(debitMatch[1]) ?? 0) : 0

  return {
    cardLast4,
    product,
    invoiceMonth,
    dueDate: dueDate ? dueDate.toISOString().slice(0, 10) : '',
    dueMonth,
    closingDate: '',
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

function parseTransactions(fullText: string, summary: CarrefourInvoiceSummary): CarrefourTransaction[] {
  const dueDate = summary.dueDate ? new Date(`${summary.dueDate}T12:00:00.000Z`) : null
  const fallbackYear = dueDate ? dueDate.getUTCFullYear() : new Date().getUTCFullYear()

  const lines = fullText
    .replace(/\u00A0/g, ' ')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const items: CarrefourTransaction[] = []
  let inTransactions = false

  for (const line of lines) {
    const normalized = normalizeLine(line)

    // Start of transaction section
    if (
      /^LANCAMENTOS NO BRASIL/.test(normalized) ||
      /^DATA\s+DESCRICAO/.test(normalized)
    ) {
      inTransactions = true
      continue
    }

    // End of transaction section
    if (inTransactions && /^TOTAL DA FATURA/.test(normalized)) {
      break
    }

    if (!inTransactions) continue
    if (shouldSkipLine(line)) continue

    // Must start with "DD/MM "
    const dateMatch = datePrefixRegex.exec(line)
    if (!dateMatch?.[1]) continue

    const parsedDate = parseDateDM(dateMatch[1], fallbackYear, dueDate) ?? (dueDate ?? new Date())
    const rest = line.slice(dateMatch[0].length).trim()
    if (!rest) continue

    // Find first amount
    amountRegex.lastIndex = 0
    const amountMatch = amountRegex.exec(rest)
    amountRegex.lastIndex = 0
    if (!amountMatch?.[0]) continue

    const amountStr = amountMatch[0]
    const amountCents = parseAmountToCents(amountStr)
    if (!amountCents) continue

    // Description is everything before the amount
    let description = sanitizeDescription(rest.slice(0, amountMatch.index).trim())
    if (!description || isGarbageDescription(description) || shouldSkipLine(description)) continue

    // Credit detection: trailing "-" after amount (e.g. "69,15-")
    const afterAmount = rest.slice(amountMatch.index + amountStr.length).trimStart()
    const isCredit =
      afterAmount.startsWith('-') ||
      /PAGAMENTO.*PIX|PAGAMENTO.*FATURA|PAGAMENTO RECEBIDO|CREDITO/i.test(description)

    const amountMinor = isCredit ? -Math.abs(amountCents) : amountCents

    // Extract installment "(XX/YYY)"
    const inst = installmentRegex.exec(description)
    installmentRegex.lastIndex = 0
    const instN = inst ? Number(inst[1]) : undefined
    const instT = inst ? Number(inst[2]) : undefined
    const validInstallment =
      instN !== undefined &&
      instT !== undefined &&
      instN >= 1 &&
      instT >= 1 &&
      instN <= instT &&
      instT <= 120

    // Clean installment from description
    description = description.replace(/\s*\(\d{1,2}\/\d{2,3}\)\s*$/, '').trim()
    if (!description) continue

    items.push({
      date: parsedDate.toISOString().slice(0, 10),
      description,
      category: inferCategory(description),
      amountMinor,
      installment: validInstallment ? `${instN}/${instT}` : undefined,
      country: 'BR',
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

export function isCarrefourInvoice(text: string): boolean {
  return /carrefour/i.test(text) && /mastercard/i.test(text)
}

export async function parseCarrefourInvoice(buffer: Buffer, password?: string): Promise<CarrefourInvoice> {
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

export function carrefourInvoiceToForecast(invoice: CarrefourInvoice): Array<{
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
      id: `carrefour-invoice-${summary.invoiceMonth}-${summary.cardLast4}`,
      competencyMonth: summary.dueMonth,
      amountMinor: -summary.openBalanceMinor,
      recurrence: 'one-time',
      description: `Fatura Carrefour ${summary.product} (${summary.cardLast4}) - venc. ${summary.dueDate}`,
    },
  ]
}

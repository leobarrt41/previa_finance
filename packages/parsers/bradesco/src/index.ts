/**
 * @previa/parser-bradesco
 *
 * Bradesco/Bradescard invoice parser — corrected against real PDFs:
 *   - FATURAMENSAL042026.pdf  (venc. 10/02/2026, pwd: 072961)
 *   - FATURAMENSAL052026.pdf  (venc. 10/05/2026, pwd: 072961)
 *   - BradescoCartoes2026-03-08.084641.pdf (venc. 10/03/2026, sem senha)
 *
 * Real PDF structure observed:
 *   Page 1: header with "CASAS BAHIA VISA PLATINUM 4766.07**.****.6014"
 *            "Total da fatura   Vencimento   Limite de compras  ..."
 *            "R$ 347,88  10/05/2026  ..."
 *            "Saldo anterior R$ 217,20"
 *            "(-) Créditos/Pagamentos R$ 217,20-"
 *            "(+) Compras/Débitos R$ 347,88"
 *   Page 2: "Lançamentos  Total parcelado para as próximas faturas"
 *            "Data Descrição  Valor R$"
 *            "Nacionais em Reais (R$)"
 *            "LEONARDO B BAPTISTA  4766.07**.****.6014"
 *            "26/07  COMPRA PARCELADA CASAS BAHIA (09/24)  191,36  Demais faturas R$ 5.618,96"
 *            "10/04  PAGAMENTO RECEBIDO - OBRIGADO  217,20-"
 *            "11/04  COMPRA PARCELADA CASAS BAHIA (01/24)  131,52"
 *
 * Key fixes:
 *   1. extractDueDate: Bradesco puts "Vencimento" as column header on same line as date
 *      e.g. "Total da fatura  Vencimento  Limite de compras  ..."
 *           "R$ 347,88  10/05/2026  R$ 5.000,00  ..."
 *      The date is on the NEXT line after the header line containing "Vencimento".
 *      Also appears in boleto section: "Data de Vencimento\n10/05/2026"
 *   2. parseSummary: "Total da fatura" value is on the NEXT line (same line as due date).
 *      Pattern: "R$ 347,88  10/05/2026" — first R$ value on that line.
 *   3. parsePageLines: Lines with trailing right-column text (e.g. "191,36  Demais faturas R$ 5.618,96")
 *      must extract ONLY the first amount (left column), not the right-column amounts.
 *   4. Credit detection: Bradesco uses trailing "-" on amount: "217,20-" (not "- 217,20").
 *   5. installmentRegex: Bradesco format is "(09/24)" — already handled but needs to be
 *      greedy enough to not match dates like "26/07".
 *   6. shouldSkipDescription: add "PROXIMO FECHAMENTO", "FIQUE ATENTO", "PARA CONSULTAR"
 *      and the card-number-only lines like "LEONARDO B BAPTISTA  4766.07**.****.6014".
 */

export interface BradescoTransaction {
  date: string
  description: string
  category: string
  amountMinor: number
  installment?: string
  country?: string
}

export interface BradescoInvoiceSummary {
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

export interface BradescoInvoice {
  summary: BradescoInvoiceSummary
  transactions: BradescoTransaction[]
  rawText: string
}

// Matches "DD/MM" at the start of a line (transaction date prefix)
const datePrefixRegex = /^(\d{2}\/\d{2})\s+/

// Matches Brazilian currency amounts like "191,36" or "1.234,56"
// Used with exec() — reset lastIndex after each use
const amountRegex = /\d{1,3}(?:\.\d{3})*,\d{2}/g

// Matches installment notation "(09/24)" or "09/24" with parens
// Must NOT match bare dates — requires at least one paren or be preceded by space
const installmentRegex = /\((\d{1,2})\/(\d{2})\)/

function parseAmountToCents(value: string): number | null {
  const normalized = value.replace(/\./g, '').replace(',', '.')
  const num = Number(normalized)
  if (!Number.isFinite(num) || num <= 0) return null
  return Math.round(num * 100)
}

function getPythonBin(): string {
  return process.env.PREVIA_PYTHON || process.env.PYTHON_BIN || 'python3'
}

function parseDateDM(value: string, fallbackYear: number, dueDate?: Date | null): Date | null {
  const m = /^(\d{2})\/(\d{2})$/.exec(value)
  if (!m) return null
  const day = Number(m[1])
  const month = Number(m[2]) - 1
  if (!Number.isFinite(day) || !Number.isFinite(month) || month < 0 || month > 11) return null
  let year = dueDate ? dueDate.getFullYear() : fallbackYear
  const ref = dueDate ?? new Date()
  // If the transaction month is after the due date month, it's from the previous year
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
    // Remove card number pattern like "4766.07**.****.6014"
    .replace(/\s+\d{4}\.\d{2}\*{2}\.\*{4}\.\d{4}\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function isGarbageDescription(raw: string): boolean {
  const normalized = normalizeLine(raw).replace(/R\$/g, '').replace(/[^A-Z0-9]/g, '')
  return normalized.length === 0
}

function shouldSkipTransaction(description: string): boolean {
  const normalized = normalizeLine(description)
  return (
    !normalized
    || /^SALDO ANTERIOR\b/.test(normalized)
    || /^PAGAMENTO\b/.test(normalized)
    || /^PGTO\b/.test(normalized)
    || /^PAGTO\b/.test(normalized)
    || /^CREDITOS?\/PAGAMENTOS?\b/.test(normalized)
  )
}

/**
 * Extract due date from page 1 text.
 *
 * Bradesco real PDF patterns observed:
 *   Pattern A (boleto section): "Data de Vencimento\n10/05/2026"
 *   Pattern B (header section): "Total da fatura  Vencimento  Limite de compras\n
 *                                 R$ 347,88  10/05/2026  R$ 5.000,00"
 *   Pattern C (old format):     "VENCIMENTO: 10/05/2026"
 */
function extractDueDate(text: string): Date | null {
  const normalized = text.replace(/\r/g, '\n')

  // Pattern A: "Data de Vencimento" followed by date on same or next line
  const patternA = normalized.match(/Data de Vencimento\s*\n?\s*(\d{2}\/\d{2}\/\d{4})/i)
  if (patternA?.[1]) {
    return parseDateFromDMY(patternA[1])
  }

  // Pattern B: "Vencimento" as column header; date appears on next non-empty line
  // after a line containing "Total da fatura" or "Vencimento"
  // The actual date line looks like: "R$ 347,88  10/05/2026  R$ 5.000,00  R$ 0,00"
  const lines = normalized.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/Vencimento/i.test(line) && /Total da fatura/i.test(line)) {
      // Look in the next 3 lines for a date in DD/MM/YYYY format
      for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
        const dateMatch = lines[j].match(/(\d{2}\/\d{2}\/\d{4})/)
        if (dateMatch?.[1]) {
          return parseDateFromDMY(dateMatch[1])
        }
      }
    }
  }

  // Pattern C: explicit "VENCIMENTO: DD/MM/YYYY" or "Vencimento DD/MM/YYYY"
  const patternC =
    normalized.match(/VENCIMENTO[:\s]*([0-3]\d)[\/\-](\d{2})[\/\-](\d{4})/i) ??
    normalized.match(/Vencimento[\s\S]{0,50}?(\d{2}\/\d{2}\/\d{4})/i)
  if (patternC) {
    if (patternC[1] && patternC[2] && patternC[3]) {
      return parseDateFromDMY(`${patternC[1]}/${patternC[2]}/${patternC[3]}`)
    }
    if (patternC[1]) {
      return parseDateFromDMY(patternC[1])
    }
  }

  return null
}

function parseDateFromDMY(value: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim())
  if (!m) return null
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12, 0, 0, 0)
  return Number.isNaN(d.getTime()) ? null : d
}

function alignInstallmentDateWithDueDate(
  day: number,
  month: number,
  dueDate: Date,
  installmentNumber: number
): Date {
  const candidates: Date[] = []
  for (let y = dueDate.getFullYear() - 3; y <= dueDate.getFullYear(); y += 1) {
    const d = new Date(y, month, day, 12, 0, 0, 0)
    if (!Number.isNaN(d.getTime()) && d <= dueDate) candidates.push(d)
  }
  if (!candidates.length) return new Date(dueDate)

  const dueMonthIndex = dueDate.getFullYear() * 12 + dueDate.getMonth()
  const targetDiff = Math.max(0, installmentNumber - 1)
  let best = candidates[0]!
  let bestScore = Number.POSITIVE_INFINITY
  for (const c of candidates) {
    const candMonthIndex = c.getFullYear() * 12 + c.getMonth()
    const monthDiff = dueMonthIndex - candMonthIndex
    const score = Math.abs(monthDiff - targetDiff) * 1000 + Math.abs(dueDate.getTime() - c.getTime())
    if (score < bestScore) {
      best = c
      bestScore = score
    }
  }
  return best
}

function shouldSkipDescription(raw: string): boolean {
  const normalized = normalizeLine(raw)
  if (!normalized) return true

  const skipPatterns = [
    /TOTAL PARCELADO PARA AS PROXIMAS FATURAS/,
    /DEMAIS FATURAS/,
    /PROXIMA FATURA/,
    /TOTAL PARA AS PROXIMAS FATURAS/,
    /BANCO BRADESCARD/,
    /CIDADE DE DEUS/,
    /^LIMITE/,
    /OPCOES DE PAGAMENTO/,
    /PAGAMENTO MINIMO/,
    /^NACIONAIS EM REAIS/,
    /^DATA DESCRICAO/,
    /^LANCAMENTOS\b/,
    /PROXIMO FECHAMENTO/,
    /FIQUE ATENTO/,
    /PARA CONSULTAR/,
    /RESUMO DOS ENCARGOS/,
    /CREDITO ROTATIVO/,
    /PARCELAMENTO FATURA/,
    /RETIRADA\/SAQUE/,
    /PARCELADO FACIL/,
    /PARCELADO LOJA/,
    /PARCELADO REDE/,
    /CREDIARIO/,
    /NOVO TETO DE JUROS/,
    /VALOR ORIGINAL DA DIVIDA/,
    /JUROS E ENCARGOS/,
    /CENTRAL DE ATENDIMENTO/,
    /SAC 0800/,
    /OUVIDORIA/,
    /SEGUNDA A SABADO/,
    /TODOS OS DIAS/,
    /BAIXE O APP/,
    /BRADESCARD\.COM\.BR/,
    /PAGAVEL PREFERENCIALMENTE/,
    /BOLETO VALIDO/,
    /OS ENCARGOS PROVENIENTES/,
  ]

  if (skipPatterns.some((pattern) => pattern.test(normalized))) return true

  // Skip card number lines like "4766.07**.****.6014" or lines containing them
  if (/\d{4}\.\d{2}\*{2}\.\*{4}\.\d{4}/.test(raw) || /\*{4,}/.test(raw)) return true

  return false
}

function inferCategory(description: string): string {
  const text = normalizeLine(description)
  if (text.includes('PAGAMENTO RECEBIDO')) return 'Pagamentos'
  if (text.includes('ANUIDADE')) return 'Tarifas'
  if (text.includes('IOF')) return 'Impostos'
  if (text.includes('MULTA CONTRATUAL') || text.includes('JUROS DE MORA') || text.includes('ENCARGOS CONTRATUAIS')) return 'Encargos'
  if (text.includes('COMPRA PARCELADA') && text.includes('CASAS BAHIA')) return 'Casa e decoração'
  if (text.includes('COMPRA PARCELADA')) return 'Parcelado'
  return 'Outros'
}

async function extractPages(buffer: Buffer, password?: string): Promise<string[]> {
  const { execFileSync } = await import('child_process')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  const { writeFileSync, unlinkSync } = await import('fs')

  const tmpFile = join(tmpdir(), `bradesco-invoice-${Date.now()}.pdf`)
  writeFileSync(tmpFile, buffer)

  try {
    const script = `
import sys
try:
    import pdfplumber
except ModuleNotFoundError as exc:
    if getattr(exc, 'name', '') == 'pdfplumber':
        print('PDF_DEPENDENCY_MISSING: pdfplumber', file=sys.stderr)
        raise SystemExit(3)
    raise
path = sys.argv[1]
password = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None
pages = []
try:
    with pdfplumber.open(path, password=password) as pdf:
        for page in pdf.pages:
            pages.append(page.extract_text(x_tolerance=3, y_tolerance=3) or '')
except Exception as exc:
    message = str(exc)
    if 'PDFPasswordIncorrect' in message or 'password required' in message.lower():
        print('PDF_PASSWORD_REQUIRED', file=sys.stderr)
        raise SystemExit(2)
    raise
print('\\n===PAGE===\\n'.join(pages))
`
    const args = password ? ['-c', script, tmpFile, password] : ['-c', script, tmpFile]
    const output = execFileSync(getPythonBin(), args, {
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

/**
 * Parse summary from page 1.
 *
 * Real PDF page 1 structure:
 *   Line: "CASAS BAHIA VISA PLATINUM 4766.07**.****.6014"
 *   Line: "Total da fatura  Vencimento  Limite de compras  Limite de saque"
 *   Line: "R$ 347,88  10/05/2026  R$ 5.000,00  R$ 0,00"
 *   ...
 *   Line: "Saldo anterior  R$ 217,20  ..."
 *   Line: "(-) Créditos/Pagamentos  R$ 217,20-  ..."
 *   Line: "(+) Compras/Débitos  R$ 347,88  ..."
 */
function parseSummary(page1: string): BradescoInvoiceSummary {
  // --- Product & card last 4 ---
  // Pattern: "CASAS BAHIA VISA PLATINUM 4766.07**.****.6014"
  const productMatch =
    page1.match(/^(CASAS BAHIA[^\n]+?)\s+(\d{4})\s*$/m) ??
    page1.match(/(CASAS BAHIA[^\n]+?)\s+4766\.[^\n]*?(\d{4})/i) ??
    page1.match(/^([A-ZÀ-Ü0-9 .\-]+?)\s+4766\.[^\n]*?(\d{4})$/m) ??
    page1.match(/^([A-ZÀ-Ü0-9 .\-]+?)\s+\d{4}\.[^\n]*?(\d{4})$/m)

  let product = 'BRADESCO'
  let cardLast4 = ''

  if (productMatch) {
    // Check if the match has the card number embedded in group 1
    const fullMatch = productMatch[1].trim()
    const cardInGroup1 = fullMatch.match(/\s+(\d{4})$/)
    if (cardInGroup1) {
      product = fullMatch.slice(0, fullMatch.lastIndexOf(cardInGroup1[0])).trim()
      cardLast4 = cardInGroup1[1]
    } else {
      product = fullMatch
      cardLast4 = productMatch[2] ?? ''
    }
  }

  // --- Due date ---
  const dueDate = extractDueDate(page1)
  const dueMonth = dueDate ? dueDate.toISOString().slice(0, 7) : ''

  // --- Total da fatura ---
  // Pattern: "Total da fatura\nR$ 347,88  10/05/2026" OR "Total da fatura ... R$ 347,88"
  // The total is the FIRST R$ value on the line after "Total da fatura" header
  let totalMinor = 0
  const lines = page1.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (/Total da fatura/i.test(lines[i])) {
      // Check same line first
      const sameLineMatch = lines[i].match(/R\$\s*([\d.,]+)/)
      if (sameLineMatch) {
        totalMinor = parseAmountToCents(sameLineMatch[1]) ?? 0
        break
      }
      // Check next line
      for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
        const nextLineMatch = lines[j].match(/R\$\s*([\d.,]+)/)
        if (nextLineMatch) {
          totalMinor = parseAmountToCents(nextLineMatch[1]) ?? 0
          break
        }
      }
      break
    }
  }

  // --- Saldo anterior ---
  // Pattern: "Saldo anterior R$ 354,72" or "Saldo anterior\nR$ 354,72"
  const prevMatch = page1.match(/Saldo anterior[\s\S]{0,30}?R\$\s*([\d.,]+)/i)
  const previousBalanceMinor = prevMatch ? Math.abs(parseAmountToCents(prevMatch[1]) ?? 0) : 0

  // --- Créditos/Pagamentos ---
  // Pattern: "(-) Créditos/Pagamentos R$ 217,20-"
  const paymentsMatch = page1.match(/\(-\)\s*Cr[ée]ditos\/Pagamentos[\s\S]{0,30}?R\$\s*([\d.,]+)/i)
  const paymentsMinor = paymentsMatch ? Math.abs(parseAmountToCents(paymentsMatch[1]) ?? 0) : 0

  // --- Compras/Débitos ---
  // Pattern: "(+) Compras/Débitos R$ 347,88"
  const purchasesMatch = page1.match(/\(\+\)\s*Compras\/D[eé]bitos[\s\S]{0,30}?R\$\s*([\d.,]+)/i)
  const nationalPurchasesMinor = purchasesMatch ? Math.abs(parseAmountToCents(purchasesMatch[1]) ?? 0) : 0

  const invoiceYear = dueDate ? dueDate.getUTCFullYear() : new Date().getUTCFullYear()
  const invoiceMonth = dueDate ? dueDate.toISOString().slice(0, 7) : `${invoiceYear}-01`

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

/**
 * Parse transaction lines from page 2.
 *
 * Real PDF page 2 structure (pdfplumber with x_tolerance=3):
 *   "26/07  COMPRA PARCELADA CASAS BAHIA (09/24)  191,36  Demais faturas R$ 5.618,96"
 *   "27/08  ANUIDADE DIFERENCIADA  (09/12)  25,00"
 *   "10/04  PAGAMENTO RECEBIDO - OBRIGADO  217,20-"
 *   "11/04  COMPRA PARCELADA CASAS BAHIA (01/24)  131,52"
 *
 * Key: lines have right-column text appended (e.g. "Demais faturas R$ 5.618,96").
 * We must extract only the FIRST amount that appears after the description,
 * and ignore any amounts that appear after it (right-column data).
 *
 * Credit indicator: Bradesco uses trailing "-" on amount: "217,20-"
 */
function parsePageLines(pageText: string, fallbackYear: number, dueDate: Date | null): BradescoTransaction[] {
  const lines = pageText
    .replace(/\u00A0/g, ' ')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const items: BradescoTransaction[] = []
  let inLancamentos = false

  for (const line of lines) {
    const normalized = normalizeLine(line)

    // Detect start of transactions section
    if (
      /^LANCAMENTOS\b/.test(normalized) ||
      /TRANSACOES NACIONAIS/.test(normalized) ||
      /NACIONAIS EM REAIS/.test(normalized) ||
      /^DATA\s+DESCRICAO/.test(normalized)
    ) {
      inLancamentos = true
      continue
    }

    // Detect end of transactions section
    if (
      inLancamentos &&
      (/^TOTAL PARCELADO\b/.test(normalized) ||
        /^LIMITES\b/.test(normalized) ||
        /^OPCOES DE PAGAMENTO\b/.test(normalized) ||
        /^PAGAMENTO TOTAL\b/.test(normalized) ||
        /^PARCELAMENTO DA FATURA\b/.test(normalized) ||
        /^PAGAMENTO MINIMO\b/.test(normalized) ||
        /^TOTAL GERAL DOS LANCAMENTOS\b/.test(normalized) ||
        /^RESUMO DOS ENCARGOS\b/.test(normalized))
    ) {
      break
    }

    // Only evaluate skip rules after extracting the left-side description.
    // Bradesco appends right-column text like "Demais faturas R$ ..." to the same
    // physical line, and that must not cause a real transaction to be dropped.

    // Must start with a date prefix "DD/MM "
    const dateMatch = datePrefixRegex.exec(line)
    if (!dateMatch?.[1]) continue

    const due = dueDate ?? new Date()
    const parsedDate = parseDateDM(dateMatch[1], fallbackYear, dueDate) ?? due
    const rest = line.slice(dateMatch[0].length).trim()
    if (!rest) continue

    // Find the FIRST amount in the rest of the line (left-column amount)
    // Bradesco format: "DESCRIPTION (XX/YY)  191,36  [right-column text]"
    // or "DESCRIPTION  217,20-  [right-column text]"
    // We want only the first amount match
    amountRegex.lastIndex = 0
    const amountMatch = amountRegex.exec(rest)
    amountRegex.lastIndex = 0
    if (!amountMatch?.[0]) continue

    const amountStr = amountMatch[0]
    const amountCents = parseAmountToCents(amountStr)
    if (!amountCents) continue

    // Description is everything before the amount
    let description = sanitizeDescription(rest.slice(0, amountMatch.index).trim())
    if (!description || isGarbageDescription(description) || shouldSkipDescription(description)) continue
    if (shouldSkipTransaction(description)) continue

    // Detect credit: Bradesco uses "217,20-" (trailing dash after amount)
    // Check the character immediately after the amount match
    const afterAmount = rest.slice(amountMatch.index + amountStr.length).trimStart()
    const isCredit =
      /PAGAMENTO RECEBIDO/i.test(description) ||
      afterAmount.startsWith('-') ||
      /^-/.test(amountStr)

    const amountMinor = isCredit ? -Math.abs(amountCents) : amountCents

    // Extract installment from description: "(09/24)" format
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
      instT <= 36

    // Remove installment notation from description
    description = description.replace(/\s*\(\d{1,2}\/\d{2}\)\s*$/, '').trim()
    if (!description) continue

    let finalDate = parsedDate
    if (dueDate && validInstallment && instN !== undefined) {
      finalDate = alignInstallmentDateWithDueDate(
        parsedDate.getDate(),
        parsedDate.getMonth(),
        dueDate,
        instN
      )
    }

    items.push({
      date: finalDate.toISOString().slice(0, 10),
      description,
      category: inferCategory(description),
      amountMinor,
      installment: validInstallment ? `${instN}/${instT}` : undefined,
      country: 'BR',
    })
  }

  return items
}

function parseTransactions(page2: string, summary: BradescoInvoiceSummary): BradescoTransaction[] {
  const dueDate = summary.dueDate ? new Date(`${summary.dueDate}T12:00:00.000Z`) : null
  const invoiceYear = dueDate ? dueDate.getUTCFullYear() : new Date().getUTCFullYear()
  const loose = parsePageLines(page2, invoiceYear, dueDate)
  // Deduplicate by date|description|amount
  return Array.from(
    new Map(
      loose.map((item) => [
        `${item.date}|${normalizeLine(item.description)}|${item.amountMinor}`,
        item,
      ])
    ).values()
  )
}

export function isBradescoInvoice(text: string): boolean {
  return /bradescard/i.test(text) || /bradesco/i.test(text) || /casas bahia/i.test(text)
}

export async function parseBradescoInvoice(buffer: Buffer, password?: string): Promise<BradescoInvoice> {
  const pages = await extractPages(buffer, password)
  const page1 = pages[0] ?? ''
  // Use page 2 for transactions; if only 1 page, use all pages joined
  const page2 = pages.length > 1 ? pages[1] : pages.join('\n')
  const summary = parseSummary(page1)
  const transactions = parseTransactions(page2, summary)

  return {
    summary,
    transactions,
    rawText: pages.join('\n'),
  }
}

export function bradescoInvoiceToForecast(invoice: BradescoInvoice): Array<{
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
      id: `bradesco-invoice-${summary.invoiceMonth}-${summary.cardLast4}`,
      competencyMonth: summary.dueMonth,
      amountMinor: -summary.openBalanceMinor,
      recurrence: 'one-time',
      description: `Fatura Bradesco ${summary.product} (${summary.cardLast4}) - venc. ${summary.dueDate}`,
    },
  ]
}

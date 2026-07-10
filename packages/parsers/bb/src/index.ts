/**
 * @previa/parser-bb
 *
 * Parser para faturas PDF do Banco do Brasil (Ourocard).
 *
 * Extrai:
 *  - Dados da fatura (vencimento, total, saldo anterior, pagamentos)
 *  - Transacções individuais com data, descrição, categoria e valor
 *  - Saldo em aberto (para previsão de cashflow no mês do vencimento)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BBTransaction {
  /** Data da compra no formato YYYY-MM-DD */
  date: string
  /** Descrição original da transacção */
  description: string
  /** Categoria conforme agrupamento do BB (ex: "Restaurantes", "Serviços") */
  category: string
  /** Valor em centavos (positivo = débito, negativo = crédito/pagamento) */
  amountMinor: number
  /** Número de parcela, ex: "03/12" */
  installment?: string
  /** País da transacção */
  country?: string
}

export interface BBInvoiceSummary {
  /** Cartão final (ex: "2933") */
  cardLast4: string
  /** Produto (ex: "OUROCARD VISA GOLD") */
  product: string
  /** Mês de referência da fatura (YYYY-MM) */
  invoiceMonth: string
  /** Data de vencimento (YYYY-MM-DD) */
  dueDate: string
  /** Mês de vencimento (YYYY-MM) — usado para cashflow */
  dueMonth: string
  /** Data de fechamento da fatura (YYYY-MM-DD) */
  closingDate: string
  /** Valor total da fatura em centavos */
  totalMinor: number
  /** Saldo da fatura anterior em centavos */
  previousBalanceMinor: number
  /** Total de pagamentos/créditos em centavos (valor positivo) */
  paymentsMinor: number
  /** Compras nacionais em centavos */
  nationalPurchasesMinor: number
  /** Compras internacionais em centavos */
  internationalPurchasesMinor: number
  /** Tarifas e encargos em centavos */
  chargesMinor: number
  /** Saldo em aberto a pagar (=total se não paga, ou diferença) em centavos */
  openBalanceMinor: number
}

export interface BBInvoice {
  summary: BBInvoiceSummary
  transactions: BBTransaction[]
  /** Texto bruto extraído do PDF (para debug) */
  rawText: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseBRL(raw: string): number {
  // "R$ 1.457,16" → 145716 | "-1.800,00" → -180000
  const neg = raw.trim().startsWith('-') || raw.includes('R$ -')
  const clean = raw.replace(/[^0-9,]/g, '').replace(',', '.')
  const value = Math.round(parseFloat(clean) * 100)
  return neg ? -value : value
}

function shouldSkipTransaction(category: string, description: string): boolean {
  const normalizedDescription = description
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

  const normalizedCategory = category
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

  return (
    !normalizedDescription
    || /^saldo anterior\b/.test(normalizedDescription)
    || /^pagamento\b/.test(normalizedDescription)
    || /^pgto\b/.test(normalizedDescription)
    || /^pagto\b/.test(normalizedDescription)
    || normalizedCategory === 'pagamentos/creditos'
  )
}

/**
 * Converte "13/04/2026" → "2026-04-13"
 * Converte "13/04" com inferredYear → "2026-04-13"
 */
function parseDate(raw: string, invoiceYear?: number): string {
  const parts = raw.trim().split('/')
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
  }
  if (parts.length === 2 && invoiceYear) {
    return `${invoiceYear}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
  }
  return raw
}

/** "abril" / "fevereiro" → "04" / "02" */
const MONTH_MAP: Record<string, string> = {
  janeiro: '01', fevereiro: '02', março: '03', marco: '03',
  abril: '04', maio: '05', junho: '06', julho: '07',
  agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12',
}

// ─── Text extraction (pdfplumber via Python subprocess) ───────────────────────

function getPythonBin(): string {
  return process.env.PREVIA_PYTHON || process.env.PYTHON_BIN || 'python3'
}

async function extractText(buffer: Buffer, password?: string): Promise<string> {
  const { execFileSync } = await import('child_process')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  const { writeFileSync, unlinkSync } = await import('fs')

  // Write buffer to a temp file
  const tmpFile = join(tmpdir(), `bb-invoice-${Date.now()}.pdf`)
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
with pdfplumber.open(path, password=password) as pdf:
    text = '\\n'.join(p.extract_text(x_tolerance=3, y_tolerance=3) or '' for p in pdf.pages)
    print(text)
`
    const args = password ? ['-c', script, tmpFile, password] : ['-c', script, tmpFile]
    const result = execFileSync(getPythonBin(), args, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    })
    return result
  } finally {
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  }
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

function parseSummary(text: string): BBInvoiceSummary {
  // Product & card — pdfplumber: "OUROCARD VISA GOLD Final2933"
  const productMatch = text.match(/fatura de\s+(OUROCARD[^\n]+?)Final\s*(\d{4})/i)
  const product = productMatch ? productMatch[1].trim() : 'OUROCARD'
  const cardLast4 = productMatch ? productMatch[2] : ''

  // Due date: "Vencimento\nabreil\n13/04/2026" or "abril\nVencimento\n13/04/2026"
  // pdfplumber merges to: "abril ... 13/04/2026"
  const dueDateMatch = text.match(/Vencimento\s+(\w+)[\s\S]*?(\d{2}\/\d{2}\/\d{4})/)
  const monthName = dueDateMatch ? dueDateMatch[1].toLowerCase() : ''
  const dueDateRaw = dueDateMatch ? dueDateMatch[2] : ''
  const dueDate = dueDateRaw ? parseDate(dueDateRaw) : ''
  const dueMonth = dueDate ? dueDate.slice(0, 7) : ''

  // Month number from name
  const monthNum = MONTH_MAP[monthName] ?? dueMonth.slice(5, 7)
  const year = dueDate ? dueDate.slice(0, 4) : new Date().getFullYear().toString()
  const invoiceMonth = `${year}-${monthNum}`

  // Closing date: "Fatura fechada em 31/03/2026"
  const closingMatch = text.match(/Fatura fechada em\s+(\d{2}\/\d{2}\/\d{4})/)
  const closingDate = closingMatch ? parseDate(closingMatch[1]) : ''

  // Summary values
  const prevBalMatch = text.match(/Saldo fatura anterior\s+R\$\s*([\d.,]+)/)
  const previousBalanceMinor = prevBalMatch ? parseBRL(prevBalMatch[1]) : 0

  const paymentsMatch = text.match(/Pagamentos\/Créditos\s+R\$\s*-?([\d.,]+)/)
  const paymentsMinor = paymentsMatch ? parseBRL(paymentsMatch[1]) : 0

  const nationalMatch = text.match(/Compras nacionais\s+R\$\s*([\d.,]+)/)
  const nationalPurchasesMinor = nationalMatch ? parseBRL(nationalMatch[1]) : 0

  const intlMatch = text.match(/Compras internacionais\s+R\$\s*([\d.,]+)/)
  const internationalPurchasesMinor = intlMatch ? parseBRL(intlMatch[1]) : 0

  const chargesMatch = text.match(/Tarifas, encargos e multas\s+R\$\s*([\d.,]+)/)
  const chargesMinor = chargesMatch ? parseBRL(chargesMatch[1]) : 0

  const totalMatch = text.match(/^Total\s+R\$\s*([\d.,]+)/m)
  const totalMinor = totalMatch ? parseBRL(totalMatch[1]) : 0

  // Open balance = total (full invoice value due)
  const openBalanceMinor = totalMinor

  return {
    cardLast4,
    product,
    invoiceMonth,
    dueDate,
    dueMonth,
    closingDate,
    totalMinor,
    previousBalanceMinor,
    paymentsMinor,
    nationalPurchasesMinor,
    internationalPurchasesMinor,
    chargesMinor,
    openBalanceMinor,
  }
}

/**
 * Parses the transactions section.
 *
 * pdfplumber output format (x_tolerance=3):
 *   [category heading line]
 *   DD/MM DESCRIPTION CITY BR R$ VALUE
 *   ...
 *   SALDO FATURA ANTERIOR BR R$ VALUE
 *
 * Payments/credits have negative values prefixed with "-".
 */
function parseTransactions(text: string, invoiceYear: number): BBTransaction[] {
  const transactions: BBTransaction[] = []

  // Find the transactions block: starts after "Leonardo ... (Cartão XXXX)" and
  // "Data Descrição País Valor" header, ends before "Total da Fatura"
  const blockMatch = text.match(
    /Data\s+Descri[çc][aã]o\s+Pa[íi]s\s+Valor([\s\S]*?)Total da Fatura/
  )
  if (!blockMatch) return transactions

  const block = blockMatch[1]
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean)

  // Known category headings from BB
  const CATEGORIES = new Set([
    'Pagamentos/Créditos', 'Restaurantes', 'Saúde', 'Serviços',
    'Supermercados', 'Educação', 'Outros lançamentos', 'Compras parceladas',
    'Viagens', 'Farmácias', 'Entretenimento', 'Transporte', 'Vestuário',
    'Combustíveis', 'Eletrônicos', 'Casa e decoração',
  ])

  let currentCategory = 'Outros'

  // Transaction line: "DD/MM DESCRIPTION [CITY] [BR|US|..] R$ -?VALUE"
  // e.g.: "13/03 PGTO. CASH AG. 0765 000076500 200 BR R$ -1.800,00"
  // e.g.: "05/03 TRIBUS ESCOLA DE MUSI SAO JOSE DOS BR R$ 415,00"
  const txPattern = /^(\d{2}\/\d{2})\s+(.+?)\s+([A-Z]{2})\s+R\$\s*(-?[\d.,]+)$/

  // "SALDO FATURA ANTERIOR BR R$ 3.641,06"
  const saldoPattern = /^SALDO FATURA ANTERIOR\s+(?:BR\s+)?R\$\s*([\d.,]+)/

  for (const line of lines) {
    if (CATEGORIES.has(line)) {
      currentCategory = line
      continue
    }

    const saldoMatch = line.match(saldoPattern)
    if (saldoMatch) {
      continue
    }

    const txMatch = line.match(txPattern)
    if (txMatch) {
      const [, datePart, desc, country, valuePart] = txMatch

      // Negative if it already has '-', or if it's in Pagamentos/Créditos
      const isCredit = valuePart.startsWith('-') || currentCategory === 'Pagamentos/Créditos'
      const rawValue = isCredit ? `-${valuePart.replace('-', '')}` : valuePart

      // Determine year: transactions close to month-end of next year otherwise same year
      const txMonth = parseInt(datePart.slice(3, 5), 10)
      const invoiceMonth = parseInt(
        MONTH_MAP[Object.keys(MONTH_MAP).find(k => text.toLowerCase().includes(k)) ?? ''] ?? '1',
        10
      )
      const txYear = txMonth > 6 && invoiceMonth < 3 ? invoiceYear - 1 : invoiceYear

      const installMatch = desc.match(/PARC\s+(\d{2}\/\d{2})/)
      const installment = installMatch ? installMatch[1] : undefined

      if (shouldSkipTransaction(currentCategory, desc)) {
        continue
      }

      transactions.push({
        date: parseDate(datePart, txYear),
        description: desc.replace(/\s+PARC\s+\d{2}\/\d{2}/, '').trim(),
        category: currentCategory,
        amountMinor: parseBRL(rawValue),
        country,
        ...(installment && { installment }),
      })
    }
  }

  return transactions
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parses a Banco do Brasil / Ourocard PDF invoice.
 *
 * @param buffer - Raw PDF file buffer
 * @returns Parsed invoice with summary and transactions
 */
export async function parseBBInvoice(buffer: Buffer, password?: string): Promise<BBInvoice> {
  const rawText = await extractText(buffer, password)
  const summary = parseSummary(rawText)
  const invoiceYear = summary.dueDate
    ? parseInt(summary.dueDate.slice(0, 4), 10)
    : new Date().getFullYear()
  const transactions = parseTransactions(rawText, invoiceYear)

  return { summary, transactions, rawText }
}

/**
 * Converts a parsed BB invoice into CashFlow-compatible forecast entries.
 *
 * Logic:
 *  - If openBalanceMinor > 0, creates a one-time expense forecast
 *    in the dueMonth (the month the invoice must be paid).
 *  - This allows CashFlow to show the payment impact in the correct month.
 *
 * @param invoice - Parsed BB invoice
 * @returns Array of forecast-compatible objects
 */
export function invoiceToForecast(invoice: BBInvoice): Array<{
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
      id: `bb-invoice-${summary.invoiceMonth}`,
      competencyMonth: summary.dueMonth,
      amountMinor: -summary.openBalanceMinor, // negative = expense
      recurrence: 'one-time',
      description: `Fatura BB ${summary.product} (${summary.cardLast4}) - venc. ${summary.dueDate}`,
    },
  ]
}

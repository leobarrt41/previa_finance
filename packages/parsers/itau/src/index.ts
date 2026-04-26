/**
 * @previa/parser-itau
 *
 * Parser para faturas PDF do Itaú (Visa, Mastercard, Personnalité, etc.)
 *
 * Extrai:
 *  - Dados da fatura (vencimento, total, saldo anterior, pagamentos)
 *  - Transações individuais com data, descrição, valor, parcela e país
 *  - Compras internacionais com moeda original e taxa de câmbio
 *  - Saldo em aberto (para previsão de cashflow no mês do vencimento)
 *
 * Compatível com o contrato de resposta usado em /api/invoices/parse,
 * mantendo paridade com @previa/parser-bb.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ItauTransaction {
  /** Data da compra no formato YYYY-MM-DD */
  date: string
  /** Descrição original da transação */
  description: string
  /** Categoria textual (quando indicada na fatura) */
  category: string
  /** Valor em centavos BRL (positivo = débito, negativo = crédito/pagamento) */
  amountMinor: number
  /** Número de parcela no formato N/T, ex: "03/12" */
  installment?: string
  /** País da transação (código ISO 2 letras quando disponível) */
  country?: string
  /** Valor original em moeda estrangeira (centavos) — compras internacionais */
  originalAmountMinor?: number
  /** Código da moeda original (ex: "USD", "EUR") */
  originalCurrencyCode?: string
  /** Taxa de câmbio aplicada (ex: 5.8432) */
  exchangeRate?: number
}

export interface ItauInvoiceSummary {
  /** Banco/instituição */
  bank: 'itau'
  /** Produto do cartão (ex: "ITAUCARD VISA PLATINUM", "PERSONNALITÉ MASTERCARD") */
  product: string
  /** Últimos 4 dígitos do cartão */
  cardLast4: string
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
  /** Tarifas, encargos e juros em centavos */
  chargesMinor: number
  /** Saldo em aberto a pagar em centavos */
  openBalanceMinor: number
}

export interface ItauInvoice {
  summary: ItauInvoiceSummary
  transactions: ItauTransaction[]
  /** Texto bruto extraído do PDF (para debug) */
  rawText: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Converte string monetária BRL para centavos.
 * Suporta: "1.457,16" | "R$ 1.457,16" | "-1.800,00" | "1457.16"
 */
function parseBRL(raw: string): number {
  if (!raw || raw.trim() === '' || raw.trim() === '-') return 0
  const str = raw.trim()
  const neg = str.startsWith('-') || str.includes('R$ -') || str.includes('R$-')
  // Remove tudo exceto dígitos e separadores
  const clean = str.replace(/[^0-9,.]/g, '')
  if (!clean) return 0
  // Formato brasileiro: 1.234,56 → 1234.56
  let normalized: string
  if (clean.includes(',')) {
    normalized = clean.replace(/\./g, '').replace(',', '.')
  } else {
    // Já está em formato decimal (ex: "1457.16" de algumas faturas digitais)
    normalized = clean
  }
  const value = Math.round(parseFloat(normalized) * 100)
  return isNaN(value) ? 0 : neg ? -value : value
}

/**
 * Converte "13/04/2026" → "2026-04-13"
 * Converte "13/04" com inferredYear → "2026-04-13"
 */
function parseDate(raw: string, inferredYear?: number): string {
  const parts = raw.trim().split('/')
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
  }
  if (parts.length === 2 && inferredYear) {
    return `${inferredYear}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
  }
  return raw
}

/** Mapa de meses em português para número */
const MONTH_MAP: Record<string, string> = {
  janeiro: '01', fevereiro: '02', março: '03', marco: '03',
  abril: '04', maio: '05', junho: '06', julho: '07',
  agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12',
}

/** Extrai YYYY-MM de texto como "maio/2026" ou "05/2026" */
function extractInvoiceMonth(text: string): string {
  // "maio/2026" ou "maio de 2026"
  for (const [name, num] of Object.entries(MONTH_MAP)) {
    const re = new RegExp(`${name}[/\\s](?:de\\s+)?(\\d{4})`, 'i')
    const m = text.match(re)
    if (m) return `${m[1]}-${num}`
  }
  // "05/2026"
  const numericMonth = text.match(/\b(0[1-9]|1[0-2])\/(20\d{2})\b/)
  if (numericMonth) return `${numericMonth[2]}-${numericMonth[1]}`
  return `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
}

// ─── Text extraction ──────────────────────────────────────────────────────────

async function extractText(buffer: Buffer): Promise<string> {
  const { execFileSync } = await import('child_process')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  const { writeFileSync, unlinkSync } = await import('fs')

  const tmpFile = join(tmpdir(), `itau-invoice-${Date.now()}.pdf`)
  writeFileSync(tmpFile, buffer)

  try {
    const script = `
import sys, pdfplumber
with pdfplumber.open(sys.argv[1]) as pdf:
    text = '\\n'.join(p.extract_text(x_tolerance=3, y_tolerance=3) or '' for p in pdf.pages)
    print(text)
`
    const result = execFileSync('python3', ['-c', script, tmpFile], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    })
    return result
  } finally {
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  }
}

// ─── Summary parser ───────────────────────────────────────────────────────────

function parseSummary(text: string): ItauInvoiceSummary {
  const lower = text.toLowerCase()

  // ── Produto e últimos 4 dígitos ──────────────────────────────────────────
  // "ITAUCARD VISA PLATINUM" / "PERSONNALITÉ MASTERCARD" / "ITAÚ VISA GOLD"
  let product = 'ITAUCARD'
  const productPatterns = [
    /PERSONNALITÉ\s+(?:VISA|MASTERCARD|MC)[^\n]*/i,
    /ITAUCARD\s+(?:VISA|MASTERCARD|MC|AMEX)[^\n]*/i,
    /ITAÚ\s+(?:VISA|MASTERCARD|MC)[^\n]*/i,
    /CARTÃO\s+(?:VISA|MASTERCARD|MC|AMEX)[^\n]*/i,
  ]
  for (const p of productPatterns) {
    const m = text.match(p)
    if (m) { product = m[0].trim().replace(/\s+/g, ' ').substring(0, 80); break }
  }

  // Últimos 4 dígitos: "final 1234" | "cartão 1234" | "xxxx xxxx xxxx 1234"
  let cardLast4 = '0000'
  const last4Patterns = [
    /final\s+(\d{4})/i,
    /cart[aã]o\s+(?:de\s+cr[eé]dito\s+)?(?:n[uú]mero\s+)?(?:\d[\d\s*x-]*)?(\d{4})\b/i,
    /\b(?:xxxx\s+){3}(\d{4})\b/i,
    /\*{4}\s*(\d{4})\b/,
    /\b(\d{4})\s*$(?=.*cart[aã]o)/im,
  ]
  for (const p of last4Patterns) {
    const m = text.match(p)
    if (m) { cardLast4 = m[1]; break }
  }

  // ── Datas ────────────────────────────────────────────────────────────────
  // Vencimento: "Vencimento 13/05/2026" | "vence em 13/05/2026"
  let dueDate = ''
  const dueDateMatch = text.match(/[Vv]encimento\s*:?\s*(\d{2}\/\d{2}\/\d{4})/)
    ?? text.match(/[Vv]ence\s+em\s+(\d{2}\/\d{2}\/\d{4})/)
    ?? text.match(/[Dd]ata\s+de\s+[Vv]encimento\s*:?\s*(\d{2}\/\d{2}\/\d{4})/)
  if (dueDateMatch) dueDate = parseDate(dueDateMatch[1])

  // Fechamento: "Fechamento 20/04/2026" | "Data de fechamento"
  let closingDate = ''
  const closingMatch = text.match(/[Ff]echamento\s*:?\s*(\d{2}\/\d{2}\/\d{4})/)
    ?? text.match(/[Dd]ata\s+de\s+[Ff]echamento\s*:?\s*(\d{2}\/\d{2}\/\d{4})/)
  if (closingMatch) closingDate = parseDate(closingMatch[1])

  // Mês da fatura
  const invoiceMonth = dueDate
    ? `${dueDate.slice(0, 4)}-${dueDate.slice(5, 7)}`
    : extractInvoiceMonth(text)
  const dueMonth = dueDate
    ? `${dueDate.slice(0, 4)}-${dueDate.slice(5, 7)}`
    : invoiceMonth

  // ── Valores financeiros ──────────────────────────────────────────────────
  // Total da fatura: "Total da fatura R$ 1.234,56" | "Valor total R$ 1.234,56"
  let totalMinor = 0
  const totalMatch = text.match(/[Tt]otal\s+da\s+[Ff]atura\s*R?\$?\s*([\d.,]+)/)
    ?? text.match(/[Vv]alor\s+[Tt]otal\s*:?\s*R?\$?\s*([\d.,]+)/)
    ?? text.match(/[Tt]otal\s+a\s+[Pp]agar\s*:?\s*R?\$?\s*([\d.,]+)/)
  if (totalMatch) totalMinor = parseBRL(totalMatch[1])

  // Saldo anterior: "Saldo anterior R$ 3.641,06"
  let previousBalanceMinor = 0
  const prevMatch = text.match(/[Ss]aldo\s+(?:da\s+fatura\s+)?[Aa]nterior\s*:?\s*R?\$?\s*([\d.,]+)/)
    ?? text.match(/[Ff]atura\s+[Aa]nterior\s*:?\s*R?\$?\s*([\d.,]+)/)
  if (prevMatch) previousBalanceMinor = parseBRL(prevMatch[1])

  // Pagamentos: "Pagamentos R$ 1.800,00" | "Créditos e pagamentos"
  let paymentsMinor = 0
  const payMatch = text.match(/[Pp]agamentos?\s*(?:e\s+[Cc]r[eé]ditos?)?\s*:?\s*R?\$?\s*([\d.,]+)/)
    ?? text.match(/[Cc]r[eé]ditos?\s+e\s+[Pp]agamentos?\s*:?\s*R?\$?\s*([\d.,]+)/)
  if (payMatch) paymentsMinor = parseBRL(payMatch[1])

  // Compras nacionais
  let nationalPurchasesMinor = 0
  const natMatch = text.match(/[Cc]ompras?\s+[Nn]acionais?\s*:?\s*R?\$?\s*([\d.,]+)/)
    ?? text.match(/[Nn]acionais?\s*:?\s*R?\$?\s*([\d.,]+)/)
  if (natMatch) nationalPurchasesMinor = parseBRL(natMatch[1])

  // Compras internacionais
  let internationalPurchasesMinor = 0
  const intlMatch = text.match(/[Cc]ompras?\s+[Ii]nternacionais?\s*:?\s*R?\$?\s*([\d.,]+)/)
    ?? text.match(/[Ii]nternacionais?\s*:?\s*R?\$?\s*([\d.,]+)/)
  if (intlMatch) internationalPurchasesMinor = parseBRL(intlMatch[1])

  // Encargos/tarifas/juros
  let chargesMinor = 0
  const chargesMatch = text.match(/[Ee]ncargos?\s*:?\s*R?\$?\s*([\d.,]+)/)
    ?? text.match(/[Tt]arifas?\s*:?\s*R?\$?\s*([\d.,]+)/)
    ?? text.match(/[Jj]uros?\s*:?\s*R?\$?\s*([\d.,]+)/)
  if (chargesMatch) chargesMinor = parseBRL(chargesMatch[1])

  // Saldo em aberto: "Saldo em aberto R$ 1.234,56" | "Valor a pagar"
  let openBalanceMinor = totalMinor // fallback: total se não encontrar
  const openMatch = text.match(/[Ss]aldo\s+em\s+[Aa]berto\s*:?\s*R?\$?\s*([\d.,]+)/)
    ?? text.match(/[Vv]alor\s+a\s+[Pp]agar\s*:?\s*R?\$?\s*([\d.,]+)/)
    ?? text.match(/[Mm]ínimo\s+a\s+[Pp]agar\s*:?\s*R?\$?\s*([\d.,]+)/)
  if (openMatch) openBalanceMinor = parseBRL(openMatch[1])

  // Fallback: se não encontrou compras nacionais/internacionais, calcular por diferença
  if (nationalPurchasesMinor === 0 && internationalPurchasesMinor === 0 && totalMinor > 0) {
    nationalPurchasesMinor = totalMinor - previousBalanceMinor + paymentsMinor - chargesMinor
    if (nationalPurchasesMinor < 0) nationalPurchasesMinor = 0
  }

  return {
    bank: 'itau',
    product,
    cardLast4,
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

// ─── Transactions parser ──────────────────────────────────────────────────────

/**
 * Detecta se uma linha de transação é internacional.
 * Indicadores: moeda estrangeira, país diferente de BR, padrão "USD", "EUR", etc.
 */
function detectInternational(line: string): boolean {
  return /\b(USD|EUR|GBP|JPY|ARS|CLP|UYU|PYG|BOB|PEN|COP|MXN)\b/.test(line)
    || /\b[A-Z]{2}\s+R\$/.test(line) // "US R$ 123,45"
    || /compra\s+no\s+exterior/i.test(line)
    || /international/i.test(line)
}

/**
 * Extrai dados de moeda estrangeira de uma linha de transação internacional.
 * Padrões comuns no Itaú:
 *   "USD 25,00 - Câmbio R$ 5,8432 = R$ 146,08"
 *   "25,00 USD R$ 146,08"
 */
function extractCurrencyData(line: string): {
  originalAmountMinor?: number
  originalCurrencyCode?: string
  exchangeRate?: number
} {
  // Padrão: "USD 25,00" ou "25,00 USD"
  const currencyMatch = line.match(
    /\b(USD|EUR|GBP|JPY|ARS|CLP|UYU|PYG|BOB|PEN|COP|MXN)\s+([\d.,]+)/i
  ) ?? line.match(/([\d.,]+)\s+(USD|EUR|GBP|JPY|ARS|CLP|UYU|PYG|BOB|PEN|COP|MXN)\b/i)

  if (!currencyMatch) return {}

  const currencyCode = currencyMatch[1].toUpperCase().length === 3
    ? currencyMatch[1].toUpperCase()
    : currencyMatch[2].toUpperCase()
  const rawAmount = currencyMatch[1].length === 3 ? currencyMatch[2] : currencyMatch[1]
  const originalAmountMinor = parseBRL(rawAmount)

  // Câmbio: "Câmbio R$ 5,8432" | "câmbio 5,8432"
  const rateMatch = line.match(/[Cc][âa]mbio\s+(?:R\$\s*)?([\d.,]+)/)
  const exchangeRate = rateMatch ? parseFloat(rateMatch[1].replace(',', '.')) : undefined

  return { originalAmountMinor, originalCurrencyCode: currencyCode, exchangeRate }
}

function parseTransactions(text: string, invoiceYear: number): ItauTransaction[] {
  const transactions: ItauTransaction[] = []

  // Bloco de transações: começa após "Data Lançamento Valor" ou "Lançamentos"
  // e termina antes de "Total" ou "Resumo"
  const blockPatterns = [
    /(?:Data\s+)?Lan[çc]amentos?\s*\n([\s\S]*?)(?:Total\s+da\s+[Ff]atura|Resumo\s+da\s+[Ff]atura)/,
    /(?:Data\s+)?(?:Descri[çc][aã]o\s+)?Valor\s*\n([\s\S]*?)(?:Total\s+da\s+[Ff]atura|Resumo)/,
    /LANÇAMENTOS([\s\S]*?)TOTAL DA FATURA/i,
  ]

  let block = ''
  for (const pattern of blockPatterns) {
    const m = text.match(pattern)
    if (m) { block = m[1]; break }
  }

  // Fallback: usar o texto completo se não encontrar bloco delimitado
  if (!block) block = text

  const lines = block.split('\n').map(l => l.trim()).filter(Boolean)

  // Categorias conhecidas do Itaú
  const CATEGORIES = new Set([
    'Pagamentos', 'Créditos', 'Pagamentos e Créditos',
    'Compras e Débitos', 'Compras Parceladas', 'Compras no Exterior',
    'Serviços', 'Restaurantes', 'Supermercados', 'Saúde', 'Educação',
    'Transporte', 'Entretenimento', 'Viagens', 'Outros Lançamentos',
    'Encargos', 'Tarifas', 'Anuidade',
  ])

  let currentCategory = 'Outros'
  let isInternationalSection = false

  // Padrão principal de transação Itaú:
  // "13/04 NOME DO ESTABELECIMENTO R$ 123,45"
  // "13/04 NOME DO ESTABELECIMENTO 123,45"
  // "13/04 NOME PARC 03/12 R$ 123,45"
  const txPattern = /^(\d{2}\/\d{2})\s+(.+?)\s+R?\$?\s*(-?[\d.,]+)$/
  // Linha de pagamento: "13/04 PAGAMENTO RECEBIDO R$ -1.800,00"
  const paymentPattern = /^(\d{2}\/\d{2})\s+(PAGAMENTO|CREDITO|CRÉDITO|ESTORNO)[^\n]*R?\$?\s*(-?[\d.,]+)$/i

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Detectar seção de compras internacionais
    if (/compras?\s+(?:no\s+)?exterior|internacionais?/i.test(line)) {
      isInternationalSection = true
      currentCategory = 'Compras no Exterior'
      continue
    }
    if (/compras?\s+nacionais?|lançamentos?\s+nacionais?/i.test(line)) {
      isInternationalSection = false
      currentCategory = 'Compras e Débitos'
      continue
    }

    // Detectar heading de categoria
    if (CATEGORIES.has(line)) {
      currentCategory = line
      isInternationalSection = line.toLowerCase().includes('exterior')
        || line.toLowerCase().includes('internacional')
      continue
    }

    // Tentar match de transação
    const txMatch = line.match(txPattern) ?? line.match(paymentPattern)
    if (!txMatch) continue

    const [, datePart, rawDesc, valuePart] = txMatch

    // Determinar ano da transação (transações de dezembro numa fatura de janeiro)
    const txMonth = parseInt(datePart.slice(3, 5), 10)
    const invoiceMonthNum = parseInt(
      MONTH_MAP[
        Object.keys(MONTH_MAP).find(k => text.toLowerCase().includes(k)) ?? ''
      ] ?? String(new Date().getMonth() + 1),
      10
    )
    const txYear = txMonth > 6 && invoiceMonthNum < 3 ? invoiceYear - 1 : invoiceYear

    // Parcelas: "PARC 03/12" | "03/12" no final da descrição
    const installMatch = rawDesc.match(/PARC\s+(\d{2}\/\d{2})/i)
      ?? rawDesc.match(/\s(\d{2}\/\d{2})$/)
    const installment = installMatch ? installMatch[1] : undefined
    const description = rawDesc
      .replace(/PARC\s+\d{2}\/\d{2}/i, '')
      .replace(/\s\d{2}\/\d{2}$/, '')
      .trim()

    // Valor: crédito/pagamento = negativo
    const isCredit = valuePart.startsWith('-')
      || /pagamento|crédito|credito|estorno/i.test(description)
      || currentCategory === 'Pagamentos'
      || currentCategory === 'Pagamentos e Créditos'
    const rawValue = isCredit
      ? `-${valuePart.replace('-', '')}`
      : valuePart
    const amountMinor = parseBRL(rawValue)

    // País: detectar se internacional
    const isIntl = isInternationalSection || detectInternational(line)
    const country = isIntl ? 'EX' : 'BR' // EX = exterior (padrão Itaú)

    // Dados de moeda estrangeira (linha actual + próxima linha de detalhe)
    let currencyData: ReturnType<typeof extractCurrencyData> = {}
    if (isIntl) {
      // Verificar linha actual e próxima para dados de câmbio
      const contextLine = line + ' ' + (lines[i + 1] ?? '')
      currencyData = extractCurrencyData(contextLine)
      // Se a próxima linha é detalhe de câmbio, pular
      if (lines[i + 1] && /câmbio|cambio|USD|EUR|GBP/i.test(lines[i + 1])) {
        i++
      }
    }

    transactions.push({
      date: parseDate(datePart, txYear),
      description,
      category: currentCategory,
      amountMinor,
      country,
      ...(installment && { installment }),
      ...currencyData,
    })
  }

  return transactions
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Detecta se um texto extraído de PDF é de uma fatura do Itaú.
 * Usado para detecção automática no endpoint.
 */
export function isItauInvoice(text: string): boolean {
  const lower = text.toLowerCase()
  return lower.includes('itaú') || lower.includes('itau')
    || lower.includes('itaucard') || lower.includes('personnalité')
    || lower.includes('personnalite')
    || /banco\s+itau/i.test(text)
}

/**
 * Faz o parse de uma fatura PDF do Itaú.
 *
 * @param buffer - Buffer do arquivo PDF
 * @returns Fatura parseada com summary e transactions
 */
export async function parseItauInvoice(buffer: Buffer): Promise<ItauInvoice> {
  const rawText = await extractText(buffer)
  const summary = parseSummary(rawText)
  const invoiceYear = summary.dueDate
    ? parseInt(summary.dueDate.slice(0, 4), 10)
    : new Date().getFullYear()
  const transactions = parseTransactions(rawText, invoiceYear)
  return { summary, transactions, rawText }
}

/**
 * Converte uma fatura Itaú parseada em entradas de forecast compatíveis com o CashFlow.
 *
 * Lógica:
 *  - Se openBalanceMinor > 0, cria uma previsão de despesa one-time
 *    no dueMonth (mês em que a fatura deve ser paga).
 *  - Parcelas com N/T geram previsões mensais para os meses restantes.
 *
 * @param invoice - Fatura Itaú parseada
 * @returns Array de objetos compatíveis com o forecast do CashFlow
 */
export function itauInvoiceToForecast(invoice: ItauInvoice): Array<{
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
      id: `itau-invoice-${summary.invoiceMonth}-${summary.cardLast4}`,
      competencyMonth: summary.dueMonth,
      amountMinor: -summary.openBalanceMinor, // negativo = despesa
      recurrence: 'one-time',
      description: `Fatura Itaú ${summary.product} (${summary.cardLast4}) - venc. ${summary.dueDate}`,
    },
  ]
}

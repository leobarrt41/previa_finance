/**
 * @previa/parser-itau
 *
 * Parser para faturas PDF do Itaú (Platinum Mastercard, Personnalité, etc.)
 *
 * Estratégia de extracção:
 *   1. Para cada página, detectar se existe uma linha de início de colunas
 *      ("Pagamentos efetuados" / "Lançamentos internacionais").
 *   2. Se não existe → página de cabeçalho → extrair como texto full.
 *   3. Se existe → página de transacções → extrair:
 *        a) Cabeçalho da página (acima da linha de início) como texto full.
 *        b) Coluna esquerda  (x: 0   → 350) como texto de nacionais.
 *        c) Coluna direita   (x: 350 → 595) como texto de internacionais.
 *   4. Parsear summary a partir do texto full de todas as páginas.
 *   5. Parsear transacções nacionais da coluna esquerda.
 *   6. Parsear transacções internacionais da coluna direita.
 *
 * Regra de domínio (ETP §6.2):
 *   - Compras de cartão NÃO vão para transactions.
 *   - Vão para card_transactions + card_invoices.
 *   - O pagamento da fatura é o evento que afecta o caixa.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ItauTransaction {
  date: string
  description: string
  category: string
  amountMinor: number
  installment?: string
  country: string
  originalAmountMinor?: number
  originalCurrencyCode?: string
  exchangeRate?: number
}

export interface ItauInvoiceSummary {
  bank: 'itau'
  product: string
  cardLast4: string
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

export interface ItauInvoice {
  summary: ItauInvoiceSummary
  transactions: ItauTransaction[]
  rawText: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseBRL(raw: string): number {
  if (!raw || raw.trim() === '' || raw.trim() === '-') return 0
  const str = raw.trim()
  const neg = str.startsWith('-')
  const clean = str.replace(/[^0-9,]/g, '')
  if (!clean) return 0
  const normalized = clean.replace(/\./g, '').replace(',', '.')
  const value = Math.round(parseFloat(normalized) * 100)
  return isNaN(value) ? 0 : neg ? -value : value
}

function parseDateFull(ddmmyyyy: string): string {
  const parts = ddmmyyyy.split('/')
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
  }
  return ddmmyyyy
}

function parseDate(ddmm: string, year: number): string {
  const [dd, mm] = ddmm.split('/')
  return `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

function inferTxYear(txMonth: number, invoiceYear: number, invoiceMonth: number): number {
  if (txMonth >= 10 && invoiceMonth <= 3) return invoiceYear - 1
  return invoiceYear
}

function normalizeCategory(raw: string): string {
  const lower = (raw || '').toLowerCase().trim()
  if (lower.includes('alimenta') || lower.includes('supermercado')) return 'Alimentação'
  if (lower.includes('restaurante') || lower.includes('lanchonete') || lower.includes('bobs') || lower.includes('subway')) return 'Restaurante'
  if (lower.includes('saúde') || lower.includes('saude') || lower.includes('farmácia') || lower.includes('farmacia') || lower.includes('drogaria')) return 'Saúde'
  if (lower.includes('educac') || lower.includes('educaç')) return 'Educação'
  if (lower.includes('vestuário') || lower.includes('vestuario')) return 'Vestuário'
  if (lower.includes('entretenimento') || lower.includes('hobby')) return 'Entretenimento'
  if (lower.includes('moradia')) return 'Moradia'
  if (lower.includes('transporte') || lower.includes('combustível') || lower.includes('combustivel') || lower.includes('posto')) return 'Transporte'
  if (lower.includes('serviç') || lower.includes('servic')) return 'Serviços'
  return 'Outros'
}

// ─── PDF extraction via pdfplumber (bounding box) ─────────────────────────────

/**
 * Script Python que extrai o texto de cada página usando bounding box.
 *
 * Para páginas de transacções (detectadas pela presença de "Pagamentos efetuados"
 * ou "Lançamentos internacionais"), divide a página em:
 *   - Cabeçalho (acima da linha de início): texto full
 *   - Coluna esquerda (x: 0 → COL_SPLIT): nacionais
 *   - Coluna direita  (x: COL_SPLIT → largura): internacionais
 *
 * O separador de secções no output é "===LEFT===" e "===RIGHT===".
 */
const PYTHON_EXTRACTOR = `
import sys, pdfplumber, re

path = sys.argv[1]
password = sys.argv[2] if len(sys.argv) > 2 else None

COL_SPLIT = 350  # x que divide coluna esquerda da direita (em pts, página 595pt)

def is_col_start_line(words):
    """Detecta a linha que inicia as colunas de transacções."""
    text = ' '.join(w['text'] for w in words).lower()
    return (('pagamentos' in text and 'efetuados' in text) or
            ('pagamentos' in text and 'lançamentos' in text) or
            ('pagamentosefetuados' in text))

def words_to_text(words):
    if not words:
        return ''
    # Agrupar por linha (top arredondado a 3pts)
    from collections import defaultdict
    lines = defaultdict(list)
    for w in words:
        key = round(w['top'] / 3) * 3
        lines[key].append(w)
    result = []
    for key in sorted(lines.keys()):
        line_words = sorted(lines[key], key=lambda w: w['x0'])
        result.append(' '.join(w['text'] for w in line_words))
    return '\\n'.join(result)

pages_output = []

with pdfplumber.open(path, password=password) as pdf:
    for page in pdf.pages:
        w_page = page.width
        h_page = page.height
        words = page.extract_words(x_tolerance=3, y_tolerance=3) or []

        if not words:
            pages_output.append('')
            continue

        # Agrupar palavras por linha
        from collections import defaultdict
        lines_by_y = defaultdict(list)
        for w in words:
            key = round(w['top'] / 3) * 3
            lines_by_y[key].append(w)

        # Encontrar y de início das colunas
        col_start_y = None
        for y_key in sorted(lines_by_y.keys()):
            line_words = sorted(lines_by_y[y_key], key=lambda w: w['x0'])
            if is_col_start_line(line_words):
                col_start_y = y_key
                break

        if col_start_y is None:
            # Página sem colunas (cabeçalho, simulações, etc.)
            full_text = page.extract_text(x_tolerance=3, y_tolerance=3) or ''
            pages_output.append(full_text)
            continue

        # Página com colunas
        # 1. Cabeçalho (acima da linha de início)
        header_crop = page.crop((0, 0, w_page, col_start_y))
        header_text = header_crop.extract_text(x_tolerance=3, y_tolerance=3) or ''

        # 2. Coluna esquerda (nacionais)
        left_crop = page.crop((0, col_start_y, COL_SPLIT, h_page))
        left_text = left_crop.extract_text(x_tolerance=3, y_tolerance=3) or ''

        # 3. Coluna direita (internacionais)
        right_crop = page.crop((COL_SPLIT, col_start_y, w_page, h_page))
        right_text = right_crop.extract_text(x_tolerance=3, y_tolerance=3) or ''

        pages_output.append(header_text + '\\n===LEFT===\\n' + left_text + '\\n===RIGHT===\\n' + right_text)

print('\\n===PAGE===\\n'.join(pages_output))
`

async function extractStructuredText(buffer: Buffer, password?: string): Promise<{
  full: string
  leftColumns: string[]
  rightColumns: string[]
}> {
  const { execFileSync } = await import('child_process')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  const { writeFileSync, unlinkSync } = await import('fs')

  const tmpFile = join(tmpdir(), `itau-invoice-${Date.now()}.pdf`)
  writeFileSync(tmpFile, buffer)

  try {
    const args = password ? ['-c', PYTHON_EXTRACTOR, tmpFile, password] : ['-c', PYTHON_EXTRACTOR, tmpFile]
    const output = execFileSync('python3', args, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    })

    const pages = output.split('===PAGE===')
    const fullParts: string[] = []
    const leftColumns: string[] = []
    const rightColumns: string[] = []

    for (const page of pages) {
      if (page.includes('===LEFT===')) {
        const [header, rest] = page.split('===LEFT===')
        const [left, right] = rest.split('===RIGHT===')
        fullParts.push((header ?? '') + '\n' + (left ?? '') + '\n' + (right ?? ''))
        leftColumns.push((header ?? '') + '\n' + (left ?? ''))
        rightColumns.push(right ?? '')
      } else {
        fullParts.push(page)
        leftColumns.push(page)
        rightColumns.push('')
      }
    }

    return {
      full: fullParts.join('\n'),
      leftColumns,
      rightColumns,
    }
  } finally {
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  }
}

// ─── Summary parser ───────────────────────────────────────────────────────────

function parseSummary(full: string): ItauInvoiceSummary {
  let product = 'Itaucard'
  const productMatch = full.match(/^(Platinum|Personnalité|Personnalite|Gold|Black|Uniclass|Itaucard[^\n]*)/im)
  if (productMatch) product = productMatch[1].trim()

  let cardLast4 = '0000'
  const cardMatch = full.match(/Cart[aã]o\s+[\d.X*]+\.(\d{4})\b/i)
    ?? full.match(/Cart[aã]o\s*5417\.XXXX\.XXXX\.(\d{4})/i)
    ?? full.match(/final\s*(\d{4})/i)
    ?? full.match(/\*{4}\s*(\d{4})/)
  if (cardMatch) cardLast4 = cardMatch[1]

  let dueDate = ''
  const dueMatch = full.match(/Vencimento\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i)
    ?? full.match(/Vencimento:(\d{2}\/\d{2}\/\d{4})/i)
  if (dueMatch) dueDate = parseDateFull(dueMatch[1])

  let closingDate = ''
  const closingMatch = full.match(/Previs[aã]o\s+(?:para\s+o\s+pr[oó]ximo\s+fechamento|pr[oó]x\.?\s+Fechamento)\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i)
    ?? full.match(/Previs[aã]odo?pr[oó]ximo(?:fechamento)?:?(\d{2}\/\d{2}\/\d{4})/i)
    ?? full.match(/Previs[aã]oprox\.?Fechamento:(\d{2}\/\d{2}\/\d{4})/i)
  if (closingMatch) closingDate = parseDateFull(closingMatch[1])

  const invoiceMonth = dueDate ? dueDate.slice(0, 7) : ''
  const dueMonth = invoiceMonth

  let totalMinor = 0
  const totalMatch = full.match(/=\s*Total\s*desta\s*fatura\s+([\d.,]+)/i)
    ?? full.match(/=Totaldestafatura\s+([\d.,]+)/i)
    ?? full.match(/Total\s+desta\s+fatura\s+([\d.,]+)/i)
  if (totalMatch) totalMinor = parseBRL(totalMatch[1])

  let previousBalanceMinor = 0
  const prevMatch = full.match(/Total\s+da\s+fatura\s+anterior\s+([\d.,]+)/i)
    ?? full.match(/Totaldafaturaanterior\s+([\d.,]+)/i)
  if (prevMatch) previousBalanceMinor = parseBRL(prevMatch[1])

  let paymentsMinor = 0
  const payMatch = full.match(/Pagamento\s+efetuado\s+em\s+[\d/]+\s+(-[\d.,]+)/i)
    ?? full.match(/Pagamentoefetuadoem[\d/]+\s*(-[\d.,]+)/i)
    ?? full.match(/Total\s+dos\s+pagamentos\s+(-[\d.,]+)/i)
    ?? full.match(/Totaldospagamentos\s*(-[\d.,]+)/i)
  if (payMatch) paymentsMinor = Math.abs(parseBRL(payMatch[1]))

  let nationalPurchasesMinor = 0
  const natMatches = [...full.matchAll(/Lan[çc]amentos\s*no\s*cart[aã]o(?:\s*\(final\s*\d{4}\))?\s+([\d.,]+)/gi)]
  if (natMatches.length > 0) {
    nationalPurchasesMinor = natMatches.reduce((sum, m) => sum + parseBRL(m[1]), 0)
  }

  let internationalPurchasesMinor = 0
  const intlMatch = full.match(/Total\s*lan[çc]amentos\s*inter\.\s*em\s*R\$\s*([\d.,]+)/i)
    ?? full.match(/Totallançamentosinter\.emR\$\s*([\d.,]+)/i)
    ?? full.match(/Totallançamentosinter\.emR\$([\d.,]+)/i)
  if (intlMatch) internationalPurchasesMinor = parseBRL(intlMatch[1])

  let chargesMinor = 0
  const chargesMatch = full.match(/Lan[çc]amentos\s*produtos\s*e\s*servi[çc]os\s+([\d.,]+)/i)
    ?? full.match(/Lançamentosprodutoseserviços\s+([\d.,]+)/i)
  if (chargesMatch) chargesMinor = parseBRL(chargesMatch[1])

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
    openBalanceMinor: totalMinor,
  }
}

// ─── Transactions parser ──────────────────────────────────────────────────────

/**
 * Regex para transação: DD/MM DESCRIÇÃO [N/T] VALOR
 * - Aceita zero ou mais espaços após a data (ex: "05/03LEONARDO.AI...")
 * - Aceita dígitos na descrição quando seguidos de / (ex: "Serasa Experia 11/12")
 */
const TX_RE = /(\d{2}\/\d{2})\s*([\w][^\n]+?)\s+(-?[\d.]+,\d{2})(?=\s|$)/g

const IGNORE_PATTERNS = [
  /^Total\s+(da\s+fatura|desta\s+fatura|dos\s+pagamentos|lançamentos|transações)/i,
  /^Totaldafatura/i,
  /^Totaldospagamentos/i,
  /^Totallançamentos/i,
  /^Totaltransações/i,
  /^Lan[çc]amentos\s+no\s+cart[aã]o/i,
  /^Lançamentosnocartão/i,
  /^Lan[çc]amentos\s+produtos/i,
  /^Lançamentosprodutos/i,
  /^LTotal/i,
  /^L\s+Total/i,
  /^Pr[oó]xima\s+fatura/i,
  /^Demais\s+faturas/i,
  /^Total\s+para\s+pr[oó]ximas/i,
  /^Limite\s+(total|disponível|máximo)/i,
  /^Juros/i,
  /^IOF/i,
  /^Multa/i,
  /^Repasse/i,
  /^Valor\s+total\s+financiado/i,
  /^Encargos/i,
  /^Simulação/i,
  /^Parcelas\s+fixas/i,
  /^Pagamento\s+m[ií]nimo/i,
  /^Pagamentomínimo/i,
  /^Contratação/i,
  /^Limitetotal/i,
  /^Limitedisponível/i,
  /^Limitemáximo/i,
  /^Crédito\s+Rotativo/i,
  /^%\s+sobre/i,
  /^Valor\s+solicitado/i,
  /^Valor\s+em\s+reais/i,
  /^Principal\s*\(/i,
  /^Anuidade/i,
  /^AnuidadeDiferenci/i,
  /^DATA\s+(ESTABELECIMENTO|VALOR|PRODUTOS)/i,
  /^DATAESTABELECIMENTO/i,
  /^LEONARDOBARRETOBAPTISTA/i,
  /^LEONARDOBBAPTISTA/i,
  /^LEONARDO\s+BARRETO/i,
  /^Comprasparceladas/i,
  /^Compras\s+parceladas/i,
  /^Totalparapróximas/i,
  /^Titular\s+\d{4}/i,
  /^LTotaldoslançamentos/i,
]

function shouldIgnore(desc: string): boolean {
  return IGNORE_PATTERNS.some(p => p.test(desc.trim()))
}

function parseNationalTransactions(
  leftText: string,
  invoiceYear: number,
  invoiceMonth: number
): ItauTransaction[] {
  const transactions: ItauTransaction[] = []
  const seen = new Set<string>()
  const lines = leftText.split('\n').map(l => l.trim()).filter(Boolean)

  // Ignorar secção de próximas faturas
  let inNextInvoices = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (/^Compras\s*parceladas\s*-\s*pr[oó]ximas\s*faturas/i.test(line)
      || /^Comprasparceladas-próximas/i.test(line)) {
      inNextInvoices = true
      continue
    }
    if (inNextInvoices) continue

    if (shouldIgnore(line)) continue

    const matches = [...line.matchAll(TX_RE)]
    for (const m of matches) {
      const [, datePart, rawDesc, valuePart] = m
      const desc = rawDesc.trim()
      if (shouldIgnore(desc)) continue

      const txMonth = parseInt(datePart.slice(3, 5), 10)
      const value = parseBRL(valuePart)
      if (value === 0) continue

      // Pagamento
      if (/^PAGAMENTO/i.test(desc)) {
        const key = `${datePart}|PAGAMENTO|${value}`
        if (!seen.has(key)) {
          seen.add(key)
          transactions.push({
            date: parseDate(datePart, inferTxYear(txMonth, invoiceYear, invoiceMonth)),
            description: desc,
            category: 'Pagamento',
            amountMinor: value,
            country: 'BR',
          })
        }
        continue
      }

      // Detectar parcela
      const installMatch = desc.match(/\s(\d{2}\/\d{2})$/)
      let installment: string | undefined
      let description = desc
      if (installMatch) {
        const parts = installMatch[1].split('/')
        const num = parseInt(parts[0], 10)
        const total = parseInt(parts[1], 10)
        if (num <= total && total <= 72) {
          installment = installMatch[1]
          description = desc.slice(0, desc.lastIndexOf(installMatch[0])).trim()
        }
      }

      // Categoria da linha seguinte
      let category = 'Outros'
      const nextLine = lines[i + 1]?.trim() ?? ''
      if (nextLine && /^[a-záéíóúâêîôûãõA-Z]/i.test(nextLine)
        && !nextLine.match(/^\d{2}\/\d{2}/)
        && !shouldIgnore(nextLine)) {
        const catWord = nextLine.split(/\s+/)[0]
        if (catWord) category = normalizeCategory(catWord)
      }

      const key = `${datePart}|${description}|${Math.abs(value)}`
      if (!seen.has(key)) {
        seen.add(key)
        transactions.push({
          date: parseDate(datePart, inferTxYear(txMonth, invoiceYear, invoiceMonth)),
          description,
          category,
          amountMinor: Math.abs(value),
          country: 'BR',
          ...(installment && { installment }),
        })
      }
    }
  }

  return transactions
}

function parseInternationalTransactions(
  rightText: string,
  invoiceYear: number,
  invoiceMonth: number
): ItauTransaction[] {
  const transactions: ItauTransaction[] = []
  const seen = new Set<string>()
  const lines = rightText.split('\n').map(l => l.trim()).filter(Boolean)

  // Ignorar secção de próximas faturas e limites
  let inNextInvoices = false
  let pendingTx: Partial<ItauTransaction> | null = null

  const flush = () => {
    if (pendingTx?.date && pendingTx?.amountMinor !== undefined && pendingTx.amountMinor > 0) {
      const key = `${pendingTx.date}|${pendingTx.description}|${pendingTx.amountMinor}|EX`
      if (!seen.has(key)) {
        seen.add(key)
        transactions.push(pendingTx as ItauTransaction)
      }
    }
    pendingTx = null
  }

  for (const line of lines) {
    if (/^Compras\s*parceladas/i.test(line) || /^Comprasparceladas/i.test(line)) {
      flush()
      inNextInvoices = true
      continue
    }
    if (inNextInvoices) continue

    // Fim do bloco internacional
    if (/^Total\s*lan[çc]amentos\s*inter/i.test(line)
      || /^Totallançamentosinter/i.test(line)
      || /^Totaltransaçõesinter/i.test(line)) {
      flush()
      break
    }

    // Câmbio
    const exchangeMatch = line.match(/D[oó]lar\s*de\s*Convers[aã]o\s*R\$\s*([\d.,]+)/i)
      ?? line.match(/DólardeConversãoR\$([\d.,]+)/i)
    if (exchangeMatch && pendingTx) {
      pendingTx.exchangeRate = parseFloat(exchangeMatch[1].replace(',', '.'))
      flush()
      continue
    }

    // Linha de moeda estrangeira: "39,00 USD 39,00" ou "SINGAPORE 39,00 USD 39,00"
    const usdMatch = line.match(/(?:^|[A-ZÁÉÍÓÚÂÊÎÔÛÃÕ\s]+\s)([\d.,]+)\s+(USD|EUR|GBP|JPY|ARS|CLP|UYU|PYG|BOB|PEN|COP|MXN)\s+([\d.,]+)/i)
    if (usdMatch && pendingTx) {
      const [, rawOriginal, currencyCode] = usdMatch
      pendingTx.originalAmountMinor = Math.round(parseFloat(rawOriginal.replace(',', '.')) * 100)
      pendingTx.originalCurrencyCode = currencyCode.toUpperCase()
      continue
    }

    // Transação internacional: "DD/MM DESCRIÇÃO VALOR"
    const txMatch = line.match(/^(\d{2}\/\d{2})\s*(.+?)\s+(-?[\d.]+,\d{2})$/)
    if (txMatch) {
      flush()
      const [, datePart, rawDesc, valuePart] = txMatch
      const txMonth = parseInt(datePart.slice(3, 5), 10)
      pendingTx = {
        date: parseDate(datePart, inferTxYear(txMonth, invoiceYear, invoiceMonth)),
        description: rawDesc.trim(),
        category: 'Internacional',
        amountMinor: Math.abs(parseBRL(valuePart)),
        country: 'EX',
      }
      continue
    }
  }

  flush()
  return transactions
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function isItauInvoice(text: string): boolean {
  return /banco\s*ita[uú]/i.test(text)
    || /itaucard/i.test(text)
    || /personnalité/i.test(text)
    || /personnalite/i.test(text)
    || /ita[uú]\s*unibanco/i.test(text)
    || /Cart[aã]o\s+5417\./i.test(text)
}

export async function parseItauInvoice(buffer: Buffer, password?: string): Promise<ItauInvoice> {
  const { full, leftColumns, rightColumns } = await extractStructuredText(buffer, password)

  const summary = parseSummary(full)
  const invoiceYear = summary.dueDate
    ? parseInt(summary.dueDate.slice(0, 4), 10)
    : new Date().getFullYear()
  const invoiceMonth = summary.dueDate
    ? parseInt(summary.dueDate.slice(5, 7), 10)
    : new Date().getMonth() + 1

  const leftText = leftColumns.join('\n')
  const rightText = rightColumns.join('\n')

  const nationalTxs = parseNationalTransactions(leftText, invoiceYear, invoiceMonth)
  const internationalTxs = parseInternationalTransactions(rightText, invoiceYear, invoiceMonth)

  return {
    summary,
    transactions: [...nationalTxs, ...internationalTxs],
    rawText: full,
  }
}

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
      amountMinor: -summary.openBalanceMinor,
      recurrence: 'one-time',
      description: `Fatura Itaú ${summary.product} (${summary.cardLast4}) - venc. ${summary.dueDate}`,
    },
  ]
}

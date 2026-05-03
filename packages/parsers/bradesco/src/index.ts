/**
 * @previa/parser-bradesco
 *
 * Bradesco/Bradescard invoice parser based on the local docs/bradesco.ts
 * reference heuristics, adapted to the package output shape.
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

const datePrefixRegex = /(\d{2}\/\d{2})\s+/
const amountRegex = /\d{1,3}(?:\.\d{3})*,\d{2}/g
const installmentRegex = /(?:\(|PARC\s*)?(\d{1,2})\s*\/\s*(\d{1,2})(?:\))?/i

function parseAmountToCents(value: string): number | null {
  const normalized = value.replace(/\./g, '').replace(',', '.')
  const num = Number(normalized)
  if (!Number.isFinite(num) || num <= 0) return null
  return Math.round(num * 100)
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
    .replace(/\s+\d{4}\.\d{2}\*{2}\.\*{4}\.\d{4}\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function isGarbageDescription(raw: string): boolean {
  const normalized = normalizeLine(raw).replace(/R\$/g, '').replace(/[^A-Z0-9]/g, '')
  return normalized.length === 0
}

function extractDueDate(text: string): Date | null {
  const normalized = text.replace(/\r/g, '\n')
  const m =
    normalized.match(/VENCIMENTO[:\s]*([0-3]\d)[\/-](\d{2})[\/-](\d{4})/i) ??
    normalized.match(/Vencimento[\s\S]*?(\d{2}\/\d{2}\/\d{4})/i)
  if (!m) return null
  if (m[1] && m[2] && m[3]) {
    const day = Number(m[1])
    const month = Number(m[2]) - 1
    const year = Number(m[3])
    if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null
    const d = new Date(year, month, day, 12, 0, 0, 0)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const fallback = m[1]
  if (!fallback) return null
  const [dd, mm, yyyy] = fallback.split('/')
  if (!dd || !mm || !yyyy) return null
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), 12, 0, 0, 0)
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
  let best = candidates[0]
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
    /LIMITE/,
    /OPCOES DE PAGAMENTO/,
    /PAGAMENTO MINIMO/,
    /^NACIONAIS EM REAIS/,
    /^DATA DESCRICAO/,
  ]
  if (skipPatterns.some((pattern) => pattern.test(normalized))) return true
  if (/\d{4}\.\d{2}\*{2}\.\*{4}\.\d{4}/.test(raw) || /\*{4,}/.test(raw)) return true
  return false
}

function inferCategory(description: string): string {
  const text = normalizeLine(description)
  if (text.includes('PAGAMENTO RECEBIDO')) return 'Pagamentos'
  if (text.includes('ANUIDADE')) return 'Tarifas'
  if (text.includes('IOF')) return 'Impostos'
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
    const message = error instanceof Error ? `${error.message} ${(error as Error & { stderr?: Buffer | string }).stderr ?? ''}` : String(error)
    if (message.includes('PDF_PASSWORD_REQUIRED') || message.includes('PDFPasswordIncorrect')) {
      throw new Error('PDF_PASSWORD_REQUIRED')
    }
    throw error
  } finally {
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  }
}

function parseSummary(page1: string): BradescoInvoiceSummary {
  const productMatch =
    page1.match(/^([A-ZÀ-Ü0-9 .\-]+?)\s+4766\.[^\n]*?(\d{4})$/m) ??
    page1.match(/(CASAS BAHIA[^\n]+?)\s+4766\.[^\n]*?(\d{4})/i) ??
    page1.match(/^([A-ZÀ-Ü0-9 .\-]+?)\s+\d{4}\.[^\n]*?(\d{4})$/m) ??
    page1.match(/(CASAS BAHIA[^\n]+?)\s+\d{4}\.[^\n]*?(\d{4})/i)
  const product = productMatch ? productMatch[1].trim() : 'BRADESCO'
  const cardLast4 = productMatch ? productMatch[2] : ''

  const dueDate = extractDueDate(page1)
  const dueMonth = dueDate ? dueDate.toISOString().slice(0, 7) : ''

  const totalMatch = page1.match(/Total da fatura[\s\S]*?R\$\s*([\d.,]+)/i)
  const totalMinor = totalMatch ? parseAmountToCents(totalMatch[1]) ?? 0 : 0

  const prevMatch = page1.match(/Saldo anterior[\s\S]*?R\$\s*([\d.,]+)(?:-)?/i)
  const previousBalanceMinor = prevMatch ? Math.abs(parseAmountToCents(prevMatch[1]) ?? 0) : 0

  const paymentsMatch = page1.match(/\(-\)\s*Cr[ée]ditos\/Pagamentos[\s\S]*?R\$\s*([\d.,]+)(?:-)?/i)
  const paymentsMinor = paymentsMatch ? Math.abs(parseAmountToCents(paymentsMatch[1]) ?? 0) : 0

  const purchasesMatch = page1.match(/\(\+\)\s*Compras\/Débitos[\s\S]*?R\$\s*([\d.,]+)(?:-)?/i)
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

function parsePageLines(pageText: string, fallbackYear: number, dueDate: Date | null): BradescoTransaction[] {
  const lines = pageText
    .replace(/\u00A0/g, ' ')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const items: BradescoTransaction[] = []
  let inLancamentos = false
  let hasSeenLancamentosHeader = false

  for (const line of lines) {
    const normalized = normalizeLine(line)

    if (
      /^LANCAMENTOS\b/.test(normalized) ||
      /TRANSACOES NACIONAIS/.test(normalized) ||
      /NACIONAIS EM REAIS/.test(normalized)
    ) {
      inLancamentos = true
      hasSeenLancamentosHeader = true
      continue
    }

    if (
      inLancamentos &&
      (/^TOTAL PARCELADO\b/.test(normalized) ||
        /^LIMITES\b/.test(normalized) ||
        /^OPCOES DE PAGAMENTO\b/.test(normalized) ||
        /^PAGAMENTO TOTAL\b/.test(normalized) ||
        /^PARCELAMENTO DA FATURA\b/.test(normalized) ||
        /^PAGAMENTO MINIMO\b/.test(normalized) ||
        /^TOTAL GERAL DOS LANCAMENTOS\b/.test(normalized))
    ) {
      break
    }

    if (!inLancamentos && hasSeenLancamentosHeader) continue
    if (shouldSkipDescription(line)) continue

    const dateMatch = datePrefixRegex.exec(line)
    datePrefixRegex.lastIndex = 0
    if (!dateMatch?.[1]) continue

    const due = dueDate ?? new Date()
    const parsedDate = parseDateDM(dateMatch[1], fallbackYear, dueDate) ?? due
    const start = dateMatch.index + dateMatch[0].length
    const rest = line.slice(start).trim()
    if (!rest) continue

    const amountMatch = amountRegex.exec(rest)
    amountRegex.lastIndex = 0
    if (!amountMatch?.[0]) continue

    const amountCents = parseAmountToCents(amountMatch[0])
    let description = sanitizeDescription(rest.slice(0, amountMatch.index).trim())
    if (!amountCents || !description || isGarbageDescription(description) || shouldSkipDescription(description)) continue

    const inst = installmentRegex.exec(description)
    installmentRegex.lastIndex = 0
    const instN = inst ? Number(inst[1]) : undefined
    const instT = inst ? Number(inst[2]) : undefined
    const validInstallment =
      instN &&
      instT &&
      instN >= 1 &&
      instT >= 1 &&
      instN <= instT &&
      instT <= 36

    let finalDate = parsedDate
    if (dueDate && validInstallment) {
      finalDate = alignInstallmentDateWithDueDate(
        parsedDate.getDate(),
        parsedDate.getMonth(),
        dueDate,
        instN
      )
    }

    const isCredit = /PAGAMENTO RECEBIDO/i.test(description) || /-\s*$/.test(amountMatch[0]) || /^-/.test(amountMatch[0])
    const amountMinor = isCredit ? -Math.abs(amountCents) : amountCents
    if (!description) continue

    description = description.replace(/\s*\(\d{2}\/\d{2}\)\s*$/, '').trim()

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
  const page2 = pages[1] ?? pages.slice(1).join('\n')
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

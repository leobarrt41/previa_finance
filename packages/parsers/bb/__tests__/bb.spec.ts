import * as fs from 'fs'
import * as path from 'path'
import { parseBBInvoice, invoiceToForecast } from '../src/index'

const FIXTURES = path.join(__dirname, 'fixtures')

describe('parseBBInvoice — bb abril.pdf', () => {
  let buffer: Buffer

  beforeAll(() => {
    buffer = fs.readFileSync(path.join(FIXTURES, 'bb abril.pdf'))
  })

  it('extracts summary fields', async () => {
    const invoice = await parseBBInvoice(buffer)
    const s = invoice.summary

    expect(s.cardLast4).toBe('2933')
    expect(s.dueDate).toBe('2026-04-13')
    expect(s.dueMonth).toBe('2026-04')
    expect(s.totalMinor).toBe(326332)           // R$ 3.263,32
    expect(s.previousBalanceMinor).toBe(364106) // R$ 3.641,06
    expect(s.openBalanceMinor).toBeGreaterThan(0)
  })

  it('extracts transactions', async () => {
    const invoice = await parseBBInvoice(buffer)
    expect(invoice.transactions.length).toBeGreaterThan(3)

    const tribus = invoice.transactions.find(t => t.description.includes('TRIBUS'))
    expect(tribus).toBeDefined()
    expect(tribus?.amountMinor).toBe(41500) // R$ 415,00
    expect(tribus?.category).toBe('Educação')
  })

  it('converts to cashflow forecast', async () => {
    const invoice = await parseBBInvoice(buffer)
    const forecasts = invoiceToForecast(invoice)

    expect(forecasts).toHaveLength(1)
    expect(forecasts[0].competencyMonth).toBe('2026-04')
    expect(forecasts[0].amountMinor).toBe(-326332) // negative = expense
    expect(forecasts[0].recurrence).toBe('one-time')
  })
})

describe('parseBBInvoice — bb fev 2026.pdf', () => {
  let buffer: Buffer

  beforeAll(() => {
    buffer = fs.readFileSync(path.join(FIXTURES, 'bb fev 2026.pdf'))
  })

  it('extracts summary fields', async () => {
    const invoice = await parseBBInvoice(buffer)
    const s = invoice.summary

    expect(s.dueDate).toBe('2026-02-13')
    expect(s.dueMonth).toBe('2026-02')
    expect(s.totalMinor).toBe(387822) // R$ 3.878,22
  })

  it('keeps payment in the summary only', async () => {
    const invoice = await parseBBInvoice(buffer)
    expect(invoice.transactions.some(t =>
      /PGTO|PAGAMENTO|SALDO FATURA ANTERIOR/i.test(t.description)
    )).toBe(false)
    expect(invoice.summary.paymentsMinor).toBeGreaterThan(0)
  })
})

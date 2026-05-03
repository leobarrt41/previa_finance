import { readFileSync } from 'fs'
import { resolve } from 'path'
import { parseBradescoInvoice, bradescoInvoiceToForecast, isBradescoInvoice } from '../src/index'

function loadFixture(name: string): Buffer {
  return readFileSync(resolve(__dirname, '../../../../FATURAS/BRADESCO', name))
}

describe('isBradescoInvoice', () => {
  it('detects bradescard content', () => {
    expect(isBradescoInvoice('CASAS BAHIA VISA PLATINUM Bradescard')).toBe(true)
    expect(isBradescoInvoice('Banco Bradesco S.A.')).toBe(true)
    expect(isBradescoInvoice('Itaú Platinum')).toBe(false)
  })
})

describe('parseBradescoInvoice', () => {
  it('parses May 2026 invoice', async () => {
    const invoice = await parseBradescoInvoice(loadFixture('FATURA MENSAL 05 2026.pdf'), '072961')
    expect(invoice.summary.cardLast4).toBe('6014')
    expect(invoice.summary.invoiceMonth).toBe('2026-05')
    expect(invoice.summary.dueDate).toBe('2026-05-10')
    expect(invoice.summary.totalMinor).toBe(34788)
    expect(invoice.summary.previousBalanceMinor).toBe(21720)
    expect(invoice.summary.paymentsMinor).toBe(21720)
    expect(invoice.transactions.length).toBeGreaterThan(0)
    expect(invoice.transactions.some((t) => t.description.includes('PAGAMENTO RECEBIDO'))).toBe(true)
    expect(bradescoInvoiceToForecast(invoice)).toHaveLength(1)
  })
})

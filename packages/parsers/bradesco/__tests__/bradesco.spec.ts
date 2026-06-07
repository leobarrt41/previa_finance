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
  it('parses April 2026 invoice with all launch lines', async () => {
    const invoice = await parseBradescoInvoice(loadFixture('FATURA MENSAL 04 2026.pdf'), '072961')
    expect(invoice.summary.cardLast4).toBe('6014')
    expect(invoice.summary.invoiceMonth).toBe('2026-02')
    expect(invoice.summary.dueDate).toBe('2026-02-10')
    expect(invoice.summary.totalMinor).toBe(21716)
    expect(invoice.summary.previousBalanceMinor).toBe(22736)
    expect(invoice.summary.paymentsMinor).toBe(22736)
    expect(invoice.transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: 'COMPRA PARCELADA CASAS BAHIA',
          amountMinor: 19136,
          installment: '6/24',
        }),
        expect.objectContaining({
          description: 'IOF DIARIO',
          amountMinor: 7,
        }),
        expect.objectContaining({
          description: 'IOF ADICIONAL',
          amountMinor: 73,
        }),
      ])
    )
    expect(bradescoInvoiceToForecast(invoice)).toHaveLength(1)
  })

  it('parses May 2026 invoice', async () => {
    const invoice = await parseBradescoInvoice(loadFixture('FATURA MENSAL 05 2026.pdf'), '072961')
    expect(invoice.summary.cardLast4).toBe('6014')
    expect(invoice.summary.invoiceMonth).toBe('2026-05')
    expect(invoice.summary.dueDate).toBe('2026-05-10')
    expect(invoice.summary.totalMinor).toBe(34788)
    expect(invoice.summary.previousBalanceMinor).toBe(21720)
    expect(invoice.summary.paymentsMinor).toBe(21720)
    expect(invoice.transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: 'COMPRA PARCELADA CASAS BAHIA',
          amountMinor: 19136,
          installment: '9/24',
        }),
        expect.objectContaining({
          description: 'PAGAMENTO RECEBIDO - OBRIGADO',
          amountMinor: -21720,
        }),
        expect.objectContaining({
          description: 'COMPRA PARCELADA CASAS BAHIA',
          amountMinor: 13152,
          installment: '1/24',
        }),
      ])
    )
    expect(invoice.transactions.some((t) => t.description.includes('PAGAMENTO RECEBIDO'))).toBe(true)
    expect(bradescoInvoiceToForecast(invoice)).toHaveLength(1)
  })
})

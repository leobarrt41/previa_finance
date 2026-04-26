/**
 * Testes unitários do parser Itaú.
 *
 * Estratégia: como não temos um PDF real de fixture ainda, os testes
 * usam mocks do módulo child_process para simular o texto extraído pelo
 * pdfplumber, permitindo validar toda a lógica de parsing sem dependência
 * de arquivo PDF real.
 *
 * Quando um PDF real do Itaú estiver disponível, adicionar em:
 *   __tests__/fixtures/itau-sample.pdf
 * e adicionar um describe com fs.readFileSync (igual ao parser BB).
 */

import { parseItauInvoice, itauInvoiceToForecast, isItauInvoice } from '../src/index'

// ─── Mock do extractText (child_process) ──────────────────────────────────────

// Texto simulado de uma fatura Itaú típica
const MOCK_ITAU_TEXT_NATIONAL = `
ITAUCARD VISA PLATINUM
Cartão final 5678
Vencimento 13/05/2026
Fechamento 20/04/2026
Saldo da fatura Anterior R$ 2.500,00
Pagamentos R$ 2.500,00
Compras Nacionais R$ 1.850,00
Encargos R$ 0,00
Total da Fatura R$ 1.850,00
Saldo em Aberto R$ 1.850,00

Lançamentos
Data Lançamento Valor
Pagamentos e Créditos
13/04 PAGAMENTO RECEBIDO R$ -2.500,00
Compras e Débitos
05/04 MERCADO EXTRA SAO PAULO R$ 320,50
10/04 POSTO IPIRANGA CAMPINAS R$ 180,00
15/04 NETFLIX.COM R$ 55,90
20/04 FARMACIA DROGASIL R$ 43,60
22/04 RESTAURANTE OUTBACK PARC 02/06 R$ 125,00
28/04 AMAZON.COM.BR R$ 189,99
Total da Fatura R$ 1.850,00
`

const MOCK_ITAU_TEXT_INTERNATIONAL = `
ITAUCARD VISA PLATINUM
Cartão final 5678
Vencimento 13/05/2026
Fechamento 20/04/2026
Saldo da fatura Anterior R$ 0,00
Pagamentos R$ 0,00
Compras Nacionais R$ 500,00
Compras Internacionais R$ 875,00
Encargos R$ 0,00
Total da Fatura R$ 1.375,00
Saldo em Aberto R$ 1.375,00

Lançamentos
Compras e Débitos
10/04 SUPERMERCADO LOCAL R$ 500,00
Compras no Exterior
15/04 AMAZON USA USD 25,00 Câmbio R$ 5,8432 R$ 146,08
18/04 NETFLIX USA USD 15,99 Câmbio R$ 5,8432 R$ 93,42
20/04 HOTEL MARRIOTT USD 120,00 Câmbio R$ 5,3750 R$ 645,00
Total da Fatura R$ 1.375,00
`

const MOCK_ITAU_TEXT_INSTALLMENT = `
ITAUCARD VISA PLATINUM
Cartão final 5678
Vencimento 13/05/2026
Fechamento 20/04/2026
Total da Fatura R$ 2.400,00
Saldo em Aberto R$ 2.400,00

Lançamentos
Compras Parceladas
01/04 SAMSUNG STORE PARC 03/12 R$ 200,00
05/04 APPLE STORE PARC 01/06 R$ 400,00
10/04 CURSO ONLINE PARC 02/03 R$ 150,00
Total da Fatura R$ 2.400,00
`

// Mock do child_process para interceptar a chamada ao pdfplumber
jest.mock('child_process', () => ({
  execFileSync: jest.fn(),
}))

import { execFileSync } from 'child_process'
const mockExecFileSync = execFileSync as jest.MockedFunction<typeof execFileSync>

// Mock do fs para evitar escrita de arquivo temporário
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
}))

// ─── Helper para configurar o mock ───────────────────────────────────────────

function mockPdfText(text: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockExecFileSync.mockReturnValue(text as any)
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('isItauInvoice', () => {
  it('detecta fatura Itaú por texto', () => {
    expect(isItauInvoice('ITAUCARD VISA PLATINUM')).toBe(true)
    expect(isItauInvoice('Banco Itaú S.A.')).toBe(true)
    expect(isItauInvoice('PERSONNALITÉ MASTERCARD')).toBe(true)
    expect(isItauInvoice('OUROCARD VISA GOLD')).toBe(false)
    expect(isItauInvoice('Bradesco Visa')).toBe(false)
  })
})

describe('parseItauInvoice — fatura nacional', () => {
  beforeEach(() => mockPdfText(MOCK_ITAU_TEXT_NATIONAL))

  it('extrai campos do summary', async () => {
    const invoice = await parseItauInvoice(Buffer.from('fake-pdf'))
    const s = invoice.summary

    expect(s.bank).toBe('itau')
    expect(s.cardLast4).toBe('5678')
    expect(s.dueDate).toBe('2026-05-13')
    expect(s.dueMonth).toBe('2026-05')
    expect(s.closingDate).toBe('2026-04-20')
    expect(s.totalMinor).toBe(185000)          // R$ 1.850,00
    expect(s.previousBalanceMinor).toBe(250000) // R$ 2.500,00
    expect(s.paymentsMinor).toBe(250000)        // R$ 2.500,00
    expect(s.nationalPurchasesMinor).toBe(185000)
    expect(s.internationalPurchasesMinor).toBe(0)
    expect(s.openBalanceMinor).toBe(185000)
  })

  it('extrai transações nacionais', async () => {
    const invoice = await parseItauInvoice(Buffer.from('fake-pdf'))
    const txs = invoice.transactions

    expect(txs.length).toBeGreaterThan(3)

    const mercado = txs.find(t => t.description.includes('MERCADO EXTRA'))
    expect(mercado).toBeDefined()
    expect(mercado?.amountMinor).toBe(32050)   // R$ 320,50
    expect(mercado?.country).toBe('BR')
    expect(mercado?.date).toBe('2026-04-05')

    const netflix = txs.find(t => t.description.includes('NETFLIX'))
    expect(netflix).toBeDefined()
    expect(netflix?.amountMinor).toBe(5590)    // R$ 55,90
  })

  it('identifica pagamento como crédito (valor negativo)', async () => {
    const invoice = await parseItauInvoice(Buffer.from('fake-pdf'))
    const payment = invoice.transactions.find(t =>
      t.description.includes('PAGAMENTO') || t.amountMinor < 0
    )
    expect(payment).toBeDefined()
    expect(payment?.amountMinor).toBeLessThan(0)
  })

  it('gera forecast de cashflow', async () => {
    const invoice = await parseItauInvoice(Buffer.from('fake-pdf'))
    const forecasts = itauInvoiceToForecast(invoice)

    expect(forecasts).toHaveLength(1)
    expect(forecasts[0].competencyMonth).toBe('2026-05')
    expect(forecasts[0].amountMinor).toBe(-185000) // negativo = despesa
    expect(forecasts[0].recurrence).toBe('one-time')
    expect(forecasts[0].description).toContain('5678')
  })
})

describe('parseItauInvoice — compras internacionais', () => {
  beforeEach(() => mockPdfText(MOCK_ITAU_TEXT_INTERNATIONAL))

  it('detecta compras internacionais no summary', async () => {
    const invoice = await parseItauInvoice(Buffer.from('fake-pdf'))
    const s = invoice.summary

    expect(s.internationalPurchasesMinor).toBeGreaterThan(0)
    expect(s.nationalPurchasesMinor).toBe(50000) // R$ 500,00
  })

  it('extrai transações internacionais com moeda original', async () => {
    const invoice = await parseItauInvoice(Buffer.from('fake-pdf'))
    const intlTxs = invoice.transactions.filter(t => t.country === 'EX')

    expect(intlTxs.length).toBeGreaterThan(0)

    const amazon = intlTxs.find(t => t.description.includes('AMAZON USA'))
    expect(amazon).toBeDefined()
    expect(amazon?.originalCurrencyCode).toBe('USD')
    expect(amazon?.originalAmountMinor).toBe(2500) // USD 25,00
    expect(amazon?.exchangeRate).toBeCloseTo(5.8432, 2)
    expect(amazon?.amountMinor).toBe(14608) // R$ 146,08
  })

  it('não retorna forecast quando openBalance é zero', async () => {
    // Simular fatura já paga
    const paidText = MOCK_ITAU_TEXT_INTERNATIONAL.replace(
      'Saldo em Aberto R$ 1.375,00',
      'Saldo em Aberto R$ 0,00'
    ).replace(
      'Total da Fatura R$ 1.375,00',
      'Total da Fatura R$ 0,00'
    )
    mockPdfText(paidText)
    const invoice = await parseItauInvoice(Buffer.from('fake-pdf'))
    const forecasts = itauInvoiceToForecast(invoice)
    expect(forecasts).toHaveLength(0)
  })
})

describe('parseItauInvoice — compras parceladas', () => {
  beforeEach(() => mockPdfText(MOCK_ITAU_TEXT_INSTALLMENT))

  it('extrai parcelas com formato N/T', async () => {
    const invoice = await parseItauInvoice(Buffer.from('fake-pdf'))
    const txs = invoice.transactions

    const samsung = txs.find(t => t.description.includes('SAMSUNG'))
    expect(samsung).toBeDefined()
    expect(samsung?.installment).toBe('03/12')
    expect(samsung?.amountMinor).toBe(20000) // R$ 200,00

    const apple = txs.find(t => t.description.includes('APPLE'))
    expect(apple).toBeDefined()
    expect(apple?.installment).toBe('01/06')

    const curso = txs.find(t => t.description.includes('CURSO'))
    expect(curso).toBeDefined()
    expect(curso?.installment).toBe('02/03')
  })

  it('calcula openBalanceMinor correctamente', async () => {
    const invoice = await parseItauInvoice(Buffer.from('fake-pdf'))
    expect(invoice.summary.openBalanceMinor).toBe(240000) // R$ 2.400,00
  })
})

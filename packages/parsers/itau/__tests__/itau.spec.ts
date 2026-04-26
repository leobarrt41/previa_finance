/**
 * Testes do @previa/parser-itau — usa fixtures PDF reais (fev, mar, abr 2026).
 *
 * Fixtures em __tests__/fixtures/ (não commitadas no git público por conterem
 * dados pessoais — listadas no .gitignore).
 *
 * Senha dos PDFs: definida em PDF_PASSWORD (env PDF_PASSWORD ou default).
 */

import * as fs from 'fs'
import * as path from 'path'
import { parseItauInvoice, itauInvoiceToForecast, isItauInvoice, ItauInvoice } from '../src/index'

const PDF_PASSWORD = process.env.PDF_PASSWORD ?? '07296'
const FIXTURES = path.resolve(__dirname, 'fixtures')

function loadFixture(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURES, name))
}

// Cache das faturas parseadas (parse é assíncrono e lento — executa 1x por suite)
let invoiceAbr: ItauInvoice
let invoiceMar: ItauInvoice
let invoiceFev: ItauInvoice

beforeAll(async () => {
  ;[invoiceAbr, invoiceMar, invoiceFev] = await Promise.all([
    parseItauInvoice(loadFixture('itau-abr-2026.pdf'), PDF_PASSWORD),
    parseItauInvoice(loadFixture('itau-mar-2026.pdf'), PDF_PASSWORD),
    parseItauInvoice(loadFixture('itau-fev-2026.pdf'), PDF_PASSWORD),
  ])
}, 60_000)

// ─── Mock do extractText (child_process) ──────────────────────────────────────

// ─── 1. Detecção de banco ─────────────────────────────────────────────────────

describe('isItauInvoice', () => {
  it('detecta fatura Itaú por texto', () => {
    expect(isItauInvoice('ITAUCARD VISA PLATINUM')).toBe(true)
    expect(isItauInvoice('Banco Itaú S.A.')).toBe(true)
    expect(isItauInvoice('personnalité MASTERCARD')).toBe(true)
    expect(isItauInvoice('OUROCARD VISA GOLD')).toBe(false)
    expect(isItauInvoice('Bradesco Visa')).toBe(false)
  })
})

// ─── 2–7. Fatura Abril 2026 ───────────────────────────────────────────────────

describe('parseItauInvoice — Abril 2026', () => {
  it('extrai campos do summary', () => {
    const s = invoiceAbr.summary
    expect(s.bank).toBe('itau')
    expect(s.cardLast4).toBe('9970')
    expect(s.dueDate).toBe('2026-04-06')
    expect(s.dueMonth).toBe('2026-04')
    expect(s.invoiceMonth).toBe('2026-04')
    expect(s.totalMinor).toBe(200911)           // R$ 2.009,11
    expect(s.previousBalanceMinor).toBe(419103) // R$ 4.191,03
    expect(s.paymentsMinor).toBe(419103)
    expect(s.nationalPurchasesMinor).toBe(169599)
    expect(s.internationalPurchasesMinor).toBe(28945)
    expect(s.openBalanceMinor).toBe(200911)
  })

  it('extrai transações nacionais (TAUSTE, DISNEY)', () => {
    const txs = invoiceAbr.transactions

    const tauste = txs.find(t => t.description.includes('TAUSTE'))
    expect(tauste).toBeDefined()
    expect(tauste!.amountMinor).toBe(66390)    // R$ 663,90
    expect(tauste!.country).toBe('BR')
    expect(tauste!.date).toBe('2026-03-16')

    const disney = txs.find(t => t.description.includes('DISNEY'))
    expect(disney).toBeDefined()
    expect(disney!.amountMinor).toBe(4450)     // R$ 44,50
    expect(disney!.country).toBe('BR')
    expect(disney!.date).toBe('2026-03-23')
  })

  it('extrai parcelas com formato N/T (SERASA 11/12)', () => {
    const serasa = invoiceAbr.transactions.find(t => t.description.toLowerCase().includes('serasa'))
    expect(serasa).toBeDefined()
    expect(serasa!.installment).toBe('11/12')
    expect(serasa!.amountMinor).toBe(1425)     // R$ 14,25
  })

  it('extrai internacionais com câmbio (MANUS AI)', () => {
    const manus = invoiceAbr.transactions.find(t => t.description.includes('MANUS'))
    expect(manus).toBeDefined()
    expect(manus!.country).toBe('EX')
    expect(manus!.originalCurrencyCode).toBe('USD')
    expect(manus!.originalAmountMinor).toBe(3900)   // USD 39,00
    expect(manus!.exchangeRate).toBeCloseTo(5.46, 1)
    expect(manus!.amountMinor).toBe(21294)           // R$ 212,94
  })

  it('identifica pagamento como crédito (valor negativo)', () => {
    const pagamento = invoiceAbr.transactions.find(t => t.amountMinor < 0)
    expect(pagamento).toBeDefined()
    expect(pagamento!.amountMinor).toBe(-419103)
  })

  it('gera forecast de cashflow para o mês de vencimento', () => {
    const forecasts = itauInvoiceToForecast(invoiceAbr)
    expect(forecasts).toHaveLength(1)
    expect(forecasts[0].competencyMonth).toBe('2026-04')
    expect(forecasts[0].amountMinor).toBe(-200911)
    expect(forecasts[0].recurrence).toBe('one-time')
    expect(forecasts[0].description).toContain('9970')
  })
})

// ─── 8–10. Fatura Março 2026 ──────────────────────────────────────────────────

describe('parseItauInvoice — Março 2026', () => {
  it('extrai summary de março', () => {
    const s = invoiceMar.summary
    expect(s.cardLast4).toBe('9970')
    expect(s.dueDate).toBe('2026-03-06')
    expect(s.dueMonth).toBe('2026-03')
    expect(s.totalMinor).toBe(419103)          // R$ 4.191,03
    expect(s.openBalanceMinor).toBe(419103)
  })

  it('extrai internacionais de março (MANUS AI USD)', () => {
    const manus = invoiceMar.transactions.find(t => t.description.includes('MANUS'))
    expect(manus).toBeDefined()
    expect(manus!.country).toBe('EX')
    expect(manus!.originalCurrencyCode).toBe('USD')
    expect(manus!.originalAmountMinor).toBe(3900)
    expect(manus!.exchangeRate).toBeCloseTo(5.54, 1)
    expect(manus!.amountMinor).toBe(21606)
  })

  it('gera forecast para março', () => {
    const forecasts = itauInvoiceToForecast(invoiceMar)
    expect(forecasts).toHaveLength(1)
    expect(forecasts[0].competencyMonth).toBe('2026-03')
    expect(forecasts[0].amountMinor).toBe(-419103)
    expect(forecasts[0].recurrence).toBe('one-time')
  })
})

// ─── 11–13. Fatura Fevereiro 2026 ────────────────────────────────────────────

describe('parseItauInvoice — Fevereiro 2026', () => {
  it('extrai summary de fevereiro', () => {
    const s = invoiceFev.summary
    expect(s.cardLast4).toBe('9970')
    expect(s.dueDate).toBe('2026-02-06')
    expect(s.dueMonth).toBe('2026-02')
    expect(s.totalMinor).toBe(450046)          // R$ 4.500,46
    expect(s.openBalanceMinor).toBe(450046)
  })

  it('extrai transações com ano correcto (dez 2025 → 2025)', () => {
    const txs = invoiceFev.transactions

    const picpay = txs.find(t => t.description.includes('PICPAY') && t.date?.startsWith('2025-12'))
    expect(picpay).toBeDefined()
    expect(picpay!.date).toBe('2025-12-31')

    const supermercado = txs.find(t => t.description.toUpperCase().includes('SUPERMERCADO') && t.date?.startsWith('2025-12'))
    expect(supermercado).toBeDefined()
    expect(supermercado!.date.startsWith('2025-12')).toBe(true)
  })

  it('gera forecast para fevereiro', () => {
    const forecasts = itauInvoiceToForecast(invoiceFev)
    expect(forecasts).toHaveLength(1)
    expect(forecasts[0].competencyMonth).toBe('2026-02')
    expect(forecasts[0].amountMinor).toBe(-450046)
    expect(forecasts[0].recurrence).toBe('one-time')
  })
})

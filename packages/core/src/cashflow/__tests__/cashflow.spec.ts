// Use Jest globals (describe/it/expect) so tests run under Jest
import { CashFlowEngine } from '../index'
import type { CashFlowInput } from '../types'

describe('CashFlowEngine — basic rules', () => {
  it('income increases monthly cash', () => {
    const input: CashFlowInput = {
      openingBalanceMinor: 0,
      transactions: [
        { id: 't1', competencyMonth: '2026-05', type: 'income', amountMinor: 10000 },
      ],
      projectionMonths: ['2026-05'],
    }
  const out = CashFlowEngine.project(input)
  const m = out.monthly[0]!
  expect(m.projectedClosingBalanceMinor).toBe(10000)
  })

  it('expense decreases monthly cash', () => {
    const input: CashFlowInput = {
      openingBalanceMinor: 5000,
      transactions: [
        { id: 't2', competencyMonth: '2026-05', type: 'expense', amountMinor: 2000 },
      ],
      projectionMonths: ['2026-05'],
    }
  const out = CashFlowEngine.project(input)
  // 5000 - 2000 = 3000
  const m = out.monthly[0]!
  expect(m.projectedClosingBalanceMinor).toBe(3000)
  })

  it('card purchase does not reduce cash immediately', () => {
    const input: CashFlowInput = {
      openingBalanceMinor: 10000,
      transactions: [
        { id: 't3', competencyMonth: '2026-05', type: 'card_purchase', amountMinor: 4000 },
      ],
      // no cardInvoices provided => purchase should not affect cash
      projectionMonths: ['2026-05'],
    }
  const out = CashFlowEngine.project(input)
  const m = out.monthly[0]!
  expect(m.projectedClosingBalanceMinor).toBe(10000)
  })

  it('invoice payment reduces cash (treated as liability payment)', () => {
    const input: CashFlowInput = {
      openingBalanceMinor: 20000,
      invoicePayments: [{ id: 'p1', competencyMonth: '2026-05', amountMinor: 7000 }],
      projectionMonths: ['2026-05'],
    }
  const out = CashFlowEngine.project(input)
  // 20000 - 7000 = 13000
  const m = out.monthly[0]!
  expect(m.projectedClosingBalanceMinor).toBe(13000)
  })

  it('open invoice contributes to committed future cash', () => {
    const input: CashFlowInput = {
      openingBalanceMinor: 0,
      cardInvoices: [
        { id: 'inv1', competencyMonth: '2026-04', dueMonth: '2026-06', amountMinor: 15000 },
      ],
      projectionMonths: ['2026-05', '2026-06'],
    }
    const out = CashFlowEngine.project(input)
    // for 2026-05: debtOpen should reflect the invoice (purchases in competency month or debt tracked)
    // our engine records debtOpen when competencyMonth matches or dueMonth matches
    expect(out.monthly.find((m) => m.competencyMonth === '2026-05')!.debtOpenMinor).toBe(15000)
    // on due month, committed should include outstanding amount
    expect(out.monthly.find((m) => m.competencyMonth === '2026-06')!.totalCommittedMinor).toBe(15000)
  })

  it('mixed scenario: income + expense + invoice payment', () => {
    const input: CashFlowInput = {
      openingBalanceMinor: 5000,
      transactions: [
        { id: 't4', competencyMonth: '2026-05', type: 'income', amountMinor: 8000 },
        { id: 't5', competencyMonth: '2026-05', type: 'expense', amountMinor: 3000 },
      ],
      invoicePayments: [{ id: 'p2', competencyMonth: '2026-05', amountMinor: 2000 }],
      projectionMonths: ['2026-05'],
    }
  const out = CashFlowEngine.project(input)
  // opening 5000 + income 8000 - expense 3000 - invoicePayment 2000 = 8000
  const m = out.monthly[0]!
  expect(m.projectedClosingBalanceMinor).toBe(8000)
  })
})

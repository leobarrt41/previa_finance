import { CashFlowEngine } from '../index'
import type { CashFlowInput, CashFlowForecast } from '../types'

describe('CashFlowEngine — forecast behavior', () => {
  it('applies one-time forecast for future month', () => {
    const forecast: CashFlowForecast = {
      id: 'f1',
      competencyMonth: '2026-12',
      amountMinor: 1200000, // R$12,000.00 
      recurrence: 'one-time',
      description: 'Décimo terceiro (previsão)'
    }

    const input: CashFlowInput = {
      openingBalanceMinor: 10000,
      forecasts: [forecast],
      currentMonth: '2026-11', // current month is November
      projectionMonths: ['2026-11', '2026-12']
    }

    const out = CashFlowEngine.project(input)
    
    // November: no forecast applied (no forecast for this month)
    const nov = out.monthly.find(m => m.competencyMonth === '2026-11')!
    expect(nov.totalIncomeMinor).toBe(0)
    expect(nov.projectedClosingBalanceMinor).toBe(10000)
    
    // December: forecast applied (future month)
    const dec = out.monthly.find(m => m.competencyMonth === '2026-12')!
    expect(dec.totalIncomeMinor).toBe(1200000)
    expect(dec.projectedClosingBalanceMinor).toBe(10000 + 1200000)
  })

  it('does NOT apply forecast for current month (extrato is truth)', () => {
    const forecast: CashFlowForecast = {
      id: 'f2',
      competencyMonth: '2026-12',
      amountMinor: 1200000,
      recurrence: 'one-time',
      description: 'Décimo terceiro (previsão)'
    }

    const input: CashFlowInput = {
      openingBalanceMinor: 5000,
      forecasts: [forecast],
      currentMonth: '2026-12', // current month IS December
      projectionMonths: ['2026-12']
    }

    const out = CashFlowEngine.project(input)
    
    // December: forecast NOT applied because it's the current month
    const dec = out.monthly.find(m => m.competencyMonth === '2026-12')!
    expect(dec.totalIncomeMinor).toBe(0) // no forecast applied
    expect(dec.projectedClosingBalanceMinor).toBe(5000) // only opening balance
  })

  it('does NOT apply forecast for past months', () => {
    const forecast: CashFlowForecast = {
      id: 'f3',
      competencyMonth: '2026-10',
      amountMinor: 500000,
      recurrence: 'one-time',
      description: 'Previsão do passado'
    }

    const input: CashFlowInput = {
      openingBalanceMinor: 3000,
      forecasts: [forecast],
      currentMonth: '2026-12', // current month is December
      projectionMonths: ['2026-10', '2026-11', '2026-12']
    }

    const out = CashFlowEngine.project(input)
    
    // October: forecast NOT applied (past month)
    const oct = out.monthly.find(m => m.competencyMonth === '2026-10')!
    expect(oct.totalIncomeMinor).toBe(0)
    
    // November: no forecast for this month anyway
    const nov = out.monthly.find(m => m.competencyMonth === '2026-11')!
    expect(nov.totalIncomeMinor).toBe(0)
    
    // December: no forecast for this month (current month)
    const dec = out.monthly.find(m => m.competencyMonth === '2026-12')!
    expect(dec.totalIncomeMinor).toBe(0)
  })

  it('applies yearly forecast only to future occurrences', () => {
    const forecast: CashFlowForecast = {
      id: 'f4',
      competencyMonth: '2026-12',
      amountMinor: 1000000,
      recurrence: 'yearly',
      description: 'Décimo terceiro anual'
    }

    const input: CashFlowInput = {
      openingBalanceMinor: 0,
      forecasts: [forecast],
      currentMonth: '2026-11', // current month is November 2026
      projectionMonths: ['2026-11', '2026-12', '2027-11', '2027-12']
    }

    const out = CashFlowEngine.project(input)
    
    // 2026-11: no forecast
    expect(out.monthly.find(m => m.competencyMonth === '2026-11')!.totalIncomeMinor).toBe(0)
    
    // 2026-12: forecast applied (future month, December)
    expect(out.monthly.find(m => m.competencyMonth === '2026-12')!.totalIncomeMinor).toBe(1000000)
    
    // 2027-11: no forecast (not December)
    expect(out.monthly.find(m => m.competencyMonth === '2027-11')!.totalIncomeMinor).toBe(0)
    
    // 2027-12: forecast applied (future December)
    expect(out.monthly.find(m => m.competencyMonth === '2027-12')!.totalIncomeMinor).toBe(1000000)
  })

  it('does not add forecast income when real income exists in the same month', () => {
    const forecast: CashFlowForecast = {
      id: 'f6',
      competencyMonth: '2026-05',
      amountMinor: 200000,
      recurrence: 'one-time',
      description: 'Salário previsto'
    }

    const input: CashFlowInput = {
      openingBalanceMinor: 0,
      transactions: [
        {
          id: 'tx-1',
          competencyMonth: '2026-05',
          type: 'income',
          amountMinor: 150000,
        },
      ],
      forecasts: [forecast],
      currentMonth: '2026-04',
      projectionMonths: ['2026-04', '2026-05']
    }

    const out = CashFlowEngine.project(input)

    expect(out.monthly.find(m => m.competencyMonth === '2026-05')!.totalIncomeMinor).toBe(150000)
    expect(out.monthly.find(m => m.competencyMonth === '2026-05')!.projectedClosingBalanceMinor).toBe(150000)
  })

  it('handles monthly recurrence with future months only', () => {
    const forecast: CashFlowForecast = {
      id: 'f5',
      competencyMonth: '2027-01',
      amountMinor: 300000, // R$3,000 monthly
      recurrence: 'monthly',
      recurrenceEnd: '2027-03',
      description: 'Receita mensal planejada'
    }

    const input: CashFlowInput = {
      openingBalanceMinor: 0,
      forecasts: [forecast],
      currentMonth: '2026-12', // current month is December 2026
      projectionMonths: ['2026-12', '2027-01', '2027-02', '2027-03', '2027-04']
    }

    const out = CashFlowEngine.project(input)
    
    // 2026-12: no forecast (current month)
    expect(out.monthly.find(m => m.competencyMonth === '2026-12')!.totalIncomeMinor).toBe(0)
    
    // 2027-01: forecast applied (future, within recurrence)
    expect(out.monthly.find(m => m.competencyMonth === '2027-01')!.totalIncomeMinor).toBe(300000)
    
    // 2027-02: forecast applied
    expect(out.monthly.find(m => m.competencyMonth === '2027-02')!.totalIncomeMinor).toBe(300000)
    
    // 2027-03: forecast applied (last month)
    expect(out.monthly.find(m => m.competencyMonth === '2027-03')!.totalIncomeMinor).toBe(300000)
    
    // 2027-04: no forecast (beyond recurrenceEnd)
    expect(out.monthly.find(m => m.competencyMonth === '2027-04')!.totalIncomeMinor).toBe(0)
  })
})
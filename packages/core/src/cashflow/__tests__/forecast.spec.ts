import { CashFlowEngine } from '../CashFlowEngine'
import type { CashFlowInput } from '../types'

describe('CashFlowEngine — forecasts', () => {
  it('one-time forecast is applied to the competency month', () => {
    const input: CashFlowInput = {
      openingBalanceMinor: 0,
      forecasts: [
        { id: 'f1', competencyMonth: '2026-06', amountMinor: 10000n, recurrence: 'one-time' },
      ],
      projectionMonths: ['2026-05', '2026-06', '2026-07'],
    }

    const out = CashFlowEngine.project(input)
    // 2026-05 opening 0 => closing 0
    expect(out.monthly.find((m) => m.competencyMonth === '2026-05')!.projectedClosingBalanceMinor).toBe(0)
    // 2026-06 should include forecast
    expect(out.monthly.find((m) => m.competencyMonth === '2026-06')!.projectedClosingBalanceMinor).toBe(10000n)
  })

  it('forecast scheduled for current month does not apply unless realized', () => {
    const input: CashFlowInput = {
      openingBalanceMinor: 0,
      forecasts: [
        { id: 'f3', competencyMonth: '2026-06', amountMinor: 5000n, recurrence: 'one-time', status: 'planned' },
      ],
      projectionMonths: ['2026-05', '2026-06'],
      currentMonth: '2026-06',
    }

    const out = CashFlowEngine.project(input)
    // since currentMonth == 2026-06 and forecast is still planned, it should NOT apply
    expect(out.monthly.find((m) => m.competencyMonth === '2026-06')!.projectedClosingBalanceMinor).toBe(0)
  })

  it('forecast marked realized for current month is applied', () => {
    const input: CashFlowInput = {
      openingBalanceMinor: 0,
      forecasts: [
        { id: 'f4', competencyMonth: '2026-06', amountMinor: 7000n, recurrence: 'one-time', status: 'realized' },
      ],
      projectionMonths: ['2026-05', '2026-06'],
      currentMonth: '2026-06',
    }

    const out = CashFlowEngine.project(input)
    // realized forecasts should still apply even if it's the current month
    expect(out.monthly.find((m) => m.competencyMonth === '2026-06')!.projectedClosingBalanceMinor).toBe(7000n)
  })

  it('monthly forecast repeats across months until recurrenceEnd', () => {
    const input: CashFlowInput = {
      openingBalanceMinor: 0,
      forecasts: [
        { id: 'f2', competencyMonth: '2026-05', amountMinor: 2000n, recurrence: 'monthly', recurrenceEnd: '2026-07' },
      ],
      projectionMonths: ['2026-05', '2026-06', '2026-07'],
    }

    const out = CashFlowEngine.project(input)
    // each month 2000 added
    expect(out.monthly.find((m) => m.competencyMonth === '2026-05')!.projectedClosingBalanceMinor).toBe(2000n)
    expect(out.monthly.find((m) => m.competencyMonth === '2026-06')!.projectedClosingBalanceMinor).toBe(4000n)
    expect(out.monthly.find((m) => m.competencyMonth === '2026-07')!.projectedClosingBalanceMinor).toBe(6000n)
  })
})

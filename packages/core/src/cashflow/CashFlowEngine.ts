import {
  CashFlowInput,
  CashFlowOutput,
  MonthlyCashFlow,
  Transaction,
  CardInvoice,
  Obligation,
  Minor,
  CompetencyMonth,
} from './types'

// Minimal helper: add minor amounts (supports number and bigint)
function add(a: Minor, b: Minor): Minor {
  // if either is bigint, coerce both to bigint
  if (typeof a === 'bigint' || typeof b === 'bigint') {
    return BigInt(a as any) + BigInt(b as any)
  }
  return (a as number) + (b as number)
}

function zero(): Minor {
  return 0
}

function cloneMinor(v: Minor): Minor {
  if (typeof v === 'bigint') return BigInt(v as any)
  return Number(v as any)
}

// Utility: month ordering assumes YYYY-MM lexicographic ordering
// Engine is pure and accepts normalized inputs only.
export class CashFlowEngine {
  // compute projections per requested months
  static project(input: CashFlowInput): CashFlowOutput {
    const months = input.projectionMonths
    
    // determine current month context (YYYY-MM). If caller provides currentMonth, use it.
    const currentMonth: CompetencyMonth = (input as any).currentMonth || new Date().toISOString().slice(0, 7)

    // index transactions by month (build earlier so we can use if needed)
    const txByMonth = new Map<CompetencyMonth, Transaction[]>()
    ;(input.transactions || []).forEach((t) => {
      const arr = txByMonth.get(t.competencyMonth) || []
      arr.push(t)
      txByMonth.set(t.competencyMonth, arr)
    })

    const realIncomeMonths = new Set<CompetencyMonth>()
    ;(input.transactions || []).forEach((t) => {
      if (t.type === 'income' && t.amountMinor > 0) {
        realIncomeMonths.add(t.competencyMonth)
      }
    })

    // build forecast additions per month — split income/expense
    const forecastIncomeByMonth = new Map<CompetencyMonth, Minor>()
    const forecastExpenseByMonth = new Map<CompetencyMonth, Minor>()
    ;(input.forecasts || []).forEach((f) => {
      const recurrence = f.recurrence || 'one-time'
      const start = f.competencyMonth
      const end = f.recurrenceEnd
      const isNeg = typeof f.amountMinor === 'bigint' ? f.amountMinor < 0n : (f.amountMinor as number) < 0
      const targetMap = isNeg ? forecastExpenseByMonth : forecastIncomeByMonth
      const absAmt: Minor = isNeg
        ? (typeof f.amountMinor === 'bigint' ? -f.amountMinor : -(f.amountMinor as number))
        : f.amountMinor

      const addToMonth = (m: CompetencyMonth) => {
        if (m <= currentMonth) return
        if (!isNeg && realIncomeMonths.has(m)) return
        const curr = targetMap.get(m) || zero()
        targetMap.set(m, add(curr, absAmt))
      }

      if (recurrence === 'one-time') {
        addToMonth(start)
      } else if (recurrence === 'monthly') {
        for (const m of months) {
          if (m >= start && (!end || m <= end)) addToMonth(m)
        }
      } else if (recurrence === 'yearly') {
        const startMM = start.slice(5)
        for (const m of months) {
          if (m >= start && (!end || m <= end) && m.slice(5) === startMM) addToMonth(m)
        }
      }
    })

    // (transactions already indexed above for matching forecasts)

    // index invoice payments by month
    const payByMonth = new Map<CompetencyMonth, number | bigint>()
    ;(input.invoicePayments || []).forEach((p) => {
      const curr = payByMonth.get(p.competencyMonth) || zero()
      payByMonth.set(p.competencyMonth, add(curr, p.amountMinor))
    })

    // obligations: for quick lookup per month compute committed amounts
    const obligations = input.obligations || []

    // card invoices list
    const invoices = input.cardInvoices || []

    const monthly: MonthlyCashFlow[] = []

    // running balance starts from openingBalanceMinor
    let runningBalance: Minor = cloneMinor(input.openingBalanceMinor)

    for (const month of months) {
      // opening balance is the current runningBalance
      const opening = cloneMinor(runningBalance)

      // start aggregators
      let income: Minor = zero()
      let expense: Minor = zero()
      let liabilityPayments: Minor = zero()
      let cardInvoicePayments: Minor = zero()
      let committed: Minor = zero()
      let debtOpen: Minor = zero()

      // transactions in this month
      const txs = txByMonth.get(month) || []
      for (const t of txs) {
        switch (t.type) {
          case 'income':
            income = add(income, t.amountMinor)
            break
          case 'expense':
            expense = add(expense, t.amountMinor)
            break
          case 'transfer':
            // transfers do not affect consolidated cash (ignored)
            break
          case 'card_purchase':
            // card purchases do NOT reduce cash in the competency month
            // they create future liability (handled via cardInvoices input)
            break
          case 'liability_payment':
            // liability payments reduce cash when paid
            liabilityPayments = add(liabilityPayments, t.amountMinor)
            break
          default:
            break
        }
      }

      // forecasts: positive → income, negative → expense (tracked in separate maps)
      const forecastInc = forecastIncomeByMonth.get(month) || zero()
      const forecastExp = forecastExpenseByMonth.get(month) || zero()
      if (forecastInc) income = add(income, forecastInc)
      if (forecastExp) expense = add(expense, forecastExp)

  // invoice payments (explicit cash events). Treat them as liability payments / outflows
  const invoicePaid = payByMonth.get(month) || zero()
  liabilityPayments = add(liabilityPayments, invoicePaid)

      // obligations: sum monthly obligations that apply to this month
      for (const o of obligations) {
        // if obligation started after this month, skip
        if (o.competencyMonth > month) continue
        if (o.endMonth && o.endMonth < month) continue
        committed = add(committed, o.monthlyAmountMinor)
        // obligations are expected outflows, so count as future commitment
      }

      // Corrigido: para cada mês, mostrar apenas o saldo devedor aberto naquele mês (não repetir valor nos meses seguintes)
      for (const inv of invoices) {
        const sourceType = typeof inv.sourceType === 'string' ? inv.sourceType : 'statement'
        const isProjectedInstallment = sourceType === 'installment'

        // Considera a fatura "em aberto" apenas se ainda não foi totalmente paga até este mês
        // e se o mês corrente está entre o mês da compra e o vencimento (inclusive)
        const paid = inv.paidMinor || zero()
        const outstanding = add(inv.amountMinor, (typeof paid === 'bigint' ? -BigInt(paid as any) : -(paid as any)))
        const outVal = typeof outstanding === 'bigint' ? (outstanding > 0n ? outstanding : 0n) : Math.max(0, outstanding as number)

        // Só mostra como "em aberto" se ainda não foi pago, o mês está entre competência e vencimento
        // e a linha não for uma parcela projetada (parcelas têm seu próprio indicador no gráfico).
        if (!isProjectedInstallment && inv.competencyMonth <= month && month <= inv.dueMonth && outVal) {
          debtOpen = add(debtOpen, outVal)
        }

        // on due month, include as committed (will reduce cash when paid)
        if (inv.dueMonth === month) {
          committed = add(committed, outVal)
          cardInvoicePayments = add(cardInvoicePayments, outVal)
        }
      }

      // compute projected closing balance:
      // opening + income - expense - liabilityPayments
      let projected = cloneMinor(opening)
      projected = add(projected, income)
      projected = add(projected, typeof expense === 'bigint' ? -BigInt(expense as any) : -(expense as any))
      projected = add(projected, typeof liabilityPayments === 'bigint' ? -BigInt(liabilityPayments as any) : -(liabilityPayments as any))
      projected = add(projected, typeof cardInvoicePayments === 'bigint' ? -BigInt(cardInvoicePayments as any) : -(cardInvoicePayments as any))

      // convert numbers for consistent storage
      const monthFlow: MonthlyCashFlow = {
        competencyMonth: month,
        openingBalanceMinor: opening,
        totalIncomeMinor: income,
        totalExpenseMinor: expense,
        totalLiabilityPaymentMinor: add(liabilityPayments, cardInvoicePayments),
        cardInvoicePaymentMinor: cardInvoicePayments,
        totalCommittedMinor: committed,
        projectedClosingBalanceMinor: projected,
        debtOpenMinor: debtOpen,
      }

      monthly.push(monthFlow)

      // update running balance to projected for next month opening
      runningBalance = projected
    }

    return { monthly }
  }
}

export default CashFlowEngine

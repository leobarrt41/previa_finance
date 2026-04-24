/**
 * routes/cashflow.ts - CashFlow projection endpoints
 * 
 * Integra com o CashFlowEngine do @previa/core para projeções financeiras
 */

import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { CashFlowEngine, CashFlowInput } from '@previa/core'
import { createError } from '../middlewares/errorHandler.js'

const router: Router = Router()

function buildProjectionMonths(startMonth: string, months: number): string[] {
  const [yearPart, monthPart] = startMonth.split('-')
  const year = Number(yearPart)
  const month = Number(monthPart)

  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error('Invalid start month')
  }

  const result: string[] = []
  for (let i = 0; i < months; i++) {
    const date = new Date(Date.UTC(year, month - 1 + i, 1))
    const nextYear = date.getUTCFullYear()
    const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0')
    result.push(`${nextYear}-${nextMonth}`)
  }

  return result
}

// Schema de validação para projeção
const CashFlowRequestSchema = z.object({
  startMonth: z.string().regex(/^\d{4}-\d{2}$/, 'Format must be YYYY-MM'),
  months: z.number().min(1).max(24),
  openingBalanceMinor: z.union([z.number(), z.bigint()]),
  
  // Transações opcionais
  transactions: z.array(z.object({
    id: z.string(),
    competencyMonth: z.string(),
    amountMinor: z.union([z.number(), z.bigint()]),
    type: z.enum(['income', 'expense', 'transfer', 'card_purchase', 'liability_payment']),
    description: z.string().optional()
  })).optional(),
  
  // Faturas de cartão opcionais
  cardInvoices: z.array(z.object({
    id: z.string(),
    competencyMonth: z.string(),
    dueMonth: z.string(),
    amountMinor: z.union([z.number(), z.bigint()]),
    paidMinor: z.union([z.number(), z.bigint()]).optional()
  })).optional(),
  
  // Previsões opcionais (forecast support)
  forecasts: z.array(z.object({
    id: z.string(),
    competencyMonth: z.string(),
    amountMinor: z.union([z.number(), z.bigint()]),
    recurrence: z.enum(['one-time', 'monthly', 'yearly']).optional(),
    recurrenceEnd: z.string().optional(),
    description: z.string(),
    isActive: z.boolean().default(true)
  })).optional()
})

/**
 * POST /api/cashflow/projection
 * Gera projeção de fluxo de caixa usando CashFlowEngine
 */
router.post('/projection', async (req: Request, res: Response) => {
  try {
    // Validação dos dados
    const data = CashFlowRequestSchema.parse(req.body)
    const projectionMonths = buildProjectionMonths(data.startMonth, data.months)
    
    // Converter para formato do CashFlowEngine
    const input: CashFlowInput = {
      openingBalanceMinor: BigInt(data.openingBalanceMinor),
      projectionMonths,
      currentMonth: data.startMonth,
      transactions: data.transactions?.map(t => ({
        ...t,
        amountMinor: BigInt(t.amountMinor)
      })) || [],
      cardInvoices: data.cardInvoices?.map(ci => ({
        ...ci,
        amountMinor: BigInt(ci.amountMinor),
        paidMinor: ci.paidMinor !== undefined ? BigInt(ci.paidMinor) : undefined
      })) || [],
      forecasts: data.forecasts?.map(f => ({
        ...f,
        amountMinor: BigInt(f.amountMinor)
      })) || []
    }

    // Processar projeção
    const projection = CashFlowEngine.project(input)
    
    // Converter bigint para string para JSON
    const response = {
      ...projection,
      monthly: projection.monthly.map(month => ({
        ...month,
        openingBalanceMinor: month.openingBalanceMinor.toString(),
        totalIncomeMinor: month.totalIncomeMinor.toString(),
        totalExpenseMinor: month.totalExpenseMinor.toString(),
        totalLiabilityPaymentMinor: month.totalLiabilityPaymentMinor.toString(),
        totalCommittedMinor: month.totalCommittedMinor.toString(),
        projectedClosingBalanceMinor: month.projectedClosingBalanceMinor.toString(),
        debtOpenMinor: month.debtOpenMinor.toString()
      }))
    }
    
    res.json(response)
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Validation failed',
        details: error.errors
      })
      return
    }
    
    throw createError('Failed to generate cashflow projection', 500)
  }
})

/**
 * GET /api/cashflow/example
 * Retorna exemplo de payload para facilitar integração do frontend
 */
router.get('/example', (req: Request, res: Response) => {
  const example = {
    request: {
      startMonth: "2026-05",
      months: 6,
      openingBalanceMinor: 100000, // R$ 1000.00
      transactions: [
        {
          id: "tx-1",
          competencyMonth: "2026-05",
          amountMinor: 500000, // R$ 5000.00 
          type: "income",
          description: "Salário"
        },
        {
          id: "tx-2",
          competencyMonth: "2026-05",
          amountMinor: -150000, // R$ -1500.00
          type: "expense", 
          description: "Aluguel"
        }
      ],
      cardInvoices: [
        {
          id: "invoice-1",
          competencyMonth: "2026-05",
          dueMonth: "2026-06",
          amountMinor: 75000,
          paidMinor: 0
        }
      ],
      forecasts: [
        {
          id: "forecast-1",
          competencyMonth: "2026-06",
          amountMinor: 500000,
          recurrence: "one-time",
          description: "Salário recorrente",
          isActive: true
        }
      ]
    },
    response_format: {
      monthly: [
        {
          competencyMonth: "2026-05",
          openingBalanceMinor: "100000",
          totalIncomeMinor: "500000", 
          totalExpenseMinor: "150000",
          totalLiabilityPaymentMinor: "0",
          totalCommittedMinor: "0",
          projectedClosingBalanceMinor: "450000",
          debtOpenMinor: "0"
        }
      ]
    }
  }
  
  res.json(example)
})

export { router as cashflowRouter }

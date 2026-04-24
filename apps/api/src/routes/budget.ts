/**
 * routes/budget.ts - Budget analysis endpoints
 * 
 * Integra com BudgetEngine e ImpactCalculator para análise de orçamentos
 * Essencial para feature foto → análise
 */

import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { BudgetEngine, ImpactCalculator } from '@previa/core'
import { createError } from '../middlewares/errorHandler.js'

const router: Router = Router()

// Schema para análise de transação (foto → análise)
const TransactionAnalysisSchema = z.object({
  amountMinor: z.union([z.number(), z.bigint()]),
  categoryId: z.string(),
  description: z.string(),
  merchantName: z.string().optional(),
  currentMonth: z.string().regex(/^\d{4}-\d{2}$/),
  
  // Orçamentos do usuário
  budgets: z.array(z.object({
    categoryId: z.string(),
    categoryName: z.string(),
    budgetAmountMinor: z.union([z.number(), z.bigint()]),
    period: z.enum(['monthly', 'weekly', 'yearly']),
    monthlyLimitMinor: z.union([z.number(), z.bigint()]).optional()
  })),
  
  // Gastos atuais
  spending: z.array(z.object({
    categoryId: z.string(),
    categoryName: z.string(),
    currentPeriodSpentMinor: z.union([z.number(), z.bigint()]),
    transactionCount: z.number(),
    historicalAvgMinor: z.union([z.number(), z.bigint()]).optional()
  }))
})

/**
 * POST /api/budget/analyze-transaction
 * Analisa impacto de nova transação no orçamento (foto → análise)
 */
router.post('/analyze-transaction', async (req: Request, res: Response) => {
  try {
    const data = TransactionAnalysisSchema.parse(req.body)
    
    // Converter para tipos corretos
    const budgets = data.budgets.map(b => ({
      ...b,
      budgetAmountMinor: BigInt(b.budgetAmountMinor),
      monthlyLimitMinor: b.monthlyLimitMinor ? BigInt(b.monthlyLimitMinor) : undefined
    }))
    
    const spending = data.spending.map(s => ({
      ...s,
      currentPeriodSpentMinor: BigInt(s.currentPeriodSpentMinor),
      historicalAvgMinor: s.historicalAvgMinor ? BigInt(s.historicalAvgMinor) : undefined
    }))
    
    // Usar ImpactCalculator
    const calculator = new ImpactCalculator()
    const impact = calculator.calculateTransactionImpact(
      {
        amountMinor: BigInt(data.amountMinor),
        categoryId: data.categoryId,
        description: data.description,
        merchantName: data.merchantName
      },
      budgets,
      spending,
      undefined, // spending patterns opcionais
      data.currentMonth
    )
    
    // Converter bigint para string
    const response = {
      ...impact,
      budgetImpact: impact.budgetImpact ? {
        ...impact.budgetImpact,
        budgetAmountMinor: impact.budgetImpact.budgetAmountMinor.toString(),
        currentSpentMinor: impact.budgetImpact.currentSpentMinor.toString(),
        newTransactionMinor: impact.budgetImpact.newTransactionMinor.toString(),
        spentAfterMinor: impact.budgetImpact.spentAfterMinor.toString(),
        remainingAfterMinor: impact.budgetImpact.remainingAfterMinor.toString(),
        statusBefore: {
          ...impact.budgetImpact.statusBefore,
          budgetAmountMinor: impact.budgetImpact.statusBefore.budgetAmountMinor.toString(),
          spentMinor: impact.budgetImpact.statusBefore.spentMinor.toString(),
          remainingMinor: impact.budgetImpact.statusBefore.remainingMinor.toString()
        },
        statusAfter: {
          ...impact.budgetImpact.statusAfter,
          budgetAmountMinor: impact.budgetImpact.statusAfter.budgetAmountMinor.toString(),
          spentMinor: impact.budgetImpact.statusAfter.spentMinor.toString(),
          remainingMinor: impact.budgetImpact.statusAfter.remainingMinor.toString()
        }
      } : undefined
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
    
    throw createError('Failed to analyze transaction impact', 500)
  }
})

/**
 * POST /api/budget/analysis
 * Análise completa de orçamentos vs gastos
 */
router.post('/analysis', async (req: Request, res: Response) => {
  try {
    const data = z.object({
      currentMonth: z.string(),
      budgets: z.array(z.any()),
      spending: z.array(z.any())
    }).parse(req.body)
    
    const engine = new BudgetEngine()
    const analysis = engine.analyzeBudgets(
      data.budgets,
      data.spending,
      data.currentMonth
    )
    
    // Converter bigint para string
    const response = {
      ...analysis,
      totalBudgetMinor: analysis.totalBudgetMinor.toString(),
      totalSpentMinor: analysis.totalSpentMinor.toString(),
      totalRemainingMinor: analysis.totalRemainingMinor.toString(),
      budgetStatuses: analysis.budgetStatuses.map(status => ({
        ...status,
        budgetAmountMinor: status.budgetAmountMinor.toString(),
        spentMinor: status.spentMinor.toString(),
        remainingMinor: status.remainingMinor.toString()
      }))
    }
    
    res.json(response)
    
  } catch (error) {
    throw createError('Failed to generate budget analysis', 500)
  }
})

/**
 * GET /api/budget/example
 * Exemplo de payload para foto → análise
 */
router.get('/example', (req: Request, res: Response) => {
  const example = {
    transaction_analysis_request: {
      amountMinor: 15000, // R$ 150.00
      categoryId: "food",
      description: "Compra no supermercado",
      merchantName: "Supermercado Extra",
      currentMonth: "2026-04",
      budgets: [
        {
          categoryId: "food",
          categoryName: "Alimentação", 
          budgetAmountMinor: 50000, // R$ 500.00
          period: "monthly"
        }
      ],
      spending: [
        {
          categoryId: "food",
          categoryName: "Alimentação",
          currentPeriodSpentMinor: 35000, // R$ 350.00
          transactionCount: 18
        }
      ]
    },
    response_format: {
      budgetImpact: {
        categoryId: "food",
        utilizationBefore: 70.0,
        utilizationAfter: 100.0,
        statusBefore: { status: "seguro" },
        statusAfter: { status: "excedido" },
        message: "Compra de R$ 150.00 excede orçamento em R$ 0.00"
      },
      insights: ["Esta compra representa 100% do seu orçamento mensal (+30%)"],
      warnings: ["⚠️ Esta compra vai estourar seu orçamento mensal!"],
      recommendations: ["Consider postergar compras não essenciais nesta categoria"]
    }
  }
  
  res.json(example)
})

export { router as budgetRouter }

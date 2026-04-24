// Budget analysis types for tracking spending vs budget limits
// All amounts are in minor units (integer, bigint-friendly)

import { Minor, CompetencyMonth } from '../cashflow/types'

export type BudgetPeriod = 'monthly' | 'weekly' | 'yearly'

export type BudgetStatusType = 'seguro' | 'atenção' | 'excedido' | 'não_definido'

export interface CategoryBudget {
  categoryId: string
  categoryName: string
  budgetAmountMinor: Minor
  period: BudgetPeriod
  // Optional monthly breakdown for yearly budgets
  monthlyLimitMinor?: Minor
}

export interface CategorySpending {
  categoryId: string
  categoryName: string
  currentPeriodSpentMinor: Minor
  transactionCount: number
  // Average spending for comparison
  historicalAvgMinor?: Minor
}

export interface BudgetStatus {
  categoryId: string
  categoryName: string
  budgetAmountMinor: Minor
  spentMinor: Minor
  remainingMinor: Minor
  utilizationPercent: number
  status: BudgetStatusType
  projectedOverage?: Minor // if trending towards overage
}

export interface BudgetImpact {
  categoryId: string
  budgetAmountMinor: Minor
  currentSpentMinor: Minor
  newTransactionMinor: Minor
  spentAfterMinor: Minor
  remainingAfterMinor: Minor
  utilizationBefore: number
  utilizationAfter: number
  statusBefore: BudgetStatus
  statusAfter: BudgetStatus
  message?: string
}

export interface BudgetAnalysis {
  currentMonth: CompetencyMonth
  categoryBudgets: CategoryBudget[]
  categorySpending: CategorySpending[]
  budgetStatuses: BudgetStatus[]
  totalBudgetMinor: Minor
  totalSpentMinor: Minor
  totalRemainingMinor: Minor
  overallUtilization: number
  overallStatus: BudgetStatusType
  categoriesExceeded: number
  categoriesWarning: number
}

export interface TransactionImpact {
  budgetImpact?: BudgetImpact
  insights: string[]
  warnings: string[]
  recommendations: string[]
}

// Input for analyzing a new transaction's impact
export interface TransactionAnalysisInput {
  amountMinor: Minor
  categoryId: string
  description: string
  competencyMonth?: CompetencyMonth
  merchantName?: string
}

// Historical spending pattern for comparison
export interface SpendingPattern {
  categoryId: string
  merchantName?: string
  avgAmountMinor: Minor
  frequency: number // transactions per month
  trend: 'crescente' | 'estável' | 'decrescente'
  lastTransactionMinor?: Minor
}
import { Minor, CompetencyMonth } from '../cashflow/types'
import { 
  CategoryBudget, 
  CategorySpending, 
  BudgetAnalysis, 
  BudgetStatus, 
  BudgetStatusType, 
  BudgetPeriod 
} from './types'

// Utilitários para trabalhar com Minor (bigint)
const addMinor = (a: Minor, b: Minor): Minor => {
  const aBig = typeof a === 'bigint' ? a : BigInt(a)
  const bBig = typeof b === 'bigint' ? b : BigInt(b)
  return aBig + bBig
}

const subtractMinor = (a: Minor, b: Minor): Minor => {
  const aBig = typeof a === 'bigint' ? a : BigInt(a)
  const bBig = typeof b === 'bigint' ? b : BigInt(b)
  return aBig - bBig
}

const multiplyMinor = (a: Minor, multiplier: bigint): Minor => {
  const aBig = typeof a === 'bigint' ? a : BigInt(a)
  return aBig * multiplier
}

const divideMinor = (a: Minor, divisor: bigint): Minor => {
  const aBig = typeof a === 'bigint' ? a : BigInt(a)
  return aBig / divisor
}

const compareMinor = (a: Minor, b: Minor): number => {
  const aBig = typeof a === 'bigint' ? a : BigInt(a)
  const bBig = typeof b === 'bigint' ? b : BigInt(b)
  if (aBig < bBig) return -1
  if (aBig > bBig) return 1
  return 0
}

export class BudgetEngine {
  /**
   * Analisa todos os orçamentos vs gastos atuais
   * Essencial para o recurso de foto → análise
   */
  public analyzeBudgets(
    budgets: CategoryBudget[],
    spending: CategorySpending[],
    currentMonth: CompetencyMonth
  ): BudgetAnalysis {
    const budgetStatuses: BudgetStatus[] = []
    const spendingMap = new Map(spending.map(s => [s.categoryId, s]))
    
    // Converte CompetencyMonth string para object
    const parts = currentMonth.split('-')
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`Invalid CompetencyMonth format: ${currentMonth}. Expected format: YYYY-MM`)
    }
    
    const yearStr = parts[0]
    const monthStr = parts[1]
    const year = parseInt(yearStr, 10)
    const month = parseInt(monthStr, 10)
    
    if (isNaN(year) || isNaN(month)) {
      throw new Error(`Invalid CompetencyMonth format: ${currentMonth}. Expected format: YYYY-MM`)
    }
    
    const currentPeriod = { year, month }
    
    // Analisa cada categoria com orçamento
    for (const budget of budgets) {
      const categorySpending = spendingMap.get(budget.categoryId)
      const status = this.calculateCategoryStatus(budget, categorySpending, currentPeriod)
      budgetStatuses.push(status)
    }

    // Calcula métricas gerais
    const totalBudgetMinor = budgetStatuses.reduce((sum: Minor, status) => 
      addMinor(sum, status.budgetAmountMinor), 0n as Minor
    )
    const totalSpentMinor = budgetStatuses.reduce((sum: Minor, status) => 
      addMinor(sum, status.spentMinor), 0n as Minor
    )
    const totalRemainingMinor = subtractMinor(totalBudgetMinor, totalSpentMinor)
    const overallUtilization = compareMinor(totalBudgetMinor, 0n) > 0 ? 
      Number((multiplyMinor(totalSpentMinor, 10000n)) as bigint / (totalBudgetMinor as bigint)) / 100 : 0

    // Status geral baseado na utilização
    let overallStatus: BudgetStatusType = 'seguro'
    if (overallUtilization >= 100) {
      overallStatus = 'excedido'
    } else if (overallUtilization >= 80) {
      overallStatus = 'atenção'
    }

    const categoriesExceeded = budgetStatuses.filter(s => s.status === 'excedido').length
    const categoriesWarning = budgetStatuses.filter(s => s.status === 'atenção').length

    return {
      currentMonth,
      categoryBudgets: budgets,
      categorySpending: spending,
      budgetStatuses,
      totalBudgetMinor,
      totalSpentMinor,
      totalRemainingMinor,
      overallUtilization,
      overallStatus,
      categoriesExceeded,
      categoriesWarning
    }
  }

  /**
   * Calcula status de uma categoria específica
   * Usado tanto na análise geral quanto no impacto de transações
   */
  public calculateCategoryStatus(
    budget: CategoryBudget,
    spending: CategorySpending | undefined,
    currentPeriod: { year: number; month: number }
  ): BudgetStatus {
    const spentMinor = spending?.currentPeriodSpentMinor || 0n
    const budgetAmount = this.getBudgetAmountForPeriod(budget, currentPeriod)
    const remainingMinor = subtractMinor(budgetAmount, spentMinor)
    
    const utilizationPercent = compareMinor(budgetAmount, 0n) > 0 ? 
      Number((multiplyMinor(spentMinor, 10000n)) as bigint / (budgetAmount as bigint)) / 100 : 0

    let status: BudgetStatusType = 'seguro'
    if (utilizationPercent >= 100) {
      status = 'excedido'
    } else if (utilizationPercent >= 80) {
      status = 'atenção'
    }

    return {
      categoryId: budget.categoryId,
      categoryName: budget.categoryName,
      budgetAmountMinor: budgetAmount,
      spentMinor,
      remainingMinor,
      utilizationPercent,
      status
    }
  }

  /**
   * Calcula o valor do orçamento para o período atual
   * Lida com orçamentos anuais e mensais
   */
  private getBudgetAmountForPeriod(
    budget: CategoryBudget,
    currentPeriod: { year: number; month: number }
  ): Minor {
    if (budget.period === 'monthly') {
      return budget.budgetAmountMinor
    }

    if (budget.period === 'yearly') {
      // Se tem limite mensal definido, usa ele
      if (budget.monthlyLimitMinor) {
        return budget.monthlyLimitMinor
      }
      
      // Senão, divide o orçamento anual por 12
      return divideMinor(budget.budgetAmountMinor, 12n)
    }

    return budget.budgetAmountMinor
  }

  /**
   * Retorna visão geral simplificada do orçamento
   * Útil para dashboards e análises rápidas
   */
  public getBudgetOverview(analysis: BudgetAnalysis): {
    healthScore: number // 0-100, onde 100 é saudável
    riskLevel: 'baixo' | 'médio' | 'alto'
    topConcerns: string[]
    recommendations: string[]
  } {
    const { overallUtilization, categoriesExceeded, categoriesWarning, budgetStatuses } = analysis
    
    // Score de saúde (invertido da utilização)
    let healthScore = Math.max(0, 100 - overallUtilization)
    
    // Penaliza categorias excedidas
    healthScore -= categoriesExceeded * 20
    healthScore -= categoriesWarning * 10
    healthScore = Math.max(0, healthScore)

    // Nível de risco
    let riskLevel: 'baixo' | 'médio' | 'alto' = 'baixo'
    if (categoriesExceeded > 0 || overallUtilization >= 90) {
      riskLevel = 'alto'
    } else if (categoriesWarning > 0 || overallUtilization >= 70) {
      riskLevel = 'médio'
    }

    // Top 3 categorias problemáticas
    const topConcerns = budgetStatuses
      .filter((s: BudgetStatus) => s.status === 'excedido' || s.status === 'atenção')
      .sort((a: BudgetStatus, b: BudgetStatus) => b.utilizationPercent - a.utilizationPercent)
      .slice(0, 3)
      .map((s: BudgetStatus) => s.categoryName)

    // Recomendações baseadas no estado
    const recommendations: string[] = []
    if (categoriesExceeded > 0) {
      recommendations.push('Algumas categorias estão acima do orçamento')
    }
    if (categoriesWarning > 0) {
      recommendations.push('Categorias próximas do limite precisam de atenção')
    }
    if (overallUtilization < 50) {
      recommendations.push('Orçamento está sendo bem respeitado')
    }

    return {
      healthScore,
      riskLevel,
      topConcerns,
      recommendations
    }
  }
}
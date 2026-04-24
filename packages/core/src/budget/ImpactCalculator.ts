import { Minor, CompetencyMonth } from '../cashflow/types'
import { 
  CategoryBudget,
  CategorySpending,
  BudgetImpact,
  BudgetStatus,
  TransactionImpact,
  TransactionAnalysisInput,
  SpendingPattern,
  BudgetStatusType
} from './types'
import { BudgetEngine } from './BudgetEngine'

export class ImpactCalculator {
  private budgetEngine: BudgetEngine

  constructor() {
    this.budgetEngine = new BudgetEngine()
  }

  /**
   * Calcula o impacto em tempo real de uma nova transação
   * Essencial para o recurso de foto → análise
   */
  public calculateTransactionImpact(
    input: TransactionAnalysisInput,
    budgets: CategoryBudget[],
    currentSpending: CategorySpending[],
    spendingPatterns?: SpendingPattern[],
    currentMonth?: CompetencyMonth
  ): TransactionImpact {
    const month = currentMonth || this.getCurrentMonth()
    const budget = budgets.find(b => b.categoryId === input.categoryId)
    
    if (!budget) {
      return {
        insights: [`Categoria "${input.categoryId}" não tem orçamento definido`],
        warnings: ['Configure um orçamento para esta categoria para melhor controle'],
        recommendations: ['Defina um orçamento mensal para esta categoria']
      }
    }

    const currentCategorySpending = currentSpending.find(s => s.categoryId === input.categoryId)
    const budgetImpact = this.analyzeBudgetEffect(input, budget, currentCategorySpending, month)
    
    // Análise de padrões de gastos
    const pattern = spendingPatterns?.find(p => 
      p.categoryId === input.categoryId && 
      (!p.merchantName || input.merchantName?.includes(p.merchantName))
    )

    const insights = this.generateInsights(input, budgetImpact, pattern)
    const warnings = this.generateWarnings(budgetImpact, pattern)
    const recommendations = this.generateRecommendations(budgetImpact, pattern)

    return {
      budgetImpact,
      insights,
      warnings,
      recommendations
    }
  }

  /**
   * Analisa especificamente o efeito da transação no orçamento
   */
  public analyzeBudgetEffect(
    input: TransactionAnalysisInput,
    budget: CategoryBudget,
    currentSpending: CategorySpending | undefined,
    currentMonth: CompetencyMonth
  ): BudgetImpact {
    // Status atual do orçamento (antes da transação)
    const statusBefore = this.budgetEngine.calculateCategoryStatus(
      budget,
      currentSpending,
      this.parseCompetencyMonth(currentMonth)
    )

    // Simula o spending após a transação
    const spentAfterMinor = this.addMinor(
      currentSpending?.currentPeriodSpentMinor || 0n,
      input.amountMinor
    )

    const spendingAfter: CategorySpending = {
      categoryId: input.categoryId,
      categoryName: budget.categoryName,
      currentPeriodSpentMinor: spentAfterMinor,
      transactionCount: (currentSpending?.transactionCount || 0) + 1
    }

    // Status após a transação
    const statusAfter = this.budgetEngine.calculateCategoryStatus(
      budget,
      spendingAfter,
      this.parseCompetencyMonth(currentMonth)
    )

    const remainingAfterMinor = this.subtractMinor(
      statusAfter.budgetAmountMinor,
      spentAfterMinor
    )

    // Gera mensagem contextual
    const message = this.generateBudgetMessage(statusBefore, statusAfter, input)

    return {
      categoryId: input.categoryId,
      budgetAmountMinor: budget.budgetAmountMinor,
      currentSpentMinor: currentSpending?.currentPeriodSpentMinor || 0n,
      newTransactionMinor: input.amountMinor,
      spentAfterMinor,
      remainingAfterMinor,
      utilizationBefore: statusBefore.utilizationPercent,
      utilizationAfter: statusAfter.utilizationPercent,
      statusBefore,
      statusAfter,
      message
    }
  }

  /**
   * Gera insights sobre a transação
   */
  private generateInsights(
    input: TransactionAnalysisInput,
    impact: BudgetImpact,
    pattern?: SpendingPattern
  ): string[] {
    const insights: string[] = []

    // Insight sobre utilização do orçamento
    const utilizationChange = impact.utilizationAfter - impact.utilizationBefore
    insights.push(
      `Esta compra representa ${impact.utilizationAfter.toFixed(1)}% do seu orçamento mensal (+${utilizationChange.toFixed(1)}%)`
    )

    // Comparação com padrão histórico
    if (pattern) {
      const amountNumber = this.minorToNumber(input.amountMinor)
      const avgNumber = this.minorToNumber(pattern.avgAmountMinor)
      
      if (amountNumber > avgNumber * 1.5) {
        insights.push(`Valor 50% acima da sua média de R$ ${avgNumber.toFixed(2)} nesta categoria`)
      } else if (amountNumber < avgNumber * 0.5) {
        insights.push(`Economia de 50% em relação à sua média de R$ ${avgNumber.toFixed(2)}`)
      }

      // Tendência de gastos
      if (pattern.trend === 'crescente') {
        insights.push('Você está gastando mais nesta categoria recentemente')
      } else if (pattern.trend === 'decrescente') {
        insights.push('Você está conseguindo reduzir gastos nesta categoria')
      }
    }

    return insights
  }

  /**
   * Gera avisos sobre riscos
   */
  private generateWarnings(impact: BudgetImpact, pattern?: SpendingPattern): string[] {
    const warnings: string[] = []

    // Avisos sobre orçamento
    if (impact.statusAfter.status === 'excedido' && impact.statusBefore.status !== 'excedido') {
      warnings.push('⚠️ Esta compra vai estourar seu orçamento mensal!')
    } else if (impact.statusAfter.status === 'atenção' && impact.statusBefore.status === 'seguro') {
      warnings.push('⚠️ Atenção: você estará próximo do limite do orçamento')
    }

    if (impact.utilizationAfter >= 90) {
      warnings.push('Você já usou mais de 90% do orçamento desta categoria')
    }

    // Avisos sobre frequência
    if (pattern && pattern.frequency > 0) {
      const daysInMonth = 30
      const expectedTransactions = pattern.frequency
      const currentDay = new Date().getDate()
      const expectedByNow = (expectedTransactions * currentDay) / daysInMonth

      if (impact.statusAfter.utilizationPercent > expectedByNow * 1.3) {
        warnings.push('Ritmo de gastos acima do normal para este período do mês')
      }
    }

    return warnings
  }

  /**
   * Gera recomendações personalizadas
   */
  private generateRecommendations(impact: BudgetImpact, pattern?: SpendingPattern): string[] {
    const recommendations: string[] = []

    // Recomendações sobre orçamento
    if (impact.statusAfter.status === 'excedido') {
      recommendations.push('Consider postergar compras não essenciais nesta categoria')
      
      const remaining = this.minorToNumber(impact.remainingAfterMinor)
      if (remaining < 0) {
        recommendations.push(`Você precisará economizar R$ ${Math.abs(remaining).toFixed(2)} em outras categorias`)
      }
    } else if (impact.statusAfter.status === 'atenção') {
      recommendations.push('Monitore gastos nesta categoria pelo resto do mês')
    }

    // Recomendações baseadas em padrões
    if (pattern) {
      if (pattern.trend === 'crescente') {
        recommendations.push('Considere revisar seus hábitos de consumo nesta categoria')
      }
      
      const amountNumber = this.minorToNumber(impact.newTransactionMinor)
      const avgNumber = this.minorToNumber(pattern.avgAmountMinor)
      
      if (amountNumber > avgNumber * 2) {
        recommendations.push('Avalie se esta compra é realmente necessária dado o valor elevado')
      }
    }

    return recommendations
  }

  /**
   * Gera mensagem contextual sobre o impacto no orçamento
   */
  private generateBudgetMessage(
    before: BudgetStatus,
    after: BudgetStatus,
    input: TransactionAnalysisInput
  ): string {
    const remaining = this.minorToNumber(after.remainingMinor)
    const amount = this.minorToNumber(input.amountMinor)

    if (after.status === 'excedido') {
      return `Compra de R$ ${amount.toFixed(2)} excede orçamento em R$ ${Math.abs(remaining).toFixed(2)}`
    } else if (after.status === 'atenção') {
      return `Após esta compra, restam R$ ${remaining.toFixed(2)} (${(100 - after.utilizationPercent).toFixed(1)}% do orçamento)`
    } else {
      return `Compra dentro do orçamento. Restam R$ ${remaining.toFixed(2)}`
    }
  }

  // Utilitários para trabalhar com Minor e CompetencyMonth
  private addMinor(a: Minor, b: Minor): Minor {
    const aBig = typeof a === 'bigint' ? a : BigInt(a)
    const bBig = typeof b === 'bigint' ? b : BigInt(b)
    return aBig + bBig
  }

  private subtractMinor(a: Minor, b: Minor): Minor {
    const aBig = typeof a === 'bigint' ? a : BigInt(a)
    const bBig = typeof b === 'bigint' ? b : BigInt(b)
    return aBig - bBig
  }

  private minorToNumber(minor: Minor): number {
    const minorBig = typeof minor === 'bigint' ? minor : BigInt(minor)
    return Number(minorBig) / 100 // Assume que minor está em centavos
  }

  private parseCompetencyMonth(month: CompetencyMonth): { year: number; month: number } {
    const parts = month.split('-')
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`Invalid CompetencyMonth format: ${month}`)
    }
    
    const year = parseInt(parts[0], 10)
    const monthNum = parseInt(parts[1], 10)
    
    if (isNaN(year) || isNaN(monthNum)) {
      throw new Error(`Invalid CompetencyMonth format: ${month}`)
    }
    
    return { year, month: monthNum }
  }

  private getCurrentMonth(): CompetencyMonth {
    const now = new Date()
    const year = now.getFullYear()
    const month = (now.getMonth() + 1).toString().padStart(2, '0')
    return `${year}-${month}`
  }
}
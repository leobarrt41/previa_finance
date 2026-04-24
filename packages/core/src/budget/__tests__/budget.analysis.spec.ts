import { BudgetEngine } from '../BudgetEngine'
import { ImpactCalculator } from '../ImpactCalculator'
import { CategoryBudget, CategorySpending, TransactionAnalysisInput } from '../types'

describe('Budget Analysis - Photo to Analysis Feature', () => {
  const budgetEngine = new BudgetEngine()
  const impactCalculator = new ImpactCalculator()

  const mockBudgets: CategoryBudget[] = [
    {
      categoryId: 'food',
      categoryName: 'Alimentação',
      budgetAmountMinor: 50000n, // R$ 500,00
      period: 'monthly'
    },
    {
      categoryId: 'transport',
      categoryName: 'Transporte',
      budgetAmountMinor: 30000n, // R$ 300,00
      period: 'monthly'
    }
  ]

  const mockSpending: CategorySpending[] = [
    {
      categoryId: 'food',
      categoryName: 'Alimentação',
      currentPeriodSpentMinor: 35000n, // R$ 350,00 (70% do orçamento)
      transactionCount: 15
    }
  ]

  describe('BudgetEngine', () => {
    test('should analyze budgets correctly', () => {
      const analysis = budgetEngine.analyzeBudgets(
        mockBudgets,
        mockSpending,
        '2025-01'
      )

      expect(analysis.currentMonth).toBe('2025-01')
      expect(analysis.totalBudgetMinor).toBe(80000n) // R$ 800,00
      expect(analysis.totalSpentMinor).toBe(35000n) // R$ 350,00
      expect(analysis.overallUtilization).toBe(43.75) // 350/800 = 43.75%
      expect(analysis.overallStatus).toBe('seguro')
      expect(analysis.categoriesExceeded).toBe(0)
      expect(analysis.categoriesWarning).toBe(0)
    })

    test('should calculate category status correctly', () => {
      const foodBudget = mockBudgets[0]!
      const foodSpending = mockSpending[0]
      
      const status = budgetEngine.calculateCategoryStatus(
        foodBudget,
        foodSpending,
        { year: 2025, month: 1 }
      )

      expect(status.categoryId).toBe('food')
      expect(status.budgetAmountMinor).toBe(50000n)
      expect(status.spentMinor).toBe(35000n)
      expect(status.remainingMinor).toBe(15000n) // R$ 150,00
      expect(status.utilizationPercent).toBe(70)
      expect(status.status).toBe('seguro')
    })

    test('should detect warning status when utilization >= 80%', () => {
      const warningSpending: CategorySpending[] = [
        {
          categoryId: 'food',
          categoryName: 'Alimentação',
          currentPeriodSpentMinor: 42000n, // R$ 420,00 (84% do orçamento)
          transactionCount: 20
        }
      ]

      const status = budgetEngine.calculateCategoryStatus(
        mockBudgets[0]!,
        warningSpending[0],
        { year: 2025, month: 1 }
      )

      expect(status.utilizationPercent).toBe(84)
      expect(status.status).toBe('atenção')
    })
  })

  describe('ImpactCalculator', () => {
    test('should calculate transaction impact correctly', () => {
      const transactionInput: TransactionAnalysisInput = {
        amountMinor: 5000n, // R$ 50,00
        categoryId: 'food',
        description: 'Almoço restaurante',
        merchantName: 'Restaurante ABC'
      }

      const impact = impactCalculator.calculateTransactionImpact(
        transactionInput,
        mockBudgets,
        mockSpending,
        undefined,
        '2025-01'
      )

      expect(impact.budgetImpact).toBeDefined()
      expect(impact.insights[0]).toMatch(/80\.0%.*orçamento mensal/)
      expect(impact.warnings).toHaveLength(1) // Should warn about approaching limit
      expect(impact.recommendations).toBeDefined()
    })

    test('should warn when transaction exceeds budget', () => {
      const bigTransaction: TransactionAnalysisInput = {
        amountMinor: 20000n, // R$ 200,00 (levaria para R$ 550 total, excedendo R$ 500)
        categoryId: 'food',
        description: 'Compra grande supermercado',
        merchantName: 'Supermercado XYZ'
      }

      const impact = impactCalculator.calculateTransactionImpact(
        bigTransaction,
        mockBudgets,
        mockSpending,
        undefined,
        '2025-01'
      )

      expect(impact.budgetImpact?.statusAfter.status).toBe('excedido')
      expect(impact.warnings.some(w => w.includes('estourar'))).toBe(true)
      expect(impact.recommendations.some(r => r.includes('postergar'))).toBe(true)
    })

    test('should handle category without budget', () => {
      const unknownCategoryTransaction: TransactionAnalysisInput = {
        amountMinor: 10000n, // R$ 100,00
        categoryId: 'entertainment',
        description: 'Cinema',
        merchantName: 'Cineplex'
      }

      const impact = impactCalculator.calculateTransactionImpact(
        unknownCategoryTransaction,
        mockBudgets,
        mockSpending,
        undefined,
        '2025-01'
      )

      expect(impact.budgetImpact).toBeUndefined()
      expect(impact.insights.some(i => i.includes('não tem orçamento definido'))).toBe(true)
      expect(impact.recommendations.some(r => r.includes('Defina um orçamento'))).toBe(true)
    })

    test('should analyze budget effect correctly', () => {
      const transactionInput: TransactionAnalysisInput = {
        amountMinor: 8000n, // R$ 80,00
        categoryId: 'food',
        description: 'Jantar especial'
      }

      const budgetImpact = impactCalculator.analyzeBudgetEffect(
        transactionInput,
        mockBudgets[0]!,
        mockSpending[0],
        '2025-01'
      )

      expect(budgetImpact.categoryId).toBe('food')
      expect(budgetImpact.currentSpentMinor).toBe(35000n)
      expect(budgetImpact.newTransactionMinor).toBe(8000n)
      expect(budgetImpact.spentAfterMinor).toBe(43000n) // R$ 430,00
      expect(budgetImpact.remainingAfterMinor).toBe(7000n) // R$ 70,00
      expect(budgetImpact.utilizationBefore).toBe(70)
      expect(budgetImpact.utilizationAfter).toBe(86)
      expect(budgetImpact.statusBefore.status).toBe('seguro')
      expect(budgetImpact.statusAfter.status).toBe('atenção')
      expect(budgetImpact.message).toContain('restam R$ 70.00')
    })
  })

  describe('Budget Overview', () => {
    test('should calculate health score correctly', () => {
      const analysis = budgetEngine.analyzeBudgets(
        mockBudgets,
        mockSpending,
        '2025-01'
      )

      const overview = budgetEngine.getBudgetOverview(analysis)

      expect(overview.healthScore).toBeGreaterThan(50) // Saudável com 43.75% utilização
      expect(overview.riskLevel).toBe('baixo')
      expect(overview.topConcerns).toHaveLength(0) // Nenhuma categoria problemática
      expect(overview.recommendations).toContain('Orçamento está sendo bem respeitado')
    })

    test('should detect high risk when categories are exceeded', () => {
      const exceededSpending: CategorySpending[] = [
        {
          categoryId: 'food',
          categoryName: 'Alimentação',
          currentPeriodSpentMinor: 55000n, // R$ 550,00 (excede R$ 500)
          transactionCount: 25
        }
      ]

      const analysis = budgetEngine.analyzeBudgets(
        mockBudgets,
        exceededSpending,
        '2025-01'
      )

      const overview = budgetEngine.getBudgetOverview(analysis)

      expect(overview.riskLevel).toBe('alto')
      expect(overview.topConcerns).toContain('Alimentação')
      expect(overview.recommendations).toContain('Algumas categorias estão acima do orçamento')
    })
  })
})
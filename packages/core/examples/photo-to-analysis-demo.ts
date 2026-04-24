/**
 * Exemplo de uso do Budget Engine e Impact Calculator
 * Para o recurso de foto → análise (análise em tempo real de notas fiscais)
 */

import { BudgetEngine, ImpactCalculator, CategoryBudget, CategorySpending } from '../src'

// Setup dos engines
const budgetEngine = new BudgetEngine()
const impactCalculator = new ImpactCalculator()

// Exemplo: usuário tem orçamentos definidos
const userBudgets: CategoryBudget[] = [
  {
    categoryId: 'food',
    categoryName: 'Alimentação',
    budgetAmountMinor: 80000n, // R$ 800,00
    period: 'monthly'
  },
  {
    categoryId: 'transport',
    categoryName: 'Transporte', 
    budgetAmountMinor: 40000n, // R$ 400,00
    period: 'monthly'
  },
  {
    categoryId: 'shopping',
    categoryName: 'Compras',
    budgetAmountMinor: 60000n, // R$ 600,00
    period: 'monthly'
  }
]

// Gastos atuais do mês (vem do banco de dados)
const currentSpending: CategorySpending[] = [
  {
    categoryId: 'food',
    categoryName: 'Alimentação',
    currentPeriodSpentMinor: 55000n, // R$ 550,00
    transactionCount: 18
  },
  {
    categoryId: 'transport', 
    categoryName: 'Transporte',
    currentPeriodSpentMinor: 28000n, // R$ 280,00
    transactionCount: 12
  }
]

// Função que seria chamada quando usuário tira foto de uma nota fiscal
export async function analyzePhotoReceipt(
  amountMinor: bigint,
  categoryId: string,
  description: string,
  merchantName?: string
) {
  const currentMonth = '2025-01'

  console.log('📸 Analisando nota fiscal...')
  console.log(`💰 Valor: R$ ${Number(amountMinor) / 100}`)
  console.log(`🏷️  Categoria: ${categoryId}`)
  console.log(`📝 Descrição: ${description}`)
  
  // 1. Análise geral do orçamento atual
  const budgetAnalysis = budgetEngine.analyzeBudgets(
    userBudgets,
    currentSpending,
    currentMonth
  )

  console.log('\n📊 SITUAÇÃO ATUAL DO ORÇAMENTO:')
  console.log(`Total orçado: R$ ${Number(budgetAnalysis.totalBudgetMinor) / 100}`)
  console.log(`Total gasto: R$ ${Number(budgetAnalysis.totalSpentMinor) / 100}`)
  console.log(`Utilização geral: ${budgetAnalysis.overallUtilization.toFixed(1)}%`)
  console.log(`Status: ${budgetAnalysis.overallStatus}`)

  // 2. Impacto específico desta transação
  const transactionInput = {
    amountMinor,
    categoryId,
    description,
    ...(merchantName && { merchantName })
  }
  
  const transactionImpact = impactCalculator.calculateTransactionImpact(
    transactionInput,
    userBudgets,
    currentSpending,
    undefined, // padrões de gastos podem ser opcionais
    currentMonth
  )

  console.log('\n🎯 IMPACTO DESTA COMPRA:')
  
  if (transactionImpact.budgetImpact) {
    const impact = transactionImpact.budgetImpact
    console.log(`Categoria: ${impact.statusAfter.categoryName}`)
    console.log(`Utilização antes: ${impact.utilizationBefore.toFixed(1)}%`)
    console.log(`Utilização após: ${impact.utilizationAfter.toFixed(1)}%`)
    console.log(`Status após: ${impact.statusAfter.status}`)
    console.log(`Valor restante: R$ ${Number(impact.remainingAfterMinor) / 100}`)
    console.log(`💬 ${impact.message}`)
  }

  // 3. Insights e recomendações
  console.log('\n💡 INSIGHTS:')
  transactionImpact.insights.forEach(insight => console.log(`  • ${insight}`))

  if (transactionImpact.warnings.length > 0) {
    console.log('\n⚠️  AVISOS:')
    transactionImpact.warnings.forEach(warning => console.log(`  • ${warning}`))
  }

  if (transactionImpact.recommendations.length > 0) {
    console.log('\n📋 RECOMENDAÇÕES:')
    transactionImpact.recommendations.forEach(rec => console.log(`  • ${rec}`))
  }

  // 4. Visão geral da saúde financeira
  const overview = budgetEngine.getBudgetOverview(budgetAnalysis)
  
  console.log('\n🏥 SAÚDE FINANCEIRA:')
  console.log(`Score: ${overview.healthScore}/100`)
  console.log(`Nível de risco: ${overview.riskLevel}`)
  
  if (overview.topConcerns.length > 0) {
    console.log(`Categorias problemáticas: ${overview.topConcerns.join(', ')}`)
  }

  return {
    budgetAnalysis,
    transactionImpact,
    overview,
    recommendation: transactionImpact.warnings.length > 0 ? 'careful' : 'safe'
  }
}

// Exemplos de uso:

// Exemplo 1: Compra normal dentro do orçamento
console.log('=== EXEMPLO 1: Compra de supermercado ===')
analyzePhotoReceipt(
  15000n, // R$ 150,00
  'food',
  'Compras do mês no supermercado',
  'Supermercado Extra'
)

console.log('\n\n=== EXEMPLO 2: Compra que excede orçamento ===')
analyzePhotoReceipt(
  35000n, // R$ 350,00 (isso levaria alimentação para R$ 900, excedendo R$ 800)
  'food',
  'Jantar de aniversário no restaurante',
  'Restaurante Michelin'
)

console.log('\n\n=== EXEMPLO 3: Compra em categoria sem orçamento ===')
analyzePhotoReceipt(
  25000n, // R$ 250,00
  'entertainment',
  'Ingresso show musical',
  'Ticketmaster'
)
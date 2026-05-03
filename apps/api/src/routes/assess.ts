/**
 * routes/assess.ts — Avaliadores Financeiros com IA
 *
 * Endpoints:
 *   POST /api/assess/budget   — Avaliação automática de orçamento (renda vs gastos vs dívidas)
 *   POST /api/assess/spending — Avaliação de gastos por categoria (histórico, tendência, risco)
 *   POST /api/assess/debt     — Avaliação de dívidas (faturas, parcelas, risco de atraso)
 *
 * Padrão de chamada IA: POST /v1/chat/completions com response_format: json_object
 * (mesmo padrão de invoices.ts e transactions.ts)
 */
import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { transactions, accounts, categories, cardInvoices, cardTransactions, cashflowForecasts, cashflowForecastMonthStatus, receiptDocuments } from '@previa/db'
import { and, eq, gte, lte, sql, desc, inArray } from 'drizzle-orm'
import { createError } from '../middlewares/errorHandler.js'
import { getDatabase } from '../config/database.js'
import { resolveOwnerId } from '../services/ownerStore.js'
import { requireClerkAuth } from '../middlewares/auth.js'
import { config } from '../config/env.js'

const router: Router = Router()
router.use(requireClerkAuth)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Calcula meses anteriores a partir de um mês base (YYYY-MM) */
function previousMonths(base: string, count: number): string[] {
  const [y, m] = base.split('-').map(Number)
  const months: string[] = []
  for (let i = count; i >= 1; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

function shouldApplyForecastInMonth(
  forecast: {
    competencyMonth: string
    recurrence?: string | null
    recurrenceEnd?: string | null
  },
  month: string,
): boolean {
  if (month < forecast.competencyMonth) return false
  if (forecast.recurrenceEnd && month > forecast.recurrenceEnd) return false

  const recurrence = forecast.recurrence ?? 'one-time'
  if (recurrence === 'one-time') return month === forecast.competencyMonth
  if (recurrence === 'monthly') return true
  if (recurrence === 'yearly') return month.slice(5) === forecast.competencyMonth.slice(5)
  return false
}

function expandForecastsForMonth(
  month: string,
  forecasts: Array<{
    id: string
    competencyMonth: string
    amountMinor: bigint
    recurrence?: string | null
    recurrenceEnd?: string | null
    description?: string | null
    isActive: boolean
  }>,
  paidMonthsByForecastId: Map<string, Set<string>>,
) {
  return forecasts.flatMap((forecast) => {
    if (!forecast.isActive) return []
    if (!shouldApplyForecastInMonth(forecast, month)) return []

    const paidMonths = paidMonthsByForecastId.get(forecast.id) ?? new Set<string>()
    if (paidMonths.has(month)) return []

    return [{
      id: `${forecast.id}:${month}`,
      competencyMonth: month,
      amountMinor: forecast.amountMinor,
      description: forecast.description ?? null,
    }]
  })
}

function minorToBRL(minorValue: number | bigint): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(minorValue) / 100)
}

function toBigIntValue(value: number | bigint | string): bigint {
  return typeof value === 'bigint' ? value : BigInt(value)
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))]
}

function spendMinor(value: number | bigint): number {
  const minor = Number(value)
  return Math.abs(minor)
}

function riskLevelFromCommitment(commitmentPct: number): 'baixo' | 'moderado' | 'alto' | 'crítico' {
  if (commitmentPct < 50) return 'baixo'
  if (commitmentPct < 70) return 'moderado'
  if (commitmentPct < 90) return 'alto'
  return 'crítico'
}

function buildBudgetAutoAssessment(input: {
  month: string
  incomeMinor: number
  expenseMinor: number
  liabilityMinor: number
  openDebtMinor: number
  installmentDebtMinor: number
  projectedIncomeMinor: number
  projectedExpenseMinor: number
  projectedLiabilityMinor: number
  consideredIncomeMinor: number
  consideredExpenseMinor: number
  consideredLiabilityMinor: number
  totalCommittedMinor: number
  availableMinor: number
  commitmentPct: number
  categoryBreakdown: Array<{ categoryId: string; amountMinor: number; pctOfIncome: number }>
  historicalMonths: Array<{ month: string; incomeMinor: number; expenseMinor: number }>
  usedProjectedIncome: boolean
  usedProjectedExpense: boolean
  usedProjectedLiability: boolean
}) {
  const canSpend = input.availableMinor > 0 && input.commitmentPct <= 90
  const riskLevel = riskLevelFromCommitment(input.commitmentPct)
  const topCategory = input.categoryBreakdown[0]
  const monthLabel = input.month
  const projectedParts: string[] = []
  if (input.usedProjectedIncome) projectedParts.push(`renda prevista de ${minorToBRL(input.projectedIncomeMinor)}`)
  if (input.usedProjectedExpense) projectedParts.push(`gastos previstos de ${minorToBRL(input.projectedExpenseMinor)}`)
  if (input.usedProjectedLiability) projectedParts.push(`dívida prevista de ${minorToBRL(input.projectedLiabilityMinor)}`)
  if (input.installmentDebtMinor > 0) projectedParts.push(`parcelas futuras de ${minorToBRL(input.installmentDebtMinor)}`)
  const projectionText = projectedParts.length > 0
    ? ` Como não havia dados reais suficientes para algumas partes do mês, foram consideradas apenas as projeções necessárias (${projectedParts.join(', ')}).`
    : ' Como há dados reais suficientes no mês, projeções não foram somadas ao realizado.'

  const diagnosis = input.availableMinor >= 0
    ? `No mês ${monthLabel}, sua renda considerada foi de ${minorToBRL(input.consideredIncomeMinor)}. Os gastos considerados somam ${minorToBRL(input.consideredExpenseMinor)} e as dívidas consideradas somam ${minorToBRL(input.consideredLiabilityMinor)}, deixando uma sobra de ${minorToBRL(input.availableMinor)}.${projectionText}`
    : `No mês ${monthLabel}, sua renda considerada foi de ${minorToBRL(input.consideredIncomeMinor)}. Os gastos considerados somam ${minorToBRL(input.consideredExpenseMinor)} e as dívidas consideradas somam ${minorToBRL(input.consideredLiabilityMinor)}, resultando em déficit de ${minorToBRL(Math.abs(input.availableMinor))}.${projectionText}`

  const alerts: string[] = []
  if (input.commitmentPct >= 90) {
    alerts.push(`Comprometimento de ${input.commitmentPct}% da renda, acima do nível seguro.`)
  } else if (input.commitmentPct >= 70) {
    alerts.push(`Comprometimento de ${input.commitmentPct}% da renda, nível elevado.`)
  }
  if (input.availableMinor < 0) {
    alerts.push(`Seu orçamento fecha no vermelho em ${minorToBRL(Math.abs(input.availableMinor))}.`)
  } else if (input.availableMinor < Math.round(input.consideredIncomeMinor * 0.1)) {
    alerts.push(`A sobra de ${minorToBRL(input.availableMinor)} está abaixo de 10% da renda considerada.`)
  }
  if (input.openDebtMinor > 0) {
    alerts.push(`Há dívida em aberto de ${minorToBRL(input.openDebtMinor)} que precisa entrar no planejamento.`)
  }
  if (input.installmentDebtMinor > 0) {
    alerts.push(`Há parcelas futuras de ${minorToBRL(input.installmentDebtMinor)} que precisam ser conciliadas com o extrato e a fatura.`)
  }

  const recommendations: string[] = []
  if (input.usedProjectedIncome) {
    recommendations.push('Mantenha a renda prevista apenas como contingência; se a renda real entrar, ela substitui a previsão.')
  }
  if (input.usedProjectedExpense) {
    recommendations.push('Revise as projeções de gastos antes do fim do mês para evitar surpresa no caixa.')
  }
  if (input.usedProjectedLiability) {
    recommendations.push('Reserve caixa para as parcelas/dívidas previstas até elas serem conciliadas no extrato ou fatura.')
  }
  if (input.installmentDebtMinor > 0) {
    recommendations.push('Marque o que já foi pago no previsto para não contar a mesma dívida duas vezes no orçamento.')
  }
  recommendations.push('Priorize as categorias com maior peso no mês e evite novas compras não essenciais enquanto a sobra estiver apertada.')
  recommendations.push('Se houver dívida aberta, antecipe o pagamento apenas se isso não comprometer a liquidez do mês.')

  return {
    canSpend,
    availableMinor: input.availableMinor,
    commitmentPct: input.commitmentPct,
    riskLevel,
    diagnosis,
    topCategories: input.categoryBreakdown.slice(0, 5).map((item) => ({
      categoryId: item.categoryId,
      label: item.categoryId,
      amountMinor: item.amountMinor,
      pctOfIncome: item.pctOfIncome,
    })),
    alerts,
    recommendations,
  }
}

function stringifyForAI(payload: unknown): string {
  return JSON.stringify(payload, (_, value) => (typeof value === 'bigint' ? value.toString() : value))
}

async function buildSpendingOverview(
  db: ReturnType<typeof getDatabase>,
  ownerId: number,
  month: string,
) {
  const categoryRows = await db
    .select({
      id: categories.id,
      name: categories.name,
      parentId: categories.parentId,
      type: categories.type,
    })
    .from(categories)
    .where(eq(categories.type, 'expense'))

  const categoryById = new Map<string, { id: string; name: string; parentId: string | null }>()
  for (const row of categoryRows) {
    categoryById.set(row.id, {
      id: row.id,
      name: row.name,
      parentId: row.parentId ?? null,
    })
  }

  const rootCategoryIds = categoryRows
    .filter((row) => !row.parentId)
    .map((row) => row.id)

  const rootOf = (categoryId: string | null | undefined): string | null => {
    if (!categoryId) return null
    let current = categoryById.get(categoryId) ?? null
    while (current?.parentId) {
      current = categoryById.get(current.parentId) ?? null
    }
    return current?.id ?? null
  }

  const [statementRows, invoiceRows] = await Promise.all([
    db
      .select({
        amountMinor: transactions.amountMinor,
        categoryId: transactions.categoryId,
      })
      .from(transactions)
      .where(and(
        eq(transactions.userId, ownerId),
        eq(transactions.movementType, 'expense'),
        eq(transactions.competencyMonth, month),
      )),
    db
      .select({
        amountMinor: cardTransactions.amountMinor,
        categoryId: cardTransactions.categoryId,
      })
      .from(cardTransactions)
      .where(and(
        eq(cardTransactions.userId, ownerId),
        eq(cardTransactions.movementType, 'card_purchase'),
        eq(cardTransactions.competencyMonth, month),
      )),
  ])

  const labels = new Map<string, string>()
  const labelIds = uniqueStrings([
    ...rootCategoryIds,
  ])
  if (labelIds.length > 0) {
    const rows = await db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(inArray(categories.id, labelIds))
    for (const row of rows) labels.set(row.id, row.name)
  }

  const totals = new Map<string, number>()
  for (const row of [...statementRows, ...invoiceRows]) {
    const key = rootOf(row.categoryId)
    if (!key || !rootCategoryIds.includes(key)) continue
    totals.set(key, (totals.get(key) ?? 0) + spendMinor(row.amountMinor))
  }

  const categoryBreakdown = [...totals.entries()]
    .map(([categoryId, amountMinor]) => ({
      categoryId,
      label: labels.get(categoryId) ?? categoryId,
      amountMinor,
      pctOfTotal: 0,
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor)

  const totalMinor = categoryBreakdown.reduce((sum, item) => sum + item.amountMinor, 0)
  for (const item of categoryBreakdown) {
    item.pctOfTotal = totalMinor > 0 ? Math.round((item.amountMinor / totalMinor) * 1000) / 10 : 0
  }

  return {
    mode: 'overview' as const,
    month,
    totalMinor,
    sourceSummary: {
      statementMinor: statementRows.reduce((sum, row) => sum + spendMinor(row.amountMinor), 0),
      invoiceMinor: invoiceRows.reduce((sum, row) => sum + spendMinor(row.amountMinor), 0),
    },
    categoryBreakdown,
    ai: null,
  }
}

/** Chama a IA com um system prompt e user payload, retorna JSON parseado */
async function callAI(systemPrompt: string, userPayload: unknown): Promise<Record<string, unknown>> {
  const baseUrl = config.ai.baseUrl.replace(/\/$/, '')
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.ai.apiKey}`,
    },
    body: JSON.stringify({
      model: config.ai.model,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: stringifyForAI(userPayload) },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`AI assess failed (${response.status}): ${text}`)
  }

  const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
  const content = json.choices?.[0]?.message?.content ?? '{}'
  try {
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// POST /api/assess/budget
// ---------------------------------------------------------------------------
router.post('/budget', async (req: Request, res: Response) => {
  const { month, extraForecasts, includeAi } = z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    extraForecasts: z.array(z.object({
      id: z.string(),
      competencyMonth: z.string().regex(/^\d{4}-\d{2}$/),
      amountMinor: z.union([z.number(), z.bigint()]),
      recurrence: z.enum(['one-time', 'monthly', 'yearly']).optional(),
      recurrenceEnd: z.string().regex(/^\d{4}-\d{2}$/).nullable().optional(),
      description: z.string().optional(),
      isActive: z.boolean().optional(),
    })).optional(),
    includeAi: z.boolean().optional().default(false),
  }).parse(req.body)
  const db = getDatabase()
  const owner = await resolveOwnerId(req.authUser!.clerkUserId)

  const userAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.userId, owner.id))

  if (userAccounts.length === 0) {
    res.json({ error: 'Nenhuma conta encontrada' })
    return
  }

  const monthTransactions = await db
    .select({
      type: transactions.movementType,
      amountMinor: transactions.amountMinor,
      description: transactions.description,
      categoryId: transactions.categoryId,
      competencyMonth: transactions.competencyMonth,
    })
    .from(transactions)
    .where(and(
      eq(transactions.userId, owner.id),
      eq(transactions.competencyMonth, month),
    ))
    .orderBy(desc(transactions.amountMinor))
    .limit(200)

  const prevMonths = previousMonths(month, 3)
  const histTransactions = await db
    .select({
      type: transactions.movementType,
      amountMinor: transactions.amountMinor,
      competencyMonth: transactions.competencyMonth,
    })
    .from(transactions)
    .where(and(
      eq(transactions.userId, owner.id),
      sql`${transactions.competencyMonth} IN (${sql.join(prevMonths.map(pm => sql`${pm}`), sql`, `)})`,
    ))

  const invoicesData = await db
    .select({
      id: cardInvoices.id,
      invoiceMonth: cardInvoices.invoiceMonth,
      dueDate: cardInvoices.dueDate,
      status: cardInvoices.status,
      totalAmountMinor: cardInvoices.totalAmountMinor,
      previousBalanceMinor: cardInvoices.previousBalanceMinor,
      openAmountMinor: cardInvoices.openAmountMinor,
      paidAmountMinor: cardInvoices.paidAmountMinor,
      institutionName: accounts.displayName,
    })
    .from(cardInvoices)
    .leftJoin(accounts, eq(cardInvoices.accountId, accounts.id))
    .where(and(
      eq(cardInvoices.userId, owner.id),
      gte(cardInvoices.invoiceMonth, prevMonths[0]),
      lte(cardInvoices.invoiceMonth, month),
    ))

  const installmentTxs = await db
    .select({
      description: cardTransactions.description,
      amountMinor: cardTransactions.amountMinor,
      installmentNumber: cardTransactions.installmentNumber,
      installmentTotal: cardTransactions.installmentTotal,
      competencyMonth: cardTransactions.competencyMonth,
    })
    .from(cardTransactions)
    .where(and(
      eq(cardTransactions.userId, owner.id),
      sql`${cardTransactions.installmentNumber} IS NOT NULL AND ${cardTransactions.installmentTotal} IS NOT NULL AND ${cardTransactions.installmentTotal} > ${cardTransactions.installmentNumber}`,
      sql`${cardTransactions.competencyMonth} >= ${month}`,
    ))
    .orderBy(cardTransactions.competencyMonth)
    .limit(200)

  const realizedIncomeMinor = monthTransactions
    .filter(t => t.type === 'income')
    .reduce((s, t) => s + Number(t.amountMinor), 0)

  const realizedExpenseMinor = monthTransactions
    .filter(t => t.type === 'expense')
    .reduce((s, t) => s + spendMinor(t.amountMinor), 0)

  const realizedLiabilityMinor = monthTransactions
    .filter(t => t.type === 'liability_payment')
    .reduce((s, t) => s + spendMinor(t.amountMinor), 0)

  const openDebtMinor = invoicesData
    .filter(i => i.status === 'open' || i.status === 'partial')
    .reduce((s, i) => s + Math.abs(Number(i.openAmountMinor ?? 0)), 0)

  const installmentDebtMinor = installmentTxs
    .reduce((s, t) => s + spendMinor(t.amountMinor), 0)

  const hasRealIncome = realizedIncomeMinor > 0
  const hasRealExpense = realizedExpenseMinor > 0
  const hasRealLiability = realizedLiabilityMinor > 0 || openDebtMinor > 0 || installmentDebtMinor > 0
  const hasCurrentMonthRealData = hasRealIncome || hasRealExpense || hasRealLiability

  const [forecastRows, forecastStatusRows, projectedReceiptDocs] = await Promise.all([
    db
      .select({
        id: cashflowForecasts.id,
        competencyMonth: cashflowForecasts.competencyMonth,
        amountMinor: cashflowForecasts.amountMinor,
        recurrence: cashflowForecasts.recurrence,
        recurrenceEnd: cashflowForecasts.recurrenceEnd,
        description: cashflowForecasts.description,
        isActive: cashflowForecasts.isActive,
      })
      .from(cashflowForecasts)
      .where(eq(cashflowForecasts.userId, owner.id)),
    db
      .select({
        forecastId: cashflowForecastMonthStatus.forecastId,
        competencyMonth: cashflowForecastMonthStatus.competencyMonth,
        isPaid: cashflowForecastMonthStatus.isPaid,
      })
      .from(cashflowForecastMonthStatus)
      .where(eq(cashflowForecastMonthStatus.userId, owner.id)),
    db
      .select({
        id: receiptDocuments.id,
        amountMinor: receiptDocuments.amountMinor,
        purchaseMonth: receiptDocuments.purchaseMonth,
        expectedInvoiceMonth: receiptDocuments.expectedInvoiceMonth,
        merchantName: receiptDocuments.merchantName,
        description: receiptDocuments.description,
        dataState: receiptDocuments.dataState,
      })
      .from(receiptDocuments)
      .where(and(
        eq(receiptDocuments.ownerId, owner.id),
        eq(receiptDocuments.dataState, 'projected'),
      )),
  ])

  const paidMonthsByForecastId = new Map<string, Set<string>>()
  for (const row of forecastStatusRows) {
    if (!row.isPaid) continue
    const set = paidMonthsByForecastId.get(row.forecastId) ?? new Set<string>()
    set.add(row.competencyMonth)
    paidMonthsByForecastId.set(row.forecastId, set)
  }

  const useProjections = !hasCurrentMonthRealData

  const currentForecastRows = useProjections
    ? expandForecastsForMonth(
        month,
        forecastRows.map((f) => ({
          ...f,
          amountMinor: toBigIntValue(f.amountMinor),
          recurrence: f.recurrence ?? 'one-time',
          recurrenceEnd: f.recurrenceEnd ?? null,
          description: f.description ?? null,
          isActive: Boolean(f.isActive),
        })),
        paidMonthsByForecastId,
      )
    : []

  const currentManualForecasts = useProjections
    ? (extraForecasts ?? [])
        .filter((f) => f.isActive !== false)
        .filter((f) => shouldApplyForecastInMonth(f, month))
        .map((f) => ({
          id: f.id,
          competencyMonth: month,
          amountMinor: toBigIntValue(f.amountMinor),
          description: f.description ?? null,
        }))
    : []

  const projectedReceiptExpenseRows = useProjections
    ? projectedReceiptDocs
        .filter((doc) => !doc.expectedInvoiceMonth && doc.purchaseMonth === month)
        .map((doc) => ({
          id: `receipt-debit-${doc.id}`,
          competencyMonth: month,
          amountMinor: toBigIntValue(doc.amountMinor),
          description: doc.merchantName ?? doc.description ?? null,
        }))
    : []

  const projectedReceiptLiabilityRows = useProjections
    ? projectedReceiptDocs
        .filter((doc) => doc.expectedInvoiceMonth === month)
        .map((doc) => ({
          id: `receipt-card-${doc.id}`,
          competencyMonth: month,
          amountMinor: toBigIntValue(doc.amountMinor),
          description: doc.merchantName ?? doc.description ?? null,
        }))
    : []

  const projectedItems = [
    ...currentForecastRows.map((item) => ({
      source: 'cashflow_forecast' as const,
      kind: item.amountMinor >= 0n ? 'income' as const : 'expense' as const,
      label: item.description ?? 'Previsão',
      month: item.competencyMonth,
      amountMinor: Number(item.amountMinor),
    })),
    ...currentManualForecasts.map((item) => ({
      source: 'manual_projection' as const,
      kind: item.amountMinor >= 0n ? 'income' as const : 'expense' as const,
      label: item.description ?? 'Projeção avulsa',
      month: item.competencyMonth,
      amountMinor: Number(item.amountMinor),
    })),
    ...projectedReceiptExpenseRows.map((item) => ({
      source: 'receipt_document' as const,
      kind: 'expense' as const,
      label: item.description ?? 'Comprovante previsto',
      month: item.competencyMonth,
      amountMinor: Number(item.amountMinor),
    })),
    ...projectedReceiptLiabilityRows.map((item) => ({
      source: 'receipt_document' as const,
      kind: 'liability' as const,
      label: item.description ?? 'Fatura prevista',
      month: item.competencyMonth,
      amountMinor: Number(item.amountMinor),
    })),
  ]

  const projectedIncomeMinor = projectedItems
    .filter(item => item.kind === 'income')
    .reduce((s, item) => s + Number(item.amountMinor), 0)

  const projectedExpenseMinor = projectedItems
    .filter(item => item.kind === 'expense')
    .reduce((s, item) => s + Math.abs(Number(item.amountMinor)), 0)

  const projectedLiabilityMinor = projectedItems
    .filter(item => item.kind === 'liability')
    .reduce((s, item) => s + Math.abs(Number(item.amountMinor)), 0)

  const consideredIncomeMinor = hasRealIncome
    ? realizedIncomeMinor
    : projectedIncomeMinor
  const consideredExpenseMinor = hasRealExpense
    ? realizedExpenseMinor
    : projectedExpenseMinor
  const consideredLiabilityMinor = hasRealLiability
    ? realizedLiabilityMinor + openDebtMinor + installmentDebtMinor
    : projectedLiabilityMinor
  const consideredCommittedMinor = consideredExpenseMinor + consideredLiabilityMinor
  const consideredAvailableMinor = consideredIncomeMinor - consideredCommittedMinor

  const byCat: Record<string, number> = {}
  for (const t of monthTransactions.filter(t => t.type === 'expense')) {
    const cat = t.categoryId ?? 'sem_categoria'
    byCat[cat] = (byCat[cat] ?? 0) + spendMinor(t.amountMinor)
  }

  const categoryBreakdown = Object.entries(byCat)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([cat, amt]) => ({
      categoryId: cat,
      amountMinor: amt,
      pctOfIncome: consideredIncomeMinor > 0 ? Math.round(amt / consideredIncomeMinor * 100) : 0,
    }))

  const histSummary = prevMonths.map(pm => {
    const mTxs = histTransactions.filter(t => t.competencyMonth === pm)
    return {
      month: pm,
      incomeMinor: mTxs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amountMinor), 0),
      expenseMinor: mTxs.filter(t => t.type === 'expense').reduce((s, t) => s + spendMinor(t.amountMinor), 0),
    }
  })

  const systemPrompt = `Você é um consultor financeiro pessoal especializado em finanças domésticas brasileiras.
Analise os dados financeiros do usuário e responda SOMENTE em JSON com este formato exato:
{
  "canSpend": true,
  "availableMinor": 50000,
  "commitmentPct": 65,
  "riskLevel": "moderado",
  "diagnosis": "Parágrafo de 2-3 frases descrevendo a situação financeira do mês com valores reais.",
  "topCategories": [{"categoryId":"alimentacao","label":"Alimentação","amountMinor":30000,"pctOfIncome":15}],
  "alerts": ["Alerta específico com valor real"],
  "recommendations": ["Recomendação acionável e específica 1", "Recomendação 2", "Recomendação 3"]
}
Regras:
- canSpend = true se sobra > 10% da renda após gastos + dívidas em aberto
- availableMinor = renda considerada - gastos considerados - dívidas consideradas (pode ser negativo)
- commitmentPct = (gastos considerados + dívidas consideradas) / renda considerada * 100
- riskLevel: baixo (<50%), moderado (50-70%), alto (70-90%), crítico (>90%)
- diagnosis deve citar valores reais e comparar com histórico e com as previsões do mês
- Se houver dados reais do mês para renda, gastos ou dívida, não some previsão para esse mesmo bloco; previsão só entra como fallback quando o bloco real estiver ausente
- recommendations devem ser acionáveis e específicas, nunca genéricas
- Responda em português brasileiro`

  const aiPayload = {
    currentMonth: month,
    hasCurrentMonthRealData,
    realizedIncomeMinor,
    realizedExpenseMinor,
    realizedLiabilityMinor,
    projectedIncomeMinor,
    projectedExpenseMinor,
    projectedLiabilityMinor,
    installmentDebtMinor,
    consideredIncomeMinor,
    consideredExpenseMinor,
    consideredLiabilityMinor,
    openDebtMinor,
    totalCommittedMinor: consideredCommittedMinor,
    availableMinor: consideredAvailableMinor,
    commitmentPct: consideredIncomeMinor > 0 ? Math.round(consideredCommittedMinor / consideredIncomeMinor * 100) : 0,
    realizedIncomeBRL: minorToBRL(realizedIncomeMinor),
    realizedExpenseBRL: minorToBRL(realizedExpenseMinor),
    realizedLiabilityBRL: minorToBRL(realizedLiabilityMinor),
    projectedIncomeBRL: minorToBRL(projectedIncomeMinor),
    projectedExpenseBRL: minorToBRL(projectedExpenseMinor),
    projectedLiabilityBRL: minorToBRL(projectedLiabilityMinor),
    consideredIncomeBRL: minorToBRL(consideredIncomeMinor),
    consideredExpenseBRL: minorToBRL(consideredExpenseMinor),
    consideredLiabilityBRL: minorToBRL(consideredLiabilityMinor),
    consideredAvailableBRL: minorToBRL(consideredAvailableMinor),
    usedProjectedIncome: !hasRealIncome && projectedIncomeMinor > 0,
    usedProjectedExpense: !hasRealExpense && projectedExpenseMinor > 0,
    usedProjectedLiability: !hasRealLiability && projectedLiabilityMinor > 0,
    installmentDebtBRL: minorToBRL(installmentDebtMinor),
    categoryBreakdown: categoryBreakdown.map((item) => ({
      categoryId: item.categoryId,
      amountMinor: item.amountMinor,
    })),
    historicalMonths: histSummary,
    openInvoices: invoicesData
      .filter(i => i.status === 'open' || i.status === 'partial')
      .map(i => ({ card: i.institutionName, month: i.invoiceMonth, openMinor: Number(i.openAmountMinor ?? 0), dueDate: i.dueDate })),
    projectedItems: projectedItems.slice(0, 30).map(item => ({
      source: item.source,
      kind: item.kind,
      label: item.label,
      month: item.month,
      amountMinor: item.amountMinor,
      amountBRL: minorToBRL(item.amountMinor),
    })),
  }

  const autoAssessment = buildBudgetAutoAssessment({
    month,
    incomeMinor: realizedIncomeMinor,
    expenseMinor: realizedExpenseMinor,
    liabilityMinor: realizedLiabilityMinor,
    openDebtMinor,
    installmentDebtMinor,
    projectedIncomeMinor,
    projectedExpenseMinor,
    projectedLiabilityMinor,
    consideredIncomeMinor,
    consideredExpenseMinor,
    consideredLiabilityMinor,
    totalCommittedMinor: consideredCommittedMinor,
    availableMinor: consideredAvailableMinor,
    commitmentPct: consideredIncomeMinor > 0 ? Math.round(consideredCommittedMinor / consideredIncomeMinor * 100) : 0,
    categoryBreakdown,
    historicalMonths: histSummary,
    usedProjectedIncome: !hasRealIncome && projectedIncomeMinor > 0,
    usedProjectedExpense: !hasRealExpense && projectedExpenseMinor > 0,
    usedProjectedLiability: !hasRealLiability && projectedLiabilityMinor > 0,
  })

  const aiResult = includeAi
    ? await callAI(systemPrompt, aiPayload).catch(() => autoAssessment)
    : autoAssessment

  res.json({
    month,
    incomeMinor: realizedIncomeMinor,
    expenseMinor: realizedExpenseMinor,
    liabilityMinor: realizedLiabilityMinor,
    openDebtMinor,
    installmentDebtMinor,
    projectedIncomeMinor,
    projectedExpenseMinor,
    projectedLiabilityMinor,
    consideredIncomeMinor,
    consideredExpenseMinor,
    consideredLiabilityMinor,
    totalCommittedMinor: consideredCommittedMinor,
    availableMinor: consideredAvailableMinor,
    categoryBreakdown,
    historicalMonths: histSummary,
    ai: aiResult,
  })
})

// ---------------------------------------------------------------------------
// POST /api/assess/spending
// ---------------------------------------------------------------------------
router.post('/spending', async (req: Request, res: Response) => {
  const { month, categoryId, subcategoryIds, includeAi } = z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    categoryId: z.string().optional(),
    subcategoryIds: z.array(z.string()).optional(),
    includeAi: z.boolean().optional().default(true),
  }).parse(req.body)

  const db = getDatabase()
  const owner = await resolveOwnerId(req.authUser!.clerkUserId)
  if (!categoryId) {
    const overview = await buildSpendingOverview(db, owner.id, month)
    return res.json(overview)
  }

  const selectedCategoryIds = uniqueStrings([categoryId, ...(subcategoryIds ?? [])])

  const histMonths = previousMonths(month, 5)
  const allMonths = [...histMonths, month]

  const statementRows = await db
    .select({
      id: transactions.id,
      amountMinor: transactions.amountMinor,
      description: transactions.description,
      competencyMonth: transactions.competencyMonth,
      categoryId: transactions.categoryId,
    })
    .from(transactions)
    .where(and(
      eq(transactions.userId, owner.id),
      eq(transactions.movementType, 'expense'),
      inArray(transactions.categoryId, selectedCategoryIds),
      inArray(transactions.competencyMonth, allMonths),
    ))
    .orderBy(desc(transactions.amountMinor))
    .limit(300)

  const overallStatementRows = await db
    .select({
      id: transactions.id,
      amountMinor: transactions.amountMinor,
      description: transactions.description,
      competencyMonth: transactions.competencyMonth,
      categoryId: transactions.categoryId,
    })
    .from(transactions)
    .where(and(
      eq(transactions.userId, owner.id),
      eq(transactions.movementType, 'expense'),
      inArray(transactions.competencyMonth, allMonths),
    ))
    .orderBy(desc(transactions.amountMinor))
    .limit(500)

  const invoiceRows = await db
    .select({
      id: cardTransactions.id,
      amountMinor: cardTransactions.amountMinor,
      description: cardTransactions.description,
      competencyMonth: cardTransactions.competencyMonth,
      categoryId: cardTransactions.categoryId,
      invoiceMonth: cardInvoices.invoiceMonth,
    })
    .from(cardTransactions)
    .leftJoin(cardInvoices, eq(cardTransactions.cardInvoiceId, cardInvoices.id))
    .where(and(
      eq(cardTransactions.userId, owner.id),
      eq(cardTransactions.movementType, 'card_purchase'),
      inArray(cardTransactions.categoryId, selectedCategoryIds),
      inArray(cardTransactions.competencyMonth, allMonths),
    ))
    .orderBy(desc(cardTransactions.amountMinor))
    .limit(300)

  const overallInvoiceRows = await db
    .select({
      id: cardTransactions.id,
      amountMinor: cardTransactions.amountMinor,
      description: cardTransactions.description,
      competencyMonth: cardTransactions.competencyMonth,
      categoryId: cardTransactions.categoryId,
    })
    .from(cardTransactions)
    .where(and(
      eq(cardTransactions.userId, owner.id),
      eq(cardTransactions.movementType, 'card_purchase'),
      inArray(cardTransactions.competencyMonth, allMonths),
    ))
    .orderBy(desc(cardTransactions.amountMinor))
    .limit(500)

  const invoiceContext = await db
    .select({
      invoiceMonth: cardInvoices.invoiceMonth,
      dueDate: cardInvoices.dueDate,
      status: cardInvoices.status,
      totalAmountMinor: cardInvoices.totalAmountMinor,
      previousBalanceMinor: cardInvoices.previousBalanceMinor,
      openAmountMinor: cardInvoices.openAmountMinor,
      paidAmountMinor: cardInvoices.paidAmountMinor,
      institutionName: accounts.displayName,
      cardBrand: accounts.cardBrand,
      cardLast4: accounts.cardLast4,
    })
    .from(cardInvoices)
    .leftJoin(accounts, eq(cardInvoices.accountId, accounts.id))
    .where(and(
      eq(cardInvoices.userId, owner.id),
      inArray(cardInvoices.invoiceMonth, allMonths),
    ))
    .orderBy(cardInvoices.invoiceMonth)

  const normalizedInvoiceContext = invoiceContext.map((item) => ({
    ...item,
    totalAmountMinor: item.totalAmountMinor === null ? null : Number(item.totalAmountMinor),
    previousBalanceMinor: item.previousBalanceMinor === null ? null : Number(item.previousBalanceMinor),
    openAmountMinor: item.openAmountMinor === null ? null : Number(item.openAmountMinor),
    paidAmountMinor: item.paidAmountMinor === null ? null : Number(item.paidAmountMinor),
  }))

  const categoryLabels = new Map<string, string>()
  const categoryIdsForLabels = uniqueStrings([
    ...selectedCategoryIds,
    ...overallStatementRows.map((row) => row.categoryId ?? null),
    ...overallInvoiceRows.map((row) => row.categoryId ?? null),
  ])
  if (categoryIdsForLabels.length > 0) {
    const categoriesRows = await db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(inArray(categories.id, categoryIdsForLabels))
    for (const row of categoriesRows) {
      categoryLabels.set(row.id, row.name)
    }
  }

  const currentSubcategoryTotals = new Map<string, number>()
  for (const row of [...statementRows, ...invoiceRows].filter((item) => item.competencyMonth === month)) {
    const categoryId = row.categoryId ?? null
    if (!categoryId || !selectedCategoryIds.includes(categoryId)) continue
    currentSubcategoryTotals.set(categoryId, (currentSubcategoryTotals.get(categoryId) ?? 0) + spendMinor(row.amountMinor))
  }

  const overallCategoryTotals = new Map<string, number>()
  for (const row of [...overallStatementRows, ...overallInvoiceRows].filter((item) => item.competencyMonth === month)) {
    const categoryId = row.categoryId ?? 'sem_categoria'
    overallCategoryTotals.set(categoryId, (overallCategoryTotals.get(categoryId) ?? 0) + spendMinor(row.amountMinor))
  }

  const categoryBreakdown = [...overallCategoryTotals.entries()]
    .map(([categoryId, amountMinor]) => ({
      categoryId,
      label: categoryLabels.get(categoryId) ?? categoryId,
      amountMinor,
      pctOfTotal: 0,
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor)
    .slice(0, 8)

  const overallMonthExpenseMinor = categoryBreakdown.reduce((sum, item) => sum + item.amountMinor, 0)
  for (const item of categoryBreakdown) {
    item.pctOfTotal = overallMonthExpenseMinor > 0
      ? Math.round((item.amountMinor / overallMonthExpenseMinor) * 1000) / 10
      : 0
  }

  const incomeResult = await db
    .select({ total: sql<string>`COALESCE(SUM(${transactions.amountMinor}), 0)` })
    .from(transactions)
    .where(and(
      eq(transactions.userId, owner.id),
      eq(transactions.movementType, 'income'),
      eq(transactions.competencyMonth, month),
    ))

  const incomeMinor = Number(incomeResult[0]?.total ?? 0)

  const monthlySummary = allMonths.map(am => {
    const statementMonth = statementRows.filter(t => t.competencyMonth === am)
    const invoiceMonth = invoiceRows.filter(t => t.competencyMonth === am)
    const statementMinor = statementMonth.reduce((s, t) => s + spendMinor(t.amountMinor), 0)
    const invoiceMinor = invoiceMonth.reduce((s, t) => s + spendMinor(t.amountMinor), 0)
    return {
      month: am,
      statementMinor,
      invoiceMinor,
      totalMinor: statementMinor + invoiceMinor,
      count: statementMonth.length + invoiceMonth.length,
    }
  })

  const currentMinor = monthlySummary.find(m => m.month === month)?.totalMinor ?? 0
  const histData = monthlySummary.filter(m => m.month !== month)
  const avgMinor = histData.length > 0
    ? Math.round(histData.reduce((s, m) => s + m.totalMinor, 0) / histData.length)
    : 0
  const variationPct = avgMinor > 0 ? Math.round((currentMinor - avgMinor) / avgMinor * 100) : 0

  const subcategoryBreakdown = selectedCategoryIds.map((id) => {
    const amountMinor = currentSubcategoryTotals.get(id) ?? 0
    return {
      categoryId: id,
      label: categoryLabels.get(id) ?? id,
      amountMinor,
      pctWithinCategory: currentMinor > 0 ? Math.round((amountMinor / currentMinor) * 1000) / 10 : 0,
      pctOfTotal: overallMonthExpenseMinor > 0 ? Math.round((amountMinor / overallMonthExpenseMinor) * 1000) / 10 : 0,
    }
  }).filter((item) => item.amountMinor > 0)

  const topTxs = [
    ...statementRows.map((t) => ({ source: 'statement' as const, ...t })),
    ...invoiceRows.map((t) => ({ source: 'card_invoice' as const, ...t })),
  ]
    .filter(t => t.competencyMonth === month)
    .sort((a, b) => Number(b.amountMinor) - Number(a.amountMinor))
    .slice(0, 10)
    .map(t => ({ description: t.description, amountMinor: Number(t.amountMinor), source: t.source }))

  const systemPrompt = `Você é um analista financeiro especializado em análise de gastos domésticos brasileiros.
Analise os dados de gastos de uma categoria específica e responda SOMENTE em JSON com este formato exato:
{
  "trend": "crescente",
  "trendDescription": "Frase descrevendo a tendência com dados concretos e valores reais.",
  "riskLevel": "moderado",
  "impactOnIncome": "Frase descrevendo o impacto percentual na renda com valor real.",
  "historicalComparison": "Frase comparando com a média histórica com valores reais.",
  "topSpends": ["Descrição da maior despesa com valor", "Segunda maior despesa com valor"],
  "alerts": ["Alerta específico com valor real 1", "Alerta 2"],
  "recommendations": ["Recomendação acionável 1", "Recomendação 2", "Recomendação 3"]
}
Regras:
- trend: crescente se variação > +15%, decrescente se < -15%, estável caso contrário
- riskLevel: baixo (<10% renda), moderado (10-20%), alto (20-35%), crítico (>35%)
- Todos os campos monetários do payload terminados em \`Minor\` estão em centavos.
- Quando escrever valores em texto, use os campos \`*BRL\` fornecidos ou o formato brasileiro correto com duas casas decimais.
- Nunca omita centavos em valores monetários.
- Recomendações devem ser práticas e acionáveis
- Considere tanto gastos de extrato bancário quanto compras de fatura de cartão
- Responda em português brasileiro`

  const aiPayload = {
    categoryId,
    subcategoryIds: subcategoryIds ?? [],
    currentMonth: month,
    currentMonthMinor: currentMinor,
    currentMonthBRL: minorToBRL(currentMinor),
    averageHistoricalMinor: avgMinor,
    averageHistoricalBRL: minorToBRL(avgMinor),
    variationPct,
    incomeMinor,
    incomeBRL: minorToBRL(incomeMinor),
    impactOnIncomePct: incomeMinor > 0 ? Math.round(currentMinor / incomeMinor * 100) : 0,
    monthlySummary,
    topTransactions: topTxs,
    invoiceContext: normalizedInvoiceContext,
    categoryBreakdown,
    subcategoryBreakdown,
  }

  const aiResult = includeAi ? await callAI(systemPrompt, aiPayload) : null

  res.json({
    categoryId,
    subcategoryIds: subcategoryIds ?? [],
    month,
    currentMonthMinor: currentMinor,
    currentMonthBRL: minorToBRL(currentMinor),
    averageHistoricalMinor: avgMinor,
    averageHistoricalBRL: minorToBRL(avgMinor),
    variationPct,
    incomeMinor,
    incomeBRL: minorToBRL(incomeMinor),
    impactOnIncomePct: incomeMinor > 0 ? Math.round(currentMinor / incomeMinor * 100) : 0,
    monthlySummary,
    topTransactions: topTxs,
    sourceSummary: {
      statementMinor: monthlySummary.find(m => m.month === month)?.statementMinor ?? 0,
      invoiceMinor: monthlySummary.find(m => m.month === month)?.invoiceMinor ?? 0,
    },
    invoiceContext: normalizedInvoiceContext,
    categoryBreakdown,
    subcategoryBreakdown,
    ai: aiResult,
  })
})

// ---------------------------------------------------------------------------
// POST /api/assess/debt
// ---------------------------------------------------------------------------
router.post('/debt', async (req: Request, res: Response) => {
  const { month, projectionMonths } = z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    projectionMonths: z.number().int().min(1).max(6).default(3),
  }).parse(req.body)

  const db = getDatabase()
  const owner = await resolveOwnerId(req.authUser!.clerkUserId)

  const prevMonths3 = previousMonths(month, 3)
  const [y, m] = month.split('-').map(Number)
  const futureMonths: string[] = []
  for (let i = 1; i <= projectionMonths; i++) {
    const d = new Date(Date.UTC(y, m - 1 + i, 1))
    futureMonths.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }

  const allMonthsRange = [...prevMonths3, month, ...futureMonths]

  const [forecastRows, forecastStatusRows] = await Promise.all([
    db
      .select({
        id: cashflowForecasts.id,
        competencyMonth: cashflowForecasts.competencyMonth,
        amountMinor: cashflowForecasts.amountMinor,
        recurrence: cashflowForecasts.recurrence,
        recurrenceEnd: cashflowForecasts.recurrenceEnd,
        description: cashflowForecasts.description,
        isActive: cashflowForecasts.isActive,
      })
      .from(cashflowForecasts)
      .where(eq(cashflowForecasts.userId, owner.id)),
    db
      .select({
        forecastId: cashflowForecastMonthStatus.forecastId,
        competencyMonth: cashflowForecastMonthStatus.competencyMonth,
        isPaid: cashflowForecastMonthStatus.isPaid,
      })
      .from(cashflowForecastMonthStatus)
      .where(eq(cashflowForecastMonthStatus.userId, owner.id)),
  ])

  const paidMonthsByForecastId = new Map<string, Set<string>>()
  for (const row of forecastStatusRows) {
    if (!row.isPaid) continue
    const set = paidMonthsByForecastId.get(row.forecastId) ?? new Set<string>()
    set.add(row.competencyMonth)
    paidMonthsByForecastId.set(row.forecastId, set)
  }

  const forecastIncomeRows = expandForecastsForMonth(
    month,
    forecastRows.map((f) => ({
      ...f,
      amountMinor: toBigIntValue(f.amountMinor),
      recurrence: f.recurrence ?? 'one-time',
      recurrenceEnd: f.recurrenceEnd ?? null,
      description: f.description ?? null,
      isActive: Boolean(f.isActive),
    })),
    paidMonthsByForecastId,
  ).filter((item) => Number(item.amountMinor) > 0)

  const invoicesData = await db
    .select({
      id: cardInvoices.id,
      invoiceMonth: cardInvoices.invoiceMonth,
      dueDate: cardInvoices.dueDate,
      status: cardInvoices.status,
      totalAmountMinor: cardInvoices.totalAmountMinor,
      previousBalanceMinor: cardInvoices.previousBalanceMinor,
      openAmountMinor: cardInvoices.openAmountMinor,
      paidAmountMinor: cardInvoices.paidAmountMinor,
      institutionName: accounts.displayName,
      cardBrand: accounts.cardBrand,
      cardLast4: accounts.cardLast4,
    })
    .from(cardInvoices)
    .leftJoin(accounts, eq(cardInvoices.accountId, accounts.id))
    .where(and(
      eq(cardInvoices.userId, owner.id),
      sql`${cardInvoices.invoiceMonth} IN (${sql.join(allMonthsRange.map(am => sql`${am}`), sql`, `)})`,
    ))
    .orderBy(cardInvoices.invoiceMonth)

  const cardInvoicePurchases = await db
    .select({
      cardInvoiceId: cardTransactions.cardInvoiceId,
      totalMinor: sql<string>`COALESCE(SUM(${cardTransactions.amountMinor}), 0)`,
    })
    .from(cardTransactions)
    .where(eq(cardTransactions.userId, owner.id))
    .groupBy(cardTransactions.cardInvoiceId)

  const purchasesByInvoiceId = new Map<number, number>()
  for (const row of cardInvoicePurchases) {
    if (row.cardInvoiceId == null) continue
    purchasesByInvoiceId.set(Number(row.cardInvoiceId), Number(row.totalMinor))
  }

  const invoiceSummaryRows = invoicesData.map((i) => ({
    ...i,
    totalMinor: Number(i.totalAmountMinor ?? 0),
    previousMinor: Number(i.previousBalanceMinor ?? 0),
    paidMinor: Number(i.paidAmountMinor ?? 0),
    openMinor: Number(i.openAmountMinor ?? 0),
    purchasesMinor: purchasesByInvoiceId.get(Number(i.id)) ?? 0,
  }))

  const liabilityPaymentRows = await db
    .select({
      amountMinor: transactions.amountMinor,
      description: transactions.description,
      competencyMonth: transactions.competencyMonth,
    })
    .from(transactions)
    .where(and(
      eq(transactions.userId, owner.id),
      eq(transactions.movementType, 'liability_payment'),
      eq(transactions.competencyMonth, month),
    ))
    .orderBy(desc(transactions.amountMinor))

  // Busca TODAS as parcelas do utilizador (igual ao CashFlowEngine).
  // A projeção de meses futuros é feita por cálculo — os registos dos meses
  // futuros ainda não existem no banco (fatura não importada), por isso a
  // query anterior (competencyMonth IN futureMonths) sempre retornava zero.
  const addM = (base: string, offset: number): string => {
    const [y, mo] = base.split('-').map(Number)
    const d = new Date(Date.UTC(y, mo - 1 + offset, 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  }
  const allInstallmentTxsRaw = await db
    .select({
      id: cardTransactions.id,
      description: cardTransactions.description,
      amountMinor: cardTransactions.amountMinor,
      installmentNumber: cardTransactions.installmentNumber,
      installmentTotal: cardTransactions.installmentTotal,
      competencyMonth: cardTransactions.competencyMonth,
    })
    .from(cardTransactions)
    .where(and(
      eq(cardTransactions.userId, owner.id),
      sql`${cardTransactions.installmentNumber} IS NOT NULL`,
      sql`${cardTransactions.installmentTotal} IS NOT NULL`,
      sql`CAST(${cardTransactions.installmentTotal} AS UNSIGNED) > CAST(${cardTransactions.installmentNumber} AS UNSIGNED)`,
    ))
    .limit(500)
  // Projectar parcelas restantes nos meses futuros (mesma lógica do CashFlowEngine)
  type ProjectedInstallment = {
    description: string | null
    amountMinor: number
    installmentNumber: number
    installmentTotal: number
    competencyMonth: string
    projectedMonth: string
  }
  const installmentTxs: ProjectedInstallment[] = allInstallmentTxsRaw.flatMap((tx) => {
    const n = Number(tx.installmentNumber ?? 0)
    const t = Number(tx.installmentTotal ?? 0)
    if (t <= 0 || n <= 0 || t <= n) return []
    const baseMonth = tx.competencyMonth
    const rows: ProjectedInstallment[] = []
    for (let step = 1; step <= (t - n); step++) {
      const projectedMonth = addM(baseMonth, step)
      if (!futureMonths.includes(projectedMonth)) continue
      rows.push({
        description: tx.description,
        amountMinor: Number(tx.amountMinor),
        installmentNumber: n + step,
        installmentTotal: t,
        competencyMonth: baseMonth,
        projectedMonth,
      })
    }
    return rows
  })

  const incomeResult = await db
    .select({ total: sql<string>`COALESCE(SUM(${transactions.amountMinor}), 0)` })
    .from(transactions)
    .where(and(
      eq(transactions.userId, owner.id),
      eq(transactions.movementType, 'income'),
      eq(transactions.competencyMonth, month),
    ))

  const incomeMinor = Number(incomeResult[0]?.total ?? 0)
  const projectedIncomeMinor = forecastIncomeRows.reduce((s, row) => s + Number(row.amountMinor), 0)
  const consideredIncomeMinor = incomeMinor > 0 ? incomeMinor : projectedIncomeMinor
  const usedProjectedIncome = incomeMinor <= 0 && projectedIncomeMinor > 0

  const paidThisMonthFromStatementMinor = liabilityPaymentRows
    .reduce((s, row) => s + spendMinor(row.amountMinor), 0)

  const paidThisMonthMinor = paidThisMonthFromStatementMinor

  const statementExpenseResult = await db
    .select({ total: sql<string>`COALESCE(SUM(${transactions.amountMinor}), 0)` })
    .from(transactions)
    .where(and(
      eq(transactions.userId, owner.id),
      eq(transactions.movementType, 'expense'),
      eq(transactions.competencyMonth, month),
    ))

  const statementExpenseMinor = Number(statementExpenseResult[0]?.total ?? 0)
  const statementOutflowMinor = statementExpenseMinor + paidThisMonthFromStatementMinor

  const futureInstallmentsMinor = installmentTxs
    .reduce((s, t) => s + Number(t.amountMinor), 0)

  const liabilityHistoryRows = await db
    .select({
      competencyMonth: transactions.competencyMonth,
      amountMinor: transactions.amountMinor,
    })
    .from(transactions)
    .where(and(
      eq(transactions.userId, owner.id),
      eq(transactions.movementType, 'liability_payment'),
      lte(transactions.competencyMonth, month),
    ))
    .orderBy(transactions.competencyMonth)

  const remainingByMonth = new Map<string, number>()
  for (const row of liabilityHistoryRows) {
    const paymentMonth = row.competencyMonth
    const value = spendMinor(row.amountMinor)
    remainingByMonth.set(paymentMonth, (remainingByMonth.get(paymentMonth) ?? 0) + value)
  }

  const addMonthsLocal = (base: string, offset: number) => {
    const [yearPart, monthPart] = base.split('-').map(Number)
    const d = new Date(Date.UTC(yearPart, monthPart - 1 + offset, 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  }

  const invoiceDueMonth = (invoiceDate: Date | string | null | undefined) => {
    if (!invoiceDate) return month
    if (invoiceDate instanceof Date) {
      return `${invoiceDate.getUTCFullYear()}-${String(invoiceDate.getUTCMonth() + 1).padStart(2, '0')}`
    }
    return String(invoiceDate).slice(0, 7)
  }

  const effectiveInvoiceRows = [...invoiceSummaryRows]
    .sort((a, b) => invoiceDueMonth(a.dueDate).localeCompare(invoiceDueMonth(b.dueDate)))
    .map((invoice) => {
      const dueMonth = invoiceDueMonth(invoice.dueDate)
      const totalMinor = invoice.totalMinor
      let effectivePaidMinor = invoice.paidMinor
      const paymentMonths = [...remainingByMonth.keys()].sort()
      const latestPaymentMonth = addMonthsLocal(dueMonth, 2)

      if (effectivePaidMinor < totalMinor) {
        for (const paymentMonth of paymentMonths) {
          if (paymentMonth < dueMonth) continue
          if (paymentMonth > latestPaymentMonth || paymentMonth > month) break
          const available = remainingByMonth.get(paymentMonth) ?? 0
          if (available <= 0) continue
          const remaining = totalMinor - effectivePaidMinor
          if (remaining <= 0) break
          const allocation = available < remaining ? available : remaining
          effectivePaidMinor += allocation
          remainingByMonth.set(paymentMonth, available - allocation)
          if (effectivePaidMinor >= totalMinor) break
        }
      }

      const effectiveOpenMinor = effectivePaidMinor >= totalMinor ? 0 : totalMinor - effectivePaidMinor
      return {
        ...invoice,
        dueMonth,
        paidMinor: effectivePaidMinor,
        openMinor: effectiveOpenMinor,
      }
    })

  const paidAllocatedToPreviousInvoiceMinor = effectiveInvoiceRows
    .filter((i) => i.invoiceMonth < month)
    .reduce((s, i) => s + i.paidMinor, 0)

  const forecastWindowRows = expandForecastsForMonth(
    month,
    forecastRows.map((f) => ({
      ...f,
      amountMinor: toBigIntValue(f.amountMinor),
      recurrence: f.recurrence ?? 'one-time',
      recurrenceEnd: f.recurrenceEnd ?? null,
      description: f.description ?? null,
      isActive: Boolean(f.isActive),
    })),
    paidMonthsByForecastId,
  )

  const pendingCashflowForecasts = forecastWindowRows.map((row) => ({
    description: row.description ?? null,
    amountMinor: Number(row.amountMinor),
    amountBRL: minorToBRL(Number(row.amountMinor)),
    kind: Number(row.amountMinor) >= 0 ? 'income' : 'expense',
    month: row.competencyMonth,
  }))

  const selectedMonthRawCardDebtMinor = invoiceSummaryRows
    .filter((invoice) => invoice.invoiceMonth === month)
    .reduce((sum, invoice) => sum + Number(invoice.totalMinor ?? 0), 0)

  const selectedMonthEffectiveOpenDebtMinor = effectiveInvoiceRows
    .filter((invoice) => invoice.invoiceMonth === month)
    .reduce((sum, invoice) => sum + Number(invoice.openMinor ?? 0), 0)

  const currentUtcMonth = (() => {
    const now = new Date()
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
  })()

  const useRawCurrentMonthCardTotals = month >= currentUtcMonth
  const cardDebtMinor = useRawCurrentMonthCardTotals
    ? selectedMonthRawCardDebtMinor
    : selectedMonthEffectiveOpenDebtMinor

  const pendingCashflowExpenseMinor = pendingCashflowForecasts
    .filter((forecast) => forecast.kind === 'expense')
    .reduce((sum, forecast) => sum + Math.abs(Number(forecast.amountMinor ?? 0)), 0)

  const openDebtMinor = cardDebtMinor + pendingCashflowExpenseMinor
  const totalDebtExposureMinor = openDebtMinor + futureInstallmentsMinor

  const currentMonthInvoiceBreakdown = invoiceSummaryRows
    .filter((invoice) => invoice.invoiceMonth === month)
    .map((invoice) => ({
      card: invoice.institutionName,
      previousMinor: Number(invoice.previousMinor ?? 0),
      previousBRL: minorToBRL(Number(invoice.previousMinor ?? 0)),
      paidMinor: Number(invoice.paidMinor ?? 0),
      paidBRL: minorToBRL(Number(invoice.paidMinor ?? 0)),
      purchasesMinor: Number(invoice.purchasesMinor ?? 0),
      purchasesBRL: minorToBRL(Number(invoice.purchasesMinor ?? 0)),
      totalMinor: Number(invoice.totalMinor ?? 0),
      totalBRL: minorToBRL(Number(invoice.totalMinor ?? 0)),
      openMinor: Number(invoice.openMinor ?? 0),
      openBRL: minorToBRL(Number(invoice.openMinor ?? 0)),
      dueDate: invoice.dueDate,
    }))

  const historicalInvoices = effectiveInvoiceRows.filter(i => prevMonths3.includes(i.invoiceMonth))
  const paidOnTime = historicalInvoices.filter(i => i.openMinor === 0).length
  const punctualityPct = historicalInvoices.length > 0
    ? Math.round(paidOnTime / historicalInvoices.length * 100)
    : 100

  const systemPrompt = `Você é um especialista em gestão de dívidas e finanças pessoais brasileiras.
Analise os dados de dívidas e faturas do usuário e responda SOMENTE em JSON com este formato exato:
{
  "riskLevel": "moderado",
  "debtPressurePct": 35,
  "delayRisk": "baixo",
  "delayRiskReason": "Frase explicando o risco de atraso com dados concretos.",
  "diagnosis": "Parágrafo de 2-3 frases sobre a situação de dívidas com valores e datas reais.",
  "criticalDates": ["2026-06-10 — Fatura Itaú R$ 1.200,00"],
  "alerts": ["Alerta específico com valor real 1", "Alerta 2"],
  "recommendations": ["Recomendação acionável 1", "Recomendação 2", "Recomendação 3"]
}
Regras:
- riskLevel: baixo (<20% renda), moderado (20-40%), alto (40-60%), crítico (>60%)
- delayRisk: baseado na pontualidade histórica e no volume de dívidas abertas
- Se não há dívidas abertas, riskLevel = "baixo" e celebre a situação positiva
- Todos os campos monetários do payload terminados em \`Minor\` estão em centavos.
- Use sempre os campos \`*BRL\` para escrever valores na análise.
- Nunca escreva valores sem centavos.
- Formato monetário obrigatório: \`R$ 1.234,56\`
- Se a renda real do mês ainda não apareceu no extrato, use a renda prevista e diga explicitamente que ela ainda é previsão.
- Para a competência selecionada, considere como dívida corrente o total bruto da fatura do mês (\`cashflowInvoicesSummary.totalMinor\`); pagamentos alocados à fatura anterior são histórico e não reduzem a competência corrente.
- Sempre cite explicitamente todas as faturas da competência selecionada; não omita nenhuma linha do Banco do Brasil, Itaú ou qualquer outro cartão presente em \`currentMonthInvoiceBreakdown\`.
- Para a leitura de dívidas, considere também o gasto do mês no extrato e as projeções pendentes do Fluxo de caixa que ainda não foram marcadas como pagas.
- Pagamentos alocados à fatura anterior aparecem em \`paidAllocatedToPreviousInvoiceMinor\` e não devem ser somados como pagamento do mês atual.
- O campo \`paidThisMonthMinor\` já representa apenas o que saiu no extrato no mês selecionado; não some novamente pagamentos históricos das faturas.
- Cite valores e datas reais em todos os campos
- Responda em português brasileiro`

  const aiPayload = {
    currentMonth: month,
    incomeMinor,
    incomeBRL: minorToBRL(incomeMinor),
    projectedIncomeMinor,
    projectedIncomeBRL: minorToBRL(projectedIncomeMinor),
    consideredIncomeMinor,
    consideredIncomeBRL: minorToBRL(consideredIncomeMinor),
    usedProjectedIncome,
    statementExpenseMinor,
    statementExpenseBRL: minorToBRL(statementExpenseMinor),
    statementOutflowMinor,
    statementOutflowBRL: minorToBRL(statementOutflowMinor),
    openDebtMinor,
    openDebtBRL: minorToBRL(openDebtMinor),
    paidThisMonthMinor,
    paidThisMonthBRL: minorToBRL(paidThisMonthMinor),
    paidAllocatedToPreviousInvoiceMinor,
    paidAllocatedToPreviousInvoiceBRL: minorToBRL(paidAllocatedToPreviousInvoiceMinor),
    paidThisMonthFromStatementMinor,
    paidThisMonthFromStatementBRL: minorToBRL(paidThisMonthFromStatementMinor),
    futureInstallmentsMinor,
    futureInstallmentsBRL: minorToBRL(futureInstallmentsMinor),
    totalDebtExposureMinor,
    totalDebtExposureBRL: minorToBRL(totalDebtExposureMinor),
    debtPressurePct: consideredIncomeMinor > 0 ? Math.round(totalDebtExposureMinor / consideredIncomeMinor * 100) : 0,
    punctualityPct,
    currentMonthInvoiceBreakdown,
    invoicesSummary: effectiveInvoiceRows.map(i => ({
      month: i.invoiceMonth,
      card: i.institutionName,
      status: i.openMinor > 0 ? 'open' : 'paid',
      totalMinor: i.totalMinor,
      totalBRL: minorToBRL(i.totalMinor),
      previousMinor: i.previousMinor,
      previousBRL: minorToBRL(i.previousMinor),
      purchasesMinor: i.purchasesMinor ?? 0,
      purchasesBRL: minorToBRL(i.purchasesMinor ?? 0),
      openMinor: i.openMinor,
      openBRL: minorToBRL(i.openMinor),
      paidMinor: i.paidMinor,
      paidBRL: minorToBRL(i.paidMinor),
      dueDate: i.dueDate,
    })),
    cashflowInvoicesSummary: invoiceSummaryRows.map(i => ({
      id: i.id,
      month: i.invoiceMonth,
      card: i.institutionName,
      brand: i.cardBrand,
      last4: i.cardLast4,
      previousMinor: i.previousMinor,
      previousBRL: minorToBRL(i.previousMinor),
      purchasesMinor: i.purchasesMinor,
      purchasesBRL: minorToBRL(i.purchasesMinor),
      totalMinor: i.totalMinor,
      totalBRL: minorToBRL(i.totalMinor),
      paidMinor: i.paidMinor,
      paidBRL: minorToBRL(i.paidMinor),
      openMinor: i.openMinor,
      openBRL: minorToBRL(i.openMinor),
      dueDate: i.dueDate,
    })),
    pendingCashflowForecasts,
    futureInstallments: installmentTxs.slice(0, 20).map(t => ({
      description: t.description,
      amountMinor: Number(t.amountMinor),
      amountBRL: minorToBRL(Number(t.amountMinor)),
      installment: t.installmentNumber && t.installmentTotal ? `${t.installmentNumber}/${t.installmentTotal}` : null,
      month: t.projectedMonth,
    })),
  }

  const aiResult = await callAI(systemPrompt, aiPayload)

  res.json({
    month,
    incomeMinor,
    incomeBRL: minorToBRL(incomeMinor),
    projectedIncomeMinor,
    projectedIncomeBRL: minorToBRL(projectedIncomeMinor),
    consideredIncomeMinor,
    consideredIncomeBRL: minorToBRL(consideredIncomeMinor),
    usedProjectedIncome,
    statementExpenseMinor,
    statementExpenseBRL: minorToBRL(statementExpenseMinor),
    statementOutflowMinor,
    statementOutflowBRL: minorToBRL(statementOutflowMinor),
    openDebtMinor,
    openDebtBRL: minorToBRL(openDebtMinor),
    paidThisMonthMinor,
    paidThisMonthBRL: minorToBRL(paidThisMonthMinor),
    paidAllocatedToPreviousInvoiceMinor,
    paidAllocatedToPreviousInvoiceBRL: minorToBRL(paidAllocatedToPreviousInvoiceMinor),
    paidThisMonthFromStatementMinor,
    paidThisMonthFromStatementBRL: minorToBRL(paidThisMonthFromStatementMinor),
    futureInstallmentsMinor,
    futureInstallmentsBRL: minorToBRL(futureInstallmentsMinor),
    totalDebtExposureMinor,
    totalDebtExposureBRL: minorToBRL(totalDebtExposureMinor),
    debtPressurePct: consideredIncomeMinor > 0 ? Math.round(totalDebtExposureMinor / consideredIncomeMinor * 100) : 0,
    punctualityPct,
    invoiceCount: invoicesData.length,
    openInvoiceCount: effectiveInvoiceRows.filter(i => i.openMinor > 0).length,
    currentMonthInvoiceBreakdown,
    invoicesSummary: effectiveInvoiceRows.map(i => ({
      id: i.id,
      month: i.invoiceMonth,
      card: i.institutionName,
      brand: i.cardBrand,
      last4: i.cardLast4,
      status: i.status,
      totalMinor: i.totalMinor,
      totalBRL: minorToBRL(i.totalMinor),
      previousMinor: i.previousMinor,
      previousBRL: minorToBRL(i.previousMinor),
      purchasesMinor: i.purchasesMinor ?? 0,
      purchasesBRL: minorToBRL(i.purchasesMinor ?? 0),
      openMinor: i.openMinor,
      openBRL: minorToBRL(i.openMinor),
      paidMinor: i.paidMinor,
      paidBRL: minorToBRL(i.paidMinor),
      dueDate: i.dueDate,
    })),
    cashflowInvoicesSummary: invoiceSummaryRows.map(i => ({
      id: i.id,
      month: i.invoiceMonth,
      card: i.institutionName,
      brand: i.cardBrand,
      last4: i.cardLast4,
      previousMinor: i.previousMinor,
      previousBRL: minorToBRL(i.previousMinor),
      purchasesMinor: i.purchasesMinor,
      purchasesBRL: minorToBRL(i.purchasesMinor),
      totalMinor: i.totalMinor,
      totalBRL: minorToBRL(i.totalMinor),
      paidMinor: i.paidMinor,
      paidBRL: minorToBRL(i.paidMinor),
      openMinor: i.openMinor,
      openBRL: minorToBRL(i.openMinor),
      dueDate: i.dueDate,
    })),
    pendingCashflowForecasts,
    futureInstallments: installmentTxs.slice(0, 20).map(t => ({
      description: t.description,
      amountMinor: Number(t.amountMinor),
      amountBRL: minorToBRL(Number(t.amountMinor)),
      installment: t.installmentNumber && t.installmentTotal ? `${t.installmentNumber}/${t.installmentTotal}` : null,
      month: t.projectedMonth,
    })),
    ai: aiResult,
  })
})

export { router as assessRouter }

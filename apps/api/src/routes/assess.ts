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
import { transactions, accounts, cardInvoices, cardTransactions } from '@previa/db'
import { and, eq, gte, lte, sql, desc } from 'drizzle-orm'
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
        { role: 'user', content: JSON.stringify(userPayload) },
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
  const { month } = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).parse(req.body)
  const db = getDatabase()
  const ownerId = await resolveOwnerId(req)

  const userAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.externalOwnerId, ownerId))

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
      eq(transactions.externalOwnerId, ownerId),
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
      eq(transactions.externalOwnerId, ownerId),
      sql`${transactions.competencyMonth} IN (${sql.join(prevMonths.map(pm => sql`${pm}`), sql`, `)})`,
    ))

  const invoicesData = await db
    .select({
      invoiceMonth: cardInvoices.invoiceMonth,
      dueDate: cardInvoices.dueDate,
      status: cardInvoices.status,
      totalAmountMinor: cardInvoices.totalAmountMinor,
      openAmountMinor: cardInvoices.openAmountMinor,
      paidAmountMinor: cardInvoices.paidAmountMinor,
      institutionName: accounts.name,
    })
    .from(cardInvoices)
    .leftJoin(accounts, eq(cardInvoices.accountId, accounts.id))
    .where(and(
      eq(cardInvoices.externalOwnerId, ownerId),
      gte(cardInvoices.invoiceMonth, prevMonths[0]),
      lte(cardInvoices.invoiceMonth, month),
    ))

  const incomeMinor = monthTransactions
    .filter(t => t.type === 'income')
    .reduce((s, t) => s + Number(t.amountMinor), 0)

  const expenseMinor = monthTransactions
    .filter(t => t.type === 'expense')
    .reduce((s, t) => s + Number(t.amountMinor), 0)

  const liabilityMinor = monthTransactions
    .filter(t => t.type === 'liability_payment')
    .reduce((s, t) => s + Number(t.amountMinor), 0)

  const openDebtMinor = invoicesData
    .filter(i => i.status === 'open' || i.status === 'partial')
    .reduce((s, i) => s + Number(i.openAmountMinor ?? 0), 0)

  const byCat: Record<string, number> = {}
  for (const t of monthTransactions.filter(t => t.type === 'expense')) {
    const cat = t.categoryId ?? 'sem_categoria'
    byCat[cat] = (byCat[cat] ?? 0) + Number(t.amountMinor)
  }

  const histSummary = prevMonths.map(pm => {
    const mTxs = histTransactions.filter(t => t.competencyMonth === pm)
    return {
      month: pm,
      incomeMinor: mTxs.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amountMinor), 0),
      expenseMinor: mTxs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amountMinor), 0),
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
- availableMinor = renda - gastos - dívidas em aberto (pode ser negativo)
- commitmentPct = (gastos + dívidas) / renda * 100
- riskLevel: baixo (<50%), moderado (50-70%), alto (70-90%), crítico (>90%)
- diagnosis deve citar valores reais e comparar com histórico
- recommendations devem ser acionáveis e específicas, nunca genéricas
- Responda em português brasileiro`

  const aiPayload = {
    currentMonth: month,
    incomeMinor,
    expenseMinor,
    liabilityPaymentMinor: liabilityMinor,
    openDebtMinor,
    totalCommittedMinor: expenseMinor + liabilityMinor + openDebtMinor,
    categoryBreakdown: Object.entries(byCat)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([cat, amt]) => ({ categoryId: cat, amountMinor: amt })),
    historicalMonths: histSummary,
    openInvoices: invoicesData
      .filter(i => i.status === 'open' || i.status === 'partial')
      .map(i => ({ card: i.institutionName, month: i.invoiceMonth, openMinor: Number(i.openAmountMinor ?? 0), dueDate: i.dueDate })),
  }

  const aiResult = await callAI(systemPrompt, aiPayload)

  const categoryBreakdown = Object.entries(byCat)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([cat, amt]) => ({
      categoryId: cat,
      amountMinor: amt,
      pctOfIncome: incomeMinor > 0 ? Math.round(amt / incomeMinor * 100) : 0,
    }))

  res.json({
    month,
    incomeMinor,
    expenseMinor,
    liabilityMinor,
    openDebtMinor,
    totalCommittedMinor: expenseMinor + liabilityMinor + openDebtMinor,
    categoryBreakdown,
    historicalMonths: histSummary,
    ai: aiResult,
  })
})

// ---------------------------------------------------------------------------
// POST /api/assess/spending
// ---------------------------------------------------------------------------
router.post('/spending', async (req: Request, res: Response) => {
  const { month, categoryId } = z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    categoryId: z.string(),
  }).parse(req.body)

  const db = getDatabase()
  const ownerId = await resolveOwnerId(req)

  const histMonths = previousMonths(month, 5)
  const allMonths = [...histMonths, month]

  const catTransactions = await db
    .select({
      id: transactions.id,
      amountMinor: transactions.amountMinor,
      description: transactions.description,
      competencyMonth: transactions.competencyMonth,
    })
    .from(transactions)
    .where(and(
      eq(transactions.externalOwnerId, ownerId),
      eq(transactions.movementType, 'expense'),
      eq(transactions.categoryId, categoryId),
      sql`${transactions.competencyMonth} IN (${sql.join(allMonths.map(am => sql`${am}`), sql`, `)})`,
    ))
    .orderBy(desc(transactions.amountMinor))
    .limit(300)

  const incomeResult = await db
    .select({ total: sql<string>`COALESCE(SUM(${transactions.amountMinor}), 0)` })
    .from(transactions)
    .where(and(
      eq(transactions.externalOwnerId, ownerId),
      eq(transactions.movementType, 'income'),
      eq(transactions.competencyMonth, month),
    ))

  const incomeMinor = Number(incomeResult[0]?.total ?? 0)

  const monthlySummary = allMonths.map(am => {
    const mTxs = catTransactions.filter(t => t.competencyMonth === am)
    return { month: am, totalMinor: mTxs.reduce((s, t) => s + Number(t.amountMinor), 0), count: mTxs.length }
  })

  const currentMinor = monthlySummary.find(m => m.month === month)?.totalMinor ?? 0
  const histData = monthlySummary.filter(m => m.month !== month)
  const avgMinor = histData.length > 0
    ? Math.round(histData.reduce((s, m) => s + m.totalMinor, 0) / histData.length)
    : 0
  const variationPct = avgMinor > 0 ? Math.round((currentMinor - avgMinor) / avgMinor * 100) : 0

  const topTxs = catTransactions
    .filter(t => t.competencyMonth === month)
    .sort((a, b) => Number(b.amountMinor) - Number(a.amountMinor))
    .slice(0, 10)
    .map(t => ({ description: t.description, amountMinor: Number(t.amountMinor) }))

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
- Cite os números reais em todos os campos
- Recomendações devem ser práticas e acionáveis
- Responda em português brasileiro`

  const aiPayload = {
    categoryId,
    currentMonth: month,
    currentMonthMinor: currentMinor,
    averageHistoricalMinor: avgMinor,
    variationPct,
    incomeMinor,
    impactOnIncomePct: incomeMinor > 0 ? Math.round(currentMinor / incomeMinor * 100) : 0,
    monthlySummary,
    topTransactions: topTxs,
  }

  const aiResult = await callAI(systemPrompt, aiPayload)

  res.json({
    categoryId,
    month,
    currentMonthMinor: currentMinor,
    averageHistoricalMinor: avgMinor,
    variationPct,
    incomeMinor,
    impactOnIncomePct: incomeMinor > 0 ? Math.round(currentMinor / incomeMinor * 100) : 0,
    monthlySummary,
    topTransactions: topTxs,
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
  const ownerId = await resolveOwnerId(req)

  const prevMonths3 = previousMonths(month, 3)
  const [y, m] = month.split('-').map(Number)
  const futureMonths: string[] = []
  for (let i = 1; i <= projectionMonths; i++) {
    const d = new Date(Date.UTC(y, m - 1 + i, 1))
    futureMonths.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }

  const allMonthsRange = [...prevMonths3, month, ...futureMonths]

  const invoicesData = await db
    .select({
      invoiceMonth: cardInvoices.invoiceMonth,
      dueDate: cardInvoices.dueDate,
      status: cardInvoices.status,
      totalAmountMinor: cardInvoices.totalAmountMinor,
      openAmountMinor: cardInvoices.openAmountMinor,
      paidAmountMinor: cardInvoices.paidAmountMinor,
      institutionName: accounts.name,
      cardBrand: accounts.cardBrand,
      cardLast4: accounts.cardLast4,
    })
    .from(cardInvoices)
    .leftJoin(accounts, eq(cardInvoices.accountId, accounts.id))
    .where(and(
      eq(cardInvoices.externalOwnerId, ownerId),
      sql`${cardInvoices.invoiceMonth} IN (${sql.join(allMonthsRange.map(am => sql`${am}`), sql`, `)})`,
    ))
    .orderBy(cardInvoices.invoiceMonth)

  const installmentTxs = await db
    .select({
      description: cardTransactions.description,
      amountMinor: cardTransactions.amountMinor,
      installment: cardTransactions.installment,
      competencyMonth: cardTransactions.competencyMonth,
    })
    .from(cardTransactions)
    .where(and(
      eq(cardTransactions.externalOwnerId, ownerId),
      sql`${cardTransactions.competencyMonth} IN (${sql.join(futureMonths.map(fm => sql`${fm}`), sql`, `)})`,
      sql`${cardTransactions.installment} IS NOT NULL AND ${cardTransactions.installment} != ''`,
    ))
    .orderBy(cardTransactions.competencyMonth)
    .limit(200)

  const incomeResult = await db
    .select({ total: sql<string>`COALESCE(SUM(${transactions.amountMinor}), 0)` })
    .from(transactions)
    .where(and(
      eq(transactions.externalOwnerId, ownerId),
      eq(transactions.movementType, 'income'),
      eq(transactions.competencyMonth, month),
    ))

  const incomeMinor = Number(incomeResult[0]?.total ?? 0)

  const openDebtMinor = invoicesData
    .filter(i => i.status === 'open' || i.status === 'partial')
    .reduce((s, i) => s + Number(i.openAmountMinor ?? 0), 0)

  const paidThisMonthMinor = invoicesData
    .filter(i => i.invoiceMonth === month)
    .reduce((s, i) => s + Number(i.paidAmountMinor ?? 0), 0)

  const futureInstallmentsMinor = installmentTxs
    .reduce((s, t) => s + Number(t.amountMinor), 0)

  const historicalInvoices = invoicesData.filter(i => prevMonths3.includes(i.invoiceMonth))
  const paidOnTime = historicalInvoices.filter(i => i.status === 'paid').length
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
- Cite valores e datas reais em todos os campos
- Responda em português brasileiro`

  const aiPayload = {
    currentMonth: month,
    incomeMinor,
    openDebtMinor,
    paidThisMonthMinor,
    futureInstallmentsMinor,
    debtPressurePct: incomeMinor > 0 ? Math.round(openDebtMinor / incomeMinor * 100) : 0,
    punctualityPct,
    invoicesSummary: invoicesData.map(i => ({
      month: i.invoiceMonth,
      card: i.institutionName,
      status: i.status,
      totalMinor: Number(i.totalAmountMinor ?? 0),
      openMinor: Number(i.openAmountMinor ?? 0),
      paidMinor: Number(i.paidAmountMinor ?? 0),
      dueDate: i.dueDate,
    })),
    futureInstallments: installmentTxs.slice(0, 20).map(t => ({
      description: t.description,
      amountMinor: Number(t.amountMinor),
      installment: t.installment,
      month: t.competencyMonth,
    })),
  }

  const aiResult = await callAI(systemPrompt, aiPayload)

  res.json({
    month,
    incomeMinor,
    openDebtMinor,
    paidThisMonthMinor,
    futureInstallmentsMinor,
    debtPressurePct: incomeMinor > 0 ? Math.round(openDebtMinor / incomeMinor * 100) : 0,
    punctualityPct,
    invoiceCount: invoicesData.length,
    openInvoiceCount: invoicesData.filter(i => i.status === 'open' || i.status === 'partial').length,
    invoicesSummary: invoicesData.map(i => ({
      month: i.invoiceMonth,
      card: i.institutionName,
      brand: i.cardBrand,
      last4: i.cardLast4,
      status: i.status,
      totalMinor: Number(i.totalAmountMinor ?? 0),
      openMinor: Number(i.openAmountMinor ?? 0),
      paidMinor: Number(i.paidAmountMinor ?? 0),
      dueDate: i.dueDate,
    })),
    futureInstallments: installmentTxs.slice(0, 20).map(t => ({
      description: t.description,
      amountMinor: Number(t.amountMinor),
      installment: t.installment,
      month: t.competencyMonth,
    })),
    ai: aiResult,
  })
})

export { router as assessRouter }

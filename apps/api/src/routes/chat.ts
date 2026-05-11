/**
 * routes/chat.ts — Previa Bot: Chat Contextual Financeiro
 *
 * Endpoint:
 *   POST /api/chat
 *
 * Contrato de entrada:
 *   { message: string, month?: string, history?: ChatMessage[] }
 *
 * Contrato de saída:
 *   { reply: string, contextUsed: string[], month: string }
 *
 * Regras:
 * - Sem memória persistida: o histórico é enviado pelo cliente a cada mensagem
 * - O contexto financeiro é buscado por mensagem, apenas o necessário
 * - Histórico limitado a 10 turnos para controlar custo e latência
 * - Resposta em texto livre (não JSON estruturado)
 */
import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { transactions, cardInvoices, cardTransactions, cashflowForecasts } from '@previa/db'
import { and, eq, gte, lte, sql, desc } from 'drizzle-orm'
import { getDatabase } from '../config/database.js'
import { resolveOwnerId } from '../services/ownerStore.js'
import { requireClerkAuth } from '../middlewares/auth.js'
import { config } from '../config/env.js'

const router: Router = Router()
router.use(requireClerkAuth)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function currentMonth(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

function previousMonths(base: string, count: number): string[] {
  const [y, m] = base.split('-').map(Number)
  const months: string[] = []
  for (let i = count; i >= 1; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

function minorToBRL(v: number | bigint): string {
  const n = typeof v === 'bigint' ? Number(v) : v
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n / 100)
}

function spendMinor(v: number | bigint): number {
  return Math.abs(typeof v === 'bigint' ? Number(v) : v)
}

// ---------------------------------------------------------------------------
// Classificador de intenção: decide quais dados buscar
// ---------------------------------------------------------------------------
type Intent =
  | 'budget'       // orçamento, sobra, renda, gastos
  | 'debt'         // dívidas, faturas, parcelas
  | 'spending'     // gastos por categoria, onde estou gastando
  | 'cashflow'     // fluxo de caixa, previsões
  | 'general'      // pergunta genérica, sem dados específicos

function classifyIntent(message: string): Intent {
  const lower = message.toLowerCase()
  const debtKeywords = ['dívida', 'divida', 'fatura', 'parcela', 'cartão', 'cartao', 'crédito', 'credito', 'atraso', 'vencimento', 'devo', 'dívidas']
  const spendKeywords = ['gastei', 'gastando', 'gasto', 'categoria', 'alimentação', 'alimentacao', 'transporte', 'lazer', 'onde estou', 'quanto gastei']
  const cashflowKeywords = ['fluxo', 'previsão', 'previsao', 'projeção', 'projecao', 'próximo mês', 'proximo mes', 'futuro', 'entrada', 'saída', 'saida']
  const budgetKeywords = ['orçamento', 'orcamento', 'sobra', 'renda', 'salário', 'salario', 'disponível', 'disponivel', 'posso gastar', 'quanto tenho', 'saldo', 'déficit', 'deficit']

  if (debtKeywords.some(k => lower.includes(k))) return 'debt'
  if (spendKeywords.some(k => lower.includes(k))) return 'spending'
  if (cashflowKeywords.some(k => lower.includes(k))) return 'cashflow'
  if (budgetKeywords.some(k => lower.includes(k))) return 'budget'
  return 'general'
}

// ---------------------------------------------------------------------------
// Buscadores de contexto por intenção
// ---------------------------------------------------------------------------
async function fetchBudgetContext(ownerId: number, month: string): Promise<{ data: Record<string, unknown>; label: string }> {
  const db = getDatabase()
  const histMonths = previousMonths(month, 3)

  const [incomeRows, expenseRows, invoiceRows] = await Promise.all([
    db.select({ total: sql<number>`sum(abs(${transactions.amountMinor}))` })
      .from(transactions)
      .where(and(eq(transactions.ownerId, ownerId), eq(transactions.competencyMonth, month), eq(transactions.type, 'income'))),
    db.select({ total: sql<number>`sum(abs(${transactions.amountMinor}))` })
      .from(transactions)
      .where(and(eq(transactions.ownerId, ownerId), eq(transactions.competencyMonth, month), eq(transactions.type, 'expense'))),
    db.select({ openAmount: sql<number>`sum(${cardInvoices.openAmountMinor})` })
      .from(cardInvoices)
      .where(and(eq(cardInvoices.ownerId, ownerId), eq(cardInvoices.invoiceMonth, month))),
  ])

  const incomeMinor = Number(incomeRows[0]?.total ?? 0)
  const expenseMinor = Number(expenseRows[0]?.total ?? 0)
  const openDebtMinor = Number(invoiceRows[0]?.openAmount ?? 0)
  const committedMinor = expenseMinor + openDebtMinor
  const availableMinor = incomeMinor - committedMinor
  const commitmentPct = incomeMinor > 0 ? Math.round(committedMinor / incomeMinor * 100) : 0

  // Histórico simplificado
  const histRows = await db.select({
    month: transactions.competencyMonth,
    type: transactions.type,
    total: sql<number>`sum(abs(${transactions.amountMinor}))`,
  })
    .from(transactions)
    .where(and(eq(transactions.ownerId, ownerId), sql`${transactions.competencyMonth} = ANY(ARRAY[${sql.raw(histMonths.map(m => `'${m}'`).join(','))}]::text[])`))
    .groupBy(transactions.competencyMonth, transactions.type)

  const hist = histMonths.map(m => {
    const inc = histRows.find(r => r.month === m && r.type === 'income')
    const exp = histRows.find(r => r.month === m && r.type === 'expense')
    return { month: m, incomeMinor: Number(inc?.total ?? 0), expenseMinor: Number(exp?.total ?? 0) }
  })

  return {
    label: 'orçamento',
    data: {
      month,
      incomeMinor, incomeBRL: minorToBRL(incomeMinor),
      expenseMinor, expenseBRL: minorToBRL(expenseMinor),
      openDebtMinor, openDebtBRL: minorToBRL(openDebtMinor),
      availableMinor, availableBRL: minorToBRL(availableMinor),
      commitmentPct,
      historicalMonths: hist.map(h => ({
        month: h.month,
        incomeBRL: minorToBRL(h.incomeMinor),
        expenseBRL: minorToBRL(h.expenseMinor),
      })),
    },
  }
}

async function fetchDebtContext(ownerId: number, month: string): Promise<{ data: Record<string, unknown>; label: string }> {
  const db = getDatabase()
  const futureMonths = [month, ...Array.from({ length: 2 }, (_, i) => {
    const [y, m2] = month.split('-').map(Number)
    const d = new Date(Date.UTC(y, m2 - 1 + i + 1, 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  })]

  const invoices = await db.select({
    institutionName: cardInvoices.institutionName,
    invoiceMonth: cardInvoices.invoiceMonth,
    totalAmountMinor: cardInvoices.totalAmountMinor,
    openAmountMinor: cardInvoices.openAmountMinor,
    status: cardInvoices.status,
    dueDate: cardInvoices.dueDate,
  })
    .from(cardInvoices)
    .where(and(
      eq(cardInvoices.ownerId, ownerId),
      sql`${cardInvoices.invoiceMonth} = ANY(ARRAY[${sql.raw(futureMonths.map(m => `'${m}'`).join(','))}]::text[])`,
    ))
    .orderBy(cardInvoices.invoiceMonth)

  return {
    label: 'dívidas e faturas',
    data: {
      month,
      invoices: invoices.map(i => ({
        card: i.institutionName,
        invoiceMonth: i.invoiceMonth,
        totalBRL: minorToBRL(Number(i.totalAmountMinor ?? 0)),
        openBRL: minorToBRL(Number(i.openAmountMinor ?? 0)),
        status: i.status,
        dueDate: i.dueDate,
      })),
    },
  }
}

async function fetchSpendingContext(ownerId: number, month: string): Promise<{ data: Record<string, unknown>; label: string }> {
  const db = getDatabase()

  const rows = await db.select({
    categoryId: transactions.categoryId,
    total: sql<number>`sum(abs(${transactions.amountMinor}))`,
    count: sql<number>`count(*)`,
  })
    .from(transactions)
    .where(and(
      eq(transactions.ownerId, ownerId),
      eq(transactions.competencyMonth, month),
      eq(transactions.type, 'expense'),
    ))
    .groupBy(transactions.categoryId)
    .orderBy(desc(sql`sum(abs(${transactions.amountMinor}))`))
    .limit(8)

  const incomeRow = await db.select({ total: sql<number>`sum(abs(${transactions.amountMinor}))` })
    .from(transactions)
    .where(and(eq(transactions.ownerId, ownerId), eq(transactions.competencyMonth, month), eq(transactions.type, 'income')))

  const incomeMinor = Number(incomeRow[0]?.total ?? 0)

  return {
    label: 'gastos por categoria',
    data: {
      month,
      categories: rows.map(r => ({
        categoryId: r.categoryId ?? 'sem-categoria',
        totalBRL: minorToBRL(Number(r.total)),
        count: Number(r.count),
        pctOfIncome: incomeMinor > 0 ? Math.round(Number(r.total) / incomeMinor * 100) : 0,
      })),
    },
  }
}

async function fetchCashflowContext(ownerId: number, month: string): Promise<{ data: Record<string, unknown>; label: string }> {
  const db = getDatabase()
  const nextMonths = Array.from({ length: 3 }, (_, i) => {
    const [y, m2] = month.split('-').map(Number)
    const d = new Date(Date.UTC(y, m2 - 1 + i, 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  })

  const forecasts = await db.select({
    competencyMonth: cashflowForecasts.competencyMonth,
    description: cashflowForecasts.description,
    amountMinor: cashflowForecasts.amountMinor,
    recurrence: cashflowForecasts.recurrence,
  })
    .from(cashflowForecasts)
    .where(and(
      eq(cashflowForecasts.ownerId, ownerId),
      eq(cashflowForecasts.isActive, true),
      sql`${cashflowForecasts.competencyMonth} = ANY(ARRAY[${sql.raw(nextMonths.map(m => `'${m}'`).join(','))}]::text[])`,
    ))
    .limit(20)

  return {
    label: 'fluxo de caixa e previsões',
    data: {
      month,
      nextMonths,
      forecasts: forecasts.map(f => ({
        month: f.competencyMonth,
        description: f.description,
        amountBRL: minorToBRL(Number(f.amountMinor)),
        recurrence: f.recurrence,
      })),
    },
  }
}

// ---------------------------------------------------------------------------
// POST /api/chat
// ---------------------------------------------------------------------------
router.post('/', async (req: Request, res: Response) => {
  const { message, month, history } = z.object({
    message: z.string().min(1).max(1000),
    month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    history: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().max(2000),
    })).max(10).optional().default([]),
  }).parse(req.body)

  const db = getDatabase()
  const owner = await resolveOwnerId(req.authUser!.clerkUserId)
  const ownerId = owner.id
  const targetMonth = month ?? currentMonth()

  // Classificar intenção e buscar contexto relevante
  const intent = classifyIntent(message)
  const contextUsed: string[] = []
  let financialContext: Record<string, unknown> = {}

  try {
    if (intent === 'budget' || intent === 'general') {
      const ctx = await fetchBudgetContext(ownerId, targetMonth)
      financialContext = { ...financialContext, budget: ctx.data }
      contextUsed.push(ctx.label)
    }
    if (intent === 'debt') {
      const ctx = await fetchDebtContext(ownerId, targetMonth)
      financialContext = { ...financialContext, debt: ctx.data }
      contextUsed.push(ctx.label)
    }
    if (intent === 'spending') {
      const ctx = await fetchSpendingContext(ownerId, targetMonth)
      financialContext = { ...financialContext, spending: ctx.data }
      contextUsed.push(ctx.label)
    }
    if (intent === 'cashflow') {
      const ctx = await fetchCashflowContext(ownerId, targetMonth)
      financialContext = { ...financialContext, cashflow: ctx.data }
      contextUsed.push(ctx.label)
    }
  } catch {
    // Contexto financeiro falhou — responde sem dados
  }

  const systemPrompt = `Você é o Previa Bot, assistente financeiro pessoal integrado ao app Previa Finance.
Seu papel é responder perguntas sobre as finanças do usuário de forma direta, clara e honesta.

Regras:
- Use os dados financeiros fornecidos no contexto para embasar suas respostas
- Cite valores reais quando disponíveis (ex: "você gastou R$ 1.200 em alimentação")
- Se não tiver dados suficientes para responder, diga claramente e sugira o que o usuário pode verificar no app
- Seja direto e objetivo — máximo 3-4 parágrafos por resposta
- Nunca invente dados que não estejam no contexto
- Responda sempre em português brasileiro
- Você é um bot, não um humano — não finja ser humano

Contexto financeiro do usuário (mês de referência: ${targetMonth}):
${Object.keys(financialContext).length > 0 ? JSON.stringify(financialContext, null, 2) : 'Nenhum dado financeiro disponível para este mês.'}`

  // Montar histórico limitado (máx 10 turnos = 20 mensagens)
  const trimmedHistory = history.slice(-10)

  const baseUrl = config.ai.baseUrl.replace(/\/$/, '')
  const aiResponse = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.ai.apiKey}`,
    },
    body: JSON.stringify({
      model: config.ai.model,
      temperature: 0.5,
      messages: [
        { role: 'system', content: systemPrompt },
        ...trimmedHistory.map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: message },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  })

  if (!aiResponse.ok) {
    const text = await aiResponse.text().catch(() => '')
    res.status(502).json({ error: `Erro ao chamar IA: ${aiResponse.status}`, detail: text })
    return
  }

  const json = await aiResponse.json() as { choices?: Array<{ message?: { content?: string } }> }
  const reply = json.choices?.[0]?.message?.content ?? 'Não consegui gerar uma resposta. Tente novamente.'

  res.json({
    reply,
    contextUsed,
    month: targetMonth,
    intent,
  })
})

export { router as chatRouter }

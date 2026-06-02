/**
 * routes/chat.ts — Previa Bot: Chat contextual financeiro com IA
 *
 * Endpoint:
 *   POST /api/chat — Recebe mensagem + histórico, injeta contexto financeiro real
 *                    e retorna resposta da IA em linguagem natural.
 *
 * Contexto injectado automaticamente:
 *   - Saldo projetado do mês actual
 *   - Receitas e despesas do mês
 *   - Faturas de cartão em aberto
 *   - Top categorias de gasto
 *   - Estado da assinatura (trial / activo / expirado)
 */
import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { transactions, accounts, cardInvoices, cardTransactions, categories } from '@previa/db'
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
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function toMinor(v: unknown): number {
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'number') return v
  if (typeof v === 'string') return parseInt(v, 10) || 0
  return 0
}

function formatBRL(minor: number): string {
  return `R$ ${(minor / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ---------------------------------------------------------------------------
// Recolher contexto financeiro do utilizador para o mês pedido
// ---------------------------------------------------------------------------
async function buildFinancialContext(userId: number, month: string): Promise<string> {
  const db = getDatabase()
  const monthStart = `${month}-01`
  const monthEnd = `${month}-31`

  // 1. Receitas e despesas do mês (transacções de conta corrente)
  const txRows = await db
    .select({
      type: transactions.type,
      amountMinor: sql<string>`SUM(${transactions.amountMinor})`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        gte(transactions.occurredAt, new Date(`${monthStart}T00:00:00Z`)),
        lte(transactions.occurredAt, new Date(`${monthEnd}T23:59:59Z`)),
      )
    )
    .groupBy(transactions.type)

  let incomeMinor = 0
  let expenseMinor = 0
  for (const row of txRows) {
    const v = toMinor(row.amountMinor)
    if (row.type === 'INCOME') incomeMinor += v
    else if (row.type === 'EXPENSE') expenseMinor += v
  }

  // 2. Faturas de cartão do mês
  const invoiceRows = await db
    .select({
      id: cardInvoices.id,
      invoiceMonth: cardInvoices.invoiceMonth,
      totalAmountMinor: cardInvoices.totalAmountMinor,
      openAmountMinor: cardInvoices.openAmountMinor,
      status: cardInvoices.status,
      dueDate: cardInvoices.dueDate,
    })
    .from(cardInvoices)
    .where(
      and(
        eq(cardInvoices.userId, userId),
        eq(cardInvoices.invoiceMonth, month),
      )
    )

  const totalInvoiceMinor = invoiceRows.reduce((s, r) => s + toMinor(r.totalAmountMinor), 0)
  const openInvoiceMinor = invoiceRows.reduce((s, r) => s + toMinor(r.openAmountMinor), 0)

  // 3. Top 5 categorias de gasto do mês (cartão + conta)
  const catRows = await db
    .select({
      categoryId: cardTransactions.categoryId,
      total: sql<string>`SUM(${cardTransactions.amountMinor})`,
    })
    .from(cardTransactions)
    .where(
      and(
        eq(cardTransactions.userId, userId),
        eq(cardTransactions.competencyMonth, month),
      )
    )
    .groupBy(cardTransactions.categoryId)
    .orderBy(desc(sql`SUM(${cardTransactions.amountMinor})`))
    .limit(5)

  // Buscar nomes das categorias
  const catIds = catRows.map(r => r.categoryId).filter(Boolean) as string[]
  let catNames: Record<string, string> = {}
  if (catIds.length > 0) {
    const catNameRows = await db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(sql`${categories.id} IN (${sql.join(catIds.map(id => sql`${id}`), sql`, `)})`)
    for (const c of catNameRows) catNames[c.id] = c.name
  }

  const topCategories = catRows
    .map(r => `${catNames[r.categoryId ?? ''] ?? r.categoryId ?? 'Sem categoria'}: ${formatBRL(toMinor(r.total))}`)
    .join(', ')

  // 4. Contas activas
  const accountRows = await db
    .select({ id: accounts.id, displayName: accounts.displayName, type: accounts.type })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.isActive, true)))
    .limit(10)

  const accountList = accountRows.map(a => `${a.displayName} (${a.type})`).join(', ')

  // 5. Montar contexto em texto
  const balance = incomeMinor - expenseMinor
  const lines: string[] = [
    `=== CONTEXTO FINANCEIRO — ${month} ===`,
    `Receitas: ${formatBRL(incomeMinor)}`,
    `Despesas (conta): ${formatBRL(expenseMinor)}`,
    `Saldo líquido conta: ${formatBRL(balance)}`,
    `Fatura cartão total: ${formatBRL(totalInvoiceMinor)}`,
    `Fatura cartão em aberto: ${formatBRL(openInvoiceMinor)}`,
    topCategories ? `Top categorias cartão: ${topCategories}` : '',
    accountList ? `Contas: ${accountList}` : '',
    `===`,
  ].filter(Boolean)

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// POST /api/chat
// ---------------------------------------------------------------------------
const chatBodySchema = z.object({
  message: z.string().min(1).max(2000),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  history: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
    })
  ).max(20).optional(),
})

const SYSTEM_PROMPT = `Você é o Previa Bot, assistente financeiro do aplicativo Previa Finance.

Seu papel é ajudar o usuário a entender suas finanças com base nos dados reais do sistema.

REGRAS:
- Responda sempre em português brasileiro, de forma clara e direta.
- Use os dados do contexto financeiro fornecido para responder com precisão.
- Nunca invente dados. Se não souber, diga que não tem essa informação disponível.
- Seja factual: não prometa funcionalidades que não existem.
- Quando relevante, oriente o usuário para as ações disponíveis no app:
  * Importar fatura de cartão (PDF) → menu "Faturas"
  * Importar extrato bancário (CSV/OFX) → menu "Transações"
  * Ver projeção de caixa → menu "Cashflow"
  * Avaliar uma compra → menu "Avaliar compra"
- O Previa Finance tem período de trial de 15 dias gratuito. Após isso, o plano custa R$14,99/mês.
- Diferença importante: extrato = movimentações reais da conta; fatura = compras no cartão de crédito; projeção = estimativa futura baseada em dados históricos.
- Seja conciso. Respostas longas só quando o usuário pedir análise detalhada.`

router.post('/', async (req: Request, res: Response) => {
  try {
    const body = chatBodySchema.parse(req.body)
    const db = getDatabase()
    const owner = await resolveOwnerId(req.authUser!.clerkUserId)

    // Contexto financeiro real
    const month = body.month ?? currentMonth()
    let financialContext = ''
    try {
      financialContext = await buildFinancialContext(owner.id, month)
    } catch (err) {
      console.warn('[chat] failed to build financial context:', err)
      financialContext = `=== CONTEXTO FINANCEIRO — ${month} ===\n(dados não disponíveis)\n===`
    }

    // Se não há chave de IA configurada, retornar resposta de fallback
    if (!config.ai.apiKey) {
      return res.json({
        reply: 'O Previa Bot está temporariamente indisponível. Por favor, tente novamente mais tarde.',
        context: financialContext,
      })
    }

    const baseUrl = config.ai.baseUrl.replace(/\/$/, '')
    const history = body.history ?? []

    // Montar mensagens para a IA
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\n${financialContext}` },
      ...history.slice(-10).map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: body.message },
    ]

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ai.apiKey}`,
      },
      body: JSON.stringify({
        model: config.ai.model,
        temperature: 0.5,
        max_tokens: 600,
        messages,
      }),
      signal: AbortSignal.timeout(30000),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      console.error('[chat] AI error:', response.status, text)
      return res.json({
        reply: 'Não consegui processar sua pergunta agora. Tente novamente em instantes.',
        context: financialContext,
      })
    }

    const json = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const reply = json.choices?.[0]?.message?.content?.trim() ?? 'Não obtive resposta da IA.'

    return res.json({ reply, context: financialContext })
  } catch (err) {
    console.error('[chat] error:', err)
    return res.status(500).json({ reply: 'Erro interno. Tente novamente.' })
  }
})

export { router as chatRouter }

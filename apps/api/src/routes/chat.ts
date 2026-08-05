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
import { transactions, accounts, cardInvoices, cardInvoicePayments, cardTransactions, categories } from '@previa/db'
import { and, eq, gte, lte, inArray, sql, desc } from "drizzle-orm"
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

const MONTH_ALIASES: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
}

function shiftMonth(month: string, offset: number): string {
  const [year, monthIndex] = month.split('-').map(Number)
  const d = new Date(Date.UTC(year, monthIndex - 1 + offset, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function currentYear(): number {
  return new Date().getFullYear()
}

function formatMonthLabel(month: string): string {
  const [year, monthIndex] = month.split("-").map(Number)
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthIndex - 1, 1)))
}

function listMonthsBetween(startMonth: string, endMonth: string): string[] {
  const months: string[] = []
  let cursor = startMonth
  while (cursor <= endMonth) {
    months.push(cursor)
    cursor = shiftMonth(cursor, 1)
  }
  return months
}

const NUMBER_WORDS: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
}

interface PeriodSpec {
  months: string[]
  label: string
}

function createSingleMonthPeriod(month: string): PeriodSpec {
  return {
    months: [month],
    label: formatMonthLabel(month),
  }
}

function createRangePeriod(months: string[], title: string): PeriodSpec {
  const first = formatMonthLabel(months[0])
  const last = formatMonthLabel(months[months.length - 1])
  return {
    months,
    label: title + " (" + first + " a " + last + ")",
  }
}

function parsePeriodFromText(text: string): PeriodSpec | null {
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")

  const lastMonthsMatch = normalized.match(/\bultim[oa]s?\s+(?:de\s+)?(\d+|um|uma|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)\s+mes(?:es)?\b/)
  if (lastMonthsMatch) {
    const rawCount = lastMonthsMatch[1]
    const count = /^\d+$/.test(rawCount) ? Number(rawCount) : NUMBER_WORDS[rawCount]
    if (count && count > 0) {
      const end = currentMonth()
      const start = shiftMonth(end, -(count - 1))
      return createRangePeriod(listMonthsBetween(start, end), "ultimos " + count + " meses")
    }
  }

  if (/\b(este|esse|nesse) ano\b|\bano atual\b|\bano corrente\b/.test(normalized)) {
    const year = currentYear()
    const start = year + "-01"
    const end = currentMonth()
    return createRangePeriod(listMonthsBetween(start, end), "ano atual")
  }

  if (/\b(trimestre passado|ultimo trimestre)\b/.test(normalized)) {
    const now = new Date()
    const currentQuarter = Math.floor(now.getMonth() / 3) + 1
    const previousQuarter = currentQuarter === 1 ? 4 : currentQuarter - 1
    const year = currentQuarter === 1 ? now.getFullYear() - 1 : now.getFullYear()
    const startMonthIndex = (previousQuarter - 1) * 3 + 1
    const start = year + "-" + String(startMonthIndex).padStart(2, "0")
    const end = year + "-" + String(startMonthIndex + 2).padStart(2, "0")
    return createRangePeriod(listMonthsBetween(start, end), "trimestre passado")
  }

  if (/\b(este|esse|nesse) mes\b|\bmes atual\b/.test(normalized)) return createSingleMonthPeriod(currentMonth())
  if (/\bmes passado\b|\bultimo mes\b|\bmes anterior\b/.test(normalized)) return createSingleMonthPeriod(shiftMonth(currentMonth(), -1))

  const explicit = normalized.match(/\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?\b/)
  if (!explicit) return null

  const month = MONTH_ALIASES[explicit[1]]
  const year = explicit[2] ? Number(explicit[2]) : currentYear()
  if (!month || !Number.isInteger(year)) return null
  return createSingleMonthPeriod(year + "-" + String(month).padStart(2, "0"))
}
function parseMonthFromText(text: string): string | null {
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  if (/\b(este|esse|nesse) mes\b|\bmes atual\b/.test(normalized)) return currentMonth()
  if (/\bmes passado\b|\bultimo mes\b|\bmes anterior\b/.test(normalized)) return shiftMonth(currentMonth(), -1)

  const explicit = normalized.match(/\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?\b/)
  if (!explicit) return null

  const month = MONTH_ALIASES[explicit[1]]
  const year = explicit[2] ? Number(explicit[2]) : new Date().getFullYear()
  if (!month || !Number.isInteger(year)) return null
  return `${year}-${String(month).padStart(2, '0')}`
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

function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function isTopExpensesQuestion(text: string): boolean {
  return /(maiores despesas|onde gasto mais|top gastos|maiores gastos|categoria de maior gasto|categoria que mais gasto)/i.test(text)
}

function isOpenInvoicesQuestion(text: string): boolean {
  return /(faturas? em aberto|cartao em aberto|fatura aberta|cartao a pagar|quanto devo no cartao|divida do cartao)/i.test(text)
}

function isBudgetQuestion(text: string): boolean {
  return /(orcamento|orçamento|saldo|como esta meu mes|como está meu mês|fluxo de caixa|quanto sobra|resultado do mes)/i.test(text)
}

function isSummaryQuestion(text: string): boolean {
  return /(resumo|como estou|visao geral|visão geral|painel|panorama)/i.test(text)
}

function isTransactionsQuestion(text: string): boolean {
  return /(transa[cç][oõ]es|movimentacoes|movimentações|lancamentos|lançamentos|extrato)/i.test(text)
}

function isInstallmentPaymentDateQuestion(text: string): boolean {
  return /(quando\s+paguei|data\s+do\s+pagamento|quando\s+foi\s+pago|paguei\s+a\s+prestacao|paguei\s+a\s+parcela)/i.test(text)
    && /(fatura|cartao|cartao\s+de\s+credito|prestacao|parcela)/i.test(text)
}

function extractInstallmentSubject(text: string): string | null {
  const quoted = text.match(/["'“”]([^"'“”]{3,80})["'“”]/)
  if (quoted?.[1]) return quoted[1].trim()

  const patterns = [
    /prestac(?:ao|oes)?\s+d[oa]\s+([a-z0-9\s]{3,80}?)(?:\s+pela\s+fatura|\s+na\s+fatura|\s+do\s+cartao|\s+no\s+cartao|\?|$)/i,
    /parcela(?:s)?\s+d[oa]\s+([a-z0-9\s]{3,80}?)(?:\s+pela\s+fatura|\s+na\s+fatura|\s+do\s+cartao|\s+no\s+cartao|\?|$)/i,
    /d[oa]\s+([a-z0-9\s]{3,80}?)(?:\s+pela\s+fatura|\s+na\s+fatura|\s+do\s+cartao|\s+no\s+cartao|\?|$)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) {
      const cleaned = match[1]
        .replace(/\b(meu|minha|do|da|de|no|na|um|uma|as|os)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (cleaned.length >= 3) return cleaned
    }
  }

  return null
}

async function buildDirectInsight(
  userId: number,
  month: string,
  message: string,
): Promise<{ reply: string; context: string } | null> {
  const db = getDatabase()
  const normalized = normalizeQuestion(message)
  const monthStart = `${month}-01`
  const monthEnd = `${month}-31`

  const shouldHandleExpenses = isTopExpensesQuestion(normalized)
  const shouldHandleInvoices = isOpenInvoicesQuestion(normalized)
  const shouldHandleBudget = isBudgetQuestion(normalized) || isSummaryQuestion(normalized)
  const shouldHandleTransactions = isTransactionsQuestion(normalized)
  const shouldHandleInstallmentPaymentDate = isInstallmentPaymentDateQuestion(normalized)

  if (!shouldHandleExpenses && !shouldHandleInvoices && !shouldHandleBudget && !shouldHandleTransactions && !shouldHandleInstallmentPaymentDate) {
    return null
  }

  const [txRows, invoiceRows, bankExpenseRows, cardExpenseRows, accountRows, bankTxCountRows, cardTxCountRows] = await Promise.all([
    db
      .select({ movementType: transactions.movementType, amountMinor: sql<string>`SUM(${transactions.amountMinor})` })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          gte(transactions.occurredAt, new Date(`${monthStart}T00:00:00Z`)),
          lte(transactions.occurredAt, new Date(`${monthEnd}T23:59:59Z`)),
        )
      )
      .groupBy(transactions.movementType),
    db
      .select({
        id: cardInvoices.id,
        invoiceMonth: cardInvoices.invoiceMonth,
        totalAmountMinor: cardInvoices.totalAmountMinor,
        openAmountMinor: cardInvoices.effectiveOpenAmountMinor,
        status: cardInvoices.status,
        dueDate: cardInvoices.dueDate,
      })
      .from(cardInvoices)
      .where(and(eq(cardInvoices.userId, userId), eq(cardInvoices.invoiceMonth, month))),
    db
      .select({ categoryId: transactions.categoryId, total: sql<string>`SUM(${transactions.amountMinor})` })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.competencyMonth, month),
          eq(transactions.movementType, 'expense'),
        )
      )
      .groupBy(transactions.categoryId),
    db
      .select({ categoryId: cardTransactions.categoryId, total: sql<string>`SUM(${cardTransactions.amountMinor})` })
      .from(cardTransactions)
      .where(and(eq(cardTransactions.userId, userId), eq(cardTransactions.competencyMonth, month)))
      .groupBy(cardTransactions.categoryId),
    db
      .select({ id: accounts.id, displayName: accounts.displayName, type: accounts.type })
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.isActive, true)))
      .limit(10),
    db
      .select({ count: sql<string>`COUNT(*)` })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          gte(transactions.occurredAt, new Date(`${monthStart}T00:00:00Z`)),
          lte(transactions.occurredAt, new Date(`${monthEnd}T23:59:59Z`)),
        )
      ),
    db
      .select({ count: sql<string>`COUNT(*)` })
      .from(cardTransactions)
      .where(and(eq(cardTransactions.userId, userId), eq(cardTransactions.competencyMonth, month))),
  ])

  let incomeMinor = 0
  let expenseMinor = 0
  for (const row of txRows) {
    const v = Math.abs(toMinor(row.amountMinor))
    if (String(row.movementType).toLowerCase() === 'income') incomeMinor += v
    else if (String(row.movementType).toLowerCase() === 'expense') expenseMinor += v
  }

  const totalInvoiceMinor = invoiceRows.reduce((s, r) => s + toMinor(r.totalAmountMinor), 0)
  const openInvoiceMinor = invoiceRows.reduce((s, r) => s + toMinor(r.openAmountMinor), 0)
  const cardExpenseMinor = cardExpenseRows.reduce((s, r) => s + Math.abs(toMinor(r.total)), 0)
  const totalExpenseMinor = expenseMinor + cardExpenseMinor
  const balance = incomeMinor - expenseMinor
  const netAfterCardMinor = incomeMinor - totalExpenseMinor

  const categoryIds = [...new Set([
    ...bankExpenseRows.map((r) => r.categoryId).filter(Boolean) as string[],
    ...cardExpenseRows.map((r) => r.categoryId).filter(Boolean) as string[],
  ])]
  const categoryNames: Record<string, string> = {}
  if (categoryIds.length > 0) {
    const rows = await db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(sql`${categories.id} IN (${sql.join(categoryIds.map((id) => sql`${id}`), sql`, `)})`)
    for (const row of rows) categoryNames[row.id] = row.name
  }

  const expenseTotals = new Map<string, number>()
  for (const row of [...bankExpenseRows, ...cardExpenseRows]) {
    const key = row.categoryId ?? 'sem_categoria'
    expenseTotals.set(key, (expenseTotals.get(key) ?? 0) + Math.abs(toMinor(row.total)))
  }

  const topExpensesList = [...expenseTotals.entries()]
    .map(([categoryId, amountMinor]) => ({
      categoryId,
      label: categoryNames[categoryId] ?? (categoryId === 'sem_categoria' ? 'Sem categoria' : categoryId),
      amountMinor,
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor)
    .slice(0, 5)

  const topExpensesLine = topExpensesList.length > 0
    ? topExpensesList.map((item, index) => `${index + 1}. ${item.label}: ${formatBRL(item.amountMinor)}`).join(' | ')
    : 'Não encontrei despesas categorizadas suficientes para montar um ranking.'

  const accountList = accountRows.map((a) => `${a.displayName} (${a.type})`).join(', ')

  const context = [
    `=== CONTEXTO FINANCEIRO — ${month} ===`,
    `Receitas: ${formatBRL(incomeMinor)}`,
    `Despesas (conta): ${formatBRL(expenseMinor)}`,
    `Despesas (cartão por competência): ${formatBRL(cardExpenseMinor)}`,
    `Despesas totais (conta + cartão): ${formatBRL(totalExpenseMinor)}`,
    `Saldo líquido conta: ${formatBRL(balance)}`,
    `Saldo líquido após cartão: ${formatBRL(netAfterCardMinor)}`,
    `Fatura cartão total: ${formatBRL(totalInvoiceMinor)}`,
    `Fatura cartão em aberto: ${formatBRL(openInvoiceMinor)}`,
    `Maiores despesas do período: ${topExpensesLine}`,
    accountList ? `Contas: ${accountList}` : '',
    `===`,
  ].filter(Boolean).join('\n')

  if (shouldHandleExpenses) {
    return {
      reply: topExpensesList.length > 0
        ? `No mês ${month}, suas maiores despesas foram: ${topExpensesList.map((item) => `${item.label} (${formatBRL(item.amountMinor)})`).join('; ')}.`
        : `No mês ${month}, não consegui identificar despesas suficientes para montar um ranking.`,
      context,
    }
  }

  if (shouldHandleInvoices) {
    const openInvoices = invoiceRows
      .filter((inv) => toMinor(inv.openAmountMinor) > 0)
      .sort((a, b) => new Date(String(a.dueDate)).getTime() - new Date(String(b.dueDate)).getTime())

    return {
      reply: openInvoices.length > 0
        ? `No mês ${month}, você tem ${openInvoices.length} fatura(s) em aberto somando ${formatBRL(openInvoiceMinor)}. A principal em aberto é ${formatBRL(toMinor(openInvoices[0].openAmountMinor))}.`
        : `No mês ${month}, não encontrei faturas em aberto.`,
      context,
    }
  }

  if (shouldHandleTransactions) {
    const bankTransactionsCount = toMinor(bankTxCountRows[0]?.count)
    const cardTransactionsCount = toMinor(cardTxCountRows[0]?.count)
    return {
      reply: `Sim. Consigo acessar suas transações do mês ${month}. Encontrei ${bankTransactionsCount} movimentos de conta e ${cardTransactionsCount} compras no cartão. Se quiser, eu posso detalhar receitas, despesas, faturas ou maiores gastos desse período.`,
      context,
    }
  }

  if (shouldHandleInstallmentPaymentDate) {
    const subject = extractInstallmentSubject(normalized)
    if (!subject) {
      return {
        reply: `Consigo verificar, sim. Me diga o termo da compra/parcelamento (por exemplo: "terreno" ou o nome do estabelecimento) para eu localizar a data do pagamento na fatura.`,
        context,
      }
    }

    const likeTerm = `%${subject}%`

    const installmentMatches = await db
      .select({
        cardInvoiceId: cardTransactions.cardInvoiceId,
        description: cardTransactions.description,
        installmentNumber: cardTransactions.installmentNumber,
        installmentTotal: cardTransactions.installmentTotal,
        amountMinor: cardTransactions.amountMinor,
      })
      .from(cardTransactions)
      .where(
        and(
          eq(cardTransactions.userId, userId),
          sql`LOWER(${cardTransactions.description}) LIKE ${likeTerm}`,
        ),
      )
      .orderBy(desc(cardTransactions.id))
      .limit(30)

    if (installmentMatches.length === 0) {
      return {
        reply: `Não encontrei lançamentos de cartão com o termo "${subject}". Se quiser, me diga outro termo da descrição que aparece na fatura para eu procurar.`,
        context,
      }
    }

    const invoiceIds = [...new Set(installmentMatches.map((row) => Number(row.cardInvoiceId)).filter((id) => Number.isInteger(id) && id > 0))]
    if (invoiceIds.length === 0) {
      return {
        reply: `Encontrei o parcelamento "${subject}", mas sem fatura vinculada para confirmar pagamento.`,
        context,
      }
    }

    const [invoiceRowsById, paymentRows] = await Promise.all([
      db
        .select({
          id: cardInvoices.id,
          invoiceMonth: cardInvoices.invoiceMonth,
          dueDate: cardInvoices.dueDate,
        })
        .from(cardInvoices)
        .where(and(eq(cardInvoices.userId, userId), inArray(cardInvoices.id, invoiceIds))),
      db
        .select({
          cardInvoiceId: cardInvoicePayments.cardInvoiceId,
          paymentDate: cardInvoicePayments.paymentDate,
          allocatedAmountMinor: cardInvoicePayments.allocatedAmountMinor,
        })
        .from(cardInvoicePayments)
        .where(and(eq(cardInvoicePayments.userId, userId), inArray(cardInvoicePayments.cardInvoiceId, invoiceIds)))
        .orderBy(desc(cardInvoicePayments.paymentDate)),
    ])

    const paymentByInvoice = new Map<number, Array<{ paymentDate: Date; allocatedAmountMinor: number }>>()
    for (const row of paymentRows) {
      const invoiceId = Number(row.cardInvoiceId)
      const current = paymentByInvoice.get(invoiceId) ?? []
      current.push({
        paymentDate: row.paymentDate,
        allocatedAmountMinor: Math.abs(toMinor(row.allocatedAmountMinor)),
      })
      paymentByInvoice.set(invoiceId, current)
    }

    const invoiceById = new Map(invoiceRowsById.map((row) => [row.id, row]))
    const responseLines: string[] = []
    for (const invoiceId of invoiceIds.slice(0, 5)) {
      const invoice = invoiceById.get(invoiceId)
      if (!invoice) continue
      const payments = paymentByInvoice.get(invoiceId) ?? []
      if (payments.length === 0) {
        responseLines.push(`fatura ${invoice.invoiceMonth}: sem pagamento conciliado registrado`) 
        continue
      }

      const latest = payments[0]
      const paidMinor = payments.reduce((sum, p) => sum + p.allocatedAmountMinor, 0)
      const paidAt = new Date(latest.paymentDate).toISOString().slice(0, 10)
      responseLines.push(`fatura ${invoice.invoiceMonth}: pago em ${paidAt} (${formatBRL(paidMinor)})`)
    }

    return {
      reply: responseLines.length > 0
        ? `Para "${subject}", encontrei estes pagamentos via fatura: ${responseLines.join('; ')}.`
        : `Encontrei o parcelamento "${subject}", mas ainda não há pagamento conciliado da fatura para confirmar a data.`,
      context,
    }
  }

  if (shouldHandleBudget) {
    return {
      reply: `No mês ${month}, suas receitas foram ${formatBRL(incomeMinor)}, despesas de conta ${formatBRL(expenseMinor)}, despesas de cartão ${formatBRL(cardExpenseMinor)} e despesas totais ${formatBRL(totalExpenseMinor)}. O saldo líquido da conta ficou em ${formatBRL(balance)} e após cartão ficou em ${formatBRL(netAfterCardMinor)}.`,
      context,
    }
  }

  return null
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
      movementType: transactions.movementType,
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
    .groupBy(transactions.movementType)

  let incomeMinor = 0
  let expenseMinor = 0
  for (const row of txRows) {
    const v = Math.abs(toMinor(row.amountMinor))
    if (String(row.movementType).toLowerCase() === 'income') incomeMinor += v
    else if (String(row.movementType).toLowerCase() === 'expense') expenseMinor += v
  }

  // 2. Faturas de cartão do mês
  const invoiceRows = await db
    .select({
      id: cardInvoices.id,
      invoiceMonth: cardInvoices.invoiceMonth,
      totalAmountMinor: cardInvoices.totalAmountMinor,
      openAmountMinor: cardInvoices.effectiveOpenAmountMinor,
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
    .map(r => `${catNames[r.categoryId ?? ''] ?? r.categoryId ?? 'Sem categoria'}: ${formatBRL(Math.abs(toMinor(r.total)))}`)
    .join(', ')

  // 3b. Maiores despesas do período combinando banco + cartão
  const [bankExpenseRows, cardExpenseRows] = await Promise.all([
    db
      .select({
        categoryId: transactions.categoryId,
        total: sql<string>`SUM(${transactions.amountMinor})`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.competencyMonth, month),
          eq(transactions.movementType, 'expense'),
        )
      )
      .groupBy(transactions.categoryId),
    db
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
      .groupBy(cardTransactions.categoryId),
  ])

  const expenseTotals = new Map<string, number>()
  for (const row of [...bankExpenseRows, ...cardExpenseRows]) {
    const key = row.categoryId ?? 'sem_categoria'
    expenseTotals.set(key, (expenseTotals.get(key) ?? 0) + Math.abs(toMinor(row.total)))
  }

  const cardExpenseMinor = cardExpenseRows.reduce((s, r) => s + Math.abs(toMinor(r.total)), 0)
  const totalExpenseMinor = expenseMinor + cardExpenseMinor

  const expenseCategoryIds = [...expenseTotals.keys()].filter((id) => id !== 'sem_categoria')
  const expenseCategoryNames: Record<string, string> = { ...catNames }
  if (expenseCategoryIds.length > 0) {
    const expenseNameRows = await db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(sql`${categories.id} IN (${sql.join(expenseCategoryIds.map(id => sql`${id}`), sql`, `)})`)
    for (const row of expenseNameRows) expenseCategoryNames[row.id] = row.name
  }

  const topExpenses = [...expenseTotals.entries()]
    .map(([categoryId, amountMinor]) => ({
      categoryId,
      label: expenseCategoryNames[categoryId] ?? categoryId,
      amountMinor,
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor)
    .slice(0, 5)
    .map((item, index) => `${index + 1}. ${item.label}: ${formatBRL(item.amountMinor)}`)
    .join(' | ')

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
    `Despesas (cartão por competência): ${formatBRL(cardExpenseMinor)}`,
    `Despesas totais (conta + cartão): ${formatBRL(totalExpenseMinor)}`,
    `Saldo líquido conta: ${formatBRL(balance)}`,
    `Fatura cartão total: ${formatBRL(totalInvoiceMinor)}`,
    `Fatura cartão em aberto: ${formatBRL(openInvoiceMinor)}`,
    topCategories ? `Top categorias cartão: ${topCategories}` : '',
    topExpenses ? `Maiores despesas do período: ${topExpenses}` : '',
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
- Se o usuário perguntar sobre maiores despesas, top gastos, categorias de maior gasto ou algo equivalente, use diretamente a linha 'Maiores despesas do período' do contexto e seja específico com valores.
- Nunca invente dados. Se não souber, diga que não tem essa informação disponível.
- Seja factual: não prometa funcionalidades que não existem.
- Quando relevante, oriente o usuário para as ações disponíveis no app:
  * Importar fatura de cartão (PDF) → menu "Faturas"
  * Importar extrato bancário (CSV/OFX) → menu "Transações"
  * Ver projeção de caixa → menu "Cashflow"
  * Simular uma compra → menu "Simular compra"
- O Previa Finance tem período de trial de 15 dias gratuito. Após isso, o plano custa R$14,99/mês.
- Diferença importante: extrato = movimentações reais da conta; fatura = compras no cartão de crédito; projeção = estimativa futura baseada em dados históricos.
- Seja conciso. Respostas longas só quando o usuário pedir análise detalhada.`

router.post('/', async (req: Request, res: Response) => {
  try {
    const body = chatBodySchema.parse(req.body)
    const owner = await resolveOwnerId(req.authUser!.clerkUserId)

    // Contexto financeiro real
    const period = parsePeriodFromText(body.message) ?? createSingleMonthPeriod(body.month ?? currentMonth())
    let financialContext = ''
    try {
      financialContext = period.months.length === 1 ? await buildFinancialContext(owner.id, period.months[0]) : (await Promise.all(period.months.map((month) => buildFinancialContext(owner.id, month)))).join("\n\n")
    } catch (err) {
      console.warn('[chat] failed to build financial context:', err)
      financialContext = `=== CONTEXTO FINANCEIRO — ${period.label} ===\n(dados não disponíveis)\n===`
    }

    const directInsight = period.months.length === 1
      ? await buildDirectInsight(owner.id, period.months[0], body.message).catch((err) => {
        console.warn("[chat] failed to build direct insight:", err)
        return null
      })
      : null
    if (directInsight) {
      return res.json(directInsight)
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

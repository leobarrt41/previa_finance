/**
 * routes/readModels.ts — Read models / tabelas intermediárias de performance
 *
 * Endpoints:
 *   POST /api/read-models/backfill          — recalcula todos os read models do owner
 *   GET  /api/read-models/dashboard-snapshot — retorna snapshot do painel (com fallback ao vivo)
 *   GET  /api/read-models/transaction-summary?month=YYYY-MM — resumo de transações do mês
 *
 * Estratégia:
 *   1. Tenta ler da tabela intermediária (se updated_at < STALE_MINUTES, usa cache).
 *   2. Se stale ou inexistente, recalcula ao vivo e persiste na tabela.
 *   3. POST /backfill força recálculo completo independente de staleness.
 */
import { Router, Request, Response } from 'express'
import { and, eq, gte, lte, sql, inArray } from 'drizzle-orm'
import { getDatabase } from '../config/database.js'
import { resolveOwnerId } from '../services/ownerStore.js'
import { requireClerkAuth } from '../middlewares/auth.js'
import {
  transactions,
  accounts,
  cardInvoices,
  cardTransactions,
} from '@previa/db'

const router: Router = Router()
router.use(requireClerkAuth)

/** Minutos antes de considerar o snapshot stale */
const STALE_MINUTES = 60

function currentMonth(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

function addMonths(month: string, offset: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + offset, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function toBigInt(v: unknown): bigint {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number') return BigInt(Math.round(v))
  if (typeof v === 'string') return BigInt(v)
  return 0n
}

// ---------------------------------------------------------------------------
// Helpers de cálculo ao vivo
// ---------------------------------------------------------------------------

async function computeTransactionSummary(
  db: ReturnType<typeof getDatabase>,
  ownerId: number,
  month: string,
) {
  // Busca contas do owner
  const ownerAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.userId, ownerId))

  if (ownerAccounts.length === 0) {
    return { income: 0n, expense: 0n, net: 0n, count: 0 }
  }

  const accountIds = ownerAccounts.map((a) => a.id)
  const monthStart = `${month}-01`
  const [y, m] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`

  const rows = await db
    .select({
      movementType: transactions.movementType,
      amount: transactions.amountMinor,
    })
    .from(transactions)
    .where(
      and(
        inArray(transactions.accountId, accountIds),
        gte(transactions.occurredAt, new Date(`${monthStart}T00:00:00Z`)),
        lte(transactions.occurredAt, new Date(`${monthEnd}T23:59:59Z`)),
      ),
    )

  let income = 0n
  let expense = 0n
  for (const row of rows) {
    const amt = toBigInt(row.amount)
    if (row.movementType === 'income') income += amt
    else expense += amt
  }

  return { income, expense, net: income - expense, count: rows.length }
}

async function computeDashboardSnapshot(
  db: ReturnType<typeof getDatabase>,
  ownerId: number,
) {
  const month = currentMonth()

  // 1. Saldo total das contas correntes
  const ownerAccounts = await db
    .select({ id: accounts.id, balance: accounts.balanceMinor, type: accounts.type })
    .from(accounts)
    .where(eq(accounts.userId, ownerId))

  const totalBalance = ownerAccounts
    .filter((a) => a.type === 'checking' || a.type === 'savings')
    .reduce((sum, a) => sum + toBigInt(a.balance), 0n)

  const accountIds = ownerAccounts.map((a) => a.id)

  // 2. Faturas em aberto
  let openInvoicesTotal = 0n
  let openInvoicesCount = 0
  let nextDueDate: string | null = null
  let nextDueAmount = 0n

  if (accountIds.length > 0) {
    const openInvoices = await db
      .select({
        id: cardInvoices.id,
        status: cardInvoices.status,
        totalAmountMinor: cardInvoices.totalAmountMinor,
        effectiveOpenAmountMinor: cardInvoices.effectiveOpenAmountMinor,
        dueDate: cardInvoices.dueDate,
      })
      .from(cardInvoices)
      .where(
        and(
          inArray(cardInvoices.accountId, accountIds),
          sql`${cardInvoices.status} IN ('OPEN', 'PARTIAL', 'OVERDUE')`,
        ),
      )

    for (const inv of openInvoices) {
      const open = toBigInt(inv.effectiveOpenAmountMinor ?? inv.totalAmountMinor)
      openInvoicesTotal += open
      openInvoicesCount++
      const due = inv.dueDate ? String(inv.dueDate).slice(0, 10) : null
      if (due && (!nextDueDate || due < nextDueDate)) {
        nextDueDate = due
        nextDueAmount = open
      }
    }
  }

  // 3. Receitas e despesas do mês actual
  const txSummary = await computeTransactionSummary(db, ownerId, month)

  return {
    ownerId,
    snapshotDate: new Date().toISOString().slice(0, 10),
    currentMonth: month,
    totalBalanceMinor: totalBalance,
    openInvoicesTotalMinor: openInvoicesTotal,
    openInvoicesCount,
    nextDueDate,
    nextDueAmountMinor: nextDueAmount,
    monthIncomeMinor: txSummary.income,
    monthExpenseMinor: txSummary.expense,
    accountsJson: ownerAccounts,
  }
}

// ---------------------------------------------------------------------------
// GET /api/read-models/dashboard-snapshot
// ---------------------------------------------------------------------------
router.get('/dashboard-snapshot', async (req: Request, res: Response) => {
  try {
    const db = getDatabase()
    const owner = await resolveOwnerId(req.authUser!.clerkUserId)

    // Tenta ler da tabela intermediária
    const staleThreshold = new Date(Date.now() - STALE_MINUTES * 60 * 1000)
    const today = new Date().toISOString().slice(0, 10)

    let snapshot: any = null
    try {
      const rows = await db.execute(
        sql`SELECT * FROM dashboard_snapshot
            WHERE owner_id = ${owner.id}
              AND snapshot_date = ${today}
              AND updated_at >= ${staleThreshold}
            LIMIT 1`,
      )
      const data = rows as any
      if (Array.isArray(data) && data.length > 0) {
        snapshot = data[0]
      } else if (data?.rows?.length > 0) {
        snapshot = data.rows[0]
      }
    } catch {
      // Tabela pode não existir ainda — fallback ao vivo
    }

    if (snapshot) {
      return res.json({ source: 'cache', data: snapshot })
    }

    // Calcula ao vivo
    const live = await computeDashboardSnapshot(db, owner.id)

    // Persiste (best-effort — não falha o request se a tabela não existir)
    try {
      await db.execute(
        sql`INSERT INTO dashboard_snapshot
              (owner_id, snapshot_date, current_month,
               total_balance_minor, open_invoices_total_minor, open_invoices_count,
               next_due_date, next_due_amount_minor,
               month_income_minor, month_expense_minor, accounts_json)
            VALUES
              (${owner.id}, ${live.snapshotDate}, ${live.currentMonth},
               ${live.totalBalanceMinor}, ${live.openInvoicesTotalMinor}, ${live.openInvoicesCount},
               ${live.nextDueDate}, ${live.nextDueAmountMinor},
               ${live.monthIncomeMinor}, ${live.monthExpenseMinor},
               ${JSON.stringify(live.accountsJson)})
            ON DUPLICATE KEY UPDATE
              total_balance_minor         = VALUES(total_balance_minor),
              open_invoices_total_minor   = VALUES(open_invoices_total_minor),
              open_invoices_count         = VALUES(open_invoices_count),
              next_due_date               = VALUES(next_due_date),
              next_due_amount_minor       = VALUES(next_due_amount_minor),
              month_income_minor          = VALUES(month_income_minor),
              month_expense_minor         = VALUES(month_expense_minor),
              accounts_json               = VALUES(accounts_json),
              updated_at                  = CURRENT_TIMESTAMP`,
      )
    } catch {
      // Silencia erro de persistência — retorna dados ao vivo de qualquer forma
    }

    return res.json({
      source: 'live',
      data: {
        ...live,
        totalBalanceMinor: live.totalBalanceMinor.toString(),
        openInvoicesTotalMinor: live.openInvoicesTotalMinor.toString(),
        nextDueAmountMinor: live.nextDueAmountMinor.toString(),
        monthIncomeMinor: live.monthIncomeMinor.toString(),
        monthExpenseMinor: live.monthExpenseMinor.toString(),
      },
    })
  } catch (err: any) {
    console.error('[readModels] dashboard-snapshot error:', err)
    return res.status(500).json({ error: 'Erro ao calcular snapshot do painel' })
  }
})

// ---------------------------------------------------------------------------
// GET /api/read-models/transaction-summary?month=YYYY-MM
// ---------------------------------------------------------------------------
router.get('/transaction-summary', async (req: Request, res: Response) => {
  try {
    const month = (req.query.month as string) || currentMonth()
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Parâmetro month inválido. Use YYYY-MM.' })
    }

    const db = getDatabase()
    const owner = await resolveOwnerId(req.authUser!.clerkUserId)

    // Tenta cache
    const staleThreshold = new Date(Date.now() - STALE_MINUTES * 60 * 1000)
    let cached: any = null
    try {
      const rows = await db.execute(
        sql`SELECT * FROM transaction_month_summary
            WHERE owner_id = ${owner.id}
              AND month = ${month}
              AND updated_at >= ${staleThreshold}
            LIMIT 1`,
      )
      const data = rows as any
      if (Array.isArray(data) && data.length > 0) cached = data[0]
      else if (data?.rows?.length > 0) cached = data.rows[0]
    } catch { /* tabela pode não existir */ }

    if (cached) {
      return res.json({ source: 'cache', data: cached })
    }

    // Calcula ao vivo
    const summary = await computeTransactionSummary(db, owner.id, month)

    // Persiste (best-effort)
    try {
      await db.execute(
        sql`INSERT INTO transaction_month_summary
              (owner_id, month, total_income_minor, total_expense_minor, net_minor, transaction_count)
            VALUES
              (${owner.id}, ${month}, ${summary.income}, ${summary.expense}, ${summary.net}, ${summary.count})
            ON DUPLICATE KEY UPDATE
              total_income_minor  = VALUES(total_income_minor),
              total_expense_minor = VALUES(total_expense_minor),
              net_minor           = VALUES(net_minor),
              transaction_count   = VALUES(transaction_count),
              updated_at          = CURRENT_TIMESTAMP`,
      )
    } catch { /* silencia */ }

    return res.json({
      source: 'live',
      data: {
        ownerId: owner.id,
        month,
        totalIncomeMinor: summary.income.toString(),
        totalExpenseMinor: summary.expense.toString(),
        netMinor: summary.net.toString(),
        transactionCount: summary.count,
      },
    })
  } catch (err: any) {
    console.error('[readModels] transaction-summary error:', err)
    return res.status(500).json({ error: 'Erro ao calcular resumo de transações' })
  }
})

// ---------------------------------------------------------------------------
// POST /api/read-models/backfill
// Força recálculo de todos os read models do owner para os últimos 6 meses.
// ---------------------------------------------------------------------------
router.post('/backfill', async (req: Request, res: Response) => {
  try {
    const db = getDatabase()
    const owner = await resolveOwnerId(req.authUser!.clerkUserId)
    const month = currentMonth()
    const months = [-5, -4, -3, -2, -1, 0].map((offset) => addMonths(month, offset))

    const results: Record<string, string> = {}

    for (const m of months) {
      try {
        const summary = await computeTransactionSummary(db, owner.id, m)
        await db.execute(
          sql`INSERT INTO transaction_month_summary
                (owner_id, month, total_income_minor, total_expense_minor, net_minor, transaction_count)
              VALUES
                (${owner.id}, ${m}, ${summary.income}, ${summary.expense}, ${summary.net}, ${summary.count})
              ON DUPLICATE KEY UPDATE
                total_income_minor  = VALUES(total_income_minor),
                total_expense_minor = VALUES(total_expense_minor),
                net_minor           = VALUES(net_minor),
                transaction_count   = VALUES(transaction_count),
                updated_at          = CURRENT_TIMESTAMP`,
        )
        results[m] = 'ok'
      } catch (e: any) {
        results[m] = `error: ${e.message}`
      }
    }

    // Recalcula dashboard snapshot
    try {
      const snap = await computeDashboardSnapshot(db, owner.id)
      const today = new Date().toISOString().slice(0, 10)
      await db.execute(
        sql`INSERT INTO dashboard_snapshot
              (owner_id, snapshot_date, current_month,
               total_balance_minor, open_invoices_total_minor, open_invoices_count,
               next_due_date, next_due_amount_minor,
               month_income_minor, month_expense_minor, accounts_json)
            VALUES
              (${owner.id}, ${today}, ${snap.currentMonth},
               ${snap.totalBalanceMinor}, ${snap.openInvoicesTotalMinor}, ${snap.openInvoicesCount},
               ${snap.nextDueDate}, ${snap.nextDueAmountMinor},
               ${snap.monthIncomeMinor}, ${snap.monthExpenseMinor},
               ${JSON.stringify(snap.accountsJson)})
            ON DUPLICATE KEY UPDATE
              total_balance_minor         = VALUES(total_balance_minor),
              open_invoices_total_minor   = VALUES(open_invoices_total_minor),
              open_invoices_count         = VALUES(open_invoices_count),
              next_due_date               = VALUES(next_due_date),
              next_due_amount_minor       = VALUES(next_due_amount_minor),
              month_income_minor          = VALUES(month_income_minor),
              month_expense_minor         = VALUES(month_expense_minor),
              accounts_json               = VALUES(accounts_json),
              updated_at                  = CURRENT_TIMESTAMP`,
      )
      results['dashboard_snapshot'] = 'ok'
    } catch (e: any) {
      results['dashboard_snapshot'] = `error: ${e.message}`
    }

    return res.json({ backfill: 'complete', months, results })
  } catch (err: any) {
    console.error('[readModels] backfill error:', err)
    return res.status(500).json({ error: 'Erro no backfill dos read models' })
  }
})

export const readModelsRouter = router

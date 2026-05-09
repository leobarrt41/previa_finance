/**
 * routes/cashflow.ts - CashFlow projection endpoints
 * 
 * Integra com o CashFlowEngine do @previa/core para projeções financeiras
 */

import { Router, Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { CashFlowEngine, CashFlowInput } from '@previa/core'
import { transactions, accounts, cardInvoices, cardTransactions, cashflowForecasts, cashflowForecastMonthStatus, receiptDocuments } from '@previa/db'
import { and, eq, inArray, gte, lte, sql } from 'drizzle-orm'
import { createError } from '../middlewares/errorHandler.js'
import { getDatabase } from '../config/database.js'
import { resolveOwnerId } from '../services/ownerStore.js'
import { requireClerkAuth } from '../middlewares/auth.js'

const router: Router = Router()
router.use(requireClerkAuth)

function buildProjectionMonths(startMonth: string, months: number): string[] {
  const [yearPart, monthPart] = startMonth.split('-')
  const year = Number(yearPart)
  const month = Number(monthPart)

  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error('Invalid start month')
  }

  const result: string[] = []
  for (let i = 0; i < months; i++) {
    const date = new Date(Date.UTC(year, month - 1 + i, 1))
    const nextYear = date.getUTCFullYear()
    const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0')
    result.push(`${nextYear}-${nextMonth}`)
  }

  return result
}

function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') return BigInt(value)
  if (typeof value === 'string') return BigInt(value)
  return 0n
}

function absMinor(value: bigint): bigint {
  return value < 0n ? -value : value
}

function addMonths(month: string, offset: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + offset, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function compareMonths(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

function isValidMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value)
}

function normalizeForecastAmount(amountMinor: bigint): bigint {
  return amountMinor
}

function shouldApplyForecastInMonth(
  forecast: { competencyMonth: string; recurrence?: string; recurrenceEnd?: string | null },
  month: string,
): boolean {
  if (month < forecast.competencyMonth) return false
  if (forecast.recurrenceEnd && month > forecast.recurrenceEnd) return false

  const recurrence = forecast.recurrence ?? 'one-time'
  if (recurrence === 'one-time') {
    return month === forecast.competencyMonth
  }

  if (recurrence === 'monthly') {
    return true
  }

  if (recurrence === 'yearly') {
    return month.slice(5) === forecast.competencyMonth.slice(5)
  }

  return false
}

function expandForecastsForProjection(
  projectionMonths: string[],
  persistedForecasts: Array<{
    id: string
    competencyMonth: string
    amountMinor: bigint
    recurrence: string
    recurrenceEnd: string | null
    description: string | null
    isActive: boolean
  }>,
  paidMonthsByForecastId: Map<string, Set<string>>,
) {
  const rows: Array<{
    id: string
    competencyMonth: string
    amountMinor: bigint
    recurrence: 'one-time'
    recurrenceEnd?: undefined
    description?: string
    isActive: true
  }> = []

  for (const forecast of persistedForecasts) {
    if (!forecast.isActive) continue
    const paidMonths = paidMonthsByForecastId.get(forecast.id) ?? new Set<string>()

    for (const month of projectionMonths) {
      if (!shouldApplyForecastInMonth(forecast, month)) continue
      if (paidMonths.has(month)) continue

      rows.push({
        id: `${forecast.id}:${month}`,
        competencyMonth: month,
        amountMinor: normalizeForecastAmount(forecast.amountMinor),
        recurrence: 'one-time',
        description: forecast.description ?? undefined,
        isActive: true,
      })
    }
  }

  return rows
}

// Schema de validação para projeção
const CashFlowRequestSchema = z.object({
  startMonth: z.string().regex(/^\d{4}-\d{2}$/, 'Format must be YYYY-MM'),
  months: z.number().min(1).max(24),
  openingBalanceMinor: z.union([z.number(), z.bigint()]).optional().default(0),
  
  // Transações opcionais
  transactions: z.array(z.object({
    id: z.string(),
    competencyMonth: z.string(),
    amountMinor: z.union([z.number(), z.bigint()]),
    type: z.enum(['income', 'expense', 'transfer', 'card_purchase', 'liability_payment']),
    description: z.string().optional()
  })).optional(),

  // Projeções avulsas opcionais (não são extrato)
  extraForecasts: z.array(z.object({
    id: z.string(),
    competencyMonth: z.string().regex(/^\d{4}-\d{2}$/, 'Format must be YYYY-MM'),
    amountMinor: z.union([z.number(), z.bigint()]),
    recurrence: z.enum(['one-time', 'monthly', 'yearly']).optional(),
    recurrenceEnd: z.string().optional(),
    description: z.string().optional(),
    isActive: z.boolean().default(true)
  })).optional(),
  
  // Faturas de cartão opcionais
  cardInvoices: z.array(z.object({
    id: z.string(),
    competencyMonth: z.string(),
    dueMonth: z.string(),
    amountMinor: z.union([z.number(), z.bigint()]),
    paidMinor: z.union([z.number(), z.bigint()]).optional()
  })).optional(),
  
  // Previsões opcionais (forecast support)
  forecasts: z.array(z.object({
    id: z.string(),
    competencyMonth: z.string(),
    amountMinor: z.union([z.number(), z.bigint()]),
    recurrence: z.enum(['one-time', 'monthly', 'yearly']).optional(),
    recurrenceEnd: z.string().optional(),
    description: z.string().optional(),
    isActive: z.boolean().default(true)
  })).optional()
})

const RecurringForecastPayloadSchema = z.object({
  competencyMonth: z.string().regex(/^\d{4}-\d{2}$/, 'Format must be YYYY-MM'),
  amountMinor: z.union([z.number(), z.bigint()]),
  recurrence: z.enum(['one-time', 'monthly', 'yearly']).default('monthly'),
  recurrenceEnd: z.string().regex(/^\d{4}-\d{2}$/, 'Format must be YYYY-MM').nullable().optional(),
  description: z.string().trim().max(300).optional(),
  isActive: z.boolean().default(true),
})

const RecurringMonthStatusPayloadSchema = z.object({
  competencyMonth: z.string().regex(/^\d{4}-\d{2}$/, 'Format must be YYYY-MM'),
  isPaid: z.boolean(),
})

router.get('/recurring-transactions', async (req: Request, res: Response) => {
  const db = getDatabase()
  const owner = await resolveOwnerId(req.authUser!.clerkUserId)

  const [forecastRows, statusRows] = await Promise.all([
    db
      .select({
        id: cashflowForecasts.id,
        competencyMonth: cashflowForecasts.competencyMonth,
        amountMinor: cashflowForecasts.amountMinor,
        recurrence: cashflowForecasts.recurrence,
        recurrenceEnd: cashflowForecasts.recurrenceEnd,
        description: cashflowForecasts.description,
        isActive: cashflowForecasts.isActive,
        createdAt: cashflowForecasts.createdAt,
        updatedAt: cashflowForecasts.updatedAt,
      })
      .from(cashflowForecasts)
      .where(eq(cashflowForecasts.userId, owner.id)),
    db
      .select({
        forecastId: cashflowForecastMonthStatus.forecastId,
        competencyMonth: cashflowForecastMonthStatus.competencyMonth,
        isPaid: cashflowForecastMonthStatus.isPaid,
        status: cashflowForecastMonthStatus.status,
      })
      .from(cashflowForecastMonthStatus)
      .where(eq(cashflowForecastMonthStatus.userId, owner.id)),
  ])

  const paidMonthsByForecastId = new Map<string, string[]>()
  for (const row of statusRows) {
    if (!(row.status ? row.status === 'realized' : row.isPaid)) continue
    const list = paidMonthsByForecastId.get(row.forecastId) ?? []
    list.push(row.competencyMonth)
    paidMonthsByForecastId.set(row.forecastId, list)
  }

  res.json({
    items: forecastRows.map((row) => ({
      id: row.id,
      competencyMonth: row.competencyMonth,
      amountMinor: Number(row.amountMinor),
      recurrence: row.recurrence,
      recurrenceEnd: row.recurrenceEnd,
      description: row.description ?? undefined,
      isActive: row.isActive,
      paidMonths: paidMonthsByForecastId.get(row.id) ?? [],
      createdAt: row.createdAt?.toISOString?.() ?? null,
      updatedAt: row.updatedAt?.toISOString?.() ?? null,
    })),
  })
})

router.post('/recurring-transactions', async (req: Request, res: Response) => {
  const payload = RecurringForecastPayloadSchema.parse(req.body)
  const db = getDatabase()
  const owner = await resolveOwnerId(req.authUser!.clerkUserId)

  const id = `fc-${randomUUID()}`
  const amountMinor = BigInt(payload.amountMinor)

  await db.insert(cashflowForecasts).values({
    id,
    userId: owner.id,
    externalOwnerId: String(owner.id),
    competencyMonth: payload.competencyMonth,
    amountMinor,
    recurrence: payload.recurrence,
    recurrenceEnd: payload.recurrenceEnd ?? null,
    description: payload.description ?? null,
    isActive: payload.isActive,
    createdBy: req.authUser!.clerkUserId,
    updatedAt: new Date(),
  })

  res.status(201).json({
    id,
    competencyMonth: payload.competencyMonth,
    amountMinor: Number(amountMinor),
    recurrence: payload.recurrence,
    recurrenceEnd: payload.recurrenceEnd ?? null,
    description: payload.description ?? undefined,
    isActive: payload.isActive,
    paidMonths: [],
  })
})

router.patch('/recurring-transactions/:id', async (req: Request, res: Response) => {
  const payload = RecurringForecastPayloadSchema.partial().parse(req.body)
  const db = getDatabase()
  const owner = await resolveOwnerId(req.authUser!.clerkUserId)
  const id = req.params.id

  if (payload.recurrenceEnd !== undefined && payload.recurrenceEnd !== null && !isValidMonth(payload.recurrenceEnd)) {
    throw createError('recurrenceEnd must be YYYY-MM', 400)
  }

  const values: Record<string, unknown> = { updatedAt: new Date() }
  if (payload.competencyMonth !== undefined) values.competencyMonth = payload.competencyMonth
  if (payload.amountMinor !== undefined) values.amountMinor = BigInt(payload.amountMinor)
  if (payload.recurrence !== undefined) values.recurrence = payload.recurrence
  if (payload.recurrenceEnd !== undefined) values.recurrenceEnd = payload.recurrenceEnd
  if (payload.description !== undefined) values.description = payload.description
  if (payload.isActive !== undefined) values.isActive = payload.isActive

  const [existing] = await db
    .select({ id: cashflowForecasts.id })
    .from(cashflowForecasts)
    .where(and(eq(cashflowForecasts.id, id), eq(cashflowForecasts.userId, owner.id)))
    .limit(1)

  if (!existing) {
    throw createError('Recurring transaction not found', 404)
  }

  await db
    .update(cashflowForecasts)
    .set(values)
    .where(and(eq(cashflowForecasts.id, id), eq(cashflowForecasts.userId, owner.id)))

  res.json({ ok: true })
})

router.delete('/recurring-transactions/:id', async (req: Request, res: Response) => {
  const db = getDatabase()
  const owner = await resolveOwnerId(req.authUser!.clerkUserId)
  const id = req.params.id

  await db
    .delete(cashflowForecastMonthStatus)
    .where(and(eq(cashflowForecastMonthStatus.forecastId, id), eq(cashflowForecastMonthStatus.userId, owner.id)))

  const [existing] = await db
    .select({ id: cashflowForecasts.id })
    .from(cashflowForecasts)
    .where(and(eq(cashflowForecasts.id, id), eq(cashflowForecasts.userId, owner.id)))
    .limit(1)

  if (!existing) {
    throw createError('Recurring transaction not found', 404)
  }

  await db
    .delete(cashflowForecasts)
    .where(and(eq(cashflowForecasts.id, id), eq(cashflowForecasts.userId, owner.id)))

  res.status(204).send()
})

router.put('/recurring-transactions/:id/month-status', async (req: Request, res: Response) => {
  const payload = RecurringMonthStatusPayloadSchema.parse(req.body)
  const db = getDatabase()
  const owner = await resolveOwnerId(req.authUser!.clerkUserId)
  const id = req.params.id

  const [forecast] = await db
    .select({ id: cashflowForecasts.id })
    .from(cashflowForecasts)
    .where(and(eq(cashflowForecasts.id, id), eq(cashflowForecasts.userId, owner.id)))
    .limit(1)

  if (!forecast) {
    throw createError('Recurring transaction not found', 404)
  }

  await db
    .insert(cashflowForecastMonthStatus)
    .values({
      forecastId: id,
      userId: owner.id,
      competencyMonth: payload.competencyMonth,
      isPaid: payload.isPaid,
      status: payload.isPaid ? 'realized' : 'pending',
      resolvedAt: payload.isPaid ? new Date() : null,
      updatedAt: new Date(),
    })
    .onDuplicateKeyUpdate({
      set: {
        isPaid: payload.isPaid,
        status: payload.isPaid ? 'realized' : 'pending',
        resolvedAt: payload.isPaid ? new Date() : null,
        updatedAt: new Date(),
      },
    })

  res.json({ ok: true })
})

/**
 * POST /api/cashflow/projection
 * Gera projeção de fluxo de caixa usando CashFlowEngine
 */
router.post('/projection', async (req: Request, res: Response) => {
  try {
    // Validação dos dados
    const data = CashFlowRequestSchema.parse(req.body)
    const projectionMonths = buildProjectionMonths(data.startMonth, data.months)
    const startMonth = projectionMonths[0]
    const endMonth = projectionMonths[projectionMonths.length - 1]

    const db = getDatabase()
    const owner = await resolveOwnerId(req.authUser!.clerkUserId)

    const useDbTransactions = !data.transactions || data.transactions.length === 0
    const useDbCardInvoices = !data.cardInvoices || data.cardInvoices.length === 0

    const dbTransactions = useDbTransactions
      ? await db
          .select({
            id: transactions.id,
            competencyMonth: transactions.competencyMonth,
            movementType: transactions.movementType,
            amountMinor: transactions.amountMinor,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.userId, owner.id),
              inArray(transactions.movementType, ['income', 'expense', 'transfer', 'liability_payment', 'card_purchase']),
              gte(transactions.competencyMonth, startMonth),
              lte(transactions.competencyMonth, endMonth),
            ),
          )
      : []

    const dbCardInvoices = useDbCardInvoices
      ? await db
          .select({
            id: cardInvoices.id,
            invoiceMonth: cardInvoices.invoiceMonth,
            dueDate: cardInvoices.dueDate,
            totalAmountMinor: cardInvoices.totalAmountMinor,
            paidAmountMinor: cardInvoices.paidAmountMinor,
          })
          .from(cardInvoices)
          .where(
            and(
              eq(cardInvoices.userId, owner.id),
              lte(cardInvoices.invoiceMonth, endMonth),
            ),
          )
      : []

    const dbCardInvoiceSums = useDbCardInvoices
      ? await db
          .select({
            cardInvoiceId: cardTransactions.cardInvoiceId,
            totalMinor: sql<string>`sum(${cardTransactions.amountMinor})`,
          })
          .from(cardTransactions)
          .where(eq(cardTransactions.userId, owner.id))
          .groupBy(cardTransactions.cardInvoiceId)
      : []

    const dbInstallments = useDbCardInvoices
      ? await db
          .select({
            id: cardTransactions.id,
            competencyMonth: cardTransactions.competencyMonth,
            amountMinor: cardTransactions.amountMinor,
            installmentNumber: cardTransactions.installmentNumber,
            installmentTotal: cardTransactions.installmentTotal,
          })
          .from(cardTransactions)
          .where(eq(cardTransactions.userId, owner.id))
      : []

    const dbLiabilityPayments = useDbCardInvoices && useDbTransactions
      ? await db
          .select({
            competencyMonth: transactions.competencyMonth,
            amountMinor: transactions.amountMinor,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.userId, owner.id),
              eq(transactions.movementType, 'liability_payment'),
              lte(transactions.competencyMonth, endMonth),
            ),
          )
      : []

    const sumByInvoiceId = new Map<string, bigint>(
      dbCardInvoiceSums.map((row) => [String(row.cardInvoiceId), toBigInt(row.totalMinor)]),
    )

    const normalizedTransactions = useDbTransactions
      ? dbTransactions.map((t) => {
          const type = t.movementType as 'income' | 'expense' | 'transfer' | 'liability_payment' | 'card_purchase'
          const rawAmount = toBigInt(t.amountMinor)
          const amountMinor = type === 'transfer' ? rawAmount : absMinor(rawAmount)
          return {
            id: String(t.id),
            competencyMonth: t.competencyMonth,
            type,
            amountMinor,
          }
        })
      : data.transactions!.map((t) => {
          const rawAmount = BigInt(t.amountMinor)
          const amountMinor = t.type === 'transfer' ? rawAmount : absMinor(rawAmount)
          return {
            ...t,
            amountMinor,
          }
        })

    const statementOutflowByMonth = new Map<string, bigint>()
    for (const tx of normalizedTransactions) {
      if (tx.type !== 'expense' && tx.type !== 'liability_payment') continue
      const current = statementOutflowByMonth.get(tx.competencyMonth) ?? 0n
      statementOutflowByMonth.set(tx.competencyMonth, current + absMinor(toBigInt(tx.amountMinor)))
    }

    const normalizedCardInvoices = useDbCardInvoices
      ? dbCardInvoices
          .map((ci) => {
            const dueMonth = ci.dueDate instanceof Date
              ? `${ci.dueDate.getUTCFullYear()}-${String(ci.dueDate.getUTCMonth() + 1).padStart(2, '0')}`
              : String(ci.dueDate).slice(0, 7)
            const totalFromInvoice = toBigInt(ci.totalAmountMinor)
            const totalFromTransactions = sumByInvoiceId.get(String(ci.id)) ?? 0n
            const resolvedAmount = totalFromInvoice > 0n ? totalFromInvoice : totalFromTransactions

            return {
              id: String(ci.id),
              competencyMonth: ci.invoiceMonth,
              dueMonth,
              amountMinor: resolvedAmount,
              paidMinor: toBigInt(ci.paidAmountMinor ?? 0n),
            }
          })
      : data.cardInvoices!.map((ci) => ({
          ...ci,
          amountMinor: BigInt(ci.amountMinor),
          paidMinor: ci.paidMinor !== undefined ? BigInt(ci.paidMinor) : undefined,
        }))

    const inferredPaidCardInvoices = useDbCardInvoices
      ? (() => {
          const remainingByMonth = new Map<string, bigint>()
          for (const row of dbLiabilityPayments) {
            const month = row.competencyMonth
            const value = absMinor(toBigInt(row.amountMinor))
            remainingByMonth.set(month, (remainingByMonth.get(month) ?? 0n) + value)
          }

          // Include pre-startMonth payment months so old invoices can be matched
          const monthCursor = [...new Set([
            ...Array.from(remainingByMonth.keys()),
            ...buildProjectionMonths(startMonth, data.months),
          ])].sort()
          const invoicesSorted = [...normalizedCardInvoices].sort((a, b) => compareMonths(a.dueMonth, b.dueMonth))

          return invoicesSorted.map((invoice) => {
            let paidMinor = toBigInt(invoice.paidMinor ?? 0n)
            const totalMinor = toBigInt(invoice.amountMinor)
            if (paidMinor >= totalMinor) {
              return invoice
            }

            // Projection fallback: when invoice paid amount is not reconciled, infer from liability payments.
            // Only match payments within ±2 months of the invoice dueMonth to prevent a payment for
            // invoice A from being consumed by an older unrelated invoice B.
            if (paidMinor === 0n) {
              const latestPaymentMonth = addMonths(invoice.dueMonth, 2)
              for (const month of monthCursor) {
                if (month < invoice.dueMonth) continue
                if (month > latestPaymentMonth) break
                const available = remainingByMonth.get(month) ?? 0n
                if (available <= 0n) continue
                const remaining = totalMinor - paidMinor
                if (remaining <= 0n) break
                const allocation = available < remaining ? available : remaining
                paidMinor += allocation
                remainingByMonth.set(month, available - allocation)
                if (paidMinor >= totalMinor) break
              }
            }

            return {
              ...invoice,
              paidMinor,
            }
          })
        })()
      : normalizedCardInvoices

    const projectedInstallmentInvoices = useDbCardInvoices
      ? dbInstallments.flatMap((tx) => {
          const n = tx.installmentNumber ?? 0
          const t = tx.installmentTotal ?? 0
          if (t <= 0 || n <= 0 || t <= n) return []

          const remaining = t - n
          const amountMinor = toBigInt(tx.amountMinor)
          const baseMonth = tx.competencyMonth
          const rows: Array<{ id: string; competencyMonth: string; dueMonth: string; amountMinor: bigint; paidMinor: bigint }> = []

          for (let step = 1; step <= remaining; step++) {
            const dueMonth = addMonths(baseMonth, step)
            if (dueMonth < startMonth || dueMonth > endMonth) continue
            rows.push({
              id: `inst-${tx.id}-${step}`,
              competencyMonth: baseMonth,
              dueMonth,
              amountMinor,
              paidMinor: 0n,
            })
          }

          return rows
        })
      : []

    const finalCardInvoices = [...inferredPaidCardInvoices, ...projectedInstallmentInvoices]

    // -------------------------------------------------------------------------
    // Injectar receipt_documents projected no engine
    // Cartão (expectedInvoiceMonth preenchido) → cardInvoice sintética (laranja)
    // Débito (sem expectedInvoiceMonth) → transaction expense (vermelho)
    // Notas reconciliadas ou canceladas são ignoradas — o dado real já está no banco
    // -------------------------------------------------------------------------
    const dbReceiptDocs = useDbTransactions
      ? await db
          .select()
          .from(receiptDocuments)
          .where(
            and(
              eq(receiptDocuments.ownerId, owner.id),
              eq(receiptDocuments.dataState, 'projected'),
            )
          )
      : []

    const receiptCardInvoices: typeof finalCardInvoices = []
    const receiptTransactions: typeof normalizedTransactions = []

    for (const doc of dbReceiptDocs) {
      const amountMinor = BigInt(doc.amountMinor ?? 0)
      if (amountMinor <= 0n) continue

      if (doc.expectedInvoiceMonth) {
        // Cartão: entra como cardInvoice sintética no mês da fatura estimada
        const dueMonth = doc.expectedInvoiceMonth
        if (dueMonth >= startMonth && dueMonth <= endMonth) {
          receiptCardInvoices.push({
            id: `receipt-card-${doc.id}`,
            competencyMonth: doc.purchaseMonth ?? dueMonth,
            dueMonth,
            amountMinor,
            paidMinor: 0n,
          })
        }
      } else {
        // Débito: entra como expense no mês da compra
        const compMonth = doc.purchaseMonth ?? startMonth
        if (compMonth >= startMonth && compMonth <= endMonth) {
          receiptTransactions.push({
            id: `receipt-debit-${doc.id}`,
            competencyMonth: compMonth,
            type: 'expense' as const,
            amountMinor,
          })
        }
      }
    }

    const allCardInvoices = [...finalCardInvoices, ...receiptCardInvoices]
    const allTransactions = [...normalizedTransactions, ...receiptTransactions]

    const shouldUsePersistedForecasts = !data.forecasts || data.forecasts.length === 0

    const [persistedForecastRows, persistedStatusRows] = shouldUsePersistedForecasts
      ? await Promise.all([
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
              status: cashflowForecastMonthStatus.status,
            })
            .from(cashflowForecastMonthStatus)
            .where(eq(cashflowForecastMonthStatus.userId, owner.id)),
        ])
      : [[], []]

    const paidMonthsByForecastId = new Map<string, Set<string>>()
    for (const row of persistedStatusRows) {
      if (!(row.status ? row.status === 'realized' : row.isPaid)) continue
      const set = paidMonthsByForecastId.get(row.forecastId) ?? new Set<string>()
      set.add(row.competencyMonth)
      paidMonthsByForecastId.set(row.forecastId, set)
    }

    const normalizedForecasts = shouldUsePersistedForecasts
      ? expandForecastsForProjection(
          projectionMonths,
          persistedForecastRows.map((f) => ({
            ...f,
            amountMinor: toBigInt(f.amountMinor),
            recurrence: f.recurrence ?? 'one-time',
            recurrenceEnd: f.recurrenceEnd ?? null,
            description: f.description ?? null,
            isActive: Boolean(f.isActive),
          })),
          paidMonthsByForecastId,
        )
      : (data.forecasts ?? []).map((f) => ({
          ...f,
          amountMinor: BigInt(f.amountMinor),
        }))

    const extraForecasts = (data.extraForecasts ?? []).map((f) => ({
      ...f,
      amountMinor: BigInt(f.amountMinor),
      recurrence: f.recurrence ?? 'one-time',
      recurrenceEnd: f.recurrenceEnd ?? null,
    }))
    
    // Converter para formato do CashFlowEngine
    const input: CashFlowInput = {
      openingBalanceMinor: BigInt(data.openingBalanceMinor ?? 0),
      projectionMonths,
      currentMonth: data.startMonth,
      transactions: allTransactions,
      cardInvoices: allCardInvoices,
      forecasts: [...normalizedForecasts, ...extraForecasts],
    }

    // Processar projeção
    const projection = CashFlowEngine.project(input)

    // Novo painel: compras do mês, aberto anterior, total fatura
    let cardInvoicesPanel: Array<{
      invoiceMonth: string
      institutionName: string | null
      cardBrand: string | null
      cardLast4: string | null
      comprasDoMesMinor: string
      abertoAnteriorMinor: string
      totalFaturaMinor: string
      totalAmountMinor: string
      previousBalanceMinor: string
      paidAmountMinor: string
      openAmountMinor: string
    }> = []
    if (useDbCardInvoices) {
      // Buscar todas as faturas do período
      const invoices = await db
        .select({
          id: cardInvoices.id,
          accountId: cardInvoices.accountId,
          invoiceMonth: cardInvoices.invoiceMonth,
          // Fix: COALESCE com accounts para quando institutionName não está na fatura (ex: import OFX)
          institutionName: sql<string | null>`COALESCE(${cardInvoices.institutionName}, ${accounts.institutionName})`,
          cardBrand: sql<string | null>`COALESCE(${cardInvoices.cardBrand}, ${accounts.cardBrand})`,
          cardLast4: sql<string | null>`COALESCE(${cardInvoices.cardLast4}, ${accounts.cardLast4})`,
          totalAmountMinor: cardInvoices.totalAmountMinor,
          previousBalanceMinor: cardInvoices.previousBalanceMinor,
          paidAmountMinor: cardInvoices.paidAmountMinor,
          openAmountMinor: cardInvoices.openAmountMinor,
        })
        .from(cardInvoices)
        .leftJoin(accounts, eq(accounts.id, cardInvoices.accountId))
        .where(
          and(
            eq(cardInvoices.userId, owner.id),
            gte(cardInvoices.invoiceMonth, startMonth),
            lte(cardInvoices.invoiceMonth, endMonth),
          ),
        )

      const purchases = await db
        .select({
          cardInvoiceId: cardTransactions.cardInvoiceId,
          sumPurchases: sql<string>`SUM(${cardTransactions.amountMinor})`,
        })
        .from(cardTransactions)
        .where(
          and(
            eq(cardTransactions.userId, owner.id),
            gte(cardTransactions.competencyMonth, startMonth),
            lte(cardTransactions.competencyMonth, endMonth),
          ),
        )
        .groupBy(cardTransactions.cardInvoiceId)
      const purchasesByInvoice = new Map<string, bigint>()
      for (const row of purchases) {
        purchasesByInvoice.set(String(row.cardInvoiceId), toBigInt(row.sumPurchases))
      }

      cardInvoicesPanel = invoices.map(inv => {
        const totalFatura = toBigInt(inv.totalAmountMinor ?? 0n)
        const abertoAnterior = toBigInt(inv.previousBalanceMinor ?? 0n)
        const purchasesMinor = purchasesByInvoice.get(String(inv.id)) ?? 0n
        return {
          invoiceMonth: inv.invoiceMonth,
          institutionName: inv.institutionName,
          cardBrand: inv.cardBrand,
          cardLast4: inv.cardLast4,
          comprasDoMesMinor: purchasesMinor.toString(),
          abertoAnteriorMinor: abertoAnterior.toString(),
          totalFaturaAnteriorMinor: abertoAnterior.toString(),
          totalFaturaMinor: totalFatura.toString(),
          totalAmountMinor: inv.totalAmountMinor?.toString() ?? '0',
          previousBalanceMinor: inv.previousBalanceMinor?.toString() ?? '0',
          paidAmountMinor: inv.paidAmountMinor?.toString() ?? '0',
          openAmountMinor: inv.openAmountMinor?.toString() ?? '0',
        }
      })
    }

    const response = {
      ...projection,
      monthly: projection.monthly.map(month => ({
        ...month,
        openingBalanceMinor: month.openingBalanceMinor.toString(),
        totalIncomeMinor: month.totalIncomeMinor.toString(),
        totalExpenseMinor: month.totalExpenseMinor.toString(),
        totalLiabilityPaymentMinor: month.totalLiabilityPaymentMinor.toString(),
        statementOutflowMinor: (statementOutflowByMonth.get(month.competencyMonth) ?? 0n).toString(),
        totalCommittedMinor: month.totalCommittedMinor.toString(),
        projectedClosingBalanceMinor: month.projectedClosingBalanceMinor.toString(),
        debtOpenMinor: month.debtOpenMinor.toString()
      })),
      cardInvoicesByMonth: cardInvoicesPanel,
    }
    res.json(response)
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Validation failed',
        details: error.errors
      })
      return
    }
    
    throw createError('Failed to generate cashflow projection', 500)
  }
})

/**
 * GET /api/cashflow/example
 * Retorna exemplo de payload para facilitar integração do frontend
 */
router.get('/example', (req: Request, res: Response) => {
  const example = {
    request: {
      startMonth: "2026-05",
      months: 6,
      openingBalanceMinor: 100000, // R$ 1000.00
      transactions: [
        {
          id: "tx-1",
          competencyMonth: "2026-05",
          amountMinor: 500000, // R$ 5000.00 
          type: "income",
          description: "Salário"
        },
        {
          id: "tx-2",
          competencyMonth: "2026-05",
          amountMinor: -150000, // R$ -1500.00
          type: "expense", 
          description: "Aluguel"
        }
      ],
      cardInvoices: [
        {
          id: "invoice-1",
          competencyMonth: "2026-05",
          dueMonth: "2026-06",
          amountMinor: 75000,
          paidMinor: 0
        }
      ],
      forecasts: [
        {
          id: "forecast-1",
          competencyMonth: "2026-06",
          amountMinor: 500000,
          recurrence: "one-time",
          description: "Salário recorrente",
          isActive: true
        }
      ]
    },
    response_format: {
      monthly: [
        {
          competencyMonth: "2026-05",
          openingBalanceMinor: "100000",
          totalIncomeMinor: "500000", 
          totalExpenseMinor: "150000",
          totalLiabilityPaymentMinor: "0",
          statementOutflowMinor: "150000",
          totalCommittedMinor: "0",
          projectedClosingBalanceMinor: "450000",
          debtOpenMinor: "0"
        }
      ]
    }
  }
  
  res.json(example)
})

export { router as cashflowRouter }

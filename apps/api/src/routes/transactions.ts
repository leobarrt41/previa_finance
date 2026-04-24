/**
 * routes/transactions.ts - Transaction CRUD endpoints
 */

import { Router, type Request, type Response } from 'express'
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  accounts,
  categories,
  DATA_STATE_VALUES,
  FINANCIAL_CHANNEL_VALUES,
  MOVEMENT_TYPE_VALUES,
  SOURCE_VALUES,
  transactions,
} from '@previa/db'
import { buildFingerprintFromRaw } from '@previa/core'
import { getDatabase } from '../config/database.js'
import { requireClerkAuth } from '../middlewares/auth.js'
import { createError } from '../middlewares/errorHandler.js'
import { resolveOwnerId } from '../services/ownerStore.js'

const router: Router = Router()

const timestampSchema = z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))

const createTransactionSchema = z.object({
  accountId: z.number().int().positive().optional(),
  amountMinor: z.union([z.number(), z.bigint()]),
  occurredAt: timestampSchema.optional(),
  competencyMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  description: z.string().trim().min(1).max(4000),
  source: z.enum(SOURCE_VALUES).default('manual'),
  dataState: z.enum(DATA_STATE_VALUES).default('consolidated'),
  movementType: z.enum(MOVEMENT_TYPE_VALUES),
  movementSubtype: z.string().trim().max(50).optional(),
  financialChannel: z.enum(FINANCIAL_CHANNEL_VALUES).default('bank_account'),
  categoryId: z.string().trim().min(1).max(128).optional(),
  balanceAfterMinor: z.union([z.number(), z.bigint()]).optional(),
  isRecurring: z.boolean().optional(),
  recurringRuleId: z.number().int().positive().optional(),
  reconciledGroupId: z.string().trim().max(255).optional(),
})

const listQuerySchema = z.object({
  startMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  endMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  accountId: z.coerce.number().int().positive().optional(),
  categoryId: z.string().trim().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

const updateTransactionSchema = createTransactionSchema.partial().extend({
  amountMinor: z.union([z.number(), z.bigint()]).optional(),
  description: z.string().trim().min(1).max(4000).optional(),
})

function toMinor(value: number | bigint) {
  return typeof value === 'bigint' ? value : BigInt(value)
}

function toDateInput(value?: string) {
  return value ?? new Date().toISOString()
}

function toCompetencyMonth(dateInput: string) {
  return dateInput.slice(0, 7)
}

async function resolveDefaultAccountId(ownerId: number) {
  const db = getDatabase()
  const [existing] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.userId, ownerId))
    .orderBy(desc(accounts.id))
    .limit(1)

  if (existing) {
    return existing.id
  }

  await db.insert(accounts).values({
    userId: ownerId,
    type: 'CHECKING',
    financialChannel: 'bank_account',
    displayName: 'Conta principal',
    source: 'manual',
    currencyCode: 'BRL',
    isActive: true,
  })

  const [created] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.userId, ownerId))
    .orderBy(desc(accounts.id))
    .limit(1)

  if (!created) {
    throw createError('Failed to create default account', 500)
  }

  return created.id
}

router.use(requireClerkAuth)

router.get('/', async (req: Request, res: Response) => {
  const owner = await resolveOwnerId(req.authUser!.clerkUserId)
  const query = listQuerySchema.parse(req.query)
  const db = getDatabase()

  const filters = [eq(transactions.userId, owner.id)]
  if (query.accountId) {
    filters.push(eq(transactions.accountId, query.accountId))
  }
  if (query.categoryId) {
    filters.push(eq(transactions.categoryId, query.categoryId))
  }
  if (query.startMonth) {
    filters.push(gte(transactions.competencyMonth, query.startMonth))
  }
  if (query.endMonth) {
    filters.push(lte(transactions.competencyMonth, query.endMonth))
  }

  const rows = await db
    .select()
    .from(transactions)
    .where(and(...filters))
    .orderBy(desc(transactions.occurredAt))
    .limit(query.limit ?? 100)

  res.json({
    items: rows.map((row) => ({
      ...row,
      amountMinor: row.amountMinor.toString(),
      balanceAfterMinor: row.balanceAfterMinor?.toString() ?? null,
      categoryId: row.categoryId ?? null,
    })),
  })
})

router.get('/:id', async (req: Request, res: Response) => {
  const owner = await resolveOwnerId(req.authUser!.clerkUserId)
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    throw createError('Invalid transaction id', 400)
  }

  const db = getDatabase()
  const [row] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, owner.id)))
    .limit(1)

  if (!row) {
    throw createError('Transaction not found', 404)
  }

  res.json({
    ...row,
    amountMinor: row.amountMinor.toString(),
    balanceAfterMinor: row.balanceAfterMinor?.toString() ?? null,
    categoryId: row.categoryId ?? null,
  })
})

router.post('/', async (req: Request, res: Response) => {
  const owner = await resolveOwnerId(req.authUser!.clerkUserId)
  const body = createTransactionSchema.parse(req.body)
  const db = getDatabase()

  if (body.categoryId) {
    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, body.categoryId))
      .limit(1)

    if (!category) {
      throw createError('Category not found', 400)
    }
  }

  const accountId = body.accountId ?? (await resolveDefaultAccountId(owner.id))
  const occurredAt = toDateInput(body.occurredAt)
  const competencyMonth = body.competencyMonth ?? toCompetencyMonth(occurredAt)
  const amountMinor = toMinor(body.amountMinor)
  const { fingerprint, normalizedDescription } = buildFingerprintFromRaw({
    competencyMonth,
    amountMinor,
    rawDescription: body.description,
  })

  const values = {
    userId: owner.id,
    accountId,
    source: body.source,
    dataState: body.dataState,
    movementType: body.movementType,
    movementSubtype: body.movementSubtype ?? null,
    financialChannel: body.financialChannel,
    amountMinor,
    currencyCode: 'BRL',
    balanceAfterMinor: body.balanceAfterMinor !== undefined ? toMinor(body.balanceAfterMinor) : null,
    occurredAt: new Date(occurredAt),
    competencyMonth,
    description: body.description,
    normalizedDescription,
    categoryId: body.categoryId ?? null,
    installmentNumber: null,
    installmentTotal: null,
    installmentGroupId: null,
    isRecurring: body.isRecurring ?? false,
    recurringRuleId: body.recurringRuleId ?? null,
    fingerprint,
    isReconciled: false,
    reconciledGroupId: body.reconciledGroupId ?? null,
    providerTransactionId: null,
    providerPayload: null,
  }

  const result = await db.insert(transactions).values(values)
  const insertedId = Number((result as { insertId?: number }).insertId || 0)

  res.status(201).json({
    id: insertedId || null,
    ...values,
    amountMinor: amountMinor.toString(),
    balanceAfterMinor: values.balanceAfterMinor?.toString() ?? null,
    categoryId: values.categoryId,
    occurredAt: values.occurredAt.toISOString(),
  })
})

router.put('/:id', async (req: Request, res: Response) => {
  const owner = await resolveOwnerId(req.authUser!.clerkUserId)
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    throw createError('Invalid transaction id', 400)
  }

  const body = updateTransactionSchema.parse(req.body)
  const db = getDatabase()
  const [existing] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, owner.id)))
    .limit(1)

  if (!existing) {
    throw createError('Transaction not found', 404)
  }

  if (body.categoryId) {
    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, body.categoryId))
      .limit(1)

    if (!category) {
      throw createError('Category not found', 400)
    }
  }

  const occurredAt = body.occurredAt ?? existing.occurredAt.toISOString()
  const description = body.description ?? existing.description
  const amountMinor = body.amountMinor !== undefined ? toMinor(body.amountMinor) : existing.amountMinor
  const competencyMonth = body.competencyMonth ?? existing.competencyMonth
  const { fingerprint, normalizedDescription } = buildFingerprintFromRaw({
    competencyMonth,
    amountMinor,
    rawDescription: description,
  })

  const patch = {
    accountId: body.accountId ?? existing.accountId,
    source: body.source ?? existing.source,
    dataState: body.dataState ?? existing.dataState,
    movementType: body.movementType ?? existing.movementType,
    movementSubtype: body.movementSubtype ?? existing.movementSubtype,
    financialChannel: body.financialChannel ?? existing.financialChannel,
    amountMinor,
    balanceAfterMinor: body.balanceAfterMinor !== undefined ? toMinor(body.balanceAfterMinor) : existing.balanceAfterMinor,
    occurredAt: new Date(occurredAt),
    competencyMonth,
    description,
    normalizedDescription,
    categoryId: body.categoryId ?? existing.categoryId,
    isRecurring: body.isRecurring ?? existing.isRecurring,
    recurringRuleId: body.recurringRuleId ?? existing.recurringRuleId,
    fingerprint,
    reconciledGroupId: body.reconciledGroupId ?? existing.reconciledGroupId,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  }

  await db
    .update(transactions)
    .set(patch)
    .where(and(eq(transactions.id, id), eq(transactions.userId, owner.id)))

  const { updatedAt: _updatedAt, ...responsePatch } = patch

  res.json({
    id,
    ...responsePatch,
    amountMinor: amountMinor.toString(),
    balanceAfterMinor: responsePatch.balanceAfterMinor?.toString() ?? null,
    occurredAt: responsePatch.occurredAt.toISOString(),
    categoryId: responsePatch.categoryId ?? null,
  })
})

router.delete('/:id', async (req: Request, res: Response) => {
  const owner = await resolveOwnerId(req.authUser!.clerkUserId)
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    throw createError('Invalid transaction id', 400)
  }

  const db = getDatabase()
  await db
    .delete(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, owner.id)))

  res.json({
    deleted: true,
    id,
  })
})

export { router as transactionRouter }

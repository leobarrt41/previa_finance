/**
 * receiptDocuments.ts — CRUD de notas fiscais e comprovantes avulsos
 *
 * Hierarquia ETP §6.3: nota_fiscal (nível 4) > manual (nível 5)
 * data_state = 'projected'  → entra no cashflow como previsão
 * data_state = 'reconciled' → fatura/extrato real chegou, some do cashflow
 *
 * Endpoints:
 *   GET    /api/receipt-documents           — listar (filtros: month, state, accountId)
 *   POST   /api/receipt-documents           — criar
 *   PUT    /api/receipt-documents/:id       — editar (só projected)
 *   DELETE /api/receipt-documents/:id       — soft delete → cancelled
 *   POST   /api/receipt-documents/:id/reconcile — vincular a card_transaction ou transaction
 *   GET    /api/receipt-documents/summary/:month — totais por estado
 */
import { Router, Request, Response } from 'express'
import { getDatabase } from '../db.js'
import { receiptDocuments } from '@previa/db'
import { eq, and, sql } from 'drizzle-orm'
import { requireAuth } from '../middleware/auth.js'

export const receiptDocumentsRouter = Router()
receiptDocumentsRouter.use(requireAuth)

// ── Helpers ──────────────────────────────────────────────────────────────────
function getOwner(req: Request): { userId: string; ownerId: number } {
  const auth = (req as any).auth
  return { userId: auth.userId, ownerId: auth.ownerId }
}

// ── GET /api/receipt-documents ───────────────────────────────────────────────
receiptDocumentsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { userId, ownerId } = getOwner(req)
    const db = await getDatabase()
    const { month, state, accountId } = req.query

    const conditions = [eq(receiptDocuments.ownerId, ownerId)]
    if (month) conditions.push(eq(receiptDocuments.purchaseMonth, String(month)))
    if (state) conditions.push(eq(receiptDocuments.dataState, String(state)))
    if (accountId) conditions.push(eq(receiptDocuments.accountId, Number(accountId)))

    const rows = await db
      .select()
      .from(receiptDocuments)
      .where(and(...conditions))
      .orderBy(sql`${receiptDocuments.purchaseDate} DESC`)

    res.json({ data: rows })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── GET /api/receipt-documents/summary/:month ────────────────────────────────
receiptDocumentsRouter.get('/summary/:month', async (req: Request, res: Response) => {
  try {
    const { ownerId } = getOwner(req)
    const db = await getDatabase()
    const { month } = req.params

    const rows = await db
      .select({
        dataState: receiptDocuments.dataState,
        count: sql<number>`count(*)`,
        totalMinor: sql<number>`sum(${receiptDocuments.amountMinor})`,
      })
      .from(receiptDocuments)
      .where(and(
        eq(receiptDocuments.ownerId, ownerId),
        eq(receiptDocuments.purchaseMonth, month),
      ))
      .groupBy(receiptDocuments.dataState)

    const summary = { projected: 0, reconciled: 0, cancelled: 0, total: 0 }
    for (const r of rows) {
      const amt = Number(r.totalMinor) || 0
      if (r.dataState === 'projected')  { summary.projected  += amt }
      if (r.dataState === 'reconciled') { summary.reconciled += amt }
      if (r.dataState === 'cancelled')  { summary.cancelled  += amt }
      if (r.dataState !== 'cancelled')  { summary.total      += amt }
    }

    res.json(summary)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/receipt-documents ──────────────────────────────────────────────
receiptDocumentsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { userId, ownerId } = getOwner(req)
    const db = await getDatabase()
    const {
      amountMinor, purchaseDate, purchaseMonth, expectedInvoiceMonth,
      merchantName, merchantCnpj, categoryId, accountId,
      nfeKey, nfeNumber, nfeSeries, fileUrl, fileType,
      installmentTotal, installmentCurrent, description,
    } = req.body

    if (!amountMinor || !purchaseDate || !purchaseMonth) {
      return res.status(400).json({ error: 'amountMinor, purchaseDate e purchaseMonth são obrigatórios' })
    }

    const [result] = await db.insert(receiptDocuments).values({
      userId,
      ownerId,
      amountMinor: Number(amountMinor),
      purchaseDate: new Date(purchaseDate),
      purchaseMonth: String(purchaseMonth),
      expectedInvoiceMonth: expectedInvoiceMonth ? String(expectedInvoiceMonth) : null,
      merchantName: merchantName || null,
      merchantCnpj: merchantCnpj || null,
      categoryId: categoryId || null,
      accountId: accountId ? Number(accountId) : null,
      nfeKey: nfeKey || null,
      nfeNumber: nfeNumber || null,
      nfeSeries: nfeSeries || null,
      fileUrl: fileUrl || null,
      fileType: fileType || null,
      installmentTotal: installmentTotal ? Number(installmentTotal) : null,
      installmentCurrent: installmentCurrent ? Number(installmentCurrent) : null,
      description: description || null,
      dataState: 'projected',
    })

    const [created] = await db
      .select()
      .from(receiptDocuments)
      .where(eq(receiptDocuments.id, (result as any).insertId))

    res.status(201).json(created)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── PUT /api/receipt-documents/:id ──────────────────────────────────────────
receiptDocumentsRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const { ownerId } = getOwner(req)
    const db = await getDatabase()
    const id = Number(req.params.id)

    const [existing] = await db
      .select()
      .from(receiptDocuments)
      .where(and(eq(receiptDocuments.id, id), eq(receiptDocuments.ownerId, ownerId)))

    if (!existing) return res.status(404).json({ error: 'Nota não encontrada' })
    if (existing.dataState !== 'projected') {
      return res.status(400).json({ error: 'Só é possível editar notas com estado projected' })
    }

    const {
      amountMinor, purchaseDate, purchaseMonth, expectedInvoiceMonth,
      merchantName, merchantCnpj, categoryId, accountId,
      nfeKey, fileUrl, fileType, installmentTotal, installmentCurrent, description,
    } = req.body

    await db.update(receiptDocuments).set({
      ...(amountMinor !== undefined && { amountMinor: Number(amountMinor) }),
      ...(purchaseDate !== undefined && { purchaseDate: new Date(purchaseDate) }),
      ...(purchaseMonth !== undefined && { purchaseMonth: String(purchaseMonth) }),
      ...(expectedInvoiceMonth !== undefined && { expectedInvoiceMonth: expectedInvoiceMonth || null }),
      ...(merchantName !== undefined && { merchantName }),
      ...(merchantCnpj !== undefined && { merchantCnpj }),
      ...(categoryId !== undefined && { categoryId }),
      ...(accountId !== undefined && { accountId: accountId ? Number(accountId) : null }),
      ...(nfeKey !== undefined && { nfeKey }),
      ...(fileUrl !== undefined && { fileUrl }),
      ...(fileType !== undefined && { fileType }),
      ...(installmentTotal !== undefined && { installmentTotal: installmentTotal ? Number(installmentTotal) : null }),
      ...(installmentCurrent !== undefined && { installmentCurrent: installmentCurrent ? Number(installmentCurrent) : null }),
      ...(description !== undefined && { description }),
    }).where(eq(receiptDocuments.id, id))

    const [updated] = await db.select().from(receiptDocuments).where(eq(receiptDocuments.id, id))
    res.json(updated)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── DELETE /api/receipt-documents/:id ───────────────────────────────────────
receiptDocumentsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { ownerId } = getOwner(req)
    const db = await getDatabase()
    const id = Number(req.params.id)

    const [existing] = await db
      .select()
      .from(receiptDocuments)
      .where(and(eq(receiptDocuments.id, id), eq(receiptDocuments.ownerId, ownerId)))

    if (!existing) return res.status(404).json({ error: 'Nota não encontrada' })

    await db.update(receiptDocuments)
      .set({ dataState: 'cancelled' })
      .where(eq(receiptDocuments.id, id))

    res.json({ ok: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/receipt-documents/:id/reconcile ────────────────────────────────
receiptDocumentsRouter.post('/:id/reconcile', async (req: Request, res: Response) => {
  try {
    const { ownerId } = getOwner(req)
    const db = await getDatabase()
    const id = Number(req.params.id)
    const { cardTransactionId, transactionId } = req.body

    if (!cardTransactionId && !transactionId) {
      return res.status(400).json({ error: 'Informe cardTransactionId ou transactionId' })
    }

    const [existing] = await db
      .select()
      .from(receiptDocuments)
      .where(and(eq(receiptDocuments.id, id), eq(receiptDocuments.ownerId, ownerId)))

    if (!existing) return res.status(404).json({ error: 'Nota não encontrada' })

    await db.update(receiptDocuments).set({
      dataState: 'reconciled',
      cardTransactionId: cardTransactionId ? Number(cardTransactionId) : null,
      transactionId: transactionId ? Number(transactionId) : null,
      reconcileSource: cardTransactionId ? 'invoice' : 'statement',
      reconciledAt: new Date(),
    }).where(eq(receiptDocuments.id, id))

    const [updated] = await db.select().from(receiptDocuments).where(eq(receiptDocuments.id, id))
    res.json(updated)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

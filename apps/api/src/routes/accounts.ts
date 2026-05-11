import { Router, type NextFunction, type Request, type Response } from 'express'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { accounts, cardInvoices, cardTransactions, categories, transactions } from '@previa/db'
import { getDatabase } from '../config/database.js'
import { resolveOwnerId } from '../services/ownerStore.js'
import { buildCardInvoiceSemanticView } from '../services/cardInvoiceSemantics.js'
import { createError } from '../middlewares/errorHandler.js'
import { requireClerkAuth } from '../middlewares/auth.js'

const router: Router = Router()
router.use(requireClerkAuth)

const deleteByMonthParamsSchema = z.object({
  accountId: z.coerce.number().int().positive(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
})

const invoiceDetailsParamsSchema = z.object({
  accountId: z.coerce.number().int().positive(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
})

const statementDetailsParamsSchema = z.object({
  accountId: z.coerce.number().int().positive(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
})

const updateCardTransactionCategoryParamsSchema = z.object({
  cardTransactionId: z.coerce.number().int().positive(),
})

const updateCardTransactionCategoryBodySchema = z.object({
  categoryId: z.string().nullable(),
})

const updateBankTransactionCategoryParamsSchema = z.object({
  transactionId: z.coerce.number().int().positive(),
})

const updateBankTransactionCategoryBodySchema = z.object({
  categoryId: z.string().nullable(),
})

router.get('/', async (req: Request, res: Response) => {
  const db = getDatabase()
  const clerkUserId = req.authUser!.clerkUserId
  const owner = await resolveOwnerId(clerkUserId)

  const accountRows = await db
    .select({
      id: accounts.id,
      type: accounts.type,
      financialChannel: accounts.financialChannel,
      displayName: accounts.displayName,
      institutionName: accounts.institutionName,
      cardBrand: accounts.cardBrand,
      cardLast4: accounts.cardLast4,
    })
    .from(accounts)
    .where(eq(accounts.userId, owner.id))
    .orderBy(desc(accounts.id))

  if (accountRows.length === 0) {
    return res.json({ items: [] })
  }

  const bankRows = await db
    .select({
      accountId: transactions.accountId,
      month: transactions.competencyMonth,
      count: sql<number>`count(*)`,
    })
    .from(transactions)
    .where(eq(transactions.userId, owner.id))
    .groupBy(transactions.accountId, transactions.competencyMonth)

  const cardRows = await db
    .select({
      accountId: cardInvoices.accountId,
      month: cardInvoices.invoiceMonth,
      count: sql<number>`count(*)`,
    })
    .from(cardInvoices)
    .where(eq(cardInvoices.userId, owner.id))
    .groupBy(cardInvoices.accountId, cardInvoices.invoiceMonth)

  const bankByAccount = new Map<number, Array<{ month: string; count: number }>>()
  const cardByAccount = new Map<number, Array<{ month: string; count: number }>>()

  for (const row of bankRows) {
    const arr = bankByAccount.get(row.accountId) ?? []
    arr.push({ month: row.month, count: Number(row.count ?? 0) })
    bankByAccount.set(row.accountId, arr)
  }

  for (const row of cardRows) {
    const arr = cardByAccount.get(row.accountId) ?? []
    arr.push({ month: row.month, count: Number(row.count ?? 0) })
    cardByAccount.set(row.accountId, arr)
  }

  const items = accountRows
    .map((account) => {
      const bankMonths = (bankByAccount.get(account.id) ?? []).sort((a, b) => b.month.localeCompare(a.month))
      const invoiceMonths = (cardByAccount.get(account.id) ?? []).sort((a, b) => b.month.localeCompare(a.month))

      return {
        ...account,
        bankMonths,
        invoiceMonths,
        totalBankEntries: bankMonths.reduce((sum, m) => sum + m.count, 0),
        totalInvoiceEntries: invoiceMonths.reduce((sum, m) => sum + m.count, 0),
      }
    })
    // Regra pedida: conta sem fatura/extrato nao aparece.
    .filter((account) => account.totalBankEntries > 0 || account.totalInvoiceEntries > 0)

  res.json({ items })
})

router.delete('/:accountId/month/:month', async (req: Request, res: Response) => {
  const db = getDatabase()
  const clerkUserId = req.authUser!.clerkUserId
  const owner = await resolveOwnerId(clerkUserId)

  const { accountId, month } = deleteByMonthParamsSchema.parse(req.params)

  const [existingAccount] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, owner.id)))
    .limit(1)

  if (!existingAccount) {
    throw createError('Conta nao encontrada.', 404)
  }

  const result = await db.transaction(async (tx) => {
    const bankToDelete = await tx
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, owner.id),
          eq(transactions.accountId, accountId),
          eq(transactions.competencyMonth, month),
        ),
      )

    const invoiceIds = await tx
      .select({ id: cardInvoices.id })
      .from(cardInvoices)
      .where(
        and(
          eq(cardInvoices.userId, owner.id),
          eq(cardInvoices.accountId, accountId),
          eq(cardInvoices.invoiceMonth, month),
        ),
      )

    const invoiceIdList = invoiceIds.map((item) => item.id)

    const cardTxToDelete = invoiceIdList.length > 0
      ? await tx
          .select({ count: sql<number>`count(*)` })
          .from(cardTransactions)
          .where(inArray(cardTransactions.cardInvoiceId, invoiceIdList))
      : [{ count: 0 }]

    await tx.delete(transactions).where(
      and(
        eq(transactions.userId, owner.id),
        eq(transactions.accountId, accountId),
        eq(transactions.competencyMonth, month),
      ),
    )

    if (invoiceIdList.length > 0) {
      await tx.delete(cardTransactions).where(inArray(cardTransactions.cardInvoiceId, invoiceIdList))
    }

    await tx.delete(cardInvoices).where(
      and(
        eq(cardInvoices.userId, owner.id),
        eq(cardInvoices.accountId, accountId),
        eq(cardInvoices.invoiceMonth, month),
      ),
    )

    const remainingBank = await tx
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(and(eq(transactions.userId, owner.id), eq(transactions.accountId, accountId)))

    const remainingInvoices = await tx
      .select({ count: sql<number>`count(*)` })
      .from(cardInvoices)
      .where(and(eq(cardInvoices.userId, owner.id), eq(cardInvoices.accountId, accountId)))

    return {
      deletedBankTransactions: Number(bankToDelete[0]?.count ?? 0),
      deletedCardInvoices: invoiceIdList.length,
      deletedCardTransactions: Number(cardTxToDelete[0]?.count ?? 0),
      hasRemainingData: Number(remainingBank[0]?.count ?? 0) > 0 || Number(remainingInvoices[0]?.count ?? 0) > 0,
    }
  })

  res.json({
    accountId,
    month,
    ...result,
  })
})

router.get('/:accountId/month/:month/invoice', async (req: Request, res: Response) => {
  const db = getDatabase()
  const clerkUserId = req.authUser!.clerkUserId
  const owner = await resolveOwnerId(clerkUserId)

  const { accountId, month } = invoiceDetailsParamsSchema.parse(req.params)

  const [existingAccount] = await db
    .select({
      id: accounts.id,
      type: accounts.type,
      displayName: accounts.displayName,
      cardLast4: accounts.cardLast4,
      cardBrand: accounts.cardBrand,
      institutionName: accounts.institutionName,
    })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, owner.id)))
    .limit(1)

  if (!existingAccount) {
    throw createError('Conta nao encontrada.', 404)
  }

  const [invoice] = await db
    .select({
      id: cardInvoices.id,
      invoiceMonth: cardInvoices.invoiceMonth,
      dueDate: cardInvoices.dueDate,
      totalAmountMinor: cardInvoices.totalAmountMinor,
      minimumPaymentMinor: cardInvoices.minimumPaymentMinor,
      paidAmountMinor: cardInvoices.paidAmountMinor,
      openAmountMinor: cardInvoices.openAmountMinor,
      previousBalanceMinor: cardInvoices.previousBalanceMinor,
      reportedPreviousBalanceMinor: cardInvoices.reportedPreviousBalanceMinor,
      reportedPaidAmountMinor: cardInvoices.reportedPaidAmountMinor,
      carriedOpenAmountMinor: cardInvoices.carriedOpenAmountMinor,
      paymentsAllocatedMinor: cardInvoices.paymentsAllocatedMinor,
      effectiveOpenAmountMinor: cardInvoices.effectiveOpenAmountMinor,
      status: cardInvoices.status,
      parserStrategy: cardInvoices.parserStrategy,
      institutionName: cardInvoices.institutionName,
      cardBrand: cardInvoices.cardBrand,
      cardLast4: cardInvoices.cardLast4,
    })
    .from(cardInvoices)
    .where(
      and(
        eq(cardInvoices.userId, owner.id),
        eq(cardInvoices.accountId, accountId),
        eq(cardInvoices.invoiceMonth, month),
      ),
    )
    .limit(1)

  if (!invoice) {
    return res.json({
      accountId,
      month,
      account: {
        id: existingAccount.id,
        displayName: existingAccount.displayName,
        type: existingAccount.type,
        institutionName: existingAccount.institutionName,
        cardBrand: existingAccount.cardBrand,
        cardLast4: existingAccount.cardLast4,
      },
      invoice: null,
      transactions: [],
    })
  }

  const transactionRows = await db
    .select({
      id: cardTransactions.id,
      occurredAt: cardTransactions.occurredAt,
      description: cardTransactions.description,
      amountMinor: cardTransactions.amountMinor,
      competencyMonth: cardTransactions.competencyMonth,
      installmentNumber: cardTransactions.installmentNumber,
      installmentTotal: cardTransactions.installmentTotal,
      categoryId: cardTransactions.categoryId,
      categoryName: categories.name,
    })
    .from(cardTransactions)
    .leftJoin(categories, eq(cardTransactions.categoryId, categories.id))
    .where(eq(cardTransactions.cardInvoiceId, invoice.id))
    .orderBy(desc(cardTransactions.occurredAt), desc(cardTransactions.id))

  const comprasDoMes = transactionRows.reduce((sum, tx) => sum + Number(tx.amountMinor ?? 0), 0)
  const semantic = buildCardInvoiceSemanticView(invoice, BigInt(comprasDoMes))

  res.json({
    accountId,
    month,
    account: {
      id: existingAccount.id,
      displayName: existingAccount.displayName,
      type: existingAccount.type,
      institutionName: existingAccount.institutionName,
      cardBrand: existingAccount.cardBrand,
      cardLast4: existingAccount.cardLast4,
    },
    invoice: {
      id: invoice.id,
      invoiceMonth: invoice.invoiceMonth,
      dueDate: invoice.dueDate,
      totalAmountMinor: Number(semantic.totalInvoiceMinor),
      minimumPaymentMinor: invoice.minimumPaymentMinor === null ? null : Number(invoice.minimumPaymentMinor),
      paidAmountMinor: Number(semantic.paymentsAllocatedMinor),
      openAmountMinor: Number(semantic.effectiveOpenMinor),
      previousBalanceMinor: Number(semantic.reportedPreviousInvoiceTotalMinor),
      emAbertoMinor: Number(semantic.effectiveOpenMinor),
      status: semantic.effectiveOpenMinor > 0n ? 'OPEN' : 'PAID',
      parserStrategy: invoice.parserStrategy,
      institutionName: invoice.institutionName,
      cardBrand: invoice.cardBrand,
      cardLast4: invoice.cardLast4,
      semantic: {
        reportedPreviousInvoiceTotalMinor: Number(semantic.reportedPreviousInvoiceTotalMinor),
        reportedPreviousInvoicePaidMinor: Number(semantic.reportedPreviousInvoicePaidMinor),
        carriedOpenMinor: Number(semantic.carriedOpenMinor),
        paymentsAllocatedMinor: Number(semantic.paymentsAllocatedMinor),
        effectiveOpenMinor: Number(semantic.effectiveOpenMinor),
        currentCyclePurchasesMinor: Number(semantic.currentCyclePurchasesMinor),
      },
    },
    transactions: transactionRows.map((row) => ({
      id: row.id,
      occurredAt: row.occurredAt,
      description: row.description,
      amountMinor: Number(row.amountMinor ?? 0),
      competencyMonth: row.competencyMonth,
      installmentNumber: row.installmentNumber,
      installmentTotal: row.installmentTotal,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
    })),
  })
})

router.get('/:accountId/month/:month/statement', async (req: Request, res: Response) => {
  const db = getDatabase()
  const clerkUserId = req.authUser!.clerkUserId
  const owner = await resolveOwnerId(clerkUserId)

  const { accountId, month } = statementDetailsParamsSchema.parse(req.params)

  const [existingAccount] = await db
    .select({
      id: accounts.id,
      type: accounts.type,
      displayName: accounts.displayName,
      institutionName: accounts.institutionName,
      cardBrand: accounts.cardBrand,
      cardLast4: accounts.cardLast4,
    })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, owner.id)))
    .limit(1)

  if (!existingAccount) {
    throw createError('Conta nao encontrada.', 404)
  }

  const statementRows = await db
    .select({
      id: transactions.id,
      occurredAt: transactions.occurredAt,
      description: transactions.description,
      amountMinor: transactions.amountMinor,
      competencyMonth: transactions.competencyMonth,
      movementType: transactions.movementType,
      movementSubtype: transactions.movementSubtype,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(
      and(
        eq(transactions.userId, owner.id),
        eq(transactions.accountId, accountId),
        eq(transactions.competencyMonth, month),
      ),
    )
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))

  res.json({
    accountId,
    month,
    account: {
      id: existingAccount.id,
      displayName: existingAccount.displayName,
      type: existingAccount.type,
      institutionName: existingAccount.institutionName,
      cardBrand: existingAccount.cardBrand,
      cardLast4: existingAccount.cardLast4,
    },
    transactions: statementRows.map((row) => ({
      id: row.id,
      occurredAt: row.occurredAt,
      description: row.description,
      amountMinor: Number(row.amountMinor ?? 0),
      competencyMonth: row.competencyMonth,
      movementType: row.movementType,
      movementSubtype: row.movementSubtype,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
    })),
  })
})

router.patch('/bank-transactions/:transactionId/category', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDatabase()
    const clerkUserId = req.authUser!.clerkUserId
    const owner = await resolveOwnerId(clerkUserId)

    const { transactionId } = updateBankTransactionCategoryParamsSchema.parse(req.params)
    const { categoryId } = updateBankTransactionCategoryBodySchema.parse(req.body)

    const [existingTx] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, owner.id)))
      .limit(1)

    if (!existingTx) {
      throw createError('Transacao bancaria nao encontrada.', 404)
    }

    await db
      .update(transactions)
      .set({ categoryId, updatedAt: new Date() })
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, owner.id)))

    const [updatedTx] = await db
      .select({
        id: transactions.id,
        categoryId: transactions.categoryId,
        categoryName: categories.name,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(eq(transactions.id, transactionId))
      .limit(1)

    res.json({
      id: updatedTx?.id ?? transactionId,
      categoryId: updatedTx?.categoryId ?? null,
      categoryName: updatedTx?.categoryName ?? null,
    })
  } catch (error) {
    next(error)
  }
})

router.patch('/card-transactions/:cardTransactionId/category', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDatabase()
    const clerkUserId = req.authUser!.clerkUserId
    const owner = await resolveOwnerId(clerkUserId)

    const { cardTransactionId } = updateCardTransactionCategoryParamsSchema.parse(req.params)
    const { categoryId } = updateCardTransactionCategoryBodySchema.parse(req.body)

    if (categoryId) {
      await db
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, categoryId))
        .limit(1)
      // Nota: /api/categories atualmente usa store em memória.
      // A validação aqui é não-bloqueante para não quebrar edição de categorias custom.
    }

    const [existingTx] = await db
      .select({ id: cardTransactions.id })
      .from(cardTransactions)
      .where(and(eq(cardTransactions.id, cardTransactionId), eq(cardTransactions.userId, owner.id)))
      .limit(1)

    if (!existingTx) {
      throw createError('Lançamento de fatura nao encontrado.', 404)
    }

    await db
      .update(cardTransactions)
      .set({ categoryId, updatedAt: new Date() })
      .where(and(eq(cardTransactions.id, cardTransactionId), eq(cardTransactions.userId, owner.id)))

    const [updatedTx] = await db
      .select({
        id: cardTransactions.id,
        categoryId: cardTransactions.categoryId,
        categoryName: categories.name,
      })
      .from(cardTransactions)
      .leftJoin(categories, eq(cardTransactions.categoryId, categories.id))
      .where(eq(cardTransactions.id, cardTransactionId))
      .limit(1)

    res.json({
      id: updatedTx?.id ?? cardTransactionId,
      categoryId: updatedTx?.categoryId ?? null,
      categoryName: updatedTx?.categoryName ?? null,
    })
  } catch (error) {
    next(error)
  }
})

export { router as accountRouter }

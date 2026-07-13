import { Router, type NextFunction, type Request, type Response } from 'express'
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { accounts, cardInvoiceComponents, cardInvoicePayments, cardInvoiceSettlements, cardInvoices, cardTransactions, categories, receiptDocuments, transactions } from '@previa/db'
import { getDatabase } from '../config/database.js'
import { resolveOwnerId } from '../services/ownerStore.js'
import { buildCardInvoiceSemanticView } from '../services/cardInvoiceSemantics.js'
import {
  isCreditCardInvoiceCategory,
  loadCategoryHierarchyById,
  reconcileInvoicePayment,
} from '../services/cardInvoiceReconciliation.js'
import { syncCardInvoiceSemanticFields } from '../services/cardInvoiceSemantics.js'
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

const updateCardTransactionSettlementBodySchema = z.object({
  targetCardInvoiceId: z.union([z.coerce.number().int().positive(), z.null()]),
})

const updateBankTransactionCategoryParamsSchema = z.object({
  transactionId: z.coerce.number().int().positive(),
})

const updateBankTransactionCategoryBodySchema = z.object({
  categoryId: z.string().nullable(),
})

const updateBankTransactionCardInvoiceBodySchema = z.object({
  cardInvoiceId: z.union([z.coerce.number().int().positive(), z.null()]),
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

  const receiptRows = await db
    .select({
      accountId: receiptDocuments.accountId,
      month: receiptDocuments.purchaseMonth,
      count: sql<number>`count(*)`,
    })
    .from(receiptDocuments)
    .where(and(
      eq(receiptDocuments.ownerId, owner.id),
      sql`${receiptDocuments.dataState} <> 'cancelled'`,
      sql`${receiptDocuments.accountId} is not null`,
    ))
    .groupBy(receiptDocuments.accountId, receiptDocuments.purchaseMonth)

  const bankByAccount = new Map<number, Array<{ month: string; count: number }>>()
  const cardByAccount = new Map<number, Array<{ month: string; count: number }>>()
  const receiptByAccount = new Map<number, Array<{ month: string; count: number }>>()

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

  for (const row of receiptRows) {
    if (row.accountId == null) continue
    const accountId = row.accountId
    const arr = receiptByAccount.get(accountId) ?? []
    arr.push({ month: row.month, count: Number(row.count ?? 0) })
    receiptByAccount.set(accountId, arr)
  }

  const items = accountRows
    .map((account) => {
      const bankMonths = (bankByAccount.get(account.id) ?? []).sort((a, b) => b.month.localeCompare(a.month))
      const invoiceMonths = (cardByAccount.get(account.id) ?? []).sort((a, b) => b.month.localeCompare(a.month))
      const receiptMonths = (receiptByAccount.get(account.id) ?? []).sort((a, b) => b.month.localeCompare(a.month))

      return {
        ...account,
        bankMonths,
        invoiceMonths,
        receiptMonths,
        totalBankEntries: bankMonths.reduce((sum, m) => sum + m.count, 0),
        totalInvoiceEntries: invoiceMonths.reduce((sum, m) => sum + m.count, 0),
        totalReceiptEntries: receiptMonths.reduce((sum, m) => sum + m.count, 0),
      }
    })
    // Regra pedida: conta sem fatura/extrato nao aparece.
    .filter((account) => account.totalBankEntries > 0 || account.totalInvoiceEntries > 0 || account.totalReceiptEntries > 0)

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

router.get('/open-card-invoices', async (req: Request, res: Response) => {
  const db = getDatabase()
  const clerkUserId = req.authUser!.clerkUserId
  const owner = await resolveOwnerId(clerkUserId)

  // Parâmetro opcional: mês do extrato (YYYY-MM). Quando fornecido, filtra faturas
  // cujo dueDate pertence ao mesmo mês — ou faturas em aberto de meses anteriores
  // que ainda não foram totalmente pagas.
  const statementMonth = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month)
    ? req.query.month
    : null

  const whereConditions = statementMonth
    ? and(
        eq(cardInvoices.userId, owner.id),
        sql`(
          DATE_FORMAT(${cardInvoices.dueDate}, '%Y-%m') = ${statementMonth}
          OR (
            DATE_FORMAT(${cardInvoices.dueDate}, '%Y-%m') < ${statementMonth}
            AND ${cardInvoices.effectiveOpenAmountMinor} > 0
          )
        )`,
      )
    : and(eq(cardInvoices.userId, owner.id))

  const invoices = await db
    .select({
      id: cardInvoices.id,
      accountId: cardInvoices.accountId,
      invoiceMonth: cardInvoices.invoiceMonth,
      dueDate: cardInvoices.dueDate,
      totalAmountMinor: cardInvoices.totalAmountMinor,
      paidAmountMinor: cardInvoices.paymentsAllocatedMinor,
      openAmountMinor: cardInvoices.effectiveOpenAmountMinor,
      status: sql<string>`CASE WHEN ${cardInvoices.effectiveOpenAmountMinor} > 0 THEN 'OPEN' ELSE 'PAID' END`,
      institutionName: accounts.institutionName,
      cardBrand: accounts.cardBrand,
      cardLast4: accounts.cardLast4,
      displayName: accounts.displayName,
    })
    .from(cardInvoices)
    .innerJoin(accounts, eq(accounts.id, cardInvoices.accountId))
    .where(whereConditions)
    .orderBy(cardInvoices.dueDate)

  res.json({
    items: invoices.map((invoice) => ({
      id: invoice.id,
      accountId: invoice.accountId,
      invoiceMonth: invoice.invoiceMonth,
      dueDate: invoice.dueDate,
      totalAmountMinor: Number(invoice.totalAmountMinor ?? 0n),
      paidAmountMinor: Number(invoice.paidAmountMinor ?? 0n),
      openAmountMinor: Number(invoice.openAmountMinor ?? 0n),
      status: invoice.status,
      institutionName: invoice.institutionName,
      cardBrand: invoice.cardBrand,
      cardLast4: invoice.cardLast4,
      displayName: invoice.displayName,
    })),
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

  const invoiceSemanticSnapshot = await syncCardInvoiceSemanticFields(db, invoice.id)
  const invoiceForSemantic = invoiceSemanticSnapshot ? { ...invoice, ...invoiceSemanticSnapshot } : invoice

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

  const componentRows = await db
    .select({
      id: cardInvoiceComponents.id,
      componentScope: cardInvoiceComponents.componentScope,
      componentType: cardInvoiceComponents.componentType,
      amountMinor: cardInvoiceComponents.amountMinor,
      description: cardInvoiceComponents.description,
      source: cardInvoiceComponents.source,
      sourceDate: cardInvoiceComponents.sourceDate,
      cardTransactionId: cardInvoiceComponents.cardTransactionId,
      transactionId: cardInvoiceComponents.transactionId,
      installmentNumber: cardInvoiceComponents.installmentNumber,
      installmentTotal: cardInvoiceComponents.installmentTotal,
    })
    .from(cardInvoiceComponents)
    .where(eq(cardInvoiceComponents.cardInvoiceId, invoice.id))
    .orderBy(desc(cardInvoiceComponents.id))

  const transactionIds = transactionRows.map((row) => row.id)
  const settlementRows = transactionIds.length > 0
    ? await db
        .select({
          sourceCardTransactionId: cardInvoiceSettlements.sourceCardTransactionId,
          allocatedAmountMinor: cardInvoiceSettlements.allocatedAmountMinor,
          targetCardInvoiceId: cardInvoiceSettlements.targetCardInvoiceId,
          id: cardInvoices.id,
          accountId: cardInvoices.accountId,
          invoiceMonth: cardInvoices.invoiceMonth,
          dueDate: cardInvoices.dueDate,
          totalAmountMinor: cardInvoices.totalAmountMinor,
          paidAmountMinor: cardInvoices.paymentsAllocatedMinor,
          openAmountMinor: cardInvoices.effectiveOpenAmountMinor,
          status: sql<string>`CASE WHEN ${cardInvoices.effectiveOpenAmountMinor} > 0 THEN 'OPEN' ELSE 'PAID' END`,
          institutionName: accounts.institutionName,
          cardBrand: accounts.cardBrand,
          cardLast4: accounts.cardLast4,
          displayName: accounts.displayName,
        })
        .from(cardInvoiceSettlements)
        .innerJoin(cardInvoices, eq(cardInvoices.id, cardInvoiceSettlements.targetCardInvoiceId))
        .innerJoin(accounts, eq(accounts.id, cardInvoices.accountId))
        .where(inArray(cardInvoiceSettlements.sourceCardTransactionId, transactionIds))
        .orderBy(asc(cardInvoiceSettlements.id))
    : []

  const settledInvoiceByTransactionId = new Map<number, typeof settlementRows[number]>()
  for (const row of settlementRows) {
    if (!settledInvoiceByTransactionId.has(row.sourceCardTransactionId)) {
      settledInvoiceByTransactionId.set(row.sourceCardTransactionId, row)
    }
  }

  const comprasDoMes = transactionRows.reduce((sum, tx) => sum + Number(tx.amountMinor ?? 0), 0)
  const semantic = buildCardInvoiceSemanticView(invoiceForSemantic, BigInt(comprasDoMes))

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
      paidAmountMinor: Number(semantic.reportedPreviousInvoicePaidMinor),
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
    components: componentRows.map((row) => ({
      id: row.id,
      componentScope: row.componentScope,
      componentType: row.componentType,
      amountMinor: Number(row.amountMinor ?? 0),
      description: row.description,
      source: row.source,
      sourceDate: row.sourceDate,
      cardTransactionId: row.cardTransactionId,
      transactionId: row.transactionId,
      installmentNumber: row.installmentNumber,
      installmentTotal: row.installmentTotal,
    })),
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
      settlementAllocatedMinor: settledInvoiceByTransactionId.get(row.id)?.allocatedAmountMinor
        ? Number(settledInvoiceByTransactionId.get(row.id)!.allocatedAmountMinor)
        : null,
      settledInvoice: settledInvoiceByTransactionId.get(row.id)
        ? {
            id: settledInvoiceByTransactionId.get(row.id)!.id,
            accountId: settledInvoiceByTransactionId.get(row.id)!.accountId,
            invoiceMonth: settledInvoiceByTransactionId.get(row.id)!.invoiceMonth,
            dueDate: settledInvoiceByTransactionId.get(row.id)!.dueDate,
            totalAmountMinor: Number(settledInvoiceByTransactionId.get(row.id)!.totalAmountMinor ?? 0n),
            paidAmountMinor: Number(settledInvoiceByTransactionId.get(row.id)!.paidAmountMinor ?? 0n),
            openAmountMinor: Number(settledInvoiceByTransactionId.get(row.id)!.openAmountMinor ?? 0n),
            status: settledInvoiceByTransactionId.get(row.id)!.status,
            institutionName: settledInvoiceByTransactionId.get(row.id)!.institutionName,
            cardBrand: settledInvoiceByTransactionId.get(row.id)!.cardBrand,
            cardLast4: settledInvoiceByTransactionId.get(row.id)!.cardLast4,
            displayName: settledInvoiceByTransactionId.get(row.id)!.displayName,
          }
        : null,
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

  const statementTransactionIds = statementRows.map((row) => row.id)
  const statementSettlementRows = statementTransactionIds.length > 0
    ? await db
        .select({
          sourceCardTransactionId: cardInvoiceSettlements.sourceCardTransactionId,
          allocatedAmountMinor: cardInvoiceSettlements.allocatedAmountMinor,
          targetCardInvoiceId: cardInvoiceSettlements.targetCardInvoiceId,
          invoiceMonth: cardInvoices.invoiceMonth,
          dueDate: cardInvoices.dueDate,
          totalAmountMinor: cardInvoices.totalAmountMinor,
          paidAmountMinor: cardInvoices.paymentsAllocatedMinor,
          openAmountMinor: cardInvoices.effectiveOpenAmountMinor,
          status: sql<string>`CASE WHEN ${cardInvoices.effectiveOpenAmountMinor} > 0 THEN 'OPEN' ELSE 'PAID' END`,
          institutionName: accounts.institutionName,
          cardBrand: accounts.cardBrand,
          cardLast4: accounts.cardLast4,
          displayName: accounts.displayName,
        })
        .from(cardInvoiceSettlements)
        .innerJoin(cardInvoices, eq(cardInvoices.id, cardInvoiceSettlements.targetCardInvoiceId))
        .innerJoin(accounts, eq(accounts.id, cardInvoices.accountId))
        .where(and(
          eq(cardInvoiceSettlements.userId, owner.id),
          inArray(cardInvoiceSettlements.sourceCardTransactionId, statementTransactionIds),
        ))
        .orderBy(asc(cardInvoiceSettlements.id))
    : []

  const statementSettlementByTransactionId = new Map<number, typeof statementSettlementRows[number]>()
  for (const row of statementSettlementRows) {
    if (!statementSettlementByTransactionId.has(row.sourceCardTransactionId)) {
      statementSettlementByTransactionId.set(row.sourceCardTransactionId, row)
    }
  }

  const paymentRows = statementTransactionIds.length > 0
    ? await db
        .select({
          transactionId: cardInvoicePayments.transactionId,
          cardInvoiceId: cardInvoicePayments.cardInvoiceId,
          invoiceMonth: cardInvoices.invoiceMonth,
          dueDate: cardInvoices.dueDate,
          totalAmountMinor: cardInvoices.totalAmountMinor,
          paidAmountMinor: cardInvoices.paymentsAllocatedMinor,
          openAmountMinor: cardInvoices.effectiveOpenAmountMinor,
          invoiceStatus: sql<string>`CASE WHEN ${cardInvoices.effectiveOpenAmountMinor} > 0 THEN 'OPEN' ELSE 'PAID' END`,
          institutionName: accounts.institutionName,
          cardBrand: accounts.cardBrand,
          cardLast4: accounts.cardLast4,
          displayName: accounts.displayName,
        })
        .from(cardInvoicePayments)
        .innerJoin(cardInvoices, eq(cardInvoices.id, cardInvoicePayments.cardInvoiceId))
        .innerJoin(accounts, eq(accounts.id, cardInvoices.accountId))
        .where(inArray(cardInvoicePayments.transactionId, statementTransactionIds))
        .orderBy(asc(cardInvoicePayments.id))
    : []

  const cardInvoiceByTransactionId = new Map<number, number | null>()
  const cardInvoiceSummaryByTransactionId = new Map<number, typeof paymentRows[number]>()
  for (const row of paymentRows) {
    if (!cardInvoiceByTransactionId.has(row.transactionId)) {
      cardInvoiceByTransactionId.set(row.transactionId, row.cardInvoiceId)
      cardInvoiceSummaryByTransactionId.set(row.transactionId, row)
    }
  }

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
      cardInvoiceId: cardInvoiceByTransactionId.get(row.id) ?? null,
      cardInvoiceSummary: cardInvoiceSummaryByTransactionId.get(row.id)
        ? {
            id: cardInvoiceSummaryByTransactionId.get(row.id)!.cardInvoiceId,
            accountId: 0,
            invoiceMonth: cardInvoiceSummaryByTransactionId.get(row.id)!.invoiceMonth,
            dueDate: cardInvoiceSummaryByTransactionId.get(row.id)!.dueDate,
            totalAmountMinor: Number(cardInvoiceSummaryByTransactionId.get(row.id)!.totalAmountMinor ?? 0n),
            paidAmountMinor: Number(cardInvoiceSummaryByTransactionId.get(row.id)!.paidAmountMinor ?? 0n),
            openAmountMinor: Number(cardInvoiceSummaryByTransactionId.get(row.id)!.openAmountMinor ?? 0n),
            status: cardInvoiceSummaryByTransactionId.get(row.id)!.invoiceStatus,
            institutionName: cardInvoiceSummaryByTransactionId.get(row.id)!.institutionName,
            cardBrand: cardInvoiceSummaryByTransactionId.get(row.id)!.cardBrand,
            cardLast4: cardInvoiceSummaryByTransactionId.get(row.id)!.cardLast4,
            displayName: cardInvoiceSummaryByTransactionId.get(row.id)!.displayName,
          }
        : null,
      settlementAllocatedMinor: statementSettlementByTransactionId.get(row.id)?.allocatedAmountMinor
        ? Number(statementSettlementByTransactionId.get(row.id)!.allocatedAmountMinor)
        : null,
      settledInvoice: statementSettlementByTransactionId.get(row.id)
        ? {
            id: statementSettlementByTransactionId.get(row.id)!.targetCardInvoiceId,
            invoiceMonth: statementSettlementByTransactionId.get(row.id)!.invoiceMonth,
            dueDate: statementSettlementByTransactionId.get(row.id)!.dueDate,
            totalAmountMinor: Number(statementSettlementByTransactionId.get(row.id)!.totalAmountMinor ?? 0n),
            paidAmountMinor: Number(statementSettlementByTransactionId.get(row.id)!.paidAmountMinor ?? 0n),
            openAmountMinor: Number(statementSettlementByTransactionId.get(row.id)!.openAmountMinor ?? 0n),
            status: statementSettlementByTransactionId.get(row.id)!.status,
            institutionName: statementSettlementByTransactionId.get(row.id)!.institutionName,
            cardBrand: statementSettlementByTransactionId.get(row.id)!.cardBrand,
            cardLast4: statementSettlementByTransactionId.get(row.id)!.cardLast4,
            displayName: statementSettlementByTransactionId.get(row.id)!.displayName,
          }
        : null,
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

    if (categoryId) {
      const categoryHierarchy = await loadCategoryHierarchyById(db, categoryId)
      if (isCreditCardInvoiceCategory(categoryId, categoryHierarchy)) {
        const [txToReconcile] = await db
          .select({
            id: transactions.id,
            amountMinor: transactions.amountMinor,
            occurredAt: transactions.occurredAt,
            description: transactions.description,
            accountId: transactions.accountId,
          })
          .from(transactions)
          .where(and(eq(transactions.id, transactionId), eq(transactions.userId, owner.id)))
          .limit(1)

        if (txToReconcile) {
          const [sourceAcc] = await db
            .select({ institutionName: accounts.institutionName })
            .from(accounts)
            .where(eq(accounts.id, txToReconcile.accountId))
            .limit(1)

          await reconcileInvoicePayment(
            db,
            owner.id,
            {
              id: txToReconcile.id,
              amountMinor: txToReconcile.amountMinor,
              occurredAt: txToReconcile.occurredAt,
              description: txToReconcile.description,
              forceInvoiceMatch: true,
            },
            sourceAcc?.institutionName ?? null,
          )
        }
      }
    }

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

router.patch('/bank-transactions/:transactionId/card-invoice', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDatabase()
    const clerkUserId = req.authUser!.clerkUserId
    const owner = await resolveOwnerId(clerkUserId)

    const { transactionId } = updateBankTransactionCategoryParamsSchema.parse(req.params)
    const { cardInvoiceId } = updateBankTransactionCardInvoiceBodySchema.parse(req.body)

    const [existingTx] = await db
      .select({
        id: transactions.id,
        amountMinor: transactions.amountMinor,
        occurredAt: transactions.occurredAt,
        description: transactions.description,
        accountId: transactions.accountId,
      })
      .from(transactions)
      .where(and(eq(transactions.id, transactionId), eq(transactions.userId, owner.id)))
      .limit(1)

    if (!existingTx) {
      throw createError('Transacao bancaria nao encontrada.', 404)
    }

    const existingPayments = await db
      .select({
        id: cardInvoicePayments.id,
        cardInvoiceId: cardInvoicePayments.cardInvoiceId,
        allocatedAmountMinor: cardInvoicePayments.allocatedAmountMinor,
      })
      .from(cardInvoicePayments)
      .where(and(eq(cardInvoicePayments.transactionId, transactionId), eq(cardInvoicePayments.userId, owner.id)))

    if (cardInvoiceId) {
      const [conflictingPayment] = await db
        .select({
          id: cardInvoicePayments.id,
          transactionId: cardInvoicePayments.transactionId,
        })
        .from(cardInvoicePayments)
        .where(
          and(
            eq(cardInvoicePayments.cardInvoiceId, cardInvoiceId),
            eq(cardInvoicePayments.userId, owner.id),
            sql`${cardInvoicePayments.transactionId} <> ${transactionId}`,
          ),
        )
        .limit(1)

      if (conflictingPayment) {
        throw createError('Esta fatura já está vinculada a outra transação bancária.', 409)
      }
    }

    await db.transaction(async (tx) => {
      const invoiceIdsToSync = new Set<number>()

      for (const payment of existingPayments) {
        invoiceIdsToSync.add(payment.cardInvoiceId)

        const [currentInvoice] = await tx
          .select({
            id: cardInvoices.id,
            totalAmountMinor: cardInvoices.totalAmountMinor,
            paidAmountMinor: cardInvoices.paidAmountMinor,
            openAmountMinor: cardInvoices.openAmountMinor,
            effectiveOpenAmountMinor: cardInvoices.effectiveOpenAmountMinor,
            paymentsAllocatedMinor: cardInvoices.paymentsAllocatedMinor,
          })
          .from(cardInvoices)
          .where(and(eq(cardInvoices.id, payment.cardInvoiceId), eq(cardInvoices.userId, owner.id)))
          .limit(1)

        if (currentInvoice) {
          const revertAmount = BigInt(payment.allocatedAmountMinor)
          // Usa effectiveOpenAmountMinor como base canónica para a reversão.
          // Se o allocate era 0 (bug do Itaú), a reversão não altera nada nos campos
          // directos — o syncCardInvoiceSemanticFields recalcula tudo a partir da pivô.
          if (revertAmount > 0n) {
            const currentEffectiveOpen = BigInt(currentInvoice.effectiveOpenAmountMinor ?? currentInvoice.openAmountMinor ?? 0n)
            const currentPaid = BigInt(currentInvoice.paidAmountMinor ?? 0n)
            const nextPaid = currentPaid - revertAmount > 0n ? currentPaid - revertAmount : 0n
            const nextOpen = currentEffectiveOpen + revertAmount
            await tx
              .update(cardInvoices)
              .set({
                paidAmountMinor: nextPaid,
                openAmountMinor: nextOpen,
                status: 'OPEN',
                updatedAt: new Date(),
              })
              .where(eq(cardInvoices.id, payment.cardInvoiceId))
          }
        }
      }

      if (existingPayments.length > 0) {
        await tx
          .delete(cardInvoicePayments)
          .where(and(eq(cardInvoicePayments.transactionId, transactionId), eq(cardInvoicePayments.userId, owner.id)))
      }

      for (const invoiceId of invoiceIdsToSync) {
        await syncCardInvoiceSemanticFields(tx, invoiceId)
      }

      if (cardInvoiceId) {
        const [sourceAcc] = await tx
          .select({ institutionName: accounts.institutionName })
          .from(accounts)
          .where(eq(accounts.id, existingTx.accountId))
          .limit(1)

        await reconcileInvoicePayment(
          tx,
          owner.id,
          {
            id: existingTx.id,
            amountMinor: existingTx.amountMinor,
            occurredAt: existingTx.occurredAt,
            description: existingTx.description,
            cardInvoiceId,
            forceInvoiceMatch: true,
          },
          sourceAcc?.institutionName ?? null,
        )
      }
    })

    const [updatedPayments] = cardInvoiceId
      ? await db
          .select({
            cardInvoiceId: cardInvoicePayments.cardInvoiceId,
          })
          .from(cardInvoicePayments)
          .where(and(eq(cardInvoicePayments.transactionId, transactionId), eq(cardInvoicePayments.userId, owner.id)))
          .limit(1)
      : [{ cardInvoiceId: null }]

    res.json({
      id: transactionId,
      cardInvoiceId: updatedPayments?.cardInvoiceId ?? null,
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

router.patch('/card-transactions/:cardTransactionId/settlement', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDatabase()
    const clerkUserId = req.authUser!.clerkUserId
    const owner = await resolveOwnerId(clerkUserId)

    const { cardTransactionId } = updateCardTransactionCategoryParamsSchema.parse(req.params)
    const { targetCardInvoiceId } = updateCardTransactionSettlementBodySchema.parse(req.body)

    const [sourceTx] = await db
      .select({
        id: cardTransactions.id,
        amountMinor: cardTransactions.amountMinor,
        occurredAt: cardTransactions.occurredAt,
        cardInvoiceId: cardTransactions.cardInvoiceId,
      })
      .from(cardTransactions)
      .where(and(eq(cardTransactions.id, cardTransactionId), eq(cardTransactions.userId, owner.id)))
      .limit(1)

    if (!sourceTx) {
      throw createError('Lançamento de fatura não encontrado.', 404)
    }

    if (targetCardInvoiceId !== null && targetCardInvoiceId === sourceTx.cardInvoiceId) {
      throw createError('A fatura alvo não pode ser a mesma do lançamento de origem.', 400)
    }

    const existingSettlements = await db
      .select({
        targetCardInvoiceId: cardInvoiceSettlements.targetCardInvoiceId,
      })
      .from(cardInvoiceSettlements)
      .where(and(eq(cardInvoiceSettlements.sourceCardTransactionId, cardTransactionId), eq(cardInvoiceSettlements.userId, owner.id)))

    const affectedInvoiceIds = new Set<number>(existingSettlements.map((row) => row.targetCardInvoiceId))

    await db.transaction(async (tx) => {
      if (existingSettlements.length > 0) {
        await tx
          .delete(cardInvoiceSettlements)
          .where(and(eq(cardInvoiceSettlements.sourceCardTransactionId, cardTransactionId), eq(cardInvoiceSettlements.userId, owner.id)))
      }

      if (targetCardInvoiceId !== null) {
        const [targetInvoice] = await tx
          .select({
            id: cardInvoices.id,
          })
          .from(cardInvoices)
          .where(and(eq(cardInvoices.id, targetCardInvoiceId), eq(cardInvoices.userId, owner.id)))
          .limit(1)

        if (!targetInvoice) {
          throw createError('Fatura alvo não encontrada.', 404)
        }

        const allocatedAmountMinor = BigInt(sourceTx.amountMinor < 0n ? -sourceTx.amountMinor : sourceTx.amountMinor)
        await tx.insert(cardInvoiceSettlements).values({
          userId: owner.id,
          sourceCardTransactionId: sourceTx.id,
          targetCardInvoiceId,
          allocatedAmountMinor,
          currencyCode: 'BRL',
          settlementDate: sourceTx.occurredAt,
          source: 'manual',
          matchedBy: 'user_selection',
          confidenceScore: '1.0000',
        })

        affectedInvoiceIds.add(targetCardInvoiceId)
      }

      for (const invoiceId of affectedInvoiceIds) {
        await syncCardInvoiceSemanticFields(tx, invoiceId)
      }
    })

    res.json({
      id: cardTransactionId,
      settledInvoiceId: targetCardInvoiceId,
    })
  } catch (error) {
    next(error)
  }
})

/**
 * POST /api/accounts/repair-invoice-payments
 * Corrige retroactivamente registos na pivô card_invoice_payments onde
 * allocated_amount_minor = 0 (bug do Itaú e similares).
 * Para cada registo afectado, recalcula o allocate com base em totalAmountMinor
 * e re-executa syncCardInvoiceSemanticFields.
 */
router.post('/repair-invoice-payments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDatabase()
    const clerkUserId = req.authUser!.clerkUserId
    const owner = await resolveOwnerId(clerkUserId)

    // Buscar todos os registos com allocatedAmountMinor = 0 para este utilizador
    const zeroPayments = await db
      .select({
        id: cardInvoicePayments.id,
        transactionId: cardInvoicePayments.transactionId,
        cardInvoiceId: cardInvoicePayments.cardInvoiceId,
        allocatedAmountMinor: cardInvoicePayments.allocatedAmountMinor,
      })
      .from(cardInvoicePayments)
      .where(and(
        eq(cardInvoicePayments.userId, owner.id),
        sql`${cardInvoicePayments.allocatedAmountMinor} = 0`,
      ))

    if (zeroPayments.length === 0) {
      res.json({ repaired: 0, message: 'Nenhum registo com allocated_amount_minor=0 encontrado.' })
      return
    }

    let repaired = 0
    const invoiceIdsToSync = new Set<number>()

    for (const payment of zeroPayments) {
      // Buscar a transacção bancária para obter o valor real do pagamento
      const [tx] = await db
        .select({ id: transactions.id, amountMinor: transactions.amountMinor })
        .from(transactions)
        .where(and(eq(transactions.id, payment.transactionId), eq(transactions.userId, owner.id)))
        .limit(1)

      if (!tx) continue

      // Buscar a fatura para obter totalAmountMinor e effectiveOpenAmountMinor
      const [invoice] = await db
        .select({
          id: cardInvoices.id,
          totalAmountMinor: cardInvoices.totalAmountMinor,
          effectiveOpenAmountMinor: cardInvoices.effectiveOpenAmountMinor,
          openAmountMinor: cardInvoices.openAmountMinor,
        })
        .from(cardInvoices)
        .where(and(eq(cardInvoices.id, payment.cardInvoiceId), eq(cardInvoices.userId, owner.id)))
        .limit(1)

      if (!invoice) continue

      const paymentAmount = BigInt(tx.amountMinor) < 0n ? -BigInt(tx.amountMinor) : BigInt(tx.amountMinor)
      const invoiceEffectiveOpen = BigInt(invoice.effectiveOpenAmountMinor ?? invoice.openAmountMinor ?? 0n)
      const invoiceTotal = BigInt(invoice.totalAmountMinor ?? 0n)

      const invoiceBase = invoiceEffectiveOpen > 0n
        ? invoiceEffectiveOpen
        : invoiceTotal > 0n
          ? invoiceTotal
          : paymentAmount

      const allocate = paymentAmount < invoiceBase ? paymentAmount : invoiceBase

      if (allocate > 0n) {
        await db
          .update(cardInvoicePayments)
          .set({ allocatedAmountMinor: allocate })
          .where(eq(cardInvoicePayments.id, payment.id))

        invoiceIdsToSync.add(payment.cardInvoiceId)
        repaired++
      }
    }

    // Re-sync semântico para todas as faturas afectadas
    for (const invoiceId of invoiceIdsToSync) {
      await syncCardInvoiceSemanticFields(db, invoiceId)
    }

    res.json({
      repaired,
      invoicesSynced: invoiceIdsToSync.size,
      message: `${repaired} registo(s) corrigido(s). ${invoiceIdsToSync.size} fatura(s) re-sincronizada(s).`,
    })
  } catch (error) {
    next(error)
  }
})

export { router as accountRouter }

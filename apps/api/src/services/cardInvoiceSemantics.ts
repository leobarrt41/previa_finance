import { eq, sql } from 'drizzle-orm'
import { cardInvoicePayments, cardInvoices } from '@previa/db'

type CardInvoiceSemanticSnapshot = {
  reportedPreviousBalanceMinor: bigint
  reportedPaidAmountMinor: bigint
  carriedOpenAmountMinor: bigint
  paymentsAllocatedMinor: bigint
  effectiveOpenAmountMinor: bigint
}

function maxBigInt(a: bigint, b: bigint): bigint {
  return a > b ? a : b
}

export async function syncCardInvoiceSemanticFields(
  db: any,
  cardInvoiceId: number,
): Promise<CardInvoiceSemanticSnapshot | null> {
  const [invoice] = await db
    .select({
      id: cardInvoices.id,
      totalAmountMinor: cardInvoices.totalAmountMinor,
      previousBalanceMinor: cardInvoices.previousBalanceMinor,
      paidAmountMinor: cardInvoices.paidAmountMinor,
      openAmountMinor: cardInvoices.openAmountMinor,
    })
    .from(cardInvoices)
    .where(eq(cardInvoices.id, cardInvoiceId))
    .limit(1)

  if (!invoice) return null

  const [paymentAgg] = await db
    .select({
      allocatedMinor: sql<bigint>`COALESCE(SUM(${cardInvoicePayments.allocatedAmountMinor}), 0)`,
    })
    .from(cardInvoicePayments)
    .where(eq(cardInvoicePayments.cardInvoiceId, cardInvoiceId))

  const totalAmountMinor = BigInt(invoice.totalAmountMinor ?? 0n)
  const previousBalanceMinor = BigInt(invoice.previousBalanceMinor ?? 0n)
  const paidAmountMinor = BigInt(invoice.paidAmountMinor ?? 0n)
  const openAmountMinor = BigInt(invoice.openAmountMinor ?? 0n)
  const paymentsAllocatedMinor = BigInt(paymentAgg?.allocatedMinor ?? 0n)

  const reportedPreviousBalanceMinor = previousBalanceMinor
  const reportedPaidAmountMinor = paidAmountMinor
  const carriedOpenAmountMinor = maxBigInt(previousBalanceMinor - paidAmountMinor, 0n)

  const paidDerivedOpen = maxBigInt(totalAmountMinor - paidAmountMinor, 0n)
  const effectiveOpenAmountMinor =
    paymentsAllocatedMinor > 0n
      ? maxBigInt(totalAmountMinor - paymentsAllocatedMinor, 0n)
      : paidAmountMinor > 0n && openAmountMinor === paidDerivedOpen
        ? totalAmountMinor
        : maxBigInt(openAmountMinor, 0n)

  await db
    .update(cardInvoices)
    .set({
      reportedPreviousBalanceMinor,
      reportedPaidAmountMinor,
      carriedOpenAmountMinor,
      paymentsAllocatedMinor,
      effectiveOpenAmountMinor,
    })
    .where(eq(cardInvoices.id, cardInvoiceId))

  return {
    reportedPreviousBalanceMinor,
    reportedPaidAmountMinor,
    carriedOpenAmountMinor,
    paymentsAllocatedMinor,
    effectiveOpenAmountMinor,
  }
}

export async function syncCardInvoiceSemanticFieldsForUser(
  db: any,
  userId: number,
): Promise<number> {
  const invoices = await db
    .select({ id: cardInvoices.id })
    .from(cardInvoices)
    .where(eq(cardInvoices.userId, userId))

  for (const invoice of invoices) {
    await syncCardInvoiceSemanticFields(db, invoice.id)
  }

  return invoices.length
}

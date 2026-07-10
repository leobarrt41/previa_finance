/**
 * relations.ts — Drizzle ORM relational query declarations
 *
 * These relations enable Drizzle's relational query API (db.query.*).
 * They do NOT create foreign keys in the database — FKs are defined in
 * the SQL migrations. This file only teaches Drizzle how to JOIN tables
 * when using the typed query builder.
 *
 * Note: users and categories are external tables. Their relations are
 * declared here as "references" so Drizzle can traverse them, but the
 * actual table definitions live in their own modules.
 */

import { relations } from "drizzle-orm";
import {
  financialConnections,
  financialConnectionConsents,
  accounts,
  transactions,
  cardInvoices,
  cardInvoiceComponents,
  cardTransactions,
  cardInvoicePayments,
  cardInvoiceSettlements,
  investments,
  investmentTransactions,
  syncRuns,
} from "./schema";

// ---------------------------------------------------------------------------
// financial_connections
// ---------------------------------------------------------------------------
export const financialConnectionsRelations = relations(
  financialConnections,
  ({ many }) => ({
    consents: many(financialConnectionConsents),
    accounts: many(accounts),
    investments: many(investments),
    syncRuns: many(syncRuns),
  }),
);

// ---------------------------------------------------------------------------
// financial_connection_consents
// ---------------------------------------------------------------------------
export const financialConnectionConsentsRelations = relations(
  financialConnectionConsents,
  ({ one }) => ({
    financialConnection: one(financialConnections, {
      fields: [financialConnectionConsents.financialConnectionId],
      references: [financialConnections.id],
    }),
  }),
);

// ---------------------------------------------------------------------------
// accounts
// ---------------------------------------------------------------------------
export const accountsRelations = relations(accounts, ({ one, many }) => ({
  financialConnection: one(financialConnections, {
    fields: [accounts.financialConnectionId],
    references: [financialConnections.id],
  }),
  transactions: many(transactions),
  cardInvoices: many(cardInvoices),
  investments: many(investments),
}));

// ---------------------------------------------------------------------------
// transactions
// ---------------------------------------------------------------------------
export const transactionsRelations = relations(transactions, ({ one, many }) => ({
  account: one(accounts, {
    fields: [transactions.accountId],
    references: [accounts.id],
  }),
  // A transaction can be the payment source for one or more invoice payments
  invoicePayments: many(cardInvoicePayments),
}));

// ---------------------------------------------------------------------------
// card_invoices
// ---------------------------------------------------------------------------
export const cardInvoicesRelations = relations(cardInvoices, ({ one, many }) => ({
  account: one(accounts, {
    fields: [cardInvoices.accountId],
    references: [accounts.id],
  }),
  components: many(cardInvoiceComponents),
  cardTransactions: many(cardTransactions),
  payments: many(cardInvoicePayments),
  incomingSettlements: many(cardInvoiceSettlements),
}));

// ---------------------------------------------------------------------------
// card_invoice_components
// ---------------------------------------------------------------------------
export const cardInvoiceComponentsRelations = relations(
  cardInvoiceComponents,
  ({ one }) => ({
    invoice: one(cardInvoices, {
      fields: [cardInvoiceComponents.cardInvoiceId],
      references: [cardInvoices.id],
    }),
    cardTransaction: one(cardTransactions, {
      fields: [cardInvoiceComponents.cardTransactionId],
      references: [cardTransactions.id],
    }),
    transaction: one(transactions, {
      fields: [cardInvoiceComponents.transactionId],
      references: [transactions.id],
    }),
  }),
);

// ---------------------------------------------------------------------------
// card_transactions
// ---------------------------------------------------------------------------
export const cardTransactionsRelations = relations(
  cardTransactions,
  ({ one, many }) => ({
    cardInvoice: one(cardInvoices, {
      fields: [cardTransactions.cardInvoiceId],
      references: [cardInvoices.id],
    }),
    invoiceSettlements: many(cardInvoiceSettlements),
  }),
);

// ---------------------------------------------------------------------------
// card_invoice_payments
// ---------------------------------------------------------------------------
export const cardInvoicePaymentsRelations = relations(
  cardInvoicePayments,
  ({ one }) => ({
    cardInvoice: one(cardInvoices, {
      fields: [cardInvoicePayments.cardInvoiceId],
      references: [cardInvoices.id],
    }),
    transaction: one(transactions, {
      fields: [cardInvoicePayments.transactionId],
      references: [transactions.id],
    }),
  }),
);

// ---------------------------------------------------------------------------
// card_invoice_settlements
// ---------------------------------------------------------------------------
export const cardInvoiceSettlementsRelations = relations(
  cardInvoiceSettlements,
  ({ one }) => ({
    sourceCardTransaction: one(cardTransactions, {
      fields: [cardInvoiceSettlements.sourceCardTransactionId],
      references: [cardTransactions.id],
    }),
    targetCardInvoice: one(cardInvoices, {
      fields: [cardInvoiceSettlements.targetCardInvoiceId],
      references: [cardInvoices.id],
    }),
  }),
);

// ---------------------------------------------------------------------------
// investments
// ---------------------------------------------------------------------------
export const investmentsRelations = relations(investments, ({ one, many }) => ({
  account: one(accounts, {
    fields: [investments.accountId],
    references: [accounts.id],
  }),
  financialConnection: one(financialConnections, {
    fields: [investments.financialConnectionId],
    references: [financialConnections.id],
  }),
  investmentTransactions: many(investmentTransactions),
}));

// ---------------------------------------------------------------------------
// investment_transactions
// ---------------------------------------------------------------------------
export const investmentTransactionsRelations = relations(
  investmentTransactions,
  ({ one }) => ({
    investment: one(investments, {
      fields: [investmentTransactions.investmentId],
      references: [investments.id],
    }),
  }),
);

// ---------------------------------------------------------------------------
// sync_runs
// ---------------------------------------------------------------------------
export const syncRunsRelations = relations(syncRuns, ({ one }) => ({
  financialConnection: one(financialConnections, {
    fields: [syncRuns.financialConnectionId],
    references: [financialConnections.id],
  }),
}));

/**
 * index.ts — @previa/db public API
 *
 * Single entry point for all database-related exports.
 * Consumers should import from "@previa/db" and never from internal paths.
 *
 * Usage:
 *   import { accounts, transactions, SOURCE_VALUES, type Account } from "@previa/db"
 */

// Schema tables and inferred types
export {
  financialConnections,
  financialConnectionConsents,
  accounts,
  transactions,
  cardInvoices,
  cardTransactions,
  cardInvoicePayments,
  investments,
  investmentTransactions,
  providerWebhookEvents,
  syncRuns,
} from "./schema";

export type {
  FinancialConnection,
  NewFinancialConnection,
  FinancialConnectionConsent,
  NewFinancialConnectionConsent,
  Account,
  NewAccount,
  Transaction,
  NewTransaction,
  CardInvoice,
  NewCardInvoice,
  CardTransaction,
  NewCardTransaction,
  CardInvoicePayment,
  NewCardInvoicePayment,
  Investment,
  NewInvestment,
  InvestmentTransaction,
  NewInvestmentTransaction,
  ProviderWebhookEvent,
  NewProviderWebhookEvent,
  SyncRun,
  NewSyncRun,
} from "./schema";

// Drizzle relational query declarations
export {
  financialConnectionsRelations,
  financialConnectionConsentsRelations,
  accountsRelations,
  transactionsRelations,
  cardInvoicesRelations,
  cardTransactionsRelations,
  cardInvoicePaymentsRelations,
  investmentsRelations,
  investmentTransactionsRelations,
  syncRunsRelations,
} from "./relations";

// Domain value enums and types
export {
  SOURCE_VALUES,
  DATA_STATE_VALUES,
  MOVEMENT_TYPE_VALUES,
  MOVEMENT_SUBTYPE_VALUES,
  FINANCIAL_CHANNEL_VALUES,
  ACCOUNT_TYPE_VALUES,
  CARD_BRAND_VALUES,
  INVOICE_STATUS_VALUES,
  CONNECTION_STATUS_VALUES,
  CONSENT_STATUS_VALUES,
  INVESTMENT_TYPE_VALUES,
  INVESTMENT_STATUS_VALUES,
  INVESTMENT_TRANSACTION_TYPE_VALUES,
  SYNC_TYPE_VALUES,
  SYNC_STATUS_VALUES,
  PROCESSING_STATUS_VALUES,
} from "./enums";

export type {
  Source,
  DataState,
  MovementType,
  MovementSubtype,
  FinancialChannel,
  AccountType,
  CardBrand,
  InvoiceStatus,
  ConnectionStatus,
  ConsentStatus,
  InvestmentType,
  InvestmentStatus,
  InvestmentTransactionType,
  SyncType,
  SyncStatus,
  ProcessingStatus,
} from "./enums";

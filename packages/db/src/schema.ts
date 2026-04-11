/**
 * schema.ts — Previa Finance database schema (v4)
 *
 * v4 changes from v3:
 *   1. Currency fields: `currency` → `currency_code` across all tables.
 *      `original_currency_code` and `exchange_rate` kept only where meaningful
 *      (card_transactions, investment_transactions).
 *   2. Date fields: `date` → `occurred_at` in transactions and card_transactions;
 *      `dateOccurredAt` kept as-is in investment_transactions (already correct).
 *      All SQL column names are now semantically explicit.
 *   3. accounts: `display_name` kept as the single name field. `name` (canonical)
 *      is NOT added — see comment in the table definition for rationale.
 *   4. FK strategy: `user_id` and `category_id` remain untyped `int` references.
 *      A `// @external-fk` comment marks every such field so they are easy to
 *      find when the auth/categories modules are integrated.
 *   5. bigint consistency: all monetary fields use `bigint` with `mode: "bigint"`.
 *      A `// @serialize-to-string` comment marks every bigint field that will
 *      require JSON serialization care in the API layer.
 *
 * Tables defined here:
 *   financial_connections, financial_connection_consents, accounts,
 *   transactions, card_invoices, card_transactions, card_invoice_payments,
 *   investments, investment_transactions, provider_webhook_events, sync_runs
 *
 * External dependencies (not redefined here):
 *   users      — managed by the auth module      (@external-fk: user_id)
 *   categories — managed by the categories module (@external-fk: category_id)
 */

import {
  mysqlTable,
  int,
  bigint,
  varchar,
  text,
  boolean,
  timestamp,
  date,
  json,
  decimal,
  uniqueIndex,
  index,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Standard audit timestamps present on every mutable table. */
const timestamps = {
  createdAt: timestamp("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdate(() => sql`CURRENT_TIMESTAMP`),
};

// ---------------------------------------------------------------------------
// financial_connections
// Represents a user's connection to a financial institution via Open Finance.
// One connection = one Pluggy Item (one institution, potentially multiple accounts).
// ---------------------------------------------------------------------------
export const financialConnections = mysqlTable(
  "financial_connections",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(), // @external-fk: users.id

    provider: varchar("provider", { length: 50 }).notNull().default("pluggy"),
    providerItemId: varchar("provider_item_id", { length: 255 }),
    providerConnectorId: int("provider_connector_id"),
    clientUserId: varchar("client_user_id", { length: 255 }),

    // Operational state
    status: varchar("status", { length: 50 }).notNull(),
    executionStatus: varchar("execution_status", { length: 50 }),
    lastSyncAt: timestamp("last_sync_at"),
    nextAutoSyncAt: timestamp("next_auto_sync_at"),

    // Consent lifecycle
    consentExpiresAt: timestamp("consent_expires_at"),
    consentRevokedAt: timestamp("consent_revoked_at"),

    // Products and permissions granted by the user
    productsEnabled: json("products_enabled"),
    permissionsGranted: json("permissions_granted"),

    // Raw provider payload for debugging and reconciliation
    providerPayload: json("provider_payload"),

    ...timestamps,
  },
  (t) => [
    uniqueIndex("uq_fin_conn_provider_item").on(t.providerItemId),
    index("idx_fin_conn_user").on(t.userId),
    index("idx_fin_conn_status").on(t.status),
  ],
);

export type FinancialConnection = typeof financialConnections.$inferSelect;
export type NewFinancialConnection = typeof financialConnections.$inferInsert;

// ---------------------------------------------------------------------------
// financial_connection_consents
// Audit trail of Open Finance consents. Each renewal or revocation creates
// a new row, preserving the full history.
// ---------------------------------------------------------------------------
export const financialConnectionConsents = mysqlTable(
  "financial_connection_consents",
  {
    id: int("id").autoincrement().primaryKey(),
    financialConnectionId: int("financial_connection_id").notNull(),

    providerConsentId: varchar("provider_consent_id", { length: 255 }).notNull(),
    status: varchar("status", { length: 50 }).notNull(),

    products: json("products"),
    permissionsGranted: json("permissions_granted"),

    expiresAt: timestamp("expires_at"),
    revokedAt: timestamp("revoked_at"),

    // Raw payload for auditing
    payload: json("payload"),

    ...timestamps,
  },
  (t) => [
    index("idx_consent_connection").on(t.financialConnectionId),
    index("idx_consent_provider_id").on(t.providerConsentId),
    index("idx_consent_expires").on(t.expiresAt),
  ],
);

export type FinancialConnectionConsent =
  typeof financialConnectionConsents.$inferSelect;
export type NewFinancialConnectionConsent =
  typeof financialConnectionConsents.$inferInsert;

// ---------------------------------------------------------------------------
// accounts
// Unified table for all financial instruments: bank accounts, credit cards,
// and investment accounts — both manual and connected via Open Finance.
// financial_connection_id = NULL means a manually managed account.
//
// v4 note — display_name vs name:
//   A separate `name` (canonical) field was considered and deliberately NOT
//   added. For accounts, the display_name IS the canonical name: the user
//   sets it once (or it is populated from the provider) and it is the single
//   reference used everywhere in the UI and in reports. Adding a second
//   `name` field would create a synchronisation problem with no clear owner.
//   If a canonical slug is needed in the future (e.g. for deduplication),
//   it should be derived programmatically, not stored.
// ---------------------------------------------------------------------------
export const accounts = mysqlTable(
  "accounts",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(), // @external-fk: users.id
    financialConnectionId: int("financial_connection_id"),

    // Type and channel
    type: varchar("type", { length: 50 }).notNull(),              // AccountType
    subtype: varchar("subtype", { length: 50 }),
    financialChannel: varchar("financial_channel", { length: 50 }).notNull(), // FinancialChannel

    // Identity
    // display_name: the single human-readable name for this account.
    // Set by the user or populated from the provider. Used in UI and reports.
    displayName: varchar("display_name", { length: 200 }).notNull(),
    institutionName: varchar("institution_name", { length: 200 }),
    ownerName: varchar("owner_name", { length: 200 }),

    // Card identity (nullable — only for credit cards)
    cardBrand: varchar("card_brand", { length: 50 }),             // CardBrand
    cardLast4: varchar("card_last4", { length: 4 }),
    maskedNumber: varchar("masked_number", { length: 30 }),

    // Balances and limits (all in minor units / centavos)
    // @serialize-to-string: balanceMinor, creditLimitMinor, availableCreditLimitMinor
    currencyCode: varchar("currency_code", { length: 3 }).notNull().default("BRL"), // v4: was `currency`
    balanceMinor: bigint("balance_minor", { mode: "bigint" }).notNull().default(0n), // @serialize-to-string
    creditLimitMinor: bigint("credit_limit_minor", { mode: "bigint" }),              // @serialize-to-string
    availableCreditLimitMinor: bigint("available_credit_limit_minor", { mode: "bigint" }), // @serialize-to-string

    // Invoice configuration (credit cards only)
    closingDay: int("closing_day"),
    dueDay: int("due_day"),

    // Data origin
    source: varchar("source", { length: 50 }).notNull().default("manual"), // Source
    provider: varchar("provider", { length: 50 }),
    providerAccountId: varchar("provider_account_id", { length: 255 }),
    providerItemId: varchar("provider_item_id", { length: 255 }),

    isActive: boolean("is_active").notNull().default(true),

    ...timestamps,
  },
  (t) => [
    uniqueIndex("uq_accounts_provider_account").on(t.providerAccountId),
    index("idx_accounts_user").on(t.userId),
    index("idx_accounts_provider_item").on(t.providerItemId),
    // Composite index for parser-based card matching (institution + brand + last4)
    index("idx_accounts_card_identity").on(
      t.institutionName,
      t.cardBrand,
      t.cardLast4,
    ),
  ],
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

// ---------------------------------------------------------------------------
// transactions
// Bank account movements: income, expenses, transfers, invoice payments.
// IMPORTANT: Credit card purchases do NOT live here — they live in
// card_transactions. Only the invoice payment (debit from bank account)
// creates a record here.
// ---------------------------------------------------------------------------
export const transactions = mysqlTable(
  "transactions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),   // @external-fk: users.id
    accountId: int("account_id").notNull(),

    // -----------------------------------------------------------------------
    // Data hierarchy and classification (core business rules)
    // -----------------------------------------------------------------------
    source: varchar("source", { length: 50 }).notNull(),              // Source
    dataState: varchar("data_state", { length: 50 }).notNull(),       // DataState
    movementType: varchar("movement_type", { length: 50 }).notNull(), // MovementType
    movementSubtype: varchar("movement_subtype", { length: 50 }),     // MovementSubtype
    financialChannel: varchar("financial_channel", { length: 50 }).notNull(), // FinancialChannel

    // -----------------------------------------------------------------------
    // Financial values (all in minor units / centavos)
    // Negative = outflow, Positive = inflow
    // @serialize-to-string: amountMinor, balanceAfterMinor
    // -----------------------------------------------------------------------
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),          // @serialize-to-string
    currencyCode: varchar("currency_code", { length: 3 }).notNull().default("BRL"), // v4: was `currency`
    balanceAfterMinor: bigint("balance_after_minor", { mode: "bigint" }),       // @serialize-to-string

    // -----------------------------------------------------------------------
    // Dates and competency
    // v4: `date` → `occurred_at` for semantic clarity
    // -----------------------------------------------------------------------
    occurredAt: timestamp("occurred_at").notNull(),                   // v4: was `date`
    competencyMonth: varchar("competency_month", { length: 7 }).notNull(), // YYYY-MM

    // -----------------------------------------------------------------------
    // Description and category
    // -----------------------------------------------------------------------
    description: text("description").notNull(),
    normalizedDescription: varchar("normalized_description", { length: 500 }),
    categoryId: int("category_id"),  // @external-fk: categories.id

    // -----------------------------------------------------------------------
    // Installments
    // -----------------------------------------------------------------------
    installmentNumber: int("installment_number"),
    installmentTotal: int("installment_total"),
    installmentGroupId: varchar("installment_group_id", { length: 255 }),

    // -----------------------------------------------------------------------
    // Recurrence
    // -----------------------------------------------------------------------
    isRecurring: boolean("is_recurring").notNull().default(false),
    recurringRuleId: int("recurring_rule_id"),

    // -----------------------------------------------------------------------
    // Reconciliation between sources
    // fingerprint: SHA-256 of (competencyMonth | amountMinor | normalizedDescription)
    // Generated by @previa/core buildFingerprintFromRaw()
    // -----------------------------------------------------------------------
    fingerprint: varchar("fingerprint", { length: 64 }),  // v4: 255 → 64 (SHA-256 hex = 64 chars)
    isReconciled: boolean("is_reconciled").notNull().default(false),
    reconciledGroupId: varchar("reconciled_group_id", { length: 255 }),

    // -----------------------------------------------------------------------
    // Open Finance
    // -----------------------------------------------------------------------
    providerTransactionId: varchar("provider_transaction_id", { length: 255 }),
    providerPayload: json("provider_payload"),

    ...timestamps,
  },
  (t) => [
    uniqueIndex("uq_trans_provider_id").on(t.providerTransactionId),
    index("idx_trans_user_occurred").on(t.userId, t.occurredAt),      // v4: was idx_trans_user_date
    index("idx_trans_competency").on(t.competencyMonth),
    index("idx_trans_fingerprint").on(t.fingerprint),
    index("idx_trans_reconciled_group").on(t.reconciledGroupId),
    index("idx_trans_source").on(t.source),
    index("idx_trans_data_state").on(t.dataState),
  ],
);

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;

// ---------------------------------------------------------------------------
// card_invoices
// The monthly liability generated by credit card usage.
// Paying this invoice is the event that affects the bank account cash flow.
// ---------------------------------------------------------------------------
export const cardInvoices = mysqlTable(
  "card_invoices",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),   // @external-fk: users.id
    accountId: int("account_id").notNull(), // FK to credit card in accounts

    // Period
    invoiceMonth: varchar("invoice_month", { length: 7 }).notNull(), // YYYY-MM
    closingDate: timestamp("closing_date"),
    dueDate: timestamp("due_date").notNull(),

    // Values (minor units / centavos)
    // @serialize-to-string: all bigint fields below
    totalAmountMinor: bigint("total_amount_minor", { mode: "bigint" }).notNull().default(0n),       // @serialize-to-string
    minimumPaymentMinor: bigint("minimum_payment_minor", { mode: "bigint" }),                       // @serialize-to-string
    previousBalanceMinor: bigint("previous_balance_minor", { mode: "bigint" }).notNull().default(0n), // @serialize-to-string
    paidAmountMinor: bigint("paid_amount_minor", { mode: "bigint" }).notNull().default(0n),         // @serialize-to-string
    openAmountMinor: bigint("open_amount_minor", { mode: "bigint" }).notNull().default(0n),         // @serialize-to-string

    // State and origin
    status: varchar("status", { length: 50 }).notNull().default("OPEN"), // InvoiceStatus
    source: varchar("source", { length: 50 }).notNull(),                 // Source
    dataState: varchar("data_state", { length: 50 }).notNull(),          // DataState

    // Card identity (populated by parser or Open Finance)
    institutionName: varchar("institution_name", { length: 200 }),
    cardBrand: varchar("card_brand", { length: 50 }),
    cardLast4: varchar("card_last4", { length: 4 }),
    cardHolderName: varchar("card_holder_name", { length: 200 }),

    // Parser metadata (for PDF-imported invoices)
    parserStrategy: varchar("parser_strategy", { length: 100 }),
    confidenceScore: decimal("confidence_score", { precision: 5, scale: 4 }),

    // Open Finance
    providerBillId: varchar("provider_bill_id", { length: 255 }),
    providerAccountId: varchar("provider_account_id", { length: 255 }),
    providerItemId: varchar("provider_item_id", { length: 255 }),
    providerPayload: json("provider_payload"),

    ...timestamps,
  },
  (t) => [
    uniqueIndex("uq_invoice_account_month").on(t.accountId, t.invoiceMonth),
    uniqueIndex("uq_invoice_provider_bill").on(t.providerBillId),
    index("idx_invoice_user").on(t.userId),
    index("idx_invoice_month").on(t.invoiceMonth),
    index("idx_invoice_card_last4").on(t.cardLast4),
  ],
);

export type CardInvoice = typeof cardInvoices.$inferSelect;
export type NewCardInvoice = typeof cardInvoices.$inferInsert;

// ---------------------------------------------------------------------------
// card_transactions
// Individual purchases on a credit card that compose an invoice.
// These do NOT affect the bank account cash flow directly.
// ---------------------------------------------------------------------------
export const cardTransactions = mysqlTable(
  "card_transactions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),   // @external-fk: users.id
    cardInvoiceId: int("card_invoice_id").notNull(),

    // Hierarchy and classification
    source: varchar("source", { length: 50 }).notNull(),
    dataState: varchar("data_state", { length: 50 }).notNull(),
    movementType: varchar("movement_type", { length: 50 }).notNull().default("card_purchase"),
    movementSubtype: varchar("movement_subtype", { length: 50 }),

    // -----------------------------------------------------------------------
    // Financial values
    // amount_minor + currency_code: the value used in cash flow analysis (BRL)
    // original_amount_minor + original_currency_code: source value for international purchases
    // exchange_rate: only present when a conversion was applied
    // @serialize-to-string: amountMinor, originalAmountMinor
    // -----------------------------------------------------------------------
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),              // @serialize-to-string
    currencyCode: varchar("currency_code", { length: 3 }).notNull().default("BRL"), // v4: was `currency`
    originalAmountMinor: bigint("original_amount_minor", { mode: "bigint" }),       // @serialize-to-string
    originalCurrencyCode: varchar("original_currency_code", { length: 3 }),
    exchangeRate: decimal("exchange_rate", { precision: 12, scale: 6 }),

    // -----------------------------------------------------------------------
    // Dates and competency
    // v4: `date` → `occurred_at` for semantic clarity
    // -----------------------------------------------------------------------
    occurredAt: timestamp("occurred_at").notNull(),                    // v4: was `date`
    competencyMonth: varchar("competency_month", { length: 7 }).notNull(),

    // Description and category
    description: text("description").notNull(),
    normalizedDescription: varchar("normalized_description", { length: 500 }),
    categoryId: int("category_id"),  // @external-fk: categories.id

    // Merchant
    merchantName: varchar("merchant_name", { length: 255 }),
    merchantDocument: varchar("merchant_document", { length: 20 }),

    // Installments
    installmentNumber: int("installment_number"),
    installmentTotal: int("installment_total"),
    installmentGroupId: varchar("installment_group_id", { length: 255 }),

    // Reconciliation
    fingerprint: varchar("fingerprint", { length: 64 }), // v4: 255 → 64 (SHA-256 hex = 64 chars)
    isReconciled: boolean("is_reconciled").notNull().default(false),
    reconciledGroupId: varchar("reconciled_group_id", { length: 255 }),

    // Open Finance and source documents
    providerTransactionId: varchar("provider_transaction_id", { length: 255 }),
    providerPayload: json("provider_payload"),
    receiptDocumentId: int("receipt_document_id"),

    ...timestamps,
  },
  (t) => [
    uniqueIndex("uq_card_trans_provider_id").on(t.providerTransactionId),
    index("idx_card_trans_user_occurred").on(t.userId, t.occurredAt), // v4: was idx_card_trans_user_date
    index("idx_card_trans_competency").on(t.competencyMonth),
    index("idx_card_trans_fingerprint").on(t.fingerprint),
    index("idx_card_trans_reconciled_group").on(t.reconciledGroupId),
  ],
);

export type CardTransaction = typeof cardTransactions.$inferSelect;
export type NewCardTransaction = typeof cardTransactions.$inferInsert;

// ---------------------------------------------------------------------------
// card_invoice_payments
// Links the cash outflow (transaction in bank account) to the liability
// settlement (card_invoice). Supports partial payments and split payments
// across multiple invoices.
// ---------------------------------------------------------------------------
export const cardInvoicePayments = mysqlTable(
  "card_invoice_payments",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),   // @external-fk: users.id
    cardInvoiceId: int("card_invoice_id").notNull(),
    transactionId: int("transaction_id").notNull(),

    allocatedAmountMinor: bigint("allocated_amount_minor", { mode: "bigint" }).notNull(), // @serialize-to-string
    currencyCode: varchar("currency_code", { length: 3 }).notNull().default("BRL"),
    paymentDate: timestamp("payment_date").notNull(),

    ...timestamps,
  },
  (t) => [
    uniqueIndex("uq_payment_invoice_trans").on(t.cardInvoiceId, t.transactionId),
    index("idx_payment_user").on(t.userId),
  ],
);

export type CardInvoicePayment = typeof cardInvoicePayments.$inferSelect;
export type NewCardInvoicePayment = typeof cardInvoicePayments.$inferInsert;

// ---------------------------------------------------------------------------
// investments
// Current position of an investment. Supports multiple sources (Pluggy,
// PDF statement, manual) and rich metadata for Premium plan analysis.
// ---------------------------------------------------------------------------
export const investments = mysqlTable(
  "investments",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),   // @external-fk: users.id
    accountId: int("account_id").notNull(),
    financialConnectionId: int("financial_connection_id"),

    // Hierarchy and origin
    source: varchar("source", { length: 50 }).notNull().default("manual"),
    dataState: varchar("data_state", { length: 50 }).notNull().default("consolidated"),
    provider: varchar("provider", { length: 50 }),

    // Identity
    name: varchar("name", { length: 200 }).notNull(),
    type: varchar("type", { length: 50 }).notNull(),              // InvestmentType
    investmentSubtype: varchar("investment_subtype", { length: 50 }),
    status: varchar("status", { length: 50 }).notNull().default("ACTIVE"), // InvestmentStatus

    // Issuer and custodian
    issuer: varchar("issuer", { length: 200 }),
    institutionName: varchar("institution_name", { length: 200 }),

    // Dates
    issueDate: date("issue_date"),
    maturityDate: date("maturity_date"),

    // Current value
    balanceMinor: bigint("balance_minor", { mode: "bigint" }).notNull().default(0n), // @serialize-to-string
    currencyCode: varchar("currency_code", { length: 3 }).notNull().default("BRL"),  // v4: was `currency`

    // Open Finance
    providerInvestmentId: varchar("provider_investment_id", { length: 255 }),
    providerPayload: json("provider_payload"),

    // Additional metadata (rate, indexer, etc.)
    metadata: json("metadata"),

    ...timestamps,
  },
  (t) => [
    uniqueIndex("uq_investment_provider_id").on(t.providerInvestmentId),
    index("idx_investments_user").on(t.userId),
    index("idx_investments_connection").on(t.financialConnectionId),
  ],
);

export type Investment = typeof investments.$inferSelect;
export type NewInvestment = typeof investments.$inferInsert;

// ---------------------------------------------------------------------------
// investment_transactions
// History of investment movements (buy, sell, yield, tax).
// Prepared for profitability analysis and AI-generated reports.
// ---------------------------------------------------------------------------
export const investmentTransactions = mysqlTable(
  "investment_transactions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),   // @external-fk: users.id
    investmentId: int("investment_id").notNull(),
    financialConnectionId: int("financial_connection_id"),

    // Hierarchy and origin
    source: varchar("source", { length: 50 }).notNull().default("pluggy"),
    dataState: varchar("data_state", { length: 50 }).notNull().default("official"),
    provider: varchar("provider", { length: 50 }),

    // Type and values
    type: varchar("type", { length: 50 }).notNull(), // InvestmentTransactionType
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(), // @serialize-to-string
    currencyCode: varchar("currency_code", { length: 3 }).notNull().default("BRL"), // v4: was `currency`

    // For foreign-currency investment transactions (e.g. BDRs, ETFs in USD)
    originalAmountMinor: bigint("original_amount_minor", { mode: "bigint" }),       // @serialize-to-string
    originalCurrencyCode: varchar("original_currency_code", { length: 3 }),
    exchangeRate: decimal("exchange_rate", { precision: 12, scale: 6 }),

    dateOccurredAt: timestamp("date_occurred_at").notNull(), // already correct in v3

    // Open Finance
    providerTransactionId: varchar("provider_transaction_id", { length: 255 }),
    providerPayload: json("provider_payload"),

    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex("uq_inv_trans_provider_id").on(t.providerTransactionId),
    index("idx_inv_trans_investment").on(t.investmentId),
    index("idx_inv_trans_user").on(t.userId),
    index("idx_inv_trans_date").on(t.dateOccurredAt),
  ],
);

export type InvestmentTransaction = typeof investmentTransactions.$inferSelect;
export type NewInvestmentTransaction =
  typeof investmentTransactions.$inferInsert;

// ---------------------------------------------------------------------------
// provider_webhook_events
// Incoming events from the Open Finance provider (e.g. Pluggy webhooks).
// An async worker reads from this table and marks events as processed.
// event_id has a UNIQUE index to prevent duplicate processing.
// ---------------------------------------------------------------------------
export const providerWebhookEvents = mysqlTable(
  "provider_webhook_events",
  {
    id: int("id").autoincrement().primaryKey(),
    provider: varchar("provider", { length: 50 }).notNull().default("pluggy"),

    eventId: varchar("event_id", { length: 255 }),
    eventType: varchar("event_type", { length: 100 }).notNull(),

    providerItemId: varchar("provider_item_id", { length: 255 }),
    providerAccountId: varchar("provider_account_id", { length: 255 }),

    payload: json("payload").notNull(),
    processingStatus: varchar("processing_status", { length: 50 })
      .notNull()
      .default("PENDING"), // ProcessingStatus
    errorMessage: text("error_message"),
    processedAt: timestamp("processed_at"),

    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex("uq_webhook_event_id").on(t.eventId),
    index("idx_webhook_provider_item").on(t.providerItemId),
    index("idx_webhook_processing_status").on(t.processingStatus),
  ],
);

export type ProviderWebhookEvent = typeof providerWebhookEvents.$inferSelect;
export type NewProviderWebhookEvent =
  typeof providerWebhookEvents.$inferInsert;

// ---------------------------------------------------------------------------
// sync_runs
// Audit log of synchronisation executions. sync_type distinguishes whether
// the run was triggered by the user, a background job, or a webhook.
// ---------------------------------------------------------------------------
export const syncRuns = mysqlTable(
  "sync_runs",
  {
    id: int("id").autoincrement().primaryKey(),
    financialConnectionId: int("financial_connection_id").notNull(),
    provider: varchar("provider", { length: 50 }),

    syncType: varchar("sync_type", { length: 50 }).notNull(), // SyncType
    status: varchar("status", { length: 50 }).notNull(),      // SyncStatus

    startedAt: timestamp("started_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    finishedAt: timestamp("finished_at"),
    errorMessage: text("error_message"),
    metrics: json("metrics"),
  },
  (t) => [
    index("idx_sync_run_connection").on(t.financialConnectionId),
    index("idx_sync_run_started").on(t.startedAt),
    index("idx_sync_run_status").on(t.status),
  ],
);

export type SyncRun = typeof syncRuns.$inferSelect;
export type NewSyncRun = typeof syncRuns.$inferInsert;

/**
 * enums.ts — Previa Finance domain value enums
 *
 * All domain values are defined here as TypeScript const arrays + union types.
 * The database stores these as VARCHAR(50) — validation is enforced at the
 * application layer via these definitions (Zod, Drizzle insert types, etc.).
 *
 * Why VARCHAR instead of MySQL ENUM?
 *   Adding a new provider or movement type in production would require an
 *   ALTER TABLE … MODIFY COLUMN, which can lock large tables. VARCHAR + app
 *   validation gives us the same safety with zero migration overhead.
 */

// ---------------------------------------------------------------------------
// Source — origin of the data (hierarchy: pluggy > pdf_statement > pdf_invoice > nota_fiscal > manual)
// ---------------------------------------------------------------------------
export const SOURCE_VALUES = [
  "pluggy",
  "pdf_statement",
  "pdf_invoice",
  "nota_fiscal",
  "manual",
] as const;

export type Source = (typeof SOURCE_VALUES)[number];

// ---------------------------------------------------------------------------
// DataState — confidence level of the record
//   projected    → estimated from rules (installments, recurring)
//   consolidated → confirmed by a document (PDF invoice/statement)
//   official     → confirmed by the financial institution (Open Finance)
// ---------------------------------------------------------------------------
export const DATA_STATE_VALUES = [
  "projected",
  "consolidated",
  "official",
] as const;

export type DataState = (typeof DATA_STATE_VALUES)[number];

// ---------------------------------------------------------------------------
// MovementType — economic nature of the transaction
// ---------------------------------------------------------------------------
export const MOVEMENT_TYPE_VALUES = [
  "income",           // Receita (salário, freelance, etc.)
  "expense",          // Despesa em conta corrente
  "transfer",         // Transferência entre contas do mesmo titular
  "investment",       // Aporte em investimento (saída de caixa)
  "investment_redemption", // Resgate de investimento (entrada de caixa)
  "liability_payment",// Pagamento de dívida/fatura
  "card_purchase",    // Compra no cartão (gera passivo, não afeta caixa)
  "refund",           // Estorno
  "fee",              // Tarifa bancária
  "interest",         // Juros debitados
] as const;

export type MovementType = (typeof MOVEMENT_TYPE_VALUES)[number];

// ---------------------------------------------------------------------------
// MovementSubtype — operational detail of the transaction
// ---------------------------------------------------------------------------
export const MOVEMENT_SUBTYPE_VALUES = [
  "pix",
  "ted",
  "doc",
  "boleto",
  "auto_debit",       // Débito automático
  "invoice_payment",  // Pagamento de fatura de cartão
  "installment",      // Parcela de compra parcelada
  "single",           // Compra à vista
  "recurring",        // Recorrente (assinatura, mensalidade)
] as const;

export type MovementSubtype = (typeof MOVEMENT_SUBTYPE_VALUES)[number];

// ---------------------------------------------------------------------------
// FinancialChannel — the instrument through which the transaction occurred
// ---------------------------------------------------------------------------
export const FINANCIAL_CHANNEL_VALUES = [
  "bank_account",
  "credit_card",
  "investment_account",
  "cash",
] as const;

export type FinancialChannel = (typeof FINANCIAL_CHANNEL_VALUES)[number];

// ---------------------------------------------------------------------------
// AccountType — type of financial account
// ---------------------------------------------------------------------------
export const ACCOUNT_TYPE_VALUES = [
  "CHECKING",
  "SAVINGS",
  "CREDIT_CARD",
  "INVESTMENT",
] as const;

export type AccountType = (typeof ACCOUNT_TYPE_VALUES)[number];

// ---------------------------------------------------------------------------
// CardBrand — card network / brand
// ---------------------------------------------------------------------------
export const CARD_BRAND_VALUES = [
  "VISA",
  "MASTERCARD",
  "ELO",
  "AMEX",
  "HIPERCARD",
  "OTHER",
] as const;

export type CardBrand = (typeof CARD_BRAND_VALUES)[number];

// ---------------------------------------------------------------------------
// InvoiceStatus — state of a credit card invoice
// ---------------------------------------------------------------------------
export const INVOICE_STATUS_VALUES = [
  "OPEN",
  "CLOSED",
  "PAID",
  "PARTIALLY_PAID",
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUS_VALUES)[number];

// ---------------------------------------------------------------------------
// ConnectionStatus — state of an Open Finance connection (Pluggy Item)
// ---------------------------------------------------------------------------
export const CONNECTION_STATUS_VALUES = [
  "UPDATED",
  "UPDATING",
  "WAITING_USER_INPUT",
  "WAITING_USER_ACTION",
  "LOGIN_ERROR",
  "OUTDATED",
  "MERGING",
] as const;

export type ConnectionStatus = (typeof CONNECTION_STATUS_VALUES)[number];

// ---------------------------------------------------------------------------
// ConsentStatus — state of an Open Finance consent
// ---------------------------------------------------------------------------
export const CONSENT_STATUS_VALUES = [
  "AUTHORISED",
  "AWAITING_AUTHORISATION",
  "REJECTED",
  "REVOKED",
  "CONSUMED",
] as const;

export type ConsentStatus = (typeof CONSENT_STATUS_VALUES)[number];

// ---------------------------------------------------------------------------
// InvestmentType — asset class
// ---------------------------------------------------------------------------
export const INVESTMENT_TYPE_VALUES = [
  "FIXED_INCOME",
  "MUTUAL_FUND",
  "EQUITY",
  "CRYPTO",
  "PENSION",
  "REAL_ESTATE",
  "OTHER",
] as const;

export type InvestmentType = (typeof INVESTMENT_TYPE_VALUES)[number];

// ---------------------------------------------------------------------------
// InvestmentStatus — lifecycle state of an investment position
// ---------------------------------------------------------------------------
export const INVESTMENT_STATUS_VALUES = [
  "ACTIVE",
  "REDEEMED",
  "MATURED",
] as const;

export type InvestmentStatus = (typeof INVESTMENT_STATUS_VALUES)[number];

// ---------------------------------------------------------------------------
// InvestmentTransactionType — type of investment movement
// ---------------------------------------------------------------------------
export const INVESTMENT_TRANSACTION_TYPE_VALUES = [
  "BUY",
  "SELL",
  "YIELD",
  "TAX",
  "TRANSFER_IN",
  "TRANSFER_OUT",
] as const;

export type InvestmentTransactionType =
  (typeof INVESTMENT_TRANSACTION_TYPE_VALUES)[number];

// ---------------------------------------------------------------------------
// SyncType — what triggered a sync run
// ---------------------------------------------------------------------------
export const SYNC_TYPE_VALUES = [
  "MANUAL",    // Triggered by user action
  "AUTO",      // Triggered by scheduled background job
  "WEBHOOK",   // Triggered by provider webhook event
  "INITIAL",   // First sync after connecting an account
] as const;

export type SyncType = (typeof SYNC_TYPE_VALUES)[number];

// ---------------------------------------------------------------------------
// SyncStatus — outcome of a sync run
// ---------------------------------------------------------------------------
export const SYNC_STATUS_VALUES = [
  "STARTED",
  "SUCCESS",
  "PARTIAL",
  "FAILED",
] as const;

export type SyncStatus = (typeof SYNC_STATUS_VALUES)[number];

// ---------------------------------------------------------------------------
// ProcessingStatus — state of a webhook event processing
// ---------------------------------------------------------------------------
export const PROCESSING_STATUS_VALUES = [
  "PENDING",
  "PROCESSING",
  "SUCCESS",
  "FAILED",
  "SKIPPED",
] as const;

export type ProcessingStatus = (typeof PROCESSING_STATUS_VALUES)[number];
 

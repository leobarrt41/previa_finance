// Domain types for CashFlowEngine
// All amounts are in minor units (integer, bigint-friendly)

export type Minor = number | bigint

// Competency month in YYYY-MM format (e.g. '2026-04')
export type CompetencyMonth = string

export type TransactionType =
  | 'income'
  | 'expense'
  | 'transfer'
  | 'card_purchase'
  | 'liability_payment'

export interface Transaction {
  id: string
  // the month when this transaction impacts competency (YYYY-MM)
  competencyMonth: CompetencyMonth
  type: TransactionType
  // amount in minor units; positive numbers
  amountMinor: Minor
  // optional external references (card id, invoice id, etc.)
  metadata?: Record<string, unknown>
}

// Represents an open card invoice (a grouping of card purchases that will be paid later)
export interface CardInvoice {
  id: string
  // the competency month when purchases were made
  competencyMonth: CompetencyMonth
  // due month when invoice payment will hit cash (YYYY-MM)
  dueMonth: CompetencyMonth
  // total amount owed (minor units)
  amountMinor: Minor
  // how much already paid from this invoice (minor units)
  paidMinor?: Minor
}

// Future obligations/commitments (recurring or one-off)
export interface Obligation {
  id: string
  // month when obligation first applies
  competencyMonth: CompetencyMonth
  // monthly amount (minor units)
  monthlyAmountMinor: Minor
  // optional end month (YYYY-MM). If undefined, assume ongoing
  endMonth?: CompetencyMonth
  // metadata for owner/scoping
  metadata?: Record<string, unknown>
}

// Invoice payment event (affects cash when paid)
export interface InvoicePayment {
  id: string
  competencyMonth: CompetencyMonth
  amountMinor: Minor
  metadata?: Record<string, unknown>
}

// Normalized input accepted by the engine
export interface CashFlowInput {
  // opening balance at the start of the earliest month (minor units)
  openingBalanceMinor: Minor
  // transactions (including card purchases and liability payments)
  transactions?: Transaction[]
  // card invoices that are outstanding or scheduled
  cardInvoices?: CardInvoice[]
  // invoice payments (explicit cash events)
  invoicePayments?: InvoicePayment[]
  // future obligations / recurring commitments
  obligations?: Obligation[]
  // list of months to project (ordered)
  projectionMonths: CompetencyMonth[]
}

// Output per month
export interface MonthlyCashFlow {
  competencyMonth: CompetencyMonth
  openingBalanceMinor: Minor
  totalIncomeMinor: Minor
  totalExpenseMinor: Minor
  totalLiabilityPaymentMinor: Minor
  totalCommittedMinor: Minor
  projectedClosingBalanceMinor: Minor
  debtOpenMinor: Minor
}

export interface CashFlowOutput {
  monthly: MonthlyCashFlow[]
}

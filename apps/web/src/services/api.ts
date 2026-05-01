/**
 * api.ts — Previa Finance API Client
 *
 * Todos os contratos foram mapeados directamente das rotas em apps/api/src/routes/.
 * Nenhum contrato foi inventado.
 *
 * Auth: suporte a Clerk Bearer token via getAuthToken().
 * Em modo desenvolvimento sem Clerk configurado, getAuthToken() retorna null
 * e as chamadas são feitas sem Authorization header (a API aceita isso
 * enquanto requireClerkAuth não estiver aplicado nas rotas).
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAuthToken(): string | null {
  // Clerk SDK expõe o token via window.__clerk_db_jwt ou via hook.
  // Em dev sem Clerk, retornamos null — a API não exige auth nas rotas actuais.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clerk = (window as any).Clerk
    if (clerk?.session) {
      return clerk.session.lastActiveToken?.getRawString?.() ?? null
    }
  } catch {
    // Clerk não disponível
  }
  return null
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAuthToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(path, { ...options, headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, getApiErrorMessage(body, res.statusText), body)
  }
  if (res.status === 204) {
    return undefined as T
  }
  return res.json() as Promise<T>
}

/** Like `request` but does NOT set Content-Type (lets browser set it for FormData). */
async function requestRaw<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAuthToken()
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(path, { ...options, headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, getApiErrorMessage(body, res.statusText), body)
  }
  if (res.status === 204) {
    return undefined as T
  }
  return res.json() as Promise<T>
}

function getApiErrorMessage(body: unknown, fallback: string): string {
  if (typeof body === 'string' && body.trim()) return body
  if (body && typeof body === 'object') {
    const asRecord = body as Record<string, unknown>
    const nestedError = asRecord.error
    if (typeof nestedError === 'string' && nestedError.trim()) return nestedError
    if (nestedError && typeof nestedError === 'object') {
      const nestedMessage = (nestedError as Record<string, unknown>).message
      if (typeof nestedMessage === 'string' && nestedMessage.trim()) return nestedMessage
    }
    const topLevelMessage = asRecord.message
    if (typeof topLevelMessage === 'string' && topLevelMessage.trim()) return topLevelMessage
  }
  return fallback
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// ---------------------------------------------------------------------------
// Types — mapeados dos contratos reais da API
// ---------------------------------------------------------------------------

// --- CashFlow ---

export interface CashFlowTransaction {
  id: string
  competencyMonth: string // YYYY-MM
  amountMinor: number     // positivo = receita, negativo = despesa
  type: 'income' | 'expense' | 'transfer' | 'card_purchase' | 'liability_payment'
  description: string
  metadata?: Record<string, unknown>
}

export interface CashFlowCardInvoice {
  id: string
  competencyMonth: string
  dueMonth: string
  amountMinor: number
  paidMinor?: number
  previousBalanceMinor?: number
  totalAmountMinor?: number
  openAmountMinor?: number
}

export interface CashFlowForecast {
  id: string
  competencyMonth: string
  amountMinor: number
  recurrence?: 'one-time' | 'monthly' | 'yearly'
  recurrenceEnd?: string | null
  description?: string
  isActive?: boolean
}

export interface CashFlowRecurringTransaction extends CashFlowForecast {
  paidMonths: string[]
  createdAt?: string | null
  updatedAt?: string | null
}

export interface CashFlowRequest {
  startMonth: string        // YYYY-MM
  months: number            // quantos meses projectar
  openingBalanceMinor: number
  transactions?: CashFlowTransaction[]
  cardInvoices?: CashFlowCardInvoice[]
  forecasts?: CashFlowForecast[]
}

export interface MonthlyCashFlow {
  competencyMonth: string
  openingBalanceMinor: string
  totalIncomeMinor: string
  totalExpenseMinor: string
  totalLiabilityPaymentMinor: string
  totalCommittedMinor: string
  projectedClosingBalanceMinor: string
  debtOpenMinor: string
}

export interface CashFlowResponse {
  monthly: MonthlyCashFlow[]
  cardInvoicesByMonth?: Array<{
    invoiceMonth: string
    institutionName?: string | null
    cardBrand?: string | null
    cardLast4?: string | null
    comprasDoMesMinor: string
    abertoAnteriorMinor: string
    totalFaturaAnteriorMinor?: string
    totalFaturaMinor: string
    totalAmountMinor: string
    previousBalanceMinor?: string
    paidAmountMinor: string
    openAmountMinor: string
  }>
}

export interface CashFlowRecurringListResponse {
  items: CashFlowRecurringTransaction[]
}

export interface CashFlowRecurringUpsertBody {
  competencyMonth: string
  amountMinor: number
  recurrence: 'one-time' | 'monthly' | 'yearly'
  recurrenceEnd?: string | null
  description?: string
  isActive?: boolean
}

// --- Budget ---

export interface BudgetItem {
  categoryId: string
  categoryName: string
  budgetAmountMinor: number
  period: 'monthly' | 'yearly'
}

export interface SpendingItem {
  categoryId: string
  categoryName: string
  currentPeriodSpentMinor: number
  transactionCount: number
}

export interface BudgetStatusDetail {
  status: string
  budgetAmountMinor: string
  spentMinor: string
  remainingMinor: string
}

export interface BudgetImpact {
  categoryId: string
  utilizationBefore: number
  utilizationAfter: number
  budgetAmountMinor: string
  currentSpentMinor: string
  newTransactionMinor: string
  spentAfterMinor: string
  remainingAfterMinor: string
  statusBefore: BudgetStatusDetail
  statusAfter: BudgetStatusDetail
  message: string
}

export interface TransactionAnalysisRequest {
  amountMinor: number
  categoryId: string
  description: string
  merchantName?: string
  currentMonth: string
  budgets: BudgetItem[]
  spending: SpendingItem[]
}

export interface TransactionAnalysisResponse {
  budgetImpact?: BudgetImpact
  insights: string[]
  warnings: string[]
  recommendations: string[]
}

export interface BudgetAnalysisRequest {
  currentMonth: string
  budgets: BudgetItem[]
  spending: SpendingItem[]
}

export interface BudgetAnalysisResponse {
  totalBudgetMinor: string
  totalSpentMinor: string
  totalRemainingMinor: string
  budgetStatuses: Array<{
    categoryId: string
    categoryName: string
    budgetAmountMinor: string
    spentMinor: string
    remainingMinor: string
    status: string
    utilizationPercent: number
  }>
}

// --- Categories ---

export interface Category {
  id: string
  name: string
  slug: string
  type: 'expense' | 'income' | 'transfer'
  parentId: string | null
  isSystem: boolean
}

export interface AccountMonthSummary {
  month: string
  count: number
}

export interface AccountSummary {
  id: number
  type: string
  financialChannel: string
  displayName: string
  institutionName: string | null
  cardBrand: string | null
  cardLast4: string | null
  bankMonths: AccountMonthSummary[]
  invoiceMonths: AccountMonthSummary[]
  totalBankEntries: number
  totalInvoiceEntries: number
}

export interface AccountInvoiceLine {
  id: number
  occurredAt: string
  description: string
  amountMinor: number
  competencyMonth: string
  installmentNumber: number | null
  installmentTotal: number | null
  categoryId: string | null
  categoryName: string | null
}

export interface AccountInvoiceLineCategoryUpdate {
  id: number
  categoryId: string | null
  categoryName: string | null
}

export interface AccountInvoiceDetails {
  accountId: number
  month: string
  account: {
    id: number
    displayName: string
    type: string
    institutionName: string | null
    cardBrand: string | null
    cardLast4: string | null
  }
  invoice: {
    id: number
    invoiceMonth: string
    dueDate: string
    totalAmountMinor: number
    minimumPaymentMinor: number | null
    paidAmountMinor: number
    openAmountMinor: number
    previousBalanceMinor: number // saldo anterior
    emAbertoMinor: number // campo calculado para contas
    status: string
    parserStrategy: string | null
    institutionName: string | null
    cardBrand: string | null
    cardLast4: string | null
  } | null
  transactions: AccountInvoiceLine[]
}

export interface AccountBankTransactionLine {
  id: number
  occurredAt: string
  description: string
  amountMinor: number
  competencyMonth: string
  movementType: string
  movementSubtype: string | null
  categoryId: string | null
  categoryName: string | null
}

export interface AccountStatementDetails {
  accountId: number
  month: string
  account: {
    id: number
    displayName: string
    type: string
    institutionName: string | null
    cardBrand: string | null
    cardLast4: string | null
  }
  transactions: AccountBankTransactionLine[]
}

export interface StatementPreviewTransaction {
  id: string
  date: string
  description: string
  amountMinor: number
  competencyMonth: string
  movementType: string
  movementSubtype?: string | null
  providerTransactionId?: string | null
  categoryId?: string | null
  include: boolean
}

export interface StatementParseResult {
  fileName: string
  sourceAccount: {
    institutionName: string | null
    providerAccountId: string | null
    accountLast4: string | null
  }
  detectedAccount: {
    id: number
    displayName: string
  } | null
  transactions: StatementPreviewTransaction[]
}

export interface StatementImportBody {
  accountId?: number
  sourceAccount?: {
    institutionName?: string | null
    providerAccountId?: string | null
    accountLast4?: string | null
  }
  transactions: Array<{
    date: string
    description: string
    amountMinor: number
    competencyMonth?: string
    movementType?: string
    movementSubtype?: string | null
    providerTransactionId?: string | null
    categoryId?: string | null
    include?: boolean
  }>
}

export interface StatementImportResult {
  imported: number
  skippedDuplicates: number
  skippedInvalid: number
}

export interface StatementClassifyBody {
  transactions: Array<{
    id: string
    description: string
    amountMinor: number
    movementType: string
    categoryId?: string | null
  }>
  categories: Array<{
    id: string
    name: string
    slug?: string
    type: string
    parentId?: string | null
  }>
}

export interface StatementClassifyResponse {
  suggestions: Record<string, {
    categoryId: string
    subcategoryId: string | null
    source: 'history' | 'ai'
  }>
}

// --- Invoices ---

export interface InvoiceTransaction {
  id: string
  date: string
  description: string
  amountMinor: number
  installment?: string
  categoryId: string | null
  competencyMonth: string
  include: boolean
  category: string
  country?: string
}

export interface InvoiceParseResult {
  bank: string
  summary: {
    cardLast4: string
    product: string
    invoiceMonth: string
    dueDate: string
    dueMonth: string
    closingDate: string
    totalMinor: number
    previousBalanceMinor: number
    paymentsMinor: number
    nationalPurchasesMinor: number
    internationalPurchasesMinor: number
    chargesMinor: number
    openBalanceMinor: number
  }
  transactions: InvoiceTransaction[]
  forecasts: Array<{
    id: string
    competencyMonth: string
    amountMinor: number
    recurrence: 'one-time'
    description: string
  }>
}

export interface InvoiceImportBody {
  transactions: Array<{
    date: string
    description: string
    amountMinor: number
    categoryId?: string | null
    competencyMonth: string
    installment?: string
  }>
  invoiceMonth: string
  dueMonth?: string
  bank?: string
  cardLast4?: string
  product?: string
  sourceFileName?: string
  dueDate?: string
  closingDate?: string
  totalMinor?: number
  previousBalanceMinor?: number
  paymentsMinor?: number
  openBalanceMinor?: number
}

export interface InvoiceParseOptions {
  bank?: string
  password?: string
}

export interface InvoiceClassifyBody {
  transactions: Array<{
    id: string
    description: string
    amountMinor: number
    country?: string
    installment?: string
  }>
  categories: Array<{
    id: string
    name: string
    slug?: string
    type: string
    parentId?: string | null
  }>
}

export interface InvoiceClassifyResponse {
  suggestions: Record<string, {
    categoryId: string
    subcategoryId: string | null
  }>
  enabled: boolean
}

export interface AuthMeResponse {
  clerkUserId: string
  sessionId: string
  ownerId: number
  authorizedParty: string | null
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export const api = {
  auth: {
    me: () => request<AuthMeResponse>('/api/auth/me'),
  },

  cashflow: {
    project: (body: CashFlowRequest) =>
      request<CashFlowResponse>('/api/cashflow/projection', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    example: () =>
      request<unknown>('/api/cashflow/example'),

    listRecurringTransactions: () =>
      request<CashFlowRecurringListResponse>('/api/cashflow/recurring-transactions'),

    createRecurringTransaction: (body: CashFlowRecurringUpsertBody) =>
      request<CashFlowRecurringTransaction>('/api/cashflow/recurring-transactions', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    updateRecurringTransaction: (id: string, body: Partial<CashFlowRecurringUpsertBody>) =>
      request<{ ok: boolean }>(`/api/cashflow/recurring-transactions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),

    deleteRecurringTransaction: (id: string) =>
      request<{ ok?: boolean }>(`/api/cashflow/recurring-transactions/${id}`, {
        method: 'DELETE',
      }),

    setRecurringMonthStatus: (id: string, competencyMonth: string, isPaid: boolean) =>
      request<{ ok: boolean }>(`/api/cashflow/recurring-transactions/${id}/month-status`, {
        method: 'PUT',
        body: JSON.stringify({ competencyMonth, isPaid }),
      }),
  },

  budget: {
    analyzeTransaction: (body: TransactionAnalysisRequest) =>
      request<TransactionAnalysisResponse>('/api/budget/analyze-transaction', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    analysis: (body: BudgetAnalysisRequest) =>
      request<BudgetAnalysisResponse>('/api/budget/analysis', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },

  transactions: {
    parseStatement: (file: File): Promise<StatementParseResult> => {
      const form = new FormData()
      form.append('file', file)
      return requestRaw<StatementParseResult>('/api/transactions/statement/parse', {
        method: 'POST',
        body: form,
      })
    },
    classifyStatement: (body: StatementClassifyBody) =>
      request<StatementClassifyResponse>('/api/transactions/statement/classify', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    importStatement: (body: StatementImportBody) =>
      request<StatementImportResult>('/api/transactions/statement/import', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },

  categories: {
    list: () => request<Category[]>('/api/categories'),
    tree: () => request<Category[]>('/api/categories/tree'),
    create: (body: { name: string; type: 'expense' | 'income'; parentId?: string | null; sortOrder?: number }) =>
      request<Category>('/api/categories', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: { name?: string; type?: 'expense' | 'income'; parentId?: string | null; sortOrder?: number }) =>
      request<Category>(`/api/categories/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    remove: (id: string) =>
      request<{ deleted: boolean; id: string }>(`/api/categories/${id}`, { method: 'DELETE' }),
  },

  accounts: {
    list: () => request<{ items: AccountSummary[] }>('/api/accounts'),
    invoiceDetails: (accountId: number, month: string) =>
      request<AccountInvoiceDetails>(`/api/accounts/${accountId}/month/${month}/invoice`),
    statementDetails: (accountId: number, month: string) =>
      request<AccountStatementDetails>(`/api/accounts/${accountId}/month/${month}/statement`),
    updateCardTransactionCategory: (cardTransactionId: number, categoryId: string | null) =>
      request<AccountInvoiceLineCategoryUpdate>(`/api/accounts/card-transactions/${cardTransactionId}/category`, {
        method: 'PATCH',
        body: JSON.stringify({ categoryId }),
      }),
    updateBankTransactionCategory: (transactionId: number, categoryId: string | null) =>
      request<{ id: number; categoryId: string | null; categoryName: string | null }>(
        `/api/accounts/bank-transactions/${transactionId}/category`,
        { method: 'PATCH', body: JSON.stringify({ categoryId }) },
      ),
    deleteByMonth: (accountId: number, month: string) =>
      request<{
        accountId: number
        month: string
        deletedBankTransactions: number
        deletedCardInvoices: number
        deletedCardTransactions: number
        hasRemainingData: boolean
      }>(`/api/accounts/${accountId}/month/${month}`, { method: 'DELETE' }),
  },

  invoices: {
    /** Upload a PDF invoice and receive extracted transactions for preview. */
    parse: (file: File, options: InvoiceParseOptions = {}): Promise<InvoiceParseResult> => {
      const form = new FormData()
      form.append('file', file)
      if (options.bank) form.append('bank', options.bank)
      if (options.password) form.append('password', options.password)
      return requestRaw<InvoiceParseResult>('/api/invoices/parse', { method: 'POST', body: form })
    },

    classify: (body: InvoiceClassifyBody) =>
      request<InvoiceClassifyResponse>('/api/invoices/classify', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    /** Confirm and import the reviewed transactions. */
    import: (body: InvoiceImportBody) =>
      request<{ imported: number; skipped: number }>('/api/invoices/import', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Converte minor units (centavos) para string BRL formatada. */
export function formatBRL(minorOrStr: number | string | bigint): string {
  const value = Number(minorOrStr) / 100
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}

/** Gera array de meses YYYY-MM a partir de um mês inicial. */
export function buildMonthRange(startMonth: string, count: number): string[] {
  const months: string[] = []
  const [year, month] = startMonth.split('-').map(Number)
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(year, month - 1 + i, 1))
    months.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
    )
  }
  return months
}

/** Retorna o mês actual em formato YYYY-MM (UTC). */
export function currentMonth(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

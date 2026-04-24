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
    throw new ApiError(res.status, body?.error ?? res.statusText, body)
  }
  return res.json() as Promise<T>
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

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export const api = {
  cashflow: {
    project: (body: CashFlowRequest) =>
      request<CashFlowResponse>('/api/cashflow/projection', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    example: () =>
      request<unknown>('/api/cashflow/example'),
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

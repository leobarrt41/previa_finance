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
function getAuthToken() {
    // Clerk SDK expõe o token via window.__clerk_db_jwt ou via hook.
    // Em dev sem Clerk, retornamos null — a API não exige auth nas rotas actuais.
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const clerk = window.Clerk;
        if (clerk?.session) {
            return clerk.session.lastActiveToken?.getRawString?.() ?? null;
        }
    }
    catch {
        // Clerk não disponível
    }
    return null;
}
async function request(path, options = {}) {
    const token = getAuthToken();
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(path, { ...options, headers });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, getApiErrorMessage(body, res.statusText), body);
    }
    if (res.status === 204) {
        return undefined;
    }
    return res.json();
}
/** Like `request` but does NOT set Content-Type (lets browser set it for FormData). */
async function requestRaw(path, options = {}) {
    const token = getAuthToken();
    const headers = {
        ...options.headers,
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(path, { ...options, headers });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(res.status, getApiErrorMessage(body, res.statusText), body);
    }
    if (res.status === 204) {
        return undefined;
    }
    return res.json();
}
function getApiErrorMessage(body, fallback) {
    if (typeof body === 'string' && body.trim())
        return body;
    if (body && typeof body === 'object') {
        const asRecord = body;
        const nestedError = asRecord.error;
        if (typeof nestedError === 'string' && nestedError.trim())
            return nestedError;
        if (nestedError && typeof nestedError === 'object') {
            const nestedMessage = nestedError.message;
            if (typeof nestedMessage === 'string' && nestedMessage.trim())
                return nestedMessage;
        }
        const topLevelMessage = asRecord.message;
        if (typeof topLevelMessage === 'string' && topLevelMessage.trim())
            return topLevelMessage;
    }
    return fallback;
}
export class ApiError extends Error {
    constructor(status, message, body) {
        super(message);
        this.status = status;
        this.body = body;
        this.name = 'ApiError';
    }
}
// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------
export const api = {
    auth: {
        me: () => request('/api/auth/me'),
    },
    cashflow: {
        project: (body) => request('/api/cashflow/projection', {
            method: 'POST',
            body: JSON.stringify(body),
        }),
        example: () => request('/api/cashflow/example'),
        listRecurringTransactions: () => request('/api/cashflow/recurring-transactions'),
        createRecurringTransaction: (body) => request('/api/cashflow/recurring-transactions', {
            method: 'POST',
            body: JSON.stringify(body),
        }),
        updateRecurringTransaction: (id, body) => request(`/api/cashflow/recurring-transactions/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
        }),
        deleteRecurringTransaction: (id) => request(`/api/cashflow/recurring-transactions/${id}`, {
            method: 'DELETE',
        }),
        setRecurringMonthStatus: (id, competencyMonth, isPaid) => request(`/api/cashflow/recurring-transactions/${id}/month-status`, {
            method: 'PUT',
            body: JSON.stringify({ competencyMonth, isPaid }),
        }),
    },
    budget: {
        analyzeTransaction: (body) => request('/api/budget/analyze-transaction', {
            method: 'POST',
            body: JSON.stringify(body),
        }),
        analysis: (body) => request('/api/budget/analysis', {
            method: 'POST',
            body: JSON.stringify(body),
        }),
    },
    transactions: {
        parseStatement: (file) => {
            const form = new FormData();
            form.append('file', file);
            return requestRaw('/api/transactions/statement/parse', {
                method: 'POST',
                body: form,
            });
        },
        classifyStatement: (body) => request('/api/transactions/statement/classify', {
            method: 'POST',
            body: JSON.stringify(body),
        }),
        importStatement: (body) => request('/api/transactions/statement/import', {
            method: 'POST',
            body: JSON.stringify(body),
        }),
    },
    categories: {
        list: () => request('/api/categories'),
        tree: () => request('/api/categories/tree'),
        create: (body) => request('/api/categories', { method: 'POST', body: JSON.stringify(body) }),
        update: (id, body) => request(`/api/categories/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
        remove: (id) => request(`/api/categories/${id}`, { method: 'DELETE' }),
    },
    accounts: {
        list: () => request('/api/accounts'),
        invoiceDetails: (accountId, month) => request(`/api/accounts/${accountId}/month/${month}/invoice`),
        statementDetails: (accountId, month) => request(`/api/accounts/${accountId}/month/${month}/statement`),
        updateCardTransactionCategory: (cardTransactionId, categoryId) => request(`/api/accounts/card-transactions/${cardTransactionId}/category`, {
            method: 'PATCH',
            body: JSON.stringify({ categoryId }),
        }),
        updateBankTransactionCategory: (transactionId, categoryId) => request(`/api/accounts/bank-transactions/${transactionId}/category`, { method: 'PATCH', body: JSON.stringify({ categoryId }) }),
        deleteByMonth: (accountId, month) => request(`/api/accounts/${accountId}/month/${month}`, { method: 'DELETE' }),
    },
    assess: {
        budget: (body) => request('/api/assess/budget', {
            method: 'POST',
            body: JSON.stringify(body),
        }),
        spendingOverview: (month) => request('/api/assess/spending', {
            method: 'POST',
            body: JSON.stringify({ month, includeAi: false }),
        }),
        spendingPreview: (month, categoryId, subcategoryIds = []) => request('/api/assess/spending', {
            method: 'POST',
            body: JSON.stringify({ month, categoryId, subcategoryIds, includeAi: false }),
        }),
        spending: (month, categoryId, subcategoryIds = []) => request('/api/assess/spending', {
            method: 'POST',
            body: JSON.stringify({ month, categoryId, subcategoryIds, includeAi: true }),
        }),
        debt: (month, projectionMonths = 3) => request('/api/assess/debt', {
            method: 'POST',
            body: JSON.stringify({ month, projectionMonths }),
        }),
    },
    receiptDocuments: {
        scan: (file) => {
            const form = new FormData();
            form.append('file', file);
            return requestRaw('/api/receipt-documents/scan', {
                method: 'POST',
                body: form,
            });
        },
        list: (params) => {
            const qs = new URLSearchParams();
            if (params?.month)
                qs.set('month', params.month);
            if (params?.state)
                qs.set('state', params.state);
            if (params?.accountId)
                qs.set('accountId', String(params.accountId));
            return request(`/api/receipt-documents?${qs}`);
        },
        summary: (month) => request(`/api/receipt-documents/summary/${month}`),
        create: (body) => request('/api/receipt-documents', { method: 'POST', body: JSON.stringify(body) }),
        update: (id, body) => request(`/api/receipt-documents/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
        remove: (id) => request(`/api/receipt-documents/${id}`, { method: 'DELETE' }),
        reconcile: (id, body) => request(`/api/receipt-documents/${id}/reconcile`, { method: 'POST', body: JSON.stringify(body) }),
    },
    invoices: {
        /** Upload a PDF invoice and receive extracted transactions for preview. */
        parse: (file, options = {}) => {
            const form = new FormData();
            form.append('file', file);
            if (options.bank)
                form.append('bank', options.bank);
            if (options.password)
                form.append('password', options.password);
            return requestRaw('/api/invoices/parse', { method: 'POST', body: form });
        },
        classify: (body) => request('/api/invoices/classify', {
            method: 'POST',
            body: JSON.stringify(body),
        }),
        /** Confirm and import the reviewed transactions. */
        import: (body) => request('/api/invoices/import', {
            method: 'POST',
            body: JSON.stringify(body),
        }),
    },
    // ── Chat (Previa Bot) ──────────────────────────────────────────────────
    chat: {
        send: (body) => request('/api/chat', {
            method: 'POST',
            body: JSON.stringify(body),
        }),
    },
};
// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------
/** Converte minor units (centavos) para string BRL formatada. */
export function formatBRL(minorOrStr) {
    const value = Number(minorOrStr) / 100;
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
    }).format(value);
}
/** Gera array de meses YYYY-MM a partir de um mês inicial. */
export function buildMonthRange(startMonth, count) {
    const months = [];
    const [year, month] = startMonth.split('-').map(Number);
    for (let i = 0; i < count; i++) {
        const d = new Date(Date.UTC(year, month - 1 + i, 1));
        months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    return months;
}
/** Retorna o mês actual em formato YYYY-MM (UTC). */
export function currentMonth() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

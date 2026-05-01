import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * CashFlow.tsx — Tela de Projecção de CashFlow
 *
 * Contrato de API: POST /api/cashflow/projection
 * Payload e response mapeados directamente de apps/api/src/routes/cashflow.ts
 *
 * v2: adicionado suporte a Forecasts (recorrência: one-time | monthly | yearly)
 */
import { useState, useCallback, useEffect } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, } from 'recharts';
import { api, formatBRL, buildMonthRange, currentMonth, } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { Card, Badge, Button, Input, Alert, EmptyState, Spinner, SectionTitle, } from '../components/ui';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function minor(brl) {
    const n = parseFloat(brl.replace(',', '.'));
    return isNaN(n) ? 0 : Math.round(n * 100);
}
function sumPendingRecurringExpenseMinor(recurring, month) {
    return recurring.reduce((sum, forecast) => {
        if (forecast.amountMinor >= 0)
            return sum;
        if (!forecast.isActive)
            return sum;
        if (!appliesRecurringOnMonth(forecast, month))
            return sum;
        if (forecast.paidMonths.includes(month))
            return sum;
        return sum + Math.abs(forecast.amountMinor);
    }, 0);
}
function toChartData(monthly, recurring, cardTotalsByMonth = new Map()) {
    const activeMonth = currentMonth();
    return monthly.map((m) => {
        const pendingRecurringExpenseMinor = sumPendingRecurringExpenseMinor(recurring, m.competencyMonth);
        const statementOutflowMinor = Number(m.totalExpenseMinor) + Number(m.totalLiabilityPaymentMinor);
        const cardTotalMinor = cardTotalsByMonth.get(m.competencyMonth) ?? Number(m.debtOpenMinor);
        const orangeMinor = m.competencyMonth < activeMonth ? 0 : cardTotalMinor;
        return {
            month: m.competencyMonth,
            saldo: Number(m.projectedClosingBalanceMinor) / 100,
            recebido: Number(m.totalIncomeMinor) / 100,
            pago: statementOutflowMinor / 100,
            previsto: pendingRecurringExpenseMinor / 100,
            cartaoProjetado: orangeMinor / 100,
        };
    });
}
function statusVariant(value) {
    if (value > 0)
        return 'green';
    if (value < 0)
        return 'red';
    return 'yellow';
}
const recurrenceLabel = {
    'one-time': 'Única',
    'monthly': 'Mensal',
    'yearly': 'Anual',
};
function recurringTypeFromAmount(amountMinor) {
    return amountMinor >= 0 ? 'income' : 'expense';
}
function appliesRecurringOnMonth(fc, month) {
    if (month < fc.competencyMonth)
        return false;
    if (fc.recurrenceEnd && month > fc.recurrenceEnd)
        return false;
    const recurrence = fc.recurrence ?? 'one-time';
    if (recurrence === 'one-time')
        return month === fc.competencyMonth;
    if (recurrence === 'monthly')
        return true;
    if (recurrence === 'yearly')
        return month.slice(5) === fc.competencyMonth.slice(5);
    return false;
}
// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function TransactionRow({ tx, onRemove }) {
    const isIncome = tx.type === 'income';
    return (_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid #1e2130', fontSize: '0.85rem' }, children: [_jsxs("div", { children: [_jsx("span", { style: { color: '#e5e7eb' }, children: tx.description }), _jsx("span", { style: { color: '#4b5563', marginLeft: 8 }, children: tx.competencyMonth })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsxs("span", { style: { color: isIncome ? '#4ade80' : '#f87171', fontWeight: 600 }, children: [isIncome ? '+' : '-', " ", formatBRL(tx.amountMinor)] }), _jsx("button", { onClick: onRemove, style: { background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '1rem' }, children: "\u00D7" })] })] }));
}
function ForecastRow({ fc, onRemove, onEdit, }) {
    return (_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid #1e2130', fontSize: '0.85rem' }, children: [_jsxs("div", { children: [_jsx("span", { style: { color: '#e5e7eb' }, children: fc.description || '—' }), _jsx("span", { style: { color: '#4b5563', marginLeft: 8 }, children: fc.competencyMonth }), fc.recurrenceEnd && (_jsxs("span", { style: { color: '#4b5563', marginLeft: 4 }, children: ["\u2192 ", fc.recurrenceEnd] }))] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [!fc.isActive && _jsx(Badge, { variant: "yellow", children: "Inativa" }), _jsx(Badge, { variant: "blue", children: recurrenceLabel[fc.recurrence ?? 'one-time'] }), _jsx("span", { style: { color: fc.amountMinor >= 0 ? '#4ade80' : '#f87171', fontWeight: 600 }, children: formatBRL(fc.amountMinor) }), _jsx("button", { onClick: onEdit, style: { background: 'none', border: 'none', color: '#93c5fd', cursor: 'pointer', fontSize: '0.8rem' }, children: "editar" }), _jsx("button", { onClick: onRemove, style: { background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '1rem' }, children: "\u00D7" })] })] }));
}
// ---------------------------------------------------------------------------
// Collapsible section
// ---------------------------------------------------------------------------
function Section({ title, count, children }) {
    const [open, setOpen] = useState(true);
    return (_jsxs(Card, { children: [_jsxs("button", { onClick: () => setOpen((p) => !p), style: { background: 'none', border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left', padding: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, children: [_jsx(SectionTitle, { style: { margin: 0 }, children: title }), _jsxs("span", { style: { color: '#6b7280', fontSize: '0.8rem' }, children: [count > 0 && _jsx(Badge, { variant: "gray", children: count }), " ", open ? '▾' : '▸'] })] }), open && _jsx("div", { style: { marginTop: '0.75rem' }, children: children })] }));
}
// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export function CashFlow() {
    const now = currentMonth();
    // Base params
    const [startMonth, setStartMonth] = useState(now);
    const [months, setMonths] = useState('6');
    const [openingBalance, setOpeningBalance] = useState('');
    const [errors, setErrors] = useState({});
    // Transaction form
    const [txDesc, setTxDesc] = useState('');
    const [txAmount, setTxAmount] = useState('');
    const [txMonth, setTxMonth] = useState(now);
    const [txType, setTxType] = useState('income');
    const [transactions, setTransactions] = useState([]);
    // Forecast form
    const [fcDesc, setFcDesc] = useState('');
    const [fcType, setFcType] = useState('expense');
    const [fcAmount, setFcAmount] = useState('');
    const [fcMonth, setFcMonth] = useState(now);
    const [fcRecurrence, setFcRecurrence] = useState('monthly');
    const [fcEnd, setFcEnd] = useState('');
    const [fcEditId, setFcEditId] = useState(null);
    const [recurring, setRecurring] = useState([]);
    const [recurringLoading, setRecurringLoading] = useState(false);
    const [recurringError, setRecurringError] = useState(null);
    const [recurringSaving, setRecurringSaving] = useState(false);
    const projectFn = useCallback((body) => api.cashflow.project(body), []);
    const { state, execute } = useAsync(projectFn);
    const loadRecurring = useCallback(async () => {
        setRecurringLoading(true);
        setRecurringError(null);
        try {
            const res = await api.cashflow.listRecurringTransactions();
            setRecurring(res.items);
        }
        catch (err) {
            setRecurringError(err instanceof Error ? err.message : 'Falha ao carregar recorrentes');
        }
        finally {
            setRecurringLoading(false);
        }
    }, []);
    useEffect(() => {
        void loadRecurring();
    }, [loadRecurring]);
    const cardInvoicesByMonth = state.status === 'success' ? state.data.cardInvoicesByMonth ?? [] : [];
    const currentCardInvoiceRows = cardInvoicesByMonth.filter((f) => f.invoiceMonth === startMonth);
    const cardTotalsByMonth = cardInvoicesByMonth.reduce((acc, row) => {
        const current = acc.get(row.invoiceMonth) ?? 0;
        acc.set(row.invoiceMonth, current + Number(row.totalFaturaMinor || 0));
        return acc;
    }, new Map());
    // Validation
    function validate() {
        const e = {};
        if (!startMonth.match(/^\d{4}-\d{2}$/))
            e.startMonth = 'Formato YYYY-MM';
        const m = parseInt(months);
        if (isNaN(m) || m < 1 || m > 24)
            e.months = 'Entre 1 e 24 meses';
        if (openingBalance === '')
            e.openingBalance = 'Informe o saldo inicial';
        setErrors(e);
        return Object.keys(e).length === 0;
    }
    function addTransaction() {
        if (!txDesc.trim() || !txAmount)
            return;
        setTransactions((prev) => [
            ...prev,
            { id: `tx-${Date.now()}`, competencyMonth: txMonth, amountMinor: minor(txAmount), type: txType, description: txDesc },
        ]);
        setTxDesc('');
        setTxAmount('');
    }
    async function saveForecast() {
        if (!fcAmount)
            return;
        setRecurringSaving(true);
        const payload = {
            competencyMonth: fcMonth,
            amountMinor: fcType === 'expense' ? -Math.abs(minor(fcAmount)) : Math.abs(minor(fcAmount)),
            recurrence: fcRecurrence,
            recurrenceEnd: fcEnd || null,
            description: fcDesc || undefined,
            isActive: true,
        };
        try {
            if (fcEditId) {
                await api.cashflow.updateRecurringTransaction(fcEditId, payload);
            }
            else {
                await api.cashflow.createRecurringTransaction(payload);
            }
            await loadRecurring();
            setFcEditId(null);
        }
        catch (err) {
            setRecurringError(err instanceof Error ? err.message : 'Falha ao salvar recorrente');
        }
        finally {
            setRecurringSaving(false);
        }
        setFcDesc('');
        setFcAmount('');
        setFcEnd('');
    }
    async function removeForecast(id) {
        try {
            await api.cashflow.deleteRecurringTransaction(id);
            await loadRecurring();
            if (fcEditId === id) {
                setFcEditId(null);
            }
        }
        catch (err) {
            setRecurringError(err instanceof Error ? err.message : 'Falha ao remover recorrente');
        }
    }
    function startEditForecast(fc) {
        setFcEditId(fc.id);
        setFcDesc(fc.description ?? '');
        setFcMonth(fc.competencyMonth);
        setFcRecurrence(fc.recurrence ?? 'monthly');
        setFcEnd(fc.recurrenceEnd ?? '');
        setFcType(recurringTypeFromAmount(fc.amountMinor));
        setFcAmount((Math.abs(fc.amountMinor) / 100).toFixed(2));
    }
    function cancelEditForecast() {
        setFcEditId(null);
        setFcDesc('');
        setFcAmount('');
        setFcEnd('');
    }
    async function setForecastPaidMonth(forecastId, month, isPaid) {
        try {
            await api.cashflow.setRecurringMonthStatus(forecastId, month, isPaid);
            await loadRecurring();
            execute({
                startMonth,
                months: parseInt(months),
                openingBalanceMinor: minor(openingBalance),
                transactions,
            });
        }
        catch (err) {
            setRecurringError(err instanceof Error ? err.message : 'Falha ao atualizar status mensal');
        }
    }
    function handleSubmit(e) {
        e.preventDefault();
        if (!validate())
            return;
        void buildMonthRange(startMonth, parseInt(months));
        execute({
            startMonth,
            months: parseInt(months),
            openingBalanceMinor: minor(openingBalance),
            transactions,
        });
    }
    const chartData = state.status === 'success'
        ? toChartData(state.data.monthly, recurring, cardTotalsByMonth)
        : [];
    const recurringExpenseItems = recurring.filter((item) => item.amountMinor < 0);
    return (_jsxs("div", { style: { maxWidth: 1020 }, children: [_jsxs("div", { style: { marginBottom: '1.5rem' }, children: [_jsx("h1", { style: { fontSize: '1.4rem', fontWeight: 800, color: '#e5e7eb', margin: 0 }, children: "\uD83D\uDCC8 Projec\u00E7\u00E3o de CashFlow" }), _jsx("p", { style: { color: '#6b7280', marginTop: '0.3rem', fontSize: '0.85rem' }, children: "Visualize seu saldo m\u00EAs a m\u00EAs. Compra no cart\u00E3o \u00E9 d\u00EDvida \u2014 o pagamento da fatura afecta o caixa." })] }), state.status === 'success' && state.data.cardInvoicesByMonth && (_jsxs("div", { style: {
                    background: '#181c2a',
                    borderRadius: 8,
                    padding: '1rem',
                    marginBottom: '1.5rem',
                    border: '1px solid #23263a',
                }, children: [_jsxs("div", { style: { fontWeight: 700, color: '#e5e7eb', marginBottom: 8 }, children: ["Faturas do m\u00EAs atual (", startMonth, "):"] }), currentCardInvoiceRows.length === 0 ? (_jsx("div", { style: { color: '#6b7280', fontSize: '0.95rem' }, children: "Nenhuma fatura encontrada para o m\u00EAs." })) : (_jsxs("table", { style: { width: '100%', fontSize: '0.97rem', borderCollapse: 'collapse' }, children: [_jsx("thead", { children: _jsxs("tr", { style: { color: '#a5b4fc', textAlign: 'left' }, children: [_jsx("th", { style: { padding: '4px 8px' }, children: "Cart\u00E3o" }), _jsx("th", { style: { padding: '4px 8px' }, children: "Total da fatura anterior" }), _jsx("th", { style: { padding: '4px 8px' }, children: "Pago na fatura anterior" }), _jsx("th", { style: { padding: '4px 8px' }, children: "Compras do m\u00EAs" }), _jsx("th", { style: { padding: '4px 8px' }, children: "Total da fatura" })] }) }), _jsx("tbody", { children: currentCardInvoiceRows.map((f, i) => (_jsxs("tr", { style: { borderBottom: '1px solid #23263a' }, children: [_jsxs("td", { style: { padding: '4px 8px', color: '#e5e7eb' }, children: [(f.institutionName || 'Cartão desconhecido'), f.cardBrand ? ` / ${f.cardBrand}` : '', f.cardLast4 ? ` / ${f.cardLast4}` : ''] }), _jsx("td", { style: { padding: '4px 8px', color: '#fbbf24', fontWeight: 600 }, children: formatBRL(Number(f.totalFaturaAnteriorMinor ?? f.abertoAnteriorMinor)) }), _jsx("td", { style: { padding: '4px 8px', color: '#4ade80', fontWeight: 600 }, children: formatBRL(Number(f.paidAmountMinor)) }), _jsx("td", { style: { padding: '4px 8px', color: '#fbbf24', fontWeight: 600 }, children: formatBRL(Number(f.comprasDoMesMinor)) }), _jsx("td", { style: { padding: '4px 8px', color: '#fbbf24', fontWeight: 700 }, children: formatBRL(Number(f.totalFaturaMinor)) })] }, i))) })] }))] })), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1.5rem', alignItems: 'start' }, children: [_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '1rem' }, children: [_jsxs(Card, { children: [_jsx(SectionTitle, { children: "Par\u00E2metros" }), _jsxs("form", { onSubmit: handleSubmit, style: { display: 'flex', flexDirection: 'column', gap: '0.75rem' }, children: [_jsx(Input, { label: "M\u00EAs inicial (YYYY-MM)", value: startMonth, onChange: (e) => setStartMonth(e.target.value), placeholder: "2026-05", error: errors.startMonth }), _jsx(Input, { label: "Meses a projectar", type: "number", min: 1, max: 24, value: months, onChange: (e) => setMonths(e.target.value), error: errors.months }), _jsx(Input, { label: "Saldo inicial (R$)", type: "number", step: "0.01", value: openingBalance, onChange: (e) => setOpeningBalance(e.target.value), placeholder: "1000.00", error: errors.openingBalance }), _jsx(Button, { type: "submit", fullWidth: true, disabled: state.status === 'loading', children: state.status === 'loading' ? 'Calculando...' : 'Calcular projecção' })] })] }), _jsxs(Section, { title: "Transac\u00E7\u00F5es", count: transactions.length, children: [_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '0.75rem' }, children: [_jsxs("div", { style: { display: 'flex', gap: '0.5rem' }, children: [_jsxs("select", { value: txType, onChange: (e) => setTxType(e.target.value), style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem' }, children: [_jsx("option", { value: "income", children: "Receita" }), _jsx("option", { value: "expense", children: "Despesa" })] }), _jsx("input", { value: txMonth, onChange: (e) => setTxMonth(e.target.value), placeholder: "YYYY-MM", style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', width: 90 } })] }), _jsx("input", { value: txDesc, onChange: (e) => setTxDesc(e.target.value), placeholder: "Descri\u00E7\u00E3o (ex: Sal\u00E1rio)", style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' } }), _jsxs("div", { style: { display: 'flex', gap: '0.5rem' }, children: [_jsx("input", { value: txAmount, onChange: (e) => setTxAmount(e.target.value), type: "number", step: "0.01", placeholder: "Valor (R$)", style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', flex: 1 } }), _jsx(Button, { onClick: addTransaction, variant: "secondary", children: "+ Add" })] })] }), transactions.length === 0
                                        ? _jsx(EmptyState, { icon: "\uD83D\uDCB8", title: "Nenhuma transac\u00E7\u00E3o", description: "Adicione receitas e despesas acima." })
                                        : transactions.map((tx, i) => _jsx(TransactionRow, { tx: tx, onRemove: () => setTransactions((p) => p.filter((_, j) => j !== i)) }, tx.id))] }), _jsxs(Section, { title: "Previs\u00F5es recorrentes", count: recurring.length, children: [_jsx("div", { style: {
                                            padding: '0.6rem 0.75rem',
                                            background: '#1a2a3a',
                                            borderLeft: '3px solid #6366f1',
                                            borderRadius: '0 8px 8px 0',
                                            fontSize: '0.78rem',
                                            color: '#93c5fd',
                                            marginBottom: '0.75rem',
                                        }, children: "Previs\u00F5es s\u00E3o projec\u00E7\u00F5es futuras (ex: sal\u00E1rio mensal, IPTU anual). Podem ser substitu\u00EDdas por dados reais quando confirmados." }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '0.75rem' }, children: [_jsx("input", { value: fcDesc, onChange: (e) => setFcDesc(e.target.value), placeholder: "Descri\u00E7\u00E3o (ex: Sal\u00E1rio mensal)", style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' } }), _jsxs("div", { style: { display: 'flex', gap: '0.5rem' }, children: [_jsx("input", { value: fcMonth, onChange: (e) => setFcMonth(e.target.value), placeholder: "M\u00EAs in\u00EDcio", style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', flex: 1 } }), _jsxs("select", { value: fcRecurrence, onChange: (e) => setFcRecurrence(e.target.value), style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem' }, children: [_jsx("option", { value: "one-time", children: "\u00DAnica" }), _jsx("option", { value: "monthly", children: "Mensal" }), _jsx("option", { value: "yearly", children: "Anual" })] })] }), fcRecurrence !== 'one-time' && (_jsx("input", { value: fcEnd, onChange: (e) => setFcEnd(e.target.value), placeholder: "M\u00EAs fim (opcional, YYYY-MM)", style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' } })), _jsxs("div", { style: { display: 'flex', gap: '0.5rem' }, children: [_jsxs("select", { value: fcType, onChange: (e) => setFcType(e.target.value), style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem' }, children: [_jsx("option", { value: "income", children: "Receita" }), _jsx("option", { value: "expense", children: "Despesa" })] }), _jsx("input", { value: fcAmount, onChange: (e) => setFcAmount(e.target.value), type: "number", step: "0.01", placeholder: "Valor (R$)", style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', flex: 1 } }), _jsx(Button, { onClick: () => { void saveForecast(); }, variant: "secondary", disabled: recurringSaving, children: recurringSaving ? 'Salvando...' : fcEditId ? 'Salvar' : '+ Add' })] }), fcEditId && (_jsx("div", { style: { display: 'flex', gap: '0.5rem' }, children: _jsx(Button, { onClick: cancelEditForecast, variant: "secondary", children: "Cancelar edi\u00E7\u00E3o" }) }))] }), recurringError && _jsx(Alert, { variant: "error", children: recurringError }), recurringLoading && _jsx(Spinner, { size: 20 }), recurring.length === 0
                                        ? _jsx(EmptyState, { icon: "\uD83D\uDD2E", title: "Nenhuma previs\u00E3o", description: "Adicione receitas ou despesas recorrentes futuras." })
                                        : recurring.map((fc) => (_jsx(ForecastRow, { fc: fc, onEdit: () => startEditForecast(fc), onRemove: () => { void removeForecast(fc.id); } }, fc.id)))] })] }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '1rem' }, children: [state.status === 'idle' && (_jsx(EmptyState, { icon: "\uD83D\uDCCA", title: "Preencha os par\u00E2metros e calcule", description: "O resultado aparecer\u00E1 aqui com gr\u00E1fico e tabela mensal." })), state.status === 'loading' && (_jsx("div", { style: { display: 'flex', justifyContent: 'center', padding: '3rem' }, children: _jsx(Spinner, { size: 40 }) })), state.status === 'error' && (_jsxs(Alert, { variant: "error", children: [_jsx("strong", { children: "Erro:" }), " ", state.message] })), state.status === 'success' && (_jsxs(_Fragment, { children: [_jsx("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }, children: [
                                            { label: 'Saldo final', value: Number(state.data.monthly[state.data.monthly.length - 1]?.projectedClosingBalanceMinor ?? 0), color: Number(state.data.monthly[state.data.monthly.length - 1]?.projectedClosingBalanceMinor ?? 0) >= 0 ? '#4ade80' : '#f87171' },
                                            { label: 'Total receitas', value: state.data.monthly.reduce((s, m) => s + Number(m.totalIncomeMinor), 0), color: '#4ade80' },
                                            { label: 'Total despesas', value: Math.abs(state.data.monthly.reduce((s, m) => s + Number(m.totalExpenseMinor) + Number(m.totalLiabilityPaymentMinor), 0)), color: '#f87171' },
                                        ].map(({ label, value, color }) => (_jsxs("div", { style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 10, padding: '0.75rem', textAlign: 'center' }, children: [_jsx("p", { style: { fontSize: '0.72rem', color: '#6b7280', marginBottom: 4 }, children: label }), _jsx("p", { style: { fontSize: '1rem', fontWeight: 800, color }, children: formatBRL(value) })] }, label))) }), _jsxs(Card, { children: [_jsx(SectionTitle, { children: "Recebido vs Sa\u00EDdas" }), _jsx(ResponsiveContainer, { width: "100%", height: 220, children: _jsxs(ComposedChart, { data: chartData, margin: { top: 4, right: 8, left: 0, bottom: 0 }, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "#1e2130" }), _jsx(XAxis, { dataKey: "month", tick: { fill: '#6b7280', fontSize: 11 } }), _jsx(YAxis, { tick: { fill: '#6b7280', fontSize: 11 }, tickFormatter: (v) => `R$${(v / 1000).toFixed(0)}k` }), _jsx(Tooltip, { contentStyle: { background: '#1e2130', border: '1px solid #2a2f45', borderRadius: 8 }, labelStyle: { color: '#9ca3af' }, formatter: (v, name) => {
                                                                const labels = {
                                                                    recebido: 'Recebido',
                                                                    pago: 'Saídas do extrato',
                                                                    previsto: 'Débitos recorrentes',
                                                                    cartaoProjetado: 'Faturas do cartão',
                                                                    saldo: 'Saldo final',
                                                                };
                                                                return [formatBRL(Number(v ?? 0) * 100), labels[String(name)] ?? String(name)];
                                                            } }), _jsx(ReferenceLine, { y: 0, stroke: "#f87171", strokeDasharray: "4 2" }), _jsx(Bar, { dataKey: "pago", name: "pago", stackId: "despesas", fill: "#7dd3fc", radius: [4, 4, 0, 0] }), _jsx(Bar, { dataKey: "previsto", name: "previsto", stackId: "despesas", fill: "#ef4444", radius: [4, 4, 0, 0] }), _jsx(Bar, { dataKey: "cartaoProjetado", name: "cartaoProjetado", stackId: "despesas", fill: "#fb923c", radius: [4, 4, 0, 0] }), _jsx(Line, { type: "monotone", dataKey: "recebido", name: "recebido", stroke: "#1d4ed8", strokeWidth: 3, dot: { r: 3 }, activeDot: { r: 5 } })] }) })] }), _jsxs(Card, { children: [_jsx(SectionTitle, { children: "D\u00E9bitos recorrentes por m\u00EAs (marque pago/n\u00E3o cobrado)" }), _jsx("div", { style: { overflowX: 'auto' }, children: _jsxs("table", { style: { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }, children: [_jsx("thead", { children: _jsxs("tr", { style: { color: '#6b7280', borderBottom: '1px solid #2a2f45' }, children: [_jsx("th", { style: { textAlign: 'left', padding: '0.4rem 0.5rem' }, children: "M\u00EAs" }), _jsx("th", { style: { textAlign: 'left', padding: '0.4rem 0.5rem' }, children: "D\u00E9bito recorrente" }), _jsx("th", { style: { textAlign: 'right', padding: '0.4rem 0.5rem' }, children: "Valor" }), _jsx("th", { style: { textAlign: 'center', padding: '0.4rem 0.5rem' }, children: "Pago/N\u00E3o cobrado" })] }) }), _jsx("tbody", { children: state.data.monthly.flatMap((m) => {
                                                                const activeRows = recurringExpenseItems.filter((fc) => appliesRecurringOnMonth(fc, m.competencyMonth));
                                                                if (activeRows.length === 0) {
                                                                    return [
                                                                        _jsxs("tr", { style: { borderBottom: '1px solid #1e2130' }, children: [_jsx("td", { style: { padding: '0.45rem 0.5rem', color: '#e5e7eb', fontWeight: 600 }, children: m.competencyMonth }), _jsx("td", { colSpan: 3, style: { padding: '0.45rem 0.5rem', color: '#6b7280' }, children: "Sem d\u00E9bitos recorrentes" })] }, `${m.competencyMonth}-empty`),
                                                                    ];
                                                                }
                                                                return activeRows.map((fc, idx) => {
                                                                    const isPaid = fc.paidMonths.includes(m.competencyMonth);
                                                                    return (_jsxs("tr", { style: { borderBottom: '1px solid #1e2130' }, children: [_jsx("td", { style: { padding: '0.45rem 0.5rem', color: '#e5e7eb', fontWeight: idx === 0 ? 600 : 400 }, children: idx === 0 ? m.competencyMonth : '' }), _jsxs("td", { style: { padding: '0.45rem 0.5rem', color: '#e5e7eb' }, children: [fc.description || 'Sem descrição', _jsxs("span", { style: { color: '#6b7280', marginLeft: 6 }, children: ["(", recurrenceLabel[fc.recurrence ?? 'one-time'], ")"] })] }), _jsx("td", { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: '#f87171' }, children: formatBRL(fc.amountMinor) }), _jsx("td", { style: { padding: '0.45rem 0.5rem', textAlign: 'center' }, children: _jsx("input", { type: "checkbox", checked: isPaid, onChange: (e) => {
                                                                                        void setForecastPaidMonth(fc.id, m.competencyMonth, e.target.checked);
                                                                                    } }) })] }, `${m.competencyMonth}-${fc.id}`));
                                                                });
                                                            }) })] }) })] })] }))] })] })] }));
}

import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * CashFlow.tsx — Tela de Projecção de CashFlow
 *
 * Contrato de API: POST /api/cashflow/projection
 * Payload e response mapeados directamente de apps/api/src/routes/cashflow.ts
 *
 * v2: adicionado suporte a Forecasts (recorrência: one-time | monthly | yearly)
 */
import { useState, useCallback } from 'react';
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
function toChartData(monthly, startMonth) {
    return monthly.map((m) => ({
        month: m.competencyMonth,
        saldo: Number(m.projectedClosingBalanceMinor) / 100,
        receita: Number(m.totalIncomeMinor) / 100,
        despesaPaga: m.competencyMonth <= startMonth
            ? Math.abs(Number(m.totalExpenseMinor) + Number(m.totalLiabilityPaymentMinor)) / 100
            : 0,
        despesaPrevista: m.competencyMonth > startMonth
            ? Math.abs(Number(m.totalExpenseMinor) + Number(m.totalLiabilityPaymentMinor)) / 100
            : 0,
        cartaoProjetado: m.competencyMonth > startMonth
            ? Number(m.debtOpenMinor) / 100
            : 0,
    }));
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
// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function TransactionRow({ tx, onRemove }) {
    const isIncome = tx.type === 'income';
    return (_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid #1e2130', fontSize: '0.85rem' }, children: [_jsxs("div", { children: [_jsx("span", { style: { color: '#e5e7eb' }, children: tx.description }), _jsx("span", { style: { color: '#4b5563', marginLeft: 8 }, children: tx.competencyMonth })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsxs("span", { style: { color: isIncome ? '#4ade80' : '#f87171', fontWeight: 600 }, children: [isIncome ? '+' : '-', " ", formatBRL(tx.amountMinor)] }), _jsx("button", { onClick: onRemove, style: { background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '1rem' }, children: "\u00D7" })] })] }));
}
function InvoiceRow({ inv, onRemove }) {
    return (_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid #1e2130', fontSize: '0.85rem' }, children: [_jsxs("div", { children: [_jsxs("span", { style: { color: '#e5e7eb' }, children: ["Fatura ", inv.competencyMonth] }), _jsxs("span", { style: { color: '#4b5563', marginLeft: 8 }, children: ["\u2192 vence ", inv.dueMonth] })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsx("span", { style: { color: '#fbbf24', fontWeight: 600 }, children: formatBRL(inv.amountMinor) }), _jsx("button", { onClick: onRemove, style: { background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '1rem' }, children: "\u00D7" })] })] }));
}
function ForecastRow({ fc, onRemove }) {
    return (_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid #1e2130', fontSize: '0.85rem' }, children: [_jsxs("div", { children: [_jsx("span", { style: { color: '#e5e7eb' }, children: fc.description || '—' }), _jsx("span", { style: { color: '#4b5563', marginLeft: 8 }, children: fc.competencyMonth }), fc.recurrenceEnd && (_jsxs("span", { style: { color: '#4b5563', marginLeft: 4 }, children: ["\u2192 ", fc.recurrenceEnd] }))] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsx(Badge, { variant: "blue", children: recurrenceLabel[fc.recurrence ?? 'one-time'] }), _jsx("span", { style: { color: fc.amountMinor >= 0 ? '#4ade80' : '#f87171', fontWeight: 600 }, children: formatBRL(fc.amountMinor) }), _jsx("button", { onClick: onRemove, style: { background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '1rem' }, children: "\u00D7" })] })] }));
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
    // Invoice form
    const [invMonth, setInvMonth] = useState(now);
    const [invDue, setInvDue] = useState('');
    const [invAmount, setInvAmount] = useState('');
    const [invoices, setInvoices] = useState([]);
    // Forecast form
    const [fcDesc, setFcDesc] = useState('');
    const [fcType, setFcType] = useState('expense');
    const [fcAmount, setFcAmount] = useState('');
    const [fcMonth, setFcMonth] = useState(now);
    const [fcRecurrence, setFcRecurrence] = useState('monthly');
    const [fcEnd, setFcEnd] = useState('');
    const [forecasts, setForecasts] = useState([]);
    const projectFn = useCallback((body) => api.cashflow.project(body), []);
    const { state, execute } = useAsync(projectFn);
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
    function addInvoice() {
        if (!invAmount || !invDue)
            return;
        setInvoices((prev) => [
            ...prev,
            { id: `inv-${Date.now()}`, competencyMonth: invMonth, dueMonth: invDue, amountMinor: minor(invAmount), paidMinor: 0 },
        ]);
        setInvAmount('');
        setInvDue('');
    }
    function addForecast() {
        if (!fcAmount)
            return;
        setForecasts((prev) => [
            ...prev,
            {
                id: `fc-${Date.now()}`,
                competencyMonth: fcMonth,
                amountMinor: fcType === 'expense' ? -Math.abs(minor(fcAmount)) : Math.abs(minor(fcAmount)),
                recurrence: fcRecurrence,
                recurrenceEnd: fcEnd || undefined,
                description: fcDesc || undefined,
                isActive: true,
            },
        ]);
        setFcDesc('');
        setFcAmount('');
        setFcEnd('');
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
            cardInvoices: invoices,
            forecasts,
        });
    }
    const chartData = state.status === 'success' ? toChartData(state.data.monthly, startMonth) : [];
    return (_jsxs("div", { style: { maxWidth: 1020 }, children: [_jsxs("div", { style: { marginBottom: '1.5rem' }, children: [_jsx("h1", { style: { fontSize: '1.4rem', fontWeight: 800, color: '#e5e7eb', margin: 0 }, children: "\uD83D\uDCC8 Projec\u00E7\u00E3o de CashFlow" }), _jsx("p", { style: { color: '#6b7280', marginTop: '0.3rem', fontSize: '0.85rem' }, children: "Visualize seu saldo m\u00EAs a m\u00EAs. Compra no cart\u00E3o \u00E9 d\u00EDvida \u2014 o pagamento da fatura afecta o caixa." })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1.5rem', alignItems: 'start' }, children: [_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '1rem' }, children: [_jsxs(Card, { children: [_jsx(SectionTitle, { children: "Par\u00E2metros" }), _jsxs("form", { onSubmit: handleSubmit, style: { display: 'flex', flexDirection: 'column', gap: '0.75rem' }, children: [_jsx(Input, { label: "M\u00EAs inicial (YYYY-MM)", value: startMonth, onChange: (e) => setStartMonth(e.target.value), placeholder: "2026-05", error: errors.startMonth }), _jsx(Input, { label: "Meses a projectar", type: "number", min: 1, max: 24, value: months, onChange: (e) => setMonths(e.target.value), error: errors.months }), _jsx(Input, { label: "Saldo inicial (R$)", type: "number", step: "0.01", value: openingBalance, onChange: (e) => setOpeningBalance(e.target.value), placeholder: "1000.00", error: errors.openingBalance }), _jsx(Button, { type: "submit", fullWidth: true, disabled: state.status === 'loading', children: state.status === 'loading' ? 'Calculando...' : 'Calcular projecção' })] })] }), _jsxs(Section, { title: "Transac\u00E7\u00F5es", count: transactions.length, children: [_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '0.75rem' }, children: [_jsxs("div", { style: { display: 'flex', gap: '0.5rem' }, children: [_jsxs("select", { value: txType, onChange: (e) => setTxType(e.target.value), style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem' }, children: [_jsx("option", { value: "income", children: "Receita" }), _jsx("option", { value: "expense", children: "Despesa" })] }), _jsx("input", { value: txMonth, onChange: (e) => setTxMonth(e.target.value), placeholder: "YYYY-MM", style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', width: 90 } })] }), _jsx("input", { value: txDesc, onChange: (e) => setTxDesc(e.target.value), placeholder: "Descri\u00E7\u00E3o (ex: Sal\u00E1rio)", style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' } }), _jsxs("div", { style: { display: 'flex', gap: '0.5rem' }, children: [_jsx("input", { value: txAmount, onChange: (e) => setTxAmount(e.target.value), type: "number", step: "0.01", placeholder: "Valor (R$)", style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', flex: 1 } }), _jsx(Button, { onClick: addTransaction, variant: "secondary", children: "+ Add" })] })] }), transactions.length === 0
                                        ? _jsx(EmptyState, { icon: "\uD83D\uDCB8", title: "Nenhuma transac\u00E7\u00E3o", description: "Adicione receitas e despesas acima." })
                                        : transactions.map((tx, i) => _jsx(TransactionRow, { tx: tx, onRemove: () => setTransactions((p) => p.filter((_, j) => j !== i)) }, tx.id))] }), _jsxs(Section, { title: "Faturas de cart\u00E3o", count: invoices.length, children: [_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '0.75rem' }, children: [_jsxs("div", { style: { display: 'flex', gap: '0.5rem' }, children: [_jsx("input", { value: invMonth, onChange: (e) => setInvMonth(e.target.value), placeholder: "M\u00EAs compra", style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', flex: 1 } }), _jsx("input", { value: invDue, onChange: (e) => setInvDue(e.target.value), placeholder: "M\u00EAs vencimento", style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', flex: 1 } })] }), _jsxs("div", { style: { display: 'flex', gap: '0.5rem' }, children: [_jsx("input", { value: invAmount, onChange: (e) => setInvAmount(e.target.value), type: "number", step: "0.01", placeholder: "Total fatura (R$)", style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', flex: 1 } }), _jsx(Button, { onClick: addInvoice, variant: "secondary", children: "+ Add" })] })] }), invoices.length === 0
                                        ? _jsx(EmptyState, { icon: "\uD83D\uDCB3", title: "Nenhuma fatura", description: "Adicione faturas de cart\u00E3o acima." })
                                        : invoices.map((inv, i) => _jsx(InvoiceRow, { inv: inv, onRemove: () => setInvoices((p) => p.filter((_, j) => j !== i)) }, inv.id))] }), _jsxs(Section, { title: "Previs\u00F5es recorrentes", count: forecasts.length, children: [_jsx("div", { style: {
                                            padding: '0.6rem 0.75rem',
                                            background: '#1a2a3a',
                                            borderLeft: '3px solid #6366f1',
                                            borderRadius: '0 8px 8px 0',
                                            fontSize: '0.78rem',
                                            color: '#93c5fd',
                                            marginBottom: '0.75rem',
                                        }, children: "Previs\u00F5es s\u00E3o projec\u00E7\u00F5es futuras (ex: sal\u00E1rio mensal, IPTU anual). Podem ser substitu\u00EDdas por dados reais quando confirmados." }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '0.75rem' }, children: [_jsx("input", { value: fcDesc, onChange: (e) => setFcDesc(e.target.value), placeholder: "Descri\u00E7\u00E3o (ex: Sal\u00E1rio mensal)", style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' } }), _jsxs("div", { style: { display: 'flex', gap: '0.5rem' }, children: [_jsx("input", { value: fcMonth, onChange: (e) => setFcMonth(e.target.value), placeholder: "M\u00EAs in\u00EDcio", style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', flex: 1 } }), _jsxs("select", { value: fcRecurrence, onChange: (e) => setFcRecurrence(e.target.value), style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem' }, children: [_jsx("option", { value: "one-time", children: "\u00DAnica" }), _jsx("option", { value: "monthly", children: "Mensal" }), _jsx("option", { value: "yearly", children: "Anual" })] })] }), fcRecurrence !== 'one-time' && (_jsx("input", { value: fcEnd, onChange: (e) => setFcEnd(e.target.value), placeholder: "M\u00EAs fim (opcional, YYYY-MM)", style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' } })), _jsxs("div", { style: { display: 'flex', gap: '0.5rem' }, children: [_jsxs("select", { value: fcType, onChange: (e) => setFcType(e.target.value), style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem' }, children: [_jsx("option", { value: "income", children: "Receita" }), _jsx("option", { value: "expense", children: "Despesa" })] }), _jsx("input", { value: fcAmount, onChange: (e) => setFcAmount(e.target.value), type: "number", step: "0.01", placeholder: "Valor (R$)", style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', flex: 1 } }), _jsx(Button, { onClick: addForecast, variant: "secondary", children: "+ Add" })] })] }), forecasts.length === 0
                                        ? _jsx(EmptyState, { icon: "\uD83D\uDD2E", title: "Nenhuma previs\u00E3o", description: "Adicione receitas ou despesas recorrentes futuras." })
                                        : forecasts.map((fc, i) => _jsx(ForecastRow, { fc: fc, onRemove: () => setForecasts((p) => p.filter((_, j) => j !== i)) }, fc.id))] })] }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '1rem' }, children: [state.status === 'idle' && (_jsx(EmptyState, { icon: "\uD83D\uDCCA", title: "Preencha os par\u00E2metros e calcule", description: "O resultado aparecer\u00E1 aqui com gr\u00E1fico e tabela mensal." })), state.status === 'loading' && (_jsx("div", { style: { display: 'flex', justifyContent: 'center', padding: '3rem' }, children: _jsx(Spinner, { size: 40 }) })), state.status === 'error' && (_jsxs(Alert, { variant: "error", children: [_jsx("strong", { children: "Erro:" }), " ", state.message] })), state.status === 'success' && (_jsxs(_Fragment, { children: [_jsx("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }, children: [
                                            { label: 'Saldo final', value: Number(state.data.monthly[state.data.monthly.length - 1]?.projectedClosingBalanceMinor ?? 0), color: Number(state.data.monthly[state.data.monthly.length - 1]?.projectedClosingBalanceMinor ?? 0) >= 0 ? '#4ade80' : '#f87171' },
                                            { label: 'Total receitas', value: state.data.monthly.reduce((s, m) => s + Number(m.totalIncomeMinor), 0), color: '#4ade80' },
                                            { label: 'Total despesas', value: Math.abs(state.data.monthly.reduce((s, m) => s + Number(m.totalExpenseMinor) + Number(m.totalLiabilityPaymentMinor), 0)), color: '#f87171' },
                                        ].map(({ label, value, color }) => (_jsxs("div", { style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 10, padding: '0.75rem', textAlign: 'center' }, children: [_jsx("p", { style: { fontSize: '0.72rem', color: '#6b7280', marginBottom: 4 }, children: label }), _jsx("p", { style: { fontSize: '1rem', fontWeight: 800, color }, children: formatBRL(value) })] }, label))) }), _jsxs(Card, { children: [_jsx(SectionTitle, { children: "Receita vs Despesas" }), _jsx(ResponsiveContainer, { width: "100%", height: 220, children: _jsxs(ComposedChart, { data: chartData, margin: { top: 4, right: 8, left: 0, bottom: 0 }, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "#1e2130" }), _jsx(XAxis, { dataKey: "month", tick: { fill: '#6b7280', fontSize: 11 } }), _jsx(YAxis, { tick: { fill: '#6b7280', fontSize: 11 }, tickFormatter: (v) => `R$${(v / 1000).toFixed(0)}k` }), _jsx(Tooltip, { contentStyle: { background: '#1e2130', border: '1px solid #2a2f45', borderRadius: 8 }, labelStyle: { color: '#9ca3af' }, formatter: (v, name) => {
                                                                const labels = {
                                                                    receita: 'Receita (linha de vida)',
                                                                    despesaPaga: 'Despesa paga',
                                                                    despesaPrevista: 'Despesa prevista',
                                                                    cartaoProjetado: 'Cartão projetado',
                                                                };
                                                                return [formatBRL(Number(v ?? 0) * 100), labels[String(name)] ?? String(name)];
                                                            } }), _jsx(ReferenceLine, { y: 0, stroke: "#f87171", strokeDasharray: "4 2" }), _jsx(Bar, { dataKey: "despesaPaga", name: "despesaPaga", fill: "#7dd3fc", radius: [4, 4, 0, 0] }), _jsx(Bar, { dataKey: "despesaPrevista", name: "despesaPrevista", stackId: "proj", fill: "#ef4444", radius: [4, 4, 0, 0] }), _jsx(Bar, { dataKey: "cartaoProjetado", name: "cartaoProjetado", stackId: "proj", fill: "#fb923c", radius: [4, 4, 0, 0] }), _jsx(Line, { type: "monotone", dataKey: "receita", name: "receita", stroke: "#1d4ed8", strokeWidth: 3, dot: { r: 3 }, activeDot: { r: 5 } })] }) })] }), _jsxs(Card, { children: [_jsx(SectionTitle, { children: "Detalhe mensal" }), _jsx("div", { style: { overflowX: 'auto' }, children: _jsxs("table", { style: { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }, children: [_jsx("thead", { children: _jsxs("tr", { style: { color: '#6b7280', borderBottom: '1px solid #2a2f45' }, children: [_jsx("th", { style: { textAlign: 'left', padding: '0.4rem 0.5rem' }, children: "M\u00EAs" }), _jsx("th", { style: { textAlign: 'right', padding: '0.4rem 0.5rem' }, children: "Receita" }), _jsx("th", { style: { textAlign: 'right', padding: '0.4rem 0.5rem' }, children: "Despesa" }), _jsx("th", { style: { textAlign: 'right', padding: '0.4rem 0.5rem' }, children: "Saldo final" }), _jsx("th", { style: { textAlign: 'center', padding: '0.4rem 0.5rem' }, children: "Estado" })] }) }), _jsx("tbody", { children: state.data.monthly.map((m) => {
                                                                const closing = Number(m.projectedClosingBalanceMinor);
                                                                const paidExpenseMinor = Math.abs(Number(m.totalExpenseMinor) + Number(m.totalLiabilityPaymentMinor));
                                                                return (_jsxs("tr", { style: { borderBottom: '1px solid #1e2130' }, children: [_jsx("td", { style: { padding: '0.45rem 0.5rem', color: '#e5e7eb', fontWeight: 600 }, children: m.competencyMonth }), _jsx("td", { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: '#4ade80' }, children: formatBRL(m.totalIncomeMinor) }), _jsx("td", { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: '#f87171' }, children: formatBRL(paidExpenseMinor) }), _jsx("td", { style: { padding: '0.45rem 0.5rem', textAlign: 'right', fontWeight: 700, color: closing >= 0 ? '#4ade80' : '#f87171' }, children: formatBRL(m.projectedClosingBalanceMinor) }), _jsx("td", { style: { padding: '0.45rem 0.5rem', textAlign: 'center' }, children: _jsx(Badge, { variant: statusVariant(closing), children: closing > 0 ? 'Positivo' : closing < 0 ? 'Negativo' : 'Zero' }) })] }, m.competencyMonth));
                                                            }) })] }) })] })] }))] })] })] }));
}

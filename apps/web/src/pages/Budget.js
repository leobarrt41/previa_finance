import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Budget.tsx — Tela de Análise de Orçamento
 *
 * Contratos de API:
 *   POST /api/budget/analyze-transaction  — impacto de uma transacção
 *   POST /api/budget/analysis             — visão geral do orçamento
 *   GET  /api/categories                  — lista de categorias
 *
 * Todos os contratos mapeados directamente de apps/api/src/routes/budget.ts
 * e apps/api/src/routes/categories.ts.
 */
import { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, } from 'recharts';
import { api, formatBRL, currentMonth, } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { Card, Badge, Button, Input, Select, Alert, EmptyState, Spinner, SectionTitle, } from '../components/ui';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function minor(brl) {
    const n = parseFloat(brl.replace(',', '.'));
    return isNaN(n) ? 0 : Math.round(n * 100);
}
function utilizationColor(pct) {
    if (pct >= 100)
        return '#f87171';
    if (pct >= 80)
        return '#fbbf24';
    return '#4ade80';
}
function statusVariant(status) {
    if (status === 'seguro' || status === 'ok')
        return 'green';
    if (status === 'atenção' || status === 'alerta')
        return 'yellow';
    if (status === 'excedido' || status === 'crítico')
        return 'red';
    return 'gray';
}
// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export function Budget() {
    const now = currentMonth();
    // Categories
    const [categories, setCategories] = useState([]);
    useEffect(() => {
        api.categories.list().then(setCategories).catch(() => { });
    }, []);
    // --- Transaction analysis form ---
    const [txAmount, setTxAmount] = useState('');
    const [txCategory, setTxCategory] = useState('');
    const [txDesc, setTxDesc] = useState('');
    const [txMerchant, setTxMerchant] = useState('');
    const [txMonth, setTxMonth] = useState(now);
    // Budget items for the transaction analysis
    const [budgets, setBudgets] = useState([]);
    const [spending, setSpending] = useState([]);
    const [budgetAmount, setBudgetAmount] = useState('');
    const [spentAmount, setSpentAmount] = useState('');
    const [txErrors, setTxErrors] = useState({});
    const analyzeFn = useCallback((body) => api.budget.analyzeTransaction(body), []);
    const { state: txState, execute: executeTx } = useAsync(analyzeFn);
    // --- Budget overview form ---
    const [overviewMonth, setOverviewMonth] = useState(now);
    const [overviewBudgets, setOverviewBudgets] = useState([]);
    const [overviewSpending, setOverviewSpending] = useState([]);
    const [obCat, setObCat] = useState('');
    const [obBudget, setObBudget] = useState('');
    const [obSpent, setObSpent] = useState('');
    const overviewFn = useCallback((body) => api.budget.analysis(body), []);
    const { state: ovState, execute: executeOverview } = useAsync(overviewFn);
    // ---------------------------------------------------------------------------
    // Transaction analysis handlers
    // ---------------------------------------------------------------------------
    function addBudgetForTx() {
        if (!txCategory || !budgetAmount)
            return;
        const cat = categories.find((c) => c.id === txCategory);
        setBudgets((p) => [
            ...p.filter((b) => b.categoryId !== txCategory),
            {
                categoryId: txCategory,
                categoryName: cat?.name ?? txCategory,
                budgetAmountMinor: minor(budgetAmount),
                period: 'monthly',
            },
        ]);
        setSpending((p) => [
            ...p.filter((s) => s.categoryId !== txCategory),
            {
                categoryId: txCategory,
                categoryName: cat?.name ?? txCategory,
                currentPeriodSpentMinor: minor(spentAmount),
                transactionCount: 1,
            },
        ]);
        setBudgetAmount('');
        setSpentAmount('');
    }
    function validateTx() {
        const e = {};
        if (!txAmount)
            e.txAmount = 'Informe o valor';
        if (!txCategory)
            e.txCategory = 'Seleccione a categoria';
        if (!txDesc.trim())
            e.txDesc = 'Informe a descrição';
        if (budgets.length === 0)
            e.budgets = 'Adicione ao menos um orçamento';
        setTxErrors(e);
        return Object.keys(e).length === 0;
    }
    function handleTxSubmit(e) {
        e.preventDefault();
        if (!validateTx())
            return;
        executeTx({
            amountMinor: minor(txAmount),
            categoryId: txCategory,
            description: txDesc,
            merchantName: txMerchant || undefined,
            currentMonth: txMonth,
            budgets,
            spending,
        });
    }
    // ---------------------------------------------------------------------------
    // Budget overview handlers
    // ---------------------------------------------------------------------------
    function addOverviewItem() {
        if (!obCat || !obBudget)
            return;
        const cat = categories.find((c) => c.id === obCat);
        setOverviewBudgets((p) => [
            ...p.filter((b) => b.categoryId !== obCat),
            { categoryId: obCat, categoryName: cat?.name ?? obCat, budgetAmountMinor: minor(obBudget), period: 'monthly' },
        ]);
        setOverviewSpending((p) => [
            ...p.filter((s) => s.categoryId !== obCat),
            { categoryId: obCat, categoryName: cat?.name ?? obCat, currentPeriodSpentMinor: minor(obSpent), transactionCount: 1 },
        ]);
        setObBudget('');
        setObSpent('');
    }
    function handleOverviewSubmit(e) {
        e.preventDefault();
        if (overviewBudgets.length === 0)
            return;
        executeOverview({ currentMonth: overviewMonth, budgets: overviewBudgets, spending: overviewSpending });
    }
    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------
    return (_jsxs("div", { style: { maxWidth: 960 }, children: [_jsxs("div", { style: { marginBottom: '1.5rem' }, children: [_jsx("h1", { style: { fontSize: '1.4rem', fontWeight: 800, color: '#e5e7eb', margin: 0 }, children: "\uD83C\uDFAF An\u00E1lise de Or\u00E7amento" }), _jsx("p", { style: { color: '#6b7280', marginTop: '0.3rem', fontSize: '0.85rem' }, children: "Simule o impacto de uma transac\u00E7\u00E3o e visualize o estado do seu or\u00E7amento mensal." })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }, children: [_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '1rem' }, children: [_jsxs(Card, { children: [_jsx(SectionTitle, { children: "Simular impacto de transac\u00E7\u00E3o" }), _jsxs("form", { onSubmit: handleTxSubmit, style: { display: 'flex', flexDirection: 'column', gap: '0.7rem' }, children: [_jsx(Input, { label: "Valor (R$)", type: "number", step: "0.01", value: txAmount, onChange: (e) => setTxAmount(e.target.value), placeholder: "150.00", error: txErrors.txAmount }), _jsxs(Select, { label: "Categoria", value: txCategory, onChange: (e) => setTxCategory(e.target.value), error: txErrors.txCategory, children: [_jsx("option", { value: "", children: "Seleccione..." }), categories.map((c) => (_jsx("option", { value: c.id, children: c.name }, c.id)))] }), _jsx(Input, { label: "Descri\u00E7\u00E3o", value: txDesc, onChange: (e) => setTxDesc(e.target.value), placeholder: "Compra no supermercado", error: txErrors.txDesc }), _jsx(Input, { label: "Estabelecimento (opcional)", value: txMerchant, onChange: (e) => setTxMerchant(e.target.value), placeholder: "Supermercado Extra" }), _jsx(Input, { label: "M\u00EAs de refer\u00EAncia", value: txMonth, onChange: (e) => setTxMonth(e.target.value), placeholder: "YYYY-MM" }), _jsxs("div", { style: { borderTop: '1px solid #1e2130', paddingTop: '0.75rem' }, children: [_jsx("p", { style: { fontSize: '0.78rem', color: '#6b7280', marginBottom: '0.5rem' }, children: "Or\u00E7amento da categoria (para c\u00E1lculo de impacto)" }), _jsxs("div", { style: { display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }, children: [_jsx(Input, { label: "Or\u00E7amento (R$)", type: "number", step: "0.01", value: budgetAmount, onChange: (e) => setBudgetAmount(e.target.value), placeholder: "500.00" }), _jsx(Input, { label: "J\u00E1 gasto (R$)", type: "number", step: "0.01", value: spentAmount, onChange: (e) => setSpentAmount(e.target.value), placeholder: "350.00" })] }), _jsx(Button, { onClick: addBudgetForTx, variant: "secondary", fullWidth: true, children: "+ Definir or\u00E7amento" }), txErrors.budgets && (_jsx("span", { style: { fontSize: '0.75rem', color: '#f87171' }, children: txErrors.budgets })), budgets.map((b) => (_jsxs("div", { style: { fontSize: '0.78rem', color: '#9ca3af', marginTop: 4 }, children: [b.categoryName, ": ", formatBRL(b.budgetAmountMinor), " / gasto: ", formatBRL(spending.find((s) => s.categoryId === b.categoryId)?.currentPeriodSpentMinor ?? 0)] }, b.categoryId)))] }), _jsx(Button, { type: "submit", fullWidth: true, disabled: txState.status === 'loading', children: txState.status === 'loading' ? 'Analisando...' : 'Analisar impacto' })] })] }), _jsxs(Card, { children: [_jsx(SectionTitle, { children: "Vis\u00E3o geral do or\u00E7amento" }), _jsxs("form", { onSubmit: handleOverviewSubmit, style: { display: 'flex', flexDirection: 'column', gap: '0.7rem' }, children: [_jsx(Input, { label: "M\u00EAs", value: overviewMonth, onChange: (e) => setOverviewMonth(e.target.value), placeholder: "YYYY-MM" }), _jsx("div", { style: { display: 'flex', gap: '0.5rem' }, children: _jsxs(Select, { label: "Categoria", value: obCat, onChange: (e) => setObCat(e.target.value), children: [_jsx("option", { value: "", children: "Seleccione..." }), categories.map((c) => (_jsx("option", { value: c.id, children: c.name }, c.id)))] }) }), _jsxs("div", { style: { display: 'flex', gap: '0.5rem' }, children: [_jsx(Input, { label: "Or\u00E7amento (R$)", type: "number", step: "0.01", value: obBudget, onChange: (e) => setObBudget(e.target.value), placeholder: "500.00" }), _jsx(Input, { label: "Gasto (R$)", type: "number", step: "0.01", value: obSpent, onChange: (e) => setObSpent(e.target.value), placeholder: "350.00" })] }), _jsx(Button, { onClick: addOverviewItem, variant: "secondary", fullWidth: true, children: "+ Adicionar categoria" }), overviewBudgets.length > 0 && (_jsx("div", { style: { fontSize: '0.78rem', color: '#9ca3af' }, children: overviewBudgets.map((b) => (_jsxs("div", { children: [b.categoryName, ": ", formatBRL(b.budgetAmountMinor)] }, b.categoryId))) })), _jsx(Button, { type: "submit", fullWidth: true, disabled: ovState.status === 'loading', children: ovState.status === 'loading' ? 'Calculando...' : 'Ver visão geral' })] })] })] }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '1rem' }, children: [txState.status === 'idle' && (_jsx(EmptyState, { icon: "\uD83C\uDFAF", title: "Simule uma transac\u00E7\u00E3o", description: "O impacto no or\u00E7amento aparecer\u00E1 aqui." })), txState.status === 'loading' && (_jsx("div", { style: { display: 'flex', justifyContent: 'center', padding: '2rem' }, children: _jsx(Spinner, { size: 36 }) })), txState.status === 'error' && (_jsxs(Alert, { variant: "error", children: [_jsx("strong", { children: "Erro:" }), " ", txState.message] })), txState.status === 'success' && (_jsxs(Card, { children: [_jsx(SectionTitle, { children: "Resultado da simula\u00E7\u00E3o" }), txState.data.budgetImpact && (_jsxs("div", { style: { marginBottom: '1rem' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }, children: [_jsx("span", { style: { fontSize: '0.82rem', color: '#9ca3af' }, children: "Utiliza\u00E7\u00E3o antes" }), _jsxs(Badge, { variant: statusVariant(txState.data.budgetImpact.statusBefore.status), children: [txState.data.budgetImpact.utilizationBefore.toFixed(1), "%"] })] }), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }, children: [_jsx("span", { style: { fontSize: '0.82rem', color: '#9ca3af' }, children: "Utiliza\u00E7\u00E3o depois" }), _jsxs(Badge, { variant: statusVariant(txState.data.budgetImpact.statusAfter.status), children: [txState.data.budgetImpact.utilizationAfter.toFixed(1), "%"] })] }), _jsx("div", { style: { background: '#1e2130', borderRadius: 6, height: 8, overflow: 'hidden', marginBottom: '0.5rem' }, children: _jsx("div", { style: {
                                                        width: `${Math.min(txState.data.budgetImpact.utilizationAfter, 100)}%`,
                                                        height: '100%',
                                                        background: utilizationColor(txState.data.budgetImpact.utilizationAfter),
                                                        borderRadius: 6,
                                                        transition: 'width 0.4s',
                                                    } }) }), _jsx("p", { style: { fontSize: '0.82rem', color: '#9ca3af', marginBottom: '0.75rem' }, children: txState.data.budgetImpact.message })] })), txState.data.warnings.length > 0 && (_jsx("div", { style: { marginBottom: '0.75rem' }, children: txState.data.warnings.map((w, i) => (_jsx(Alert, { variant: "warning", children: w }, i))) })), txState.data.insights.length > 0 && (_jsxs("div", { style: { marginBottom: '0.75rem' }, children: [_jsx("p", { style: { fontSize: '0.78rem', color: '#6b7280', marginBottom: '0.4rem', fontWeight: 600 }, children: "INSIGHTS" }), txState.data.insights.map((ins, i) => (_jsx(Alert, { variant: "info", children: ins }, i)))] })), txState.data.recommendations.length > 0 && (_jsxs("div", { children: [_jsx("p", { style: { fontSize: '0.78rem', color: '#6b7280', marginBottom: '0.4rem', fontWeight: 600 }, children: "RECOMENDA\u00C7\u00D5ES" }), txState.data.recommendations.map((r, i) => (_jsx(Alert, { variant: "success", children: r }, i)))] }))] })), ovState.status === 'success' && (_jsxs(Card, { children: [_jsxs(SectionTitle, { children: ["Vis\u00E3o geral \u2014 ", overviewMonth] }), _jsx("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }, children: [
                                            { label: 'Total orçado', value: ovState.data.totalBudgetMinor, color: '#60a5fa' },
                                            { label: 'Total gasto', value: ovState.data.totalSpentMinor, color: '#f87171' },
                                            { label: 'Restante', value: ovState.data.totalRemainingMinor, color: '#4ade80' },
                                        ].map(({ label, value, color }) => (_jsxs("div", { style: { textAlign: 'center' }, children: [_jsx("p", { style: { fontSize: '0.72rem', color: '#6b7280', marginBottom: 2 }, children: label }), _jsx("p", { style: { fontSize: '0.95rem', fontWeight: 700, color }, children: formatBRL(value) })] }, label))) }), _jsx(ResponsiveContainer, { width: "100%", height: 180, children: _jsxs(BarChart, { data: ovState.data.budgetStatuses.map((s) => ({
                                                name: s.categoryName,
                                                orçado: Number(s.budgetAmountMinor) / 100,
                                                gasto: Number(s.spentMinor) / 100,
                                                pct: s.utilizationPercent,
                                            })), margin: { top: 4, right: 4, left: 0, bottom: 0 }, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "#1e2130" }), _jsx(XAxis, { dataKey: "name", tick: { fill: '#6b7280', fontSize: 10 } }), _jsx(YAxis, { tick: { fill: '#6b7280', fontSize: 10 }, tickFormatter: (v) => `R$${v}` }), _jsx(Tooltip, { contentStyle: { background: '#1e2130', border: '1px solid #2a2f45', borderRadius: 8 }, formatter: (v) => [formatBRL(Number(v ?? 0) * 100)] }), _jsx(Bar, { dataKey: "or\u00E7ado", fill: "#2a2f45", radius: [4, 4, 0, 0] }), _jsx(Bar, { dataKey: "gasto", radius: [4, 4, 0, 0], children: ovState.data.budgetStatuses.map((s, i) => (_jsx(Cell, { fill: utilizationColor(s.utilizationPercent) }, i))) })] }) }), _jsx("div", { style: { marginTop: '0.75rem' }, children: ovState.data.budgetStatuses.map((s) => (_jsxs("div", { style: {
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center',
                                                padding: '0.4rem 0',
                                                borderBottom: '1px solid #1e2130',
                                                fontSize: '0.82rem',
                                            }, children: [_jsx("span", { style: { color: '#e5e7eb' }, children: s.categoryName }), _jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'center' }, children: [_jsxs("span", { style: { color: '#6b7280' }, children: [s.utilizationPercent.toFixed(0), "%"] }), _jsx(Badge, { variant: statusVariant(s.status), children: s.status })] })] }, s.categoryId))) })] })), ovState.status === 'error' && (_jsxs(Alert, { variant: "error", children: [_jsx("strong", { children: "Erro:" }), " ", ovState.message] }))] })] })] }));
}

import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Budget.tsx — Avaliação Automática de Orçamento com IA
 *
 * Sem campos manuais. A avaliação é feita automaticamente com base em:
 *   - Renda/salário (transactions income)
 *   - Faturas (card_invoices)
 *   - Extratos (transactions)
 *   - Classificação em categorias
 *   - Contexto do mês
 *
 * Contrato de API: POST /api/assess/budget
 */
import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, } from 'recharts';
import { api, formatBRL, currentMonth, } from '../services/api';
import { Card, Badge, Button, Input, Alert, Spinner, SectionTitle, } from '../components/ui';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function riskVariant(level) {
    if (level === 'baixo')
        return 'green';
    if (level === 'moderado')
        return 'yellow';
    if (level === 'alto' || level === 'crítico')
        return 'red';
    return 'gray';
}
function riskLabel(level) {
    if (!level)
        return '—';
    return level.charAt(0).toUpperCase() + level.slice(1);
}
function commitmentColor(pct) {
    if (pct >= 90)
        return '#f87171';
    if (pct >= 70)
        return '#fbbf24';
    if (pct >= 50)
        return '#fb923c';
    return '#4ade80';
}
function buildMonthOptions() {
    const opts = [];
    const now = new Date();
    for (let i = 0; i < 6; i++) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
        const val = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        opts.push({ value: val, label: label.charAt(0).toUpperCase() + label.slice(1) });
    }
    return opts;
}
const manualProjectionStorageKey = 'previa_finance.cashflow.manual_projections.v1';
function loadManualProjections() {
    if (typeof window === 'undefined')
        return [];
    try {
        const raw = window.localStorage.getItem(manualProjectionStorageKey);
        if (!raw)
            return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return [];
        return parsed
            .map((item) => {
            if (!item || typeof item !== 'object')
                return null;
            const tx = item;
            if (typeof tx.id !== 'string')
                return null;
            if (typeof tx.competencyMonth !== 'string')
                return null;
            if (typeof tx.description !== 'string')
                return null;
            if (typeof tx.amountMinor !== 'number')
                return null;
            if (tx.type !== 'income' && tx.type !== 'expense')
                return null;
            return {
                id: tx.id,
                competencyMonth: tx.competencyMonth,
                amountMinor: tx.amountMinor,
                type: tx.type,
                description: tx.description,
            };
        })
            .filter((tx) => tx !== null);
    }
    catch {
        return [];
    }
}
// ---------------------------------------------------------------------------
// Gauge visual de comprometimento
// ---------------------------------------------------------------------------
function CommitmentGauge({ pct, color }) {
    const clamped = Math.min(100, Math.max(0, pct));
    const c = color ?? commitmentColor(clamped);
    return (_jsx("div", { style: { textAlign: 'center', padding: '1rem 0' }, children: _jsxs("div", { style: { position: 'relative', display: 'inline-block', width: 160, height: 90 }, children: [_jsxs("svg", { width: "160", height: "90", viewBox: "0 0 160 90", children: [_jsx("path", { d: "M 15 80 A 65 65 0 0 1 145 80", fill: "none", stroke: "#1e2130", strokeWidth: "14", strokeLinecap: "round" }), _jsx("path", { d: "M 15 80 A 65 65 0 0 1 145 80", fill: "none", stroke: c, strokeWidth: "14", strokeLinecap: "round", strokeDasharray: `${(clamped / 100) * 204} 204` })] }), _jsxs("div", { style: { position: 'absolute', bottom: 0, left: 0, right: 0, textAlign: 'center' }, children: [_jsxs("span", { style: { fontSize: '1.6rem', fontWeight: 800, color: c }, children: [clamped, "%"] }), _jsx("div", { style: { fontSize: '0.7rem', color: '#6b7280' }, children: "comprometido" })] })] }) }));
}
// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export function Budget() {
    const monthOptions = buildMonthOptions();
    const [selectedMonth, setSelectedMonth] = useState(currentMonth());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [result, setResult] = useState(null);
    const [manualProjectionCount, setManualProjectionCount] = useState(0);
    // Estado do simulador de compra
    const [purchaseDesc, setPurchaseDesc] = useState('');
    const [purchaseValue, setPurchaseValue] = useState('');
    const [purchaseInstallments, setPurchaseInstallments] = useState('1');
    const [purchaseType, setPurchaseType] = useState('credit');
    const [purchaseLoading, setPurchaseLoading] = useState(false);
    const [purchaseImpact, setPurchaseImpact] = useState(null);
    const [purchaseVerdict, setPurchaseVerdict] = useState(null);
    const [purchaseError, setPurchaseError] = useState(null);
    async function handleAnalyze(includeAi = false) {
        setLoading(true);
        setError(null);
        try {
            const manualProjections = loadManualProjections();
            setManualProjectionCount(manualProjections.length);
            const data = await api.assess.budget({
                month: selectedMonth,
                includeAi,
                extraForecasts: manualProjections.map((tx) => ({
                    id: tx.id,
                    competencyMonth: tx.competencyMonth,
                    amountMinor: tx.type === 'expense' ? -Math.abs(tx.amountMinor) : Math.abs(tx.amountMinor),
                    recurrence: 'one-time',
                    description: tx.description,
                    isActive: true,
                })),
            });
            setResult(data);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Erro ao avaliar orçamento');
        }
        finally {
            setLoading(false);
        }
    }
    async function handleSimulatePurchase() {
        const valueNum = parseFloat(purchaseValue.replace(',', '.'));
        if (!purchaseDesc.trim() || isNaN(valueNum) || valueNum <= 0) {
            setPurchaseError('Preencha a descrição e o valor da compra.');
            return;
        }
        setPurchaseLoading(true);
        setPurchaseError(null);
        setPurchaseImpact(null);
        setPurchaseVerdict(null);
        try {
            const manualProjections = loadManualProjections();
            const data = await api.assess.budget({
                month: selectedMonth,
                includeAi: true,
                extraForecasts: manualProjections.map((tx) => ({
                    id: tx.id,
                    competencyMonth: tx.competencyMonth,
                    amountMinor: tx.type === 'expense' ? -Math.abs(tx.amountMinor) : Math.abs(tx.amountMinor),
                    recurrence: 'one-time',
                    description: tx.description,
                    isActive: true,
                })),
                purchaseIntent: {
                    description: purchaseDesc.trim(),
                    totalAmountMinor: Math.round(valueNum * 100),
                    installments: Math.max(1, parseInt(purchaseInstallments) || 1),
                    type: purchaseType,
                },
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const anyData = data;
            if (anyData.purchaseImpact)
                setPurchaseImpact(anyData.purchaseImpact);
            if (anyData.ai?.purchaseVerdict)
                setPurchaseVerdict(anyData.ai.purchaseVerdict);
            // Actualiza o resultado principal também
            setResult(data);
        }
        catch (e) {
            setPurchaseError(e instanceof Error ? e.message : 'Erro ao simular compra');
        }
        finally {
            setPurchaseLoading(false);
        }
    }
    useEffect(() => {
        void handleAnalyze(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedMonth]);
    const ai = result?.ai;
    const projectedIncomeMinor = result?.projectedIncomeMinor ?? 0;
    const projectedExpenseMinor = result?.projectedExpenseMinor ?? 0;
    const projectedLiabilityMinor = result?.projectedLiabilityMinor ?? 0;
    const installmentDebtMinor = result?.installmentDebtMinor ?? 0;
    const usedProjectedIncome = result?.usedProjectedIncome ?? false;
    const usedProjectedExpense = result?.usedProjectedExpense ?? false;
    const usedProjectedLiability = result?.usedProjectedLiability ?? false;
    const consideredIncomeMinor = result?.consideredIncomeMinor ?? (result ? result.incomeMinor + projectedIncomeMinor : 0);
    const consideredExpenseMinor = result?.consideredExpenseMinor ?? (result ? result.expenseMinor + projectedExpenseMinor : 0);
    const consideredLiabilityMinor = result?.consideredLiabilityMinor ?? (result ? result.liabilityMinor + result.openDebtMinor + projectedLiabilityMinor : 0);
    const consideredCommittedMinor = result?.totalCommittedMinor ?? (consideredExpenseMinor + consideredLiabilityMinor);
    const commitmentPct = ai?.commitmentPct ?? (consideredIncomeMinor > 0
        ? Math.round(consideredCommittedMinor / consideredIncomeMinor * 100)
        : 0);
    const availableMinor = ai?.availableMinor ?? (result?.availableMinor ?? (consideredIncomeMinor - consideredCommittedMinor));
    const chartData = result?.categoryBreakdown
        .filter(c => c.amountMinor > 0)
        .slice(0, 8)
        .map(c => ({
        name: c.categoryId,
        valor: Math.round(c.amountMinor / 100),
        pct: c.pctOfIncome,
    })) ?? [];
    const installmentsNum = Math.max(1, parseInt(purchaseInstallments) || 1);
    const purchaseValueNum = parseFloat(purchaseValue.replace(',', '.')) || 0;
    const previewMonthly = purchaseValueNum > 0 && installmentsNum > 1
        ? purchaseValueNum / installmentsNum
        : null;
    return (_jsxs("div", { style: { maxWidth: 900, margin: '0 auto' }, children: [_jsx(SectionTitle, { children: "Or\u00E7amento" }), _jsx("p", { style: { color: '#9ca3af', marginBottom: '1.5rem', fontSize: '0.9rem' }, children: "Avalia\u00E7\u00E3o autom\u00E1tica com base na sua renda, extratos, faturas, previs\u00F5es e proje\u00E7\u00F5es avulsas do m\u00EAs." }), _jsx(Card, { style: { marginBottom: '1.5rem' }, children: _jsxs("div", { style: { display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }, children: [_jsxs("div", { style: { flex: 1, minWidth: 200 }, children: [_jsx("label", { style: { display: 'block', fontSize: '0.8rem', color: '#9ca3af', marginBottom: 4 }, children: "M\u00EAs de refer\u00EAncia" }), _jsx("select", { value: selectedMonth, onChange: e => setSelectedMonth(e.target.value), style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.55rem 0.85rem', color: '#e5e7eb', fontSize: '0.9rem', width: '100%' }, children: buildMonthOptions().map(o => _jsx("option", { value: o.value, children: o.label }, o.value)) })] }), _jsx(Button, { onClick: () => void handleAnalyze(true), disabled: loading, variant: "primary", children: loading ? 'Analisando...' : '🤖 Detalhar com IA' })] }) }), manualProjectionCount > 0 && (_jsxs(Alert, { variant: "info", style: { marginBottom: '1rem' }, children: [manualProjectionCount, " proje\u00E7\u00E3o(\u00F5es) avulsa(s) foram carregada(s) do Fluxo de caixa para esta avalia\u00E7\u00E3o."] })), error && _jsx(Alert, { variant: "error", style: { marginBottom: '1rem' }, children: error }), loading && (_jsxs("div", { style: { textAlign: 'center', padding: '3rem' }, children: [_jsx(Spinner, {}), _jsx("p", { style: { color: '#9ca3af', marginTop: '1rem' }, children: "A IA est\u00E1 analisando seus dados financeiros..." })] })), result && !loading && (_jsxs(_Fragment, { children: [_jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }, children: [_jsxs(Card, { children: [_jsx("div", { style: { fontSize: '0.8rem', color: '#9ca3af', marginBottom: 4 }, children: "Comprometimento da renda" }), _jsx(CommitmentGauge, { pct: commitmentPct }), _jsx("div", { style: { textAlign: 'center', marginTop: 4 }, children: _jsxs(Badge, { variant: riskVariant(ai?.riskLevel), children: ["Risco ", riskLabel(ai?.riskLevel)] }) })] }), _jsxs(Card, { children: [_jsx("div", { style: { fontSize: '0.8rem', color: '#9ca3af', marginBottom: 8 }, children: "Pode gastar?" }), ai?.canSpend !== undefined && (_jsx("div", { style: {
                                            fontSize: '2rem',
                                            fontWeight: 800,
                                            color: ai.canSpend ? '#4ade80' : '#f87171',
                                            marginBottom: 8,
                                        }, children: ai.canSpend ? '✓ Sim' : '✗ Não' })), _jsx("div", { style: { fontSize: '0.85rem', color: '#9ca3af', marginBottom: 4 }, children: "Sobra dispon\u00EDvel" }), _jsx("div", { style: {
                                            fontSize: '1.4rem',
                                            fontWeight: 700,
                                            color: availableMinor >= 0 ? '#4ade80' : '#f87171',
                                        }, children: formatBRL(availableMinor) })] })] }), _jsx("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }, children: [
                            {
                                label: 'Renda considerada',
                                value: consideredIncomeMinor,
                                color: '#4ade80',
                                meta: `Realizada ${formatBRL(result.incomeMinor)}${usedProjectedIncome ? ` • Prevista ${formatBRL(projectedIncomeMinor)}` : ''}`,
                            },
                            {
                                label: 'Gastos considerados',
                                value: consideredExpenseMinor,
                                color: '#f87171',
                                meta: `Realizados ${formatBRL(result.expenseMinor)}${usedProjectedExpense ? ` • Projetados ${formatBRL(projectedExpenseMinor)}` : ''}`,
                            },
                            {
                                label: 'Dívida em aberto',
                                value: consideredLiabilityMinor,
                                color: '#fbbf24',
                                meta: `Aberta ${formatBRL(result.openDebtMinor)}${installmentDebtMinor > 0 ? ` • Parcelas ${formatBRL(installmentDebtMinor)}` : ''}${usedProjectedLiability ? ` • Projetada ${formatBRL(projectedLiabilityMinor)}` : ''}`,
                            },
                            { label: availableMinor >= 0 ? 'Sobra' : 'Déficit', value: Math.abs(availableMinor), color: availableMinor >= 0 ? '#4ade80' : '#f87171' },
                        ].map(m => (_jsxs(Card, { children: [_jsx("div", { style: { fontSize: '0.75rem', color: '#9ca3af', marginBottom: 4 }, children: m.label }), _jsx("div", { style: { fontSize: '1.1rem', fontWeight: 700, color: m.color }, children: formatBRL(m.value) }), 'meta' in m && m.meta && (_jsx("div", { style: { fontSize: '0.72rem', color: '#6b7280', marginTop: 4 }, children: m.meta }))] }, m.label))) }), ai?.diagnosis && (_jsxs(Card, { style: { marginBottom: '1.5rem', borderLeft: '3px solid #6366f1' }, children: [_jsx("div", { style: { fontSize: '0.8rem', color: '#6366f1', marginBottom: 6, fontWeight: 600 }, children: "\uD83E\uDD16 Diagn\u00F3stico" }), _jsx("p", { style: { color: '#e5e7eb', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }, children: ai.diagnosis })] })), _jsxs(Card, { style: { marginBottom: '1.5rem', borderLeft: '3px solid #f59e0b' }, children: [_jsx("div", { style: { fontSize: '0.85rem', color: '#f59e0b', marginBottom: '1rem', fontWeight: 600 }, children: "\uD83D\uDED2 Simular compra" }), _jsx("p", { style: { fontSize: '0.82rem', color: '#9ca3af', marginBottom: '1rem', marginTop: 0 }, children: "Informe o que quer comprar e a IA avalia se cabe no seu or\u00E7amento agora." }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem', alignItems: 'flex-end' }, children: [_jsx(Input, { label: "O que quer comprar?", placeholder: "Ex: iPhone 15 Pro, Geladeira, Viagem...", value: purchaseDesc, onChange: e => setPurchaseDesc(e.target.value) }), _jsx(Input, { label: "Valor total (R$)", placeholder: "Ex: 3499,90", value: purchaseValue, onChange: e => setPurchaseValue(e.target.value), type: "text", inputMode: "decimal" }), _jsxs("div", { children: [_jsx("label", { style: { display: 'block', fontSize: '0.8rem', color: '#9ca3af', marginBottom: 4 }, children: "Parcelas" }), _jsx("select", { value: purchaseInstallments, onChange: e => setPurchaseInstallments(e.target.value), style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.55rem 0.85rem', color: '#e5e7eb', fontSize: '0.9rem', width: '100%' }, children: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18, 24, 36, 48].map(n => (_jsx("option", { value: n, children: n === 1 ? 'À vista' : `${n}x` }, n))) })] }), _jsxs("div", { children: [_jsx("label", { style: { display: 'block', fontSize: '0.8rem', color: '#9ca3af', marginBottom: 4 }, children: "Forma" }), _jsxs("select", { value: purchaseType, onChange: e => setPurchaseType(e.target.value), style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.55rem 0.85rem', color: '#e5e7eb', fontSize: '0.9rem', width: '100%' }, children: [_jsx("option", { value: "credit", children: "Cr\u00E9dito" }), _jsx("option", { value: "debit", children: "D\u00E9bito" })] })] })] }), previewMonthly !== null && (_jsxs("div", { style: { fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.75rem' }, children: ["Parcela estimada: ", _jsx("strong", { style: { color: '#f59e0b' }, children: formatBRL(Math.round(previewMonthly * 100)) }), "/m\u00EAs"] })), purchaseError && _jsx(Alert, { variant: "error", style: { marginBottom: '0.75rem' }, children: purchaseError }), _jsx(Button, { onClick: () => void handleSimulatePurchase(), disabled: purchaseLoading || !purchaseDesc.trim() || !purchaseValue, variant: "primary", children: purchaseLoading ? 'Consultando IA...' : '🤖 Posso comprar?' }), purchaseImpact && (_jsxs("div", { style: { marginTop: '1.25rem', borderTop: '1px solid #1e2130', paddingTop: '1.25rem' }, children: [_jsxs("div", { style: {
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.75rem',
                                            marginBottom: '1rem',
                                            padding: '0.75rem 1rem',
                                            borderRadius: 10,
                                            background: purchaseImpact.canAfford ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)',
                                            border: `1px solid ${purchaseImpact.canAfford ? '#4ade80' : '#f87171'}`,
                                        }, children: [_jsx("span", { style: { fontSize: '1.8rem' }, children: purchaseImpact.canAfford ? '✅' : '❌' }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: '1rem', fontWeight: 700, color: purchaseImpact.canAfford ? '#4ade80' : '#f87171' }, children: purchaseImpact.canAfford ? 'Pode comprar' : 'Não recomendado agora' }), purchaseVerdict?.verdict && (_jsx("div", { style: { fontSize: '0.85rem', color: '#e5e7eb', marginTop: 2 }, children: purchaseVerdict.verdict }))] })] }), _jsx("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1rem' }, children: [
                                            { label: 'Impacto este mês', value: purchaseImpact.impactThisMonthBRL, color: '#f87171' },
                                            { label: 'Sobra após compra', value: purchaseImpact.availableAfterBRL, color: purchaseImpact.canAfford ? '#4ade80' : '#f87171' },
                                            { label: 'Comprometimento após', value: `${purchaseImpact.commitmentAfterPct}%`, color: commitmentColor(purchaseImpact.commitmentAfterPct) },
                                        ].map(m => (_jsxs("div", { style: { background: '#0f1117', borderRadius: 8, padding: '0.6rem 0.75rem' }, children: [_jsx("div", { style: { fontSize: '0.72rem', color: '#6b7280', marginBottom: 2 }, children: m.label }), _jsx("div", { style: { fontSize: '1rem', fontWeight: 700, color: m.color }, children: m.value })] }, m.label))) }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }, children: [_jsxs("div", { style: { background: '#0f1117', borderRadius: 8, padding: '0.5rem', textAlign: 'center' }, children: [_jsx("div", { style: { fontSize: '0.72rem', color: '#6b7280', marginBottom: 4 }, children: "Antes da compra" }), _jsx(CommitmentGauge, { pct: commitmentPct })] }), _jsxs("div", { style: { background: '#0f1117', borderRadius: 8, padding: '0.5rem', textAlign: 'center' }, children: [_jsx("div", { style: { fontSize: '0.72rem', color: '#6b7280', marginBottom: 4 }, children: "Ap\u00F3s a compra" }), _jsx(CommitmentGauge, { pct: purchaseImpact.commitmentAfterPct })] })] }), purchaseVerdict?.impactSummary && (_jsx("div", { style: { fontSize: '0.85rem', color: '#e5e7eb', lineHeight: 1.6, marginBottom: '0.75rem', padding: '0.75rem', background: '#0f1117', borderRadius: 8 }, children: purchaseVerdict.impactSummary })), purchaseVerdict?.warnings && purchaseVerdict.warnings.length > 0 && (_jsx("div", { style: { marginBottom: '0.75rem' }, children: purchaseVerdict.warnings.map((w, i) => (_jsxs("div", { style: { fontSize: '0.82rem', color: '#fbbf24', display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 4 }, children: [_jsx("span", { style: { flexShrink: 0 }, children: "\u26A0\uFE0F" }), " ", w] }, i))) })), purchaseVerdict?.alternatives && purchaseVerdict.alternatives.length > 0 && (_jsxs("div", { children: [_jsx("div", { style: { fontSize: '0.78rem', color: '#6366f1', fontWeight: 600, marginBottom: 4 }, children: "Alternativas sugeridas:" }), purchaseVerdict.alternatives.map((a, i) => (_jsxs("div", { style: { fontSize: '0.82rem', color: '#e5e7eb', display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 4 }, children: [_jsx("span", { style: { color: '#6366f1', flexShrink: 0 }, children: "\u2192" }), " ", a] }, i)))] }))] }))] }), chartData.length > 0 && (_jsxs(Card, { style: { marginBottom: '1.5rem' }, children: [_jsx("div", { style: { fontSize: '0.85rem', color: '#9ca3af', marginBottom: '1rem' }, children: "Categorias mais impactantes (% da renda)" }), _jsx(ResponsiveContainer, { width: "100%", height: 220, children: _jsxs(BarChart, { data: chartData, layout: "vertical", margin: { left: 40, right: 20 }, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "#1e2130" }), _jsx(XAxis, { type: "number", tick: { fill: '#6b7280', fontSize: 11 }, tickFormatter: v => `${v}%` }), _jsx(YAxis, { type: "category", dataKey: "name", tick: { fill: '#9ca3af', fontSize: 11 }, width: 80 }), _jsx(Tooltip, { contentStyle: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8 }, formatter: (v) => [`${v}%`, 'da renda'] }), _jsx(Bar, { dataKey: "pct", radius: [0, 4, 4, 0], children: chartData.map((entry, i) => (_jsx(Cell, { fill: commitmentColor(entry.pct) }, i))) })] }) })] })), ai?.alerts && ai.alerts.length > 0 && (_jsxs(Card, { style: { marginBottom: '1.5rem' }, children: [_jsx("div", { style: { fontSize: '0.85rem', color: '#fbbf24', marginBottom: '0.75rem', fontWeight: 600 }, children: "\u26A0\uFE0F Alertas" }), _jsx("ul", { style: { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }, children: ai.alerts.map((a, i) => (_jsxs("li", { style: { display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.88rem', color: '#e5e7eb' }, children: [_jsx("span", { style: { color: '#fbbf24', flexShrink: 0 }, children: "\u2022" }), a] }, i))) })] })), ai?.recommendations && ai.recommendations.length > 0 && (_jsxs(Card, { style: { marginBottom: '1.5rem' }, children: [_jsx("div", { style: { fontSize: '0.85rem', color: '#4ade80', marginBottom: '0.75rem', fontWeight: 600 }, children: "\uD83D\uDCA1 Recomenda\u00E7\u00F5es" }), _jsx("ol", { style: { margin: 0, padding: '0 0 0 1.2rem', display: 'flex', flexDirection: 'column', gap: 10 }, children: ai.recommendations.map((r, i) => (_jsx("li", { style: { fontSize: '0.88rem', color: '#e5e7eb', lineHeight: 1.5 }, children: r }, i))) })] })), result.historicalMonths.length > 0 && (_jsxs(Card, { children: [_jsx("div", { style: { fontSize: '0.85rem', color: '#9ca3af', marginBottom: '0.75rem' }, children: "Hist\u00F3rico dos \u00FAltimos meses" }), _jsx("div", { style: { display: 'flex', gap: '1rem', flexWrap: 'wrap' }, children: result.historicalMonths.map(h => (_jsxs("div", { style: { flex: 1, minWidth: 120, background: '#0f1117', borderRadius: 8, padding: '0.75rem' }, children: [_jsx("div", { style: { fontSize: '0.75rem', color: '#6b7280', marginBottom: 4 }, children: h.month }), _jsxs("div", { style: { fontSize: '0.8rem', color: '#4ade80' }, children: ["\u2191 ", formatBRL(h.incomeMinor)] }), _jsxs("div", { style: { fontSize: '0.8rem', color: '#f87171' }, children: ["\u2193 ", formatBRL(h.expenseMinor)] })] }, h.month))) })] }))] })), !result && !loading && (_jsxs(Card, { style: { textAlign: 'center', padding: '3rem' }, children: [_jsx("div", { style: { fontSize: '2rem', marginBottom: '1rem' }, children: "\uD83C\uDFAF" }), _jsxs("p", { style: { color: '#9ca3af' }, children: ["Selecione o m\u00EAs para carregar a avalia\u00E7\u00E3o autom\u00E1tica. Se quiser texto mais detalhado, clique em ", _jsx("strong", { style: { color: '#6366f1' }, children: "Detalhar com IA" }), "."] })] }))] }));
}

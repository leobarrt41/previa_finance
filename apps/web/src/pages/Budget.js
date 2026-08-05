import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Budget.tsx — Avaliação de Orçamento
 *
 * UX: directo ao ponto. O utilizador vê imediatamente:
 *   1. Semáforo do mês (% comprometido + risco + sobra)
 *   2. Três blocos: Entra / Sai / Sobra com tendência
 *   3. Categorias com barra de risco colorida
 *   4. Diagnóstico + alertas + recomendações da IA (quando disponível)
 *   5. Histórico comparativo
 *
 * Contrato de API: POST /api/assess/budget
 */
import { useEffect, useState } from 'react';
import { api, formatBRL, currentMonth, } from '../services/api';
import { Card, Badge, Button, Alert, Spinner, SectionTitle, } from '../components/ui';
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
function commitmentBg(pct) {
    if (pct >= 90)
        return 'rgba(248,113,113,0.08)';
    if (pct >= 70)
        return 'rgba(251,191,36,0.08)';
    if (pct >= 50)
        return 'rgba(251,146,60,0.08)';
    return 'rgba(74,222,128,0.08)';
}
function formatCategoryLabel(categoryId) {
    if (categoryId === 'sem_categoria')
        return 'Sem categoria';
    if (categoryId === 'outros')
        return 'Outros';
    return categoryId
        .replace(/[_-]+/g, ' ')
        .split(' ')
        .filter(Boolean)
        .map((part) => {
        if (/^\d+$/.test(part))
            return part;
        return part.charAt(0).toUpperCase() + part.slice(1);
    })
        .join(' ');
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
// Subcomponentes
// ---------------------------------------------------------------------------
/** Barra de progresso colorida de comprometimento */
function CommitmentBar({ pct }) {
    const clamped = Math.min(100, Math.max(0, pct));
    const color = commitmentColor(clamped);
    return (_jsxs("div", { style: { width: '100%' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 4 }, children: [_jsx("span", { style: { fontSize: '0.72rem', color: '#6b7280' }, children: "0%" }), _jsx("span", { style: { fontSize: '0.72rem', color: '#6b7280' }, children: "100%" })] }), _jsx("div", { style: { height: 8, background: '#1e2130', borderRadius: 99, overflow: 'hidden' }, children: _jsx("div", { style: {
                        height: '100%',
                        width: `${clamped}%`,
                        background: color,
                        borderRadius: 99,
                        transition: 'width 0.6s ease',
                    } }) })] }));
}
/** Card de métrica principal com tendência */
function MetricCard({ label, value, color, sub, trend, }) {
    const trendIcon = trend?.direction === 'up' ? '↑' : trend?.direction === 'down' ? '↓' : '→';
    const trendColor = trend?.direction === 'up'
        ? (color === '#4ade80' ? '#4ade80' : '#f87171')
        : trend?.direction === 'down'
            ? (color === '#4ade80' ? '#f87171' : '#4ade80')
            : '#6b7280';
    return (_jsxs(Card, { style: { flex: 1 }, children: [_jsx("div", { style: { fontSize: '0.78rem', color: '#9ca3af', marginBottom: 6, fontWeight: 500 }, children: label }), _jsx("div", { style: { fontSize: '1.5rem', fontWeight: 800, color, marginBottom: sub ? 4 : 0 }, children: formatBRL(value) }), sub && _jsx("div", { style: { fontSize: '0.72rem', color: '#6b7280' }, children: sub }), trend && (_jsxs("div", { style: { fontSize: '0.75rem', color: trendColor, marginTop: 6, display: 'flex', alignItems: 'center', gap: 3 }, children: [_jsx("span", { children: trendIcon }), _jsx("span", { children: trend.label })] }))] }));
}
/** Linha de categoria com barra de risco */
function CategoryRow({ label, amountMinor, pct, }) {
    const color = commitmentColor(pct);
    return (_jsxs("div", { style: { marginBottom: '0.75rem' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }, children: [_jsx("span", { style: { fontSize: '0.85rem', color: '#e5e7eb' }, children: label }), _jsxs("div", { style: { display: 'flex', gap: '0.75rem', alignItems: 'baseline' }, children: [_jsx("span", { style: { fontSize: '0.85rem', fontWeight: 600, color: '#e5e7eb' }, children: formatBRL(amountMinor) }), _jsxs("span", { style: { fontSize: '0.75rem', color, fontWeight: 700, minWidth: 36, textAlign: 'right' }, children: [pct, "%"] })] })] }), _jsx("div", { style: { height: 5, background: '#1e2130', borderRadius: 99, overflow: 'hidden' }, children: _jsx("div", { style: {
                        height: '100%',
                        width: `${Math.min(100, pct)}%`,
                        background: color,
                        borderRadius: 99,
                    } }) })] }));
}
// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export function Budget() {
    const [selectedMonth, setSelectedMonth] = useState(currentMonth());
    const [loading, setLoading] = useState(false);
    const [aiLoading, setAiLoading] = useState(false);
    const [error, setError] = useState(null);
    const [result, setResult] = useState(null);
    const [manualProjectionCount, setManualProjectionCount] = useState(0);
    async function loadBudget(includeAi = false) {
        if (includeAi) {
            setAiLoading(true);
        }
        else {
            setLoading(true);
        }
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
            setAiLoading(false);
        }
    }
    useEffect(() => {
        void loadBudget(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedMonth]);
    // ---------------------------------------------------------------------------
    // Derivações
    // ---------------------------------------------------------------------------
    const ai = result?.ai;
    const projectedIncomeMinor = result?.projectedIncomeMinor ?? 0;
    const projectedExpenseMinor = result?.projectedExpenseMinor ?? 0;
    const projectedLiabilityMinor = result?.projectedLiabilityMinor ?? 0;
    const installmentDebtMinor = result?.installmentDebtMinor ?? 0;
    const usedProjectedIncome = result?.usedProjectedIncome ?? false;
    const usedProjectedExpense = result?.usedProjectedExpense ?? false;
    const usedProjectedLiability = result?.usedProjectedLiability ?? false;
    const consideredIncomeMinor = result?.consideredIncomeMinor
        ?? (result ? result.incomeMinor + projectedIncomeMinor : 0);
    const consideredExpenseMinor = result?.consideredExpenseMinor
        ?? (result ? result.expenseMinor + projectedExpenseMinor : 0);
    const consideredLiabilityMinor = result?.consideredLiabilityMinor
        ?? (result ? result.liabilityMinor + result.openDebtMinor + projectedLiabilityMinor : 0);
    const consideredCommittedMinor = result?.totalCommittedMinor
        ?? (consideredExpenseMinor + consideredLiabilityMinor);
    const commitmentPct = ai?.commitmentPct ?? (consideredIncomeMinor > 0
        ? Math.round(consideredCommittedMinor / consideredIncomeMinor * 100)
        : 0);
    const availableMinor = ai?.availableMinor
        ?? (result?.availableMinor ?? (consideredIncomeMinor - consideredCommittedMinor));
    // Tendência vs mês anterior (histórico[0] = mês mais recente anterior ao actual)
    const prevMonth = result?.historicalMonths?.[0];
    const incomeTrend = prevMonth && prevMonth.incomeMinor > 0
        ? (consideredIncomeMinor > prevMonth.incomeMinor
            ? { direction: 'up', label: `+${formatBRL(consideredIncomeMinor - prevMonth.incomeMinor)} vs mês anterior` }
            : consideredIncomeMinor < prevMonth.incomeMinor
                ? { direction: 'down', label: `-${formatBRL(prevMonth.incomeMinor - consideredIncomeMinor)} vs mês anterior` }
                : { direction: 'same', label: 'Igual ao mês anterior' })
        : undefined;
    const expenseTrend = prevMonth && prevMonth.expenseMinor > 0
        ? (consideredExpenseMinor > prevMonth.expenseMinor
            ? { direction: 'up', label: `+${formatBRL(consideredExpenseMinor - prevMonth.expenseMinor)} vs mês anterior` }
            : consideredExpenseMinor < prevMonth.expenseMinor
                ? { direction: 'down', label: `-${formatBRL(prevMonth.expenseMinor - consideredExpenseMinor)} vs mês anterior` }
                : { direction: 'same', label: 'Igual ao mês anterior' })
        : undefined;
    const categoryRows = (result?.categoryBreakdown ?? [])
        .filter(c => c.amountMinor > 0)
        .sort((a, b) => b.pctOfIncome - a.pctOfIncome)
        .slice(0, 8);
    const hasData = result && (consideredIncomeMinor > 0 || consideredExpenseMinor > 0);
    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------
    return (_jsxs("div", { style: { maxWidth: 860, margin: '0 auto' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }, children: [_jsx(SectionTitle, { style: { margin: 0 }, children: "Or\u00E7amento" }), _jsxs("div", { style: { display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }, children: [_jsx("select", { value: selectedMonth, onChange: e => setSelectedMonth(e.target.value), style: {
                                    background: '#141624',
                                    border: '1px solid #2a2f45',
                                    borderRadius: 8,
                                    padding: '0.5rem 0.85rem',
                                    color: '#e5e7eb',
                                    fontSize: '0.9rem',
                                }, children: buildMonthOptions().map(o => _jsx("option", { value: o.value, children: o.label }, o.value)) }), _jsx(Button, { onClick: () => void loadBudget(true), disabled: loading || aiLoading, variant: "primary", children: aiLoading ? 'Analisando...' : '🤖 Análise com IA' })] })] }), manualProjectionCount > 0 && (_jsxs(Alert, { variant: "info", style: { marginBottom: '1rem' }, children: [manualProjectionCount, " proje\u00E7\u00E3o(\u00F5es) avulsa(s) do Fluxo de Caixa inclu\u00EDda(s) nesta avalia\u00E7\u00E3o."] })), error && _jsx(Alert, { variant: "error", style: { marginBottom: '1rem' }, children: error }), loading && (_jsxs("div", { style: { textAlign: 'center', padding: '4rem' }, children: [_jsx(Spinner, {}), _jsx("p", { style: { color: '#9ca3af', marginTop: '1rem', fontSize: '0.9rem' }, children: "Carregando avalia\u00E7\u00E3o..." })] })), result && !loading && !hasData && (_jsxs(Card, { style: { textAlign: 'center', padding: '3rem' }, children: [_jsx("div", { style: { fontSize: '2.5rem', marginBottom: '1rem' }, children: "\uD83D\uDCC2" }), _jsx("div", { style: { fontSize: '1rem', fontWeight: 700, color: '#e5e7eb', marginBottom: '0.5rem' }, children: "Nenhum dado encontrado para este m\u00EAs" }), _jsx("p", { style: { color: '#9ca3af', fontSize: '0.88rem', maxWidth: 380, margin: '0 auto 1.5rem' }, children: "Importe uma fatura de cart\u00E3o ou adicione transa\u00E7\u00F5es para ver a avalia\u00E7\u00E3o do or\u00E7amento." }), _jsxs("div", { style: { display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }, children: [_jsx(Button, { variant: "primary", onClick: () => window.location.href = '/invoices/upload', children: "Importar fatura" }), _jsx(Button, { variant: "secondary", onClick: () => window.location.href = '/statements/upload', children: "Importar extrato" })] })] })), result && !loading && hasData && (_jsxs(_Fragment, { children: [_jsxs(Card, { style: {
                            marginBottom: '1.5rem',
                            background: commitmentBg(commitmentPct),
                            border: `1px solid ${commitmentColor(commitmentPct)}33`,
                        }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }, children: [_jsxs("span", { style: { fontSize: '2rem', fontWeight: 900, color: commitmentColor(commitmentPct) }, children: [commitmentPct, "%"] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: '0.78rem', color: '#9ca3af' }, children: "da renda comprometido" }), _jsxs(Badge, { variant: riskVariant(ai?.riskLevel), children: ["Risco ", riskLabel(ai?.riskLevel)] })] })] }), _jsxs("div", { style: { textAlign: 'right' }, children: [_jsx("div", { style: { fontSize: '0.78rem', color: '#9ca3af', marginBottom: 2 }, children: availableMinor >= 0 ? 'Sobra disponível' : 'Déficit' }), _jsx("div", { style: {
                                                    fontSize: '1.6rem',
                                                    fontWeight: 800,
                                                    color: availableMinor >= 0 ? '#4ade80' : '#f87171',
                                                }, children: formatBRL(Math.abs(availableMinor)) }), ai?.canSpend !== undefined && (_jsx("div", { style: { fontSize: '0.78rem', color: ai.canSpend ? '#4ade80' : '#f87171', marginTop: 2 }, children: ai.canSpend ? '✓ Pode gastar' : '✗ Não recomendado gastar' }))] })] }), _jsx(CommitmentBar, { pct: commitmentPct })] }), _jsxs("div", { style: { display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }, children: [_jsx(MetricCard, { label: "Entrou", value: consideredIncomeMinor, color: "#4ade80", sub: usedProjectedIncome ? `Realizado ${formatBRL(result.incomeMinor)} + Previsto ${formatBRL(projectedIncomeMinor)}` : undefined, trend: incomeTrend }), _jsx(MetricCard, { label: "Saiu", value: consideredCommittedMinor, color: "#f87171", sub: (() => {
                                    const parts = [];
                                    if (result.expenseMinor > 0)
                                        parts.push(`Gastos ${formatBRL(result.expenseMinor)}`);
                                    if (result.openDebtMinor > 0)
                                        parts.push(`Dívida ${formatBRL(result.openDebtMinor)}`);
                                    if (installmentDebtMinor > 0)
                                        parts.push(`Parcelas ${formatBRL(installmentDebtMinor)}`);
                                    if (usedProjectedExpense && projectedExpenseMinor > 0)
                                        parts.push(`Projetado ${formatBRL(projectedExpenseMinor)}`);
                                    if (usedProjectedLiability && projectedLiabilityMinor > 0)
                                        parts.push(`Dívida prev. ${formatBRL(projectedLiabilityMinor)}`);
                                    return parts.length > 0 ? parts.join(' · ') : undefined;
                                })(), trend: expenseTrend }), _jsx(MetricCard, { label: availableMinor >= 0 ? 'Sobra' : 'Déficit', value: Math.abs(availableMinor), color: availableMinor >= 0 ? '#4ade80' : '#f87171' })] }), ai?.diagnosis && (_jsxs(Card, { style: { marginBottom: '1.5rem', borderLeft: '3px solid #6366f1' }, children: [_jsx("div", { style: { fontSize: '0.78rem', color: '#6366f1', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }, children: "Diagn\u00F3stico da IA" }), _jsx("p", { style: { color: '#e5e7eb', fontSize: '0.9rem', lineHeight: 1.65, margin: 0 }, children: ai.diagnosis }), ai.trend && (_jsxs("div", { style: { marginTop: '0.75rem', fontSize: '0.82rem', color: '#9ca3af' }, children: ["Tend\u00EAncia: ", _jsx("strong", { style: { color: ai.trend === 'crescente' ? '#f87171' : ai.trend === 'decrescente' ? '#4ade80' : '#9ca3af' }, children: ai.trend === 'crescente' ? '↑ Gastos crescendo' : ai.trend === 'decrescente' ? '↓ Gastos reduzindo' : '→ Estável' }), ai.trendDescription && _jsxs("span", { style: { marginLeft: 6 }, children: ["\u2014 ", ai.trendDescription] })] }))] })), ai?.alerts && ai.alerts.length > 0 && (_jsxs(Card, { style: { marginBottom: '1.5rem', borderLeft: '3px solid #fbbf24' }, children: [_jsx("div", { style: { fontSize: '0.78rem', color: '#fbbf24', marginBottom: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }, children: "Aten\u00E7\u00E3o" }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: ai.alerts.map((a, i) => (_jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.88rem', color: '#e5e7eb' }, children: [_jsx("span", { style: { color: '#fbbf24', flexShrink: 0, marginTop: 1 }, children: "\u26A0" }), a] }, i))) })] })), categoryRows.length > 0 && (_jsxs(Card, { style: { marginBottom: '1.5rem' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '1rem' }, children: [_jsx("div", { style: { fontSize: '0.88rem', color: '#e5e7eb', fontWeight: 700 }, children: "Onde o dinheiro foi" }), _jsx("div", { style: { fontSize: '0.75rem', color: '#6b7280' }, children: "% da renda" })] }), categoryRows.map(c => (_jsx(CategoryRow, { label: formatCategoryLabel(c.categoryId), amountMinor: c.amountMinor, pct: c.pctOfIncome }, c.categoryId)))] })), ai?.recommendations && ai.recommendations.length > 0 && (_jsxs(Card, { style: { marginBottom: '1.5rem', borderLeft: '3px solid #4ade80' }, children: [_jsx("div", { style: { fontSize: '0.78rem', color: '#4ade80', marginBottom: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }, children: "O que fazer" }), _jsx("ol", { style: { margin: 0, padding: '0 0 0 1.2rem', display: 'flex', flexDirection: 'column', gap: 10 }, children: ai.recommendations.map((r, i) => (_jsx("li", { style: { fontSize: '0.88rem', color: '#e5e7eb', lineHeight: 1.55 }, children: r }, i))) })] })), (result.historicalMonths ?? []).length > 0 && (_jsxs(Card, { children: [_jsx("div", { style: { fontSize: '0.85rem', color: '#9ca3af', marginBottom: '1rem', fontWeight: 600 }, children: "Hist\u00F3rico" }), _jsx("div", { style: { display: 'grid', gridTemplateColumns: `repeat(${Math.min((result.historicalMonths ?? []).length, 5)}, 1fr)`, gap: '0.75rem' }, children: (result.historicalMonths ?? []).slice(0, 5).map(h => {
                                    const balance = h.incomeMinor - h.expenseMinor;
                                    return (_jsxs("div", { style: { background: '#0f1117', borderRadius: 8, padding: '0.75rem' }, children: [_jsx("div", { style: { fontSize: '0.72rem', color: '#6b7280', marginBottom: 6 }, children: new Date(h.month + '-01').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }) }), _jsxs("div", { style: { fontSize: '0.8rem', color: '#4ade80', marginBottom: 2 }, children: ["\u2191 ", formatBRL(h.incomeMinor)] }), _jsxs("div", { style: { fontSize: '0.8rem', color: '#f87171', marginBottom: 4 }, children: ["\u2193 ", formatBRL(h.expenseMinor)] }), _jsxs("div", { style: {
                                                    fontSize: '0.78rem',
                                                    fontWeight: 700,
                                                    color: balance >= 0 ? '#4ade80' : '#f87171',
                                                    borderTop: '1px solid #1e2130',
                                                    paddingTop: 4,
                                                    marginTop: 2,
                                                }, children: [balance >= 0 ? '+' : '', formatBRL(balance)] })] }, h.month));
                                }) })] })), !ai?.diagnosis && !aiLoading && (_jsxs("div", { style: { marginTop: '1.5rem', textAlign: 'center' }, children: [_jsx("p", { style: { color: '#6b7280', fontSize: '0.85rem', marginBottom: '0.75rem' }, children: "Quer um diagn\u00F3stico detalhado com alertas e recomenda\u00E7\u00F5es personalizadas?" }), _jsx(Button, { onClick: () => void loadBudget(true), disabled: aiLoading, variant: "primary", children: aiLoading ? 'Analisando...' : '🤖 Analisar com IA' })] })), aiLoading && (_jsxs("div", { style: { textAlign: 'center', padding: '1.5rem' }, children: [_jsx(Spinner, {}), _jsx("p", { style: { color: '#9ca3af', marginTop: '0.75rem', fontSize: '0.85rem' }, children: "A IA est\u00E1 analisando seus dados financeiros..." })] }))] }))] }));
}

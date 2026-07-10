import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * DebtAssessor.tsx — Avaliador de Dívidas
 * API: POST /api/assess/debt
 *
 * UX redesenhada:
 *  1. Carrega automaticamente ao abrir (sem precisar clicar em "Avaliar")
 *  2. Semáforo de saúde financeira no topo (pressão real calculada correctamente)
 *  3. Três blocos claros: Dívida em aberto / Parcelas futuras / Pago este mês
 *  4. Barras de pressão com valores distintos e correctos
 *  5. Faturas do mês em cards visuais (não tabela crua)
 *  6. Parcelas futuras agrupadas por mês
 *  7. Evolução mensal com chart de barras legível
 *  8. IA inline (diagnóstico + alertas + recomendações)
 */
import { useEffect, useState } from 'react';
import { api, formatBRL, currentMonth, } from '../services/api';
import { Card, Badge, Button, Alert, Spinner, SectionTitle } from '../components/ui';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function riskVariant(level) {
    if (level === 'baixo')
        return 'green';
    if (level === 'moderado')
        return 'yellow';
    if (level === 'alto' || level === 'critico' || level === 'crítico')
        return 'red';
    return 'gray';
}
function pressureColor(pct) {
    if (pct >= 40)
        return '#f87171';
    if (pct >= 25)
        return '#fbbf24';
    return '#4ade80';
}
function pressureBg(pct) {
    if (pct >= 40)
        return 'rgba(248,113,113,0.08)';
    if (pct >= 25)
        return 'rgba(251,191,36,0.08)';
    return 'rgba(74,222,128,0.08)';
}
function pressureLabel(pct) {
    if (pct >= 40)
        return 'Alta';
    if (pct >= 25)
        return 'Moderada';
    return 'Baixa';
}
function buildMonthOptions() {
    const opts = [];
    const now = new Date();
    for (let i = 0; i < 6; i++) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
        const val = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
        const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        opts.push({ value: val, label: label.charAt(0).toUpperCase() + label.slice(1) });
    }
    return opts;
}
function shortMonth(month) {
    try {
        return new Date(month + '-01').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    }
    catch {
        return month;
    }
}
// ---------------------------------------------------------------------------
// Subcomponentes
// ---------------------------------------------------------------------------
/** Barra de pressão com label e valor */
function PressureBar({ label, pct, color, sub, height = 10, }) {
    const clamped = Math.min(100, Math.max(0, pct));
    return (_jsxs("div", { style: { marginBottom: '1rem' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }, children: [_jsxs("div", { children: [_jsx("span", { style: { fontSize: '0.85rem', color: '#e5e7eb' }, children: label }), sub && _jsx("span", { style: { fontSize: '0.75rem', color: '#6b7280', marginLeft: 8 }, children: sub })] }), _jsxs("span", { style: { fontSize: '0.9rem', fontWeight: 700, color }, children: [pct.toFixed(1), "%"] })] }), _jsx("div", { style: { background: '#1e2130', borderRadius: 99, height, overflow: 'hidden' }, children: _jsx("div", { style: {
                        background: color,
                        borderRadius: 99,
                        height: '100%',
                        width: `${clamped}%`,
                        transition: 'width 0.6s ease',
                    } }) })] }));
}
/** Card de fatura individual */
function InvoiceCard({ card, brand, last4, openMinor, totalMinor, paidMinor, purchasesMinor, previousMinor, dueDate, month, }) {
    const isPaid = openMinor <= 0;
    const statusColor = isPaid ? '#4ade80' : '#fbbf24';
    const cardLabel = [brand, last4 ? `••${last4}` : null].filter(Boolean).join(' ') || card || 'Cartão';
    return (_jsxs("div", { style: {
            background: '#0f1117',
            borderRadius: 10,
            padding: '0.85rem 1rem',
            border: `1px solid ${isPaid ? '#1e2130' : '#fbbf2433'}`,
        }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.6rem' }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: '0.88rem', fontWeight: 700, color: '#e5e7eb' }, children: cardLabel }), _jsxs("div", { style: { fontSize: '0.72rem', color: '#6b7280', marginTop: 2 }, children: ["Compet\u00EAncia ", month, dueDate ? ` · Vence ${new Date(dueDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })}` : ''] })] }), _jsx("span", { style: {
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            color: statusColor,
                            background: isPaid ? 'rgba(74,222,128,0.1)' : 'rgba(251,191,36,0.1)',
                            padding: '2px 8px',
                            borderRadius: 99,
                        }, children: isPaid ? 'Pago' : 'Em aberto' })] }), _jsx("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }, children: [
                    { label: 'Fatura anterior', value: previousMinor, color: '#9ca3af' },
                    { label: 'Compras do mês', value: purchasesMinor, color: '#fbbf24' },
                    { label: 'Pago', value: paidMinor, color: '#4ade80' },
                    { label: isPaid ? 'Total' : 'Em aberto', value: isPaid ? totalMinor : openMinor, color: statusColor },
                ].map(m => (_jsxs("div", { children: [_jsx("div", { style: { fontSize: '0.68rem', color: '#6b7280', marginBottom: 2 }, children: m.label }), _jsx("div", { style: { fontSize: '0.85rem', fontWeight: 700, color: m.color }, children: formatBRL(m.value) })] }, m.label))) })] }));
}
// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export function DebtAssessor() {
    const [selectedMonth, setSelectedMonth] = useState(currentMonth());
    const [projectionMonths, setProjectionMonths] = useState(3);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [result, setResult] = useState(null);
    async function loadDebt() {
        setLoading(true);
        setError(null);
        try {
            setResult(await api.assess.debt(selectedMonth, projectionMonths));
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Erro ao avaliar dívidas');
        }
        finally {
            setLoading(false);
        }
    }
    useEffect(() => {
        void loadDebt();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedMonth, projectionMonths]);
    // ---------------------------------------------------------------------------
    // Derivações
    // ---------------------------------------------------------------------------
    const ai = result?.ai;
    const consideredIncome = result?.consideredIncomeMinor ?? result?.incomeMinor ?? 0;
    // Pressão total = debtPressurePct (campo real da API)
    const totalPressurePct = result?.debtPressurePct ?? 0;
    // Pressão só da dívida em aberto = openDebtMinor / consideredIncome * 100
    // (campo separado calculado aqui, pois a API não retorna openDebtPressurePct)
    const openPressurePct = consideredIncome > 0
        ? Math.round((result?.openDebtMinor ?? 0) / consideredIncome * 100 * 10) / 10
        : 0;
    // Pressão de parcelas futuras = futureInstallmentsMinor / consideredIncome * 100
    const futurePressurePct = consideredIncome > 0
        ? Math.round((result?.futureInstallmentsMinor ?? 0) / consideredIncome * 100 * 10) / 10
        : 0;
    const totalColor = pressureColor(totalPressurePct);
    const effectiveById = new Map((result?.invoicesSummary ?? []).map(inv => [inv.id, inv]));
    const currentMonthInvoices = (result?.cashflowInvoicesSummary ?? [])
        .filter(inv => inv.month === selectedMonth)
        .map(inv => ({
        ...inv,
        effective: effectiveById.get(inv.id),
    }));
    const futureByMonth = (result?.futureInstallments ?? []).reduce((acc, inst) => {
        const m = inst.month;
        if (!acc[m])
            acc[m] = [];
        acc[m].push(inst);
        return acc;
    }, {});
    const futureMonths = Object.keys(futureByMonth).sort();
    // Evolução mensal
    const debtTrendSeries = result?.debtTrendSeries ?? [];
    const visibleSeries = debtTrendSeries.filter(row => (row.fixedExpensesMinor ?? 0) !== 0 ||
        (row.cardPurchasesMinor ?? 0) !== 0 ||
        (row.statementOutflowMinor ?? 0) !== 0);
    const trendMax = Math.max(1, ...visibleSeries.flatMap(row => [
        Math.abs((row.fixedExpensesMinor ?? 0) + (row.statementOutflowMinor ?? 0)),
        Math.abs(row.cardPurchasesMinor ?? 0),
        Math.abs(row.balanceMinor ?? 0),
    ]));
    const selectedTrendRow = debtTrendSeries.find(r => r.month === selectedMonth) ?? debtTrendSeries[debtTrendSeries.length - 1] ?? null;
    const selectedNetBalanceMinor = selectedTrendRow?.balanceMinor ?? result?.netBalanceMinor ?? 0;
    const balanceColor = selectedNetBalanceMinor >= 0 ? '#4ade80' : '#f87171';
    const hasData = result && (result.openDebtMinor > 0 || result.invoiceCount > 0 || consideredIncome > 0);
    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------
    return (_jsxs("div", { style: { maxWidth: 860, margin: '0 auto' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }, children: [_jsx(SectionTitle, { style: { margin: 0 }, children: "D\u00EDvidas" }), _jsxs("div", { style: { display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }, children: [_jsx("select", { value: selectedMonth, onChange: e => setSelectedMonth(e.target.value), style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem 0.85rem', color: '#e5e7eb', fontSize: '0.9rem' }, children: buildMonthOptions().map(o => _jsx("option", { value: o.value, children: o.label }, o.value)) }), _jsx("select", { value: String(projectionMonths), onChange: e => setProjectionMonths(Number(e.target.value)), style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem 0.85rem', color: '#e5e7eb', fontSize: '0.9rem' }, children: [1, 2, 3, 4, 5, 6].map(n => (_jsxs("option", { value: String(n), children: [n, " ", n === 1 ? 'mês' : 'meses', " \u00E0 frente"] }, n))) })] })] }), error && _jsx(Alert, { variant: "error", style: { marginBottom: '1rem' }, children: error }), loading && (_jsxs("div", { style: { textAlign: 'center', padding: '4rem' }, children: [_jsx(Spinner, {}), _jsx("p", { style: { color: '#9ca3af', marginTop: '1rem', fontSize: '0.9rem' }, children: "Analisando d\u00EDvidas e faturas..." })] })), result && !loading && !hasData && (_jsxs(Card, { style: { textAlign: 'center', padding: '3rem' }, children: [_jsx("div", { style: { fontSize: '2.5rem', marginBottom: '1rem' }, children: "\uD83D\uDCB3" }), _jsx("div", { style: { fontSize: '1rem', fontWeight: 700, color: '#e5e7eb', marginBottom: '0.5rem' }, children: "Nenhuma d\u00EDvida ou fatura encontrada" }), _jsx("p", { style: { color: '#9ca3af', fontSize: '0.88rem', maxWidth: 360, margin: '0 auto 1.5rem' }, children: "Importe uma fatura de cart\u00E3o para ver o avaliador de d\u00EDvidas em ac\u00E7\u00E3o." }), _jsx(Button, { variant: "primary", onClick: () => window.location.href = '/invoices', children: "Importar fatura" })] })), result && !loading && hasData && (_jsxs(_Fragment, { children: [_jsxs(Card, { style: {
                            marginBottom: '1.5rem',
                            background: pressureBg(totalPressurePct),
                            border: `1px solid ${totalColor}33`,
                        }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '0.75rem' }, children: [_jsxs("span", { style: { fontSize: '2rem', fontWeight: 900, color: totalColor }, children: [totalPressurePct.toFixed(0), "%"] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: '0.78rem', color: '#9ca3af' }, children: "da renda comprometida com d\u00EDvidas" }), _jsxs(Badge, { variant: riskVariant(ai?.delayRisk ?? (totalPressurePct >= 40 ? 'alto' : totalPressurePct >= 25 ? 'moderado' : 'baixo')), children: ["Press\u00E3o ", pressureLabel(totalPressurePct)] })] })] }), _jsxs("div", { style: { textAlign: 'right' }, children: [_jsx("div", { style: { fontSize: '0.78rem', color: '#9ca3af', marginBottom: 2 }, children: "Saldo real do m\u00EAs" }), _jsx("div", { style: { fontSize: '1.5rem', fontWeight: 800, color: balanceColor }, children: formatBRL(Math.abs(selectedNetBalanceMinor)) }), _jsx("div", { style: { fontSize: '0.75rem', color: balanceColor }, children: selectedNetBalanceMinor >= 0 ? '✓ Positivo' : '✗ Negativo' })] })] }), _jsx(PressureBar, { label: "Press\u00E3o total sobre a renda", pct: totalPressurePct, color: totalColor, sub: `${formatBRL(result.openDebtMinor + result.futureInstallmentsMinor)} em dívidas`, height: 10 }), _jsx(PressureBar, { label: "Somente d\u00EDvida em aberto", pct: openPressurePct, color: pressureColor(openPressurePct), sub: formatBRL(result.openDebtMinor), height: 8 }), _jsx(PressureBar, { label: "Parcelas futuras previstas", pct: futurePressurePct, color: pressureColor(futurePressurePct), sub: formatBRL(result.futureInstallmentsMinor), height: 6 })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }, children: [_jsxs(Card, { children: [_jsx("div", { style: { fontSize: '0.75rem', color: '#9ca3af', marginBottom: 4 }, children: "D\u00EDvida em aberto" }), _jsx("div", { style: { fontSize: '1.3rem', fontWeight: 800, color: result.openDebtMinor > 0 ? '#fbbf24' : '#4ade80' }, children: formatBRL(result.openDebtMinor) }), _jsxs("div", { style: { fontSize: '0.72rem', color: '#6b7280', marginTop: 4 }, children: [result.openInvoiceCount, " fatura(s) em aberto"] })] }), _jsxs(Card, { children: [_jsx("div", { style: { fontSize: '0.75rem', color: '#9ca3af', marginBottom: 4 }, children: "Parcelas futuras" }), _jsx("div", { style: { fontSize: '1.3rem', fontWeight: 800, color: result.futureInstallmentsMinor > 0 ? '#fb923c' : '#4ade80' }, children: formatBRL(result.futureInstallmentsMinor) }), _jsxs("div", { style: { fontSize: '0.72rem', color: '#6b7280', marginTop: 4 }, children: ["pr\u00F3ximos ", projectionMonths, " ", projectionMonths === 1 ? 'mês' : 'meses'] })] }), _jsxs(Card, { children: [_jsx("div", { style: { fontSize: '0.75rem', color: '#9ca3af', marginBottom: 4 }, children: "Pago este m\u00EAs" }), _jsx("div", { style: { fontSize: '1.3rem', fontWeight: 800, color: '#4ade80' }, children: formatBRL(result.paidThisMonthMinor) }), _jsxs("div", { style: { fontSize: '0.72rem', color: '#6b7280', marginTop: 4 }, children: [result.invoiceCount, " fatura(s) no total"] })] })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }, children: [_jsxs(Card, { children: [_jsx("div", { style: { fontSize: '0.78rem', color: '#9ca3af', marginBottom: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }, children: "Pontualidade hist\u00F3rica" }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '1rem' }, children: [_jsxs("div", { style: { position: 'relative', width: 72, height: 72, flexShrink: 0 }, children: [_jsxs("svg", { width: "72", height: "72", viewBox: "0 0 72 72", children: [_jsx("circle", { cx: "36", cy: "36", r: "28", fill: "none", stroke: "#1e2130", strokeWidth: "8" }), _jsx("circle", { cx: "36", cy: "36", r: "28", fill: "none", stroke: result.punctualityPct >= 80 ? '#4ade80' : result.punctualityPct >= 60 ? '#fbbf24' : '#f87171', strokeWidth: "8", strokeLinecap: "round", strokeDasharray: `${(result.punctualityPct / 100) * 175.9} 175.9`, transform: "rotate(-90 36 36)" })] }), _jsx("div", { style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }, children: _jsxs("span", { style: { fontSize: '0.85rem', fontWeight: 800, color: '#e5e7eb' }, children: [result.punctualityPct, "%"] }) })] }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: '1rem', fontWeight: 700, color: result.punctualityPct >= 80 ? '#4ade80' : result.punctualityPct >= 60 ? '#fbbf24' : '#f87171' }, children: result.punctualityPct >= 80 ? 'Ótima' : result.punctualityPct >= 60 ? 'Regular' : 'Baixa' }), _jsx("div", { style: { fontSize: '0.75rem', color: '#6b7280', marginTop: 2 }, children: "faturas pagas em dia" })] })] })] }), _jsxs(Card, { children: [_jsx("div", { style: { fontSize: '0.78rem', color: '#9ca3af', marginBottom: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }, children: "Risco de atraso" }), _jsx("div", { style: { marginBottom: '0.5rem' }, children: _jsx(Badge, { variant: riskVariant(ai?.delayRisk), children: ai?.delayRisk
                                                ? ai.delayRisk.charAt(0).toUpperCase() + ai.delayRisk.slice(1)
                                                : 'Não avaliado' }) }), ai?.delayRiskReason
                                        ? _jsx("p", { style: { fontSize: '0.82rem', color: '#9ca3af', lineHeight: 1.5, margin: 0 }, children: ai.delayRiskReason })
                                        : _jsx("p", { style: { fontSize: '0.82rem', color: '#6b7280', margin: 0 }, children: "Clique em \"An\u00E1lise com IA\" para ver a avalia\u00E7\u00E3o de risco." })] })] }), ai?.diagnosis && (_jsxs(Card, { style: { marginBottom: '1.5rem', borderLeft: '3px solid #6366f1' }, children: [_jsx("div", { style: { fontSize: '0.78rem', color: '#6366f1', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }, children: "Diagn\u00F3stico da IA" }), _jsx("p", { style: { color: '#e5e7eb', fontSize: '0.9rem', lineHeight: 1.65, margin: 0 }, children: ai.diagnosis })] })), ai?.alerts && ai.alerts.length > 0 && (_jsxs(Card, { style: { marginBottom: '1.5rem', borderLeft: '3px solid #fbbf24' }, children: [_jsx("div", { style: { fontSize: '0.78rem', color: '#fbbf24', marginBottom: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }, children: "Aten\u00E7\u00E3o" }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: ai.alerts.map((a, i) => (_jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.88rem', color: '#e5e7eb' }, children: [_jsx("span", { style: { color: '#fbbf24', flexShrink: 0, marginTop: 1 }, children: "\u26A0" }), a] }, i))) })] })), currentMonthInvoices.length > 0 && (_jsxs(Card, { style: { marginBottom: '1.5rem' }, children: [_jsxs("div", { style: { fontSize: '0.88rem', color: '#e5e7eb', fontWeight: 700, marginBottom: '1rem' }, children: ["Faturas de ", selectedMonth] }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.75rem' }, children: currentMonthInvoices.map((inv, i) => (_jsx(InvoiceCard, { card: inv.card, brand: inv.brand, last4: inv.last4, openMinor: inv.effective?.openMinor ?? inv.openMinor ?? 0, totalMinor: inv.totalMinor ?? 0, paidMinor: inv.paidMinor ?? 0, purchasesMinor: inv.purchasesMinor ?? 0, previousMinor: inv.previousMinor ?? 0, dueDate: inv.dueDate, month: inv.month }, `${inv.id}-${i}`))) })] })), futureMonths.length > 0 && (_jsxs(Card, { style: { marginBottom: '1.5rem' }, children: [_jsxs("div", { style: { fontSize: '0.88rem', color: '#e5e7eb', fontWeight: 700, marginBottom: '1rem' }, children: ["Parcelas futuras \u2014 pr\u00F3ximos ", projectionMonths, " ", projectionMonths === 1 ? 'mês' : 'meses'] }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.75rem' }, children: futureMonths.map(month => {
                                    const items = futureByMonth[month] ?? [];
                                    const total = items.reduce((s, it) => s + it.amountMinor, 0);
                                    return (_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }, children: [_jsx("span", { style: { fontSize: '0.82rem', fontWeight: 700, color: '#9ca3af' }, children: shortMonth(month) }), _jsx("span", { style: { fontSize: '0.88rem', fontWeight: 700, color: '#fb923c' }, children: formatBRL(total) })] }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 4 }, children: items.map((it, i) => (_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#9ca3af' }, children: [_jsxs("span", { children: [it.description ?? 'Parcela', it.installment ? ` (${it.installment})` : ''] }), _jsx("span", { style: { color: '#e5e7eb' }, children: formatBRL(it.amountMinor) })] }, i))) }), _jsx("div", { style: { height: 1, background: '#1e2130', marginTop: 8 } })] }, month));
                                }) })] })), visibleSeries.length > 0 && (_jsxs(Card, { style: { marginBottom: '1.5rem' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: '0.88rem', color: '#e5e7eb', fontWeight: 700 }, children: "Evolu\u00E7\u00E3o mensal" }), _jsx("div", { style: { fontSize: '0.75rem', color: '#9ca3af' }, children: "Despesas, compras no cart\u00E3o e saldo por m\u00EAs" })] }), _jsxs("div", { style: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.75rem', color: '#9ca3af' }, children: [_jsxs("span", { style: { display: 'flex', alignItems: 'center', gap: 4 }, children: [_jsx("span", { style: { width: 10, height: 10, borderRadius: 99, background: '#f87171', display: 'inline-block' } }), " Gastos"] }), _jsxs("span", { style: { display: 'flex', alignItems: 'center', gap: 4 }, children: [_jsx("span", { style: { width: 10, height: 10, borderRadius: 99, background: '#fbbf24', display: 'inline-block' } }), " Cart\u00E3o"] }), _jsxs("span", { style: { display: 'flex', alignItems: 'center', gap: 4 }, children: [_jsx("span", { style: { width: 10, height: 10, borderRadius: 99, background: '#4ade80', display: 'inline-block' } }), " Saldo"] })] })] }), _jsx("div", { style: {
                                    display: 'grid',
                                    gridTemplateColumns: `repeat(${Math.max(1, visibleSeries.length)}, minmax(60px, 1fr))`,
                                    gap: 12,
                                    alignItems: 'end',
                                    minHeight: 240,
                                }, children: visibleSeries.map(row => {
                                    const fixedAndStatement = (row.fixedExpensesMinor ?? 0) + (row.statementOutflowMinor ?? 0);
                                    const fixedH = Math.max(6, Math.round((Math.abs(fixedAndStatement) / trendMax) * 160));
                                    const cardH = Math.max(6, Math.round((Math.abs(row.cardPurchasesMinor) / trendMax) * 160));
                                    const balMinor = row.balanceMinor ?? 0;
                                    const balH = Math.max(6, Math.round((Math.abs(balMinor) / trendMax) * 160));
                                    const balColor = balMinor >= 0 ? '#4ade80' : '#f87171';
                                    const isSelected = row.month === selectedMonth;
                                    return (_jsxs("div", { style: {
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            gap: 6,
                                            opacity: isSelected ? 1 : 0.65,
                                        }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'flex-end', gap: 5, height: 180 }, children: [_jsx("div", { title: `Gastos ${formatBRL(fixedAndStatement)}`, style: { width: 14, height: fixedH, borderRadius: 99, background: '#f87171' } }), _jsx("div", { title: `Cartão ${row.cardPurchasesBRL}`, style: { width: 14, height: cardH, borderRadius: 99, background: '#fbbf24' } }), _jsx("div", { title: `Saldo ${row.balanceBRL}`, style: { width: 14, height: balH, borderRadius: 99, background: balColor } })] }), _jsxs("div", { style: { textAlign: 'center' }, children: [_jsx("div", { style: { fontSize: '0.72rem', color: isSelected ? '#e5e7eb' : '#6b7280', fontWeight: isSelected ? 700 : 400 }, children: shortMonth(row.month) }), _jsx("div", { style: { fontSize: '0.68rem', color: balColor }, children: row.balanceBRL })] })] }, row.month));
                                }) })] })), ai?.recommendations && ai.recommendations.length > 0 && (_jsxs(Card, { style: { marginBottom: '1.5rem', borderLeft: '3px solid #4ade80' }, children: [_jsx("div", { style: { fontSize: '0.78rem', color: '#4ade80', marginBottom: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }, children: "O que fazer" }), _jsx("ol", { style: { margin: 0, padding: '0 0 0 1.2rem', display: 'flex', flexDirection: 'column', gap: 10 }, children: ai.recommendations.map((r, i) => (_jsx("li", { style: { fontSize: '0.88rem', color: '#e5e7eb', lineHeight: 1.55 }, children: r }, i))) })] })), !ai?.diagnosis && (_jsxs("div", { style: { textAlign: 'center', marginTop: '0.5rem' }, children: [_jsx("p", { style: { color: '#6b7280', fontSize: '0.85rem', marginBottom: '0.75rem' }, children: "Quer diagn\u00F3stico detalhado com risco de atraso e recomenda\u00E7\u00F5es?" }), _jsx(Button, { onClick: loadDebt, disabled: loading, variant: "primary", children: "\uD83E\uDD16 An\u00E1lise com IA" })] }))] }))] }));
}

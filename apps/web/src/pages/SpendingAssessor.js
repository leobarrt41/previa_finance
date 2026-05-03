import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * SpendingAssessor.tsx — Avaliador de Gastos por Categoria
 * API: POST /api/assess/spending
 * Pre-seleccao: /assess/spending?categoryId=xxx
 */
import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, } from 'recharts';
import { api, formatBRL, currentMonth, } from '../services/api';
import { Card, Badge, Button, Alert, Spinner, SectionTitle } from '../components/ui';
function riskVariant(level) {
    if (level === 'baixo')
        return 'green';
    if (level === 'moderado')
        return 'yellow';
    if (level === 'alto' || level === 'critico')
        return 'red';
    return 'gray';
}
function trendIcon(trend) {
    if (trend === 'crescente')
        return '📈';
    if (trend === 'decrescente')
        return '📉';
    return '➡️';
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
function findNodeById(nodes, id) {
    for (const node of nodes) {
        if (node.id === id)
            return node;
        const found = findNodeById(node.children ?? [], id);
        if (found)
            return found;
    }
    return null;
}
function findRootNodeById(nodes, id) {
    for (const node of nodes) {
        if (node.id === id)
            return node;
        const found = findNodeById(node.children ?? [], id);
        if (found)
            return node;
    }
    return null;
}
function sourceLabel(source) {
    if (source === 'statement')
        return 'Extrato';
    if (source === 'card_invoice')
        return 'Fatura';
    return 'Lançamento';
}
function colorForIndex(index) {
    const palette = ['#6366f1', '#8b5cf6', '#06b6d4', '#14b8a6', '#f59e0b', '#f97316', '#ec4899', '#22c55e'];
    return palette[index % palette.length];
}
function buildDonutBackground(slices, fallbackColor = '#1e2130') {
    const totalMinor = slices.reduce((sum, slice) => sum + Math.max(0, slice.amountMinor), 0);
    if (totalMinor <= 0)
        return `conic-gradient(${fallbackColor} 0 100%)`;
    let cursor = 0;
    const parts = slices.map((slice) => {
        const pct = (Math.max(0, slice.amountMinor) / totalMinor) * 100;
        const start = cursor;
        cursor += pct;
        return `${slice.color} ${start.toFixed(4)}% ${cursor.toFixed(4)}%`;
    });
    return `conic-gradient(${parts.join(', ')})`;
}
export function SpendingAssessor() {
    const [searchParams] = useSearchParams();
    const preselectedId = searchParams.get('categoryId') ?? '';
    const [categories, setCategories] = useState([]);
    const [selectedCategory, setSelectedCategory] = useState(preselectedId);
    const [selectedSubcategoryIds, setSelectedSubcategoryIds] = useState([]);
    const [selectedMonth, setSelectedMonth] = useState(currentMonth());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [result, setResult] = useState(null);
    const [overviewResult, setOverviewResult] = useState(null);
    useEffect(() => {
        api.categories.tree()
            .then((tree) => setCategories(tree.filter((c) => c.type === 'expense')))
            .catch(() => { });
    }, []);
    useEffect(() => {
        if (preselectedId) {
            const rootNode = findRootNodeById(categories, preselectedId);
            setSelectedCategory(rootNode?.id ?? preselectedId);
        }
    }, [categories, preselectedId]);
    useEffect(() => {
        let cancelled = false;
        setError(null);
        api.assess.spendingOverview(selectedMonth)
            .then((data) => {
            if (!cancelled)
                setOverviewResult(data);
        })
            .catch((e) => {
            if (!cancelled) {
                setError(e instanceof Error ? e.message : 'Erro ao carregar o resumo do mês');
            }
        });
        return () => { cancelled = true; };
    }, [selectedMonth]);
    const categoryOptions = useMemo(() => categories.filter((c) => c.type === 'expense' && !c.parentId), [categories]);
    const selectedCategoryNode = useMemo(() => (selectedCategory ? findNodeById(categories, selectedCategory) : null), [categories, selectedCategory]);
    const selectableSubcategories = useMemo(() => (selectedCategoryNode ? (selectedCategoryNode.children ?? []).filter((node) => node.type === 'expense') : []), [selectedCategoryNode]);
    useEffect(() => {
        if (!selectedCategoryNode) {
            setSelectedSubcategoryIds([]);
            setResult(null);
            return;
        }
        setSelectedSubcategoryIds(selectableSubcategories.map((node) => node.id));
    }, [selectedCategoryNode, selectableSubcategories]);
    const selectedSubcategorySet = useMemo(() => new Set(selectedSubcategoryIds), [selectedSubcategoryIds]);
    const previewSubcategoryIds = useMemo(() => {
        if (!selectedCategoryNode)
            return [];
        if (selectedSubcategoryIds.length === 0)
            return [];
        const selectableIds = new Set(selectableSubcategories.map((node) => node.id));
        const validSelectedIds = selectedSubcategoryIds.filter((id) => selectableIds.has(id));
        return validSelectedIds.length > 0
            ? validSelectedIds
            : selectableSubcategories.map((node) => node.id);
    }, [selectedCategoryNode, selectedSubcategoryIds, selectableSubcategories]);
    useEffect(() => {
        if (!selectedCategoryNode)
            return;
        let cancelled = false;
        setError(null);
        api.assess.spendingPreview(selectedMonth, selectedCategoryNode.id, previewSubcategoryIds)
            .then((data) => {
            if (!cancelled)
                setResult(data);
        })
            .catch((e) => {
            if (!cancelled) {
                setError(e instanceof Error ? e.message : 'Erro ao carregar a análise da categoria');
            }
        });
        return () => { cancelled = true; };
    }, [selectedCategoryNode, selectedMonth, previewSubcategoryIds]);
    async function runAnalyze(catId) {
        const cat = catId ?? selectedCategory;
        if (!cat)
            return;
        setLoading(true);
        setError(null);
        try {
            setResult(await api.assess.spending(selectedMonth, cat, previewSubcategoryIds));
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Erro ao avaliar gastos');
        }
        finally {
            setLoading(false);
        }
    }
    const ai = result?.ai;
    const overviewCategoryBreakdown = overviewResult?.categoryBreakdown ?? [];
    const overviewDisplayItems = useMemo(() => overviewCategoryBreakdown.map((item, index) => ({
        ...item,
        color: colorForIndex(index),
    })), [overviewCategoryBreakdown]);
    const overviewTotalMinor = overviewDisplayItems.reduce((sum, item) => sum + item.amountMinor, 0);
    const overviewDonutBackground = buildDonutBackground(overviewDisplayItems.map((item) => ({ amountMinor: item.amountMinor, color: item.color })));
    const subcategoryTotals = useMemo(() => {
        const map = new Map();
        for (const item of result?.subcategoryBreakdown ?? []) {
            map.set(item.categoryId, item.amountMinor);
        }
        return map;
    }, [result?.subcategoryBreakdown]);
    const subcategoryPercentages = useMemo(() => {
        const map = new Map();
        for (const item of result?.subcategoryBreakdown ?? []) {
            map.set(item.categoryId, {
                pctWithinCategory: item.pctWithinCategory,
                pctOfTotal: item.pctOfTotal,
            });
        }
        return map;
    }, [result?.subcategoryBreakdown]);
    const subcategoryDisplayItems = useMemo(() => selectableSubcategories.map((node, index) => {
        const amountMinor = subcategoryTotals.get(node.id) ?? 0;
        const checked = selectedSubcategorySet.has(node.id);
        const pct = subcategoryPercentages.get(node.id);
        return {
            node,
            index,
            amountMinor,
            checked,
            color: colorForIndex(index),
            pctWithinCategory: pct?.pctWithinCategory ?? 0,
            pctOfTotal: pct?.pctOfTotal ?? 0,
        };
    }), [selectableSubcategories, subcategoryTotals, subcategoryPercentages, selectedSubcategorySet]);
    const subcategoryTotalMinor = subcategoryDisplayItems.reduce((sum, item) => sum + item.amountMinor, 0);
    const selectedSubcategoryMinor = subcategoryDisplayItems
        .filter((item) => item.checked)
        .reduce((sum, item) => sum + item.amountMinor, 0);
    const subcategoryDonutBackground = buildDonutBackground(subcategoryDisplayItems.map((item) => ({
        amountMinor: item.amountMinor,
        color: item.checked ? item.color : '#334155',
    })));
    const chartData = result?.monthlySummary.map(m => ({
        month: m.month,
        total: Math.round(m.totalMinor / 100),
        statement: Math.round((m.statementMinor ?? 0) / 100),
        invoice: Math.round((m.invoiceMinor ?? 0) / 100),
    })) ?? [];
    const impactPct = result?.impactOnIncomePct ?? 0;
    const impactColor = impactPct >= 30 ? '#f87171' : impactPct >= 15 ? '#fbbf24' : '#4ade80';
    const sourceSummary = result?.sourceSummary;
    return (_jsxs("div", { style: { maxWidth: 900, margin: '0 auto' }, children: [_jsx(SectionTitle, { children: "Avaliador de Gastos" }), _jsx("p", { style: { color: '#9ca3af', marginBottom: '1.5rem', fontSize: '0.9rem' }, children: "Analise o gasto de uma categoria a partir do extrato e das faturas do cart\u00E3o: hist\u00F3rico, tend\u00EAncia, impacto na renda e recomenda\u00E7\u00F5es da IA." }), _jsxs(Card, { style: { marginBottom: '1.5rem', paddingTop: '1.25rem', paddingBottom: '1.25rem' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: '0.85rem', color: '#9ca3af', fontWeight: 600 }, children: "Disco superior: categorias raiz no m\u00EAs" }), _jsx("div", { style: { fontSize: '0.8rem', color: '#6b7280', marginTop: 4 }, children: "Aparece automaticamente ao abrir a tela e distribui o total do m\u00EAs apenas entre categorias raiz." })] }), _jsxs("div", { style: { color: '#6b7280', fontSize: '0.82rem', alignSelf: 'center' }, children: ["Total do m\u00EAs: ", formatBRL(overviewTotalMinor)] })] }), _jsxs("div", { style: { display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'stretch' }, children: [_jsx("div", { style: { flex: '1 1 320px', minWidth: 280 }, children: _jsxs("div", { style: {
                                        position: 'relative',
                                        width: '100%',
                                        maxWidth: 420,
                                        margin: '0 auto',
                                        aspectRatio: '1 / 1',
                                        borderRadius: '50%',
                                        background: '#0f1320',
                                        border: '1px solid #2a2f45',
                                        boxShadow: '0 0 0 1px rgba(99, 102, 241, 0.08) inset',
                                        overflow: 'hidden',
                                    }, children: [_jsx("div", { style: {
                                                position: 'absolute',
                                                inset: '10%',
                                                borderRadius: '50%',
                                                background: overviewDonutBackground,
                                                opacity: 1,
                                            } }), _jsxs("div", { style: {
                                                position: 'absolute',
                                                inset: '22%',
                                                borderRadius: '50%',
                                                background: '#141624',
                                                border: '1px solid #2a2f45',
                                                boxShadow: '0 0 0 10px rgba(99, 102, 241, 0.04) inset',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                textAlign: 'center',
                                                padding: '1rem',
                                            }, children: [_jsx("div", { style: { fontSize: '0.75rem', color: '#9ca3af' }, children: "Total categorizado" }), _jsxs("div", { style: { fontSize: '1rem', fontWeight: 700, color: '#e5e7eb', marginTop: 4 }, children: [overviewDisplayItems.length, " categorias"] }), _jsx("div", { style: { fontSize: '0.85rem', color: '#cbd5e1', marginTop: 8 }, children: formatBRL(overviewTotalMinor) })] })] }) }), _jsx("div", { style: { flex: '1 1 340px', minWidth: 280 }, children: _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 10 }, children: overviewDisplayItems.map((item) => {
                                        const pctOfTotal = overviewTotalMinor > 0 ? (item.amountMinor / overviewTotalMinor) * 100 : 0;
                                        return (_jsxs("div", { style: {
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                gap: '1rem',
                                                alignItems: 'center',
                                                padding: '0.8rem 0.9rem',
                                                borderRadius: 14,
                                                border: `1px solid ${item.color}`,
                                                background: 'rgba(20, 22, 36, 0.85)',
                                            }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 10 }, children: [_jsx("span", { style: {
                                                                width: 14,
                                                                height: 14,
                                                                borderRadius: '50%',
                                                                background: item.color,
                                                                flexShrink: 0,
                                                            } }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: '0.88rem', fontWeight: 700 }, children: item.label }), _jsxs("div", { style: { fontSize: '0.74rem', color: '#64748b' }, children: [pctOfTotal.toFixed(1), "% do total do m\u00EAs"] })] })] }), _jsxs("div", { style: { textAlign: 'right' }, children: [_jsx("div", { style: { fontSize: '0.88rem', fontWeight: 700, color: item.color }, children: formatBRL(item.amountMinor) }), _jsxs("div", { style: { fontSize: '0.76rem', color: '#94a3b8' }, children: [pctOfTotal.toFixed(1), "%"] })] })] }, item.categoryId));
                                    }) }) })] })] }), _jsx(Card, { style: { marginBottom: '1.5rem' }, children: _jsxs("div", { style: { display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }, children: [_jsxs("div", { style: { flex: 2, minWidth: 200 }, children: [_jsx("label", { style: { display: 'block', fontSize: '0.8rem', color: '#9ca3af', marginBottom: 4 }, children: "Categoria" }), _jsxs("select", { value: selectedCategory, onChange: (e) => {
                                        const nextCategory = e.target.value;
                                        const nextNode = findRootNodeById(categories, nextCategory);
                                        setSelectedCategory(nextNode?.id ?? nextCategory);
                                        setSelectedSubcategoryIds(nextNode ? (nextNode.children ?? []).filter((node) => node.type === 'expense').map((node) => node.id) : []);
                                    }, style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.55rem 0.85rem', color: '#e5e7eb', fontSize: '0.9rem', width: '100%' }, children: [_jsx("option", { value: "", children: "Selecione uma categoria..." }), categoryOptions.map((c) => (_jsx("option", { value: c.id, children: c.name }, c.id)))] })] }), _jsxs("div", { style: { flex: 1, minWidth: 160 }, children: [_jsx("label", { style: { display: 'block', fontSize: '0.8rem', color: '#9ca3af', marginBottom: 4 }, children: "Mes" }), _jsx("select", { value: selectedMonth, onChange: e => setSelectedMonth(e.target.value), style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.55rem 0.85rem', color: '#e5e7eb', fontSize: '0.9rem', width: '100%' }, children: buildMonthOptions().map(o => _jsx("option", { value: o.value, children: o.label }, o.value)) })] }), _jsx(Button, { onClick: () => runAnalyze(), disabled: loading || !selectedCategory, variant: "primary", children: loading ? 'Analisando...' : '🤖 Avaliar' })] }) }), selectedCategoryNode && selectableSubcategories.length > 1 && (_jsxs(Card, { style: { marginBottom: '1.5rem', paddingTop: '1.25rem', paddingBottom: '1.25rem' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: '0.85rem', color: '#9ca3af', fontWeight: 600 }, children: "Disco inferior: subcategorias da categoria raiz" }), _jsx("div", { style: { fontSize: '0.8rem', color: '#6b7280', marginTop: 4 }, children: "Come\u00E7a com todas marcadas. Desmarque as que n\u00E3o devem entrar na an\u00E1lise da IA." })] }), _jsxs("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: [_jsx(Button, { variant: "secondary", onClick: () => setSelectedSubcategoryIds(selectableSubcategories.map((node) => node.id)), children: "Marcar todas" }), _jsx(Button, { variant: "secondary", onClick: () => setSelectedSubcategoryIds([]), children: "Limpar" })] })] }), _jsxs("div", { style: { display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'stretch' }, children: [_jsx("div", { style: { flex: '1 1 320px', minWidth: 280 }, children: _jsxs("div", { style: {
                                        position: 'relative',
                                        width: '100%',
                                        maxWidth: 420,
                                        margin: '0 auto',
                                        aspectRatio: '1 / 1',
                                        borderRadius: '50%',
                                        background: '#0f1320',
                                        border: '1px solid #2a2f45',
                                        boxShadow: '0 0 0 1px rgba(99, 102, 241, 0.08) inset',
                                        overflow: 'hidden',
                                    }, children: [_jsx("div", { style: {
                                                position: 'absolute',
                                                inset: '10%',
                                                borderRadius: '50%',
                                                background: subcategoryDonutBackground,
                                                opacity: 1,
                                            } }), _jsxs("div", { style: {
                                                position: 'absolute',
                                                inset: '22%',
                                                borderRadius: '50%',
                                                background: '#141624',
                                                border: '1px solid #2a2f45',
                                                boxShadow: '0 0 0 10px rgba(99, 102, 241, 0.04) inset',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                textAlign: 'center',
                                                padding: '1rem',
                                            }, children: [_jsx("div", { style: { fontSize: '0.75rem', color: '#9ca3af' }, children: "Categoria selecionada" }), _jsx("div", { style: { fontSize: '1rem', fontWeight: 700, color: '#e5e7eb', marginTop: 4 }, children: selectedCategoryNode.name }), _jsxs("div", { style: { fontSize: '0.85rem', color: '#cbd5e1', marginTop: 8 }, children: [selectedSubcategoryIds.length, " de ", selectableSubcategories.length, " subcategorias"] }), _jsxs("div", { style: { fontSize: '0.82rem', color: '#93c5fd', marginTop: 8, fontWeight: 700 }, children: [formatBRL(selectedSubcategoryMinor), " selecionados"] }), _jsx("div", { style: { fontSize: '0.72rem', color: '#9ca3af', marginTop: 6, lineHeight: 1.5 }, children: selectedSubcategoryIds.length > 0 && subcategoryTotalMinor > 0
                                                        ? `${((selectedSubcategoryMinor / subcategoryTotalMinor) * 100).toFixed(1)}% da categoria filtrada`
                                                        : 'O gasto da categoria é recalculado conforme os itens marcados.' })] })] }) }), _jsx("div", { style: { flex: '1 1 340px', minWidth: 280 }, children: _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 10 }, children: subcategoryDisplayItems.map((item) => {
                                        const pctInCategory = item.pctWithinCategory > 0
                                            ? item.pctWithinCategory
                                            : item.checked && selectedSubcategoryMinor > 0
                                                ? (item.amountMinor / selectedSubcategoryMinor) * 100
                                                : 0;
                                        const pctOfTotal = item.pctOfTotal > 0
                                            ? item.pctOfTotal
                                            : overviewTotalMinor > 0
                                                ? (item.amountMinor / overviewTotalMinor) * 100
                                                : 0;
                                        return (_jsx("button", { type: "button", onClick: () => setSelectedSubcategoryIds((prev) => (prev.includes(item.node.id)
                                                ? prev.filter((id) => id !== item.node.id)
                                                : [...prev, item.node.id])), style: {
                                                appearance: 'none',
                                                border: `1px solid ${item.checked ? item.color : '#2a2f45'}`,
                                                background: item.checked ? 'rgba(99, 102, 241, 0.10)' : 'rgba(20, 22, 36, 0.85)',
                                                color: item.checked ? '#e0e7ff' : '#94a3b8',
                                                borderRadius: 14,
                                                padding: '0.8rem 0.9rem',
                                                cursor: 'pointer',
                                                textAlign: 'left',
                                            }, children: _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 10 }, children: [_jsx("span", { style: {
                                                                    width: 14,
                                                                    height: 14,
                                                                    borderRadius: '50%',
                                                                    background: item.checked ? item.color : 'transparent',
                                                                    border: `2px solid ${item.checked ? item.color : '#475569'}`,
                                                                    flexShrink: 0,
                                                                } }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: '0.88rem', fontWeight: 700 }, children: item.node.name }), _jsx("div", { style: { fontSize: '0.74rem', color: '#64748b' }, children: item.checked ? 'Ativa na análise' : 'Desligada' })] })] }), _jsxs("div", { style: { textAlign: 'right' }, children: [_jsx("div", { style: { fontSize: '0.88rem', fontWeight: 700, color: item.checked ? item.color : '#64748b' }, children: formatBRL(item.amountMinor) }), _jsx("div", { style: { fontSize: '0.76rem', color: '#94a3b8' }, children: `${pctInCategory.toFixed(1)}% cat · ${pctOfTotal.toFixed(1)}% total` })] })] }) }, item.node.id));
                                    }) }) })] })] })), selectedCategoryNode && selectableSubcategories.length <= 1 && (_jsxs(Card, { style: { marginBottom: '1.5rem' }, children: [_jsx("div", { style: { fontSize: '0.85rem', color: '#9ca3af', fontWeight: 600, marginBottom: 4 }, children: "Subcategorias" }), _jsx("div", { style: { color: '#cbd5e1', fontSize: '0.9rem' }, children: "Esta categoria tem apenas uma subcategoria ou nenhuma. A an\u00E1lise ser\u00E1 feita sem um segundo disco." })] })), error && _jsx(Alert, { variant: "error", style: { marginBottom: '1rem' }, children: error }), loading && (_jsxs("div", { style: { textAlign: 'center', padding: '3rem' }, children: [_jsx(Spinner, {}), _jsx("p", { style: { color: '#9ca3af', marginTop: '1rem' }, children: "Analisando historico de gastos..." })] })), result && !loading && (_jsxs(_Fragment, { children: [_jsx("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }, children: [
                            { label: 'Gasto no mes', value: formatBRL(result.currentMonthMinor), color: '#e5e7eb' },
                            { label: 'Media historica', value: formatBRL(result.averageHistoricalMinor), color: '#9ca3af' },
                            { label: 'Variacao', value: (result.variationPct > 0 ? '+' : '') + result.variationPct.toFixed(1) + '%', color: result.variationPct > 20 ? '#f87171' : result.variationPct < -10 ? '#4ade80' : '#fbbf24' },
                            { label: 'Impacto renda', value: impactPct.toFixed(1) + '%', color: impactColor },
                        ].map(m => (_jsxs(Card, { children: [_jsx("div", { style: { fontSize: '0.75rem', color: '#9ca3af', marginBottom: 4 }, children: m.label }), _jsx("div", { style: { fontSize: '1.1rem', fontWeight: 700, color: m.color }, children: m.value })] }, m.label))) }), sourceSummary && (_jsx(Card, { style: { marginBottom: '1.5rem' }, children: _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: '0.8rem', color: '#9ca3af', marginBottom: 4 }, children: "Fontes consideradas" }), _jsxs("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: [_jsxs(Badge, { variant: "green", children: ["Extrato ", formatBRL(sourceSummary.statementMinor)] }), _jsxs(Badge, { variant: "yellow", children: ["Fatura ", formatBRL(sourceSummary.invoiceMinor)] })] })] }), _jsxs("div", { style: { color: '#6b7280', fontSize: '0.82rem', alignSelf: 'center' }, children: ["Total combinado no m\u00EAs: ", formatBRL(sourceSummary.statementMinor + sourceSummary.invoiceMinor)] })] }) })), _jsxs(Card, { style: { marginBottom: '1.5rem' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 8 }, children: [_jsx("span", { style: { fontSize: '0.85rem', color: '#9ca3af' }, children: "Impacto na renda" }), _jsxs("span", { style: { fontSize: '0.85rem', fontWeight: 700, color: impactColor }, children: [impactPct.toFixed(1), "%"] })] }), _jsx("div", { style: { background: '#1e2130', borderRadius: 4, height: 10 }, children: _jsx("div", { style: { background: impactColor, borderRadius: 4, height: 10, width: Math.min(100, impactPct) + '%' } }) })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }, children: [_jsxs(Card, { children: [_jsx("div", { style: { fontSize: '0.8rem', color: '#9ca3af', marginBottom: 8 }, children: "Tendencia" }), _jsx("div", { style: { fontSize: '1.8rem', marginBottom: 4 }, children: trendIcon(ai?.trend) }), _jsx("div", { style: { fontSize: '0.9rem', color: '#e5e7eb', fontWeight: 600 }, children: ai?.trend ?? '—' }), ai?.trendDescription && _jsx("p", { style: { fontSize: '0.82rem', color: '#9ca3af', marginTop: 6, lineHeight: 1.5 }, children: ai.trendDescription })] }), _jsxs(Card, { children: [_jsx("div", { style: { fontSize: '0.8rem', color: '#9ca3af', marginBottom: 8 }, children: "Comparacao historica" }), ai?.historicalComparison && _jsx("p", { style: { fontSize: '0.88rem', color: '#e5e7eb', lineHeight: 1.6, margin: 0 }, children: ai.historicalComparison }), _jsx("div", { style: { marginTop: 8 }, children: _jsxs(Badge, { variant: riskVariant(ai?.riskLevel), children: ["Risco ", ai?.riskLevel ?? '—'] }) })] })] }), chartData.length > 0 && (_jsxs(Card, { style: { marginBottom: '1.5rem' }, children: [_jsx("div", { style: { fontSize: '0.85rem', color: '#9ca3af', marginBottom: '1rem' }, children: "Historico mensal (R$)" }), _jsx(ResponsiveContainer, { width: "100%", height: 200, children: _jsxs(LineChart, { data: chartData, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3", stroke: "#1e2130" }), _jsx(XAxis, { dataKey: "month", tick: { fill: '#6b7280', fontSize: 11 } }), _jsx(YAxis, { tick: { fill: '#6b7280', fontSize: 11 }, tickFormatter: v => 'R$' + v }), _jsx(Tooltip, { contentStyle: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 8 }, formatter: (value, name) => [
                                                formatBRL(value * 100),
                                                name === 'statement' ? 'Extrato' : name === 'invoice' ? 'Fatura' : 'Total',
                                            ] }), _jsx(Line, { type: "monotone", dataKey: "total", stroke: "#6366f1", strokeWidth: 2, dot: { fill: '#6366f1', r: 4 } })] }) })] })), ai?.diagnosis && (_jsxs(Card, { style: { marginBottom: '1.5rem', borderLeft: '3px solid #6366f1' }, children: [_jsx("div", { style: { fontSize: '0.8rem', color: '#6366f1', marginBottom: 6, fontWeight: 600 }, children: "\uD83E\uDD16 Diagnostico" }), _jsx("p", { style: { color: '#e5e7eb', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }, children: ai.diagnosis })] })), result.topTransactions.length > 0 && (_jsxs(Card, { style: { marginBottom: '1.5rem' }, children: [_jsx("div", { style: { fontSize: '0.85rem', color: '#9ca3af', marginBottom: '0.75rem', fontWeight: 600 }, children: "Maiores gastos do mes" }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: result.topTransactions.slice(0, 5).map((t, i) => (_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #1e2130' }, children: [_jsxs("span", { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: '#d1d5db' }, children: [_jsx("span", { children: t.description ?? '—' }), t.source && _jsx(Badge, { variant: t.source === 'statement' ? 'green' : 'yellow', children: sourceLabel(t.source) })] }), _jsx("span", { style: { fontSize: '0.85rem', fontWeight: 600, color: '#f87171' }, children: formatBRL(t.amountMinor) })] }, i))) })] })), ai?.alerts && ai.alerts.length > 0 && (_jsxs(Card, { style: { marginBottom: '1.5rem' }, children: [_jsx("div", { style: { fontSize: '0.85rem', color: '#fbbf24', marginBottom: '0.75rem', fontWeight: 600 }, children: "\u26A0\uFE0F Alertas" }), _jsx("ul", { style: { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }, children: ai.alerts.map((a, i) => (_jsxs("li", { style: { display: 'flex', gap: 8, fontSize: '0.88rem', color: '#e5e7eb' }, children: [_jsx("span", { style: { color: '#fbbf24' }, children: "\u2022" }), a] }, i))) })] })), ai?.recommendations && ai.recommendations.length > 0 && (_jsxs(Card, { children: [_jsx("div", { style: { fontSize: '0.85rem', color: '#4ade80', marginBottom: '0.75rem', fontWeight: 600 }, children: "\uD83D\uDCA1 Recomendacoes" }), _jsx("ol", { style: { margin: 0, padding: '0 0 0 1.2rem', display: 'flex', flexDirection: 'column', gap: 10 }, children: ai.recommendations.map((r, i) => (_jsx("li", { style: { fontSize: '0.88rem', color: '#e5e7eb', lineHeight: 1.5 }, children: r }, i))) })] }))] })), !result && !loading && (_jsxs(Card, { style: { textAlign: 'center', padding: '3rem' }, children: [_jsx("div", { style: { fontSize: '2rem', marginBottom: '1rem' }, children: "\uD83D\uDCCA" }), _jsxs("p", { style: { color: '#9ca3af' }, children: ["Selecione uma categoria, ajuste as subcategorias e clique em", ' ', _jsx("strong", { style: { color: '#6366f1' }, children: "Avaliar" }), "."] })] }))] }));
}

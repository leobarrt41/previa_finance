import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Dashboard.tsx — Tela inicial do Previa Finance
 *
 * Apresenta cards de sumário e links rápidos para as telas principais.
 * Não faz chamadas de API directamente — serve como ponto de entrada
 * e orientação para o utilizador.
 */
import { useNavigate } from 'react-router-dom';
import { Card, Badge, Button, SectionTitle } from '../components/ui';
const QUICK_ACTIONS = [
    {
        label: 'Projeção de Fluxo de caixa',
        description: 'Visualize seu saldo mês a mês com base em receitas, despesas e faturas.',
        icon: '📈',
        path: '/cashflow',
        badge: 'Core',
        badgeVariant: 'blue',
    },
    {
        label: 'Análise de Orçamento',
        description: 'Simule o impacto de uma transação no seu orçamento mensal.',
        icon: '🎯',
        path: '/budget',
        badge: 'Core',
        badgeVariant: 'blue',
    },
];
const STATUS_ITEMS = [
    { label: 'Schema do banco', status: 'v4 implementado', variant: 'green' },
    { label: 'Motor de fluxo de caixa', status: 'Operacional', variant: 'green' },
    { label: 'Motor de Orçamento', status: 'Operacional', variant: 'green' },
    { label: 'Reconciliação', status: 'Base pronta', variant: 'yellow' },
    { label: 'Open Finance (Pluggy)', status: 'Fase 4', variant: 'gray' },
    { label: 'Parser de faturas', status: 'Em andamento', variant: 'yellow' },
];
export function Dashboard() {
    const navigate = useNavigate();
    return (_jsxs("div", { style: { maxWidth: 900 }, children: [_jsxs("div", { style: { marginBottom: '2rem' }, children: [_jsx("h1", { style: { fontSize: '1.6rem', fontWeight: 800, color: '#e5e7eb', margin: 0 }, children: "Previa Finance" }), _jsx("p", { style: { color: '#6b7280', marginTop: '0.35rem', fontSize: '0.9rem' }, children: "Gest\u00E3o financeira orientada a fluxo futuro, d\u00EDvida e consolida\u00E7\u00E3o mensal." })] }), _jsx(SectionTitle, { children: "Ac\u00E7\u00F5es r\u00E1pidas" }), _jsx("div", { style: {
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: '1rem',
                    marginBottom: '2rem',
                }, children: QUICK_ACTIONS.map((action) => (_jsxs(Card, { children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }, children: [_jsx("span", { style: { fontSize: '1.75rem' }, children: action.icon }), _jsx(Badge, { variant: action.badgeVariant, children: action.badge })] }), _jsx("h3", { style: { fontWeight: 700, fontSize: '0.95rem', color: '#e5e7eb', margin: '0 0 0.4rem' }, children: action.label }), _jsx("p", { style: { fontSize: '0.82rem', color: '#6b7280', marginBottom: '1rem', lineHeight: 1.5 }, children: action.description }), _jsx(Button, { onClick: () => navigate(action.path), fullWidth: true, children: "Abrir \u2192" })] }, action.path))) }), _jsx(SectionTitle, { children: "Estado do produto" }), _jsx(Card, { children: _jsx("div", { style: {
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                        gap: '0.75rem',
                    }, children: STATUS_ITEMS.map(({ label, status, variant }) => (_jsxs("div", { style: {
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '0.5rem 0',
                            borderBottom: '1px solid #1e2130',
                        }, children: [_jsx("span", { style: { fontSize: '0.82rem', color: '#9ca3af' }, children: label }), _jsx(Badge, { variant: variant, children: status })] }, label))) }) }), _jsxs("div", { style: {
                    marginTop: '2rem',
                    padding: '1rem 1.25rem',
                    background: '#1a2a3a',
                    borderLeft: '3px solid #6366f1',
                    borderRadius: '0 8px 8px 0',
                    fontSize: '0.85rem',
                    color: '#93c5fd',
                    lineHeight: 1.6,
                }, children: [_jsx("strong", { children: "Princ\u00EDpio central:" }), " Compra no cart\u00E3o n\u00E3o \u00E9 d\u00E9bito imediato \u2014 \u00E9 d\u00EDvida futura. O pagamento da fatura \u00E9 o evento que afecta o caixa."] })] }));
}

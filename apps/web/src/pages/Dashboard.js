import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Dashboard.tsx — Painel principal do Previa Finance
 *
 * Exibe resumo financeiro real: saldo das contas, próximas faturas,
 * acções rápidas e atalhos para os módulos principais.
 * Dados carregados via api.accounts.list() e api.assess.debt().
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatBRL } from '../services/api';
// ─── helpers ──────────────────────────────────────────────────────────────────
function currentMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function formatMonth(month) {
    const [y, m] = month.split('-');
    const names = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return `${names[Number(m) - 1]}/${y}`;
}
function formatDueDate(iso) {
    if (!iso)
        return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
function statusColor(status) {
    if (status === 'PAID')
        return '#4ade80';
    if (status === 'OVERDUE')
        return '#f87171';
    return '#fbbf24';
}
function accountTypeLabel(type) {
    const map = {
        checking: 'Conta corrente',
        savings: 'Poupança',
        credit_card: 'Cartão de crédito',
        investment: 'Investimento',
        wallet: 'Carteira',
    };
    return map[type] ?? type;
}
// ─── sub-componentes ──────────────────────────────────────────────────────────
function MetricCard({ label, value, sub, accent, }) {
    return (_jsxs("div", { style: {
            background: '#141624',
            border: '1px solid #1e2130',
            borderRadius: 12,
            padding: '1.25rem 1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
        }, children: [_jsx("span", { style: { fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }, children: label }), _jsx("span", { style: { fontSize: '1.5rem', fontWeight: 800, color: accent ?? '#e5e7eb', lineHeight: 1.2 }, children: value }), sub && (_jsx("span", { style: { fontSize: '0.75rem', color: '#6b7280', marginTop: 2 }, children: sub }))] }));
}
function QuickAction({ icon, label, desc, path, navigate, }) {
    return (_jsxs("button", { onClick: () => navigate(path), style: {
            background: 'transparent',
            border: '1px solid #1e2130',
            borderRadius: 10,
            padding: '0.75rem 1rem',
            textAlign: 'left',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem',
            transition: 'border-color 0.15s',
            width: '100%',
        }, onMouseEnter: (e) => (e.currentTarget.style.borderColor = '#6366f1'), onMouseLeave: (e) => (e.currentTarget.style.borderColor = '#1e2130'), children: [_jsx("span", { style: { fontSize: '1.2rem', lineHeight: 1, marginTop: 2 }, children: icon }), _jsxs("div", { children: [_jsx("div", { style: { fontWeight: 600, fontSize: '0.875rem', color: '#e5e7eb', marginBottom: 2 }, children: label }), _jsx("div", { style: { fontSize: '0.75rem', color: '#6b7280', lineHeight: 1.4 }, children: desc })] })] }));
}
// ─── componente principal ─────────────────────────────────────────────────────
export function Dashboard() {
    const navigate = useNavigate();
    const [accounts, setAccounts] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const month = currentMonth();
    useEffect(() => {
        let active = true;
        setLoading(true);
        Promise.allSettled([
            api.accounts.list(),
            api.assess.debt(month, 2),
        ]).then(([accResult, debtResult]) => {
            if (!active)
                return;
            if (accResult.status === 'fulfilled') {
                setAccounts(accResult.value.items ?? []);
            }
            if (debtResult.status === 'fulfilled') {
                const debt = debtResult.value;
                const raw = [];
                for (const inv of debt?.openInvoices ?? []) {
                    raw.push({
                        accountId: inv.accountId,
                        accountName: inv.accountName ?? inv.institutionName ?? 'Cartão',
                        invoiceMonth: inv.invoiceMonth,
                        dueDate: inv.dueDate,
                        totalAmountMinor: inv.totalAmountMinor ?? 0,
                        effectiveOpenAmountMinor: inv.effectiveOpenAmountMinor ?? inv.totalAmountMinor ?? 0,
                        status: inv.status ?? 'OPEN',
                    });
                }
                setInvoices(raw.slice(0, 5));
            }
            setLoading(false);
        });
        return () => { active = false; };
    }, [month]);
    // métricas derivadas
    const bankAccounts = accounts.filter((a) => a.type !== 'credit_card');
    const totalBalance = bankAccounts.reduce((s, a) => s + (a.currentBalanceMinor ?? 0), 0);
    const openInvoicesTotal = invoices
        .filter((i) => i.status !== 'PAID')
        .reduce((s, i) => s + Number(i.effectiveOpenAmountMinor), 0);
    return (_jsxs("div", { style: { maxWidth: 960 }, children: [_jsxs("div", { style: { marginBottom: '2rem' }, children: [_jsx("h1", { style: { fontSize: '1.5rem', fontWeight: 800, color: '#e5e7eb', margin: 0 }, children: "Vis\u00E3o geral" }), _jsx("p", { style: { color: '#6b7280', marginTop: '0.3rem', fontSize: '0.875rem' }, children: new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) })] }), _jsxs("div", { style: {
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                    gap: '1rem',
                    marginBottom: '2rem',
                }, children: [_jsx(MetricCard, { label: "Saldo em conta", value: loading ? '...' : formatBRL(totalBalance), sub: `${bankAccounts.length} conta${bankAccounts.length !== 1 ? 's' : ''}`, accent: totalBalance >= 0 ? '#4ade80' : '#f87171' }), _jsx(MetricCard, { label: "Faturas em aberto", value: loading ? '...' : formatBRL(openInvoicesTotal), sub: `${invoices.filter((i) => i.status !== 'PAID').length} fatura(s)`, accent: openInvoicesTotal > 0 ? '#fbbf24' : '#4ade80' }), _jsx(MetricCard, { label: "Per\u00EDodo", value: formatMonth(month), sub: "M\u00EAs actual" })] }), _jsxs("div", { style: {
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '1.5rem',
                    marginBottom: '2rem',
                }, children: [_jsxs("div", { style: {
                            background: '#141624',
                            border: '1px solid #1e2130',
                            borderRadius: 12,
                            padding: '1.25rem 1.5rem',
                        }, children: [_jsx("div", { style: { fontWeight: 700, fontSize: '0.875rem', color: '#e5e7eb', marginBottom: '1rem' }, children: "Pr\u00F3ximas faturas" }), loading ? (_jsx("div", { style: { color: '#6b7280', fontSize: '0.85rem' }, children: "Carregando..." })) : invoices.length === 0 ? (_jsxs("div", { style: { color: '#6b7280', fontSize: '0.85rem' }, children: ["Nenhuma fatura em aberto.", ' ', _jsx("button", { onClick: () => navigate('/invoices/upload'), style: { background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', padding: 0, fontSize: '0.85rem' }, children: "Importar fatura \u2192" })] })) : (_jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.65rem' }, children: invoices.map((inv, i) => (_jsxs("div", { style: {
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '0.5rem 0',
                                        borderBottom: i < invoices.length - 1 ? '1px solid #1e2130' : 'none',
                                    }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: '0.85rem', fontWeight: 600, color: '#e5e7eb' }, children: inv.accountName }), _jsxs("div", { style: { fontSize: '0.72rem', color: '#6b7280' }, children: [formatMonth(inv.invoiceMonth), " \u00B7 vence ", formatDueDate(inv.dueDate)] })] }), _jsxs("div", { style: { textAlign: 'right' }, children: [_jsx("div", { style: { fontSize: '0.9rem', fontWeight: 700, color: '#e5e7eb' }, children: formatBRL(Number(inv.effectiveOpenAmountMinor)) }), _jsx("div", { style: { fontSize: '0.7rem', color: statusColor(inv.status), fontWeight: 600 }, children: inv.status === 'PAID' ? 'Pago' : inv.status === 'OVERDUE' ? 'Vencido' : 'Em aberto' })] })] }, i))) }))] }), _jsxs("div", { style: {
                            background: '#141624',
                            border: '1px solid #1e2130',
                            borderRadius: 12,
                            padding: '1.25rem 1.5rem',
                        }, children: [_jsx("div", { style: { fontWeight: 700, fontSize: '0.875rem', color: '#e5e7eb', marginBottom: '1rem' }, children: "Ac\u00E7\u00F5es r\u00E1pidas" }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.5rem' }, children: [_jsx(QuickAction, { icon: "\uD83D\uDCC8", label: "Fluxo de caixa", desc: "Proje\u00E7\u00E3o m\u00EAs a m\u00EAs", path: "/cashflow", navigate: navigate }), _jsx(QuickAction, { icon: "\uD83C\uDFAF", label: "Or\u00E7amento", desc: "Simular compra e avaliar impacto", path: "/budget", navigate: navigate }), _jsx(QuickAction, { icon: "\uD83D\uDCB3", label: "Aval. D\u00EDvidas", desc: "Parcelas e faturas futuras", path: "/assess/debt", navigate: navigate }), _jsx(QuickAction, { icon: "\uD83D\uDCCA", label: "Aval. Gastos", desc: "Gastos por categoria", path: "/assess/spending", navigate: navigate })] })] })] }), _jsxs("div", { style: {
                    background: '#141624',
                    border: '1px solid #1e2130',
                    borderRadius: 12,
                    padding: '1.25rem 1.5rem',
                    marginBottom: '2rem',
                }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }, children: [_jsx("div", { style: { fontWeight: 700, fontSize: '0.875rem', color: '#e5e7eb' }, children: "Contas" }), _jsx("button", { onClick: () => navigate('/accounts'), style: { background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: '0.8rem', padding: 0 }, children: "Ver todas \u2192" })] }), loading ? (_jsx("div", { style: { color: '#6b7280', fontSize: '0.85rem' }, children: "Carregando..." })) : accounts.length === 0 ? (_jsxs("div", { style: { color: '#6b7280', fontSize: '0.85rem' }, children: ["Nenhuma conta cadastrada.", ' ', _jsx("button", { onClick: () => navigate('/statements/upload'), style: { background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', padding: 0, fontSize: '0.85rem' }, children: "Importar extrato \u2192" })] })) : (_jsx("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }, children: accounts.map((acc) => (_jsxs("button", { onClick: () => navigate(`/accounts/${acc.id}`), style: {
                                background: '#0f1117',
                                border: '1px solid #1e2130',
                                borderRadius: 10,
                                padding: '0.85rem 1rem',
                                textAlign: 'left',
                                cursor: 'pointer',
                                transition: 'border-color 0.15s',
                            }, onMouseEnter: (e) => (e.currentTarget.style.borderColor = '#6366f1'), onMouseLeave: (e) => (e.currentTarget.style.borderColor = '#1e2130'), children: [_jsx("div", { style: { fontSize: '0.68rem', color: '#6b7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }, children: accountTypeLabel(acc.type) }), _jsx("div", { style: { fontSize: '0.875rem', fontWeight: 700, color: '#e5e7eb', marginBottom: 2 }, children: acc.name }), acc.institutionName && (_jsx("div", { style: { fontSize: '0.72rem', color: '#9ca3af' }, children: acc.institutionName })), acc.currentBalanceMinor !== undefined && acc.type !== 'credit_card' && (_jsx("div", { style: {
                                        fontSize: '0.95rem',
                                        fontWeight: 800,
                                        color: acc.currentBalanceMinor >= 0 ? '#4ade80' : '#f87171',
                                        marginTop: 6,
                                    }, children: formatBRL(acc.currentBalanceMinor) }))] }, acc.id))) }))] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }, children: [_jsxs("button", { onClick: () => navigate('/statements/upload'), style: {
                            background: '#141624',
                            border: '1px dashed #2b3150',
                            borderRadius: 12,
                            padding: '1rem 1.25rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            transition: 'border-color 0.15s',
                        }, onMouseEnter: (e) => (e.currentTarget.style.borderColor = '#6366f1'), onMouseLeave: (e) => (e.currentTarget.style.borderColor = '#2b3150'), children: [_jsx("span", { style: { fontSize: '1.3rem' }, children: "\uD83E\uDDFE" }), _jsxs("div", { style: { textAlign: 'left' }, children: [_jsx("div", { style: { fontWeight: 600, fontSize: '0.875rem', color: '#e5e7eb' }, children: "Importar extrato" }), _jsx("div", { style: { fontSize: '0.72rem', color: '#6b7280' }, children: "OFX, CSV ou PDF banc\u00E1rio" })] })] }), _jsxs("button", { onClick: () => navigate('/invoices/upload'), style: {
                            background: '#141624',
                            border: '1px dashed #2b3150',
                            borderRadius: 12,
                            padding: '1rem 1.25rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            transition: 'border-color 0.15s',
                        }, onMouseEnter: (e) => (e.currentTarget.style.borderColor = '#6366f1'), onMouseLeave: (e) => (e.currentTarget.style.borderColor = '#2b3150'), children: [_jsx("span", { style: { fontSize: '1.3rem' }, children: "\uD83D\uDCE4" }), _jsxs("div", { style: { textAlign: 'left' }, children: [_jsx("div", { style: { fontWeight: 600, fontSize: '0.875rem', color: '#e5e7eb' }, children: "Importar fatura" }), _jsx("div", { style: { fontSize: '0.72rem', color: '#6b7280' }, children: "PDF de cart\u00E3o de cr\u00E9dito" })] })] })] })] }));
}

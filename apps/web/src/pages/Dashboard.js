import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Dashboard.tsx — Briefing diário do Previa Finance
 *
 * Responde em 5 segundos: "Como estou agora e o que preciso fazer hoje?"
 * Não repete o que já existe em CashFlow, Budget, Accounts ou AccountDetail.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatBRL } from '../services/api';
// ─── Helpers ──────────────────────────────────────────────────────────────────
function currentMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function daysUntil(iso) {
    if (!iso)
        return null;
    const diff = new Date(iso).getTime() - Date.now();
    return Math.ceil(diff / 86400000);
}
function formatDueDate(iso) {
    if (!iso)
        return '—';
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
function healthColor(net, hasOverdue) {
    if (hasOverdue || net < 0)
        return '#f87171';
    if (net < 50000)
        return '#fbbf24'; // < R$500
    return '#4ade80';
}
// ─── Sub-components ───────────────────────────────────────────────────────────
function MetricBlock({ label, value, color = '#e5e7eb', sub, }) {
    return (_jsxs("div", { children: [_jsx("div", { style: { fontSize: '0.68rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }, children: label }), _jsx("div", { style: { fontSize: '1.35rem', fontWeight: 800, color, lineHeight: 1.1 }, children: value }), sub && _jsx("div", { style: { fontSize: '0.72rem', color: '#6b7280', marginTop: 3 }, children: sub })] }));
}
function AlertRow({ icon, text, tone }) {
    const colors = { red: '#fca5a5', amber: '#fbbf24', green: '#86efac' };
    const bg = { red: 'rgba(248,113,113,0.07)', amber: 'rgba(251,191,36,0.07)', green: 'rgba(74,222,128,0.07)' };
    return (_jsxs("div", { style: {
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            padding: '0.65rem 0.85rem',
            borderRadius: 10,
            background: bg[tone],
            border: `1px solid ${colors[tone]}22`,
        }, children: [_jsx("span", { style: { fontSize: '1rem' }, children: icon }), _jsx("span", { style: { fontSize: '0.83rem', color: colors[tone], lineHeight: 1.4 }, children: text })] }));
}
function ActionButton({ icon, label, sub, onClick, primary, }) {
    return (_jsxs("button", { onClick: onClick, style: {
            background: primary
                ? 'linear-gradient(135deg, rgba(99,102,241,0.18), rgba(99,102,241,0.08))'
                : 'rgba(15,17,23,0.6)',
            border: primary ? '1px solid rgba(99,102,241,0.45)' : '1px dashed #2b3150',
            borderRadius: 14,
            padding: '0.9rem 1rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            textAlign: 'left',
            width: '100%',
            transition: 'border-color 0.15s, background 0.15s',
        }, onMouseEnter: (e) => {
            const el = e.currentTarget;
            el.style.borderColor = '#6366f1';
        }, onMouseLeave: (e) => {
            const el = e.currentTarget;
            el.style.borderColor = primary ? 'rgba(99,102,241,0.45)' : '#2b3150';
        }, children: [_jsx("span", { style: { fontSize: '1.25rem' }, children: icon }), _jsxs("div", { children: [_jsx("div", { style: { fontWeight: 700, fontSize: '0.875rem', color: '#e5e7eb' }, children: label }), _jsx("div", { style: { fontSize: '0.72rem', color: '#6b7280', marginTop: 2 }, children: sub })] })] }));
}
// ─── Main Component ───────────────────────────────────────────────────────────
export function Dashboard() {
    const navigate = useNavigate();
    const month = currentMonth();
    const [accounts, setAccounts] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [spending, setSpending] = useState(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        let active = true;
        setLoading(true);
        Promise.allSettled([
            api.accounts.list(),
            api.assess.debt(month, 1),
            api.assess.spendingOverview(month),
        ]).then(([accRes, debtRes, spendRes]) => {
            if (!active)
                return;
            if (accRes.status === 'fulfilled') {
                setAccounts(accRes.value.items ?? []);
            }
            if (debtRes.status === 'fulfilled') {
                const debt = debtRes.value;
                const raw = (debt?.openInvoices ?? []).map((inv) => ({
                    accountId: inv.accountId,
                    accountName: inv.accountName ?? inv.institutionName ?? 'Cartão',
                    invoiceMonth: inv.invoiceMonth,
                    dueDate: inv.dueDate,
                    totalAmountMinor: inv.totalAmountMinor ?? 0,
                    effectiveOpenAmountMinor: inv.effectiveOpenAmountMinor ?? inv.totalAmountMinor ?? 0,
                    status: inv.status ?? 'OPEN',
                }));
                setInvoices(raw);
            }
            if (spendRes.status === 'fulfilled') {
                const s = spendRes.value;
                setSpending({
                    totalIncomeMinor: s?.totalIncomeMinor ?? 0,
                    totalExpenseMinor: s?.totalExpenseMinor ?? 0,
                });
            }
            setLoading(false);
        });
        return () => { active = false; };
    }, [month]);
    // ── Derived values ──────────────────────────────────────────────────────────
    const liquidAccounts = accounts.filter((a) => a.type === 'checking' || a.type === 'wallet');
    const openInvoices = invoices.filter((i) => i.status !== 'PAID');
    const overdueInvoices = invoices.filter((i) => i.status === 'OVERDUE');
    const negativeAccounts = accounts.filter((a) => a.type !== 'credit_card' && (a.currentBalanceMinor ?? 0) < 0);
    const liquidBalance = liquidAccounts.reduce((s, a) => s + (a.currentBalanceMinor ?? 0), 0);
    const openInvoicesTotal = openInvoices.reduce((s, i) => s + Number(i.effectiveOpenAmountMinor), 0);
    const netAvailable = liquidBalance - openInvoicesTotal;
    const income = spending?.totalIncomeMinor ?? 0;
    const expense = spending?.totalExpenseMinor ?? 0;
    const monthBalance = income - expense;
    // Próxima fatura a vencer (não paga, com dueDate)
    const nextInvoice = openInvoices
        .filter((i) => i.dueDate)
        .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];
    const nextInvoiceDays = daysUntil(nextInvoice?.dueDate);
    // Alertas
    const alerts = [];
    if (overdueInvoices.length > 0) {
        alerts.push({
            icon: '🚨',
            text: `${overdueInvoices.length} fatura${overdueInvoices.length > 1 ? 's' : ''} vencida${overdueInvoices.length > 1 ? 's' : ''} — total ${formatBRL(overdueInvoices.reduce((s, i) => s + Number(i.effectiveOpenAmountMinor), 0))}`,
            tone: 'red',
        });
    }
    if (negativeAccounts.length > 0) {
        alerts.push({
            icon: '⚠️',
            text: `${negativeAccounts.length} conta${negativeAccounts.length > 1 ? 's' : ''} com saldo negativo`,
            tone: 'red',
        });
    }
    if (nextInvoice && nextInvoiceDays !== null && nextInvoiceDays <= 7 && nextInvoiceDays >= 0) {
        alerts.push({
            icon: '📅',
            text: `Fatura ${nextInvoice.accountName} vence em ${nextInvoiceDays === 0 ? 'hoje' : `${nextInvoiceDays} dia${nextInvoiceDays > 1 ? 's' : ''}`} — ${formatBRL(Number(nextInvoice.effectiveOpenAmountMinor))}`,
            tone: nextInvoiceDays <= 2 ? 'red' : 'amber',
        });
    }
    if (accounts.length === 0 && !loading) {
        alerts.push({
            icon: '📥',
            text: 'Nenhuma conta encontrada. Importe um extrato para começar.',
            tone: 'amber',
        });
    }
    if (alerts.length === 0 && !loading) {
        alerts.push({
            icon: '✅',
            text: 'Nenhum alerta crítico no momento.',
            tone: 'green',
        });
    }
    const hColor = healthColor(netAvailable, overdueInvoices.length > 0);
    // ── Render ──────────────────────────────────────────────────────────────────
    return (_jsxs("div", { style: { maxWidth: 900, display: 'flex', flexDirection: 'column', gap: '1rem' }, children: [_jsxs("div", { style: {
                    background: 'linear-gradient(180deg, rgba(20,22,36,0.98), rgba(12,14,22,0.98))',
                    border: '1px solid #2b3150',
                    borderRadius: 20,
                    padding: '1.4rem 1.5rem',
                    boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
                }, children: [_jsx("div", { style: { fontSize: '0.68rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: '1rem' }, children: new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }) }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1.5rem', alignItems: 'end' }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }, children: "Dispon\u00EDvel l\u00EDquido" }), _jsx("div", { style: { fontSize: 'clamp(1.8rem, 4vw, 2.6rem)', fontWeight: 900, color: hColor, lineHeight: 1, letterSpacing: '-0.03em' }, children: loading ? '...' : formatBRL(netAvailable) }), _jsx("div", { style: { fontSize: '0.75rem', color: '#6b7280', marginTop: 6 }, children: "Caixa l\u00EDquido menos faturas em aberto" })] }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.75rem' }, children: _jsx(MetricBlock, { label: "Caixa l\u00EDquido", value: loading ? '...' : formatBRL(liquidBalance), color: liquidBalance >= 0 ? '#86efac' : '#f87171', sub: `${liquidAccounts.length} conta${liquidAccounts.length !== 1 ? 's' : ''} corrente${liquidAccounts.length !== 1 ? 's' : ''}` }) }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.75rem' }, children: _jsx(MetricBlock, { label: "Faturas em aberto", value: loading ? '...' : formatBRL(openInvoicesTotal), color: openInvoicesTotal > 0 ? '#fbbf24' : '#86efac', sub: `${openInvoices.length} fatura${openInvoices.length !== 1 ? 's' : ''}` }) }), nextInvoice && (_jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.75rem' }, children: _jsx(MetricBlock, { label: "Pr\u00F3ximo vencimento", value: formatDueDate(nextInvoice.dueDate), color: nextInvoiceDays !== null && nextInvoiceDays <= 3 ? '#fbbf24' : '#e5e7eb', sub: nextInvoice.accountName }) }))] })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }, children: [_jsxs("div", { style: {
                            background: 'linear-gradient(180deg, rgba(20,22,36,0.98), rgba(12,14,22,0.98))',
                            border: '1px solid #2b3150',
                            borderRadius: 18,
                            padding: '1.2rem 1.3rem',
                        }, children: [_jsx("div", { style: { fontSize: '0.68rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '1rem' }, children: "M\u00EAs corrente" }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.75rem' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, children: [_jsx("span", { style: { fontSize: '0.83rem', color: '#9ca3af' }, children: "Receitas" }), _jsx("span", { style: { fontSize: '0.95rem', fontWeight: 700, color: '#86efac' }, children: loading ? '...' : formatBRL(income) })] }), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, children: [_jsx("span", { style: { fontSize: '0.83rem', color: '#9ca3af' }, children: "Despesas" }), _jsx("span", { style: { fontSize: '0.95rem', fontWeight: 700, color: '#f87171' }, children: loading ? '...' : formatBRL(expense) })] }), _jsxs("div", { style: {
                                            borderTop: '1px solid #1e2130',
                                            paddingTop: '0.75rem',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                        }, children: [_jsx("span", { style: { fontSize: '0.83rem', color: '#e5e7eb', fontWeight: 700 }, children: monthBalance >= 0 ? 'Sobra' : 'Falta' }), _jsx("span", { style: {
                                                    fontSize: '1.1rem',
                                                    fontWeight: 900,
                                                    color: monthBalance >= 0 ? '#4ade80' : '#f87171',
                                                }, children: loading ? '...' : formatBRL(Math.abs(monthBalance)) })] })] }), _jsx("button", { onClick: () => navigate('/budget'), style: {
                                    marginTop: '1rem',
                                    background: 'transparent',
                                    border: '1px solid #2b3150',
                                    borderRadius: 10,
                                    padding: '0.55rem 0.85rem',
                                    fontSize: '0.78rem',
                                    color: '#9ca3af',
                                    cursor: 'pointer',
                                    width: '100%',
                                }, onMouseEnter: (e) => { e.currentTarget.style.color = '#e5e7eb'; }, onMouseLeave: (e) => { e.currentTarget.style.color = '#9ca3af'; }, children: "Ver detalhes por categoria \u2192" })] }), _jsxs("div", { style: {
                            background: 'linear-gradient(180deg, rgba(20,22,36,0.98), rgba(12,14,22,0.98))',
                            border: '1px solid #2b3150',
                            borderRadius: 18,
                            padding: '1.2rem 1.3rem',
                        }, children: [_jsx("div", { style: { fontSize: '0.68rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '1rem' }, children: "Aten\u00E7\u00E3o" }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.55rem' }, children: alerts.map((a, i) => (_jsx(AlertRow, { icon: a.icon, text: a.text, tone: a.tone }, i))) })] })] }), openInvoices.length > 0 && (_jsxs("div", { style: {
                    background: 'linear-gradient(180deg, rgba(20,22,36,0.98), rgba(12,14,22,0.98))',
                    border: '1px solid #2b3150',
                    borderRadius: 18,
                    padding: '1.2rem 1.3rem',
                }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.9rem' }, children: [_jsx("div", { style: { fontSize: '0.68rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.12em' }, children: "Faturas em aberto" }), _jsx("button", { onClick: () => navigate('/accounts'), style: { background: 'none', border: 'none', color: '#6366f1', fontSize: '0.78rem', cursor: 'pointer', padding: 0 }, children: "Ver todas \u2192" })] }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.5rem' }, children: openInvoices.slice(0, 4).map((inv, i) => {
                            const days = daysUntil(inv.dueDate);
                            const isUrgent = days !== null && days <= 3;
                            return (_jsxs("div", { style: {
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '0.6rem 0.75rem',
                                    borderRadius: 10,
                                    background: isUrgent ? 'rgba(251,191,36,0.06)' : 'rgba(255,255,255,0.02)',
                                    border: `1px solid ${isUrgent ? 'rgba(251,191,36,0.2)' : '#1e2130'}`,
                                }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: '0.83rem', fontWeight: 600, color: '#e5e7eb' }, children: inv.accountName }), _jsxs("div", { style: { fontSize: '0.72rem', color: '#6b7280', marginTop: 2 }, children: ["Vence ", formatDueDate(inv.dueDate), days !== null && days >= 0 && ` · ${days === 0 ? 'hoje' : `em ${days}d`}`] })] }), _jsx("div", { style: { fontSize: '0.95rem', fontWeight: 800, color: isUrgent ? '#fbbf24' : '#e5e7eb' }, children: formatBRL(Number(inv.effectiveOpenAmountMinor)) })] }, i));
                        }) })] })), _jsxs("div", { style: {
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '0.75rem',
                }, children: [_jsx(ActionButton, { icon: "\uD83D\uDCE4", label: "Importar fatura", sub: "PDF de cart\u00E3o de cr\u00E9dito", onClick: () => navigate('/invoices/upload'), primary: true }), _jsx(ActionButton, { icon: "\uD83E\uDDFE", label: "Importar extrato", sub: "OFX, CSV ou PDF banc\u00E1rio", onClick: () => navigate('/statements/upload') }), _jsx(ActionButton, { icon: "\uD83D\uDCCA", label: "Ver cashflow", sub: "Projec\u00E7\u00E3o m\u00EAs a m\u00EAs", onClick: () => navigate('/cashflow') }), _jsx(ActionButton, { icon: "\uD83E\uDD16", label: "Previa Bot", sub: "Pergunte sobre suas finan\u00E7as", onClick: () => navigate('/bot') })] })] }));
}

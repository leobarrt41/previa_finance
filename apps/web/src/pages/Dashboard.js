import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Dashboard.tsx — Painel principal do Previa Finance
 *
 * Estrutura o painel como uma capa de jornal por editorias:
 * dívidas, caixa, orçamento, economias, investimentos e alertas.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatBRL } from '../services/api';
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
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
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
function accountGroupLabel(type) {
    const map = {
        checking: 'Caixa',
        savings: 'Economias',
        credit_card: 'Dívidas',
        investment: 'Investimentos',
        wallet: 'Caixa',
    };
    return map[type] ?? 'Outros';
}
function SectionCard({ eyebrow, title, subtitle, tone = 'neutral', children, footer, }) {
    const accents = {
        neutral: { ring: '#243047', glow: 'rgba(36, 48, 71, 0.35)', label: '#e5e7eb' },
        amber: { ring: '#4b3512', glow: 'rgba(245, 158, 11, 0.14)', label: '#fbbf24' },
        blue: { ring: '#1f3a5f', glow: 'rgba(59, 130, 246, 0.14)', label: '#93c5fd' },
        green: { ring: '#1f4f3a', glow: 'rgba(74, 222, 128, 0.14)', label: '#86efac' },
        red: { ring: '#5f1f2a', glow: 'rgba(248, 113, 113, 0.14)', label: '#fca5a5' },
        violet: { ring: '#34235f', glow: 'rgba(167, 139, 250, 0.14)', label: '#c4b5fd' },
    };
    const accent = accents[tone];
    return (_jsxs("section", { style: {
            background: `linear-gradient(180deg, rgba(20,22,36,0.98), rgba(15,17,23,0.98))`,
            border: `1px solid ${accent.ring}`,
            borderRadius: 18,
            padding: '1.15rem 1.25rem',
            boxShadow: `0 18px 42px ${accent.glow}`,
        }, children: [_jsxs("div", { style: { marginBottom: '1rem' }, children: [_jsx("div", { style: { fontSize: '0.68rem', color: accent.label, textTransform: 'uppercase', letterSpacing: '0.14em' }, children: eyebrow }), _jsx("div", { style: { fontSize: '0.98rem', fontWeight: 850, color: '#f8fafc', marginTop: 6 }, children: title }), subtitle && (_jsx("div", { style: { fontSize: '0.82rem', color: '#94a3b8', marginTop: 6, lineHeight: 1.45 }, children: subtitle }))] }), _jsx("div", { children: children }), footer && _jsx("div", { style: { marginTop: '1rem' }, children: footer })] }));
}
export function Dashboard() {
    const navigate = useNavigate();
    const [accounts, setAccounts] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const month = currentMonth();
    useEffect(() => {
        let active = true;
        setLoading(true);
        Promise.allSettled([api.accounts.list(), api.assess.debt(month, 2)]).then(([accResult, debtResult]) => {
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
        return () => {
            active = false;
        };
    }, [month]);
    const liquidAccounts = accounts.filter((a) => a.type === 'checking' || a.type === 'wallet');
    const savingsAccounts = accounts.filter((a) => a.type === 'savings');
    const investmentAccounts = accounts.filter((a) => a.type === 'investment');
    const creditCardAccounts = accounts.filter((a) => a.type === 'credit_card');
    const bankAccounts = accounts.filter((a) => a.type !== 'credit_card');
    const liquidBalance = liquidAccounts.reduce((sum, a) => sum + (a.currentBalanceMinor ?? 0), 0);
    const savingsBalance = savingsAccounts.reduce((sum, a) => sum + (a.currentBalanceMinor ?? 0), 0);
    const investmentsBalance = investmentAccounts.reduce((sum, a) => sum + (a.currentBalanceMinor ?? 0), 0);
    const totalBalance = bankAccounts.reduce((sum, a) => sum + (a.currentBalanceMinor ?? 0), 0);
    const openInvoicesTotal = invoices
        .filter((i) => i.status !== 'PAID')
        .reduce((sum, i) => sum + Number(i.effectiveOpenAmountMinor), 0);
    const overdueInvoices = invoices.filter((i) => i.status === 'OVERDUE');
    const negativeAccounts = bankAccounts.filter((a) => (a.currentBalanceMinor ?? 0) < 0);
    const invoiceCount = invoices.filter((i) => i.status !== 'PAID').length;
    const headlineTitle = overdueInvoices.length > 0
        ? 'Dívidas vencidas ganham a manchete'
        : totalBalance < 0
            ? 'Caixa apertado pede ação imediata'
            : savingsBalance > 0
                ? 'Reserva financeira sustenta a edição'
                : 'Panorama estável, com leitura limpa';
    const headlineDeck = overdueInvoices.length > 0
        ? `Há ${overdueInvoices.length} fatura${overdueInvoices.length !== 1 ? 's' : ''} vencida${overdueInvoices.length !== 1 ? 's' : ''} somando ${formatBRL(overdueInvoices.reduce((sum, i) => sum + Number(i.effectiveOpenAmountMinor), 0))}.`
        : totalBalance < 0
            ? `Saldo consolidado em ${formatBRL(totalBalance)}. O caixa merece prioridade antes de novas compras.`
            : `Saldo consolidado em ${formatBRL(totalBalance)} e ${formatBRL(savingsBalance)} em economias.`;
    const topInvoice = invoices[0];
    const topAlert = overdueInvoices.length > 0
        ? `Foco nas faturas vencidas e no vencimento mais próximo.`
        : negativeAccounts.length > 0
            ? `Há ${negativeAccounts.length} conta${negativeAccounts.length !== 1 ? 's' : ''} com saldo negativo.`
            : `Nenhum alerta crítico agora.`;
    return (_jsxs("div", { style: { maxWidth: 1200 }, children: [_jsxs("div", { style: {
                    position: 'relative',
                    overflow: 'hidden',
                    background: 'radial-gradient(circle at top left, rgba(245, 158, 11, 0.18), transparent 32%), linear-gradient(180deg, rgba(20, 22, 36, 0.98), rgba(12, 14, 22, 0.98))',
                    border: '1px solid #2b3150',
                    borderRadius: 24,
                    padding: '1.5rem',
                    marginBottom: '1.25rem',
                    boxShadow: '0 28px 70px rgba(0, 0, 0, 0.35)',
                }, children: [_jsx("div", { style: {
                            position: 'absolute',
                            inset: 0,
                            backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
                            backgroundSize: '24px 24px',
                            maskImage: 'linear-gradient(180deg, rgba(0,0,0,0.72), transparent)',
                            pointerEvents: 'none',
                        } }), _jsxs("div", { style: { position: 'relative', zIndex: 1 }, children: [_jsxs("div", { style: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.9rem' }, children: [_jsx("span", { style: { fontSize: '0.68rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#fbbf24' }, children: "Edi\u00E7\u00E3o de hoje" }), _jsx("span", { style: { width: 6, height: 6, borderRadius: 999, background: '#f59e0b' } }), _jsx("span", { style: { fontSize: '0.78rem', color: '#9ca3af' }, children: new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) })] }), _jsxs("div", { style: {
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                                    gap: '1.25rem',
                                    alignItems: 'stretch',
                                }, children: [_jsxs("div", { children: [_jsx("div", { style: {
                                                    fontFamily: 'Georgia, Times New Roman, serif',
                                                    fontSize: 'clamp(2.35rem, 4vw, 4.4rem)',
                                                    lineHeight: 0.96,
                                                    fontWeight: 700,
                                                    letterSpacing: '-0.04em',
                                                    color: '#f8fafc',
                                                    textWrap: 'balance',
                                                }, children: headlineTitle }), _jsxs("p", { style: {
                                                    margin: '0.95rem 0 0',
                                                    maxWidth: 760,
                                                    fontSize: '1rem',
                                                    lineHeight: 1.6,
                                                    color: '#cbd5e1',
                                                }, children: [headlineDeck, " O painel agora se organiza por editorias, como um jornal: d\u00EDvidas, caixa, or\u00E7amento, economias, investimentos e alertas."] }), _jsx("div", { style: { display: 'flex', flexWrap: 'wrap', gap: '0.55rem', marginTop: '1.15rem' }, children: ['Dívidas', 'Caixa', 'Orçamento', 'Economias', 'Investimentos', 'Alertas'].map((label) => (_jsx("span", { style: {
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        border: '1px solid #2b3150',
                                                        background: 'rgba(15, 17, 23, 0.72)',
                                                        color: '#cbd5e1',
                                                        borderRadius: 999,
                                                        padding: '0.42rem 0.78rem',
                                                        fontSize: '0.78rem',
                                                    }, children: label }, label))) })] }), _jsxs("div", { style: {
                                            background: 'rgba(15, 17, 23, 0.72)',
                                            border: '1px solid #2b3150',
                                            borderRadius: 18,
                                            padding: '1rem',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            justifyContent: 'space-between',
                                            gap: '0.9rem',
                                        }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: '0.72rem', color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.12em' }, children: "Radar" }), _jsx("div", { style: {
                                                            marginTop: '0.55rem',
                                                            fontFamily: 'Georgia, Times New Roman, serif',
                                                            fontSize: '1.45rem',
                                                            lineHeight: 1.05,
                                                            color: '#f8fafc',
                                                        }, children: topAlert }), _jsx("p", { style: { margin: '0.7rem 0 0', fontSize: '0.9rem', lineHeight: 1.55, color: '#cbd5e1' }, children: loading ? 'Carregando dados do dia...' : `${invoiceCount} fatura${invoiceCount !== 1 ? 's' : ''} em aberto agora.` })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }, children: [_jsxs("div", { style: { padding: '0.85rem', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.18)', borderRadius: 14 }, children: [_jsx("div", { style: { fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#fbbf24' }, children: "Caixa l\u00EDquido" }), _jsx("div", { style: { marginTop: 4, fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }, children: loading ? '...' : formatBRL(liquidBalance) })] }), _jsxs("div", { style: { padding: '0.85rem', background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.18)', borderRadius: 14 }, children: [_jsx("div", { style: { fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#93c5fd' }, children: "D\u00EDvida aberta" }), _jsx("div", { style: { marginTop: 4, fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }, children: loading ? '...' : formatBRL(openInvoicesTotal) })] })] })] })] })] })] }), _jsxs("div", { style: {
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: '1rem',
                    marginBottom: '1.25rem',
                }, children: [_jsx(SectionCard, { eyebrow: "Caixa", title: loading ? '...' : formatBRL(totalBalance), subtitle: `${bankAccounts.length} conta${bankAccounts.length !== 1 ? 's' : ''} no radar`, tone: totalBalance >= 0 ? 'green' : 'red', children: _jsx("div", { style: { color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.5 }, children: totalBalance >= 0
                                ? 'O saldo consolidado está positivo.'
                                : 'O saldo consolidado pede contenção imediata.' }) }), _jsx(SectionCard, { eyebrow: "Economias", title: loading ? '...' : formatBRL(savingsBalance), subtitle: `${savingsAccounts.length} conta${savingsAccounts.length !== 1 ? 's' : ''} de reserva`, tone: "green", children: _jsx("div", { style: { color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.5 }, children: "Reserva para amortecer os pr\u00F3ximos meses." }) }), _jsx(SectionCard, { eyebrow: "Investimentos", title: loading ? '...' : formatBRL(investmentsBalance), subtitle: `${investmentAccounts.length} posição${investmentAccounts.length !== 1 ? 'ões' : ''}`, tone: "violet", children: _jsx("div", { style: { color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.5 }, children: "Patrim\u00F4nio aplicado fora do caixa operacional." }) }), _jsx(SectionCard, { eyebrow: "Faturas", title: loading ? '...' : formatBRL(openInvoicesTotal), subtitle: `${invoiceCount} fatura${invoiceCount !== 1 ? 's' : ''} aberta${invoiceCount !== 1 ? 's' : ''}`, tone: invoiceCount > 0 ? 'amber' : 'green', children: _jsx("div", { style: { color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.5 }, children: "Priorize vencimentos e cart\u00F5es." }) })] }), _jsxs("div", { style: {
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                    gap: '1rem',
                    marginBottom: '1.25rem',
                }, children: [_jsxs(SectionCard, { eyebrow: "Editorias", title: "D\u00EDvidas", subtitle: "Faturas, parcelas e vencimentos que merecem aten\u00E7\u00E3o hoje.", tone: overdueInvoices.length > 0 ? 'red' : 'amber', footer: _jsx("button", { onClick: () => navigate('/assess/debt'), style: {
                                background: 'transparent',
                                color: '#e5e7eb',
                                border: '1px solid #374151',
                                borderRadius: 12,
                                padding: '0.75rem 0.9rem',
                                fontSize: '0.86rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                width: '100%',
                                textAlign: 'left',
                            }, children: "Abrir an\u00E1lise de d\u00EDvidas \u2192" }), children: [_jsxs("div", { style: { display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.9rem' }, children: [_jsxs("div", { style: { padding: '0.7rem 0.85rem', borderRadius: 12, background: 'rgba(248, 113, 113, 0.08)', border: '1px solid rgba(248, 113, 113, 0.18)' }, children: [_jsx("div", { style: { fontSize: '0.68rem', color: '#fca5a5', textTransform: 'uppercase', letterSpacing: '0.08em' }, children: "Vencidas" }), _jsx("div", { style: { marginTop: 4, fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }, children: overdueInvoices.length })] }), _jsxs("div", { style: { padding: '0.7rem 0.85rem', borderRadius: 12, background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.18)' }, children: [_jsx("div", { style: { fontSize: '0.68rem', color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.08em' }, children: "Em aberto" }), _jsx("div", { style: { marginTop: 4, fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }, children: invoiceCount })] })] }), loading ? (_jsx("div", { style: { color: '#94a3b8', fontSize: '0.85rem' }, children: "Carregando faturas..." })) : topInvoice ? (_jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.7rem' }, children: invoices.slice(0, 3).map((inv, i) => (_jsxs("div", { style: {
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        gap: '0.75rem',
                                        padding: '0.7rem 0',
                                        borderTop: i === 0 ? '1px solid #1e2130' : '1px solid #1e2130',
                                    }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: '0.86rem', fontWeight: 700, color: '#e5e7eb' }, children: inv.accountName }), _jsxs("div", { style: { fontSize: '0.72rem', color: '#94a3b8' }, children: [formatMonth(inv.invoiceMonth), " \u00B7 vence ", formatDueDate(inv.dueDate)] })] }), _jsxs("div", { style: { textAlign: 'right' }, children: [_jsx("div", { style: { fontSize: '0.9rem', fontWeight: 800, color: '#f8fafc' }, children: formatBRL(Number(inv.effectiveOpenAmountMinor)) }), _jsx("div", { style: { fontSize: '0.7rem', color: statusColor(inv.status), fontWeight: 700 }, children: inv.status === 'PAID' ? 'Pago' : inv.status === 'OVERDUE' ? 'Vencido' : 'Em aberto' })] })] }, `${inv.accountId}-${inv.invoiceMonth}-${i}`))) })) : (_jsx("div", { style: { color: '#94a3b8', fontSize: '0.85rem' }, children: "Nenhuma fatura em aberto." }))] }), _jsx(SectionCard, { eyebrow: "Editorias", title: "Caixa", subtitle: "Saldo operacional e contas correntes em destaque.", tone: totalBalance >= 0 ? 'green' : 'red', footer: _jsx("button", { onClick: () => navigate('/cashflow'), style: {
                                background: 'transparent',
                                color: '#e5e7eb',
                                border: '1px solid #374151',
                                borderRadius: 12,
                                padding: '0.75rem 0.9rem',
                                fontSize: '0.86rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                width: '100%',
                                textAlign: 'left',
                            }, children: "Ver fluxo de caixa \u2192" }), children: _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }, children: [_jsxs("div", { style: { padding: '0.85rem', borderRadius: 12, background: 'rgba(74, 222, 128, 0.08)', border: '1px solid rgba(74, 222, 128, 0.18)' }, children: [_jsx("div", { style: { fontSize: '0.68rem', color: '#86efac', textTransform: 'uppercase', letterSpacing: '0.08em' }, children: "L\u00EDquido" }), _jsx("div", { style: { marginTop: 4, fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }, children: loading ? '...' : formatBRL(liquidBalance) })] }), _jsxs("div", { style: { padding: '0.85rem', borderRadius: 12, background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.18)' }, children: [_jsx("div", { style: { fontSize: '0.68rem', color: '#93c5fd', textTransform: 'uppercase', letterSpacing: '0.08em' }, children: "Contas" }), _jsx("div", { style: { marginTop: 4, fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }, children: bankAccounts.length })] })] }) }), _jsx(SectionCard, { eyebrow: "Editorias", title: "Or\u00E7amento", subtitle: "\u00C1rea para simular compra, cortar gastos e medir impacto.", tone: "blue", footer: _jsx("button", { onClick: () => navigate('/budget'), style: {
                                background: 'transparent',
                                color: '#e5e7eb',
                                border: '1px solid #374151',
                                borderRadius: 12,
                                padding: '0.75rem 0.9rem',
                                fontSize: '0.86rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                width: '100%',
                                textAlign: 'left',
                            }, children: "Abrir or\u00E7amento \u2192" }), children: _jsx("div", { style: { color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.55 }, children: "Use esta editoria para responder \u201Cposso comprar isso agora?\u201D sem sair do painel." }) }), _jsx(SectionCard, { eyebrow: "Editorias", title: "Economias", subtitle: "Reserva, poupan\u00E7a e colch\u00E3o financeiro.", tone: "green", footer: _jsx("button", { onClick: () => navigate('/accounts'), style: {
                                background: 'transparent',
                                color: '#e5e7eb',
                                border: '1px solid #374151',
                                borderRadius: 12,
                                padding: '0.75rem 0.9rem',
                                fontSize: '0.86rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                width: '100%',
                                textAlign: 'left',
                            }, children: "Ver contas de reserva \u2192" }), children: _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }, children: [_jsxs("div", { style: { padding: '0.85rem', borderRadius: 12, background: 'rgba(74, 222, 128, 0.08)', border: '1px solid rgba(74, 222, 128, 0.18)' }, children: [_jsx("div", { style: { fontSize: '0.68rem', color: '#86efac', textTransform: 'uppercase', letterSpacing: '0.08em' }, children: "Poupan\u00E7a" }), _jsx("div", { style: { marginTop: 4, fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }, children: loading ? '...' : formatBRL(savingsBalance) })] }), _jsxs("div", { style: { padding: '0.85rem', borderRadius: 12, background: 'rgba(74, 222, 128, 0.08)', border: '1px solid rgba(74, 222, 128, 0.18)' }, children: [_jsx("div", { style: { fontSize: '0.68rem', color: '#86efac', textTransform: 'uppercase', letterSpacing: '0.08em' }, children: "Contas" }), _jsx("div", { style: { marginTop: 4, fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }, children: savingsAccounts.length })] })] }) }), _jsx(SectionCard, { eyebrow: "Editorias", title: "Investimentos", subtitle: "O que est\u00E1 aplicado fora do caixa.", tone: "violet", footer: _jsx("button", { onClick: () => navigate('/accounts'), style: {
                                background: 'transparent',
                                color: '#e5e7eb',
                                border: '1px solid #374151',
                                borderRadius: 12,
                                padding: '0.75rem 0.9rem',
                                fontSize: '0.86rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                                width: '100%',
                                textAlign: 'left',
                            }, children: "Conferir posi\u00E7\u00F5es \u2192" }), children: _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }, children: [_jsxs("div", { style: { padding: '0.85rem', borderRadius: 12, background: 'rgba(167, 139, 250, 0.08)', border: '1px solid rgba(167, 139, 250, 0.18)' }, children: [_jsx("div", { style: { fontSize: '0.68rem', color: '#c4b5fd', textTransform: 'uppercase', letterSpacing: '0.08em' }, children: "Aplicado" }), _jsx("div", { style: { marginTop: 4, fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }, children: loading ? '...' : formatBRL(investmentsBalance) })] }), _jsxs("div", { style: { padding: '0.85rem', borderRadius: 12, background: 'rgba(167, 139, 250, 0.08)', border: '1px solid rgba(167, 139, 250, 0.18)' }, children: [_jsx("div", { style: { fontSize: '0.68rem', color: '#c4b5fd', textTransform: 'uppercase', letterSpacing: '0.08em' }, children: "Posi\u00E7\u00F5es" }), _jsx("div", { style: { marginTop: 4, fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }, children: investmentAccounts.length })] })] }) }), _jsx(SectionCard, { eyebrow: "Editorias", title: "Alertas", subtitle: "O que pede decis\u00E3o antes de virar problema.", tone: negativeAccounts.length > 0 || overdueInvoices.length > 0 ? 'red' : 'amber', children: _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.75rem' }, children: [_jsxs("div", { style: { padding: '0.85rem', borderRadius: 12, background: 'rgba(248, 113, 113, 0.08)', border: '1px solid rgba(248, 113, 113, 0.18)' }, children: [_jsx("div", { style: { fontSize: '0.68rem', color: '#fca5a5', textTransform: 'uppercase', letterSpacing: '0.08em' }, children: "Itens cr\u00EDticos" }), _jsx("div", { style: { marginTop: 4, fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }, children: overdueInvoices.length + negativeAccounts.length })] }), _jsxs("div", { style: { color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.55 }, children: [overdueInvoices.length > 0
                                            ? `Há ${overdueInvoices.length} fatura${overdueInvoices.length !== 1 ? 's' : ''} vencida${overdueInvoices.length !== 1 ? 's' : ''}.`
                                            : 'Sem faturas vencidas no momento.', ' ', negativeAccounts.length > 0
                                            ? `${negativeAccounts.length} conta${negativeAccounts.length !== 1 ? 's' : ''} está(ão) negativa(s).`
                                            : 'Nenhuma conta negativa detectada.'] })] }) })] }), _jsx(SectionCard, { eyebrow: "Balancete", title: "Contas em destaque", subtitle: "As principais contas aparecem aqui como notas de rodap\u00E9 da edi\u00E7\u00E3o.", tone: "neutral", children: loading ? (_jsx("div", { style: { color: '#94a3b8', fontSize: '0.85rem' }, children: "Carregando contas..." })) : accounts.length === 0 ? (_jsxs("div", { style: { color: '#94a3b8', fontSize: '0.85rem' }, children: ["Nenhuma conta cadastrada.", ' ', _jsx("button", { onClick: () => navigate('/statements/upload'), style: { background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', padding: 0, fontSize: '0.85rem' }, children: "Importar extrato \u2192" })] })) : (_jsx("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }, children: accounts.slice(0, 8).map((acc) => (_jsxs("button", { onClick: () => navigate(`/accounts/${acc.id}`), style: {
                            background: '#0f1117',
                            border: '1px solid #1e2130',
                            borderRadius: 12,
                            padding: '0.85rem 1rem',
                            textAlign: 'left',
                            cursor: 'pointer',
                            transition: 'border-color 0.15s',
                        }, onMouseEnter: (e) => (e.currentTarget.style.borderColor = '#6366f1'), onMouseLeave: (e) => (e.currentTarget.style.borderColor = '#1e2130'), children: [_jsx("div", { style: { fontSize: '0.68rem', color: '#6b7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }, children: accountGroupLabel(acc.type) }), _jsx("div", { style: { fontSize: '0.875rem', fontWeight: 700, color: '#e5e7eb', marginBottom: 2 }, children: acc.name }), acc.institutionName && _jsx("div", { style: { fontSize: '0.72rem', color: '#9ca3af' }, children: acc.institutionName }), acc.currentBalanceMinor !== undefined && acc.type !== 'credit_card' && (_jsx("div", { style: {
                                    fontSize: '0.95rem',
                                    fontWeight: 800,
                                    color: acc.currentBalanceMinor >= 0 ? '#4ade80' : '#f87171',
                                    marginTop: 6,
                                }, children: formatBRL(acc.currentBalanceMinor) }))] }, acc.id))) })) }), _jsxs("div", { style: {
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                    gap: '1rem',
                    marginTop: '1rem',
                }, children: [_jsxs("button", { onClick: () => navigate('/statements/upload'), style: {
                            background: 'linear-gradient(180deg, rgba(20,22,36,0.98), rgba(15,17,23,0.98))',
                            border: '1px dashed #3b425c',
                            borderRadius: 18,
                            padding: '1rem 1.25rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            transition: 'border-color 0.15s',
                        }, onMouseEnter: (e) => (e.currentTarget.style.borderColor = '#6366f1'), onMouseLeave: (e) => (e.currentTarget.style.borderColor = '#3b425c'), children: [_jsx("span", { style: { fontSize: '1.3rem' }, children: "\uD83E\uDDFE" }), _jsxs("div", { style: { textAlign: 'left' }, children: [_jsx("div", { style: { fontWeight: 700, fontSize: '0.875rem', color: '#e5e7eb' }, children: "Importar extrato" }), _jsx("div", { style: { fontSize: '0.72rem', color: '#6b7280' }, children: "OFX, CSV ou PDF banc\u00E1rio" })] })] }), _jsxs("button", { onClick: () => navigate('/invoices/upload'), style: {
                            background: 'linear-gradient(180deg, rgba(20,22,36,0.98), rgba(15,17,23,0.98))',
                            border: '1px dashed #3b425c',
                            borderRadius: 18,
                            padding: '1rem 1.25rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            transition: 'border-color 0.15s',
                        }, onMouseEnter: (e) => (e.currentTarget.style.borderColor = '#6366f1'), onMouseLeave: (e) => (e.currentTarget.style.borderColor = '#3b425c'), children: [_jsx("span", { style: { fontSize: '1.3rem' }, children: "\uD83D\uDCE4" }), _jsxs("div", { style: { textAlign: 'left' }, children: [_jsx("div", { style: { fontWeight: 700, fontSize: '0.875rem', color: '#e5e7eb' }, children: "Importar fatura" }), _jsx("div", { style: { fontSize: '0.72rem', color: '#6b7280' }, children: "PDF de cart\u00E3o de cr\u00E9dito" })] })] })] })] }));
}

import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { Alert, Badge, Card, EmptyState, SectionTitle, Spinner } from '../components/ui';
export function Accounts() {
    const [accounts, setAccounts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState('');
    const navigate = useNavigate();
    async function loadAccounts() {
        setLoading(true);
        setErrorMsg('');
        try {
            const result = await api.accounts.list();
            setAccounts(result.items);
        }
        catch (error) {
            setErrorMsg(error instanceof Error ? error.message : 'Erro ao carregar contas');
        }
        finally {
            setLoading(false);
        }
    }
    useEffect(() => {
        loadAccounts().catch(() => { });
    }, []);
    const hasAccounts = useMemo(() => accounts.length > 0, [accounts]);
    const bankAccounts = useMemo(() => accounts.filter((account) => account.financialChannel === 'bank_account'), [accounts]);
    const invoiceAccounts = useMemo(() => accounts.filter((account) => account.financialChannel === 'credit_card'), [accounts]);
    function renderAccountCard(account) {
        const totalMonths = new Set([
            ...account.invoiceMonths.map((m) => m.month),
            ...account.bankMonths.map((m) => m.month),
            ...account.receiptMonths.map((m) => m.month),
        ]).size;
        return (_jsx(Card, { style: { cursor: 'pointer', transition: 'border-color 0.15s' }, className: "account-card", onClick: () => navigate(`/accounts/${account.id}`), children: _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }, children: [_jsxs("div", { children: [_jsx(SectionTitle, { style: { marginBottom: '0.3rem' }, children: account.displayName }), _jsxs("div", { style: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }, children: [_jsx(Badge, { variant: "blue", children: account.financialChannel }), _jsx(Badge, { variant: "gray", children: account.type }), account.institutionName && _jsx(Badge, { variant: "gray", children: account.institutionName }), account.cardBrand && _jsx(Badge, { variant: "gray", children: account.cardBrand }), account.cardLast4 && _jsxs(Badge, { variant: "gray", children: ["**** ", account.cardLast4] })] })] }), _jsxs("div", { style: { fontSize: '0.8rem', color: '#9ca3af', textAlign: 'right' }, children: [_jsxs("div", { children: [totalMonths, " ", totalMonths === 1 ? 'mês' : 'meses'] }), _jsx("div", { style: { marginTop: '0.15rem', color: '#6366f1', fontSize: '0.78rem' }, children: "Ver detalhes \u2192" })] })] }) }, account.id));
    }
    return (_jsxs("div", { style: { maxWidth: 960 }, children: [_jsxs("div", { style: { marginBottom: '1.5rem' }, children: [_jsx("h1", { style: { fontSize: '1.4rem', fontWeight: 800, color: '#e5e7eb', margin: 0 }, children: "Contas" }), _jsx("p", { style: { color: '#6b7280', marginTop: '0.3rem', fontSize: '0.85rem' }, children: "Contas ativas com extratos, faturas ou notas vinculadas. Clique em uma conta para ver os meses." })] }), loading && (_jsx(Card, { style: { textAlign: 'center', padding: '2.5rem' }, children: _jsx(Spinner, { size: 36 }) })), !loading && errorMsg && (_jsx(Alert, { variant: "error", style: { marginBottom: '1rem' }, children: errorMsg })), !loading && !hasAccounts && (_jsx(Card, { children: _jsx(EmptyState, { icon: "\uD83C\uDFE6", title: "Nenhuma conta ativa", description: "Importe um extrato bancario ou uma fatura de cartao para ver contas aqui." }) })), !loading && hasAccounts && (_jsxs("div", { style: { display: 'grid', gap: '1rem' }, children: [_jsxs("div", { children: [_jsx("h2", { style: { fontSize: '1rem', margin: '0 0 0.6rem 0', color: '#c7d2fe', fontWeight: 700 }, children: "Contas banc\u00E1rias (extratos)" }), _jsx("div", { style: { display: 'grid', gap: '0.8rem' }, children: bankAccounts.length > 0 ? (bankAccounts.map((account) => renderAccountCard(account))) : (_jsx(Card, { children: _jsx(EmptyState, { icon: "\uD83C\uDFE6", title: "Sem extratos bancarios", description: "Nenhum extrato importado para o usuario ativo." }) })) })] }), _jsxs("div", { style: { marginTop: '0.4rem' }, children: [_jsx("h2", { style: { fontSize: '1rem', margin: '0 0 0.6rem 0', color: '#c7d2fe', fontWeight: 700 }, children: "Faturas de cart\u00E3o" }), _jsx("div", { style: { display: 'grid', gap: '0.8rem' }, children: invoiceAccounts.length > 0 ? (invoiceAccounts.map((account) => renderAccountCard(account))) : (_jsx(Card, { children: _jsx(EmptyState, { icon: "\uD83D\uDCB3", title: "Sem faturas de cartao", description: "Nenhuma fatura importada para o usuario ativo." }) })) })] })] }))] }));
}

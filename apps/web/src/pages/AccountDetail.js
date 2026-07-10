import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, formatBRL, } from '../services/api';
import { Alert, Badge, Button, Card, Spinner } from '../components/ui';
import { InvoicePaymentSelector, buildInvoicePaymentOptions, formatInvoicePaymentLabel } from '../components/InvoicePaymentSelector';
import { buildCategoryOptions } from '../utils/categoryOptions';
function getAllMonths(acc) {
    const set = new Set();
    for (const m of acc.bankMonths)
        set.add(m.month);
    for (const m of acc.invoiceMonths)
        set.add(m.month);
    for (const m of acc.receiptMonths)
        set.add(m.month);
    return Array.from(set).sort((a, b) => b.localeCompare(a));
}
function normalizeCategoryText(value) {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}
function isCreditCardInvoiceCategoryId(categoryId, categories) {
    if (!categoryId)
        return false;
    const byId = new Map(categories.map((category) => [category.id, category]));
    let current = byId.get(categoryId) ?? null;
    let sawInvoice = false;
    let sawCard = false;
    while (current) {
        const text = normalizeCategoryText(`${current.name} ${current.slug ?? ''}`);
        if (/fatura/.test(text))
            sawInvoice = true;
        if (/cartao|credito/.test(text))
            sawCard = true;
        current = current.parentId ? byId.get(current.parentId) ?? null : null;
    }
    return sawInvoice && sawCard;
}
function getInvoiceComponentLabel(componentType) {
    if (componentType === 'installment_principal')
        return 'Parcelamento';
    if (componentType === 'iof')
        return 'IOF';
    if (componentType === 'finance_charge')
        return 'Encargo financeiro';
    if (componentType === 'fee')
        return 'Tarifa';
    if (componentType === 'previous_balance')
        return 'Saldo anterior';
    if (componentType === 'payment_received')
        return 'Pagamento recebido';
    if (componentType === 'credits_and_refunds')
        return 'Créditos e estornos';
    if (componentType === 'monthly_expenses')
        return 'Compras do mês';
    if (componentType === 'charges_total')
        return 'Encargos totais';
    if (componentType === 'financed_balance')
        return 'Saldo financiado';
    if (componentType === 'total_invoice')
        return 'Total da fatura';
    return componentType;
}
function InvoiceComponentsPanel({ installments, fees, progress, }) {
    if (installments.length === 0 && fees.length === 0)
        return null;
    return (_jsxs(Card, { style: { marginBottom: '1rem', border: '1px solid #334155', background: '#10121a' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.85rem' }, children: [_jsxs("div", { children: [_jsx("p", { style: { margin: 0, color: '#fbbf24', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4 }, children: "Componentes da fatura" }), _jsx("p", { style: { margin: '0.25rem 0 0', color: '#e5e7eb', fontWeight: 700, fontSize: '0.92rem' }, children: "Parcelamentos, encargos e taxas s\u00E3o guardados em separado da lista principal" })] }), _jsx("div", { style: { color: '#9ca3af', fontSize: '0.78rem', alignSelf: 'flex-end' }, children: "Tudo isso continua vinculado \u00E0 mesma fatura" })] }), progress && progress.seriesCount > 0 && (_jsxs("div", { style: {
                    marginBottom: '1rem',
                    padding: '0.9rem',
                    border: '1px solid #243042',
                    borderRadius: 12,
                    background: '#0f1117',
                }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.45rem' }, children: [_jsxs("div", { children: [_jsx("div", { style: { color: '#e5e7eb', fontSize: '0.86rem', fontWeight: 800 }, children: "Progresso total dos parcelamentos" }), _jsx("div", { style: { color: '#94a3b8', fontSize: '0.75rem' }, children: "Barra agregada das s\u00E9ries vis\u00EDveis nesta fatura" })] }), _jsxs("div", { style: { color: '#cbd5e1', fontSize: '0.8rem', fontWeight: 700, alignSelf: 'center' }, children: [Math.round(progress.progressPct * 100), "% \u00B7 ", progress.seriesCount, " s\u00E9rie(s) \u00B7 ", progress.withPositionCount, " item(ns) com parcela identificada"] })] }), _jsx("div", { style: { height: 10, borderRadius: 999, background: '#1f2937', overflow: 'hidden' }, children: _jsx("div", { style: {
                                width: `${Math.max(0, Math.min(100, Math.round(progress.progressPct * 100)))}%`,
                                height: '100%',
                                borderRadius: 999,
                                background: 'linear-gradient(90deg, #6366f1 0%, #22c55e 100%)',
                                transition: 'width 0.2s ease',
                            } }) })] })), installments.length > 0 && (_jsxs("div", { style: { marginBottom: fees.length > 0 ? '1rem' : 0 }, children: [_jsx("div", { style: { color: '#e5e7eb', fontSize: '0.86rem', fontWeight: 700, marginBottom: '0.5rem' }, children: "Parcelamentos detectados" }), _jsx("div", { style: { overflowX: 'auto' }, children: _jsxs("table", { style: { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', tableLayout: 'fixed' }, children: [_jsx("thead", { children: _jsxs("tr", { style: { color: '#6b7280', borderBottom: '1px solid #2a2f45', background: '#0f1117' }, children: [_jsx("th", { style: { padding: '0.5rem', textAlign: 'left' }, children: "Descri\u00E7\u00E3o" }), _jsx("th", { style: { padding: '0.5rem', width: 100, textAlign: 'left' }, children: "Parcela" }), _jsx("th", { style: { padding: '0.5rem', width: 104, textAlign: 'left' }, children: "Data" }), _jsx("th", { style: { padding: '0.5rem', width: 110, textAlign: 'right' }, children: "Valor" })] }) }), _jsx("tbody", { children: installments.map((item, index) => (_jsxs("tr", { style: { borderBottom: '1px solid #1a1e2e' }, children: [_jsx("td", { style: { padding: '0.55rem 0.5rem', color: '#e5e7eb', overflowWrap: 'anywhere' }, children: item.description }), _jsx("td", { style: { padding: '0.55rem 0.5rem', color: '#cbd5e1', whiteSpace: 'nowrap' }, children: item.installmentNumber && item.installmentTotal ? `${item.installmentNumber}/${item.installmentTotal}` : '—' }), _jsx("td", { style: { padding: '0.55rem 0.5rem', color: '#9ca3af', whiteSpace: 'nowrap' }, children: item.sourceDate ? String(item.sourceDate).slice(0, 10) : '—' }), _jsx("td", { style: { padding: '0.55rem 0.5rem', textAlign: 'right', color: '#f87171', fontWeight: 700, whiteSpace: 'nowrap' }, children: formatBRL(item.amountMinor) })] }, `${item.id}-${index}`))) })] }) })] })), fees.length > 0 && (_jsxs("div", { children: [_jsx("div", { style: { color: '#e5e7eb', fontSize: '0.86rem', fontWeight: 700, marginBottom: '0.5rem' }, children: "Encargos, IOF e taxas" }), _jsx("div", { style: { overflowX: 'auto' }, children: _jsxs("table", { style: { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', tableLayout: 'fixed' }, children: [_jsx("thead", { children: _jsxs("tr", { style: { color: '#6b7280', borderBottom: '1px solid #2a2f45', background: '#0f1117' }, children: [_jsx("th", { style: { padding: '0.5rem', width: 170, textAlign: 'left' }, children: "Tipo" }), _jsx("th", { style: { padding: '0.5rem', textAlign: 'left' }, children: "Descri\u00E7\u00E3o" }), _jsx("th", { style: { padding: '0.5rem', width: 104, textAlign: 'left' }, children: "Data" }), _jsx("th", { style: { padding: '0.5rem', width: 110, textAlign: 'right' }, children: "Valor" })] }) }), _jsx("tbody", { children: fees.map((item, index) => (_jsxs("tr", { style: { borderBottom: '1px solid #1a1e2e' }, children: [_jsx("td", { style: { padding: '0.55rem 0.5rem', color: '#cbd5e1', whiteSpace: 'nowrap' }, children: getInvoiceComponentLabel(item.componentType) }), _jsx("td", { style: { padding: '0.55rem 0.5rem', color: '#e5e7eb', overflowWrap: 'anywhere' }, children: item.description ?? '—' }), _jsx("td", { style: { padding: '0.55rem 0.5rem', color: '#9ca3af', whiteSpace: 'nowrap' }, children: item.sourceDate ? String(item.sourceDate).slice(0, 10) : '—' }), _jsx("td", { style: { padding: '0.55rem 0.5rem', textAlign: 'right', color: '#f87171', fontWeight: 700, whiteSpace: 'nowrap' }, children: formatBRL(item.amountMinor) })] }, `${item.id}-${index}`))) })] }) })] }))] }));
}
export function AccountDetail() {
    const { accountId } = useParams();
    const navigate = useNavigate();
    const [account, setAccount] = useState(null);
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState('');
    const [activeMonth, setActiveMonth] = useState('');
    const [deleting, setDeleting] = useState(false);
    const [invoiceDetails, setInvoiceDetails] = useState(null);
    const [invoiceLoading, setInvoiceLoading] = useState(false);
    const [invoiceError, setInvoiceError] = useState('');
    const [statementDetails, setStatementDetails] = useState(null);
    const [statementLoading, setStatementLoading] = useState(false);
    const [statementError, setStatementError] = useState('');
    const [openInvoices, setOpenInvoices] = useState([]);
    const [categories, setCategories] = useState([]);
    const [updatingTxId, setUpdatingTxId] = useState(null);
    const [linkingPaymentId, setLinkingPaymentId] = useState(null);
    async function loadAccount(keepActiveMonth = false) {
        setLoading(true);
        setErrorMsg('');
        try {
            const result = await api.accounts.list();
            const found = result.items.find((a) => a.id === Number(accountId));
            if (!found) {
                setErrorMsg('Conta não encontrada.');
                return;
            }
            setAccount(found);
            if (!keepActiveMonth) {
                const months = getAllMonths(found);
                if (months.length > 0)
                    setActiveMonth(months[0]);
            }
        }
        catch (error) {
            setErrorMsg(error instanceof Error ? error.message : 'Erro ao carregar conta');
        }
        finally {
            setLoading(false);
        }
    }
    useEffect(() => {
        loadAccount().catch(() => { });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accountId]);
    useEffect(() => {
        api.categories.list().then(setCategories).catch(() => { });
    }, []);
    useEffect(() => {
        api.accounts.openCardInvoices().then((result) => setOpenInvoices(result.items)).catch(() => { });
    }, []);
    useEffect(() => {
        if (!account || !activeMonth) {
            setInvoiceDetails(null);
            return;
        }
        const accountIdValue = account.id;
        let cancelled = false;
        async function loadInvoice() {
            setInvoiceLoading(true);
            setInvoiceError('');
            try {
                const details = await api.accounts.invoiceDetails(accountIdValue, activeMonth);
                if (!cancelled)
                    setInvoiceDetails(details);
            }
            catch (error) {
                if (!cancelled) {
                    setInvoiceDetails(null);
                    setInvoiceError(error instanceof Error ? error.message : 'Erro ao carregar fatura');
                }
            }
            finally {
                if (!cancelled)
                    setInvoiceLoading(false);
            }
        }
        loadInvoice().catch(() => { });
        return () => {
            cancelled = true;
        };
    }, [account, activeMonth]);
    useEffect(() => {
        if (!account || !activeMonth) {
            setStatementDetails(null);
            return;
        }
        const accountIdValue = account.id;
        let cancelled = false;
        async function loadStatement() {
            setStatementLoading(true);
            setStatementError('');
            try {
                const details = await api.accounts.statementDetails(accountIdValue, activeMonth);
                if (!cancelled)
                    setStatementDetails(details);
            }
            catch (error) {
                if (!cancelled) {
                    setStatementDetails(null);
                    setStatementError(error instanceof Error ? error.message : 'Erro ao carregar extrato');
                }
            }
            finally {
                if (!cancelled)
                    setStatementLoading(false);
            }
        }
        loadStatement().catch(() => { });
        return () => {
            cancelled = true;
        };
    }, [account, activeMonth]);
    async function handleDeleteMonth() {
        if (!account || !activeMonth)
            return;
        const ok = window.confirm(`Excluir todos os dados de ${activeMonth} para "${account.displayName}"?\nEsta ação não pode ser desfeita.`);
        if (!ok)
            return;
        setDeleting(true);
        setErrorMsg('');
        try {
            const result = await api.accounts.deleteByMonth(account.id, activeMonth);
            if (!result.hasRemainingData) {
                navigate('/accounts');
                return;
            }
            // reload and pick the next available month
            const updatedResult = await api.accounts.list();
            const updated = updatedResult.items.find((a) => a.id === account.id);
            if (!updated) {
                navigate('/accounts');
                return;
            }
            setAccount(updated);
            const months = getAllMonths(updated);
            setActiveMonth(months[0] ?? '');
        }
        catch (error) {
            setErrorMsg(error instanceof Error ? error.message : 'Erro ao excluir mês');
        }
        finally {
            setDeleting(false);
            setLoading(false);
        }
    }
    async function handleCategoryChange(cardTransactionId, newCategoryId) {
        setUpdatingTxId(cardTransactionId);
        setInvoiceError('');
        try {
            const updated = await api.accounts.updateCardTransactionCategory(cardTransactionId, newCategoryId || null);
            const shouldShowInvoiceSelector = isCreditCardInvoiceCategoryId(updated.categoryId, categories);
            setInvoiceDetails((prev) => {
                if (!prev)
                    return prev;
                return {
                    ...prev,
                    transactions: prev.transactions.map((tx) => tx.id === cardTransactionId
                        ? {
                            ...tx,
                            categoryId: updated.categoryId,
                            categoryName: updated.categoryName,
                            cardInvoiceId: shouldShowInvoiceSelector ? tx.cardInvoiceId : null,
                            settledInvoice: shouldShowInvoiceSelector ? tx.settledInvoice : null,
                            settlementAllocatedMinor: shouldShowInvoiceSelector ? tx.settlementAllocatedMinor : null,
                        }
                        : tx),
                };
            });
        }
        catch (error) {
            setInvoiceError(error instanceof Error ? error.message : 'Erro ao atualizar categoria');
        }
        finally {
            setUpdatingTxId(null);
        }
    }
    async function handleBankCategoryChange(transactionId, newCategoryId) {
        setUpdatingTxId(transactionId);
        try {
            const updated = await api.accounts.updateBankTransactionCategory(transactionId, newCategoryId || null);
            const shouldShowInvoiceSelector = isCreditCardInvoiceCategoryId(updated.categoryId, categories);
            const currentTx = statementDetails?.transactions.find((tx) => tx.id === transactionId) ?? null;
            if (!shouldShowInvoiceSelector && currentTx?.cardInvoiceId) {
                await api.accounts.updateBankTransactionCardInvoice(transactionId, null);
            }
            setStatementDetails((prev) => {
                if (!prev)
                    return prev;
                return {
                    ...prev,
                    transactions: prev.transactions.map((tx) => tx.id === transactionId
                        ? {
                            ...tx,
                            categoryId: updated.categoryId,
                            categoryName: updated.categoryName,
                            cardInvoiceId: shouldShowInvoiceSelector ? tx.cardInvoiceId : null,
                            settledInvoice: shouldShowInvoiceSelector ? tx.settledInvoice : null,
                            settlementAllocatedMinor: shouldShowInvoiceSelector ? tx.settlementAllocatedMinor : null,
                        }
                        : tx),
                };
            });
        }
        catch {
            // silently keep previous value
        }
        finally {
            setUpdatingTxId(null);
        }
    }
    function getMovementTypeLabel(movementType) {
        if (movementType === 'income')
            return 'Receita';
        if (movementType === 'expense')
            return 'Despesa';
        if (movementType === 'transfer')
            return 'Transferencia';
        return movementType;
    }
    function isCategoryEditableForBankTransaction(movementType, movementSubtype) {
        if (movementType === 'transfer')
            return false;
        if (movementSubtype === 'investment_redeem')
            return false;
        if (movementSubtype === 'investment_apply')
            return false;
        return true;
    }
    const occupiedInvoiceIds = useMemo(() => {
        const ids = new Set();
        for (const tx of statementDetails?.transactions ?? []) {
            if (typeof tx.cardInvoiceId === 'number' && tx.cardInvoiceId > 0) {
                ids.add(tx.cardInvoiceId);
            }
        }
        for (const tx of invoiceDetails?.transactions ?? []) {
            if (typeof tx.cardInvoiceId === 'number' && tx.cardInvoiceId > 0) {
                ids.add(tx.cardInvoiceId);
            }
        }
        return ids;
    }, [statementDetails, invoiceDetails]);
    function getAvailableInvoiceOptions(currentInvoiceId, currentInvoiceSummary, occupiedInvoiceIds, cardInvoiceSummary) {
        // Prioridade: settledInvoice > cardInvoiceSummary (do backend) > procura em openInvoices
        const currentInvoice = currentInvoiceSummary
            ?? cardInvoiceSummary
            ?? (currentInvoiceId
                ? openInvoices.find((invoice) => invoice.id === currentInvoiceId) ?? null
                : null);
        // Se a fatura está associada mas já foi paga (não está em openInvoices),
        // criamos uma opção de fallback para que o dropdown mostre a associação existente
        const currentOption = currentInvoice
            ? {
                id: currentInvoice.id,
                label: formatInvoicePaymentLabel(currentInvoice),
            }
            : currentInvoiceId
                ? {
                    id: currentInvoiceId,
                    label: `Fatura #${currentInvoiceId} (já associada)`,
                }
                : null;
        const availableInvoices = openInvoices.filter((invoice) => invoice.id === currentInvoiceId || !occupiedInvoiceIds.has(invoice.id));
        return buildInvoicePaymentOptions(currentOption, availableInvoices);
    }
    async function handleStatementInvoiceChange(transactionId, cardInvoiceId) {
        setLinkingPaymentId(transactionId);
        try {
            await api.accounts.updateBankTransactionCardInvoice(transactionId, cardInvoiceId);
            if (account && activeMonth) {
                const [updatedInvoice, updatedStatement, updatedOpenInvoices] = await Promise.all([
                    api.accounts.invoiceDetails(account.id, activeMonth),
                    api.accounts.statementDetails(account.id, activeMonth),
                    api.accounts.openCardInvoices(),
                ]);
                setInvoiceDetails(updatedInvoice);
                setStatementDetails(updatedStatement);
                setOpenInvoices(updatedOpenInvoices.items);
            }
        }
        catch (error) {
            setStatementError(error instanceof Error ? error.message : 'Erro ao vincular fatura');
        }
        finally {
            setLinkingPaymentId(null);
        }
    }
    // Estrutura hierarquicamente as categorias para exibição prática
    const getCategoryOptions = (type) => buildCategoryOptions(categories, type).map((option) => ({
        id: option.id,
        label: option.label,
        isParent: option.disabled,
    }));
    const months = account ? getAllMonths(account) : [];
    const bankEntry = account?.bankMonths.find((m) => m.month === activeMonth);
    const invoiceEntry = account?.invoiceMonths.find((m) => m.month === activeMonth);
    const invoiceComponents = invoiceDetails?.components ?? [];
    const invoiceInstallments = invoiceComponents.filter((item) => item.componentScope === 'line_item' && item.componentType === 'installment_principal');
    const invoiceFees = invoiceComponents.filter((item) => item.componentScope === 'line_item' && item.componentType !== 'installment_principal');
    const invoiceVisibleTransactions = (invoiceDetails?.transactions ?? []).filter((tx) => !(tx.installmentNumber && tx.installmentTotal));
    const invoiceInstallmentProgress = useMemo(() => {
        const grouped = new Map();
        for (const item of invoiceInstallments) {
            if (!item.installmentNumber || !item.installmentTotal || item.installmentTotal <= 0)
                continue;
            const key = `${item.description ?? ''}::${item.installmentTotal}`;
            const current = grouped.get(key) ?? { current: 0, total: 0 };
            current.current += Math.min(item.installmentNumber, item.installmentTotal);
            current.total += item.installmentTotal;
            grouped.set(key, current);
        }
        if (grouped.size === 0)
            return null;
        let weightedProgress = 0;
        let weightedTotal = 0;
        for (const entry of grouped.values()) {
            const ratio = entry.total > 0 ? entry.current / entry.total : 0;
            weightedProgress += ratio * entry.total;
            weightedTotal += entry.total;
        }
        return {
            progressPct: weightedTotal > 0 ? weightedProgress / weightedTotal : 0,
            seriesCount: grouped.size,
            withPositionCount: invoiceInstallments.filter((item) => item.installmentNumber && item.installmentTotal).length,
        };
    }, [invoiceInstallments]);
    const previousInvoiceOpenMinor = invoiceDetails?.invoice
        ? Math.max(0, invoiceDetails.invoice.previousBalanceMinor - invoiceDetails.invoice.paidAmountMinor)
        : 0;
    const liabilityPayments = statementDetails?.transactions.filter((tx) => tx.movementType === 'liability_payment') ?? [];
    return (_jsxs("div", { style: { width: '100%', maxWidth: 1200 }, children: [_jsx("div", { style: { marginBottom: '1.25rem' }, children: _jsx("button", { onClick: () => navigate('/accounts'), style: {
                        background: 'none',
                        border: 'none',
                        color: '#6366f1',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                        fontWeight: 600,
                        padding: '0.25rem 0',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                    }, children: "\u2190 Contas" }) }), loading && (_jsx(Card, { style: { textAlign: 'center', padding: '2.5rem' }, children: _jsx(Spinner, { size: 36 }) })), !loading && errorMsg && (_jsx(Alert, { variant: "error", style: { marginBottom: '1rem' }, children: errorMsg })), !loading && account && (_jsxs(_Fragment, { children: [_jsxs(Card, { style: { marginBottom: '1.25rem' }, children: [_jsx("h1", { style: { fontSize: '1.25rem', fontWeight: 800, color: '#e5e7eb', margin: '0 0 0.6rem' }, children: account.displayName }), _jsxs("div", { style: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }, children: [_jsx(Badge, { variant: "blue", children: account.financialChannel }), _jsx(Badge, { variant: "gray", children: account.type }), account.institutionName && _jsx(Badge, { variant: "gray", children: account.institutionName }), account.cardBrand && _jsx(Badge, { variant: "gray", children: account.cardBrand }), account.cardLast4 && _jsxs(Badge, { variant: "gray", children: ["**** ", account.cardLast4] })] })] }), months.length === 0 ? (_jsx(Card, { children: _jsx("p", { style: { color: '#6b7280', textAlign: 'center', margin: 0 }, children: "Nenhum dado encontrado para esta conta." }) })) : (_jsxs(Card, { children: [_jsx("div", { style: {
                                    display: 'flex',
                                    gap: 0,
                                    flexWrap: 'wrap',
                                    borderBottom: '1px solid #2a2f45',
                                    marginBottom: '1.5rem',
                                }, children: months.map((month) => {
                                    const isActive = month === activeMonth;
                                    return (_jsx("button", { onClick: () => setActiveMonth(month), style: {
                                            background: 'none',
                                            border: 'none',
                                            borderBottom: isActive ? '2px solid #6366f1' : '2px solid transparent',
                                            color: isActive ? '#6366f1' : '#9ca3af',
                                            cursor: 'pointer',
                                            padding: '0.5rem 1rem',
                                            fontSize: '0.88rem',
                                            fontWeight: isActive ? 700 : 400,
                                            marginBottom: '-1px',
                                            transition: 'color 0.15s',
                                            whiteSpace: 'nowrap',
                                        }, children: month }, month));
                                }) }), _jsxs("div", { style: {
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'flex-end',
                                    flexWrap: 'wrap',
                                    gap: '1.5rem',
                                }, children: [_jsxs("div", { style: { display: 'flex', gap: '2.5rem', flexWrap: 'wrap' }, children: [_jsxs("div", { children: [_jsx("div", { style: { color: '#6b7280', fontSize: '0.75rem', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }, children: "Transa\u00E7\u00F5es banc\u00E1rias" }), _jsx("div", { style: { color: '#e5e7eb', fontSize: '2rem', fontWeight: 700, lineHeight: 1 }, children: bankEntry?.count ?? 0 })] }), _jsxs("div", { children: [_jsx("div", { style: { color: '#6b7280', fontSize: '0.75rem', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }, children: "Lan\u00E7amentos de fatura" }), _jsx("div", { style: { color: '#e5e7eb', fontSize: '2rem', fontWeight: 700, lineHeight: 1 }, children: invoiceEntry?.count ?? 0 })] })] }), _jsx(Button, { variant: "danger", onClick: handleDeleteMonth, disabled: deleting, children: deleting ? 'Excluindo...' : `Excluir ${activeMonth}` })] }), _jsxs("div", { style: { marginTop: '1.6rem', borderTop: '1px solid #2a2f45', paddingTop: '1rem' }, children: [_jsx("h3", { style: { margin: 0, color: '#e5e7eb', fontSize: '1rem', fontWeight: 700 }, children: "Extrato do m\u00EAs" }), statementLoading && (_jsx("div", { style: { marginTop: '0.8rem', color: '#9ca3af', fontSize: '0.85rem' }, children: "Carregando extrato banc\u00E1rio..." })), !statementLoading && statementError && (_jsx(Alert, { variant: "error", style: { marginTop: '0.8rem' }, children: statementError })), !statementLoading && !statementError && (statementDetails?.transactions.length ?? 0) === 0 && (_jsx("p", { style: { margin: '0.8rem 0 0', color: '#9ca3af', fontSize: '0.85rem' }, children: "Este m\u00EAs n\u00E3o possui extrato importado para esta conta." })), !statementLoading && !statementError && (statementDetails?.transactions.length ?? 0) > 0 && (_jsx("div", { style: { marginTop: '1rem' }, children: _jsxs("table", { style: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }, children: [_jsx("thead", { children: _jsxs("tr", { style: { borderBottom: '1px solid #2a2f45', textAlign: 'left' }, children: [_jsx("th", { style: { padding: '0.5rem', width: 92, color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }, children: "Data" }), _jsx("th", { style: { padding: '0.5rem', color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }, children: "Descri\u00E7\u00E3o" }), _jsx("th", { style: { padding: '0.5rem', width: 220, color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }, children: "Categoria" }), _jsx("th", { style: { padding: '0.5rem', width: 280, color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }, children: "Fatura" }), _jsx("th", { style: { padding: '0.5rem', width: 112, color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }, children: "Tipo" }), _jsx("th", { style: { padding: '0.5rem', width: 110, color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600, textAlign: 'right' }, children: "Valor" })] }) }), _jsx("tbody", { children: statementDetails.transactions.map((tx) => (_jsxs("tr", { style: { borderBottom: '1px solid #1f2436' }, children: [_jsx("td", { style: { padding: '0.5rem', color: '#cbd5e1', fontSize: '0.82rem', whiteSpace: 'nowrap' }, children: String(tx.occurredAt).slice(0, 10) }), _jsx("td", { style: { padding: '0.5rem', color: '#f3f4f6', fontSize: '0.84rem', overflowWrap: 'anywhere' }, children: tx.description }), _jsx("td", { style: { padding: '0.5rem', color: '#94a3b8', fontSize: '0.8rem' }, children: isCategoryEditableForBankTransaction(tx.movementType, tx.movementSubtype) ? (_jsxs("select", { value: tx.categoryId ?? '', disabled: updatingTxId === tx.id, onChange: (e) => handleBankCategoryChange(tx.id, e.target.value), style: {
                                                                        background: '#0f1117',
                                                                        border: '1px solid #2a2f45',
                                                                        borderRadius: 6,
                                                                        padding: '4px 8px',
                                                                        color: '#e5e7eb',
                                                                        fontSize: '0.78rem',
                                                                        width: '100%',
                                                                        minWidth: 0,
                                                                        fontFamily: 'monospace',
                                                                    }, children: [_jsx("option", { value: "", children: "Sem categoria" }), getCategoryOptions(tx.amountMinor >= 0 ? 'income' : 'expense').map((opt) => (_jsx("option", { value: opt.id, disabled: opt.isParent, style: {
                                                                                fontWeight: opt.isParent ? 'bold' : 'normal',
                                                                                color: opt.isParent ? '#94a3b8' : '#e5e7eb',
                                                                            }, children: opt.label }, opt.id)))] })) : (_jsx("span", { style: { color: '#94a3b8' }, children: tx.categoryName ?? 'Nao editavel' })) }), _jsx("td", { style: { padding: '0.5rem', color: '#94a3b8', fontSize: '0.8rem', verticalAlign: 'top' }, children: tx.movementType === 'liability_payment' || isCreditCardInvoiceCategoryId(tx.categoryId, categories) ? (_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 4 }, children: [_jsx(InvoicePaymentSelector, { value: tx.cardInvoiceId ?? null, options: getAvailableInvoiceOptions(tx.cardInvoiceId ?? null, tx.settledInvoice, occupiedInvoiceIds, tx.cardInvoiceSummary), disabled: linkingPaymentId === tx.id, onChange: (invoiceId) => handleStatementInvoiceChange(tx.id, invoiceId), style: { width: '100%', minWidth: 0 } }), tx.settledInvoice && (_jsx("span", { style: { color: '#94a3b8', fontSize: '0.72rem', whiteSpace: 'nowrap' }, children: formatBRL(tx.settlementAllocatedMinor ?? 0) }))] })) : (_jsx("span", { style: { color: '#475569' }, children: "\u2014" })) }), _jsx("td", { style: { padding: '0.5rem', color: '#94a3b8', fontSize: '0.8rem', whiteSpace: 'nowrap' }, children: _jsx(Badge, { variant: tx.movementType === 'income' ? 'green' : tx.movementType === 'transfer' ? 'blue' : 'gray', children: getMovementTypeLabel(tx.movementType) }) }), _jsx("td", { style: {
                                                                    padding: '0.5rem',
                                                                    color: tx.amountMinor < 0 ? '#f87171' : '#4ade80',
                                                                    fontSize: '0.85rem',
                                                                    textAlign: 'right',
                                                                    fontWeight: 600,
                                                                    whiteSpace: 'nowrap',
                                                                }, children: formatBRL(tx.amountMinor) })] }, tx.id))) })] }) }))] }), _jsxs("div", { style: { marginTop: '1.6rem', borderTop: '1px solid #2a2f45', paddingTop: '1rem' }, children: [_jsx("h3", { style: { margin: 0, color: '#e5e7eb', fontSize: '1rem', fontWeight: 700 }, children: "Fatura do m\u00EAs" }), invoiceLoading && (_jsx("div", { style: { marginTop: '0.8rem', color: '#9ca3af', fontSize: '0.85rem' }, children: "Carregando detalhes da fatura..." })), !invoiceLoading && invoiceError && (_jsx(Alert, { variant: "error", style: { marginTop: '0.8rem' }, children: invoiceError })), !invoiceLoading && !invoiceError && !invoiceDetails?.invoice && (_jsx("p", { style: { margin: '0.8rem 0 0', color: '#9ca3af', fontSize: '0.85rem' }, children: "Este m\u00EAs n\u00E3o possui fatura importada para esta conta." })), !invoiceLoading && !invoiceError && invoiceDetails?.invoice && (_jsxs(_Fragment, { children: [_jsxs("div", { style: { display: 'flex', gap: '0.45rem', flexWrap: 'wrap', marginTop: '0.8rem' }, children: [_jsxs(Badge, { variant: "gray", children: ["Status: ", invoiceDetails.invoice.status] }), _jsxs(Badge, { variant: "gray", children: ["Vencimento: ", String(invoiceDetails.invoice.dueDate).slice(0, 10)] }), invoiceDetails.invoice.cardBrand && _jsx(Badge, { variant: "gray", children: invoiceDetails.invoice.cardBrand }), invoiceDetails.invoice.cardLast4 && _jsxs(Badge, { variant: "gray", children: ["**** ", invoiceDetails.invoice.cardLast4] }), invoiceDetails.invoice.parserStrategy && (_jsxs(Badge, { variant: "blue", children: ["Parser: ", invoiceDetails.invoice.parserStrategy] }))] }), _jsxs("div", { style: { display: 'flex', gap: '2rem', flexWrap: 'wrap', marginTop: '0.9rem' }, children: [_jsxs("div", { children: [_jsx("div", { style: { color: '#6b7280', fontSize: '0.75rem', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }, children: "Total da fatura anterior" }), _jsx("div", { style: { color: '#f3f4f6', fontWeight: 700, fontSize: '1.05rem' }, children: formatBRL(invoiceDetails.invoice.previousBalanceMinor) })] }), _jsxs("div", { children: [_jsx("div", { style: { color: '#6b7280', fontSize: '0.75rem', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }, children: "Pago na fatura anterior" }), _jsx("div", { style: { color: '#f3f4f6', fontWeight: 700, fontSize: '1.05rem' }, children: formatBRL(invoiceDetails.invoice.paidAmountMinor) })] }), _jsxs("div", { children: [_jsx("div", { style: { color: '#6b7280', fontSize: '0.75rem', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }, children: "Saldo da fatura anterior" }), _jsx("div", { style: { color: previousInvoiceOpenMinor === 0 ? '#4ade80' : '#f87171', fontWeight: 700, fontSize: '1.05rem' }, children: formatBRL(previousInvoiceOpenMinor) })] }), _jsxs("div", { children: [_jsx("div", { style: { color: '#6b7280', fontSize: '0.75rem', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }, children: "Total da fatura atual" }), _jsx("div", { style: { color: '#f3f4f6', fontWeight: 700, fontSize: '1.05rem' }, children: formatBRL(invoiceDetails.invoice.totalAmountMinor) })] }), _jsxs("div", { children: [_jsx("div", { style: { color: '#6b7280', fontSize: '0.75rem', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }, children: "Em aberto da fatura atual" }), _jsx("div", { style: { color: '#f3f4f6', fontWeight: 700, fontSize: '1.05rem' }, children: formatBRL(invoiceDetails.invoice.emAbertoMinor) })] })] }), _jsx(InvoiceComponentsPanel, { installments: invoiceInstallments, fees: invoiceFees, progress: invoiceInstallmentProgress }), liabilityPayments.length > 0 && (_jsxs("div", { style: {
                                                    marginTop: '1rem',
                                                    padding: '0.9rem',
                                                    border: '1px solid #2a2f45',
                                                    borderRadius: 10,
                                                    background: '#0f1117',
                                                }, children: [_jsx("h4", { style: { margin: '0 0 0.75rem', color: '#e5e7eb', fontSize: '0.92rem', fontWeight: 700 }, children: "Pagamentos do extrato vinculados" }), _jsx("div", { children: _jsxs("table", { style: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }, children: [_jsx("thead", { children: _jsxs("tr", { style: { borderBottom: '1px solid #2a2f45', textAlign: 'left' }, children: [_jsx("th", { style: { padding: '0.45rem', width: 110, color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }, children: "Data" }), _jsx("th", { style: { padding: '0.45rem', color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }, children: "Descri\u00E7\u00E3o" }), _jsx("th", { style: { padding: '0.45rem', width: 380, color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }, children: "Fatura" }), _jsx("th", { style: { padding: '0.45rem', width: 120, color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600, textAlign: 'right' }, children: "Valor" })] }) }), _jsx("tbody", { children: liabilityPayments.map((tx) => (_jsxs("tr", { style: { borderBottom: '1px solid #1f2436' }, children: [_jsx("td", { style: { padding: '0.45rem', color: '#cbd5e1', fontSize: '0.82rem', whiteSpace: 'nowrap' }, children: String(tx.occurredAt).slice(0, 10) }), _jsx("td", { style: { padding: '0.45rem', color: '#f3f4f6', fontSize: '0.84rem', overflowWrap: 'anywhere' }, children: tx.description }), _jsx("td", { style: { padding: '0.45rem', color: '#94a3b8', fontSize: '0.8rem', verticalAlign: 'top' }, children: _jsx(InvoicePaymentSelector, { value: tx.cardInvoiceId ?? null, options: getAvailableInvoiceOptions(tx.cardInvoiceId ?? null, tx.settledInvoice, occupiedInvoiceIds, tx.cardInvoiceSummary), disabled: linkingPaymentId === tx.id, onChange: (invoiceId) => handleStatementInvoiceChange(tx.id, invoiceId), style: { width: '100%', minWidth: 0 } }) }), _jsx("td", { style: { padding: '0.45rem', color: '#f87171', fontSize: '0.85rem', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }, children: formatBRL(tx.amountMinor) })] }, tx.id))) })] }) })] })), _jsx("div", { style: { marginTop: '1rem' }, children: _jsxs("table", { style: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }, children: [_jsx("thead", { children: _jsxs("tr", { style: { borderBottom: '1px solid #2a2f45', textAlign: 'left' }, children: [_jsx("th", { style: { padding: '0.5rem', width: 110, color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }, children: "Data" }), _jsx("th", { style: { padding: '0.5rem', color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }, children: "Descri\u00E7\u00E3o" }), _jsx("th", { style: { padding: '0.5rem', width: 220, color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }, children: "Categoria" }), _jsx("th", { style: { padding: '0.5rem', width: 360, color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }, children: "Fatura vinculada" }), _jsx("th", { style: { padding: '0.5rem', width: 120, color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600, textAlign: 'right' }, children: "Valor" })] }) }), _jsxs("tbody", { children: [invoiceVisibleTransactions.map((tx) => (_jsxs("tr", { style: { borderBottom: '1px solid #1f2436' }, children: [_jsx("td", { style: { padding: '0.5rem', color: '#cbd5e1', fontSize: '0.82rem', whiteSpace: 'nowrap' }, children: String(tx.occurredAt).slice(0, 10) }), _jsxs("td", { style: { padding: '0.5rem', color: '#f3f4f6', fontSize: '0.84rem', overflowWrap: 'anywhere' }, children: [tx.description, tx.installmentNumber && tx.installmentTotal
                                                                                    ? ` (${tx.installmentNumber}/${tx.installmentTotal})`
                                                                                    : ''] }), _jsx("td", { style: { padding: '0.5rem', color: '#94a3b8', fontSize: '0.8rem' }, children: _jsxs("select", { value: tx.categoryId ?? '', disabled: updatingTxId === tx.id, onChange: (e) => handleCategoryChange(tx.id, e.target.value), style: {
                                                                                    background: '#0f1117',
                                                                                    border: '1px solid #2a2f45',
                                                                                    borderRadius: 6,
                                                                                    padding: '4px 8px',
                                                                                    color: '#e5e7eb',
                                                                                    fontSize: '0.78rem',
                                                                                    width: '100%',
                                                                                    minWidth: 0,
                                                                                    fontFamily: 'monospace',
                                                                                }, children: [_jsx("option", { value: "", children: "Sem categoria" }), getCategoryOptions('expense').map((opt) => (_jsx("option", { value: opt.id, disabled: opt.isParent, style: {
                                                                                            paddingLeft: opt.isParent ? '0' : '20px',
                                                                                            fontWeight: opt.isParent ? 'bold' : 'normal',
                                                                                            color: opt.isParent ? '#94a3b8' : '#e5e7eb',
                                                                                        }, children: opt.label }, opt.id)))] }) }), _jsx("td", { style: { padding: '0.5rem', color: '#94a3b8', fontSize: '0.8rem', verticalAlign: 'top' }, children: tx.movementType === 'liability_payment' || isCreditCardInvoiceCategoryId(tx.categoryId, categories) ? (_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 4 }, children: [_jsx(InvoicePaymentSelector, { value: tx.cardInvoiceId ?? null, options: getAvailableInvoiceOptions(tx.cardInvoiceId ?? null, tx.settledInvoice, occupiedInvoiceIds, tx.cardInvoiceSummary), disabled: linkingPaymentId === tx.id, onChange: (invoiceId) => handleStatementInvoiceChange(tx.id, invoiceId), style: { width: '100%', minWidth: 0 } }), tx.settledInvoice && (_jsx("span", { style: { color: '#94a3b8', fontSize: '0.72rem', whiteSpace: 'nowrap' }, children: formatBRL(tx.settlementAllocatedMinor ?? 0) }))] })) : tx.settledInvoice ? (_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 4 }, children: [_jsx("span", { style: { color: '#e5e7eb', fontSize: '0.8rem' }, children: formatInvoicePaymentLabel(tx.settledInvoice) }), _jsx("span", { style: { color: '#94a3b8', fontSize: '0.72rem', whiteSpace: 'nowrap' }, children: formatBRL(tx.settlementAllocatedMinor ?? tx.amountMinor) })] })) : (_jsx("span", { style: { color: '#475569' }, children: "\u2014" })) }), _jsx("td", { style: { padding: '0.5rem', color: '#f87171', fontSize: '0.85rem', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }, children: formatBRL(tx.amountMinor) })] }, tx.id))), invoiceVisibleTransactions.length === 0 && (_jsx("tr", { children: _jsx("td", { colSpan: 5, style: { padding: '0.85rem 0.5rem', color: '#94a3b8', fontSize: '0.82rem' }, children: "Nenhum lan\u00E7amento principal nesta fatura. Os parcelamentos aparecem acima em \"Componentes da fatura\"." }) }))] })] }) })] }))] })] }))] }))] }));
}

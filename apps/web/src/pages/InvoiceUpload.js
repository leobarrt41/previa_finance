import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * InvoiceUpload.tsx — Upload e Preview de Fatura
 *
 * Fluxo:
 *  1. Utilizador selecciona um PDF de fatura
 *  2. Frontend envia para POST /api/invoices/parse (multipart)
 *  3. API retorna lista de transacções extraídas (preview)
 *  4. Utilizador pode categorizar cada linha e ajustar o mês de competência
 *  5. Confirma importação → POST /api/invoices/import
 *
 * Enquanto o parser não está implementado na API, o frontend
 * simula o preview com dados de exemplo para permitir testar o fluxo.
 */
import { useState, useRef, useMemo, useEffect } from 'react';
import { api, formatBRL, currentMonth, } from '../services/api';
import { buildCategoryOptions } from '../utils/categoryOptions';
import { Card, Button, Alert, Spinner, SectionTitle, } from '../components/ui';
import { InvoicePaymentSelector, buildInvoicePaymentOptions } from '../components/InvoicePaymentSelector';
function getInitialDebugEnabled() {
    if (typeof window === 'undefined')
        return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('debug') === '1' || params.get('debug') === 'true';
}
function normalizeCategoryText(value) {
    return value
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase();
}
function toCompetencyMonth(value, fallbackDate) {
    if (value && /^\d{4}-\d{2}$/.test(value))
        return value;
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value))
        return value.slice(0, 7);
    if (fallbackDate && /^\d{4}-\d{2}-\d{2}$/.test(fallbackDate))
        return fallbackDate.slice(0, 7);
    return value?.slice(0, 7) || '';
}
function isCreditCardInvoiceCategoryId(categoryId, categories) {
    if (!categoryId)
        return false;
    const byId = new Map(categories.map((category) => [category.id, category]));
    let current = byId.get(categoryId) ?? null;
    let sawPayment = false;
    let sawInvoice = false;
    let sawCard = false;
    while (current) {
        const text = normalizeCategoryText(`${current.name} ${current.slug ?? ''}`);
        if (/(pagament|pagos?)/.test(text))
            sawPayment = true;
        if (/fatura/.test(text))
            sawInvoice = true;
        if (/cartao|credito/.test(text))
            sawCard = true;
        current = current.parentId ? byId.get(current.parentId) ?? null : null;
    }
    return sawPayment && sawInvoice && sawCard;
}
// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function DropZone({ onFile }) {
    const [drag, setDrag] = useState(false);
    const inputRef = useRef(null);
    function handleDrop(e) {
        e.preventDefault();
        setDrag(false);
        const file = e.dataTransfer.files[0];
        if (file)
            onFile(file);
    }
    return (_jsxs("div", { onDragOver: (e) => { e.preventDefault(); setDrag(true); }, onDragLeave: () => setDrag(false), onDrop: handleDrop, onClick: () => inputRef.current?.click(), style: {
            border: `2px dashed ${drag ? '#6366f1' : '#2a2f45'}`,
            borderRadius: 12,
            padding: '3rem 2rem',
            textAlign: 'center',
            cursor: 'pointer',
            background: drag ? 'rgba(99,102,241,0.05)' : '#0f1117',
            transition: 'all 0.2s',
        }, children: [_jsx("div", { style: { fontSize: '2.5rem', marginBottom: '0.75rem' }, children: "\uD83D\uDCC4" }), _jsx("p", { style: { color: '#e5e7eb', fontWeight: 600, marginBottom: '0.35rem' }, children: "Arraste o PDF da fatura aqui" }), _jsx("p", { style: { color: '#6b7280', fontSize: '0.82rem' }, children: "ou clique para seleccionar o arquivo" }), _jsx("p", { style: { color: '#fbbf24', fontSize: '0.75rem', marginTop: '0.5rem', fontWeight: 600 }, children: "Fatura de cart\u00E3o: apenas PDF. OFX n\u00E3o \u00E9 usado neste fluxo." }), _jsx("p", { style: { color: '#fbbf24', fontSize: '0.72rem', marginTop: '0.2rem' }, children: "Suportado: Banco do Brasil PDF \u00B7 Bradesco PDF \u00B7 Ita\u00FA PDF" }), _jsx("input", { ref: inputRef, type: "file", accept: ".pdf", style: { display: 'none' }, onChange: (e) => { const f = e.target.files?.[0]; if (f)
                    onFile(f); } })] }));
}
function TransactionPreviewRow({ tx, categoryOptions, invoiceOptions, showInvoiceSelector, onChange, }) {
    return (_jsxs("tr", { style: { borderBottom: '1px solid #1a1e2e', opacity: tx.include ? 1 : 0.4 }, children: [_jsx("td", { style: { padding: '0.45rem 0.5rem', textAlign: 'center' }, children: _jsx("input", { type: "checkbox", checked: tx.include, onChange: (e) => onChange(tx.id, { include: e.target.checked }), style: { cursor: 'pointer' } }) }), _jsx("td", { style: { padding: '0.45rem 0.5rem', fontSize: '0.8rem', color: '#9ca3af', whiteSpace: 'nowrap' }, children: tx.date }), _jsxs("td", { style: { padding: '0.45rem 0.5rem', fontSize: '0.82rem', color: '#e5e7eb', overflowWrap: 'anywhere' }, children: [tx.description, tx.installment && (_jsxs("span", { style: { marginLeft: 6, fontSize: '0.72rem', color: '#6366f1' }, children: ["parcela ", tx.installment] }))] }), _jsx("td", { style: { padding: '0.45rem 0.5rem', textAlign: 'right', fontSize: '0.85rem', color: '#f87171', fontWeight: 600, whiteSpace: 'nowrap' }, children: formatBRL(tx.amountMinor) }), _jsx("td", { style: { padding: '0.45rem 0.5rem' }, children: _jsx("input", { value: tx.competencyMonth, onChange: (e) => onChange(tx.id, { competencyMonth: e.target.value }), placeholder: "YYYY-MM", style: {
                        background: '#0f1117', border: '1px solid #2a2f45', borderRadius: 6,
                        padding: '3px 6px', color: '#e5e7eb', fontSize: '0.78rem', width: '100%', minWidth: 0,
                    } }) }), _jsx("td", { style: { padding: '0.45rem 0.5rem' }, children: _jsxs("select", { value: tx.categoryId ?? '', onChange: (e) => onChange(tx.id, { categoryId: e.target.value || null }), style: {
                        background: '#0f1117', border: `1px solid ${tx.categoryId ? '#2a2f45' : '#f87171'}`,
                        borderRadius: 6, padding: '3px 6px', color: '#e5e7eb', fontSize: '0.78rem', width: '100%',
                        minWidth: 0, maxWidth: 'none',
                        fontFamily: 'monospace',
                    }, children: [_jsx("option", { value: "", children: "\u2014 sem categoria \u2014" }), categoryOptions.map((opt) => (_jsx("option", { value: opt.id, disabled: opt.disabled, children: opt.label }, opt.id)))] }) }), _jsx("td", { style: { padding: '0.45rem 0.5rem' }, children: showInvoiceSelector ? (_jsx(InvoicePaymentSelector, { value: tx.settlesInvoiceId ?? null, options: invoiceOptions, onChange: (invoiceId) => onChange(tx.id, { settlesInvoiceId: invoiceId }), style: { width: '100%', minWidth: 0 } })) : (_jsx("span", { style: { color: '#475569', fontSize: '0.82rem' }, children: "\u2014" })) })] }));
}
function DebugStageCard({ label, content }) {
    return (_jsxs("details", { style: {
            background: '#0f1117',
            border: '1px solid #2a2f45',
            borderRadius: 10,
            padding: '0.7rem 0.85rem',
        }, children: [_jsx("summary", { style: { cursor: 'pointer', color: '#e5e7eb', fontWeight: 700, fontSize: '0.86rem' }, children: label }), _jsx("pre", { style: {
                    marginTop: '0.75rem',
                    marginBottom: 0,
                    padding: '0.75rem',
                    background: '#0b0d14',
                    borderRadius: 8,
                    color: '#cbd5e1',
                    fontSize: '0.72rem',
                    lineHeight: 1.45,
                    whiteSpace: 'pre-wrap',
                    overflowX: 'auto',
                    maxHeight: 320,
                }, children: content })] }));
}
function InvoiceDebugPanel({ debug }) {
    return (_jsxs(Card, { style: { marginBottom: '1rem', border: '1px solid #4b5563', background: '#10121a' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }, children: [_jsxs("div", { children: [_jsx("p", { style: { margin: 0, color: '#fbbf24', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4 }, children: "Debug tempor\u00E1rio" }), _jsxs("p", { style: { margin: '0.25rem 0 0', color: '#e5e7eb', fontWeight: 700, fontSize: '0.95rem' }, children: [debug.strategy, " \u00B7 ", debug.sourceBank] })] }), _jsx("div", { style: { color: '#94a3b8', fontSize: '0.8rem', alignSelf: 'flex-end' }, children: "Mostrando etapas da leitura" })] }), _jsx("div", { style: { display: 'grid', gap: '0.75rem' }, children: debug.stages.map((stage) => (_jsx(DebugStageCard, { label: stage.label, content: stage.content }, stage.label))) })] }));
}
function InvoiceInstallmentsPanel({ installments }) {
    if (installments.length === 0)
        return null;
    return (_jsxs(Card, { style: { marginBottom: '1rem', border: '1px solid #334155', background: '#10121a' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.85rem' }, children: [_jsxs("div", { children: [_jsx("p", { style: { margin: 0, color: '#fbbf24', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4 }, children: "Parcelamentos detectados" }), _jsx("p", { style: { margin: '0.25rem 0 0', color: '#e5e7eb', fontWeight: 700, fontSize: '0.92rem' }, children: "Itens j\u00E1 parcelados, financiamentos e s\u00E9ries de parcelas da fatura" })] }), _jsx("div", { style: { color: '#9ca3af', fontSize: '0.78rem', alignSelf: 'flex-end' }, children: "S\u00E3o importados junto com a fatura, mas n\u00E3o entram no total seleccionado desta p\u00E1gina" })] }), _jsx("div", { style: { overflowX: 'auto' }, children: _jsxs("table", { style: { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', tableLayout: 'fixed' }, children: [_jsx("thead", { children: _jsxs("tr", { style: { color: '#6b7280', borderBottom: '1px solid #2a2f45', background: '#0f1117' }, children: [_jsx("th", { style: { padding: '0.5rem', textAlign: 'left' }, children: "Descri\u00E7\u00E3o" }), _jsx("th", { style: { padding: '0.5rem', width: 100, textAlign: 'right' }, children: "Valor" }), _jsx("th", { style: { padding: '0.5rem', width: 104, textAlign: 'left' }, children: "Data" }), _jsx("th", { style: { padding: '0.5rem', width: 100, textAlign: 'left' }, children: "Parcela" })] }) }), _jsx("tbody", { children: installments.map((item, index) => (_jsxs("tr", { style: { borderBottom: '1px solid #1a1e2e' }, children: [_jsx("td", { style: { padding: '0.55rem 0.5rem', color: '#e5e7eb', overflowWrap: 'anywhere' }, children: item.description }), _jsx("td", { style: { padding: '0.55rem 0.5rem', textAlign: 'right', color: '#f87171', fontWeight: 700, whiteSpace: 'nowrap' }, children: formatBRL(Math.round(item.amount * 100)) }), _jsx("td", { style: { padding: '0.55rem 0.5rem', color: '#9ca3af', whiteSpace: 'nowrap' }, children: item.date ?? '—' }), _jsx("td", { style: { padding: '0.55rem 0.5rem', color: '#cbd5e1' }, children: item.current && item.total ? `${item.current}/${item.total}` : '—' })] }, `${item.description}-${item.date ?? 'nodate'}-${index}`))) })] }) })] }));
}
function DebugStatusCard({ debugEnabled, hasDebug, isReprocessing }) {
    if (!debugEnabled)
        return null;
    return (_jsx(Card, { style: { marginBottom: '1rem', border: '1px solid #3f3f46', background: '#111827' }, children: _jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }, children: [_jsxs("div", { children: [_jsx("p", { style: { margin: 0, color: '#fbbf24', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase' }, children: "Debug de leitura" }), _jsx("p", { style: { margin: '0.25rem 0 0', color: '#e5e7eb', fontWeight: 700, fontSize: '0.9rem' }, children: hasDebug ? 'Etapas carregadas' : isReprocessing ? 'Reprocessando fatura para gerar ASCII e JSON...' : 'Aguardando leitura da fatura' })] }), _jsx("div", { style: { color: '#9ca3af', fontSize: '0.78rem' }, children: hasDebug ? 'Role para ver o ASCII abaixo.' : 'Se a fatura já estiver aberta, o upload será repetido.' })] }) }));
}
// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export function InvoiceUpload() {
    const [step, setStep] = useState('select');
    const [file, setFile] = useState(null);
    const [pdfPassword, setPdfPassword] = useState('');
    const [awaitingPassword, setAwaitingPassword] = useState(false);
    const [transactions, setTransactions] = useState([]);
    const [categories, setCategories] = useState([]);
    const [invoiceMonth, setInvoiceMonth] = useState(currentMonth());
    const [dueMonth, setDueMonth] = useState('');
    const [errorMsg, setErrorMsg] = useState('');
    const [importResult, setImportResult] = useState(null);
    const [invoiceSummary, setInvoiceSummary] = useState(null);
    const [invoiceAnalysis, setInvoiceAnalysis] = useState(null);
    const [invoiceBank, setInvoiceBank] = useState(null);
    const [openInvoices, setOpenInvoices] = useState([]);
    const [parseDebug, setParseDebug] = useState(null);
    const [debugEnabled, setDebugEnabled] = useState(getInitialDebugEnabled());
    const [debugReprocessing, setDebugReprocessing] = useState(false);
    const categoryOptions = useMemo(() => {
        return buildCategoryOptions(categories, 'expense');
    }, [categories]);
    const expenseCategories = useMemo(() => categories.filter((c) => c.type === 'expense'), [categories]);
    const invoiceOptions = useMemo(() => buildInvoicePaymentOptions(null, openInvoices), [openInvoices]);
    useEffect(() => {
        api.categories.list().then(setCategories).catch(() => { });
    }, []);
    useEffect(() => {
        api.accounts.openCardInvoices().then((result) => setOpenInvoices(result.items)).catch(() => { });
    }, []);
    useEffect(() => {
        if (!debugEnabled || !file || step !== 'preview')
            return;
        setDebugReprocessing(true);
        parseSelectedFile(file, pdfPassword.trim() || undefined).finally(() => setDebugReprocessing(false));
        // Reprocessa só quando o debug é activado com a fatura já carregada.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debugEnabled]);
    function isPasswordRequiredError(error) {
        return error instanceof Error
            && error.message.toLowerCase().includes('pdf protegido por senha');
    }
    async function suggestCategoriesWithAI(parsedTransactions) {
        if (expenseCategories.length === 0)
            return parsedTransactions;
        const pending = parsedTransactions.filter((t) => t.include && !t.categoryId);
        if (pending.length === 0)
            return parsedTransactions;
        try {
            const response = await api.invoices.classify({
                transactions: pending.map((t) => ({
                    id: t.id,
                    description: t.description,
                    amountMinor: t.amountMinor,
                    country: t.country,
                    installment: t.installment,
                })),
                categories: expenseCategories.map((c) => ({
                    id: c.id,
                    name: c.name,
                    slug: c.slug,
                    type: c.type,
                    parentId: c.parentId,
                })),
            });
            const suggestions = response.suggestions ?? {};
            if (Object.keys(suggestions).length === 0)
                return parsedTransactions;
            return parsedTransactions.map((t) => {
                const suggestion = suggestions[t.id];
                if (!suggestion)
                    return t;
                return {
                    ...t,
                    // card_transactions has one categoryId field today.
                    // Persist subcategory when available; fallback to parent category.
                    categoryId: suggestion.subcategoryId ?? suggestion.categoryId,
                };
            });
        }
        catch {
            return parsedTransactions;
        }
    }
    async function parseSelectedFile(selectedFile, password) {
        setStep('parsing');
        setErrorMsg('');
        setParseDebug(null);
        try {
            const result = await api.invoices.parse(selectedFile, { password, debug: debugEnabled });
            if (result.summary.dueMonth)
                setDueMonth(result.summary.dueMonth);
            if (result.summary.invoiceMonth)
                setInvoiceMonth(result.summary.invoiceMonth);
            setInvoiceSummary(result.summary);
            setInvoiceAnalysis(result.analysis ?? null);
            setInvoiceBank(result.bank);
            setParseDebug(result.debug ?? null);
            const suggestedTransactions = await suggestCategoriesWithAI(result.transactions);
            setTransactions(suggestedTransactions);
            setAwaitingPassword(false);
            setStep('preview');
        }
        catch (e) {
            if (isPasswordRequiredError(e)) {
                setAwaitingPassword(true);
                setErrorMsg('Esta fatura exige senha. Informe a senha para gerar o preview.');
                setStep('select');
                return;
            }
            setErrorMsg(e instanceof Error ? e.message : 'Erro ao processar o arquivo. Verifique se é um PDF válido.');
            setStep('error');
        }
    }
    function handleFile(f) {
        setFile(f);
        setPdfPassword('');
        setAwaitingPassword(false);
        parseSelectedFile(f);
    }
    function submitPassword() {
        if (!file) {
            setErrorMsg('Selecione a fatura novamente.');
            return;
        }
        const password = pdfPassword.trim();
        if (!password) {
            setErrorMsg('Informe a senha da fatura para continuar.');
            return;
        }
        parseSelectedFile(file, password);
    }
    function handleChange(id, patch) {
        setTransactions((prev) => prev.map((t) => {
            if (t.id !== id)
                return t;
            const next = { ...t, ...patch };
            if (patch.categoryId !== undefined && !isCreditCardInvoiceCategoryId(patch.categoryId, categories)) {
                next.settlesInvoiceId = null;
            }
            return next;
        }));
    }
    function selectAll(include) {
        setTransactions((prev) => prev.map((t) => ({ ...t, include })));
    }
    const included = transactions.filter((t) => t.include);
    const uncategorized = included.filter((t) => !t.categoryId);
    const total = included.reduce((sum, t) => sum + t.amountMinor, 0);
    async function handleImport() {
        if (!dueMonth) {
            setErrorMsg('Informe o mês de vencimento da fatura');
            return;
        }
        setStep('importing');
        setErrorMsg('');
        try {
            const result = await api.invoices.import({
                transactions: included.map(({ date, description, amountMinor, categoryId, competencyMonth, installment, settlesInvoiceId }) => ({
                    date,
                    description,
                    amountMinor,
                    categoryId,
                    competencyMonth: toCompetencyMonth(competencyMonth, date),
                    installment,
                    settlesInvoiceId,
                })),
                installments: invoiceAnalysis?.installments.map((item) => ({
                    date: item.date ?? invoiceSummary?.dueDate ?? `${invoiceMonth}-01`,
                    description: item.description,
                    amountMinor: Math.round(item.amount * 100),
                    competencyMonth: toCompetencyMonth(item.date?.slice(0, 7), item.date ?? invoiceSummary?.dueDate ?? `${invoiceMonth}-01`),
                    installment: item.current && item.total ? `${item.current}/${item.total}` : undefined,
                    categoryId: null,
                })) ?? [],
                invoiceMonth,
                dueMonth,
                bank: invoiceBank ?? undefined,
                cardLast4: invoiceSummary?.cardLast4 ?? undefined,
                product: invoiceSummary?.product ?? undefined,
                sourceFileName: file?.name,
                dueDate: invoiceSummary?.dueDate ?? undefined,
                closingDate: invoiceSummary?.closingDate ?? undefined,
                totalMinor: invoiceSummary?.totalMinor ?? undefined,
                previousBalanceMinor: invoiceSummary?.previousBalanceMinor ?? undefined,
                paymentsMinor: invoiceSummary?.paymentsMinor ?? undefined,
                monthlyExpensesMinor: invoiceSummary?.monthlyExpensesMinor ?? undefined,
                creditsAndRefundsMinor: invoiceSummary?.creditsAndRefundsMinor ?? undefined,
                chargesMinor: invoiceSummary?.chargesMinor ?? undefined,
                financedBalanceMinor: invoiceSummary?.financedBalanceMinor ?? undefined,
                openBalanceMinor: invoiceSummary?.openBalanceMinor ?? undefined,
                analysis: invoiceAnalysis
                    ? {
                        ...invoiceAnalysis,
                        installments: invoiceAnalysis.installments?.map((item) => ({
                            ...item,
                            current: item.current && item.current > 0 ? item.current : undefined,
                            total: item.total && item.total > 0 ? item.total : undefined,
                        })),
                    }
                    : undefined,
            });
            setImportResult({ imported: result.imported, skipped: result.skipped });
            setStep('done');
        }
        catch (e) {
            setErrorMsg(e instanceof Error ? e.message : 'Erro ao importar');
            setStep('error');
        }
    }
    function reset() {
        setStep('select');
        setFile(null);
        setPdfPassword('');
        setAwaitingPassword(false);
        setTransactions([]);
        setInvoiceMonth(currentMonth());
        setDueMonth('');
        setErrorMsg('');
        setImportResult(null);
        setInvoiceSummary(null);
        setInvoiceAnalysis(null);
        setInvoiceBank(null);
        setParseDebug(null);
    }
    return (_jsxs("div", { style: { maxWidth: 1000 }, children: [_jsx("div", { style: { marginBottom: '1.5rem' }, children: _jsxs("div", { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }, children: [_jsxs("div", { children: [_jsx("h1", { style: { fontSize: '1.4rem', fontWeight: 800, color: '#e5e7eb', margin: 0 }, children: "\uD83D\uDCE4 Upload de Fatura" }), _jsx("p", { style: { color: '#6b7280', marginTop: '0.3rem', fontSize: '0.85rem' }, children: "Importe faturas de cart\u00E3o em PDF ou CSV. Revise e categorize antes de confirmar." })] }), _jsx("button", { type: "button", onClick: () => setDebugEnabled((v) => !v), style: {
                                alignSelf: 'flex-start',
                                background: debugEnabled ? '#1f2937' : '#111827',
                                border: `1px solid ${debugEnabled ? '#f59e0b' : '#374151'}`,
                                borderRadius: 999,
                                color: debugEnabled ? '#fbbf24' : '#9ca3af',
                                cursor: 'pointer',
                                padding: '0.5rem 0.85rem',
                                fontSize: '0.78rem',
                                fontWeight: 700,
                            }, children: debugEnabled ? 'Debug ligado' : 'Debug desligado' })] }) }), step === 'select' && (_jsx("div", { style: { maxWidth: 560 }, children: _jsxs(Card, { children: [_jsx(SectionTitle, { children: "Seleccionar arquivo" }), _jsx(DropZone, { onFile: handleFile }), awaitingPassword && file && (_jsxs("div", { style: {
                                marginTop: '1rem',
                                padding: '0.85rem',
                                background: '#1f1627',
                                borderLeft: '3px solid #f59e0b',
                                borderRadius: '0 8px 8px 0',
                            }, children: [_jsxs("p", { style: { color: '#fcd34d', fontSize: '0.82rem', marginTop: 0, marginBottom: '0.55rem' }, children: ["Arquivo protegido detectado: ", _jsx("strong", { children: file.name })] }), _jsx("label", { htmlFor: "invoice-pdf-password", style: { display: 'block', color: '#e5e7eb', fontSize: '0.8rem', marginBottom: '0.35rem' }, children: "Digite a senha para continuar" }), _jsxs("div", { style: { display: 'flex', gap: '0.5rem', alignItems: 'center' }, children: [_jsx("input", { id: "invoice-pdf-password", type: "password", value: pdfPassword, onChange: (e) => setPdfPassword(e.target.value), onKeyDown: (e) => {
                                                if (e.key === 'Enter')
                                                    submitPassword();
                                            }, placeholder: "Senha do PDF", style: {
                                                flex: 1,
                                                background: '#0f1117',
                                                border: '1px solid #2a2f45',
                                                borderRadius: 8,
                                                padding: '0.65rem 0.75rem',
                                                color: '#e5e7eb',
                                                fontSize: '0.82rem',
                                            } }), _jsx(Button, { variant: "primary", onClick: submitPassword, children: "Continuar" })] })] })), _jsxs("div", { style: {
                                marginTop: '1rem',
                                padding: '0.75rem',
                                background: '#1a2a3a',
                                borderLeft: '3px solid #6366f1',
                                borderRadius: '0 8px 8px 0',
                                fontSize: '0.82rem',
                                color: '#93c5fd',
                            }, children: [_jsx("strong", { children: "Princ\u00EDpio:" }), " compra no cart\u00E3o \u00E9 d\u00EDvida, n\u00E3o d\u00E9bito imediato. O pagamento da fatura \u00E9 o evento que afecta o caixa."] })] }) })), step === 'parsing' && (_jsxs(Card, { style: { textAlign: 'center', padding: '3rem' }, children: [_jsx(Spinner, { size: 40 }), _jsxs("p", { style: { color: '#9ca3af', marginTop: '1rem', fontSize: '0.9rem' }, children: ["Processando ", _jsx("strong", { style: { color: '#e5e7eb' }, children: file?.name }), "..."] })] })), step === 'preview' && (_jsxs(_Fragment, { children: [_jsxs(Card, { style: { marginBottom: '1rem' }, children: [_jsxs("div", { style: { display: 'flex', gap: '1.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }, children: [_jsxs("div", { children: [_jsx("p", { style: { fontSize: '0.75rem', color: '#6b7280', marginBottom: 4 }, children: "Arquivo" }), _jsx("p", { style: { fontSize: '0.88rem', color: '#e5e7eb', fontWeight: 600 }, children: file?.name })] }), _jsxs("div", { children: [_jsx("label", { style: { fontSize: '0.75rem', color: '#6b7280', display: 'block', marginBottom: 4 }, children: "M\u00EAs de compet\u00EAncia" }), _jsx("input", { value: invoiceMonth, onChange: (e) => setInvoiceMonth(e.target.value), placeholder: "YYYY-MM", style: {
                                                    background: '#141624', border: '1px solid #2a2f45', borderRadius: 8,
                                                    padding: '0.45rem 0.75rem', color: '#e5e7eb', fontSize: '0.85rem', width: 110,
                                                } })] }), _jsxs("div", { children: [_jsx("label", { style: { fontSize: '0.75rem', color: '#6b7280', display: 'block', marginBottom: 4 }, children: "M\u00EAs de vencimento *" }), _jsx("input", { value: dueMonth, onChange: (e) => setDueMonth(e.target.value), placeholder: "YYYY-MM", style: {
                                                    background: '#141624',
                                                    border: `1px solid ${dueMonth ? '#2a2f45' : '#f87171'}`,
                                                    borderRadius: 8,
                                                    padding: '0.45rem 0.75rem', color: '#e5e7eb', fontSize: '0.85rem', width: 110,
                                                } })] }), _jsxs("div", { style: { marginLeft: 'auto', textAlign: 'right' }, children: [_jsx("p", { style: { fontSize: '0.75rem', color: '#6b7280', marginBottom: 2 }, children: "Total seleccionado" }), _jsx("p", { style: { fontSize: '1.1rem', fontWeight: 800, color: '#f87171' }, children: formatBRL(total) })] })] }), invoiceSummary && invoiceSummary.previousBalanceMinor > 0 && (_jsxs("div", { style: {
                                    marginTop: '1rem', paddingTop: '1rem',
                                    borderTop: '1px solid #1e2130',
                                    display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.82rem',
                                    alignItems: 'center',
                                }, children: [_jsxs("div", { children: [_jsx("span", { style: { color: '#6b7280' }, children: "Total da fatura anterior: " }), _jsx("span", { style: { color: '#f87171', fontWeight: 600 }, children: formatBRL(invoiceSummary.previousBalanceMinor) })] }), typeof invoiceSummary.financedBalanceMinor === 'number' && invoiceSummary.financedBalanceMinor > 0 && (_jsxs("div", { children: [_jsx("span", { style: { color: '#6b7280' }, children: "Saldo financiado: " }), _jsx("span", { style: { color: '#f87171', fontWeight: 600 }, children: formatBRL(invoiceSummary.financedBalanceMinor) })] })), _jsxs("div", { children: [_jsx("span", { style: { color: '#6b7280' }, children: "Pagamentos: " }), _jsxs("span", { style: { color: '#4ade80', fontWeight: 600 }, children: ["\u2212", formatBRL(invoiceSummary.paymentsMinor)] })] }), _jsxs("div", { children: [_jsx("span", { style: { color: '#6b7280' }, children: "Novas compras: " }), _jsxs("span", { style: { color: '#e5e7eb', fontWeight: 600 }, children: ["+", formatBRL(invoiceSummary.monthlyExpensesMinor ?? (invoiceSummary.nationalPurchasesMinor + invoiceSummary.internationalPurchasesMinor))] })] }), invoiceSummary.creditsAndRefundsMinor > 0 && (_jsxs("div", { children: [_jsx("span", { style: { color: '#6b7280' }, children: "Cr\u00E9ditos e estornos: " }), _jsxs("span", { style: { color: '#4ade80', fontWeight: 600 }, children: ["+", formatBRL(invoiceSummary.creditsAndRefundsMinor)] })] })), invoiceSummary.chargesMinor > 0 && (_jsxs("div", { children: [_jsx("span", { style: { color: '#6b7280' }, children: "Encargos: " }), _jsxs("span", { style: { color: '#fbbf24', fontWeight: 600 }, children: ["+", formatBRL(invoiceSummary.chargesMinor)] })] })), _jsxs("div", { style: { marginLeft: 'auto', background: '#1a1f35', borderRadius: 8, padding: '0.4rem 0.8rem' }, children: [_jsxs("span", { style: { color: '#93c5fd', fontSize: '0.78rem' }, children: ["\uD83D\uDCB3 Total a pagar em ", dueMonth || invoiceSummary.dueMonth, ": "] }), _jsx("span", { style: { color: '#f87171', fontWeight: 800, fontSize: '0.9rem' }, children: formatBRL(invoiceSummary.totalMinor) })] })] }))] }), _jsx(DebugStatusCard, { debugEnabled: debugEnabled, hasDebug: Boolean(parseDebug), isReprocessing: debugReprocessing }), parseDebug && debugEnabled && (_jsx(InvoiceDebugPanel, { debug: parseDebug })), invoiceAnalysis?.installments && invoiceAnalysis.installments.length > 0 && (_jsx(InvoiceInstallmentsPanel, { installments: invoiceAnalysis.installments })), uncategorized.length > 0 && (_jsxs(Alert, { variant: "warning", style: { marginBottom: '1rem' }, children: [_jsxs("strong", { children: [uncategorized.length, " transac\u00E7\u00E3o(\u00F5es)"] }), " sem categoria. Categorize antes de importar para melhor an\u00E1lise."] })), errorMsg && _jsx(Alert, { variant: "error", style: { marginBottom: '1rem' }, children: errorMsg }), _jsxs(Card, { style: { padding: 0, overflow: 'hidden' }, children: [_jsxs("div", { style: { padding: '0.75rem 1rem', borderBottom: '1px solid #1e2130', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, children: [_jsxs(SectionTitle, { style: { margin: 0 }, children: [transactions.length, " transac\u00E7\u00F5es extra\u00EDdas \u00B7 ", included.length, " seleccionadas"] }), _jsxs("div", { style: { display: 'flex', gap: '0.5rem' }, children: [_jsx("button", { onClick: () => selectAll(true), style: { background: 'none', border: '1px solid #2a2f45', borderRadius: 6, color: '#9ca3af', cursor: 'pointer', padding: '3px 10px', fontSize: '0.78rem' }, children: "Seleccionar tudo" }), _jsx("button", { onClick: () => selectAll(false), style: { background: 'none', border: '1px solid #2a2f45', borderRadius: 6, color: '#9ca3af', cursor: 'pointer', padding: '3px 10px', fontSize: '0.78rem' }, children: "Desmarcar tudo" })] })] }), _jsx("div", { children: _jsxs("table", { style: { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', tableLayout: 'fixed' }, children: [_jsx("thead", { children: _jsxs("tr", { style: { color: '#6b7280', borderBottom: '1px solid #2a2f45', background: '#0f1117' }, children: [_jsx("th", { style: { padding: '0.5rem', width: 36 } }), _jsx("th", { style: { padding: '0.5rem', width: 104, textAlign: 'left' }, children: "Data" }), _jsx("th", { style: { padding: '0.5rem', textAlign: 'left' }, children: "Descri\u00E7\u00E3o" }), _jsx("th", { style: { padding: '0.5rem', width: 100, textAlign: 'right' }, children: "Valor" }), _jsx("th", { style: { padding: '0.5rem', width: 100, textAlign: 'left' }, children: "Compet\u00EAncia" }), _jsx("th", { style: { padding: '0.5rem', width: 240, textAlign: 'left' }, children: "Categoria" }), _jsx("th", { style: { padding: '0.5rem', width: 250, textAlign: 'left' }, children: "Fatura paga" })] }) }), _jsx("tbody", { children: transactions.map((tx) => (_jsx(TransactionPreviewRow, { tx: tx, categoryOptions: categoryOptions, invoiceOptions: invoiceOptions, showInvoiceSelector: isCreditCardInvoiceCategoryId(tx.categoryId ?? null, categories), onChange: handleChange }, tx.id))) })] }) })] }), _jsxs("div", { style: { display: 'flex', gap: '0.75rem', marginTop: '1rem', justifyContent: 'flex-end' }, children: [_jsx(Button, { onClick: reset, variant: "secondary", children: "Cancelar" }), _jsxs(Button, { onClick: handleImport, disabled: included.length === 0 || !dueMonth, children: ["Importar ", included.length, " transac\u00E7\u00F5es \u2192"] })] })] })), step === 'importing' && (_jsxs(Card, { style: { textAlign: 'center', padding: '3rem' }, children: [_jsx(Spinner, { size: 40 }), _jsxs("p", { style: { color: '#9ca3af', marginTop: '1rem', fontSize: '0.9rem' }, children: ["Importando ", included.length, " transac\u00E7\u00F5es..."] })] })), step === 'done' && importResult && (_jsxs(Card, { style: { textAlign: 'center', padding: '2.5rem' }, children: [_jsx("div", { style: { fontSize: '3rem', marginBottom: '1rem' }, children: "\u2705" }), _jsx("h2", { style: { color: '#4ade80', fontWeight: 800, marginBottom: '0.5rem', fontSize: '1.2rem' }, children: "Fatura importada com sucesso!" }), _jsxs("div", { style: { display: 'flex', gap: '2rem', justifyContent: 'center', marginTop: '1rem', marginBottom: '1.5rem' }, children: [_jsxs("div", { children: [_jsx("p", { style: { fontSize: '0.75rem', color: '#6b7280' }, children: "Importadas" }), _jsx("p", { style: { fontSize: '1.5rem', fontWeight: 800, color: '#4ade80' }, children: importResult.imported })] }), _jsxs("div", { children: [_jsx("p", { style: { fontSize: '0.75rem', color: '#6b7280' }, children: "Ignoradas" }), _jsx("p", { style: { fontSize: '1.5rem', fontWeight: 800, color: '#6b7280' }, children: importResult.skipped })] }), _jsxs("div", { children: [_jsx("p", { style: { fontSize: '0.75rem', color: '#6b7280' }, children: "Total fatura" }), _jsx("p", { style: { fontSize: '1.5rem', fontWeight: 800, color: '#f87171' }, children: formatBRL(invoiceSummary?.totalMinor ?? 0) })] })] }), _jsxs("div", { style: {
                            padding: '0.75rem 1rem',
                            background: '#1a2a3a',
                            borderLeft: '3px solid #6366f1',
                            borderRadius: '0 8px 8px 0',
                            fontSize: '0.82rem',
                            color: '#93c5fd',
                            textAlign: 'left',
                            marginBottom: '1.5rem',
                        }, children: ["A fatura foi registada com vencimento em ", _jsx("strong", { children: dueMonth }), ". O pagamento da fatura afectar\u00E1 o caixa quando for processado."] }), _jsx(Button, { onClick: reset, fullWidth: true, children: "Importar outra fatura" })] })), step === 'error' && (_jsxs(Card, { style: { textAlign: 'center', padding: '2.5rem' }, children: [_jsx("div", { style: { fontSize: '3rem', marginBottom: '1rem' }, children: "\u274C" }), _jsx(Alert, { variant: "error", style: { marginBottom: '1.5rem' }, children: errorMsg }), _jsx(Button, { onClick: reset, children: "Tentar novamente" })] }))] }));
}

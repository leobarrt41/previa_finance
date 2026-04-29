import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, currentMonth, formatBRL, } from '../services/api';
import { Alert, Button, Card, SectionTitle, Spinner } from '../components/ui';
function isInvestmentSweep(description) {
    return /(rende\s*facil|rende\s*fácil|aplica(c|ç)(a|ã)o|resgate|investimento|cdb|tesouro|fundo)/i.test(description);
}
function DropZone({ onFile }) {
    const inputRef = useRef(null);
    const [dragging, setDragging] = useState(false);
    function handleDrop(e) {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file)
            onFile(file);
    }
    return (_jsxs("div", { onDragOver: (e) => {
            e.preventDefault();
            setDragging(true);
        }, onDragLeave: () => setDragging(false), onDrop: handleDrop, onClick: () => inputRef.current?.click(), style: {
            border: `2px dashed ${dragging ? '#6366f1' : '#2a2f45'}`,
            borderRadius: 12,
            padding: '2.5rem 1.5rem',
            textAlign: 'center',
            cursor: 'pointer',
            background: dragging ? 'rgba(99,102,241,0.06)' : '#0f1117',
        }, children: [_jsx("div", { style: { fontSize: '2.2rem', marginBottom: '0.65rem' }, children: "\uD83C\uDFE6" }), _jsx("p", { style: { color: '#e5e7eb', fontWeight: 700, marginBottom: '0.35rem' }, children: "Arraste seu extrato OFX ou CSV" }), _jsx("p", { style: { color: '#6b7280', fontSize: '0.82rem' }, children: "ou clique para selecionar o arquivo" }), _jsx("p", { style: { color: '#4b5563', fontSize: '0.74rem', marginTop: '0.55rem' }, children: "Suportado: .ofx e .csv" }), _jsx("input", { ref: inputRef, type: "file", accept: ".ofx,.csv", style: { display: 'none' }, onChange: (e) => {
                    const file = e.target.files?.[0];
                    if (file)
                        onFile(file);
                } })] }));
}
function TransactionRow({ tx, categoryOptions, onChange, }) {
    const categoryEditable = tx.movementType !== 'transfer';
    return (_jsxs("tr", { style: { borderBottom: '1px solid #1f2436', opacity: tx.include ? 1 : 0.45 }, children: [_jsx("td", { style: { padding: '0.5rem', textAlign: 'center' }, children: _jsx("input", { type: "checkbox", checked: tx.include, onChange: (e) => onChange(tx.id, { include: e.target.checked }) }) }), _jsx("td", { style: { padding: '0.5rem', color: '#cbd5e1', fontSize: '0.8rem' }, children: tx.date }), _jsx("td", { style: { padding: '0.5rem', color: '#f3f4f6', fontSize: '0.84rem' }, children: tx.description }), _jsx("td", { style: {
                    padding: '0.5rem',
                    color: tx.amountMinor < 0 ? '#f87171' : '#4ade80',
                    textAlign: 'right',
                    fontWeight: 700,
                    fontSize: '0.83rem',
                }, children: formatBRL(tx.amountMinor) }), _jsx("td", { style: { padding: '0.5rem' }, children: _jsx("input", { value: tx.competencyMonth, onChange: (e) => onChange(tx.id, { competencyMonth: e.target.value }), style: {
                        background: '#0f1117',
                        border: '1px solid #2a2f45',
                        borderRadius: 6,
                        color: '#e5e7eb',
                        padding: '4px 8px',
                        fontSize: '0.78rem',
                        width: 90,
                    } }) }), _jsx("td", { style: { padding: '0.5rem' }, children: categoryEditable ? (_jsxs("select", { value: tx.categoryId ?? '', onChange: (e) => onChange(tx.id, { categoryId: e.target.value || null }), style: {
                        background: '#0f1117',
                        border: '1px solid #2a2f45',
                        borderRadius: 6,
                        color: '#e5e7eb',
                        padding: '4px 8px',
                        fontSize: '0.78rem',
                        minWidth: 210,
                        maxWidth: 260,
                        fontFamily: 'monospace',
                    }, children: [_jsx("option", { value: "", children: "\u2014 sem categoria \u2014" }), categoryOptions.map((opt) => (_jsx("option", { value: opt.id, disabled: opt.disabled, children: opt.label }, opt.id)))] })) : (_jsx("span", { style: { color: '#94a3b8', fontSize: '0.82rem' }, children: "N\u00E3o edit\u00E1vel" })) })] }));
}
export function StatementUpload() {
    const [step, setStep] = useState('select');
    const [file, setFile] = useState(null);
    const [transactions, setTransactions] = useState([]);
    const [categories, setCategories] = useState([]);
    const [accountHint, setAccountHint] = useState(null);
    const [detectedAccount, setDetectedAccount] = useState(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [result, setResult] = useState(null);
    useEffect(() => {
        api.categories.list().then(setCategories).catch(() => { });
    }, []);
    const categoryOptionsByType = useMemo(() => {
        const buildOptions = (type) => {
            const filtered = categories.filter((c) => c.type === type);
            const parents = filtered.filter((c) => !c.parentId);
            const byParent = new Map();
            for (const c of filtered) {
                if (!c.parentId)
                    continue;
                const arr = byParent.get(c.parentId) || [];
                arr.push(c);
                byParent.set(c.parentId, arr);
            }
            const sortByName = (a, b) => a.name.localeCompare(b.name);
            const options = [];
            for (const p of [...parents].sort(sortByName)) {
                const children = [...(byParent.get(p.id) || [])].sort(sortByName);
                if (children.length > 0) {
                    options.push({ id: p.id, label: p.name, disabled: true });
                    for (const child of children) {
                        options.push({ id: child.id, label: `  └ ${child.name}`, disabled: false });
                    }
                }
                else {
                    options.push({ id: p.id, label: p.name, disabled: false });
                }
            }
            return options;
        };
        return {
            expense: buildOptions('expense'),
            income: buildOptions('income'),
        };
    }, [categories]);
    const included = transactions.filter((tx) => tx.include);
    const neutralIncluded = included.filter((tx) => tx.movementType === 'transfer');
    const total = included
        .filter((tx) => tx.movementType !== 'transfer')
        .reduce((sum, tx) => sum + tx.amountMinor, 0);
    const monthFallback = currentMonth();
    function updateRow(id, patch) {
        setTransactions((prev) => prev.map((tx) => (tx.id === id ? { ...tx, ...patch } : tx)));
    }
    async function ensureCategoriesLoaded() {
        if (categories.length > 0)
            return categories;
        try {
            const loaded = await api.categories.list();
            setCategories(loaded);
            return loaded;
        }
        catch {
            return [];
        }
    }
    async function classifyWithAI(parsedTransactions, availableCategories) {
        if (availableCategories.length === 0)
            return parsedTransactions;
        // Investment sweeps are internal movements and should be neutral in cashflow.
        const normalized = parsedTransactions.map((tx) => {
            if (isInvestmentSweep(tx.description)) {
                return {
                    ...tx,
                    movementType: 'transfer',
                    categoryId: null,
                };
            }
            return tx;
        });
        const pending = normalized.filter((tx) => tx.include && tx.movementType !== 'transfer' && !tx.categoryId);
        if (pending.length === 0)
            return normalized;
        try {
            const response = await api.transactions.classifyStatement({
                transactions: pending.map((tx) => ({
                    id: tx.id,
                    description: tx.description,
                    amountMinor: tx.amountMinor,
                    movementType: tx.movementType,
                    categoryId: tx.categoryId ?? null,
                })),
                categories: availableCategories.map((c) => ({
                    id: c.id,
                    name: c.name,
                    slug: c.slug,
                    type: c.type,
                    parentId: c.parentId,
                })),
            });
            const suggestions = response.suggestions ?? {};
            if (Object.keys(suggestions).length === 0)
                return normalized;
            return normalized.map((tx) => {
                const suggestion = suggestions[tx.id];
                if (!suggestion)
                    return tx;
                return {
                    ...tx,
                    categoryId: suggestion.subcategoryId ?? suggestion.categoryId,
                };
            });
        }
        catch {
            return normalized;
        }
    }
    async function handleFile(selected) {
        setFile(selected);
        setStep('parsing');
        setErrorMsg('');
        try {
            const parsed = await api.transactions.parseStatement(selected);
            setAccountHint(parsed.sourceAccount);
            setDetectedAccount(parsed.detectedAccount);
            const baseTransactions = parsed.transactions.map((tx) => ({
                ...tx,
                competencyMonth: tx.competencyMonth || tx.date.slice(0, 7) || monthFallback,
                include: tx.include !== false,
            }));
            const loadedCategories = await ensureCategoriesLoaded();
            const classified = await classifyWithAI(baseTransactions, loadedCategories);
            setTransactions(classified);
            setStep('preview');
        }
        catch (error) {
            setErrorMsg(error instanceof Error ? error.message : 'Erro ao processar extrato');
            setStep('error');
        }
    }
    async function handleImport() {
        setStep('importing');
        setErrorMsg('');
        try {
            const response = await api.transactions.importStatement({
                accountId: detectedAccount?.id,
                sourceAccount: accountHint ?? undefined,
                transactions: transactions.map((tx) => ({
                    date: tx.date,
                    description: tx.description,
                    amountMinor: tx.amountMinor,
                    competencyMonth: tx.competencyMonth,
                    movementType: tx.movementType,
                    movementSubtype: tx.movementSubtype ?? null,
                    providerTransactionId: tx.providerTransactionId ?? null,
                    categoryId: tx.categoryId ?? null,
                    include: tx.include,
                })),
            });
            setResult(response);
            setStep('done');
        }
        catch (error) {
            setErrorMsg(error instanceof Error ? error.message : 'Erro ao importar extrato');
            setStep('error');
        }
    }
    function reset() {
        setStep('select');
        setFile(null);
        setTransactions([]);
        setAccountHint(null);
        setDetectedAccount(null);
        setErrorMsg('');
        setResult(null);
    }
    return (_jsxs("div", { style: { maxWidth: 1100 }, children: [_jsxs("div", { style: { marginBottom: '1.4rem' }, children: [_jsx("h1", { style: { fontSize: '1.4rem', fontWeight: 800, color: '#e5e7eb', margin: 0 }, children: "\uD83C\uDFE6 Upload de Extratos Banc\u00E1rios" }), _jsx("p", { style: { color: '#6b7280', marginTop: '0.3rem', fontSize: '0.85rem' }, children: "Envie OFX ou CSV, revise os lan\u00E7amentos e importe sem duplicar transa\u00E7\u00F5es j\u00E1 existentes." })] }), step === 'select' && (_jsxs(Card, { style: { maxWidth: 680 }, children: [_jsx(SectionTitle, { children: "Arquivo de extrato" }), _jsx(DropZone, { onFile: handleFile }), errorMsg && _jsx(Alert, { variant: "error", style: { marginTop: '1rem' }, children: errorMsg })] })), step === 'parsing' && (_jsxs(Card, { style: { textAlign: 'center', padding: '3rem' }, children: [_jsx(Spinner, { size: 40 }), _jsxs("p", { style: { marginTop: '1rem', color: '#9ca3af' }, children: ["Processando ", _jsx("strong", { style: { color: '#e5e7eb' }, children: file?.name }), "..."] })] })), step === 'preview' && (_jsxs(_Fragment, { children: [_jsx(Card, { style: { marginBottom: '1rem' }, children: _jsxs("div", { style: { display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }, children: [_jsxs("div", { children: [_jsx("p", { style: { fontSize: '0.75rem', color: '#6b7280', marginBottom: 4 }, children: "Arquivo" }), _jsx("p", { style: { fontSize: '0.9rem', color: '#e5e7eb', fontWeight: 700 }, children: file?.name })] }), _jsxs("div", { children: [_jsx("p", { style: { fontSize: '0.75rem', color: '#6b7280', marginBottom: 4 }, children: "Conta" }), _jsx("p", { style: { fontSize: '0.9rem', color: '#e5e7eb', fontWeight: 700 }, children: detectedAccount?.displayName ?? 'Conta será identificada/criada automaticamente' }), accountHint?.institutionName && (_jsxs("p", { style: { fontSize: '0.75rem', color: '#9ca3af', marginTop: 4 }, children: ["Institui\u00E7\u00E3o detectada: ", accountHint.institutionName, accountHint.accountLast4 ? ` ••••${accountHint.accountLast4}` : ''] }))] }), _jsxs("div", { style: { marginLeft: 'auto', textAlign: 'right' }, children: [_jsx("p", { style: { fontSize: '0.75rem', color: '#6b7280', marginBottom: 2 }, children: "Selecionadas" }), _jsx("p", { style: { fontSize: '1.1rem', color: '#e5e7eb', fontWeight: 800 }, children: included.length }), neutralIncluded.length > 0 && (_jsxs("p", { style: { fontSize: '0.72rem', color: '#9ca3af', marginTop: 2 }, children: [neutralIncluded.length, " neutra(s)"] })), _jsx("p", { style: { fontSize: '0.85rem', color: total < 0 ? '#f87171' : '#4ade80', fontWeight: 700 }, children: formatBRL(total) })] })] }) }), errorMsg && _jsx(Alert, { variant: "error", style: { marginBottom: '1rem' }, children: errorMsg }), _jsx(Card, { style: { padding: 0, overflow: 'hidden' }, children: _jsx("div", { style: { overflowX: 'auto' }, children: _jsxs("table", { style: { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', minWidth: 980 }, children: [_jsx("thead", { children: _jsxs("tr", { style: { borderBottom: '1px solid #2a2f45', background: '#0f1117', color: '#9ca3af' }, children: [_jsx("th", { style: { padding: '0.5rem', width: 36 } }), _jsx("th", { style: { padding: '0.5rem', textAlign: 'left' }, children: "Data" }), _jsx("th", { style: { padding: '0.5rem', textAlign: 'left' }, children: "Descri\u00E7\u00E3o" }), _jsx("th", { style: { padding: '0.5rem', textAlign: 'right' }, children: "Valor" }), _jsx("th", { style: { padding: '0.5rem', textAlign: 'left' }, children: "Compet\u00EAncia" }), _jsx("th", { style: { padding: '0.5rem', textAlign: 'left' }, children: "Categoria" })] }) }), _jsx("tbody", { children: transactions.map((tx) => (_jsx(TransactionRow, { tx: tx, categoryOptions: tx.movementType === 'income' ? categoryOptionsByType.income : categoryOptionsByType.expense, onChange: updateRow }, tx.id))) })] }) }) }), _jsxs("div", { style: { display: 'flex', gap: '0.75rem', marginTop: '1rem', justifyContent: 'flex-end' }, children: [_jsx(Button, { variant: "secondary", onClick: reset, children: "Cancelar" }), _jsxs(Button, { onClick: handleImport, disabled: included.length === 0, children: ["Importar ", included.length, " lan\u00E7amento(s)"] })] })] })), step === 'importing' && (_jsxs(Card, { style: { textAlign: 'center', padding: '3rem' }, children: [_jsx(Spinner, { size: 40 }), _jsx("p", { style: { color: '#9ca3af', marginTop: '1rem' }, children: "Importando lan\u00E7amentos..." })] })), step === 'done' && result && (_jsxs(Card, { style: { textAlign: 'center', padding: '2.4rem' }, children: [_jsx("div", { style: { fontSize: '3rem', marginBottom: '0.8rem' }, children: "\u2705" }), _jsx("h2", { style: { color: '#4ade80', fontSize: '1.2rem', fontWeight: 800, marginBottom: '0.8rem' }, children: "Extrato importado" }), _jsxs("div", { style: { display: 'flex', justifyContent: 'center', gap: '1.2rem', flexWrap: 'wrap', marginBottom: '1rem' }, children: [_jsxs("span", { style: { color: '#e5e7eb' }, children: ["Importadas: ", _jsx("strong", { children: result.imported })] }), _jsxs("span", { style: { color: '#fbbf24' }, children: ["Duplicadas: ", _jsx("strong", { children: result.skippedDuplicates })] }), _jsxs("span", { style: { color: '#f87171' }, children: ["Inv\u00E1lidas: ", _jsx("strong", { children: result.skippedInvalid })] })] }), _jsx(Button, { onClick: reset, fullWidth: true, children: "Importar outro extrato" })] })), step === 'error' && (_jsxs(Card, { style: { textAlign: 'center', padding: '2.5rem' }, children: [_jsx("div", { style: { fontSize: '2.5rem', marginBottom: '0.8rem' }, children: "\u274C" }), _jsx(Alert, { variant: "error", style: { marginBottom: '1rem' }, children: errorMsg }), _jsx(Button, { onClick: reset, children: "Tentar novamente" })] }))] }));
}

import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * ReceiptDocuments.tsx — Notas Fiscais & Comprovantes
 *
 * Hierarquia ETP §6.3: nota_fiscal (nível 4) > manual (nível 5)
 *
 * Fluxo:
 *   1. Usuário registra nota (cartão ou débito) → data_state = 'projected'
 *   2. Nota entra no CashFlow como previsão (laranja=cartão, vermelho=débito)
 *   3. Quando fatura/extrato chega → reconciliação automática → some do cashflow manual
 *
 * Botão rápido (FAB) fixo no canto inferior direito para uso no estabelecimento.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, formatBRL, currentMonth, } from '../services/api';
import { Card, Badge, Spinner, Alert, Button, Input, Select, SectionTitle, } from '../components/ui';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtDate(iso) {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function stateLabel(s) {
    if (s === 'projected')
        return 'Pendente';
    if (s === 'reconciled')
        return 'Reconciliada';
    if (s === 'cancelled')
        return 'Cancelada';
    return s;
}
function stateColor(s) {
    if (s === 'projected')
        return '#f59e0b';
    if (s === 'reconciled')
        return '#22c55e';
    if (s === 'cancelled')
        return '#6b7280';
    return '#9ca3af';
}
function paymentType(doc) {
    if (doc.expectedInvoiceMonth)
        return 'Cartão';
    return 'Débito';
}
function isRenderableFileUrl(url) {
    return typeof url === 'string' && /^(https?:|data:|blob:)/.test(url);
}
const emptyForm = () => {
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const yyyy = today.getFullYear();
    return {
        amountMinor: '',
        purchaseDate: `${yyyy}-${mm}-${dd}`,
        purchaseMonth: `${yyyy}-${mm}`,
        expectedInvoiceMonth: '',
        merchantName: '',
        merchantCnpj: '',
        categoryId: '',
        accountId: '',
        nfeKey: '',
        installmentTotal: '',
        installmentCurrent: '',
        description: '',
        fileUrl: '',
        fileType: '',
        paymentKind: 'card',
    };
};
// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ReceiptDocuments() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [month, setMonth] = useState(currentMonth());
    const [stateFilter, setStateFilter] = useState('projected');
    const [docs, setDocs] = useState([]);
    const [summary, setSummary] = useState(null);
    const [categories, setCategories] = useState([]);
    const [accounts, setAccounts] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    // Modal
    const [showModal, setShowModal] = useState(false);
    const [modalMode, setModalMode] = useState('quick');
    const [form, setForm] = useState(emptyForm());
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(null);
    const [scanning, setScanning] = useState(false);
    // Expanded card
    const [expandedId, setExpandedId] = useState(null);
    // ---------------------------------------------------------------------------
    // Load
    // ---------------------------------------------------------------------------
    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [docsRes, sumRes] = await Promise.all([
                api.receiptDocuments.list({ month, state: stateFilter || undefined }),
                api.receiptDocuments.summary(month),
            ]);
            setDocs(docsRes.data);
            setSummary(sumRes);
        }
        catch (e) {
            setError(e.message);
        }
        finally {
            setLoading(false);
        }
    }, [month, stateFilter]);
    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        api.categories.list().then(setCategories).catch(() => { });
        api.accounts.list().then(r => setAccounts(r.items)).catch(() => { });
    }, []);
    // Open quick modal if ?quick=1 in URL (botão rápido externo)
    useEffect(() => {
        if (searchParams.get('quick') === '1') {
            setModalMode('quick');
            setShowModal(true);
        }
    }, [searchParams]);
    // ---------------------------------------------------------------------------
    // Save
    // ---------------------------------------------------------------------------
    async function handleSave() {
        if (!form.amountMinor || !form.purchaseDate || !form.purchaseMonth) {
            setSaveError('Valor, data e mês são obrigatórios.');
            return;
        }
        setSaving(true);
        setSaveError(null);
        try {
            const amountMinor = Math.round(parseFloat(form.amountMinor.replace(',', '.')) * 100);
            await api.receiptDocuments.create({
                amountMinor,
                purchaseDate: new Date(form.purchaseDate).toISOString(),
                purchaseMonth: form.purchaseMonth,
                expectedInvoiceMonth: form.paymentKind === 'card' && form.expectedInvoiceMonth
                    ? form.expectedInvoiceMonth
                    : null,
                merchantName: form.merchantName || null,
                merchantCnpj: form.merchantCnpj || null,
                categoryId: form.categoryId || null,
                accountId: form.accountId ? Number(form.accountId) : null,
                nfeKey: form.nfeKey || null,
                installmentTotal: form.installmentTotal ? Number(form.installmentTotal) : null,
                installmentCurrent: form.installmentCurrent ? Number(form.installmentCurrent) : null,
                description: form.description || null,
                fileUrl: form.fileUrl || null,
                fileType: form.fileType || null,
            });
            setShowModal(false);
            setForm(emptyForm());
            load();
        }
        catch (e) {
            setSaveError(e.message);
        }
        finally {
            setSaving(false);
        }
    }
    // ---------------------------------------------------------------------------
    // Delete
    // ---------------------------------------------------------------------------
    async function handleDelete(id) {
        if (!confirm('Cancelar esta nota?'))
            return;
        try {
            await api.receiptDocuments.remove(id);
            load();
        }
        catch (e) {
            alert(e.message);
        }
    }
    // ---------------------------------------------------------------------------
    // Photo upload (câmera nativa mobile)
    // ---------------------------------------------------------------------------
    async function handlePhotoChange(e) {
        const file = e.target.files?.[0];
        if (!file)
            return;
        setScanning(true);
        setSaveError(null);
        try {
            await api.receiptDocuments.scan(file);
            setShowModal(false);
            setForm(emptyForm());
            await load();
        }
        catch (err) {
            setSaveError(err?.message ?? 'Falha ao ler comprovante');
        }
        finally {
            setScanning(false);
        }
    }
    // ---------------------------------------------------------------------------
    // Render helpers
    // ---------------------------------------------------------------------------
    const expenseCategories = categories.filter(c => c.type === 'expense' && !c.parentId);
    const cardAccounts = accounts.filter(a => a.type === 'credit_card');
    const debitAccounts = accounts.filter(a => a.type !== 'credit_card');
    // ---------------------------------------------------------------------------
    // Modal
    // ---------------------------------------------------------------------------
    function renderModal() {
        return (_jsx("div", { style: {
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
                display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                zIndex: 1000,
            }, children: _jsxs("div", { style: {
                    background: '#1a1f35', borderRadius: '16px 16px 0 0',
                    padding: '1.5rem', width: '100%', maxWidth: 480,
                    maxHeight: '90vh', overflowY: 'auto',
                }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }, children: [_jsx("h3", { style: { color: '#e5e7eb', margin: 0, fontSize: '1.1rem' }, children: modalMode === 'quick' ? '🧾 Nota Rápida' : '🧾 Nova Nota Fiscal' }), _jsx("button", { onClick: () => setShowModal(false), style: { background: 'none', border: 'none', color: '#9ca3af', fontSize: '1.4rem', cursor: 'pointer' }, children: "\u00D7" })] }), _jsx("div", { style: { display: 'flex', gap: 8, marginBottom: '1rem' }, children: ['card', 'debit'].map(k => (_jsx("button", { onClick: () => setForm(f => ({ ...f, paymentKind: k })), style: {
                                flex: 1, padding: '0.5rem', borderRadius: 8, border: 'none', cursor: 'pointer',
                                background: form.paymentKind === k ? (k === 'card' ? '#f59e0b' : '#ef4444') : '#2a2f45',
                                color: form.paymentKind === k ? '#000' : '#9ca3af', fontWeight: 600, fontSize: '0.85rem',
                            }, children: k === 'card' ? '💳 Cartão' : '🏦 Débito' }, k))) }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.75rem' }, children: [_jsxs("div", { children: [_jsx("label", { style: { fontSize: '0.8rem', color: '#9ca3af', fontWeight: 500, display: 'block', marginBottom: 4 }, children: "Foto do comprovante ou PDF" }), _jsx("input", { type: "file", accept: "image/*,application/pdf", capture: "environment", onChange: handlePhotoChange, style: { color: '#e5e7eb', fontSize: '0.85rem' } }), _jsx("p", { style: { fontSize: '0.75rem', color: '#6b7280', marginTop: 4, lineHeight: 1.5 }, children: "Envie a foto ou o PDF. A IA tenta extrair os dados e cadastrar a nota automaticamente." })] }), modalMode === 'full' && (_jsxs(_Fragment, { children: [_jsx(Input, { label: "Valor (R$) *", placeholder: "0,00", value: form.amountMinor, onChange: e => setForm(f => ({ ...f, amountMinor: e.target.value })), inputMode: "decimal" }), _jsx(Input, { label: "Estabelecimento", placeholder: "Nome do estabelecimento", value: form.merchantName, onChange: e => setForm(f => ({ ...f, merchantName: e.target.value })) }), _jsx(Input, { label: "Data da compra *", type: "date", value: form.purchaseDate, onChange: e => {
                                            const d = e.target.value;
                                            const pm = d.substring(0, 7);
                                            setForm(f => ({ ...f, purchaseDate: d, purchaseMonth: pm }));
                                        } }), form.paymentKind === 'card' && (_jsx(Input, { label: "M\u00EAs estimado da fatura (YYYY-MM)", placeholder: "2026-06", value: form.expectedInvoiceMonth, onChange: e => setForm(f => ({ ...f, expectedInvoiceMonth: e.target.value })) })), _jsxs(Select, { label: "Categoria", value: form.categoryId, onChange: e => setForm(f => ({ ...f, categoryId: e.target.value })), children: [_jsx("option", { value: "", children: "\u2014 Selecionar \u2014" }), expenseCategories.map(c => (_jsx("option", { value: c.id, children: c.name }, c.id)))] }), _jsxs(Select, { label: form.paymentKind === 'card' ? 'Cartão' : 'Conta', value: form.accountId, onChange: e => setForm(f => ({ ...f, accountId: e.target.value })), children: [_jsx("option", { value: "", children: "\u2014 Selecionar \u2014" }), (form.paymentKind === 'card' ? cardAccounts : debitAccounts).map(a => (_jsx("option", { value: a.id, children: a.displayName }, a.id)))] }), _jsx(Input, { label: "Chave NF-e (44 d\u00EDgitos)", placeholder: "Chave de acesso da nota fiscal", value: form.nfeKey, onChange: e => setForm(f => ({ ...f, nfeKey: e.target.value })) }), _jsx(Input, { label: "CNPJ do estabelecimento", placeholder: "00.000.000/0000-00", value: form.merchantCnpj, onChange: e => setForm(f => ({ ...f, merchantCnpj: e.target.value })) }), _jsxs("div", { style: { display: 'flex', gap: 8 }, children: [_jsx(Input, { label: "Parcela atual", type: "number", min: 1, value: form.installmentCurrent, onChange: e => setForm(f => ({ ...f, installmentCurrent: e.target.value })) }), _jsx(Input, { label: "Total de parcelas", type: "number", min: 1, value: form.installmentTotal, onChange: e => setForm(f => ({ ...f, installmentTotal: e.target.value })) })] }), _jsx(Input, { label: "Descri\u00E7\u00E3o", placeholder: "Observa\u00E7\u00F5es sobre a compra", value: form.description, onChange: e => setForm(f => ({ ...f, description: e.target.value })) })] }))] }), saveError && _jsx(Alert, { variant: "error", style: { marginTop: '0.75rem' }, children: saveError }), _jsxs("div", { style: { display: 'flex', gap: 8, marginTop: '1rem' }, children: [modalMode === 'quick' && (_jsx(Button, { variant: "secondary", onClick: () => setModalMode('full'), children: "+ Detalhes" })), _jsx(Button, { onClick: handleSave, disabled: saving || scanning, fullWidth: true, children: saving ? 'Salvando...' : scanning ? 'Lendo...' : 'Salvar Nota' })] })] }) }));
    }
    // ---------------------------------------------------------------------------
    // Main render
    // ---------------------------------------------------------------------------
    return (_jsxs("div", { style: { padding: '1rem', maxWidth: 700, margin: '0 auto', paddingBottom: 100 }, children: [_jsx(SectionTitle, { children: "\uD83E\uDDFE Notas Fiscais" }), _jsxs("div", { style: { display: 'flex', gap: 8, marginBottom: '1rem', flexWrap: 'wrap' }, children: [_jsx(Input, { type: "month", value: month, onChange: e => setMonth(e.target.value), style: { width: 160 } }), _jsxs(Select, { value: stateFilter, onChange: e => setStateFilter(e.target.value), style: { width: 160 }, children: [_jsx("option", { value: "", children: "Todas" }), _jsx("option", { value: "projected", children: "Pendentes" }), _jsx("option", { value: "reconciled", children: "Reconciliadas" }), _jsx("option", { value: "cancelled", children: "Canceladas" })] }), _jsx(Button, { onClick: () => { setModalMode('quick'); setShowModal(true); }, variant: "secondary", children: "+ Enviar comprovante" })] }), summary && (_jsxs("div", { style: { display: 'flex', gap: 8, marginBottom: '1rem', flexWrap: 'wrap' }, children: [_jsxs(Card, { style: { flex: 1, minWidth: 120, textAlign: 'center' }, children: [_jsx("div", { style: { fontSize: '0.75rem', color: '#9ca3af', marginBottom: 4 }, children: "Pendente" }), _jsx("div", { style: { color: '#f59e0b', fontWeight: 700, fontSize: '1.1rem' }, children: formatBRL(summary.projected) })] }), _jsxs(Card, { style: { flex: 1, minWidth: 120, textAlign: 'center' }, children: [_jsx("div", { style: { fontSize: '0.75rem', color: '#9ca3af', marginBottom: 4 }, children: "Reconciliada" }), _jsx("div", { style: { color: '#22c55e', fontWeight: 700, fontSize: '1.1rem' }, children: formatBRL(summary.reconciled) })] }), _jsxs(Card, { style: { flex: 1, minWidth: 120, textAlign: 'center' }, children: [_jsx("div", { style: { fontSize: '0.75rem', color: '#9ca3af', marginBottom: 4 }, children: "Total" }), _jsx("div", { style: { color: '#60a5fa', fontWeight: 700, fontSize: '1.1rem' }, children: formatBRL(summary.total) })] })] })), loading && _jsx("div", { style: { textAlign: 'center', padding: '2rem' }, children: _jsx(Spinner, {}) }), error && _jsx(Alert, { variant: "error", children: error }), !loading && !error && docs.length === 0 && (_jsxs(Card, { style: { textAlign: 'center', padding: '2rem', color: '#6b7280' }, children: [_jsx("div", { style: { fontSize: '2rem', marginBottom: 8 }, children: "\uD83E\uDDFE" }), _jsx("div", { children: "Nenhuma nota registrada para este m\u00EAs." }), _jsx("div", { style: { fontSize: '0.85rem', marginTop: 4 }, children: "Use o bot\u00E3o para enviar uma foto ou PDF e deixar a IA cadastrar automaticamente." })] })), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: docs.map(doc => (_jsxs(Card, { style: { cursor: 'pointer' }, onClick: () => setExpandedId(expandedId === doc.id ? null : doc.id), children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, children: [_jsxs("div", { style: { flex: 1 }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }, children: [_jsx(Badge, { variant: doc.dataState === 'projected' ? 'yellow' : doc.dataState === 'reconciled' ? 'green' : 'gray', children: stateLabel(doc.dataState) }), _jsx(Badge, { variant: doc.expectedInvoiceMonth ? 'blue' : 'gray', children: paymentType(doc) })] }), _jsx("div", { style: { color: '#e5e7eb', fontWeight: 600 }, children: doc.merchantName || 'Estabelecimento não informado' }), _jsxs("div", { style: { fontSize: '0.8rem', color: '#9ca3af' }, children: [fmtDate(doc.purchaseDate), doc.installmentTotal && ` · ${doc.installmentCurrent}/${doc.installmentTotal}x`, doc.expectedInvoiceMonth && ` · Fatura ${doc.expectedInvoiceMonth}`] })] }), _jsxs("div", { style: { textAlign: 'right' }, children: [_jsxs("div", { style: { color: '#f87171', fontWeight: 700, fontSize: '1.1rem' }, children: ["-", formatBRL(doc.amountMinor)] }), _jsx("div", { style: { fontSize: '0.75rem', color: '#6b7280', marginTop: 2 }, children: expandedId === doc.id ? '▲' : '▼' })] })] }), expandedId === doc.id && (_jsxs("div", { style: { marginTop: '0.75rem', borderTop: '1px solid #2a2f45', paddingTop: '0.75rem' }, children: [_jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.82rem', color: '#9ca3af' }, children: [doc.merchantCnpj && _jsxs("div", { children: [_jsx("strong", { children: "CNPJ:" }), " ", doc.merchantCnpj] }), doc.categoryId && _jsxs("div", { children: [_jsx("strong", { children: "Categoria:" }), " ", doc.categoryId] }), doc.nfeKey && _jsxs("div", { style: { gridColumn: '1/-1' }, children: [_jsx("strong", { children: "Chave NF-e:" }), " ", _jsx("span", { style: { fontFamily: 'monospace', fontSize: '0.75rem' }, children: doc.nfeKey })] }), doc.description && _jsxs("div", { style: { gridColumn: '1/-1' }, children: [_jsx("strong", { children: "Descri\u00E7\u00E3o:" }), " ", doc.description] }), doc.fileUrl && (_jsxs("div", { style: { gridColumn: '1/-1' }, children: [_jsx("strong", { children: "Comprovante:" }), ' ', isRenderableFileUrl(doc.fileUrl) && doc.fileType?.startsWith('image/') ? (_jsx("img", { src: doc.fileUrl, alt: "comprovante", style: { maxWidth: 200, borderRadius: 8, marginTop: 4 } })) : isRenderableFileUrl(doc.fileUrl) ? (_jsx("a", { href: doc.fileUrl, target: "_blank", rel: "noreferrer", style: { color: '#60a5fa' }, children: "Ver arquivo" })) : (_jsx("span", { style: { color: '#9ca3af' }, children: doc.fileUrl }))] })), doc.reconciledAt && _jsxs("div", { children: [_jsx("strong", { children: "Reconciliada em:" }), " ", fmtDate(doc.reconciledAt)] })] }), doc.dataState === 'projected' && (_jsx("div", { style: { display: 'flex', gap: 8, marginTop: '0.75rem' }, children: _jsx(Button, { variant: "danger", onClick: () => handleDelete(doc.id), children: "Cancelar nota" }) }))] }))] }, doc.id))) }), showModal && renderModal(), _jsx("button", { onClick: () => { setModalMode('quick'); setForm(emptyForm()); setShowModal(true); }, title: "Registrar nota r\u00E1pida", style: {
                    position: 'fixed', bottom: 24, right: 24,
                    width: 56, height: 56, borderRadius: '50%',
                    background: '#3b82f6', border: 'none',
                    color: '#fff', fontSize: '1.6rem', cursor: 'pointer',
                    boxShadow: '0 4px 16px rgba(59,130,246,0.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 999,
                }, children: "+" })] }));
}

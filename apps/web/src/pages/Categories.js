import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Categories.tsx — Gestão de Categorias e Subcategorias
 *
 * Contratos de API:
 *   GET    /api/categories/tree  — árvore hierárquica
 *   POST   /api/categories       — criar
 *   PUT    /api/categories/:id   — editar
 *   DELETE /api/categories/:id   — remover
 */
import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import { Card, Badge, Button, Input, Select, Alert, Spinner, EmptyState, } from '../components/ui';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function typeLabel(type) {
    return type === 'expense' ? 'Despesa' : 'Receita';
}
function typeVariant(type) {
    return type === 'expense' ? 'red' : 'green';
}
// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function CategoryRow({ cat, onEdit, onDelete, onAddSub, }) {
    const hasChildren = cat.children && cat.children.length > 0;
    const [open, setOpen] = useState(hasChildren);
    // Keep parent expanded whenever it gains children after reload/create.
    useEffect(() => {
        if (hasChildren) {
            setOpen(true);
        }
    }, [hasChildren]);
    return (_jsxs("div", { children: [_jsxs("div", { style: {
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0.55rem 0.75rem',
                    borderBottom: '1px solid #1e2130',
                    gap: '0.5rem',
                }, children: [_jsx("button", { onClick: () => setOpen((p) => !p), style: {
                            background: 'none',
                            border: 'none',
                            color: hasChildren ? '#6366f1' : '#2a2f45',
                            cursor: hasChildren ? 'pointer' : 'default',
                            fontSize: '0.85rem',
                            width: 20,
                            flexShrink: 0,
                        }, children: hasChildren ? (open ? '▾' : '▸') : '·' }), _jsx("span", { style: { flex: 1, fontSize: '0.88rem', color: '#e5e7eb', fontWeight: 600 }, children: cat.name }), _jsx(Badge, { variant: typeVariant(cat.type), children: typeLabel(cat.type) }), cat.isSystem && (_jsx(Badge, { variant: "gray", children: "sistema" })), _jsxs("div", { style: { display: 'flex', gap: 4 }, children: [_jsx("button", { onClick: () => onAddSub(cat), title: "Adicionar subcategoria", style: { background: 'none', border: '1px solid #2a2f45', borderRadius: 6, color: '#6366f1', cursor: 'pointer', padding: '2px 7px', fontSize: '0.78rem' }, children: "+ sub" }), _jsx("button", { onClick: () => onEdit(cat), title: "Editar", style: { background: 'none', border: '1px solid #2a2f45', borderRadius: 6, color: '#9ca3af', cursor: 'pointer', padding: '2px 7px', fontSize: '0.78rem' }, children: "\u270E" }), !cat.isSystem && (_jsx("button", { onClick: () => onDelete(cat), title: "Remover", style: { background: 'none', border: '1px solid #2a2f45', borderRadius: 6, color: '#f87171', cursor: 'pointer', padding: '2px 7px', fontSize: '0.78rem' }, children: "\u00D7" }))] })] }), open && hasChildren && (_jsx("div", { style: { paddingLeft: '1.5rem', borderLeft: '2px solid #1e2130', marginLeft: '1.25rem' }, children: cat.children.map((child) => (_jsxs("div", { style: {
                        display: 'flex',
                        alignItems: 'center',
                        padding: '0.45rem 0.75rem',
                        borderBottom: '1px solid #1a1e2e',
                        gap: '0.5rem',
                    }, children: [_jsx("span", { style: { width: 20, flexShrink: 0, color: '#2a2f45', fontSize: '0.8rem' }, children: "\u2514" }), _jsx("span", { style: { flex: 1, fontSize: '0.85rem', color: '#d1d5db' }, children: child.name }), _jsx(Badge, { variant: typeVariant(child.type), children: typeLabel(child.type) }), child.isSystem && _jsx(Badge, { variant: "gray", children: "sistema" }), _jsxs("div", { style: { display: 'flex', gap: 4 }, children: [_jsx("button", { onClick: () => onEdit(child), style: { background: 'none', border: '1px solid #2a2f45', borderRadius: 6, color: '#9ca3af', cursor: 'pointer', padding: '2px 7px', fontSize: '0.78rem' }, children: "\u270E" }), !child.isSystem && (_jsx("button", { onClick: () => onDelete(child), style: { background: 'none', border: '1px solid #2a2f45', borderRadius: 6, color: '#f87171', cursor: 'pointer', padding: '2px 7px', fontSize: '0.78rem' }, children: "\u00D7" }))] })] }, child.id))) }))] }));
}
// ---------------------------------------------------------------------------
// Modal de criação / edição
// ---------------------------------------------------------------------------
function CategoryModal({ mode, initial, parentId, parentName, flatList, onSave, onClose, }) {
    const [name, setName] = useState(initial?.name ?? '');
    const [type, setType] = useState(initial?.type ?? 'expense');
    const [parent, setParent] = useState(initial?.parentId ?? parentId ?? '');
    const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 50));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    async function handleSave() {
        if (!name.trim()) {
            setError('Nome obrigatório');
            return;
        }
        setSaving(true);
        try {
            await onSave({
                name: name.trim(),
                type,
                parentId: parent || null,
                sortOrder: parseInt(sortOrder) || 50,
            });
            onClose();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Erro ao salvar');
        }
        finally {
            setSaving(false);
        }
    }
    // Roots only for parent selector (prevent deep nesting)
    const roots = flatList.filter((c) => c.parentId === null);
    return (_jsx("div", { style: {
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }, onClick: (e) => { if (e.target === e.currentTarget)
            onClose(); }, children: _jsxs("div", { style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 12, padding: '1.5rem', width: 400, maxWidth: '95vw' }, children: [_jsx("h3", { style: { color: '#e5e7eb', fontWeight: 700, marginBottom: '1rem', fontSize: '1rem' }, children: mode === 'create' ? (parentName ? `Nova subcategoria de "${parentName}"` : 'Nova categoria') : `Editar "${initial?.name}"` }), error && _jsx(Alert, { variant: "error", style: { marginBottom: '0.75rem' }, children: error }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '0.75rem' }, children: [_jsx(Input, { label: "Nome", value: name, onChange: (e) => setName(e.target.value), placeholder: "Ex: Combust\u00EDvel" }), _jsxs(Select, { label: "Tipo", value: type, onChange: (e) => setType(e.target.value), children: [_jsx("option", { value: "expense", children: "Despesa" }), _jsx("option", { value: "income", children: "Receita" })] }), !parentId && (_jsxs(Select, { label: "Categoria pai (opcional)", value: parent, onChange: (e) => setParent(e.target.value), children: [_jsx("option", { value: "", children: "\u2014 Nenhuma (categoria raiz) \u2014" }), roots.map((r) => (_jsx("option", { value: r.id, children: r.name }, r.id)))] })), _jsx(Input, { label: "Ordem de exibi\u00E7\u00E3o", type: "number", value: sortOrder, onChange: (e) => setSortOrder(e.target.value) })] }), _jsxs("div", { style: { display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }, children: [_jsx(Button, { onClick: onClose, variant: "secondary", fullWidth: true, children: "Cancelar" }), _jsx(Button, { onClick: handleSave, fullWidth: true, disabled: saving, children: saving ? 'Salvando...' : 'Salvar' })] })] }) }));
}
// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export function Categories() {
    const [tree, setTree] = useState([]);
    const [flat, setFlat] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState('all');
    const [search, setSearch] = useState('');
    // Modal state
    const [modal, setModal] = useState(null);
    const [deleteConfirm, setDeleteConfirm] = useState(null);
    const [deleteError, setDeleteError] = useState('');
    const loadCategories = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const [treeData, flatData] = await Promise.all([
                api.categories.tree(),
                api.categories.list(),
            ]);
            setTree(treeData);
            setFlat(flatData);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Erro ao carregar categorias');
        }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { loadCategories(); }, [loadCategories]);
    // Filtered tree
    const filteredTree = tree.filter((cat) => {
        const matchType = filter === 'all' || cat.type === filter;
        const matchSearch = !search || cat.name.toLowerCase().includes(search.toLowerCase()) ||
            cat.children?.some((c) => c.name.toLowerCase().includes(search.toLowerCase()));
        return matchType && matchSearch;
    });
    // Handlers
    async function handleSave(data) {
        if (modal?.mode === 'edit' && modal.initial) {
            await api.categories.update(modal.initial.id, data);
        }
        else {
            await api.categories.create(data);
        }
        await loadCategories();
    }
    async function handleDelete(cat) {
        setDeleteError('');
        try {
            await api.categories.remove(cat.id);
            setDeleteConfirm(null);
            await loadCategories();
        }
        catch (e) {
            setDeleteError(e instanceof Error ? e.message : 'Erro ao remover');
        }
    }
    return (_jsxs("div", { style: { maxWidth: 860 }, children: [_jsxs("div", { style: { marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }, children: [_jsxs("div", { children: [_jsx("h1", { style: { fontSize: '1.4rem', fontWeight: 800, color: '#e5e7eb', margin: 0 }, children: "\uD83C\uDFF7\uFE0F Categorias" }), _jsx("p", { style: { color: '#6b7280', marginTop: '0.3rem', fontSize: '0.85rem' }, children: "Gerencie categorias e subcategorias financeiras." })] }), _jsx(Button, { onClick: () => setModal({ mode: 'create' }), children: "+ Nova categoria" })] }), _jsxs("div", { style: { display: 'flex', gap: '0.75rem', marginBottom: '1rem', alignItems: 'center' }, children: [_jsx("input", { value: search, onChange: (e) => setSearch(e.target.value), placeholder: "Buscar...", style: {
                            background: '#141624', border: '1px solid #2a2f45', borderRadius: 8,
                            padding: '0.5rem 0.75rem', color: '#e5e7eb', fontSize: '0.85rem', flex: 1,
                        } }), ['all', 'expense', 'income'].map((f) => (_jsx("button", { onClick: () => setFilter(f), style: {
                            background: filter === f ? '#6366f1' : '#141624',
                            border: '1px solid #2a2f45',
                            borderRadius: 8,
                            padding: '0.45rem 0.9rem',
                            color: filter === f ? '#fff' : '#9ca3af',
                            cursor: 'pointer',
                            fontSize: '0.82rem',
                            fontWeight: filter === f ? 700 : 400,
                        }, children: f === 'all' ? 'Todas' : f === 'expense' ? 'Despesas' : 'Receitas' }, f)))] }), loading && (_jsx("div", { style: { display: 'flex', justifyContent: 'center', padding: '3rem' }, children: _jsx(Spinner, { size: 36 }) })), error && _jsx(Alert, { variant: "error", children: error }), !loading && !error && (_jsx(Card, { style: { padding: 0, overflow: 'hidden' }, children: filteredTree.length === 0 ? (_jsx(EmptyState, { icon: "\uD83C\uDFF7\uFE0F", title: "Nenhuma categoria encontrada", description: "Ajuste o filtro ou crie uma nova categoria." })) : (filteredTree.map((cat) => (_jsx(CategoryRow, { cat: cat, onEdit: (c) => setModal({ mode: 'edit', initial: c }), onDelete: (c) => { setDeleteConfirm(c); setDeleteError(''); }, onAddSub: (parent) => setModal({ mode: 'create', parentId: parent.id, parentName: parent.name }) }, cat.id)))) })), !loading && flat.length > 0 && (_jsx("div", { style: { display: 'flex', gap: '1rem', marginTop: '1rem' }, children: [
                    { label: 'Total', value: flat.length, variant: 'gray' },
                    { label: 'Despesa', value: flat.filter((c) => c.type === 'expense').length, variant: 'red' },
                    { label: 'Receita', value: flat.filter((c) => c.type === 'income').length, variant: 'green' },
                    { label: 'Sistema', value: flat.filter((c) => c.isSystem).length, variant: 'blue' },
                    { label: 'Personalizadas', value: flat.filter((c) => !c.isSystem).length, variant: 'yellow' },
                ].map(({ label, value, variant }) => (_jsxs("div", { style: { textAlign: 'center', flex: 1 }, children: [_jsx("p", { style: { fontSize: '0.72rem', color: '#6b7280', marginBottom: 2 }, children: label }), _jsx(Badge, { variant: variant, children: value })] }, label))) })), modal && (_jsx(CategoryModal, { mode: modal.mode, initial: modal.initial, parentId: modal.parentId, parentName: modal.parentName, flatList: flat, onSave: handleSave, onClose: () => setModal(null) })), deleteConfirm && (_jsx("div", { style: {
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
                }, children: _jsxs("div", { style: { background: '#141624', border: '1px solid #2a2f45', borderRadius: 12, padding: '1.5rem', width: 380 }, children: [_jsx("h3", { style: { color: '#e5e7eb', fontWeight: 700, marginBottom: '0.75rem', fontSize: '1rem' }, children: "Remover categoria?" }), _jsxs("p", { style: { color: '#9ca3af', fontSize: '0.85rem', marginBottom: '1rem' }, children: ["Tem certeza que deseja remover ", _jsx("strong", { style: { color: '#e5e7eb' }, children: deleteConfirm.name }), "? Esta ac\u00E7\u00E3o n\u00E3o pode ser desfeita."] }), deleteError && _jsx(Alert, { variant: "error", style: { marginBottom: '0.75rem' }, children: deleteError }), _jsxs("div", { style: { display: 'flex', gap: '0.75rem' }, children: [_jsx(Button, { onClick: () => setDeleteConfirm(null), variant: "secondary", fullWidth: true, children: "Cancelar" }), _jsx(Button, { onClick: () => handleDelete(deleteConfirm), fullWidth: true, style: { background: '#dc2626' }, children: "Remover" })] })] }) }))] }));
}

/**
 * Categories.tsx — Gestão de Categorias e Subcategorias
 *
 * Contratos de API:
 *   GET    /api/categories/tree  — árvore hierárquica
 *   POST   /api/categories       — criar
 *   PUT    /api/categories/:id   — editar
 *   DELETE /api/categories/:id   — remover
 */
import { useState, useEffect, useCallback } from 'react'
import { api } from '../services/api'
import {
  Card,
  Badge,
  Button,
  Input,
  Select,
  Alert,
  Spinner,
  SectionTitle,
  EmptyState,
} from '../components/ui'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Category {
  id: string
  name: string
  slug: string
  type: 'expense' | 'income'
  parentId: string | null
  isSystem: boolean
  sortOrder: number
  children?: Category[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function typeLabel(type: string) {
  return type === 'expense' ? 'Despesa' : 'Receita'
}
function typeVariant(type: string): 'red' | 'green' {
  return type === 'expense' ? 'red' : 'green'
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function CategoryRow({
  cat,
  onEdit,
  onDelete,
  onAddSub,
}: {
  cat: Category
  onEdit: (c: Category) => void
  onDelete: (c: Category) => void
  onAddSub: (parent: Category) => void
}) {
  const hasChildren = cat.children && cat.children.length > 0
  const [open, setOpen] = useState(hasChildren)

  // Keep parent expanded whenever it gains children after reload/create.
  useEffect(() => {
    if (hasChildren) {
      setOpen(true)
    }
  }, [hasChildren])

  return (
    <div>
      {/* Parent row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0.55rem 0.75rem',
          borderBottom: '1px solid #1e2130',
          gap: '0.5rem',
        }}
      >
        {/* Expand toggle */}
        <button
          onClick={() => setOpen((p) => !p)}
          style={{
            background: 'none',
            border: 'none',
            color: hasChildren ? '#6366f1' : '#2a2f45',
            cursor: hasChildren ? 'pointer' : 'default',
            fontSize: '0.85rem',
            width: 20,
            flexShrink: 0,
          }}
        >
          {hasChildren ? (open ? '▾' : '▸') : '·'}
        </button>

        <span style={{ flex: 1, fontSize: '0.88rem', color: '#e5e7eb', fontWeight: 600 }}>
          {cat.name}
        </span>

        <Badge variant={typeVariant(cat.type)}>{typeLabel(cat.type)}</Badge>

        {cat.isSystem && (
          <Badge variant="gray">sistema</Badge>
        )}

        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => onAddSub(cat)}
            title="Adicionar subcategoria"
            style={{ background: 'none', border: '1px solid #2a2f45', borderRadius: 6, color: '#6366f1', cursor: 'pointer', padding: '2px 7px', fontSize: '0.78rem' }}
          >
            + sub
          </button>
          <button
            onClick={() => onEdit(cat)}
            title="Editar"
            style={{ background: 'none', border: '1px solid #2a2f45', borderRadius: 6, color: '#9ca3af', cursor: 'pointer', padding: '2px 7px', fontSize: '0.78rem' }}
          >
            ✎
          </button>
          {!cat.isSystem && (
            <button
              onClick={() => onDelete(cat)}
              title="Remover"
              style={{ background: 'none', border: '1px solid #2a2f45', borderRadius: 6, color: '#f87171', cursor: 'pointer', padding: '2px 7px', fontSize: '0.78rem' }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Children */}
      {open && hasChildren && (
        <div style={{ paddingLeft: '1.5rem', borderLeft: '2px solid #1e2130', marginLeft: '1.25rem' }}>
          {cat.children!.map((child) => (
            <div
              key={child.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '0.45rem 0.75rem',
                borderBottom: '1px solid #1a1e2e',
                gap: '0.5rem',
              }}
            >
              <span style={{ width: 20, flexShrink: 0, color: '#2a2f45', fontSize: '0.8rem' }}>└</span>
              <span style={{ flex: 1, fontSize: '0.85rem', color: '#d1d5db' }}>{child.name}</span>
              <Badge variant={typeVariant(child.type)}>{typeLabel(child.type)}</Badge>
              {child.isSystem && <Badge variant="gray">sistema</Badge>}
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={() => onEdit(child)}
                  style={{ background: 'none', border: '1px solid #2a2f45', borderRadius: 6, color: '#9ca3af', cursor: 'pointer', padding: '2px 7px', fontSize: '0.78rem' }}
                >
                  ✎
                </button>
                {!child.isSystem && (
                  <button
                    onClick={() => onDelete(child)}
                    style={{ background: 'none', border: '1px solid #2a2f45', borderRadius: 6, color: '#f87171', cursor: 'pointer', padding: '2px 7px', fontSize: '0.78rem' }}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Modal de criação / edição
// ---------------------------------------------------------------------------
function CategoryModal({
  mode,
  initial,
  parentId,
  parentName,
  flatList,
  onSave,
  onClose,
}: {
  mode: 'create' | 'edit'
  initial?: Category
  parentId?: string
  parentName?: string
  flatList: Category[]
  onSave: (data: { name: string; type: 'expense' | 'income'; parentId: string | null; sortOrder: number }) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<'expense' | 'income'>(initial?.type ?? 'expense')
  const [parent, setParent] = useState<string>(initial?.parentId ?? parentId ?? '')
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 50))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!name.trim()) { setError('Nome obrigatório'); return }
    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        type,
        parentId: parent || null,
        sortOrder: parseInt(sortOrder) || 50,
      })
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  // Roots only for parent selector (prevent deep nesting)
  const roots = flatList.filter((c) => c.parentId === null)

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 12, padding: '1.5rem', width: 400, maxWidth: '95vw' }}>
        <h3 style={{ color: '#e5e7eb', fontWeight: 700, marginBottom: '1rem', fontSize: '1rem' }}>
          {mode === 'create' ? (parentName ? `Nova subcategoria de "${parentName}"` : 'Nova categoria') : `Editar "${initial?.name}"`}
        </h3>

        {error && <Alert variant="error" style={{ marginBottom: '0.75rem' }}>{error}</Alert>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Combustível" />

          <Select label="Tipo" value={type} onChange={(e) => setType(e.target.value as 'expense' | 'income')}>
            <option value="expense">Despesa</option>
            <option value="income">Receita</option>
          </Select>

          {!parentId && (
            <Select label="Categoria pai (opcional)" value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">— Nenhuma (categoria raiz) —</option>
              {roots.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </Select>
          )}

          <Input
            label="Ordem de exibição"
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
          <Button onClick={onClose} variant="secondary" fullWidth>Cancelar</Button>
          <Button onClick={handleSave} fullWidth disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export function Categories() {
  const [tree, setTree] = useState<Category[]>([])
  const [flat, setFlat] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | 'expense' | 'income'>('all')
  const [search, setSearch] = useState('')

  // Modal state
  const [modal, setModal] = useState<{
    mode: 'create' | 'edit'
    initial?: Category
    parentId?: string
    parentName?: string
  } | null>(null)

  const [deleteConfirm, setDeleteConfirm] = useState<Category | null>(null)
  const [deleteError, setDeleteError] = useState('')

  const loadCategories = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [treeData, flatData] = await Promise.all([
        api.categories.tree(),
        api.categories.list(),
      ])
      setTree(treeData as Category[])
      setFlat(flatData as Category[])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar categorias')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadCategories() }, [loadCategories])

  // Filtered tree
  const filteredTree = tree.filter((cat) => {
    const matchType = filter === 'all' || cat.type === filter
    const matchSearch = !search || cat.name.toLowerCase().includes(search.toLowerCase()) ||
      cat.children?.some((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    return matchType && matchSearch
  })

  // Handlers
  async function handleSave(data: { name: string; type: 'expense' | 'income'; parentId: string | null; sortOrder: number }) {
    if (modal?.mode === 'edit' && modal.initial) {
      await api.categories.update(modal.initial.id, data)
    } else {
      await api.categories.create(data)
    }
    await loadCategories()
  }

  async function handleDelete(cat: Category) {
    setDeleteError('')
    try {
      await api.categories.remove(cat.id)
      setDeleteConfirm(null)
      await loadCategories()
    } catch (e: unknown) {
      setDeleteError(e instanceof Error ? e.message : 'Erro ao remover')
    }
  }

  return (
    <div style={{ maxWidth: 860 }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#e5e7eb', margin: 0 }}>
            🏷️ Categorias
          </h1>
          <p style={{ color: '#6b7280', marginTop: '0.3rem', fontSize: '0.85rem' }}>
            Gerencie categorias e subcategorias financeiras.
          </p>
        </div>
        <Button onClick={() => setModal({ mode: 'create' })}>+ Nova categoria</Button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', alignItems: 'center' }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar..."
          style={{
            background: '#141624', border: '1px solid #2a2f45', borderRadius: 8,
            padding: '0.5rem 0.75rem', color: '#e5e7eb', fontSize: '0.85rem', flex: 1,
          }}
        />
        {(['all', 'expense', 'income'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              background: filter === f ? '#6366f1' : '#141624',
              border: '1px solid #2a2f45',
              borderRadius: 8,
              padding: '0.45rem 0.9rem',
              color: filter === f ? '#fff' : '#9ca3af',
              cursor: 'pointer',
              fontSize: '0.82rem',
              fontWeight: filter === f ? 700 : 400,
            }}
          >
            {f === 'all' ? 'Todas' : f === 'expense' ? 'Despesas' : 'Receitas'}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
          <Spinner size={36} />
        </div>
      )}

      {error && <Alert variant="error">{error}</Alert>}

      {!loading && !error && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {filteredTree.length === 0 ? (
            <EmptyState icon="🏷️" title="Nenhuma categoria encontrada" description="Ajuste o filtro ou crie uma nova categoria." />
          ) : (
            filteredTree.map((cat) => (
              <CategoryRow
                key={cat.id}
                cat={cat}
                onEdit={(c) => setModal({ mode: 'edit', initial: c })}
                onDelete={(c) => { setDeleteConfirm(c); setDeleteError('') }}
                onAddSub={(parent) => setModal({ mode: 'create', parentId: parent.id, parentName: parent.name })}
              />
            ))
          )}
        </Card>
      )}

      {/* Stats */}
      {!loading && flat.length > 0 && (
        <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
          {[
            { label: 'Total', value: flat.length, variant: 'gray' as const },
            { label: 'Despesa', value: flat.filter((c) => c.type === 'expense').length, variant: 'red' as const },
            { label: 'Receita', value: flat.filter((c) => c.type === 'income').length, variant: 'green' as const },
            { label: 'Sistema', value: flat.filter((c) => c.isSystem).length, variant: 'blue' as const },
            { label: 'Personalizadas', value: flat.filter((c) => !c.isSystem).length, variant: 'yellow' as const },
          ].map(({ label, value, variant }) => (
            <div key={label} style={{ textAlign: 'center', flex: 1 }}>
              <p style={{ fontSize: '0.72rem', color: '#6b7280', marginBottom: 2 }}>{label}</p>
              <Badge variant={variant}>{value}</Badge>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <CategoryModal
          mode={modal.mode}
          initial={modal.initial}
          parentId={modal.parentId}
          parentName={modal.parentName}
          flatList={flat}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
          }}
        >
          <div style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 12, padding: '1.5rem', width: 380 }}>
            <h3 style={{ color: '#e5e7eb', fontWeight: 700, marginBottom: '0.75rem', fontSize: '1rem' }}>
              Remover categoria?
            </h3>
            <p style={{ color: '#9ca3af', fontSize: '0.85rem', marginBottom: '1rem' }}>
              Tem certeza que deseja remover <strong style={{ color: '#e5e7eb' }}>{deleteConfirm.name}</strong>? Esta acção não pode ser desfeita.
            </p>
            {deleteError && <Alert variant="error" style={{ marginBottom: '0.75rem' }}>{deleteError}</Alert>}
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <Button onClick={() => setDeleteConfirm(null)} variant="secondary" fullWidth>Cancelar</Button>
              <Button onClick={() => handleDelete(deleteConfirm)} fullWidth style={{ background: '#dc2626' }}>
                Remover
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

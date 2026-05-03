/**
 * SpendingAssessor.tsx — Avaliador de Gastos por Categoria
 * API: POST /api/assess/spending
 * Pre-seleccao: /assess/spending?categoryId=xxx
 */
import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  api, formatBRL, currentMonth,
  type SpendingAssessResult, type SpendingOverviewResult, type CategoryTreeNode,
} from '../services/api'
import { Card, Badge, Button, Alert, Spinner, SectionTitle } from '../components/ui'

function riskVariant(level?: string): 'green' | 'yellow' | 'red' | 'gray' {
  if (level === 'baixo') return 'green'
  if (level === 'moderado') return 'yellow'
  if (level === 'alto' || level === 'critico') return 'red'
  return 'gray'
}

function trendIcon(trend?: string): string {
  if (trend === 'crescente') return '📈'
  if (trend === 'decrescente') return '📉'
  return '➡️'
}

function buildMonthOptions(): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = []
  const now = new Date()
  for (let i = 0; i < 6; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const val = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0')
    const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    opts.push({ value: val, label: label.charAt(0).toUpperCase() + label.slice(1) })
  }
  return opts
}

function findNodeById(nodes: CategoryTreeNode[], id: string): CategoryTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findNodeById(node.children ?? [], id)
    if (found) return found
  }
  return null
}

function findRootNodeById(nodes: CategoryTreeNode[], id: string): CategoryTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findNodeById(node.children ?? [], id)
    if (found) return node
  }
  return null
}

function sourceLabel(source?: 'statement' | 'card_invoice'): string {
  if (source === 'statement') return 'Extrato'
  if (source === 'card_invoice') return 'Fatura'
  return 'Lançamento'
}

function colorForIndex(index: number): string {
  const palette = ['#6366f1', '#8b5cf6', '#06b6d4', '#14b8a6', '#f59e0b', '#f97316', '#ec4899', '#22c55e']
  return palette[index % palette.length]
}

function buildDonutBackground(
  slices: Array<{ amountMinor: number; color: string }>,
  fallbackColor = '#1e2130',
): string {
  const totalMinor = slices.reduce((sum, slice) => sum + Math.max(0, slice.amountMinor), 0)
  if (totalMinor <= 0) return `conic-gradient(${fallbackColor} 0 100%)`

  let cursor = 0
  const parts = slices.map((slice) => {
    const pct = (Math.max(0, slice.amountMinor) / totalMinor) * 100
    const start = cursor
    cursor += pct
    return `${slice.color} ${start.toFixed(4)}% ${cursor.toFixed(4)}%`
  })
  return `conic-gradient(${parts.join(', ')})`
}

export function SpendingAssessor() {
  const [searchParams] = useSearchParams()
  const preselectedId = searchParams.get('categoryId') ?? ''

  const [categories, setCategories] = useState<CategoryTreeNode[]>([])
  const [selectedCategory, setSelectedCategory] = useState(preselectedId)
  const [selectedSubcategoryIds, setSelectedSubcategoryIds] = useState<string[]>([])
  const [selectedMonth, setSelectedMonth] = useState(currentMonth())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SpendingAssessResult | null>(null)
  const [overviewResult, setOverviewResult] = useState<SpendingOverviewResult | null>(null)

  useEffect(() => {
    api.categories.tree()
      .then((tree) => setCategories(tree.filter((c) => c.type === 'expense')))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (preselectedId) {
      const rootNode = findRootNodeById(categories, preselectedId)
      setSelectedCategory(rootNode?.id ?? preselectedId)
    }
  }, [categories, preselectedId])

  useEffect(() => {
    let cancelled = false
    setError(null)
    api.assess.spendingOverview(selectedMonth)
      .then((data) => {
        if (!cancelled) setOverviewResult(data)
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Erro ao carregar o resumo do mês')
        }
      })
    return () => { cancelled = true }
  }, [selectedMonth])

  const categoryOptions = useMemo(
    () => categories.filter((c) => c.type === 'expense' && !c.parentId),
    [categories],
  )
  const selectedCategoryNode = useMemo(
    () => (selectedCategory ? findNodeById(categories, selectedCategory) : null),
    [categories, selectedCategory],
  )
  const selectableSubcategories = useMemo(
    () => (selectedCategoryNode ? (selectedCategoryNode.children ?? []).filter((node) => node.type === 'expense') : []),
    [selectedCategoryNode],
  )

  useEffect(() => {
    if (!selectedCategoryNode) {
      setSelectedSubcategoryIds([])
      setResult(null)
      return
    }
    setSelectedSubcategoryIds(selectableSubcategories.map((node) => node.id))
  }, [selectedCategoryNode, selectableSubcategories])

  const selectedSubcategorySet = useMemo(() => new Set(selectedSubcategoryIds), [selectedSubcategoryIds])
  const previewSubcategoryIds = useMemo(() => {
    if (!selectedCategoryNode) return []
    if (selectedSubcategoryIds.length === 0) return []
    const selectableIds = new Set(selectableSubcategories.map((node) => node.id))
    const validSelectedIds = selectedSubcategoryIds.filter((id) => selectableIds.has(id))
    return validSelectedIds.length > 0
      ? validSelectedIds
      : selectableSubcategories.map((node) => node.id)
  }, [selectedCategoryNode, selectedSubcategoryIds, selectableSubcategories])

  useEffect(() => {
    if (!selectedCategoryNode) return
    let cancelled = false
    setError(null)
    api.assess.spendingPreview(selectedMonth, selectedCategoryNode.id, previewSubcategoryIds)
      .then((data) => {
        if (!cancelled) setResult(data)
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Erro ao carregar a análise da categoria')
        }
      })
    return () => { cancelled = true }
  }, [selectedCategoryNode, selectedMonth, previewSubcategoryIds])

  async function runAnalyze(catId?: string) {
    const cat = catId ?? selectedCategory
    if (!cat) return
    setLoading(true); setError(null)
    try {
      setResult(await api.assess.spending(selectedMonth, cat, previewSubcategoryIds))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao avaliar gastos')
    } finally { setLoading(false) }
  }

  const ai = result?.ai
  const overviewCategoryBreakdown = overviewResult?.categoryBreakdown ?? []
  const overviewDisplayItems = useMemo(() => overviewCategoryBreakdown.map((item, index) => ({
    ...item,
    color: colorForIndex(index),
  })), [overviewCategoryBreakdown])
  const overviewTotalMinor = overviewDisplayItems.reduce((sum, item) => sum + item.amountMinor, 0)
  const overviewDonutBackground = buildDonutBackground(
    overviewDisplayItems.map((item) => ({ amountMinor: item.amountMinor, color: item.color })),
  )
  const subcategoryTotals = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of result?.subcategoryBreakdown ?? []) {
      map.set(item.categoryId, item.amountMinor)
    }
    return map
  }, [result?.subcategoryBreakdown])
  const subcategoryPercentages = useMemo(() => {
    const map = new Map<string, { pctWithinCategory: number; pctOfTotal: number }>()
    for (const item of result?.subcategoryBreakdown ?? []) {
      map.set(item.categoryId, {
        pctWithinCategory: item.pctWithinCategory,
        pctOfTotal: item.pctOfTotal,
      })
    }
    return map
  }, [result?.subcategoryBreakdown])
  const subcategoryDisplayItems = useMemo(() => selectableSubcategories.map((node, index) => {
    const amountMinor = subcategoryTotals.get(node.id) ?? 0
    const checked = selectedSubcategorySet.has(node.id)
    const pct = subcategoryPercentages.get(node.id)
    return {
      node,
      index,
      amountMinor,
      checked,
      color: colorForIndex(index),
      pctWithinCategory: pct?.pctWithinCategory ?? 0,
      pctOfTotal: pct?.pctOfTotal ?? 0,
    }
  }), [selectableSubcategories, subcategoryTotals, subcategoryPercentages, selectedSubcategorySet])
  const subcategoryTotalMinor = subcategoryDisplayItems.reduce((sum, item) => sum + item.amountMinor, 0)
  const selectedSubcategoryMinor = subcategoryDisplayItems
    .filter((item) => item.checked)
    .reduce((sum, item) => sum + item.amountMinor, 0)
  const subcategoryDonutBackground = buildDonutBackground(
    subcategoryDisplayItems.map((item) => ({
      amountMinor: item.amountMinor,
      color: item.checked ? item.color : '#334155',
    })),
  )
  const chartData = result?.monthlySummary.map(m => ({
    month: m.month,
    total: Math.round(m.totalMinor / 100),
    statement: Math.round((m.statementMinor ?? 0) / 100),
    invoice: Math.round((m.invoiceMinor ?? 0) / 100),
  })) ?? []
  const impactPct = result?.impactOnIncomePct ?? 0
  const impactColor = impactPct >= 30 ? '#f87171' : impactPct >= 15 ? '#fbbf24' : '#4ade80'
  const sourceSummary = result?.sourceSummary

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <SectionTitle>Avaliador de Gastos</SectionTitle>
      <p style={{ color: '#9ca3af', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        Analise o gasto de uma categoria a partir do extrato e das faturas do cartão: histórico, tendência, impacto na renda e recomendações da IA.
      </p>

      <Card style={{ marginBottom: '1.5rem', paddingTop: '1.25rem', paddingBottom: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <div>
            <div style={{ fontSize: '0.85rem', color: '#9ca3af', fontWeight: 600 }}>Disco superior: categorias raiz no mês</div>
            <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 4 }}>
              Aparece automaticamente ao abrir a tela e distribui o total do mês apenas entre categorias raiz.
            </div>
          </div>
          <div style={{ color: '#6b7280', fontSize: '0.82rem', alignSelf: 'center' }}>
            Total do mês: {formatBRL(overviewTotalMinor)}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'stretch' }}>
          <div style={{ flex: '1 1 320px', minWidth: 280 }}>
            <div
              style={{
                position: 'relative',
                width: '100%',
                maxWidth: 420,
                margin: '0 auto',
                aspectRatio: '1 / 1',
                borderRadius: '50%',
                background: '#0f1320',
                border: '1px solid #2a2f45',
                boxShadow: '0 0 0 1px rgba(99, 102, 241, 0.08) inset',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: '10%',
                  borderRadius: '50%',
                  background: overviewDonutBackground,
                  opacity: 1,
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: '22%',
                  borderRadius: '50%',
                  background: '#141624',
                  border: '1px solid #2a2f45',
                  boxShadow: '0 0 0 10px rgba(99, 102, 241, 0.04) inset',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  padding: '1rem',
                }}
              >
                <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Total categorizado</div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: '#e5e7eb', marginTop: 4 }}>
                  {overviewDisplayItems.length} categorias
                </div>
                <div style={{ fontSize: '0.85rem', color: '#cbd5e1', marginTop: 8 }}>
                  {formatBRL(overviewTotalMinor)}
                </div>
              </div>
            </div>
          </div>

          <div style={{ flex: '1 1 340px', minWidth: 280 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {overviewDisplayItems.map((item) => {
                const pctOfTotal = overviewTotalMinor > 0 ? (item.amountMinor / overviewTotalMinor) * 100 : 0
                return (
                  <div
                    key={item.categoryId}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '1rem',
                      alignItems: 'center',
                      padding: '0.8rem 0.9rem',
                      borderRadius: 14,
                      border: `1px solid ${item.color}`,
                      background: 'rgba(20, 22, 36, 0.85)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: '50%',
                          background: item.color,
                          flexShrink: 0,
                        }}
                      />
                      <div>
                        <div style={{ fontSize: '0.88rem', fontWeight: 700 }}>{item.label}</div>
                        <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
                          {pctOfTotal.toFixed(1)}% do total do mês
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.88rem', fontWeight: 700, color: item.color }}>
                        {formatBRL(item.amountMinor)}
                      </div>
                      <div style={{ fontSize: '0.76rem', color: '#94a3b8' }}>
                        {pctOfTotal.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </Card>

      <Card style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 2, minWidth: 200 }}>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#9ca3af', marginBottom: 4 }}>Categoria</label>
            <select
              value={selectedCategory}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                const nextCategory = e.target.value
                const nextNode = findRootNodeById(categories, nextCategory)
                setSelectedCategory(nextNode?.id ?? nextCategory)
                setSelectedSubcategoryIds(nextNode ? (nextNode.children ?? []).filter((node) => node.type === 'expense').map((node) => node.id) : [])
              }}
              style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.55rem 0.85rem', color: '#e5e7eb', fontSize: '0.9rem', width: '100%' }}
            >
              <option value="">Selecione uma categoria...</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#9ca3af', marginBottom: 4 }}>Mes</label>
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.55rem 0.85rem', color: '#e5e7eb', fontSize: '0.9rem', width: '100%' }}
            >
              {buildMonthOptions().map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <Button onClick={() => runAnalyze()} disabled={loading || !selectedCategory} variant="primary">
            {loading ? 'Analisando...' : '🤖 Avaliar'}
          </Button>
        </div>
      </Card>

      {selectedCategoryNode && selectableSubcategories.length > 1 && (
        <Card style={{ marginBottom: '1.5rem', paddingTop: '1.25rem', paddingBottom: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <div>
              <div style={{ fontSize: '0.85rem', color: '#9ca3af', fontWeight: 600 }}>Disco inferior: subcategorias da categoria raiz</div>
              <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 4 }}>
                Começa com todas marcadas. Desmarque as que não devem entrar na análise da IA.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button
                variant="secondary"
                onClick={() => setSelectedSubcategoryIds(selectableSubcategories.map((node) => node.id))}
              >
                Marcar todas
              </Button>
              <Button
                variant="secondary"
                onClick={() => setSelectedSubcategoryIds([])}
              >
                Limpar
              </Button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'stretch' }}>
            <div style={{ flex: '1 1 320px', minWidth: 280 }}>
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  maxWidth: 420,
                  margin: '0 auto',
                  aspectRatio: '1 / 1',
                  borderRadius: '50%',
                  background: '#0f1320',
                  border: '1px solid #2a2f45',
                  boxShadow: '0 0 0 1px rgba(99, 102, 241, 0.08) inset',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    inset: '10%',
                    borderRadius: '50%',
                    background: subcategoryDonutBackground,
                    opacity: 1,
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    inset: '22%',
                    borderRadius: '50%',
                    background: '#141624',
                    border: '1px solid #2a2f45',
                    boxShadow: '0 0 0 10px rgba(99, 102, 241, 0.04) inset',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center',
                    padding: '1rem',
                  }}
                >
                    <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Categoria selecionada</div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: '#e5e7eb', marginTop: 4 }}>
                      {selectedCategoryNode.name}
                    </div>
                  <div style={{ fontSize: '0.85rem', color: '#cbd5e1', marginTop: 8 }}>
                    {selectedSubcategoryIds.length} de {selectableSubcategories.length} subcategorias
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#93c5fd', marginTop: 8, fontWeight: 700 }}>
                    {formatBRL(selectedSubcategoryMinor)} selecionados
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 6, lineHeight: 1.5 }}>
                    {selectedSubcategoryIds.length > 0 && subcategoryTotalMinor > 0
                      ? `${((selectedSubcategoryMinor / subcategoryTotalMinor) * 100).toFixed(1)}% da categoria filtrada`
                      : 'O gasto da categoria é recalculado conforme os itens marcados.'}
                  </div>
                </div>
              </div>
            </div>

            <div style={{ flex: '1 1 340px', minWidth: 280 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {subcategoryDisplayItems.map((item) => {
                  const pctInCategory = item.pctWithinCategory > 0
                    ? item.pctWithinCategory
                    : item.checked && selectedSubcategoryMinor > 0
                      ? (item.amountMinor / selectedSubcategoryMinor) * 100
                      : 0
                  const pctOfTotal = item.pctOfTotal > 0
                    ? item.pctOfTotal
                    : overviewTotalMinor > 0
                      ? (item.amountMinor / overviewTotalMinor) * 100
                      : 0
                  return (
                    <button
                      key={item.node.id}
                      type="button"
                      onClick={() => setSelectedSubcategoryIds((prev) => (
                        prev.includes(item.node.id)
                          ? prev.filter((id) => id !== item.node.id)
                          : [...prev, item.node.id]
                      ))}
                      style={{
                        appearance: 'none',
                        border: `1px solid ${item.checked ? item.color : '#2a2f45'}`,
                        background: item.checked ? 'rgba(99, 102, 241, 0.10)' : 'rgba(20, 22, 36, 0.85)',
                        color: item.checked ? '#e0e7ff' : '#94a3b8',
                        borderRadius: 14,
                        padding: '0.8rem 0.9rem',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span
                            style={{
                              width: 14,
                              height: 14,
                              borderRadius: '50%',
                              background: item.checked ? item.color : 'transparent',
                              border: `2px solid ${item.checked ? item.color : '#475569'}`,
                              flexShrink: 0,
                            }}
                          />
                          <div>
                            <div style={{ fontSize: '0.88rem', fontWeight: 700 }}>{item.node.name}</div>
                            <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
                              {item.checked ? 'Ativa na análise' : 'Desligada'}
                            </div>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '0.88rem', fontWeight: 700, color: item.checked ? item.color : '#64748b' }}>
                            {formatBRL(item.amountMinor)}
                          </div>
                          <div style={{ fontSize: '0.76rem', color: '#94a3b8' }}>
                            {`${pctInCategory.toFixed(1)}% cat · ${pctOfTotal.toFixed(1)}% total`}
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </Card>
      )}

      {selectedCategoryNode && selectableSubcategories.length <= 1 && (
        <Card style={{ marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '0.85rem', color: '#9ca3af', fontWeight: 600, marginBottom: 4 }}>Subcategorias</div>
          <div style={{ color: '#cbd5e1', fontSize: '0.9rem' }}>
            Esta categoria tem apenas uma subcategoria ou nenhuma. A análise será feita sem um segundo disco.
          </div>
        </Card>
      )}

      {error && <Alert variant="error" style={{ marginBottom: '1rem' }}>{error}</Alert>}
      {loading && (
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <Spinner />
          <p style={{ color: '#9ca3af', marginTop: '1rem' }}>Analisando historico de gastos...</p>
        </div>
      )}

      {result && !loading && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
            {[
              { label: 'Gasto no mes', value: formatBRL(result.currentMonthMinor), color: '#e5e7eb' },
              { label: 'Media historica', value: formatBRL(result.averageHistoricalMinor), color: '#9ca3af' },
              { label: 'Variacao', value: (result.variationPct > 0 ? '+' : '') + result.variationPct.toFixed(1) + '%', color: result.variationPct > 20 ? '#f87171' : result.variationPct < -10 ? '#4ade80' : '#fbbf24' },
              { label: 'Impacto renda', value: impactPct.toFixed(1) + '%', color: impactColor },
            ].map(m => (
              <Card key={m.label}>
                <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: 4 }}>{m.label}</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: m.color }}>{m.value}</div>
              </Card>
            ))}
          </div>

          {sourceSummary && (
            <Card style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: 4 }}>Fontes consideradas</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Badge variant="green">Extrato {formatBRL(sourceSummary.statementMinor)}</Badge>
                    <Badge variant="yellow">Fatura {formatBRL(sourceSummary.invoiceMinor)}</Badge>
                  </div>
                </div>
                <div style={{ color: '#6b7280', fontSize: '0.82rem', alignSelf: 'center' }}>
                  Total combinado no mês: {formatBRL(sourceSummary.statementMinor + sourceSummary.invoiceMinor)}
                </div>
              </div>
            </Card>
          )}

          <Card style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: '0.85rem', color: '#9ca3af' }}>Impacto na renda</span>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: impactColor }}>{impactPct.toFixed(1)}%</span>
            </div>
            <div style={{ background: '#1e2130', borderRadius: 4, height: 10 }}>
              <div style={{ background: impactColor, borderRadius: 4, height: 10, width: Math.min(100, impactPct) + '%' }} />
            </div>
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
            <Card>
              <div style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: 8 }}>Tendencia</div>
              <div style={{ fontSize: '1.8rem', marginBottom: 4 }}>{trendIcon(ai?.trend)}</div>
              <div style={{ fontSize: '0.9rem', color: '#e5e7eb', fontWeight: 600 }}>{ai?.trend ?? '—'}</div>
              {ai?.trendDescription && <p style={{ fontSize: '0.82rem', color: '#9ca3af', marginTop: 6, lineHeight: 1.5 }}>{ai.trendDescription}</p>}
            </Card>
            <Card>
              <div style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: 8 }}>Comparacao historica</div>
              {ai?.historicalComparison && <p style={{ fontSize: '0.88rem', color: '#e5e7eb', lineHeight: 1.6, margin: 0 }}>{ai.historicalComparison}</p>}
              <div style={{ marginTop: 8 }}><Badge variant={riskVariant(ai?.riskLevel)}>Risco {ai?.riskLevel ?? '—'}</Badge></div>
            </Card>
          </div>

          {chartData.length > 0 && (
            <Card style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.85rem', color: '#9ca3af', marginBottom: '1rem' }}>Historico mensal (R$)</div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2130" />
                  <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={v => 'R$' + v} />
                  <Tooltip
                    contentStyle={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8 }}
                    formatter={(value: unknown, name) => [
                      formatBRL((value as number) * 100),
                      name === 'statement' ? 'Extrato' : name === 'invoice' ? 'Fatura' : 'Total',
                    ]}
                  />
                  <Line type="monotone" dataKey="total" stroke="#6366f1" strokeWidth={2} dot={{ fill: '#6366f1', r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          )}

          {ai?.diagnosis && (
            <Card style={{ marginBottom: '1.5rem', borderLeft: '3px solid #6366f1' }}>
              <div style={{ fontSize: '0.8rem', color: '#6366f1', marginBottom: 6, fontWeight: 600 }}>🤖 Diagnostico</div>
              <p style={{ color: '#e5e7eb', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }}>{ai.diagnosis}</p>
            </Card>
          )}

          {result.topTransactions.length > 0 && (
            <Card style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.85rem', color: '#9ca3af', marginBottom: '0.75rem', fontWeight: 600 }}>Maiores gastos do mes</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {result.topTransactions.slice(0, 5).map((t, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid #1e2130' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', color: '#d1d5db' }}>
                      <span>{t.description ?? '—'}</span>
                      {t.source && <Badge variant={t.source === 'statement' ? 'green' : 'yellow'}>{sourceLabel(t.source)}</Badge>}
                    </span>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f87171' }}>{formatBRL(t.amountMinor)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {ai?.alerts && ai.alerts.length > 0 && (
            <Card style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.85rem', color: '#fbbf24', marginBottom: '0.75rem', fontWeight: 600 }}>⚠️ Alertas</div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {ai.alerts.map((a, i) => (
                  <li key={i} style={{ display: 'flex', gap: 8, fontSize: '0.88rem', color: '#e5e7eb' }}>
                    <span style={{ color: '#fbbf24' }}>•</span>{a}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {ai?.recommendations && ai.recommendations.length > 0 && (
            <Card>
              <div style={{ fontSize: '0.85rem', color: '#4ade80', marginBottom: '0.75rem', fontWeight: 600 }}>💡 Recomendacoes</div>
              <ol style={{ margin: 0, padding: '0 0 0 1.2rem', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {ai.recommendations.map((r, i) => (
                  <li key={i} style={{ fontSize: '0.88rem', color: '#e5e7eb', lineHeight: 1.5 }}>{r}</li>
                ))}
              </ol>
            </Card>
          )}
        </>
      )}

      {!result && !loading && (
        <Card style={{ textAlign: 'center', padding: '3rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>📊</div>
          <p style={{ color: '#9ca3af' }}>
            Selecione uma categoria, ajuste as subcategorias e clique em{' '}
            <strong style={{ color: '#6366f1' }}>Avaliar</strong>.
          </p>
        </Card>
      )}
    </div>
  )
}

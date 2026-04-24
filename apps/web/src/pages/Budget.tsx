/**
 * Budget.tsx — Tela de Análise de Orçamento
 *
 * Contratos de API:
 *   POST /api/budget/analyze-transaction  — impacto de uma transacção
 *   POST /api/budget/analysis             — visão geral do orçamento
 *   GET  /api/categories                  — lista de categorias
 *
 * Todos os contratos mapeados directamente de apps/api/src/routes/budget.ts
 * e apps/api/src/routes/categories.ts.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import {
  api,
  formatBRL,
  currentMonth,
  type Category,
  type BudgetItem,
  type SpendingItem,
  type TransactionAnalysisResponse,
  type BudgetAnalysisResponse,
} from '../services/api'
import { useAsync } from '../hooks/useAsync'
import {
  Card,
  Badge,
  Button,
  Input,
  Select,
  Alert,
  EmptyState,
  Spinner,
  SectionTitle,
} from '../components/ui'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function minor(brl: string): number {
  const n = parseFloat(brl.replace(',', '.'))
  return isNaN(n) ? 0 : Math.round(n * 100)
}

function utilizationColor(pct: number): string {
  if (pct >= 100) return '#f87171'
  if (pct >= 80) return '#fbbf24'
  return '#4ade80'
}

function statusVariant(status: string): 'green' | 'yellow' | 'red' | 'gray' {
  if (status === 'seguro' || status === 'ok') return 'green'
  if (status === 'atenção' || status === 'alerta') return 'yellow'
  if (status === 'excedido' || status === 'crítico') return 'red'
  return 'gray'
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export function Budget() {
  const now = currentMonth()

  // Categories
  const [categories, setCategories] = useState<Category[]>([])
  useEffect(() => {
    api.categories.list().then(setCategories).catch(() => {})
  }, [])

  // --- Transaction analysis form ---
  const [txAmount, setTxAmount] = useState('')
  const [txCategory, setTxCategory] = useState('')
  const [txDesc, setTxDesc] = useState('')
  const [txMerchant, setTxMerchant] = useState('')
  const [txMonth, setTxMonth] = useState(now)

  // Budget items for the transaction analysis
  const [budgets, setBudgets] = useState<BudgetItem[]>([])
  const [spending, setSpending] = useState<SpendingItem[]>([])
  const [budgetAmount, setBudgetAmount] = useState('')
  const [spentAmount, setSpentAmount] = useState('')

  const [txErrors, setTxErrors] = useState<Record<string, string>>({})

  const analyzeFn = useCallback(
    (body: Parameters<typeof api.budget.analyzeTransaction>[0]) =>
      api.budget.analyzeTransaction(body),
    [],
  )
  const { state: txState, execute: executeTx } = useAsync<
    Parameters<typeof api.budget.analyzeTransaction>[0],
    TransactionAnalysisResponse
  >(analyzeFn)

  // --- Budget overview form ---
  const [overviewMonth, setOverviewMonth] = useState(now)
  const [overviewBudgets, setOverviewBudgets] = useState<BudgetItem[]>([])
  const [overviewSpending, setOverviewSpending] = useState<SpendingItem[]>([])
  const [obCat, setObCat] = useState('')
  const [obBudget, setObBudget] = useState('')
  const [obSpent, setObSpent] = useState('')

  const overviewFn = useCallback(
    (body: Parameters<typeof api.budget.analysis>[0]) =>
      api.budget.analysis(body),
    [],
  )
  const { state: ovState, execute: executeOverview } = useAsync<
    Parameters<typeof api.budget.analysis>[0],
    BudgetAnalysisResponse
  >(overviewFn)

  // ---------------------------------------------------------------------------
  // Transaction analysis handlers
  // ---------------------------------------------------------------------------
  function addBudgetForTx() {
    if (!txCategory || !budgetAmount) return
    const cat = categories.find((c) => c.id === txCategory)
    setBudgets((p) => [
      ...p.filter((b) => b.categoryId !== txCategory),
      {
        categoryId: txCategory,
        categoryName: cat?.name ?? txCategory,
        budgetAmountMinor: minor(budgetAmount),
        period: 'monthly',
      },
    ])
    setSpending((p) => [
      ...p.filter((s) => s.categoryId !== txCategory),
      {
        categoryId: txCategory,
        categoryName: cat?.name ?? txCategory,
        currentPeriodSpentMinor: minor(spentAmount),
        transactionCount: 1,
      },
    ])
    setBudgetAmount('')
    setSpentAmount('')
  }

  function validateTx(): boolean {
    const e: Record<string, string> = {}
    if (!txAmount) e.txAmount = 'Informe o valor'
    if (!txCategory) e.txCategory = 'Seleccione a categoria'
    if (!txDesc.trim()) e.txDesc = 'Informe a descrição'
    if (budgets.length === 0) e.budgets = 'Adicione ao menos um orçamento'
    setTxErrors(e)
    return Object.keys(e).length === 0
  }

  function handleTxSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validateTx()) return
    executeTx({
      amountMinor: minor(txAmount),
      categoryId: txCategory,
      description: txDesc,
      merchantName: txMerchant || undefined,
      currentMonth: txMonth,
      budgets,
      spending,
    })
  }

  // ---------------------------------------------------------------------------
  // Budget overview handlers
  // ---------------------------------------------------------------------------
  function addOverviewItem() {
    if (!obCat || !obBudget) return
    const cat = categories.find((c) => c.id === obCat)
    setOverviewBudgets((p) => [
      ...p.filter((b) => b.categoryId !== obCat),
      { categoryId: obCat, categoryName: cat?.name ?? obCat, budgetAmountMinor: minor(obBudget), period: 'monthly' },
    ])
    setOverviewSpending((p) => [
      ...p.filter((s) => s.categoryId !== obCat),
      { categoryId: obCat, categoryName: cat?.name ?? obCat, currentPeriodSpentMinor: minor(obSpent), transactionCount: 1 },
    ])
    setObBudget('')
    setObSpent('')
  }

  function handleOverviewSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (overviewBudgets.length === 0) return
    executeOverview({ currentMonth: overviewMonth, budgets: overviewBudgets, spending: overviewSpending })
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div style={{ maxWidth: 960 }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#e5e7eb', margin: 0 }}>
          🎯 Análise de Orçamento
        </h1>
        <p style={{ color: '#6b7280', marginTop: '0.3rem', fontSize: '0.85rem' }}>
          Simule o impacto de uma transacção e visualize o estado do seu orçamento mensal.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>

        {/* ---- Left column ---- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Transaction analysis form */}
          <Card>
            <SectionTitle>Simular impacto de transacção</SectionTitle>
            <form onSubmit={handleTxSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
              <Input
                label="Valor (R$)"
                type="number"
                step="0.01"
                value={txAmount}
                onChange={(e) => setTxAmount(e.target.value)}
                placeholder="150.00"
                error={txErrors.txAmount}
              />
              <Select
                label="Categoria"
                value={txCategory}
                onChange={(e) => setTxCategory(e.target.value)}
                error={txErrors.txCategory}
              >
                <option value="">Seleccione...</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
              <Input
                label="Descrição"
                value={txDesc}
                onChange={(e) => setTxDesc(e.target.value)}
                placeholder="Compra no supermercado"
                error={txErrors.txDesc}
              />
              <Input
                label="Estabelecimento (opcional)"
                value={txMerchant}
                onChange={(e) => setTxMerchant(e.target.value)}
                placeholder="Supermercado Extra"
              />
              <Input
                label="Mês de referência"
                value={txMonth}
                onChange={(e) => setTxMonth(e.target.value)}
                placeholder="YYYY-MM"
              />

              {/* Budget for this category */}
              <div style={{ borderTop: '1px solid #1e2130', paddingTop: '0.75rem' }}>
                <p style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: '0.5rem' }}>
                  Orçamento da categoria (para cálculo de impacto)
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <Input
                    label="Orçamento (R$)"
                    type="number"
                    step="0.01"
                    value={budgetAmount}
                    onChange={(e) => setBudgetAmount(e.target.value)}
                    placeholder="500.00"
                  />
                  <Input
                    label="Já gasto (R$)"
                    type="number"
                    step="0.01"
                    value={spentAmount}
                    onChange={(e) => setSpentAmount(e.target.value)}
                    placeholder="350.00"
                  />
                </div>
                <Button onClick={addBudgetForTx} variant="secondary" fullWidth>
                  + Definir orçamento
                </Button>
                {txErrors.budgets && (
                  <span style={{ fontSize: '0.75rem', color: '#f87171' }}>{txErrors.budgets}</span>
                )}
                {budgets.map((b) => (
                  <div key={b.categoryId} style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: 4 }}>
                    {b.categoryName}: {formatBRL(b.budgetAmountMinor)} / gasto: {formatBRL(spending.find((s) => s.categoryId === b.categoryId)?.currentPeriodSpentMinor ?? 0)}
                  </div>
                ))}
              </div>

              <Button type="submit" fullWidth disabled={txState.status === 'loading'}>
                {txState.status === 'loading' ? 'Analisando...' : 'Analisar impacto'}
              </Button>
            </form>
          </Card>

          {/* Budget overview form */}
          <Card>
            <SectionTitle>Visão geral do orçamento</SectionTitle>
            <form onSubmit={handleOverviewSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
              <Input
                label="Mês"
                value={overviewMonth}
                onChange={(e) => setOverviewMonth(e.target.value)}
                placeholder="YYYY-MM"
              />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Select
                  label="Categoria"
                  value={obCat}
                  onChange={(e) => setObCat(e.target.value)}
                >
                  <option value="">Seleccione...</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Input
                  label="Orçamento (R$)"
                  type="number"
                  step="0.01"
                  value={obBudget}
                  onChange={(e) => setObBudget(e.target.value)}
                  placeholder="500.00"
                />
                <Input
                  label="Gasto (R$)"
                  type="number"
                  step="0.01"
                  value={obSpent}
                  onChange={(e) => setObSpent(e.target.value)}
                  placeholder="350.00"
                />
              </div>
              <Button onClick={addOverviewItem} variant="secondary" fullWidth>
                + Adicionar categoria
              </Button>
              {overviewBudgets.length > 0 && (
                <div style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
                  {overviewBudgets.map((b) => (
                    <div key={b.categoryId}>{b.categoryName}: {formatBRL(b.budgetAmountMinor)}</div>
                  ))}
                </div>
              )}
              <Button type="submit" fullWidth disabled={ovState.status === 'loading'}>
                {ovState.status === 'loading' ? 'Calculando...' : 'Ver visão geral'}
              </Button>
            </form>
          </Card>
        </div>

        {/* ---- Right column: Results ---- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Transaction analysis result */}
          {txState.status === 'idle' && (
            <EmptyState icon="🎯" title="Simule uma transacção" description="O impacto no orçamento aparecerá aqui." />
          )}
          {txState.status === 'loading' && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
              <Spinner size={36} />
            </div>
          )}
          {txState.status === 'error' && (
            <Alert variant="error"><strong>Erro:</strong> {txState.message}</Alert>
          )}
          {txState.status === 'success' && (
            <Card>
              <SectionTitle>Resultado da simulação</SectionTitle>

              {/* Budget impact */}
              {txState.data.budgetImpact && (
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.82rem', color: '#9ca3af' }}>Utilização antes</span>
                    <Badge variant={statusVariant(txState.data.budgetImpact.statusBefore.status)}>
                      {txState.data.budgetImpact.utilizationBefore.toFixed(1)}%
                    </Badge>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <span style={{ fontSize: '0.82rem', color: '#9ca3af' }}>Utilização depois</span>
                    <Badge variant={statusVariant(txState.data.budgetImpact.statusAfter.status)}>
                      {txState.data.budgetImpact.utilizationAfter.toFixed(1)}%
                    </Badge>
                  </div>
                  {/* Progress bar */}
                  <div style={{ background: '#1e2130', borderRadius: 6, height: 8, overflow: 'hidden', marginBottom: '0.5rem' }}>
                    <div
                      style={{
                        width: `${Math.min(txState.data.budgetImpact.utilizationAfter, 100)}%`,
                        height: '100%',
                        background: utilizationColor(txState.data.budgetImpact.utilizationAfter),
                        borderRadius: 6,
                        transition: 'width 0.4s',
                      }}
                    />
                  </div>
                  <p style={{ fontSize: '0.82rem', color: '#9ca3af', marginBottom: '0.75rem' }}>
                    {txState.data.budgetImpact.message}
                  </p>
                </div>
              )}

              {/* Warnings */}
              {txState.data.warnings.length > 0 && (
                <div style={{ marginBottom: '0.75rem' }}>
                  {txState.data.warnings.map((w, i) => (
                    <Alert key={i} variant="warning">{w}</Alert>
                  ))}
                </div>
              )}

              {/* Insights */}
              {txState.data.insights.length > 0 && (
                <div style={{ marginBottom: '0.75rem' }}>
                  <p style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: '0.4rem', fontWeight: 600 }}>
                    INSIGHTS
                  </p>
                  {txState.data.insights.map((ins, i) => (
                    <Alert key={i} variant="info">{ins}</Alert>
                  ))}
                </div>
              )}

              {/* Recommendations */}
              {txState.data.recommendations.length > 0 && (
                <div>
                  <p style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: '0.4rem', fontWeight: 600 }}>
                    RECOMENDAÇÕES
                  </p>
                  {txState.data.recommendations.map((r, i) => (
                    <Alert key={i} variant="success">{r}</Alert>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Budget overview result */}
          {ovState.status === 'success' && (
            <Card>
              <SectionTitle>Visão geral — {overviewMonth}</SectionTitle>

              {/* Summary */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                {[
                  { label: 'Total orçado', value: ovState.data.totalBudgetMinor, color: '#60a5fa' },
                  { label: 'Total gasto', value: ovState.data.totalSpentMinor, color: '#f87171' },
                  { label: 'Restante', value: ovState.data.totalRemainingMinor, color: '#4ade80' },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: '0.72rem', color: '#6b7280', marginBottom: 2 }}>{label}</p>
                    <p style={{ fontSize: '0.95rem', fontWeight: 700, color }}>{formatBRL(value)}</p>
                  </div>
                ))}
              </div>

              {/* Bar chart */}
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={ovState.data.budgetStatuses.map((s) => ({
                    name: s.categoryName,
                    orçado: Number(s.budgetAmountMinor) / 100,
                    gasto: Number(s.spentMinor) / 100,
                    pct: s.utilizationPercent,
                  }))}
                  margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2130" />
                  <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={(v) => `R$${v}`} />
                  <Tooltip
                    contentStyle={{ background: '#1e2130', border: '1px solid #2a2f45', borderRadius: 8 }}
                    formatter={(v) => [formatBRL(Number(v ?? 0) * 100)]}
                  />
                  <Bar dataKey="orçado" fill="#2a2f45" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="gasto" radius={[4, 4, 0, 0]}>
                    {ovState.data.budgetStatuses.map((s, i) => (
                      <Cell key={i} fill={utilizationColor(s.utilizationPercent)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              {/* Status table */}
              <div style={{ marginTop: '0.75rem' }}>
                {ovState.data.budgetStatuses.map((s) => (
                  <div
                    key={s.categoryId}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.4rem 0',
                      borderBottom: '1px solid #1e2130',
                      fontSize: '0.82rem',
                    }}
                  >
                    <span style={{ color: '#e5e7eb' }}>{s.categoryName}</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ color: '#6b7280' }}>{s.utilizationPercent.toFixed(0)}%</span>
                      <Badge variant={statusVariant(s.status)}>{s.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {ovState.status === 'error' && (
            <Alert variant="error"><strong>Erro:</strong> {ovState.message}</Alert>
          )}
        </div>
      </div>
    </div>
  )
}

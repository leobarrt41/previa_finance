/**
 * Budget.tsx — Avaliação de Orçamento
 *
 * UX: directo ao ponto. O utilizador vê imediatamente:
 *   1. Semáforo do mês (% comprometido + risco + sobra)
 *   2. Três blocos: Entra / Sai / Sobra com tendência
 *   3. Categorias com barra de risco colorida
 *   4. Diagnóstico + alertas + recomendações da IA (quando disponível)
 *   5. Histórico comparativo
 *
 * Contrato de API: POST /api/assess/budget
 */
import { useEffect, useState } from 'react'
import {
  api,
  formatBRL,
  currentMonth,
  type BudgetAssessResult,
  type CashFlowTransaction,
} from '../services/api'
import {
  Card,
  Badge,
  Button,
  Alert,
  Spinner,
  SectionTitle,
} from '../components/ui'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function riskVariant(level?: string): 'green' | 'yellow' | 'red' | 'gray' {
  if (level === 'baixo') return 'green'
  if (level === 'moderado') return 'yellow'
  if (level === 'alto' || level === 'crítico') return 'red'
  return 'gray'
}

function riskLabel(level?: string): string {
  if (!level) return '—'
  return level.charAt(0).toUpperCase() + level.slice(1)
}

function commitmentColor(pct: number): string {
  if (pct >= 90) return '#f87171'
  if (pct >= 70) return '#fbbf24'
  if (pct >= 50) return '#fb923c'
  return '#4ade80'
}

function commitmentBg(pct: number): string {
  if (pct >= 90) return 'rgba(248,113,113,0.08)'
  if (pct >= 70) return 'rgba(251,191,36,0.08)'
  if (pct >= 50) return 'rgba(251,146,60,0.08)'
  return 'rgba(74,222,128,0.08)'
}

function formatCategoryLabel(categoryId: string): string {
  if (categoryId === 'sem_categoria') return 'Sem categoria'
  if (categoryId === 'outros') return 'Outros'
  return categoryId
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part: string) => {
      if (/^\d+$/.test(part)) return part
      return part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(' ')
}

function buildMonthOptions(): { value: string; label: string }[] {
  const opts = []
  const now = new Date()
  for (let i = 0; i < 6; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const val = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    opts.push({ value: val, label: label.charAt(0).toUpperCase() + label.slice(1) })
  }
  return opts
}

const manualProjectionStorageKey = 'previa_finance.cashflow.manual_projections.v1'

function loadManualProjections(): CashFlowTransaction[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(manualProjectionStorageKey)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item): CashFlowTransaction | null => {
        if (!item || typeof item !== 'object') return null
        const tx = item as Partial<CashFlowTransaction>
        if (typeof tx.id !== 'string') return null
        if (typeof tx.competencyMonth !== 'string') return null
        if (typeof tx.description !== 'string') return null
        if (typeof tx.amountMinor !== 'number') return null
        if (tx.type !== 'income' && tx.type !== 'expense') return null
        return {
          id: tx.id,
          competencyMonth: tx.competencyMonth,
          amountMinor: tx.amountMinor,
          type: tx.type,
          description: tx.description,
        }
      })
      .filter((tx): tx is CashFlowTransaction => tx !== null)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Subcomponentes
// ---------------------------------------------------------------------------

/** Barra de progresso colorida de comprometimento */
function CommitmentBar({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct))
  const color = commitmentColor(clamped)
  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: '0.72rem', color: '#6b7280' }}>0%</span>
        <span style={{ fontSize: '0.72rem', color: '#6b7280' }}>100%</span>
      </div>
      <div style={{ height: 8, background: '#1e2130', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${clamped}%`,
          background: color,
          borderRadius: 99,
          transition: 'width 0.6s ease',
        }} />
      </div>
    </div>
  )
}

/** Card de métrica principal com tendência */
function MetricCard({
  label,
  value,
  color,
  sub,
  trend,
}: {
  label: string
  value: number
  color: string
  sub?: string
  trend?: { direction: 'up' | 'down' | 'same'; label: string }
}) {
  const trendIcon = trend?.direction === 'up' ? '↑' : trend?.direction === 'down' ? '↓' : '→'
  const trendColor = trend?.direction === 'up'
    ? (color === '#4ade80' ? '#4ade80' : '#f87171')
    : trend?.direction === 'down'
      ? (color === '#4ade80' ? '#f87171' : '#4ade80')
      : '#6b7280'

  return (
    <Card style={{ flex: 1 }}>
      <div style={{ fontSize: '0.78rem', color: '#9ca3af', marginBottom: 6, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 800, color, marginBottom: sub ? 4 : 0 }}>
        {formatBRL(value)}
      </div>
      {sub && <div style={{ fontSize: '0.72rem', color: '#6b7280' }}>{sub}</div>}
      {trend && (
        <div style={{ fontSize: '0.75rem', color: trendColor, marginTop: 6, display: 'flex', alignItems: 'center', gap: 3 }}>
          <span>{trendIcon}</span>
          <span>{trend.label}</span>
        </div>
      )}
    </Card>
  )
}

/** Linha de categoria com barra de risco */
function CategoryRow({
  label,
  amountMinor,
  pct,
}: {
  label: string
  amountMinor: number
  pct: number
}) {
  const color = commitmentColor(pct)
  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: '0.85rem', color: '#e5e7eb' }}>{label}</span>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#e5e7eb' }}>{formatBRL(amountMinor)}</span>
          <span style={{ fontSize: '0.75rem', color, fontWeight: 700, minWidth: 36, textAlign: 'right' }}>{pct}%</span>
        </div>
      </div>
      <div style={{ height: 5, background: '#1e2130', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${Math.min(100, pct)}%`,
          background: color,
          borderRadius: 99,
        }} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export function Budget() {
  const [selectedMonth, setSelectedMonth] = useState(currentMonth())
  const [loading, setLoading] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BudgetAssessResult | null>(null)
  const [manualProjectionCount, setManualProjectionCount] = useState(0)

  async function loadBudget(includeAi = false) {
    if (includeAi) {
      setAiLoading(true)
    } else {
      setLoading(true)
    }
    setError(null)
    try {
      const manualProjections = loadManualProjections()
      setManualProjectionCount(manualProjections.length)
      const data = await api.assess.budget({
        month: selectedMonth,
        includeAi,
        extraForecasts: manualProjections.map((tx) => ({
          id: tx.id,
          competencyMonth: tx.competencyMonth,
          amountMinor: tx.type === 'expense' ? -Math.abs(tx.amountMinor) : Math.abs(tx.amountMinor),
          recurrence: 'one-time',
          description: tx.description,
          isActive: true,
        })),
      })
      setResult(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao avaliar orçamento')
    } finally {
      setLoading(false)
      setAiLoading(false)
    }
  }

  useEffect(() => {
    void loadBudget(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth])

  // ---------------------------------------------------------------------------
  // Derivações
  // ---------------------------------------------------------------------------
  const ai = result?.ai
  const projectedIncomeMinor = result?.projectedIncomeMinor ?? 0
  const projectedExpenseMinor = result?.projectedExpenseMinor ?? 0
  const projectedLiabilityMinor = result?.projectedLiabilityMinor ?? 0
  const installmentDebtMinor = result?.installmentDebtMinor ?? 0
  const usedProjectedIncome = result?.usedProjectedIncome ?? false
  const usedProjectedExpense = result?.usedProjectedExpense ?? false
  const usedProjectedLiability = result?.usedProjectedLiability ?? false

  const consideredIncomeMinor = result?.consideredIncomeMinor
    ?? (result ? result.incomeMinor + projectedIncomeMinor : 0)
  const consideredExpenseMinor = result?.consideredExpenseMinor
    ?? (result ? result.expenseMinor + projectedExpenseMinor : 0)
  const consideredLiabilityMinor = result?.consideredLiabilityMinor
    ?? (result ? result.liabilityMinor + result.openDebtMinor + projectedLiabilityMinor : 0)
  const consideredCommittedMinor = result?.totalCommittedMinor
    ?? (consideredExpenseMinor + consideredLiabilityMinor)

  const commitmentPct = ai?.commitmentPct ?? (
    consideredIncomeMinor > 0
      ? Math.round(consideredCommittedMinor / consideredIncomeMinor * 100)
      : 0
  )

  const availableMinor = ai?.availableMinor
    ?? (result?.availableMinor ?? (consideredIncomeMinor - consideredCommittedMinor))

  // Tendência vs mês anterior (histórico[0] = mês mais recente anterior ao actual)
  const prevMonth = result?.historicalMonths?.[0]
  const incomeTrend = prevMonth && prevMonth.incomeMinor > 0
    ? (consideredIncomeMinor > prevMonth.incomeMinor
        ? { direction: 'up' as const, label: `+${formatBRL(consideredIncomeMinor - prevMonth.incomeMinor)} vs mês anterior` }
        : consideredIncomeMinor < prevMonth.incomeMinor
          ? { direction: 'down' as const, label: `-${formatBRL(prevMonth.incomeMinor - consideredIncomeMinor)} vs mês anterior` }
          : { direction: 'same' as const, label: 'Igual ao mês anterior' })
    : undefined

  const expenseTrend = prevMonth && prevMonth.expenseMinor > 0
    ? (consideredExpenseMinor > prevMonth.expenseMinor
        ? { direction: 'up' as const, label: `+${formatBRL(consideredExpenseMinor - prevMonth.expenseMinor)} vs mês anterior` }
        : consideredExpenseMinor < prevMonth.expenseMinor
          ? { direction: 'down' as const, label: `-${formatBRL(prevMonth.expenseMinor - consideredExpenseMinor)} vs mês anterior` }
          : { direction: 'same' as const, label: 'Igual ao mês anterior' })
    : undefined

  const categoryRows = result?.categoryBreakdown
    .filter(c => c.amountMinor > 0)
    .sort((a, b) => b.pctOfIncome - a.pctOfIncome)
    .slice(0, 8) ?? []

  const hasData = result && (consideredIncomeMinor > 0 || consideredExpenseMinor > 0)

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      {/* Cabeçalho com selector de mês */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <SectionTitle style={{ margin: 0 }}>Orçamento</SectionTitle>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            style={{
              background: '#141624',
              border: '1px solid #2a2f45',
              borderRadius: 8,
              padding: '0.5rem 0.85rem',
              color: '#e5e7eb',
              fontSize: '0.9rem',
            }}
          >
            {buildMonthOptions().map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <Button
            onClick={() => void loadBudget(true)}
            disabled={loading || aiLoading}
            variant="primary"
          >
            {aiLoading ? 'Analisando...' : '🤖 Análise com IA'}
          </Button>
        </div>
      </div>

      {manualProjectionCount > 0 && (
        <Alert variant="info" style={{ marginBottom: '1rem' }}>
          {manualProjectionCount} projeção(ões) avulsa(s) do Fluxo de Caixa incluída(s) nesta avaliação.
        </Alert>
      )}

      {error && <Alert variant="error" style={{ marginBottom: '1rem' }}>{error}</Alert>}

      {loading && (
        <div style={{ textAlign: 'center', padding: '4rem' }}>
          <Spinner />
          <p style={{ color: '#9ca3af', marginTop: '1rem', fontSize: '0.9rem' }}>Carregando avaliação...</p>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Sem dados                                                           */}
      {/* ------------------------------------------------------------------ */}
      {result && !loading && !hasData && (
        <Card style={{ textAlign: 'center', padding: '3rem' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📂</div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: '#e5e7eb', marginBottom: '0.5rem' }}>
            Nenhum dado encontrado para este mês
          </div>
          <p style={{ color: '#9ca3af', fontSize: '0.88rem', maxWidth: 380, margin: '0 auto 1.5rem' }}>
            Importe uma fatura de cartão ou adicione transações para ver a avaliação do orçamento.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button variant="primary" onClick={() => window.location.href = '/invoices'}>
              Importar fatura
            </Button>
            <Button variant="secondary" onClick={() => window.location.href = '/transactions'}>
              Ver transações
            </Button>
          </div>
        </Card>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Conteúdo principal                                                  */}
      {/* ------------------------------------------------------------------ */}
      {result && !loading && hasData && (
        <>
          {/* Semáforo do mês */}
          <Card style={{
            marginBottom: '1.5rem',
            background: commitmentBg(commitmentPct),
            border: `1px solid ${commitmentColor(commitmentPct)}33`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '2rem', fontWeight: 900, color: commitmentColor(commitmentPct) }}>
                  {commitmentPct}%
                </span>
                <div>
                  <div style={{ fontSize: '0.78rem', color: '#9ca3af' }}>da renda comprometido</div>
                  <Badge variant={riskVariant(ai?.riskLevel)}>
                    Risco {riskLabel(ai?.riskLevel)}
                  </Badge>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.78rem', color: '#9ca3af', marginBottom: 2 }}>
                  {availableMinor >= 0 ? 'Sobra disponível' : 'Déficit'}
                </div>
                <div style={{
                  fontSize: '1.6rem',
                  fontWeight: 800,
                  color: availableMinor >= 0 ? '#4ade80' : '#f87171',
                }}>
                  {formatBRL(Math.abs(availableMinor))}
                </div>
                {ai?.canSpend !== undefined && (
                  <div style={{ fontSize: '0.78rem', color: ai.canSpend ? '#4ade80' : '#f87171', marginTop: 2 }}>
                    {ai.canSpend ? '✓ Pode gastar' : '✗ Não recomendado gastar'}
                  </div>
                )}
              </div>
            </div>
            <CommitmentBar pct={commitmentPct} />
          </Card>

          {/* Três métricas principais */}
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            <MetricCard
              label="Entrou"
              value={consideredIncomeMinor}
              color="#4ade80"
              sub={usedProjectedIncome ? `Realizado ${formatBRL(result.incomeMinor)} + Previsto ${formatBRL(projectedIncomeMinor)}` : undefined}
              trend={incomeTrend}
            />
            <MetricCard
              label="Saiu"
              value={consideredCommittedMinor}
              color="#f87171"
              sub={(() => {
                const parts: string[] = []
                if (result.expenseMinor > 0) parts.push(`Gastos ${formatBRL(result.expenseMinor)}`)
                if (result.openDebtMinor > 0) parts.push(`Dívida ${formatBRL(result.openDebtMinor)}`)
                if (installmentDebtMinor > 0) parts.push(`Parcelas ${formatBRL(installmentDebtMinor)}`)
                if (usedProjectedExpense && projectedExpenseMinor > 0) parts.push(`Projetado ${formatBRL(projectedExpenseMinor)}`)
                if (usedProjectedLiability && projectedLiabilityMinor > 0) parts.push(`Dívida prev. ${formatBRL(projectedLiabilityMinor)}`)
                return parts.length > 0 ? parts.join(' · ') : undefined
              })()}
              trend={expenseTrend}
            />
            <MetricCard
              label={availableMinor >= 0 ? 'Sobra' : 'Déficit'}
              value={Math.abs(availableMinor)}
              color={availableMinor >= 0 ? '#4ade80' : '#f87171'}
            />
          </div>

          {/* Diagnóstico da IA */}
          {ai?.diagnosis && (
            <Card style={{ marginBottom: '1.5rem', borderLeft: '3px solid #6366f1' }}>
              <div style={{ fontSize: '0.78rem', color: '#6366f1', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Diagnóstico da IA
              </div>
              <p style={{ color: '#e5e7eb', fontSize: '0.9rem', lineHeight: 1.65, margin: 0 }}>
                {ai.diagnosis}
              </p>
              {ai.trend && (
                <div style={{ marginTop: '0.75rem', fontSize: '0.82rem', color: '#9ca3af' }}>
                  Tendência: <strong style={{ color: ai.trend === 'crescente' ? '#f87171' : ai.trend === 'decrescente' ? '#4ade80' : '#9ca3af' }}>
                    {ai.trend === 'crescente' ? '↑ Gastos crescendo' : ai.trend === 'decrescente' ? '↓ Gastos reduzindo' : '→ Estável'}
                  </strong>
                  {ai.trendDescription && <span style={{ marginLeft: 6 }}>— {ai.trendDescription}</span>}
                </div>
              )}
            </Card>
          )}

          {/* Alertas */}
          {ai?.alerts && ai.alerts.length > 0 && (
            <Card style={{ marginBottom: '1.5rem', borderLeft: '3px solid #fbbf24' }}>
              <div style={{ fontSize: '0.78rem', color: '#fbbf24', marginBottom: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Atenção
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {ai.alerts.map((a, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.88rem', color: '#e5e7eb' }}>
                    <span style={{ color: '#fbbf24', flexShrink: 0, marginTop: 1 }}>⚠</span>
                    {a}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Categorias */}
          {categoryRows.length > 0 && (
            <Card style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.88rem', color: '#e5e7eb', fontWeight: 700 }}>
                  Onde o dinheiro foi
                </div>
                <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
                  % da renda
                </div>
              </div>
              {categoryRows.map(c => (
                <CategoryRow
                  key={c.categoryId}
                  label={formatCategoryLabel(c.categoryId)}
                  amountMinor={c.amountMinor}
                  pct={c.pctOfIncome}
                />
              ))}
            </Card>
          )}

          {/* Recomendações */}
          {ai?.recommendations && ai.recommendations.length > 0 && (
            <Card style={{ marginBottom: '1.5rem', borderLeft: '3px solid #4ade80' }}>
              <div style={{ fontSize: '0.78rem', color: '#4ade80', marginBottom: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                O que fazer
              </div>
              <ol style={{ margin: 0, padding: '0 0 0 1.2rem', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {ai.recommendations.map((r, i) => (
                  <li key={i} style={{ fontSize: '0.88rem', color: '#e5e7eb', lineHeight: 1.55 }}>
                    {r}
                  </li>
                ))}
              </ol>
            </Card>
          )}

          {/* Histórico comparativo */}
          {result.historicalMonths.length > 0 && (
            <Card>
              <div style={{ fontSize: '0.85rem', color: '#9ca3af', marginBottom: '1rem', fontWeight: 600 }}>
                Histórico
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(result.historicalMonths.length, 5)}, 1fr)`, gap: '0.75rem' }}>
                {result.historicalMonths.slice(0, 5).map(h => {
                  const balance = h.incomeMinor - h.expenseMinor
                  return (
                    <div key={h.month} style={{ background: '#0f1117', borderRadius: 8, padding: '0.75rem' }}>
                      <div style={{ fontSize: '0.72rem', color: '#6b7280', marginBottom: 6 }}>
                        {new Date(h.month + '-01').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' })}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#4ade80', marginBottom: 2 }}>
                        ↑ {formatBRL(h.incomeMinor)}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#f87171', marginBottom: 4 }}>
                        ↓ {formatBRL(h.expenseMinor)}
                      </div>
                      <div style={{
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        color: balance >= 0 ? '#4ade80' : '#f87171',
                        borderTop: '1px solid #1e2130',
                        paddingTop: 4,
                        marginTop: 2,
                      }}>
                        {balance >= 0 ? '+' : ''}{formatBRL(balance)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {/* Prompt para análise com IA quando ainda não foi feita */}
          {!ai?.diagnosis && !aiLoading && (
            <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
              <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                Quer um diagnóstico detalhado com alertas e recomendações personalizadas?
              </p>
              <Button
                onClick={() => void loadBudget(true)}
                disabled={aiLoading}
                variant="primary"
              >
                {aiLoading ? 'Analisando...' : '🤖 Analisar com IA'}
              </Button>
            </div>
          )}
          {aiLoading && (
            <div style={{ textAlign: 'center', padding: '1.5rem' }}>
              <Spinner />
              <p style={{ color: '#9ca3af', marginTop: '0.75rem', fontSize: '0.85rem' }}>
                A IA está analisando seus dados financeiros...
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

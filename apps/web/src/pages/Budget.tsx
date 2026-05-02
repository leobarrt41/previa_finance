/**
 * Budget.tsx — Avaliação Automática de Orçamento com IA
 *
 * Sem campos manuais. A avaliação é feita automaticamente com base em:
 *   - Renda/salário (transactions income)
 *   - Faturas (card_invoices)
 *   - Extratos (transactions)
 *   - Classificação em categorias
 *   - Contexto do mês
 *
 * Contrato de API: POST /api/assess/budget
 */
import { useState } from 'react'
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
  type BudgetAssessResult,
} from '../services/api'
import {
  Card,
  Badge,
  Button,
  Select,
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

// ---------------------------------------------------------------------------
// Gauge visual de comprometimento
// ---------------------------------------------------------------------------
function CommitmentGauge({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct))
  const color = commitmentColor(clamped)
  return (
    <div style={{ textAlign: 'center', padding: '1rem 0' }}>
      <div style={{ position: 'relative', display: 'inline-block', width: 160, height: 90 }}>
        <svg width="160" height="90" viewBox="0 0 160 90">
          <path d="M 15 80 A 65 65 0 0 1 145 80" fill="none" stroke="#1e2130" strokeWidth="14" strokeLinecap="round" />
          <path
            d="M 15 80 A 65 65 0 0 1 145 80"
            fill="none"
            stroke={color}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={`${(clamped / 100) * 204} 204`}
          />
        </svg>
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, textAlign: 'center' }}>
          <span style={{ fontSize: '1.6rem', fontWeight: 800, color }}>{clamped}%</span>
          <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>comprometido</div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export function Budget() {
  const monthOptions = buildMonthOptions()
  const [selectedMonth, setSelectedMonth] = useState(currentMonth())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BudgetAssessResult | null>(null)

  async function handleAnalyze() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.assess.budget(selectedMonth)
      setResult(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao avaliar orçamento')
    } finally {
      setLoading(false)
    }
  }

  const ai = result?.ai
  const commitmentPct = ai?.commitmentPct ?? (
    result && result.incomeMinor > 0
      ? Math.round(result.totalCommittedMinor / result.incomeMinor * 100)
      : 0
  )

  const availableMinor = ai?.availableMinor ?? (
    result ? result.incomeMinor - result.totalCommittedMinor : 0
  )

  const chartData = result?.categoryBreakdown
    .filter(c => c.amountMinor > 0)
    .slice(0, 8)
    .map(c => ({
      name: c.categoryId,
      valor: Math.round(c.amountMinor / 100),
      pct: c.pctOfIncome,
    })) ?? []

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <SectionTitle>Orçamento</SectionTitle>
      <p style={{ color: '#9ca3af', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        Avaliação automática com base na sua renda, extratos, faturas e categorias do mês.
      </p>

      {/* Controles */}
      <Card style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#9ca3af', marginBottom: 4 }}>
              Mês de referência
            </label>
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.55rem 0.85rem', color: '#e5e7eb', fontSize: '0.9rem', width: '100%' }}
            >
              {buildMonthOptions().map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <Button onClick={handleAnalyze} disabled={loading} variant="primary">
            {loading ? 'Analisando...' : '🤖 Avaliar com IA'}
          </Button>
        </div>
      </Card>

      {error && <Alert variant="error" style={{ marginBottom: '1rem' }}>{error}</Alert>}
      {loading && (
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <Spinner />
          <p style={{ color: '#9ca3af', marginTop: '1rem' }}>A IA está analisando seus dados financeiros...</p>
        </div>
      )}

      {result && !loading && (
        <>
          {/* Gauge + Pode gastar? */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
            <Card>
              <div style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: 4 }}>Comprometimento da renda</div>
              <CommitmentGauge pct={commitmentPct} />
              <div style={{ textAlign: 'center', marginTop: 4 }}>
                <Badge variant={riskVariant(ai?.riskLevel)}>
                  Risco {riskLabel(ai?.riskLevel)}
                </Badge>
              </div>
            </Card>
            <Card>
              <div style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: 8 }}>Pode gastar?</div>
              {ai?.canSpend !== undefined && (
                <div style={{
                  fontSize: '2rem',
                  fontWeight: 800,
                  color: ai.canSpend ? '#4ade80' : '#f87171',
                  marginBottom: 8,
                }}>
                  {ai.canSpend ? '✓ Sim' : '✗ Não'}
                </div>
              )}
              <div style={{ fontSize: '0.85rem', color: '#9ca3af', marginBottom: 4 }}>Sobra disponível</div>
              <div style={{
                fontSize: '1.4rem',
                fontWeight: 700,
                color: availableMinor >= 0 ? '#4ade80' : '#f87171',
              }}>
                {formatBRL(availableMinor)}
              </div>
            </Card>
          </div>

          {/* Métricas */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
            {[
              { label: 'Renda', value: result.incomeMinor, color: '#4ade80' },
              { label: 'Gastos', value: result.expenseMinor, color: '#f87171' },
              { label: 'Dívida em aberto', value: result.openDebtMinor, color: '#fbbf24' },
              { label: availableMinor >= 0 ? 'Sobra' : 'Déficit', value: Math.abs(availableMinor), color: availableMinor >= 0 ? '#4ade80' : '#f87171' },
            ].map(m => (
              <Card key={m.label}>
                <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: 4 }}>{m.label}</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: m.color }}>{formatBRL(m.value)}</div>
              </Card>
            ))}
          </div>

          {/* Diagnóstico da IA */}
          {ai?.diagnosis && (
            <Card style={{ marginBottom: '1.5rem', borderLeft: '3px solid #6366f1' }}>
              <div style={{ fontSize: '0.8rem', color: '#6366f1', marginBottom: 6, fontWeight: 600 }}>
                🤖 Diagnóstico
              </div>
              <p style={{ color: '#e5e7eb', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }}>
                {ai.diagnosis}
              </p>
            </Card>
          )}

          {/* Gráfico de categorias */}
          {chartData.length > 0 && (
            <Card style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.85rem', color: '#9ca3af', marginBottom: '1rem' }}>
                Categorias mais impactantes (% da renda)
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 40, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2130" />
                  <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={v => `${v}%`} />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} width={80} />
                  <Tooltip
                    contentStyle={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8 }}
                    formatter={(v: unknown) => [`${(v as number)}%`, 'da renda']}
                  />
                  <Bar dataKey="pct" radius={[0, 4, 4, 0]}>
                    {chartData.map((entry, i) => (
                      <Cell key={i} fill={commitmentColor(entry.pct)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* Alertas */}
          {ai?.alerts && ai.alerts.length > 0 && (
            <Card style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.85rem', color: '#fbbf24', marginBottom: '0.75rem', fontWeight: 600 }}>
                ⚠️ Alertas
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {ai.alerts.map((a, i) => (
                  <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.88rem', color: '#e5e7eb' }}>
                    <span style={{ color: '#fbbf24', flexShrink: 0 }}>•</span>
                    {a}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Recomendações */}
          {ai?.recommendations && ai.recommendations.length > 0 && (
            <Card style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.85rem', color: '#4ade80', marginBottom: '0.75rem', fontWeight: 600 }}>
                💡 Recomendações
              </div>
              <ol style={{ margin: 0, padding: '0 0 0 1.2rem', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {ai.recommendations.map((r, i) => (
                  <li key={i} style={{ fontSize: '0.88rem', color: '#e5e7eb', lineHeight: 1.5 }}>
                    {r}
                  </li>
                ))}
              </ol>
            </Card>
          )}

          {/* Histórico */}
          {result.historicalMonths.length > 0 && (
            <Card>
              <div style={{ fontSize: '0.85rem', color: '#9ca3af', marginBottom: '0.75rem' }}>
                Histórico dos últimos meses
              </div>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                {result.historicalMonths.map(h => (
                  <div key={h.month} style={{ flex: 1, minWidth: 120, background: '#0f1117', borderRadius: 8, padding: '0.75rem' }}>
                    <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: 4 }}>{h.month}</div>
                    <div style={{ fontSize: '0.8rem', color: '#4ade80' }}>↑ {formatBRL(h.incomeMinor)}</div>
                    <div style={{ fontSize: '0.8rem', color: '#f87171' }}>↓ {formatBRL(h.expenseMinor)}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {!result && !loading && (
        <Card style={{ textAlign: 'center', padding: '3rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🎯</div>
          <p style={{ color: '#9ca3af' }}>
            Selecione o mês e clique em <strong style={{ color: '#6366f1' }}>Avaliar com IA</strong> para obter um diagnóstico financeiro completo.
          </p>
        </Card>
      )}
    </div>
  )
}

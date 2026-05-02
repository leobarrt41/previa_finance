/**
 * SpendingAssessor.tsx — Avaliador de Gastos por Categoria
 * API: POST /api/assess/spending
 * Pre-seleccao: /assess/spending?categoryId=xxx
 */
import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  api, formatBRL, currentMonth,
  type SpendingAssessResult, type Category,
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

export function SpendingAssessor() {
  const [searchParams] = useSearchParams()
  const preselectedId = searchParams.get('categoryId') ?? ''

  const [categories, setCategories] = useState<Category[]>([])
  const [selectedCategory, setSelectedCategory] = useState(preselectedId)
  const [selectedMonth, setSelectedMonth] = useState(currentMonth())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SpendingAssessResult | null>(null)

  useEffect(() => {
    api.categories.list().then(cats => setCategories(cats.filter(c => c.type === 'expense'))).catch(() => {})
  }, [])

  useEffect(() => {
    if (preselectedId && categories.length > 0) runAnalyze(preselectedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedId, categories.length])

  async function runAnalyze(catId?: string) {
    const cat = catId ?? selectedCategory
    if (!cat) return
    setLoading(true); setError(null)
    try {
      setResult(await api.assess.spending(selectedMonth, cat))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao avaliar gastos')
    } finally { setLoading(false) }
  }

  const ai = result?.ai
  const chartData = result?.monthlySummary.map(m => ({ month: m.month, valor: Math.round(m.totalMinor / 100) })) ?? []
  const impactPct = result?.impactOnIncomePct ?? 0
  const impactColor = impactPct >= 30 ? '#f87171' : impactPct >= 15 ? '#fbbf24' : '#4ade80'

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <SectionTitle>Avaliador de Gastos</SectionTitle>
      <p style={{ color: '#9ca3af', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        Analise o gasto de uma categoria: historico, tendencia, impacto na renda e recomendacoes da IA.
      </p>

      <Card style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 2, minWidth: 200 }}>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#9ca3af', marginBottom: 4 }}>Categoria</label>
            <select
              value={selectedCategory}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedCategory(e.target.value)}
              style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.55rem 0.85rem', color: '#e5e7eb', fontSize: '0.9rem', width: '100%' }}
            >
              <option value="">Selecione uma categoria...</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
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
                  <Tooltip contentStyle={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8 }} formatter={(v: unknown) => [formatBRL((v as number) * 100), 'Gasto']} />
                  <Line type="monotone" dataKey="valor" stroke="#6366f1" strokeWidth={2} dot={{ fill: '#6366f1', r: 4 }} />
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
                    <span style={{ fontSize: '0.85rem', color: '#d1d5db' }}>{t.description ?? '—'}</span>
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
          <p style={{ color: '#9ca3af' }}>Selecione uma categoria e clique em <strong style={{ color: '#6366f1' }}>Avaliar</strong>.</p>
        </Card>
      )}
    </div>
  )
}

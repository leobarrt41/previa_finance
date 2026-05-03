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
import { useEffect, useState } from 'react'
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
  type CashFlowTransaction,
} from '../services/api'
import {
  Card,
  Badge,
  Button,
  Input,
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
// Gauge visual de comprometimento
// ---------------------------------------------------------------------------
function CommitmentGauge({ pct, color }: { pct: number; color?: string }) {
  const clamped = Math.min(100, Math.max(0, pct))
  const c = color ?? commitmentColor(clamped)
  return (
    <div style={{ textAlign: 'center', padding: '1rem 0' }}>
      <div style={{ position: 'relative', display: 'inline-block', width: 160, height: 90 }}>
        <svg width="160" height="90" viewBox="0 0 160 90">
          <path d="M 15 80 A 65 65 0 0 1 145 80" fill="none" stroke="#1e2130" strokeWidth="14" strokeLinecap="round" />
          <path
            d="M 15 80 A 65 65 0 0 1 145 80"
            fill="none"
            stroke={c}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={`${(clamped / 100) * 204} 204`}
          />
        </svg>
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, textAlign: 'center' }}>
          <span style={{ fontSize: '1.6rem', fontWeight: 800, color: c }}>{clamped}%</span>
          <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>comprometido</div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tipos locais para purchaseImpact
// ---------------------------------------------------------------------------
interface PurchaseImpact {
  description: string
  totalAmountBRL: string
  installments: number
  monthlyBRL: string
  type: 'credit' | 'debit'
  impactThisMonthBRL: string
  availableAfterBRL: string
  availableAfterMinor: number
  committedAfterMinor: number
  commitmentAfterPct: number
  canAfford: boolean
  riskAfter: string
}

interface PurchaseVerdict {
  canAfford: boolean
  verdict: string
  impactSummary: string
  warnings?: string[]
  alternatives?: string[]
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
  const [manualProjectionCount, setManualProjectionCount] = useState(0)

  // Estado do simulador de compra
  const [purchaseDesc, setPurchaseDesc] = useState('')
  const [purchaseValue, setPurchaseValue] = useState('')
  const [purchaseInstallments, setPurchaseInstallments] = useState('1')
  const [purchaseType, setPurchaseType] = useState<'credit' | 'debit'>('credit')
  const [purchaseLoading, setPurchaseLoading] = useState(false)
  const [purchaseImpact, setPurchaseImpact] = useState<PurchaseImpact | null>(null)
  const [purchaseVerdict, setPurchaseVerdict] = useState<PurchaseVerdict | null>(null)
  const [purchaseError, setPurchaseError] = useState<string | null>(null)

  async function handleAnalyze(includeAi = false) {
    setLoading(true)
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
    }
  }

  async function handleSimulatePurchase() {
    const valueNum = parseFloat(purchaseValue.replace(',', '.'))
    if (!purchaseDesc.trim() || isNaN(valueNum) || valueNum <= 0) {
      setPurchaseError('Preencha a descrição e o valor da compra.')
      return
    }
    setPurchaseLoading(true)
    setPurchaseError(null)
    setPurchaseImpact(null)
    setPurchaseVerdict(null)
    try {
      const manualProjections = loadManualProjections()
      const data = await api.assess.budget({
        month: selectedMonth,
        includeAi: true,
        extraForecasts: manualProjections.map((tx) => ({
          id: tx.id,
          competencyMonth: tx.competencyMonth,
          amountMinor: tx.type === 'expense' ? -Math.abs(tx.amountMinor) : Math.abs(tx.amountMinor),
          recurrence: 'one-time',
          description: tx.description,
          isActive: true,
        })),
        purchaseIntent: {
          description: purchaseDesc.trim(),
          totalAmountMinor: Math.round(valueNum * 100),
          installments: Math.max(1, parseInt(purchaseInstallments) || 1),
          type: purchaseType,
        },
      } as Parameters<typeof api.assess.budget>[0])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyData = data as any
      if (anyData.purchaseImpact) setPurchaseImpact(anyData.purchaseImpact as PurchaseImpact)
      if (anyData.ai?.purchaseVerdict) setPurchaseVerdict(anyData.ai.purchaseVerdict as PurchaseVerdict)
      // Actualiza o resultado principal também
      setResult(data)
    } catch (e: unknown) {
      setPurchaseError(e instanceof Error ? e.message : 'Erro ao simular compra')
    } finally {
      setPurchaseLoading(false)
    }
  }

  useEffect(() => {
    void handleAnalyze(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth])

  const ai = result?.ai
  const projectedIncomeMinor = result?.projectedIncomeMinor ?? 0
  const projectedExpenseMinor = result?.projectedExpenseMinor ?? 0
  const projectedLiabilityMinor = result?.projectedLiabilityMinor ?? 0
  const installmentDebtMinor = result?.installmentDebtMinor ?? 0
  const usedProjectedIncome = result?.usedProjectedIncome ?? false
  const usedProjectedExpense = result?.usedProjectedExpense ?? false
  const usedProjectedLiability = result?.usedProjectedLiability ?? false
  const consideredIncomeMinor = result?.consideredIncomeMinor ?? (result ? result.incomeMinor + projectedIncomeMinor : 0)
  const consideredExpenseMinor = result?.consideredExpenseMinor ?? (result ? result.expenseMinor + projectedExpenseMinor : 0)
  const consideredLiabilityMinor = result?.consideredLiabilityMinor ?? (result ? result.liabilityMinor + result.openDebtMinor + projectedLiabilityMinor : 0)
  const consideredCommittedMinor = result?.totalCommittedMinor ?? (consideredExpenseMinor + consideredLiabilityMinor)
  const commitmentPct = ai?.commitmentPct ?? (
    consideredIncomeMinor > 0
      ? Math.round(consideredCommittedMinor / consideredIncomeMinor * 100)
      : 0
  )

  const availableMinor = ai?.availableMinor ?? (
    result?.availableMinor ?? (consideredIncomeMinor - consideredCommittedMinor)
  )

  const chartData = result?.categoryBreakdown
    .filter(c => c.amountMinor > 0)
    .slice(0, 8)
    .map(c => ({
      name: c.categoryId,
      valor: Math.round(c.amountMinor / 100),
      pct: c.pctOfIncome,
    })) ?? []

  const installmentsNum = Math.max(1, parseInt(purchaseInstallments) || 1)
  const purchaseValueNum = parseFloat(purchaseValue.replace(',', '.')) || 0
  const previewMonthly = purchaseValueNum > 0 && installmentsNum > 1
    ? purchaseValueNum / installmentsNum
    : null

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <SectionTitle>Orçamento</SectionTitle>
      <p style={{ color: '#9ca3af', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        Avaliação automática com base na sua renda, extratos, faturas, previsões e projeções avulsas do mês.
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
          <Button onClick={() => void handleAnalyze(true)} disabled={loading} variant="primary">
            {loading ? 'Analisando...' : '🤖 Detalhar com IA'}
          </Button>
        </div>
      </Card>

      {manualProjectionCount > 0 && (
        <Alert variant="info" style={{ marginBottom: '1rem' }}>
          {manualProjectionCount} projeção(ões) avulsa(s) foram carregada(s) do Fluxo de caixa para esta avaliação.
        </Alert>
      )}

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
              {
                label: 'Renda considerada',
                value: consideredIncomeMinor,
                color: '#4ade80',
                meta: `Realizada ${formatBRL(result.incomeMinor)}${usedProjectedIncome ? ` • Prevista ${formatBRL(projectedIncomeMinor)}` : ''}`,
              },
              {
                label: 'Gastos considerados',
                value: consideredExpenseMinor,
                color: '#f87171',
                meta: `Realizados ${formatBRL(result.expenseMinor)}${usedProjectedExpense ? ` • Projetados ${formatBRL(projectedExpenseMinor)}` : ''}`,
              },
              {
                label: 'Dívida em aberto',
                value: consideredLiabilityMinor,
                color: '#fbbf24',
                meta: `Aberta ${formatBRL(result.openDebtMinor)}${installmentDebtMinor > 0 ? ` • Parcelas ${formatBRL(installmentDebtMinor)}` : ''}${usedProjectedLiability ? ` • Projetada ${formatBRL(projectedLiabilityMinor)}` : ''}`,
              },
                { label: availableMinor >= 0 ? 'Sobra' : 'Déficit', value: Math.abs(availableMinor), color: availableMinor >= 0 ? '#4ade80' : '#f87171' },
            ].map(m => (
              <Card key={m.label}>
                <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: 4 }}>{m.label}</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: m.color }}>{formatBRL(m.value)}</div>
                {'meta' in m && m.meta && (
                  <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 4 }}>{m.meta}</div>
                )}
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

          {/* ----------------------------------------------------------------- */}
          {/* Simulador de Intenção de Compra                                    */}
          {/* ----------------------------------------------------------------- */}
          <Card style={{ marginBottom: '1.5rem', borderLeft: '3px solid #f59e0b' }}>
            <div style={{ fontSize: '0.85rem', color: '#f59e0b', marginBottom: '1rem', fontWeight: 600 }}>
              🛒 Simular compra
            </div>
            <p style={{ fontSize: '0.82rem', color: '#9ca3af', marginBottom: '1rem', marginTop: 0 }}>
              Informe o que quer comprar e a IA avalia se cabe no seu orçamento agora.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem', alignItems: 'flex-end' }}>
              <Input
                label="O que quer comprar?"
                placeholder="Ex: iPhone 15 Pro, Geladeira, Viagem..."
                value={purchaseDesc}
                onChange={e => setPurchaseDesc(e.target.value)}
              />
              <Input
                label="Valor total (R$)"
                placeholder="Ex: 3499,90"
                value={purchaseValue}
                onChange={e => setPurchaseValue(e.target.value)}
                type="text"
                inputMode="decimal"
              />
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#9ca3af', marginBottom: 4 }}>Parcelas</label>
                <select
                  value={purchaseInstallments}
                  onChange={e => setPurchaseInstallments(e.target.value)}
                  style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.55rem 0.85rem', color: '#e5e7eb', fontSize: '0.9rem', width: '100%' }}
                >
                  {[1,2,3,4,5,6,7,8,9,10,11,12,18,24,36,48].map(n => (
                    <option key={n} value={n}>{n === 1 ? 'À vista' : `${n}x`}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', color: '#9ca3af', marginBottom: 4 }}>Forma</label>
                <select
                  value={purchaseType}
                  onChange={e => setPurchaseType(e.target.value as 'credit' | 'debit')}
                  style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.55rem 0.85rem', color: '#e5e7eb', fontSize: '0.9rem', width: '100%' }}
                >
                  <option value="credit">Crédito</option>
                  <option value="debit">Débito</option>
                </select>
              </div>
            </div>

            {previewMonthly !== null && (
              <div style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.75rem' }}>
                Parcela estimada: <strong style={{ color: '#f59e0b' }}>{formatBRL(Math.round(previewMonthly * 100))}</strong>/mês
              </div>
            )}

            {purchaseError && <Alert variant="error" style={{ marginBottom: '0.75rem' }}>{purchaseError}</Alert>}

            <Button
              onClick={() => void handleSimulatePurchase()}
              disabled={purchaseLoading || !purchaseDesc.trim() || !purchaseValue}
              variant="primary"
            >
              {purchaseLoading ? 'Consultando IA...' : '🤖 Posso comprar?'}
            </Button>

            {/* Resultado da simulação */}
            {purchaseImpact && (
              <div style={{ marginTop: '1.25rem', borderTop: '1px solid #1e2130', paddingTop: '1.25rem' }}>
                {/* Veredicto principal */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  marginBottom: '1rem',
                  padding: '0.75rem 1rem',
                  borderRadius: 10,
                  background: purchaseImpact.canAfford ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)',
                  border: `1px solid ${purchaseImpact.canAfford ? '#4ade80' : '#f87171'}`,
                }}>
                  <span style={{ fontSize: '1.8rem' }}>{purchaseImpact.canAfford ? '✅' : '❌'}</span>
                  <div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, color: purchaseImpact.canAfford ? '#4ade80' : '#f87171' }}>
                      {purchaseImpact.canAfford ? 'Pode comprar' : 'Não recomendado agora'}
                    </div>
                    {purchaseVerdict?.verdict && (
                      <div style={{ fontSize: '0.85rem', color: '#e5e7eb', marginTop: 2 }}>
                        {purchaseVerdict.verdict}
                      </div>
                    )}
                  </div>
                </div>

                {/* Impacto numérico */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
                  {[
                    { label: 'Impacto este mês', value: purchaseImpact.impactThisMonthBRL, color: '#f87171' },
                    { label: 'Sobra após compra', value: purchaseImpact.availableAfterBRL, color: purchaseImpact.canAfford ? '#4ade80' : '#f87171' },
                    { label: 'Comprometimento após', value: `${purchaseImpact.commitmentAfterPct}%`, color: commitmentColor(purchaseImpact.commitmentAfterPct) },
                  ].map(m => (
                    <div key={m.label} style={{ background: '#0f1117', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
                      <div style={{ fontSize: '0.72rem', color: '#6b7280', marginBottom: 2 }}>{m.label}</div>
                      <div style={{ fontSize: '1rem', fontWeight: 700, color: m.color }}>{m.value}</div>
                    </div>
                  ))}
                </div>

                {/* Comparação de gauge antes/depois */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                  <div style={{ background: '#0f1117', borderRadius: 8, padding: '0.5rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.72rem', color: '#6b7280', marginBottom: 4 }}>Antes da compra</div>
                    <CommitmentGauge pct={commitmentPct} />
                  </div>
                  <div style={{ background: '#0f1117', borderRadius: 8, padding: '0.5rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.72rem', color: '#6b7280', marginBottom: 4 }}>Após a compra</div>
                    <CommitmentGauge pct={purchaseImpact.commitmentAfterPct} />
                  </div>
                </div>

                {/* Análise da IA */}
                {purchaseVerdict?.impactSummary && (
                  <div style={{ fontSize: '0.85rem', color: '#e5e7eb', lineHeight: 1.6, marginBottom: '0.75rem', padding: '0.75rem', background: '#0f1117', borderRadius: 8 }}>
                    {purchaseVerdict.impactSummary}
                  </div>
                )}

                {/* Avisos */}
                {purchaseVerdict?.warnings && purchaseVerdict.warnings.length > 0 && (
                  <div style={{ marginBottom: '0.75rem' }}>
                    {purchaseVerdict.warnings.map((w, i) => (
                      <div key={i} style={{ fontSize: '0.82rem', color: '#fbbf24', display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 4 }}>
                        <span style={{ flexShrink: 0 }}>⚠️</span> {w}
                      </div>
                    ))}
                  </div>
                )}

                {/* Alternativas */}
                {purchaseVerdict?.alternatives && purchaseVerdict.alternatives.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.78rem', color: '#6366f1', fontWeight: 600, marginBottom: 4 }}>Alternativas sugeridas:</div>
                    {purchaseVerdict.alternatives.map((a, i) => (
                      <div key={i} style={{ fontSize: '0.82rem', color: '#e5e7eb', display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 4 }}>
                        <span style={{ color: '#6366f1', flexShrink: 0 }}>→</span> {a}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>

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
            Selecione o mês para carregar a avaliação automática. Se quiser texto mais detalhado, clique em <strong style={{ color: '#6366f1' }}>Detalhar com IA</strong>.
          </p>
        </Card>
      )}
    </div>
  )
}

/**
 * DebtAssessor.tsx — Avaliador de Dívidas
 * API: POST /api/assess/debt
 *
 * UX redesenhada:
 *  1. Carrega automaticamente ao abrir (sem precisar clicar em "Avaliar")
 *  2. Semáforo de saúde financeira no topo (pressão real calculada correctamente)
 *  3. Três blocos claros: Dívida em aberto / Parcelas futuras / Pago este mês
 *  4. Barras de pressão com valores distintos e correctos
 *  5. Faturas do mês em cards visuais (não tabela crua)
 *  6. Parcelas futuras agrupadas por mês
 *  7. Evolução mensal com chart de barras legível
 *  8. IA inline (diagnóstico + alertas + recomendações)
 */
import { useEffect, useState } from 'react'
import {
  api, formatBRL, currentMonth, type DebtAssessResult,
} from '../services/api'
import { Card, Badge, Button, Alert, Spinner, SectionTitle } from '../components/ui'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function riskVariant(level?: string): 'green' | 'yellow' | 'red' | 'gray' {
  if (level === 'baixo') return 'green'
  if (level === 'moderado') return 'yellow'
  if (level === 'alto' || level === 'critico' || level === 'crítico') return 'red'
  return 'gray'
}

function pressureColor(pct: number): string {
  if (pct >= 40) return '#f87171'
  if (pct >= 25) return '#fbbf24'
  return '#4ade80'
}

function pressureBg(pct: number): string {
  if (pct >= 40) return 'rgba(248,113,113,0.08)'
  if (pct >= 25) return 'rgba(251,191,36,0.08)'
  return 'rgba(74,222,128,0.08)'
}

function pressureLabel(pct: number): string {
  if (pct >= 40) return 'Alta'
  if (pct >= 25) return 'Moderada'
  return 'Baixa'
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

function shortMonth(month: string): string {
  try {
    return new Date(month + '-01').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' })
  } catch {
    return month
  }
}

// ---------------------------------------------------------------------------
// Subcomponentes
// ---------------------------------------------------------------------------

/** Barra de pressão com label e valor */
function PressureBar({
  label,
  pct,
  color,
  sub,
  height = 10,
}: {
  label: string
  pct: number
  color: string
  sub?: string
  height?: number
}) {
  const clamped = Math.min(100, Math.max(0, pct))
  return (
    <div style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
        <div>
          <span style={{ fontSize: '0.85rem', color: '#e5e7eb' }}>{label}</span>
          {sub && <span style={{ fontSize: '0.75rem', color: '#6b7280', marginLeft: 8 }}>{sub}</span>}
        </div>
        <span style={{ fontSize: '0.9rem', fontWeight: 700, color }}>{pct.toFixed(1)}%</span>
      </div>
      <div style={{ background: '#1e2130', borderRadius: 99, height, overflow: 'hidden' }}>
        <div style={{
          background: color,
          borderRadius: 99,
          height: '100%',
          width: `${clamped}%`,
          transition: 'width 0.6s ease',
        }} />
      </div>
    </div>
  )
}

/** Card de fatura individual */
function InvoiceCard({
  card,
  brand,
  last4,
  openMinor,
  totalMinor,
  paidMinor,
  purchasesMinor,
  previousMinor,
  dueDate,
  month,
}: {
  card: string | null
  brand: string | null
  last4: string | null
  openMinor: number
  totalMinor: number
  paidMinor: number
  purchasesMinor: number
  previousMinor: number
  dueDate: string | null
  month: string
}) {
  const isPaid = openMinor <= 0
  const statusColor = isPaid ? '#4ade80' : '#fbbf24'
  const cardLabel = [brand, last4 ? `••${last4}` : null].filter(Boolean).join(' ') || card || 'Cartão'

  return (
    <div style={{
      background: '#0f1117',
      borderRadius: 10,
      padding: '0.85rem 1rem',
      border: `1px solid ${isPaid ? '#1e2130' : '#fbbf2433'}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.6rem' }}>
        <div>
          <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#e5e7eb' }}>{cardLabel}</div>
          <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 2 }}>
            Competência {month}{dueDate ? ` · Vence ${new Date(dueDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })}` : ''}
          </div>
        </div>
        <span style={{
          fontSize: '0.72rem',
          fontWeight: 700,
          color: statusColor,
          background: isPaid ? 'rgba(74,222,128,0.1)' : 'rgba(251,191,36,0.1)',
          padding: '2px 8px',
          borderRadius: 99,
        }}>
          {isPaid ? 'Pago' : 'Em aberto'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
        {[
          { label: 'Fatura anterior', value: previousMinor, color: '#9ca3af' },
          { label: 'Compras do mês', value: purchasesMinor, color: '#fbbf24' },
          { label: 'Pago', value: paidMinor, color: '#4ade80' },
          { label: isPaid ? 'Total' : 'Em aberto', value: isPaid ? totalMinor : openMinor, color: statusColor },
        ].map(m => (
          <div key={m.label}>
            <div style={{ fontSize: '0.68rem', color: '#6b7280', marginBottom: 2 }}>{m.label}</div>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: m.color }}>{formatBRL(m.value)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export function DebtAssessor() {
  const [selectedMonth, setSelectedMonth] = useState(currentMonth())
  const [projectionMonths, setProjectionMonths] = useState(3)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DebtAssessResult | null>(null)

  async function loadDebt() {
    setLoading(true)
    setError(null)
    try {
      setResult(await api.assess.debt(selectedMonth, projectionMonths))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao avaliar dívidas')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadDebt()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth, projectionMonths])

  // ---------------------------------------------------------------------------
  // Derivações
  // ---------------------------------------------------------------------------
  const ai = result?.ai
  const consideredIncome = result?.consideredIncomeMinor ?? result?.incomeMinor ?? 0

  // Pressão total = debtPressurePct (campo real da API)
  const totalPressurePct = result?.debtPressurePct ?? 0

  // Pressão só da dívida em aberto = openDebtMinor / consideredIncome * 100
  // (campo separado calculado aqui, pois a API não retorna openDebtPressurePct)
  const openPressurePct = consideredIncome > 0
    ? Math.round((result?.openDebtMinor ?? 0) / consideredIncome * 100 * 10) / 10
    : 0

  // Pressão de parcelas futuras = futureInstallmentsMinor / consideredIncome * 100
  const futurePressurePct = consideredIncome > 0
    ? Math.round((result?.futureInstallmentsMinor ?? 0) / consideredIncome * 100 * 10) / 10
    : 0

  const totalColor = pressureColor(totalPressurePct)

  const effectiveById = new Map((result?.invoicesSummary ?? []).map(inv => [inv.id, inv]))
  const currentMonthInvoices = (result?.cashflowInvoicesSummary ?? [])
    .filter(inv => inv.month === selectedMonth)
    .map(inv => ({
      ...inv,
      effective: effectiveById.get(inv.id),
    }))

  // Parcelas futuras agrupadas por mês
  type FutureInstallment = DebtAssessResult['futureInstallments'][number]
  const futureByMonth = (result?.futureInstallments ?? []).reduce<Record<string, FutureInstallment[]>>((acc, inst) => {
    const m = inst.month
    if (!acc[m]) acc[m] = []
    acc[m].push(inst)
    return acc
  }, {})
  const futureMonths = Object.keys(futureByMonth).sort()

  // Evolução mensal
  const debtTrendSeries = result?.debtTrendSeries ?? []
  const visibleSeries = debtTrendSeries.filter(row =>
    (row.fixedExpensesMinor ?? 0) !== 0 ||
    (row.cardPurchasesMinor ?? 0) !== 0 ||
    (row.statementOutflowMinor ?? 0) !== 0
  )
  const trendMax = Math.max(
    1,
    ...visibleSeries.flatMap(row => [
      Math.abs((row.fixedExpensesMinor ?? 0) + (row.statementOutflowMinor ?? 0)),
      Math.abs(row.cardPurchasesMinor ?? 0),
      Math.abs(row.balanceMinor ?? 0),
    ])
  )

  const selectedTrendRow = debtTrendSeries.find(r => r.month === selectedMonth) ?? debtTrendSeries[debtTrendSeries.length - 1] ?? null
  const selectedNetBalanceMinor = selectedTrendRow?.balanceMinor ?? result?.netBalanceMinor ?? 0
  const balanceColor = selectedNetBalanceMinor >= 0 ? '#4ade80' : '#f87171'

  const hasData = result && (result.openDebtMinor > 0 || result.invoiceCount > 0 || consideredIncome > 0)

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      {/* Cabeçalho */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <SectionTitle style={{ margin: 0 }}>Dívidas</SectionTitle>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem 0.85rem', color: '#e5e7eb', fontSize: '0.9rem' }}
          >
            {buildMonthOptions().map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            value={String(projectionMonths)}
            onChange={e => setProjectionMonths(Number(e.target.value))}
            style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem 0.85rem', color: '#e5e7eb', fontSize: '0.9rem' }}
          >
            {[1, 2, 3, 4, 5, 6].map(n => (
              <option key={n} value={String(n)}>{n} {n === 1 ? 'mês' : 'meses'} à frente</option>
            ))}
          </select>
        </div>
      </div>

      {error && <Alert variant="error" style={{ marginBottom: '1rem' }}>{error}</Alert>}

      {loading && (
        <div style={{ textAlign: 'center', padding: '4rem' }}>
          <Spinner />
          <p style={{ color: '#9ca3af', marginTop: '1rem', fontSize: '0.9rem' }}>Analisando dívidas e faturas...</p>
        </div>
      )}

      {/* Sem dados */}
      {result && !loading && !hasData && (
        <Card style={{ textAlign: 'center', padding: '3rem' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>💳</div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: '#e5e7eb', marginBottom: '0.5rem' }}>
            Nenhuma dívida ou fatura encontrada
          </div>
          <p style={{ color: '#9ca3af', fontSize: '0.88rem', maxWidth: 360, margin: '0 auto 1.5rem' }}>
            Importe uma fatura de cartão para ver o avaliador de dívidas em acção.
          </p>
          <Button variant="primary" onClick={() => window.location.href = '/invoices'}>
            Importar fatura
          </Button>
        </Card>
      )}

      {result && !loading && hasData && (
        <>
          {/* ---------------------------------------------------------------- */}
          {/* Semáforo de pressão financeira                                   */}
          {/* ---------------------------------------------------------------- */}
          <Card style={{
            marginBottom: '1.5rem',
            background: pressureBg(totalPressurePct),
            border: `1px solid ${totalColor}33`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontSize: '2rem', fontWeight: 900, color: totalColor }}>
                  {totalPressurePct.toFixed(0)}%
                </span>
                <div>
                  <div style={{ fontSize: '0.78rem', color: '#9ca3af' }}>da renda comprometida com dívidas</div>
                  <Badge variant={riskVariant(ai?.delayRisk ?? (totalPressurePct >= 40 ? 'alto' : totalPressurePct >= 25 ? 'moderado' : 'baixo'))}>
                    Pressão {pressureLabel(totalPressurePct)}
                  </Badge>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.78rem', color: '#9ca3af', marginBottom: 2 }}>Saldo real do mês</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: balanceColor }}>
                  {formatBRL(Math.abs(selectedNetBalanceMinor))}
                </div>
                <div style={{ fontSize: '0.75rem', color: balanceColor }}>
                  {selectedNetBalanceMinor >= 0 ? '✓ Positivo' : '✗ Negativo'}
                </div>
              </div>
            </div>

            {/* As três barras com valores distintos */}
            <PressureBar
              label="Pressão total sobre a renda"
              pct={totalPressurePct}
              color={totalColor}
              sub={`${formatBRL(result.openDebtMinor + result.futureInstallmentsMinor)} em dívidas`}
              height={10}
            />
            <PressureBar
              label="Somente dívida em aberto"
              pct={openPressurePct}
              color={pressureColor(openPressurePct)}
              sub={formatBRL(result.openDebtMinor)}
              height={8}
            />
            <PressureBar
              label="Parcelas futuras previstas"
              pct={futurePressurePct}
              color={pressureColor(futurePressurePct)}
              sub={formatBRL(result.futureInstallmentsMinor)}
              height={6}
            />
          </Card>

          {/* ---------------------------------------------------------------- */}
          {/* Três métricas principais                                          */}
          {/* ---------------------------------------------------------------- */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
            <Card>
              <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: 4 }}>Dívida em aberto</div>
              <div style={{ fontSize: '1.3rem', fontWeight: 800, color: result.openDebtMinor > 0 ? '#fbbf24' : '#4ade80' }}>
                {formatBRL(result.openDebtMinor)}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 4 }}>
                {result.openInvoiceCount} fatura(s) em aberto
              </div>
            </Card>
            <Card>
              <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: 4 }}>Parcelas futuras</div>
              <div style={{ fontSize: '1.3rem', fontWeight: 800, color: result.futureInstallmentsMinor > 0 ? '#fb923c' : '#4ade80' }}>
                {formatBRL(result.futureInstallmentsMinor)}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 4 }}>
                próximos {projectionMonths} {projectionMonths === 1 ? 'mês' : 'meses'}
              </div>
            </Card>
            <Card>
              <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: 4 }}>Pago este mês</div>
              <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#4ade80' }}>
                {formatBRL(result.paidThisMonthMinor)}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 4 }}>
                {result.invoiceCount} fatura(s) no total
              </div>
            </Card>
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* Pontualidade + Risco de atraso                                   */}
          {/* ---------------------------------------------------------------- */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
            <Card>
              <div style={{ fontSize: '0.78rem', color: '#9ca3af', marginBottom: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Pontualidade histórica
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                {/* Donut */}
                <div style={{ position: 'relative', width: 72, height: 72, flexShrink: 0 }}>
                  <svg width="72" height="72" viewBox="0 0 72 72">
                    <circle cx="36" cy="36" r="28" fill="none" stroke="#1e2130" strokeWidth="8" />
                    <circle cx="36" cy="36" r="28" fill="none"
                      stroke={result.punctualityPct >= 80 ? '#4ade80' : result.punctualityPct >= 60 ? '#fbbf24' : '#f87171'}
                      strokeWidth="8" strokeLinecap="round"
                      strokeDasharray={`${(result.punctualityPct / 100) * 175.9} 175.9`}
                      transform="rotate(-90 36 36)"
                    />
                  </svg>
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#e5e7eb' }}>{result.punctualityPct}%</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: result.punctualityPct >= 80 ? '#4ade80' : result.punctualityPct >= 60 ? '#fbbf24' : '#f87171' }}>
                    {result.punctualityPct >= 80 ? 'Ótima' : result.punctualityPct >= 60 ? 'Regular' : 'Baixa'}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 2 }}>
                    faturas pagas em dia
                  </div>
                </div>
              </div>
            </Card>
            <Card>
              <div style={{ fontSize: '0.78rem', color: '#9ca3af', marginBottom: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Risco de atraso
              </div>
              <div style={{ marginBottom: '0.5rem' }}>
                <Badge variant={riskVariant(ai?.delayRisk)}>
                  {ai?.delayRisk
                    ? ai.delayRisk.charAt(0).toUpperCase() + ai.delayRisk.slice(1)
                    : 'Não avaliado'}
                </Badge>
              </div>
              {ai?.delayRiskReason
                ? <p style={{ fontSize: '0.82rem', color: '#9ca3af', lineHeight: 1.5, margin: 0 }}>{ai.delayRiskReason}</p>
                : <p style={{ fontSize: '0.82rem', color: '#6b7280', margin: 0 }}>Clique em "Análise com IA" para ver a avaliação de risco.</p>
              }
            </Card>
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* Diagnóstico da IA                                                 */}
          {/* ---------------------------------------------------------------- */}
          {ai?.diagnosis && (
            <Card style={{ marginBottom: '1.5rem', borderLeft: '3px solid #6366f1' }}>
              <div style={{ fontSize: '0.78rem', color: '#6366f1', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Diagnóstico da IA
              </div>
              <p style={{ color: '#e5e7eb', fontSize: '0.9rem', lineHeight: 1.65, margin: 0 }}>{ai.diagnosis}</p>
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
                    <span style={{ color: '#fbbf24', flexShrink: 0, marginTop: 1 }}>⚠</span>{a}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* Faturas do mês                                                    */}
          {/* ---------------------------------------------------------------- */}
          {currentMonthInvoices.length > 0 && (
            <Card style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.88rem', color: '#e5e7eb', fontWeight: 700, marginBottom: '1rem' }}>
                Faturas de {selectedMonth}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {currentMonthInvoices.map((inv, i) => (
                  <InvoiceCard
                    key={`${inv.id}-${i}`}
                    card={inv.card}
                    brand={inv.brand}
                    last4={inv.last4}
                    openMinor={inv.effective?.openMinor ?? inv.openMinor ?? 0}
                    totalMinor={inv.totalMinor ?? 0}
                    paidMinor={inv.paidMinor ?? 0}
                    purchasesMinor={inv.purchasesMinor ?? 0}
                    previousMinor={inv.previousMinor ?? 0}
                    dueDate={inv.dueDate}
                    month={inv.month}
                  />
                ))}
              </div>
            </Card>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* Parcelas futuras por mês                                          */}
          {/* ---------------------------------------------------------------- */}
          {futureMonths.length > 0 && (
            <Card style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.88rem', color: '#e5e7eb', fontWeight: 700, marginBottom: '1rem' }}>
                Parcelas futuras — próximos {projectionMonths} {projectionMonths === 1 ? 'mês' : 'meses'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {futureMonths.map(month => {
                  const items = futureByMonth[month] ?? []
                  const total = items.reduce((s, it) => s + it.amountMinor, 0)
                  return (
                    <div key={month}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#9ca3af' }}>{shortMonth(month)}</span>
                        <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#fb923c' }}>{formatBRL(total)}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {items.map((it, i) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#9ca3af' }}>
                            <span>{it.description ?? 'Parcela'}{it.installment ? ` (${it.installment})` : ''}</span>
                            <span style={{ color: '#e5e7eb' }}>{formatBRL(it.amountMinor)}</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ height: 1, background: '#1e2130', marginTop: 8 }} />
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* Evolução mensal                                                   */}
          {/* ---------------------------------------------------------------- */}
          {visibleSeries.length > 0 && (
            <Card style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '0.88rem', color: '#e5e7eb', fontWeight: 700 }}>Evolução mensal</div>
                  <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>Despesas, compras no cartão e saldo por mês</div>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.75rem', color: '#9ca3af' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 99, background: '#f87171', display: 'inline-block' }} /> Gastos
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 99, background: '#fbbf24', display: 'inline-block' }} /> Cartão
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 99, background: '#4ade80', display: 'inline-block' }} /> Saldo
                  </span>
                </div>
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${Math.max(1, visibleSeries.length)}, minmax(60px, 1fr))`,
                gap: 12,
                alignItems: 'end',
                minHeight: 240,
              }}>
                {visibleSeries.map(row => {
                  const fixedAndStatement = (row.fixedExpensesMinor ?? 0) + (row.statementOutflowMinor ?? 0)
                  const fixedH = Math.max(6, Math.round((Math.abs(fixedAndStatement) / trendMax) * 160))
                  const cardH = Math.max(6, Math.round((Math.abs(row.cardPurchasesMinor) / trendMax) * 160))
                  const balMinor = row.balanceMinor ?? 0
                  const balH = Math.max(6, Math.round((Math.abs(balMinor) / trendMax) * 160))
                  const balColor = balMinor >= 0 ? '#4ade80' : '#f87171'
                  const isSelected = row.month === selectedMonth
                  return (
                    <div key={row.month} style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                      opacity: isSelected ? 1 : 0.65,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 180 }}>
                        <div title={`Gastos ${formatBRL(fixedAndStatement)}`}
                          style={{ width: 14, height: fixedH, borderRadius: 99, background: '#f87171' }} />
                        <div title={`Cartão ${row.cardPurchasesBRL}`}
                          style={{ width: 14, height: cardH, borderRadius: 99, background: '#fbbf24' }} />
                        <div title={`Saldo ${row.balanceBRL}`}
                          style={{ width: 14, height: balH, borderRadius: 99, background: balColor }} />
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.72rem', color: isSelected ? '#e5e7eb' : '#6b7280', fontWeight: isSelected ? 700 : 400 }}>
                          {shortMonth(row.month)}
                        </div>
                        <div style={{ fontSize: '0.68rem', color: balColor }}>{row.balanceBRL}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
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
                  <li key={i} style={{ fontSize: '0.88rem', color: '#e5e7eb', lineHeight: 1.55 }}>{r}</li>
                ))}
              </ol>
            </Card>
          )}

          {/* Prompt para análise IA quando ainda não foi feita */}
          {!ai?.diagnosis && (
            <div style={{ textAlign: 'center', marginTop: '0.5rem' }}>
              <p style={{ color: '#6b7280', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                Quer diagnóstico detalhado com risco de atraso e recomendações?
              </p>
              <Button
                onClick={loadDebt}
                disabled={loading}
                variant="primary"
              >
                🤖 Análise com IA
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

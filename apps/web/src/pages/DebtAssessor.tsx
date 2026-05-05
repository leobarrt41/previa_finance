/**
 * DebtAssessor.tsx — Avaliador de Dividas
 * API: POST /api/assess/debt
 */
import { useState } from 'react'
import {
  api, formatBRL, currentMonth, type DebtAssessResult,
} from '../services/api'
import { Card, Badge, Button, Alert, Spinner, SectionTitle } from '../components/ui'

function riskVariant(level?: string): 'green' | 'yellow' | 'red' | 'gray' {
  if (level === 'baixo') return 'green'
  if (level === 'moderado') return 'yellow'
  if (level === 'alto' || level === 'critico') return 'red'
  return 'gray'
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

export function DebtAssessor() {
  const [selectedMonth, setSelectedMonth] = useState(currentMonth())
  const [projectionMonths, setProjectionMonths] = useState(3)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DebtAssessResult | null>(null)

  async function handleAnalyze() {
    setLoading(true); setError(null)
    try {
      setResult(await api.assess.debt(selectedMonth, projectionMonths))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao avaliar dividas')
    } finally { setLoading(false) }
  }

  const ai = result?.ai
  const totalPressurePct = result?.debtPressurePct ?? 0
  const openPressurePct = result?.debtPressurePct ?? 0
  const pressureColor = totalPressurePct >= 40 ? '#f87171' : totalPressurePct >= 25 ? '#fbbf24' : '#4ade80'
  const consideredIncome = result?.consideredIncomeMinor ?? result?.incomeMinor ?? 0
  const selectedMonthIsCurrentOrFuture = selectedMonth >= currentMonth()
  const effectiveById = new Map((result?.invoicesSummary ?? []).map(inv => [inv.id, inv]))
  const currentMonthInvoices = (result?.cashflowInvoicesSummary ?? [])
    .filter(inv => inv.month === selectedMonth)
    .map(inv => ({
      ...inv,
      effective: effectiveById.get(inv.id),
    }))
  const debtTrendSeries = result?.debtTrendSeries ?? []
  const visibleDebtTrendSeries = debtTrendSeries.filter((row) =>
    (row.fixedExpensesMinor ?? 0) !== 0 ||
    (row.cardPurchasesMinor ?? 0) !== 0 ||
    (row.statementOutflowMinor ?? 0) !== 0 ||
    ((row.incomeMinor ?? 0) - (row.statementOutflowMinor ?? 0)) !== 0
  )
  const selectedTrendRow = debtTrendSeries.find((row) => row.month === selectedMonth) ?? debtTrendSeries[debtTrendSeries.length - 1] ?? null
  const selectedFixedExpensesMinor = selectedTrendRow?.fixedExpensesMinor ?? result?.fixedExpensesMinor ?? 0
  const selectedFixedExpensesBRL = selectedTrendRow?.fixedExpensesBRL ?? result?.fixedExpensesBRL ?? formatBRL(selectedFixedExpensesMinor)
  const selectedCardPurchasesMinor = selectedTrendRow?.cardPurchasesMinor ?? result?.cardPurchasesMinor ?? 0
  const selectedCardPurchasesBRL = selectedTrendRow?.cardPurchasesBRL ?? result?.cardPurchasesBRL ?? formatBRL(selectedCardPurchasesMinor)
  const selectedStatementOutflowMinor = selectedTrendRow?.statementOutflowMinor ?? result?.statementOutflowMinor ?? 0
  const selectedStatementOutflowBRL = selectedTrendRow?.statementOutflowBRL ?? result?.statementOutflowBRL ?? formatBRL(selectedStatementOutflowMinor)
  const selectedIncomeMinor = selectedTrendRow?.incomeMinor ?? result?.consideredIncomeMinor ?? result?.incomeMinor ?? 0
  const selectedFixedExpensesAndStatementMinor = selectedFixedExpensesMinor + selectedStatementOutflowMinor
  const selectedFixedExpensesAndStatementBRL = formatBRL(selectedFixedExpensesAndStatementMinor)
  const selectedNetBalanceMinor = selectedTrendRow?.balanceMinor ?? result?.netBalanceMinor ?? (selectedIncomeMinor - selectedStatementOutflowMinor)
  const selectedNetBalanceBRL = selectedTrendRow?.balanceBRL ?? result?.netBalanceBRL ?? formatBRL(selectedNetBalanceMinor)
  const balanceColor = selectedNetBalanceMinor >= 0 ? '#4ade80' : '#f87171'
  const trendMax = Math.max(
    1,
    ...visibleDebtTrendSeries.flatMap((row) => [
      Math.abs((row.fixedExpensesMinor ?? 0) + (row.statementOutflowMinor ?? 0)),
      Math.abs(row.cardPurchasesMinor ?? 0),
      Math.abs(row.balanceMinor ?? 0),
    ]),
  )

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <SectionTitle>Avaliador de Dividas</SectionTitle>
      <p style={{ color: '#9ca3af', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        Analise faturas, saldo em aberto, parcelas futuras e o impacto no seu caixa.
      </p>

      <Card style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#9ca3af', marginBottom: 4 }}>Mes de referencia</label>
            <select
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
            style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.55rem 0.85rem', color: '#e5e7eb', fontSize: '0.9rem', width: '100%' }}
          >
            {buildMonthOptions().map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#9ca3af', marginBottom: 4 }}>Projecao (meses)</label>
            <select
            value={String(projectionMonths)}
            onChange={e => setProjectionMonths(Number(e.target.value))}
            style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.55rem 0.85rem', color: '#e5e7eb', fontSize: '0.9rem', width: '100%' }}
          >
            {[1,2,3,4,5,6].map(n => <option key={n} value={String(n)}>{n}{n === 1 ? ' mes' : ' meses'}</option>)}
          </select>
          </div>
          <Button onClick={handleAnalyze} disabled={loading} variant="primary">
            {loading ? 'Analisando...' : '🤖 Avaliar'}
          </Button>
        </div>
      </Card>

      {error && <Alert variant="error" style={{ marginBottom: '1rem' }}>{error}</Alert>}
      {loading && (
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <Spinner />
          <p style={{ color: '#9ca3af', marginTop: '1rem' }}>Analisando dividas e faturas...</p>
        </div>
      )}

      {result && !loading && (
        <>
          {/* Resumo principal */}
          <Card style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: 6 }}>Saldo real</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: balanceColor }}>{selectedNetBalanceBRL}</div>
            <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: 4 }}>
              Renda {formatBRL(consideredIncome)} • Saídas do extrato {selectedStatementOutflowBRL} • Compras no cartão {selectedCardPurchasesBRL}
            </div>
          </Card>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
            <Card>
              <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: 4 }}>Despesas fixas/gastos</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f87171' }}>{selectedFixedExpensesAndStatementBRL}</div>
              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 2 }}>
                Fixas {selectedFixedExpensesBRL} • Extrato {selectedStatementOutflowBRL}
              </div>
            </Card>
            <Card>
              <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: 4 }}>Compras no cartão do mês</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#fbbf24' }}>{selectedCardPurchasesBRL}</div>
              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 2 }}>
                Compras da competência ainda não conciliadas
              </div>
            </Card>
            <Card>
              <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: 4 }}>Dívida em aberto</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#fbbf24' }}>{formatBRL(result.openDebtMinor)}</div>
              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 2 }}>
                {formatBRL(result.futureInstallmentsMinor)} em parcelas futuras
              </div>
            </Card>
          </div>

          {/* Barras de pressao */}
          <Card style={{ marginBottom: '1.5rem' }}>
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: '0.85rem', color: '#9ca3af' }}>Pressao total sobre a renda</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: pressureColor }}>{totalPressurePct.toFixed(1)}%</span>
              </div>
              <div style={{ background: '#1e2130', borderRadius: 4, height: 12 }}>
                <div style={{ background: pressureColor, borderRadius: 4, height: 12, width: Math.min(100, totalPressurePct) + '%' }} />
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: '0.85rem', color: '#9ca3af' }}>Somente em aberto</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fbbf24' }}>{openPressurePct.toFixed(1)}%</span>
              </div>
              <div style={{ background: '#1e2130', borderRadius: 4, height: 8 }}>
                <div style={{ background: '#fbbf24', borderRadius: 4, height: 8, width: Math.min(100, openPressurePct) + '%' }} />
              </div>
            </div>
          </Card>

          {/* Pontualidade + Risco */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
            <Card>
              <div style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: 8 }}>Pontualidade historica</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ position: 'relative', width: 80, height: 80 }}>
                  <svg width="80" height="80" viewBox="0 0 80 80">
                    <circle cx="40" cy="40" r="32" fill="none" stroke="#1e2130" strokeWidth="8" />
                    <circle cx="40" cy="40" r="32" fill="none"
                      stroke={result.punctualityPct >= 80 ? '#4ade80' : result.punctualityPct >= 60 ? '#fbbf24' : '#f87171'}
                      strokeWidth="8" strokeLinecap="round"
                      strokeDasharray={`${(result.punctualityPct / 100) * 201} 201`}
                      transform="rotate(-90 40 40)" />
                  </svg>
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#e5e7eb' }}>{result.punctualityPct}%</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#e5e7eb' }}>Em dia</div>
                  <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 2 }}>nos ultimos meses</div>
                </div>
              </div>
            </Card>
            <Card>
              <div style={{ fontSize: '0.8rem', color: '#9ca3af', marginBottom: 8 }}>Risco de atraso</div>
              <div style={{ marginBottom: 8 }}>
                <Badge variant={riskVariant(ai?.delayRisk)}>
                  {ai?.delayRisk ? ai.delayRisk.charAt(0).toUpperCase() + ai.delayRisk.slice(1) : '—'}
                </Badge>
              </div>
              {ai?.delayRiskReason && <p style={{ fontSize: '0.82rem', color: '#9ca3af', lineHeight: 1.5, margin: 0 }}>{ai.delayRiskReason}</p>}
            </Card>
          </div>

          {/* Faturas do mês atual */}
          <Card style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontSize: '0.85rem', color: '#e5e7eb', marginBottom: '0.75rem', fontWeight: 700 }}>
              Compras e saldos da competência ({selectedMonth}):
            </div>
            {currentMonthInvoices.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <div style={{ minWidth: 760 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '2.4fr 1.2fr 1.2fr 1.2fr 1.2fr', gap: 12, padding: '0 1rem 0.5rem 1rem', color: '#8ea2ff', fontSize: '0.9rem', fontWeight: 700 }}>
                    <div>Cartão</div>
                    <div>Total da fatura anterior</div>
                    <div>Pago na fatura anterior</div>
                    <div>Compras do mês</div>
                    <div>Total da fatura</div>
                  </div>
                  <div style={{ borderTop: '1px solid #1e2130' }} />
                  {currentMonthInvoices.map((inv, i) => (
                    <div key={`${inv.id}-${i}`} style={{ display: 'grid', gridTemplateColumns: '2.4fr 1.2fr 1.2fr 1.2fr 1.2fr', gap: 12, padding: '0.65rem 1rem', alignItems: 'center', borderBottom: i === currentMonthInvoices.length - 1 ? 'none' : '1px solid #1e2130' }}>
                      <div>
                        <div style={{ fontSize: '0.9rem', color: '#e5e7eb', fontWeight: 600 }}>{inv.card ?? 'Cartão'}</div>
                        <div style={{ fontSize: '0.72rem', color: (selectedMonthIsCurrentOrFuture ? (inv.totalMinor ?? 0) : (inv.effective?.openMinor ?? inv.openMinor)) > 0 ? '#fbbf24' : '#4ade80' }}>
                          {(selectedMonthIsCurrentOrFuture ? (inv.totalMinor ?? 0) : (inv.effective?.openMinor ?? inv.openMinor)) > 0 ? 'Em aberto' : 'Pago'}{inv.dueDate ? ` • Competência ${inv.month}` : ''}
                        </div>
                      </div>
                      <div style={{ color: '#fbbf24', fontWeight: 700 }}>{formatBRL(inv.previousMinor ?? 0)}</div>
                      <div style={{ color: '#4ade80', fontWeight: 700 }}>{formatBRL(inv.paidMinor ?? 0)}</div>
                      <div style={{ color: '#fbbf24', fontWeight: 700 }}>{formatBRL(inv.purchasesMinor ?? 0)}</div>
                      <div style={{ color: '#fbbf24', fontWeight: 700 }}>{formatBRL(inv.totalMinor ?? 0)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ color: '#9ca3af', fontSize: '0.9rem', padding: '0.5rem 0' }}>
                Nenhuma fatura encontrada para este mês.
              </div>
            )}
          </Card>

          {/* Diagnostico IA */}
          {ai?.diagnosis && (
            <Card style={{ marginBottom: '1.5rem', borderLeft: '3px solid #6366f1' }}>
              <div style={{ fontSize: '0.8rem', color: '#6366f1', marginBottom: 6, fontWeight: 600 }}>🤖 Diagnostico</div>
              <p style={{ color: '#e5e7eb', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }}>{ai.diagnosis}</p>
            </Card>
          )}

          {/* Alertas */}
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

          {/* Recomendacoes */}
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

          <Card style={{ marginTop: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '0.85rem', color: '#e5e7eb', fontWeight: 700 }}>Evolução mensal</div>
                <div style={{ fontSize: '0.76rem', color: '#9ca3af' }}>Compare despesas fixas, faturas e saldo por competência.</div>
              </div>
              <div style={{ display: 'flex', gap: '0.9rem', flexWrap: 'wrap', fontSize: '0.78rem', color: '#9ca3af' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 999, background: '#f87171' }} /> Despesas fixas/gastos</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 999, background: '#fbbf24' }} /> Compras no cartão</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: 999, background: '#4ade80' }} /> Saldo final</span>
              </div>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${Math.max(1, debtTrendSeries.length)}, minmax(72px, 1fr))`,
                gap: 14,
                alignItems: 'end',
                minHeight: 280,
                paddingTop: 8,
              }}
            >
              {visibleDebtTrendSeries.length > 0 ? visibleDebtTrendSeries.map((row) => {
                const fixedAndStatementMinor = (row.fixedExpensesMinor ?? 0) + (row.statementOutflowMinor ?? 0)
                const fixedHeight = Math.max(8, Math.round((Math.abs(fixedAndStatementMinor) / trendMax) * 180))
                const cardHeight = Math.max(8, Math.round((Math.abs(row.cardPurchasesMinor) / trendMax) * 180))
                const balanceMinor = row.balanceMinor ?? (row.incomeMinor ?? 0) - (row.statementOutflowMinor ?? 0)
                const balanceBRL = row.balanceBRL ?? formatBRL(balanceMinor)
                const balanceHeight = Math.max(8, Math.round((Math.abs(balanceMinor) / trendMax) * 180))
                const balanceBarColor = balanceMinor >= 0 ? '#4ade80' : '#f87171'
                return (
                  <div key={row.month} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'end', gap: 8, height: 200, width: '100%', justifyContent: 'center' }}>
                      <div title={`Despesas fixas/gastos ${formatBRL(fixedAndStatementMinor)}`} style={{ width: 18, height: fixedHeight, borderRadius: 999, background: '#f87171' }} />
                      <div title={`Compras no cartão ${row.cardPurchasesBRL}`} style={{ width: 18, height: cardHeight, borderRadius: 999, background: '#fbbf24' }} />
                      <div title={`Saldo real ${balanceBRL}`} style={{ width: 18, height: balanceHeight, borderRadius: 999, background: balanceBarColor }} />
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '0.75rem', color: '#e5e7eb', fontWeight: 700 }}>{row.month}</div>
                      <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>{balanceBRL}</div>
                    </div>
                  </div>
                )
              }) : (
                <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: '#9ca3af', fontSize: '0.9rem', padding: '2rem 0' }}>
                  Nenhum mês com dados para exibir no gráfico.
                </div>
              )}
            </div>
          </Card>
        </>
      )}

      {!result && !loading && (
        <Card style={{ textAlign: 'center', padding: '3rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>💳</div>
          <p style={{ color: '#9ca3af' }}>Clique em <strong style={{ color: '#6366f1' }}>Avaliar</strong> para analisar suas dividas e faturas.</p>
        </Card>
      )}
    </div>
  )
}

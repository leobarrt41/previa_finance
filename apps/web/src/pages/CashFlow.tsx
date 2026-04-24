/**
 * CashFlow.tsx — Tela de Projecção de CashFlow
 *
 * Contrato de API: POST /api/cashflow/projection
 * Payload e response mapeados directamente de apps/api/src/routes/cashflow.ts
 *
 * v2: adicionado suporte a Forecasts (recorrência: one-time | monthly | yearly)
 */
import { useState, useCallback } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import {
  api,
  formatBRL,
  buildMonthRange,
  currentMonth,
  type CashFlowTransaction,
  type CashFlowCardInvoice,
  type CashFlowForecast,
  type MonthlyCashFlow,
  type CashFlowResponse,
} from '../services/api'
import { useAsync } from '../hooks/useAsync'
import {
  Card,
  Badge,
  Button,
  Input,
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

function toChartData(monthly: MonthlyCashFlow[]) {
  return monthly.map((m) => ({
    month: m.competencyMonth,
    saldo: Number(m.projectedClosingBalanceMinor) / 100,
    receita: Number(m.totalIncomeMinor) / 100,
    despesa: Number(m.totalExpenseMinor) / 100,
    divida: Number(m.debtOpenMinor) / 100,
  }))
}

function statusVariant(value: number): 'green' | 'red' | 'yellow' {
  if (value > 0) return 'green'
  if (value < 0) return 'red'
  return 'yellow'
}

const recurrenceLabel: Record<string, string> = {
  'one-time': 'Única',
  'monthly': 'Mensal',
  'yearly': 'Anual',
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function TransactionRow({ tx, onRemove }: { tx: CashFlowTransaction; onRemove: () => void }) {
  const isIncome = tx.type === 'income'
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid #1e2130', fontSize: '0.85rem' }}>
      <div>
        <span style={{ color: '#e5e7eb' }}>{tx.description}</span>
        <span style={{ color: '#4b5563', marginLeft: 8 }}>{tx.competencyMonth}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: isIncome ? '#4ade80' : '#f87171', fontWeight: 600 }}>
          {isIncome ? '+' : '-'} {formatBRL(tx.amountMinor)}
        </span>
        <button onClick={onRemove} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '1rem' }}>×</button>
      </div>
    </div>
  )
}

function InvoiceRow({ inv, onRemove }: { inv: CashFlowCardInvoice; onRemove: () => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid #1e2130', fontSize: '0.85rem' }}>
      <div>
        <span style={{ color: '#e5e7eb' }}>Fatura {inv.competencyMonth}</span>
        <span style={{ color: '#4b5563', marginLeft: 8 }}>→ vence {inv.dueMonth}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: '#fbbf24', fontWeight: 600 }}>{formatBRL(inv.amountMinor)}</span>
        <button onClick={onRemove} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '1rem' }}>×</button>
      </div>
    </div>
  )
}

function ForecastRow({ fc, onRemove }: { fc: CashFlowForecast; onRemove: () => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0', borderBottom: '1px solid #1e2130', fontSize: '0.85rem' }}>
      <div>
        <span style={{ color: '#e5e7eb' }}>{fc.description || '—'}</span>
        <span style={{ color: '#4b5563', marginLeft: 8 }}>{fc.competencyMonth}</span>
        {fc.recurrenceEnd && (
          <span style={{ color: '#4b5563', marginLeft: 4 }}>→ {fc.recurrenceEnd}</span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Badge variant="blue">{recurrenceLabel[fc.recurrence ?? 'one-time']}</Badge>
        <span style={{ color: '#a78bfa', fontWeight: 600 }}>{formatBRL(fc.amountMinor)}</span>
        <button onClick={onRemove} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '1rem' }}>×</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Collapsible section
// ---------------------------------------------------------------------------
function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <Card>
      <button
        onClick={() => setOpen((p) => !p)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left', padding: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <SectionTitle style={{ margin: 0 }}>{title}</SectionTitle>
        <span style={{ color: '#6b7280', fontSize: '0.8rem' }}>
          {count > 0 && <Badge variant="gray">{count}</Badge>} {open ? '▾' : '▸'}
        </span>
      </button>
      {open && <div style={{ marginTop: '0.75rem' }}>{children}</div>}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export function CashFlow() {
  const now = currentMonth()

  // Base params
  const [startMonth, setStartMonth] = useState(now)
  const [months, setMonths] = useState('6')
  const [openingBalance, setOpeningBalance] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Transaction form
  const [txDesc, setTxDesc] = useState('')
  const [txAmount, setTxAmount] = useState('')
  const [txMonth, setTxMonth] = useState(now)
  const [txType, setTxType] = useState<'income' | 'expense'>('income')
  const [transactions, setTransactions] = useState<CashFlowTransaction[]>([])

  // Invoice form
  const [invMonth, setInvMonth] = useState(now)
  const [invDue, setInvDue] = useState('')
  const [invAmount, setInvAmount] = useState('')
  const [invoices, setInvoices] = useState<CashFlowCardInvoice[]>([])

  // Forecast form
  const [fcDesc, setFcDesc] = useState('')
  const [fcAmount, setFcAmount] = useState('')
  const [fcMonth, setFcMonth] = useState(now)
  const [fcRecurrence, setFcRecurrence] = useState<'one-time' | 'monthly' | 'yearly'>('monthly')
  const [fcEnd, setFcEnd] = useState('')
  const [forecasts, setForecasts] = useState<CashFlowForecast[]>([])

  const projectFn = useCallback(
    (body: Parameters<typeof api.cashflow.project>[0]) => api.cashflow.project(body),
    [],
  )
  const { state, execute } = useAsync<Parameters<typeof api.cashflow.project>[0], CashFlowResponse>(projectFn)

  // Validation
  function validate(): boolean {
    const e: Record<string, string> = {}
    if (!startMonth.match(/^\d{4}-\d{2}$/)) e.startMonth = 'Formato YYYY-MM'
    const m = parseInt(months)
    if (isNaN(m) || m < 1 || m > 24) e.months = 'Entre 1 e 24 meses'
    if (openingBalance === '') e.openingBalance = 'Informe o saldo inicial'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function addTransaction() {
    if (!txDesc.trim() || !txAmount) return
    setTransactions((prev) => [
      ...prev,
      { id: `tx-${Date.now()}`, competencyMonth: txMonth, amountMinor: minor(txAmount), type: txType, description: txDesc },
    ])
    setTxDesc('')
    setTxAmount('')
  }

  function addInvoice() {
    if (!invAmount || !invDue) return
    setInvoices((prev) => [
      ...prev,
      { id: `inv-${Date.now()}`, competencyMonth: invMonth, dueMonth: invDue, amountMinor: minor(invAmount), paidMinor: 0 },
    ])
    setInvAmount('')
    setInvDue('')
  }

  function addForecast() {
    if (!fcAmount) return
    setForecasts((prev) => [
      ...prev,
      {
        id: `fc-${Date.now()}`,
        competencyMonth: fcMonth,
        amountMinor: minor(fcAmount),
        recurrence: fcRecurrence,
        recurrenceEnd: fcEnd || null,
        description: fcDesc || undefined,
        isActive: true,
      },
    ])
    setFcDesc('')
    setFcAmount('')
    setFcEnd('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    void buildMonthRange(startMonth, parseInt(months))
    execute({
      startMonth,
      months: parseInt(months),
      openingBalanceMinor: minor(openingBalance),
      transactions,
      cardInvoices: invoices,
      forecasts,
    })
  }

  const chartData = state.status === 'success' ? toChartData(state.data.monthly) : []

  return (
    <div style={{ maxWidth: 1020 }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#e5e7eb', margin: 0 }}>
          📈 Projecção de CashFlow
        </h1>
        <p style={{ color: '#6b7280', marginTop: '0.3rem', fontSize: '0.85rem' }}>
          Visualize seu saldo mês a mês. Compra no cartão é dívida — o pagamento da fatura afecta o caixa.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1.5rem', alignItems: 'start' }}>
        {/* Left: Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Parâmetros base */}
          <Card>
            <SectionTitle>Parâmetros</SectionTitle>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <Input label="Mês inicial (YYYY-MM)" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} placeholder="2026-05" error={errors.startMonth} />
              <Input label="Meses a projectar" type="number" min={1} max={24} value={months} onChange={(e) => setMonths(e.target.value)} error={errors.months} />
              <Input label="Saldo inicial (R$)" type="number" step="0.01" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} placeholder="1000.00" error={errors.openingBalance} />
              <Button type="submit" fullWidth disabled={state.status === 'loading'}>
                {state.status === 'loading' ? 'Calculando...' : 'Calcular projecção'}
              </Button>
            </form>
          </Card>

          {/* Transacções */}
          <Section title="Transacções" count={transactions.length}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <select value={txType} onChange={(e) => setTxType(e.target.value as 'income' | 'expense')} style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem' }}>
                  <option value="income">Receita</option>
                  <option value="expense">Despesa</option>
                </select>
                <input value={txMonth} onChange={(e) => setTxMonth(e.target.value)} placeholder="YYYY-MM" style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', width: 90 }} />
              </div>
              <input value={txDesc} onChange={(e) => setTxDesc(e.target.value)} placeholder="Descrição (ex: Salário)" style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input value={txAmount} onChange={(e) => setTxAmount(e.target.value)} type="number" step="0.01" placeholder="Valor (R$)" style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', flex: 1 }} />
                <Button onClick={addTransaction} variant="secondary">+ Add</Button>
              </div>
            </div>
            {transactions.length === 0
              ? <EmptyState icon="💸" title="Nenhuma transacção" description="Adicione receitas e despesas acima." />
              : transactions.map((tx, i) => <TransactionRow key={tx.id} tx={tx} onRemove={() => setTransactions((p) => p.filter((_, j) => j !== i))} />)
            }
          </Section>

          {/* Faturas */}
          <Section title="Faturas de cartão" count={invoices.length}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input value={invMonth} onChange={(e) => setInvMonth(e.target.value)} placeholder="Mês compra" style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', flex: 1 }} />
                <input value={invDue} onChange={(e) => setInvDue(e.target.value)} placeholder="Mês vencimento" style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', flex: 1 }} />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input value={invAmount} onChange={(e) => setInvAmount(e.target.value)} type="number" step="0.01" placeholder="Total fatura (R$)" style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', flex: 1 }} />
                <Button onClick={addInvoice} variant="secondary">+ Add</Button>
              </div>
            </div>
            {invoices.length === 0
              ? <EmptyState icon="💳" title="Nenhuma fatura" description="Adicione faturas de cartão acima." />
              : invoices.map((inv, i) => <InvoiceRow key={inv.id} inv={inv} onRemove={() => setInvoices((p) => p.filter((_, j) => j !== i))} />)
            }
          </Section>

          {/* Forecasts */}
          <Section title="Previsões recorrentes" count={forecasts.length}>
            <div
              style={{
                padding: '0.6rem 0.75rem',
                background: '#1a2a3a',
                borderLeft: '3px solid #6366f1',
                borderRadius: '0 8px 8px 0',
                fontSize: '0.78rem',
                color: '#93c5fd',
                marginBottom: '0.75rem',
              }}
            >
              Previsões são projecções futuras (ex: salário mensal, IPTU anual). Podem ser substituídas por dados reais quando confirmados.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '0.75rem' }}>
              <input
                value={fcDesc}
                onChange={(e) => setFcDesc(e.target.value)}
                placeholder="Descrição (ex: Salário mensal)"
                style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  value={fcMonth}
                  onChange={(e) => setFcMonth(e.target.value)}
                  placeholder="Mês início"
                  style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', flex: 1 }}
                />
                <select
                  value={fcRecurrence}
                  onChange={(e) => setFcRecurrence(e.target.value as 'one-time' | 'monthly' | 'yearly')}
                  style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem' }}
                >
                  <option value="one-time">Única</option>
                  <option value="monthly">Mensal</option>
                  <option value="yearly">Anual</option>
                </select>
              </div>
              {fcRecurrence !== 'one-time' && (
                <input
                  value={fcEnd}
                  onChange={(e) => setFcEnd(e.target.value)}
                  placeholder="Mês fim (opcional, YYYY-MM)"
                  style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', width: '100%', boxSizing: 'border-box' }}
                />
              )}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  value={fcAmount}
                  onChange={(e) => setFcAmount(e.target.value)}
                  type="number"
                  step="0.01"
                  placeholder="Valor (R$)"
                  style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', flex: 1 }}
                />
                <Button onClick={addForecast} variant="secondary">+ Add</Button>
              </div>
            </div>
            {forecasts.length === 0
              ? <EmptyState icon="🔮" title="Nenhuma previsão" description="Adicione receitas ou despesas recorrentes futuras." />
              : forecasts.map((fc, i) => <ForecastRow key={fc.id} fc={fc} onRemove={() => setForecasts((p) => p.filter((_, j) => j !== i))} />)
            }
          </Section>
        </div>

        {/* Right: Results */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {state.status === 'idle' && (
            <EmptyState icon="📊" title="Preencha os parâmetros e calcule" description="O resultado aparecerá aqui com gráfico e tabela mensal." />
          )}

          {state.status === 'loading' && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
              <Spinner size={40} />
            </div>
          )}

          {state.status === 'error' && (
            <Alert variant="error"><strong>Erro:</strong> {state.message}</Alert>
          )}

          {state.status === 'success' && (
            <>
              {/* Summary cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
                {[
                  { label: 'Saldo final', value: Number(state.data.monthly[state.data.monthly.length - 1]?.projectedClosingBalanceMinor ?? 0), color: Number(state.data.monthly[state.data.monthly.length - 1]?.projectedClosingBalanceMinor ?? 0) >= 0 ? '#4ade80' : '#f87171' },
                  { label: 'Total receitas', value: state.data.monthly.reduce((s, m) => s + Number(m.totalIncomeMinor), 0), color: '#4ade80' },
                  { label: 'Total despesas', value: state.data.monthly.reduce((s, m) => s + Number(m.totalExpenseMinor), 0), color: '#f87171' },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 10, padding: '0.75rem', textAlign: 'center' }}>
                    <p style={{ fontSize: '0.72rem', color: '#6b7280', marginBottom: 4 }}>{label}</p>
                    <p style={{ fontSize: '1rem', fontWeight: 800, color }}>{formatBRL(value)}</p>
                  </div>
                ))}
              </div>

              {/* Chart */}
              <Card>
                <SectionTitle>Saldo projectado</SectionTitle>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradSaldo" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e2130" />
                    <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ background: '#1e2130', border: '1px solid #2a2f45', borderRadius: 8 }}
                      labelStyle={{ color: '#9ca3af' }}
                      formatter={(v) => [formatBRL(Number(v ?? 0) * 100), 'Saldo']}
                    />
                    <ReferenceLine y={0} stroke="#f87171" strokeDasharray="4 2" />
                    <Area type="monotone" dataKey="saldo" stroke="#6366f1" strokeWidth={2} fill="url(#gradSaldo)" />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>

              {/* Monthly table */}
              <Card>
                <SectionTitle>Detalhe mensal</SectionTitle>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ color: '#6b7280', borderBottom: '1px solid #2a2f45' }}>
                        <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem' }}>Mês</th>
                        <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem' }}>Receita</th>
                        <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem' }}>Despesa</th>
                        <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem' }}>Saldo final</th>
                        <th style={{ textAlign: 'center', padding: '0.4rem 0.5rem' }}>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.data.monthly.map((m) => {
                        const closing = Number(m.projectedClosingBalanceMinor)
                        return (
                          <tr key={m.competencyMonth} style={{ borderBottom: '1px solid #1e2130' }}>
                            <td style={{ padding: '0.45rem 0.5rem', color: '#e5e7eb', fontWeight: 600 }}>{m.competencyMonth}</td>
                            <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right', color: '#4ade80' }}>{formatBRL(m.totalIncomeMinor)}</td>
                            <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right', color: '#f87171' }}>{formatBRL(m.totalExpenseMinor)}</td>
                            <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right', fontWeight: 700, color: closing >= 0 ? '#4ade80' : '#f87171' }}>
                              {formatBRL(m.projectedClosingBalanceMinor)}
                            </td>
                            <td style={{ padding: '0.45rem 0.5rem', textAlign: 'center' }}>
                              <Badge variant={statusVariant(closing)}>
                                {closing > 0 ? 'Positivo' : closing < 0 ? 'Negativo' : 'Zero'}
                              </Badge>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

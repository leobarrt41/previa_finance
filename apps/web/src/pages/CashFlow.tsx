/**
 * CashFlow.tsx — Tela de Projeção de Fluxo de caixa
 *
 * Contrato de API: POST /api/cashflow/projection
 * Payload e response mapeados directamente de apps/api/src/routes/cashflow.ts
 *
 * v2: adicionado suporte a Forecasts (recorrência: one-time | monthly | yearly)
 */
import { useState, useCallback, useEffect } from 'react'
import {
  ComposedChart,
  Bar,
  Line,
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
  type CashFlowRecurringTransaction,
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

function sumPendingRecurringExpenseMinor(recurring: CashFlowRecurringTransaction[], month: string): number {
  return recurring.reduce((sum, forecast) => {
    if (forecast.amountMinor >= 0) return sum
    if (!forecast.isActive) return sum
    if (!appliesRecurringOnMonth(forecast, month)) return sum
    if (forecast.paidMonths.includes(month)) return sum
    return sum + Math.abs(forecast.amountMinor)
  }, 0)
}

function toChartData(
  monthly: MonthlyCashFlow[],
  recurring: CashFlowRecurringTransaction[],
  cardTotalsByMonth = new Map<string, number>(),
) {
  const activeMonth = currentMonth()

  return monthly.map((m) => {
    const pendingRecurringExpenseMinor = sumPendingRecurringExpenseMinor(recurring, m.competencyMonth)
    const statementOutflowMinor = Number(m.statementOutflowMinor ?? 0)
    const cardTotalMinor = cardTotalsByMonth.get(m.competencyMonth) ?? Number(m.debtOpenMinor)
    const orangeMinor = m.competencyMonth < activeMonth ? 0 : cardTotalMinor

    return {
      month: m.competencyMonth,
      saldo: Number(m.projectedClosingBalanceMinor) / 100,
      recebido: Number(m.totalIncomeMinor) / 100,
      pago: statementOutflowMinor / 100,
      previsto: pendingRecurringExpenseMinor / 100,
      cartaoProjetado: orangeMinor / 100,
    }
  })
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

function recurringTypeFromAmount(amountMinor: number): 'income' | 'expense' {
  return amountMinor >= 0 ? 'income' : 'expense'
}

function appliesRecurringOnMonth(fc: CashFlowRecurringTransaction, month: string): boolean {
  if (month < fc.competencyMonth) return false
  if (fc.recurrenceEnd && month > fc.recurrenceEnd) return false

  const recurrence = fc.recurrence ?? 'one-time'
  if (recurrence === 'one-time') return month === fc.competencyMonth
  if (recurrence === 'monthly') return true
  if (recurrence === 'yearly') return month.slice(5) === fc.competencyMonth.slice(5)
  return false
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function TransactionRow({
  tx,
  onRemove,
  onEdit,
}: {
  tx: CashFlowTransaction
  onRemove: () => void
  onEdit: () => void
}) {
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
        <button onClick={onEdit} style={{ background: 'none', border: 'none', color: '#93c5fd', cursor: 'pointer', fontSize: '0.8rem' }}>editar</button>
        <button onClick={onRemove} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '1rem' }}>×</button>
      </div>
    </div>
  )
}

function ForecastRow({
  fc,
  onRemove,
  onEdit,
}: {
  fc: CashFlowRecurringTransaction
  onRemove: () => void
  onEdit: () => void
}) {
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
        {!fc.isActive && <Badge variant="yellow">Inativa</Badge>}
        <Badge variant="blue">{recurrenceLabel[fc.recurrence ?? 'one-time']}</Badge>
        <span style={{ color: fc.amountMinor >= 0 ? '#4ade80' : '#f87171', fontWeight: 600 }}>{formatBRL(fc.amountMinor)}</span>
        <button onClick={onEdit} style={{ background: 'none', border: 'none', color: '#93c5fd', cursor: 'pointer', fontSize: '0.8rem' }}>editar</button>
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
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Transaction form
  const [txDesc, setTxDesc] = useState('')
  const [txAmount, setTxAmount] = useState('')
  const [txMonth, setTxMonth] = useState(now)
  const [txType, setTxType] = useState<'income' | 'expense'>('income')
  const [transactions, setTransactions] = useState<CashFlowTransaction[]>(() => loadManualProjections())
  const [txEditId, setTxEditId] = useState<string | null>(null)

  // Forecast form
  const [fcDesc, setFcDesc] = useState('')
  const [fcType, setFcType] = useState<'income' | 'expense'>('expense')
  const [fcAmount, setFcAmount] = useState('')
  const [fcMonth, setFcMonth] = useState(now)
  const [fcRecurrence, setFcRecurrence] = useState<'one-time' | 'monthly' | 'yearly'>('monthly')
  const [fcEnd, setFcEnd] = useState('')
  const [fcEditId, setFcEditId] = useState<string | null>(null)
  const [recurring, setRecurring] = useState<CashFlowRecurringTransaction[]>([])
  const [recurringLoading, setRecurringLoading] = useState(false)
  const [recurringError, setRecurringError] = useState<string | null>(null)
  const [recurringSaving, setRecurringSaving] = useState(false)

  const projectFn = useCallback(
    (body: Parameters<typeof api.cashflow.project>[0]) => api.cashflow.project(body),
    [],
  )
  const { state, execute } = useAsync<Parameters<typeof api.cashflow.project>[0], CashFlowResponse>(projectFn)

  const loadRecurring = useCallback(async () => {
    setRecurringLoading(true)
    setRecurringError(null)
    try {
      const res = await api.cashflow.listRecurringTransactions()
      setRecurring(res.items)
    } catch (err) {
      setRecurringError(err instanceof Error ? err.message : 'Falha ao carregar recorrentes')
    } finally {
      setRecurringLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRecurring()
  }, [loadRecurring])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(manualProjectionStorageKey, JSON.stringify(transactions))
  }, [transactions])

  const cardInvoicesByMonth = state.status === 'success' ? state.data.cardInvoicesByMonth ?? [] : []
  const currentCardInvoiceRows = cardInvoicesByMonth.filter((f) => f.invoiceMonth === startMonth)
  const cardTotalsByMonth = cardInvoicesByMonth.reduce((acc, row) => {
    const current = acc.get(row.invoiceMonth) ?? 0
    acc.set(row.invoiceMonth, current + Number(row.totalFaturaMinor || 0))
    return acc
  }, new Map<string, number>())
  // Validation
  function validate(): boolean {
    const e: Record<string, string> = {}
    if (!startMonth.match(/^\d{4}-\d{2}$/)) e.startMonth = 'Formato YYYY-MM'
    const m = parseInt(months)
    if (isNaN(m) || m < 1 || m > 24) e.months = 'Entre 1 e 24 meses'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function buildProjectionRequest() {
    return {
      startMonth,
      months: parseInt(months),
      openingBalanceMinor: 0,
      extraForecasts: transactions.map((tx) => ({
        id: tx.id,
        competencyMonth: tx.competencyMonth,
        amountMinor: tx.type === 'expense' ? -Math.abs(tx.amountMinor) : Math.abs(tx.amountMinor),
        recurrence: 'one-time' as const,
        description: tx.description,
        isActive: true,
      })),
    }
  }

  function saveTransaction() {
    if (!txDesc.trim() || !txAmount) return
    const nextTx: CashFlowTransaction = {
      id: txEditId ?? `tx-${Date.now()}`,
      competencyMonth: txMonth,
      amountMinor: minor(txAmount),
      type: txType,
      description: txDesc,
    }
    setTransactions((prev) => {
      if (!txEditId) return [...prev, nextTx]
      return prev.map((tx) => (tx.id === txEditId ? nextTx : tx))
    })
    setTxEditId(null)
    setTxDesc('')
    setTxAmount('')
    setTxMonth(now)
    setTxType('income')
  }

  function startEditTransaction(tx: CashFlowTransaction) {
    setTxEditId(tx.id)
    setTxDesc(tx.description)
    setTxAmount((Math.abs(tx.amountMinor) / 100).toFixed(2))
    setTxMonth(tx.competencyMonth)
    setTxType((tx.type === 'income' ? 'income' : 'expense'))
  }

  function cancelEditTransaction() {
    setTxEditId(null)
    setTxDesc('')
    setTxAmount('')
    setTxMonth(now)
    setTxType('income')
  }

  async function saveForecast() {
    if (!fcAmount) return
    setRecurringSaving(true)
    const payload = {
      competencyMonth: fcMonth,
      amountMinor: fcType === 'expense' ? -Math.abs(minor(fcAmount)) : Math.abs(minor(fcAmount)),
      recurrence: fcRecurrence,
      recurrenceEnd: fcEnd || null,
      description: fcDesc || undefined,
      isActive: true,
    }

    try {
      if (fcEditId) {
        await api.cashflow.updateRecurringTransaction(fcEditId, payload)
      } else {
        await api.cashflow.createRecurringTransaction(payload)
      }
      await loadRecurring()
      setFcEditId(null)
    } catch (err) {
      setRecurringError(err instanceof Error ? err.message : 'Falha ao salvar recorrente')
    } finally {
      setRecurringSaving(false)
    }

    setFcDesc('')
    setFcAmount('')
    setFcEnd('')
  }

  async function removeForecast(id: string) {
    try {
      await api.cashflow.deleteRecurringTransaction(id)
      await loadRecurring()
      if (fcEditId === id) {
        setFcEditId(null)
      }
    } catch (err) {
      setRecurringError(err instanceof Error ? err.message : 'Falha ao remover recorrente')
    }
  }

  function startEditForecast(fc: CashFlowRecurringTransaction) {
    setFcEditId(fc.id)
    setFcDesc(fc.description ?? '')
    setFcMonth(fc.competencyMonth)
    setFcRecurrence(fc.recurrence ?? 'monthly')
    setFcEnd(fc.recurrenceEnd ?? '')
    setFcType(recurringTypeFromAmount(fc.amountMinor))
    setFcAmount((Math.abs(fc.amountMinor) / 100).toFixed(2))
  }

  function cancelEditForecast() {
    setFcEditId(null)
    setFcDesc('')
    setFcAmount('')
    setFcEnd('')
  }

  async function setForecastPaidMonth(forecastId: string, month: string, isPaid: boolean) {
    try {
      await api.cashflow.setRecurringMonthStatus(forecastId, month, isPaid)
      await loadRecurring()
      execute(buildProjectionRequest())
    } catch (err) {
      setRecurringError(err instanceof Error ? err.message : 'Falha ao atualizar status mensal')
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return
    void buildMonthRange(startMonth, parseInt(months))
    execute(buildProjectionRequest())
  }

  const chartData =
    state.status === 'success'
      ? toChartData(state.data.monthly, recurring, cardTotalsByMonth)
      : []
  const recurringExpenseItems = recurring.filter((item) => item.amountMinor < 0)

  return (

    <div style={{ maxWidth: 1020 }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#e5e7eb', margin: 0 }}>
          📈 Projeção de Fluxo de caixa
        </h1>
        <p style={{ color: '#6b7280', marginTop: '0.3rem', fontSize: '0.85rem' }}>
          Visualize seu saldo mês a mês. Compra no cartão é dívida — o pagamento da fatura afecta o caixa.
        </p>
      </div>

      {/* Painel de faturas/cartões do mês atual */}
      {state.status === 'success' && state.data.cardInvoicesByMonth && (
        <div style={{
          background: '#181c2a',
          borderRadius: 8,
          padding: '1rem',
          marginBottom: '1.5rem',
          border: '1px solid #23263a',
        }}>
          <div style={{ fontWeight: 700, color: '#e5e7eb', marginBottom: 8 }}>Faturas do mês atual ({startMonth}):</div>
          {currentCardInvoiceRows.length === 0 ? (
            <div style={{ color: '#6b7280', fontSize: '0.95rem' }}>Nenhuma fatura encontrada para o mês.</div>
          ) : (
            <table style={{ width: '100%', fontSize: '0.97rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#a5b4fc', textAlign: 'left' }}>
                  <th style={{ padding: '4px 8px' }}>Cartão</th>
                  <th style={{ padding: '4px 8px' }}>Total da fatura anterior</th>
                  <th style={{ padding: '4px 8px' }}>Pago na fatura anterior</th>
                  <th style={{ padding: '4px 8px' }}>Compras do mês</th>
                  <th style={{ padding: '4px 8px' }}>Total da fatura</th>
                </tr>
              </thead>
              <tbody>
                {currentCardInvoiceRows.map((f, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #23263a' }}>
                    <td style={{ padding: '4px 8px', color: '#e5e7eb' }}>
                      {(f.institutionName || 'Cartão desconhecido')}
                      {f.cardBrand ? ` / ${f.cardBrand}` : ''}
                      {f.cardLast4 ? ` / ${f.cardLast4}` : ''}
                    </td>
                    <td style={{ padding: '4px 8px', color: '#fbbf24', fontWeight: 600 }}>
                      {formatBRL(Number(f.totalFaturaAnteriorMinor ?? f.abertoAnteriorMinor))}
                    </td>
                    <td style={{ padding: '4px 8px', color: '#4ade80', fontWeight: 600 }}>{formatBRL(Number(f.paidAmountMinor))}</td>
                    <td style={{ padding: '4px 8px', color: '#fbbf24', fontWeight: 600 }}>{formatBRL(Number(f.comprasDoMesMinor))}</td>
                    <td style={{ padding: '4px 8px', color: '#fbbf24', fontWeight: 700 }}>{formatBRL(Number(f.totalFaturaMinor))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1.5rem', alignItems: 'start' }}>
        {/* Left: Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Parâmetros base */}
          <Card>
            <SectionTitle>Parâmetros</SectionTitle>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <Input label="Mês inicial (YYYY-MM)" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} placeholder="2026-05" error={errors.startMonth} />
              <Input label="Meses a projectar" type="number" min={1} max={24} value={months} onChange={(e) => setMonths(e.target.value)} error={errors.months} />
              <Button type="submit" fullWidth disabled={state.status === 'loading'}>
                {state.status === 'loading' ? 'Calculando...' : 'Calcular projeção'}
              </Button>
            </form>
          </Card>

          {/* Projeções avulsas */}
          <Section title="Projeções avulsas removíveis" count={transactions.length}>
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
                <Button onClick={saveTransaction} variant="secondary">{txEditId ? 'Salvar' : '+ Add'}</Button>
              </div>
              {txEditId && (
                <Button onClick={cancelEditTransaction} variant="secondary">Cancelar edição</Button>
              )}
            </div>
            {transactions.length === 0
              ? <EmptyState icon="💸" title="Nenhuma projeção avulsa" description="Adicione receitas e despesas acima. Receita sobe a linha azul; despesa entra no vermelho." />
              : transactions.map((tx, i) => (
                  <TransactionRow
                    key={tx.id}
                    tx={tx}
                    onEdit={() => startEditTransaction(tx)}
                    onRemove={() => setTransactions((p) => p.filter((_, j) => j !== i))}
                  />
                ))
            }
          </Section>

          {/* Forecasts */}
          <Section title="Previsões recorrentes" count={recurring.length}>
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
              Previsões são projeções futuras (ex: salário mensal, IPTU anual). Podem ser substituídas por dados reais quando confirmados.
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
                <select
                  value={fcType}
                  onChange={(e) => setFcType(e.target.value as 'income' | 'expense')}
                  style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem' }}
                >
                  <option value="income">Receita</option>
                  <option value="expense">Despesa</option>
                </select>
                <input
                  value={fcAmount}
                  onChange={(e) => setFcAmount(e.target.value)}
                  type="number"
                  step="0.01"
                  placeholder="Valor (R$)"
                  style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 8, padding: '0.5rem', color: '#e5e7eb', fontSize: '0.85rem', flex: 1 }}
                />
                <Button onClick={() => { void saveForecast() }} variant="secondary" disabled={recurringSaving}>
                  {recurringSaving ? 'Salvando...' : fcEditId ? 'Salvar' : '+ Add'}
                </Button>
              </div>
              {fcEditId && (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <Button onClick={cancelEditForecast} variant="secondary">Cancelar edição</Button>
                </div>
              )}
            </div>
            {recurringError && <Alert variant="error">{recurringError}</Alert>}
            {recurringLoading && <Spinner size={20} />}
            {recurring.length === 0
              ? <EmptyState icon="🔮" title="Nenhuma previsão" description="Adicione receitas ou despesas recorrentes futuras." />
              : recurring.map((fc) => (
                  <ForecastRow
                    key={fc.id}
                    fc={fc}
                    onEdit={() => startEditForecast(fc)}
                    onRemove={() => { void removeForecast(fc.id) }}
                  />
                ))
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
                  { label: 'Total despesas', value: Math.abs(state.data.monthly.reduce((s, m) => s + Number(m.totalExpenseMinor) + Number(m.totalLiabilityPaymentMinor), 0)), color: '#f87171' },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background: '#141624', border: '1px solid #2a2f45', borderRadius: 10, padding: '0.75rem', textAlign: 'center' }}>
                    <p style={{ fontSize: '0.72rem', color: '#6b7280', marginBottom: 4 }}>{label}</p>
                    <p style={{ fontSize: '1rem', fontWeight: 800, color }}>{formatBRL(value)}</p>
                  </div>
                ))}
              </div>

              {/* Chart */}
              <Card>
                <SectionTitle>Recebido vs Saídas</SectionTitle>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e2130" />
                    <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ background: '#1e2130', border: '1px solid #2a2f45', borderRadius: 8 }}
                      labelStyle={{ color: '#9ca3af' }}
                      formatter={(v, name) => {
                        const labels: Record<string, string> = {
                          recebido: 'Recebido',
                          pago: 'Saídas do extrato',
                          previsto: 'Débitos recorrentes',
                          cartaoProjetado: 'Faturas do cartão',
                          saldo: 'Saldo final',
                        }
                        return [formatBRL(Number(v ?? 0) * 100), labels[String(name)] ?? String(name)]
                      }}
                    />
                    <ReferenceLine y={0} stroke="#f87171" strokeDasharray="4 2" />
                    <Bar dataKey="pago" name="pago" stackId="despesas" fill="#7dd3fc" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="previsto" name="previsto" stackId="despesas" fill="#ef4444" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="cartaoProjetado" name="cartaoProjetado" stackId="despesas" fill="#fb923c" radius={[4, 4, 0, 0]} />
                    <Line type="monotone" dataKey="recebido" name="recebido" stroke="#1d4ed8" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </Card>

              <Card>
                <SectionTitle>Débitos recorrentes por mês (marque pago/não cobrado)</SectionTitle>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr style={{ color: '#6b7280', borderBottom: '1px solid #2a2f45' }}>
                        <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem' }}>Mês</th>
                        <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem' }}>Débito recorrente</th>
                        <th style={{ textAlign: 'right', padding: '0.4rem 0.5rem' }}>Valor</th>
                        <th style={{ textAlign: 'center', padding: '0.4rem 0.5rem' }}>Pago/Não cobrado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.data.monthly.flatMap((m) => {
                        const activeRows = recurringExpenseItems.filter((fc) => appliesRecurringOnMonth(fc, m.competencyMonth))
                        if (activeRows.length === 0) {
                          return [
                            <tr key={`${m.competencyMonth}-empty`} style={{ borderBottom: '1px solid #1e2130' }}>
                              <td style={{ padding: '0.45rem 0.5rem', color: '#e5e7eb', fontWeight: 600 }}>{m.competencyMonth}</td>
                              <td colSpan={3} style={{ padding: '0.45rem 0.5rem', color: '#6b7280' }}>Sem débitos recorrentes</td>
                            </tr>,
                          ]
                        }

                        return activeRows.map((fc, idx) => {
                          const isPaid = fc.paidMonths.includes(m.competencyMonth)
                          return (
                            <tr key={`${m.competencyMonth}-${fc.id}`} style={{ borderBottom: '1px solid #1e2130' }}>
                              <td style={{ padding: '0.45rem 0.5rem', color: '#e5e7eb', fontWeight: idx === 0 ? 600 : 400 }}>{idx === 0 ? m.competencyMonth : ''}</td>
                              <td style={{ padding: '0.45rem 0.5rem', color: '#e5e7eb' }}>
                                {fc.description || 'Sem descrição'}
                                <span style={{ color: '#6b7280', marginLeft: 6 }}>({recurrenceLabel[fc.recurrence ?? 'one-time']})</span>
                              </td>
                              <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right', color: '#f87171' }}>
                                {formatBRL(fc.amountMinor)}
                              </td>
                              <td style={{ padding: '0.45rem 0.5rem', textAlign: 'center' }}>
                                <input
                                  type="checkbox"
                                  checked={isPaid}
                                  onChange={(e) => {
                                    void setForecastPaidMonth(fc.id, m.competencyMonth, e.target.checked)
                                  }}
                                />
                              </td>
                            </tr>
                          )
                        })
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

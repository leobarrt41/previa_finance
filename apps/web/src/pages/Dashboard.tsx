/**
 * Dashboard.tsx — Briefing diário do Previa Finance
 *
 * Responde em 5 segundos: "Como estou agora e o que preciso fazer hoje?"
 * Não repete o que já existe em CashFlow, Budget, Accounts ou AccountDetail.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, formatBRL } from '../services/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AccountSummary {
  id: number
  name: string
  type: string
  currentBalanceMinor?: number
  institutionName?: string | null
}

interface InvoiceSummary {
  accountId: number
  accountName: string
  invoiceMonth: string
  dueDate?: string | null
  totalAmountMinor: number | bigint
  effectiveOpenAmountMinor: number | bigint
  status: string
}

interface SpendingOverview {
  totalIncomeMinor: number
  totalExpenseMinor: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function daysUntil(iso?: string | null): number | null {
  if (!iso) return null
  const diff = new Date(iso).getTime() - Date.now()
  return Math.ceil(diff / 86_400_000)
}

function formatDueDate(iso?: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function healthColor(net: number, hasOverdue: boolean): string {
  if (hasOverdue || net < 0) return '#f87171'
  if (net < 50000) return '#fbbf24' // < R$500
  return '#4ade80'
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricBlock({
  label,
  value,
  color = '#e5e7eb',
  sub,
}: {
  label: string
  value: string
  color?: string
  sub?: string
}) {
  return (
    <div>
      <div style={{ fontSize: '0.68rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: '1.35rem', fontWeight: 800, color, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

function AlertRow({ icon, text, tone }: { icon: string; text: string; tone: 'red' | 'amber' | 'green' }) {
  const colors = { red: '#fca5a5', amber: '#fbbf24', green: '#86efac' }
  const bg = { red: 'rgba(248,113,113,0.07)', amber: 'rgba(251,191,36,0.07)', green: 'rgba(74,222,128,0.07)' }
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.6rem',
        padding: '0.65rem 0.85rem',
        borderRadius: 10,
        background: bg[tone],
        border: `1px solid ${colors[tone]}22`,
      }}
    >
      <span style={{ fontSize: '1rem' }}>{icon}</span>
      <span style={{ fontSize: '0.83rem', color: colors[tone], lineHeight: 1.4 }}>{text}</span>
    </div>
  )
}

function ActionButton({
  icon,
  label,
  sub,
  onClick,
  primary,
}: {
  icon: string
  label: string
  sub: string
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: primary
          ? 'linear-gradient(135deg, rgba(99,102,241,0.18), rgba(99,102,241,0.08))'
          : 'rgba(15,17,23,0.6)',
        border: primary ? '1px solid rgba(99,102,241,0.45)' : '1px dashed #2b3150',
        borderRadius: 14,
        padding: '0.9rem 1rem',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        textAlign: 'left',
        width: '100%',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLButtonElement
        el.style.borderColor = '#6366f1'
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLButtonElement
        el.style.borderColor = primary ? 'rgba(99,102,241,0.45)' : '#2b3150'
      }}
    >
      <span style={{ fontSize: '1.25rem' }}>{icon}</span>
      <div>
        <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#e5e7eb' }}>{label}</div>
        <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 2 }}>{sub}</div>
      </div>
    </button>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function Dashboard() {
  const navigate = useNavigate()
  const month = currentMonth()

  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([])
  const [spending, setSpending] = useState<SpendingOverview | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)

    Promise.allSettled([
      api.accounts.list(),
      api.assess.debt(month, 1),
      api.assess.spendingOverview(month),
    ]).then(([accRes, debtRes, spendRes]) => {
      if (!active) return

      if (accRes.status === 'fulfilled') {
        setAccounts((accRes.value as any).items ?? [])
      }

      if (debtRes.status === 'fulfilled') {
        const debt = debtRes.value as any
        const raw: InvoiceSummary[] = (debt?.openInvoices ?? []).map((inv: any) => ({
          accountId: inv.accountId,
          accountName: inv.accountName ?? inv.institutionName ?? 'Cartão',
          invoiceMonth: inv.invoiceMonth,
          dueDate: inv.dueDate,
          totalAmountMinor: inv.totalAmountMinor ?? 0,
          effectiveOpenAmountMinor: inv.effectiveOpenAmountMinor ?? inv.totalAmountMinor ?? 0,
          status: inv.status ?? 'OPEN',
        }))
        setInvoices(raw)
      }

      if (spendRes.status === 'fulfilled') {
        const s = spendRes.value as any
        setSpending({
          totalIncomeMinor: s?.totalIncomeMinor ?? 0,
          totalExpenseMinor: s?.totalExpenseMinor ?? 0,
        })
      }

      setLoading(false)
    })

    return () => { active = false }
  }, [month])

  // ── Derived values ──────────────────────────────────────────────────────────

  const liquidAccounts = accounts.filter((a) => a.type === 'checking' || a.type === 'wallet')
  const openInvoices = invoices.filter((i) => i.status !== 'PAID')
  const overdueInvoices = invoices.filter((i) => i.status === 'OVERDUE')
  const negativeAccounts = accounts.filter(
    (a) => a.type !== 'credit_card' && (a.currentBalanceMinor ?? 0) < 0,
  )

  const liquidBalance = liquidAccounts.reduce((s, a) => s + (a.currentBalanceMinor ?? 0), 0)
  const openInvoicesTotal = openInvoices.reduce((s, i) => s + Number(i.effectiveOpenAmountMinor), 0)
  const netAvailable = liquidBalance - openInvoicesTotal

  const income = spending?.totalIncomeMinor ?? 0
  const expense = spending?.totalExpenseMinor ?? 0
  const monthBalance = income - expense

  // Próxima fatura a vencer (não paga, com dueDate)
  const nextInvoice = openInvoices
    .filter((i) => i.dueDate)
    .sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime())[0]

  const nextInvoiceDays = daysUntil(nextInvoice?.dueDate)

  // Alertas
  const alerts: { icon: string; text: string; tone: 'red' | 'amber' | 'green' }[] = []

  if (overdueInvoices.length > 0) {
    alerts.push({
      icon: '🚨',
      text: `${overdueInvoices.length} fatura${overdueInvoices.length > 1 ? 's' : ''} vencida${overdueInvoices.length > 1 ? 's' : ''} — total ${formatBRL(overdueInvoices.reduce((s, i) => s + Number(i.effectiveOpenAmountMinor), 0))}`,
      tone: 'red',
    })
  }

  if (negativeAccounts.length > 0) {
    alerts.push({
      icon: '⚠️',
      text: `${negativeAccounts.length} conta${negativeAccounts.length > 1 ? 's' : ''} com saldo negativo`,
      tone: 'red',
    })
  }

  if (nextInvoice && nextInvoiceDays !== null && nextInvoiceDays <= 7 && nextInvoiceDays >= 0) {
    alerts.push({
      icon: '📅',
      text: `Fatura ${nextInvoice.accountName} vence em ${nextInvoiceDays === 0 ? 'hoje' : `${nextInvoiceDays} dia${nextInvoiceDays > 1 ? 's' : ''}`} — ${formatBRL(Number(nextInvoice.effectiveOpenAmountMinor))}`,
      tone: nextInvoiceDays <= 2 ? 'red' : 'amber',
    })
  }

  if (accounts.length === 0 && !loading) {
    alerts.push({
      icon: '📥',
      text: 'Nenhuma conta encontrada. Importe um extrato para começar.',
      tone: 'amber',
    })
  }

  if (alerts.length === 0 && !loading) {
    alerts.push({
      icon: '✅',
      text: 'Nenhum alerta crítico no momento.',
      tone: 'green',
    })
  }

  const hColor = healthColor(netAvailable, overdueInvoices.length > 0)

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 900, display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* ── Bloco 1: Saldo disponível ── */}
      <div
        style={{
          background: 'linear-gradient(180deg, rgba(20,22,36,0.98), rgba(12,14,22,0.98))',
          border: '1px solid #2b3150',
          borderRadius: 20,
          padding: '1.4rem 1.5rem',
          boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ fontSize: '0.68rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: '1rem' }}>
          {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1.5rem', alignItems: 'end' }}>
          <div>
            <div style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>
              Disponível líquido
            </div>
            <div style={{ fontSize: 'clamp(1.8rem, 4vw, 2.6rem)', fontWeight: 900, color: hColor, lineHeight: 1, letterSpacing: '-0.03em' }}>
              {loading ? '...' : formatBRL(netAvailable)}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 6 }}>
              Caixa líquido menos faturas em aberto
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <MetricBlock
              label="Caixa líquido"
              value={loading ? '...' : formatBRL(liquidBalance)}
              color={liquidBalance >= 0 ? '#86efac' : '#f87171'}
              sub={`${liquidAccounts.length} conta${liquidAccounts.length !== 1 ? 's' : ''} corrente${liquidAccounts.length !== 1 ? 's' : ''}`}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <MetricBlock
              label="Faturas em aberto"
              value={loading ? '...' : formatBRL(openInvoicesTotal)}
              color={openInvoicesTotal > 0 ? '#fbbf24' : '#86efac'}
              sub={`${openInvoices.length} fatura${openInvoices.length !== 1 ? 's' : ''}`}
            />
          </div>

          {nextInvoice && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <MetricBlock
                label="Próximo vencimento"
                value={formatDueDate(nextInvoice.dueDate)}
                color={nextInvoiceDays !== null && nextInvoiceDays <= 3 ? '#fbbf24' : '#e5e7eb'}
                sub={nextInvoice.accountName}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Bloco 2: Mês corrente + Alertas ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>

        {/* Resumo do mês */}
        <div
          style={{
            background: 'linear-gradient(180deg, rgba(20,22,36,0.98), rgba(12,14,22,0.98))',
            border: '1px solid #2b3150',
            borderRadius: 18,
            padding: '1.2rem 1.3rem',
          }}
        >
          <div style={{ fontSize: '0.68rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '1rem' }}>
            Mês corrente
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.83rem', color: '#9ca3af' }}>Receitas</span>
              <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#86efac' }}>
                {loading ? '...' : formatBRL(income)}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.83rem', color: '#9ca3af' }}>Despesas</span>
              <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f87171' }}>
                {loading ? '...' : formatBRL(expense)}
              </span>
            </div>

            <div
              style={{
                borderTop: '1px solid #1e2130',
                paddingTop: '0.75rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: '0.83rem', color: '#e5e7eb', fontWeight: 700 }}>
                {monthBalance >= 0 ? 'Sobra' : 'Falta'}
              </span>
              <span
                style={{
                  fontSize: '1.1rem',
                  fontWeight: 900,
                  color: monthBalance >= 0 ? '#4ade80' : '#f87171',
                }}
              >
                {loading ? '...' : formatBRL(Math.abs(monthBalance))}
              </span>
            </div>
          </div>

          <button
            onClick={() => navigate('/budget')}
            style={{
              marginTop: '1rem',
              background: 'transparent',
              border: '1px solid #2b3150',
              borderRadius: 10,
              padding: '0.55rem 0.85rem',
              fontSize: '0.78rem',
              color: '#9ca3af',
              cursor: 'pointer',
              width: '100%',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#e5e7eb' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af' }}
          >
            Ver detalhes por categoria →
          </button>
        </div>

        {/* Alertas */}
        <div
          style={{
            background: 'linear-gradient(180deg, rgba(20,22,36,0.98), rgba(12,14,22,0.98))',
            border: '1px solid #2b3150',
            borderRadius: 18,
            padding: '1.2rem 1.3rem',
          }}
        >
          <div style={{ fontSize: '0.68rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '1rem' }}>
            Atenção
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
            {alerts.map((a, i) => (
              <AlertRow key={i} icon={a.icon} text={a.text} tone={a.tone} />
            ))}
          </div>
        </div>
      </div>

      {/* ── Bloco 3: Faturas próximas ── */}
      {openInvoices.length > 0 && (
        <div
          style={{
            background: 'linear-gradient(180deg, rgba(20,22,36,0.98), rgba(12,14,22,0.98))',
            border: '1px solid #2b3150',
            borderRadius: 18,
            padding: '1.2rem 1.3rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.9rem' }}>
            <div style={{ fontSize: '0.68rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
              Faturas em aberto
            </div>
            <button
              onClick={() => navigate('/accounts')}
              style={{ background: 'none', border: 'none', color: '#6366f1', fontSize: '0.78rem', cursor: 'pointer', padding: 0 }}
            >
              Ver todas →
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {openInvoices.slice(0, 4).map((inv, i) => {
              const days = daysUntil(inv.dueDate)
              const isUrgent = days !== null && days <= 3
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.6rem 0.75rem',
                    borderRadius: 10,
                    background: isUrgent ? 'rgba(251,191,36,0.06)' : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${isUrgent ? 'rgba(251,191,36,0.2)' : '#1e2130'}`,
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.83rem', fontWeight: 600, color: '#e5e7eb' }}>{inv.accountName}</div>
                    <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 2 }}>
                      Vence {formatDueDate(inv.dueDate)}
                      {days !== null && days >= 0 && ` · ${days === 0 ? 'hoje' : `em ${days}d`}`}
                    </div>
                  </div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 800, color: isUrgent ? '#fbbf24' : '#e5e7eb' }}>
                    {formatBRL(Number(inv.effectiveOpenAmountMinor))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Bloco 4: Acções rápidas ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '0.75rem',
        }}
      >
        <ActionButton
          icon="📤"
          label="Importar fatura"
          sub="PDF de cartão de crédito"
          onClick={() => navigate('/invoices/upload')}
          primary
        />
        <ActionButton
          icon="🧾"
          label="Importar extrato"
          sub="OFX, CSV ou PDF bancário"
          onClick={() => navigate('/statements/upload')}
        />
        <ActionButton
          icon="📊"
          label="Ver cashflow"
          sub="Projecção mês a mês"
          onClick={() => navigate('/cashflow')}
        />
        <ActionButton
          icon="🤖"
          label="Previa Bot"
          sub="Pergunte sobre suas finanças"
          onClick={() => navigate('/bot')}
        />
      </div>
    </div>
  )
}

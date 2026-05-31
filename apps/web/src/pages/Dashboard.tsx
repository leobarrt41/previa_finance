/**
 * Dashboard.tsx — Painel principal do Previa Finance
 *
 * Exibe resumo financeiro real: saldo das contas, próximas faturas,
 * acções rápidas e atalhos para os módulos principais.
 * Dados carregados via api.accounts.list() e api.assess.debt().
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, formatBRL } from '../services/api'

// ─── tipos locais ─────────────────────────────────────────────────────────────

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

// ─── helpers ──────────────────────────────────────────────────────────────────

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatMonth(month: string): string {
  const [y, m] = month.split('-')
  const names = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return `${names[Number(m) - 1]}/${y}`
}

function formatDueDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function statusColor(status: string): string {
  if (status === 'PAID') return '#4ade80'
  if (status === 'OVERDUE') return '#f87171'
  return '#fbbf24'
}

function accountTypeLabel(type: string): string {
  const map: Record<string, string> = {
    checking: 'Conta corrente',
    savings: 'Poupança',
    credit_card: 'Cartão de crédito',
    investment: 'Investimento',
    wallet: 'Carteira',
  }
  return map[type] ?? type
}

// ─── sub-componentes ──────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string
  sub?: string
  accent?: string
}) {
  return (
    <div
      style={{
        background: '#141624',
        border: '1px solid #1e2130',
        borderRadius: 12,
        padding: '1.25rem 1.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <span style={{ fontSize: '0.72rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </span>
      <span style={{ fontSize: '1.5rem', fontWeight: 800, color: accent ?? '#e5e7eb', lineHeight: 1.2 }}>
        {value}
      </span>
      {sub && (
        <span style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 2 }}>
          {sub}
        </span>
      )}
    </div>
  )
}

function QuickAction({
  icon,
  label,
  desc,
  path,
  navigate,
}: {
  icon: string
  label: string
  desc: string
  path: string
  navigate: (p: string) => void
}) {
  return (
    <button
      onClick={() => navigate(path)}
      style={{
        background: 'transparent',
        border: '1px solid #1e2130',
        borderRadius: 10,
        padding: '0.75rem 1rem',
        textAlign: 'left',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.75rem',
        transition: 'border-color 0.15s',
        width: '100%',
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.borderColor = '#6366f1')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.borderColor = '#1e2130')}
    >
      <span style={{ fontSize: '1.2rem', lineHeight: 1, marginTop: 2 }}>{icon}</span>
      <div>
        <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#e5e7eb', marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: '0.75rem', color: '#6b7280', lineHeight: 1.4 }}>{desc}</div>
      </div>
    </button>
  )
}

// ─── componente principal ─────────────────────────────────────────────────────

export function Dashboard() {
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([])
  const [loading, setLoading] = useState(true)
  const month = currentMonth()

  useEffect(() => {
    let active = true
    setLoading(true)

    Promise.allSettled([
      api.accounts.list(),
      api.assess.debt(month, 2),
    ]).then(([accResult, debtResult]) => {
      if (!active) return

      if (accResult.status === 'fulfilled') {
        setAccounts((accResult.value as any).items ?? [])
      }

      if (debtResult.status === 'fulfilled') {
        const debt = debtResult.value as any
        const raw: InvoiceSummary[] = []
        for (const inv of debt?.openInvoices ?? []) {
          raw.push({
            accountId: inv.accountId,
            accountName: inv.accountName ?? inv.institutionName ?? 'Cartão',
            invoiceMonth: inv.invoiceMonth,
            dueDate: inv.dueDate,
            totalAmountMinor: inv.totalAmountMinor ?? 0,
            effectiveOpenAmountMinor: inv.effectiveOpenAmountMinor ?? inv.totalAmountMinor ?? 0,
            status: inv.status ?? 'OPEN',
          })
        }
        setInvoices(raw.slice(0, 5))
      }

      setLoading(false)
    })

    return () => { active = false }
  }, [month])

  // métricas derivadas
  const bankAccounts = accounts.filter((a) => a.type !== 'credit_card')
  const totalBalance = bankAccounts.reduce((s, a) => s + (a.currentBalanceMinor ?? 0), 0)
  const openInvoicesTotal = invoices
    .filter((i) => i.status !== 'PAID')
    .reduce((s, i) => s + Number(i.effectiveOpenAmountMinor), 0)

  return (
    <div style={{ maxWidth: 960 }}>

      {/* ── Cabeçalho ─────────────────────────────────────────────────── */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#e5e7eb', margin: 0 }}>
          Visão geral
        </h1>
        <p style={{ color: '#6b7280', marginTop: '0.3rem', fontSize: '0.875rem' }}>
          {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* ── Métricas ──────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: '1rem',
          marginBottom: '2rem',
        }}
      >
        <MetricCard
          label="Saldo em conta"
          value={loading ? '...' : formatBRL(totalBalance)}
          sub={`${bankAccounts.length} conta${bankAccounts.length !== 1 ? 's' : ''}`}
          accent={totalBalance >= 0 ? '#4ade80' : '#f87171'}
        />
        <MetricCard
          label="Faturas em aberto"
          value={loading ? '...' : formatBRL(openInvoicesTotal)}
          sub={`${invoices.filter((i) => i.status !== 'PAID').length} fatura(s)`}
          accent={openInvoicesTotal > 0 ? '#fbbf24' : '#4ade80'}
        />
        <MetricCard
          label="Período"
          value={formatMonth(month)}
          sub="Mês actual"
        />
      </div>

      {/* ── Grid: faturas + acções ────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '1.5rem',
          marginBottom: '2rem',
        }}
      >
        {/* Próximas faturas */}
        <div
          style={{
            background: '#141624',
            border: '1px solid #1e2130',
            borderRadius: 12,
            padding: '1.25rem 1.5rem',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#e5e7eb', marginBottom: '1rem' }}>
            Próximas faturas
          </div>

          {loading ? (
            <div style={{ color: '#6b7280', fontSize: '0.85rem' }}>Carregando...</div>
          ) : invoices.length === 0 ? (
            <div style={{ color: '#6b7280', fontSize: '0.85rem' }}>
              Nenhuma fatura em aberto.{' '}
              <button
                onClick={() => navigate('/invoices/upload')}
                style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', padding: 0, fontSize: '0.85rem' }}
              >
                Importar fatura →
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {invoices.map((inv, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.5rem 0',
                    borderBottom: i < invoices.length - 1 ? '1px solid #1e2130' : 'none',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#e5e7eb' }}>
                      {inv.accountName}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#6b7280' }}>
                      {formatMonth(inv.invoiceMonth)} · vence {formatDueDate(inv.dueDate)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#e5e7eb' }}>
                      {formatBRL(Number(inv.effectiveOpenAmountMinor))}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: statusColor(inv.status), fontWeight: 600 }}>
                      {inv.status === 'PAID' ? 'Pago' : inv.status === 'OVERDUE' ? 'Vencido' : 'Em aberto'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Acções rápidas */}
        <div
          style={{
            background: '#141624',
            border: '1px solid #1e2130',
            borderRadius: 12,
            padding: '1.25rem 1.5rem',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#e5e7eb', marginBottom: '1rem' }}>
            Acções rápidas
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <QuickAction icon="📈" label="Fluxo de caixa" desc="Projeção mês a mês" path="/cashflow" navigate={navigate} />
            <QuickAction icon="🎯" label="Orçamento" desc="Simular compra e avaliar impacto" path="/budget" navigate={navigate} />
            <QuickAction icon="💳" label="Aval. Dívidas" desc="Parcelas e faturas futuras" path="/assess/debt" navigate={navigate} />
            <QuickAction icon="📊" label="Aval. Gastos" desc="Gastos por categoria" path="/assess/spending" navigate={navigate} />
          </div>
        </div>
      </div>

      {/* ── Contas ────────────────────────────────────────────────────── */}
      <div
        style={{
          background: '#141624',
          border: '1px solid #1e2130',
          borderRadius: 12,
          padding: '1.25rem 1.5rem',
          marginBottom: '2rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#e5e7eb' }}>Contas</div>
          <button
            onClick={() => navigate('/accounts')}
            style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: '0.8rem', padding: 0 }}
          >
            Ver todas →
          </button>
        </div>

        {loading ? (
          <div style={{ color: '#6b7280', fontSize: '0.85rem' }}>Carregando...</div>
        ) : accounts.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: '0.85rem' }}>
            Nenhuma conta cadastrada.{' '}
            <button
              onClick={() => navigate('/statements/upload')}
              style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', padding: 0, fontSize: '0.85rem' }}
            >
              Importar extrato →
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
            {accounts.map((acc) => (
              <button
                key={acc.id}
                onClick={() => navigate(`/accounts/${acc.id}`)}
                style={{
                  background: '#0f1117',
                  border: '1px solid #1e2130',
                  borderRadius: 10,
                  padding: '0.85rem 1rem',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.borderColor = '#6366f1')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.borderColor = '#1e2130')}
              >
                <div style={{ fontSize: '0.68rem', color: '#6b7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {accountTypeLabel(acc.type)}
                </div>
                <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#e5e7eb', marginBottom: 2 }}>
                  {acc.name}
                </div>
                {acc.institutionName && (
                  <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{acc.institutionName}</div>
                )}
                {acc.currentBalanceMinor !== undefined && acc.type !== 'credit_card' && (
                  <div
                    style={{
                      fontSize: '0.95rem',
                      fontWeight: 800,
                      color: acc.currentBalanceMinor >= 0 ? '#4ade80' : '#f87171',
                      marginTop: 6,
                    }}
                  >
                    {formatBRL(acc.currentBalanceMinor)}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Importação ────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <button
          onClick={() => navigate('/statements/upload')}
          style={{
            background: '#141624',
            border: '1px dashed #2b3150',
            borderRadius: 12,
            padding: '1rem 1.25rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            transition: 'border-color 0.15s',
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.borderColor = '#6366f1')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.borderColor = '#2b3150')}
        >
          <span style={{ fontSize: '1.3rem' }}>🧾</span>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#e5e7eb' }}>Importar extrato</div>
            <div style={{ fontSize: '0.72rem', color: '#6b7280' }}>OFX, CSV ou PDF bancário</div>
          </div>
        </button>

        <button
          onClick={() => navigate('/invoices/upload')}
          style={{
            background: '#141624',
            border: '1px dashed #2b3150',
            borderRadius: 12,
            padding: '1rem 1.25rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            transition: 'border-color 0.15s',
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.borderColor = '#6366f1')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.borderColor = '#2b3150')}
        >
          <span style={{ fontSize: '1.3rem' }}>📤</span>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#e5e7eb' }}>Importar fatura</div>
            <div style={{ fontSize: '0.72rem', color: '#6b7280' }}>PDF de cartão de crédito</div>
          </div>
        </button>
      </div>

    </div>
  )
}

/**
 * Dashboard.tsx — Painel principal do Previa Finance
 *
 * Estrutura o painel como uma capa de jornal por editorias:
 * dívidas, caixa, orçamento, economias, investimentos e alertas.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, formatBRL } from '../services/api'

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
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
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

function accountGroupLabel(type: string): string {
  const map: Record<string, string> = {
    checking: 'Caixa',
    savings: 'Economias',
    credit_card: 'Dívidas',
    investment: 'Investimentos',
    wallet: 'Caixa',
  }
  return map[type] ?? 'Outros'
}

function SectionCard({
  eyebrow,
  title,
  subtitle,
  tone = 'neutral',
  children,
  footer,
}: {
  eyebrow: string
  title: string
  subtitle?: string
  tone?: 'neutral' | 'amber' | 'blue' | 'green' | 'red' | 'violet'
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  const accents: Record<string, { ring: string; glow: string; label: string }> = {
    neutral: { ring: '#243047', glow: 'rgba(36, 48, 71, 0.35)', label: '#e5e7eb' },
    amber: { ring: '#4b3512', glow: 'rgba(245, 158, 11, 0.14)', label: '#fbbf24' },
    blue: { ring: '#1f3a5f', glow: 'rgba(59, 130, 246, 0.14)', label: '#93c5fd' },
    green: { ring: '#1f4f3a', glow: 'rgba(74, 222, 128, 0.14)', label: '#86efac' },
    red: { ring: '#5f1f2a', glow: 'rgba(248, 113, 113, 0.14)', label: '#fca5a5' },
    violet: { ring: '#34235f', glow: 'rgba(167, 139, 250, 0.14)', label: '#c4b5fd' },
  }

  const accent = accents[tone]

  return (
    <section
      style={{
        background: `linear-gradient(180deg, rgba(20,22,36,0.98), rgba(15,17,23,0.98))`,
        border: `1px solid ${accent.ring}`,
        borderRadius: 18,
        padding: '1.15rem 1.25rem',
        boxShadow: `0 18px 42px ${accent.glow}`,
      }}
    >
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.68rem', color: accent.label, textTransform: 'uppercase', letterSpacing: '0.14em' }}>
          {eyebrow}
        </div>
        <div style={{ fontSize: '0.98rem', fontWeight: 850, color: '#f8fafc', marginTop: 6 }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: '0.82rem', color: '#94a3b8', marginTop: 6, lineHeight: 1.45 }}>
            {subtitle}
          </div>
        )}
      </div>
      <div>{children}</div>
      {footer && <div style={{ marginTop: '1rem' }}>{footer}</div>}
    </section>
  )
}

export function Dashboard() {
  const navigate = useNavigate()
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([])
  const [loading, setLoading] = useState(true)
  const month = currentMonth()

  useEffect(() => {
    let active = true
    setLoading(true)

    Promise.allSettled([api.accounts.list(), api.assess.debt(month, 2)]).then(([accResult, debtResult]) => {
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

    return () => {
      active = false
    }
  }, [month])

  const liquidAccounts = accounts.filter((a) => a.type === 'checking' || a.type === 'wallet')
  const savingsAccounts = accounts.filter((a) => a.type === 'savings')
  const investmentAccounts = accounts.filter((a) => a.type === 'investment')
  const creditCardAccounts = accounts.filter((a) => a.type === 'credit_card')
  const bankAccounts = accounts.filter((a) => a.type !== 'credit_card')

  const liquidBalance = liquidAccounts.reduce((sum, a) => sum + (a.currentBalanceMinor ?? 0), 0)
  const savingsBalance = savingsAccounts.reduce((sum, a) => sum + (a.currentBalanceMinor ?? 0), 0)
  const investmentsBalance = investmentAccounts.reduce((sum, a) => sum + (a.currentBalanceMinor ?? 0), 0)
  const totalBalance = bankAccounts.reduce((sum, a) => sum + (a.currentBalanceMinor ?? 0), 0)
  const openInvoicesTotal = invoices
    .filter((i) => i.status !== 'PAID')
    .reduce((sum, i) => sum + Number(i.effectiveOpenAmountMinor), 0)

  const overdueInvoices = invoices.filter((i) => i.status === 'OVERDUE')
  const negativeAccounts = bankAccounts.filter((a) => (a.currentBalanceMinor ?? 0) < 0)
  const invoiceCount = invoices.filter((i) => i.status !== 'PAID').length

  const headlineTitle =
    overdueInvoices.length > 0
      ? 'Dívidas vencidas ganham a manchete'
      : totalBalance < 0
        ? 'Caixa apertado pede ação imediata'
        : savingsBalance > 0
          ? 'Reserva financeira sustenta a edição'
          : 'Panorama estável, com leitura limpa'

  const headlineDeck =
    overdueInvoices.length > 0
      ? `Há ${overdueInvoices.length} fatura${overdueInvoices.length !== 1 ? 's' : ''} vencida${overdueInvoices.length !== 1 ? 's' : ''} somando ${formatBRL(
          overdueInvoices.reduce((sum, i) => sum + Number(i.effectiveOpenAmountMinor), 0),
        )}.`
      : totalBalance < 0
        ? `Saldo consolidado em ${formatBRL(totalBalance)}. O caixa merece prioridade antes de novas compras.`
        : `Saldo consolidado em ${formatBRL(totalBalance)} e ${formatBRL(savingsBalance)} em economias.`

  const topInvoice = invoices[0]
  const topAlert =
    overdueInvoices.length > 0
      ? `Foco nas faturas vencidas e no vencimento mais próximo.`
      : negativeAccounts.length > 0
        ? `Há ${negativeAccounts.length} conta${negativeAccounts.length !== 1 ? 's' : ''} com saldo negativo.`
        : `Nenhum alerta crítico agora.`

  return (
    <div style={{ maxWidth: 1200 }}>
      {/* Manchete */}
      <div
        style={{
          position: 'relative',
          overflow: 'hidden',
          background:
            'radial-gradient(circle at top left, rgba(245, 158, 11, 0.18), transparent 32%), linear-gradient(180deg, rgba(20, 22, 36, 0.98), rgba(12, 14, 22, 0.98))',
          border: '1px solid #2b3150',
          borderRadius: 24,
          padding: '1.5rem',
          marginBottom: '1.25rem',
          boxShadow: '0 28px 70px rgba(0, 0, 0, 0.35)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
            maskImage: 'linear-gradient(180deg, rgba(0,0,0,0.72), transparent)',
            pointerEvents: 'none',
          }}
        />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.9rem' }}>
            <span style={{ fontSize: '0.68rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#fbbf24' }}>
              Edição de hoje
            </span>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: '#f59e0b' }} />
            <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>
              {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '1.25rem',
              alignItems: 'stretch',
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: 'Georgia, Times New Roman, serif',
                  fontSize: 'clamp(2.35rem, 4vw, 4.4rem)',
                  lineHeight: 0.96,
                  fontWeight: 700,
                  letterSpacing: '-0.04em',
                  color: '#f8fafc',
                  textWrap: 'balance',
                }}
              >
                {headlineTitle}
              </div>
              <p
                style={{
                  margin: '0.95rem 0 0',
                  maxWidth: 760,
                  fontSize: '1rem',
                  lineHeight: 1.6,
                  color: '#cbd5e1',
                }}
              >
                {headlineDeck} O painel agora se organiza por editorias, como um jornal: dívidas, caixa, orçamento,
                economias, investimentos e alertas.
              </p>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.55rem', marginTop: '1.15rem' }}>
                {['Dívidas', 'Caixa', 'Orçamento', 'Economias', 'Investimentos', 'Alertas'].map((label) => (
                  <span
                    key={label}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      border: '1px solid #2b3150',
                      background: 'rgba(15, 17, 23, 0.72)',
                      color: '#cbd5e1',
                      borderRadius: 999,
                      padding: '0.42rem 0.78rem',
                      fontSize: '0.78rem',
                    }}
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>

            <div
              style={{
                background: 'rgba(15, 17, 23, 0.72)',
                border: '1px solid #2b3150',
                borderRadius: 18,
                padding: '1rem',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '0.9rem',
              }}
            >
              <div>
                <div style={{ fontSize: '0.72rem', color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                  Radar
                </div>
                <div
                  style={{
                    marginTop: '0.55rem',
                    fontFamily: 'Georgia, Times New Roman, serif',
                    fontSize: '1.45rem',
                    lineHeight: 1.05,
                    color: '#f8fafc',
                  }}
                >
                  {topAlert}
                </div>
                <p style={{ margin: '0.7rem 0 0', fontSize: '0.9rem', lineHeight: 1.55, color: '#cbd5e1' }}>
                  {loading ? 'Carregando dados do dia...' : `${invoiceCount} fatura${invoiceCount !== 1 ? 's' : ''} em aberto agora.`}
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
                <div style={{ padding: '0.85rem', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.18)', borderRadius: 14 }}>
                  <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#fbbf24' }}>
                    Caixa líquido
                  </div>
                  <div style={{ marginTop: 4, fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }}>
                    {loading ? '...' : formatBRL(liquidBalance)}
                  </div>
                </div>
                <div style={{ padding: '0.85rem', background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.18)', borderRadius: 14 }}>
                  <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#93c5fd' }}>
                    Dívida aberta
                  </div>
                  <div style={{ marginTop: 4, fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }}>
                    {loading ? '...' : formatBRL(openInvoicesTotal)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Destaques */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
          marginBottom: '1.25rem',
        }}
      >
        <SectionCard
          eyebrow="Caixa"
          title={loading ? '...' : formatBRL(totalBalance)}
          subtitle={`${bankAccounts.length} conta${bankAccounts.length !== 1 ? 's' : ''} no radar`}
          tone={totalBalance >= 0 ? 'green' : 'red'}
        >
          <div style={{ color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.5 }}>
            {totalBalance >= 0
              ? 'O saldo consolidado está positivo.'
              : 'O saldo consolidado pede contenção imediata.'}
          </div>
        </SectionCard>

        <SectionCard
          eyebrow="Economias"
          title={loading ? '...' : formatBRL(savingsBalance)}
          subtitle={`${savingsAccounts.length} conta${savingsAccounts.length !== 1 ? 's' : ''} de reserva`}
          tone="green"
        >
          <div style={{ color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.5 }}>
            Reserva para amortecer os próximos meses.
          </div>
        </SectionCard>

        <SectionCard
          eyebrow="Investimentos"
          title={loading ? '...' : formatBRL(investmentsBalance)}
          subtitle={`${investmentAccounts.length} posição${investmentAccounts.length !== 1 ? 'ões' : ''}`}
          tone="violet"
        >
          <div style={{ color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.5 }}>
            Patrimônio aplicado fora do caixa operacional.
          </div>
        </SectionCard>

        <SectionCard
          eyebrow="Faturas"
          title={loading ? '...' : formatBRL(openInvoicesTotal)}
          subtitle={`${invoiceCount} fatura${invoiceCount !== 1 ? 's' : ''} aberta${invoiceCount !== 1 ? 's' : ''}`}
          tone={invoiceCount > 0 ? 'amber' : 'green'}
        >
          <div style={{ color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.5 }}>
            Priorize vencimentos e cartões.
          </div>
        </SectionCard>
      </div>

      {/* Editorias */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '1rem',
          marginBottom: '1.25rem',
        }}
      >
        <SectionCard
          eyebrow="Editorias"
          title="Dívidas"
          subtitle="Faturas, parcelas e vencimentos que merecem atenção hoje."
          tone={overdueInvoices.length > 0 ? 'red' : 'amber'}
          footer={
            <button
              onClick={() => navigate('/assess/debt')}
              style={{
                background: 'transparent',
                color: '#e5e7eb',
                border: '1px solid #374151',
                borderRadius: 12,
                padding: '0.75rem 0.9rem',
                fontSize: '0.86rem',
                fontWeight: 700,
                cursor: 'pointer',
                width: '100%',
                textAlign: 'left',
              }}
            >
              Abrir análise de dívidas →
            </button>
          }
        >
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
            <div style={{ padding: '0.7rem 0.85rem', borderRadius: 12, background: 'rgba(248, 113, 113, 0.08)', border: '1px solid rgba(248, 113, 113, 0.18)' }}>
              <div style={{ fontSize: '0.68rem', color: '#fca5a5', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Vencidas
              </div>
              <div style={{ marginTop: 4, fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }}>
                {overdueInvoices.length}
              </div>
            </div>
            <div style={{ padding: '0.7rem 0.85rem', borderRadius: 12, background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.18)' }}>
              <div style={{ fontSize: '0.68rem', color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Em aberto
              </div>
              <div style={{ marginTop: 4, fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }}>
                {invoiceCount}
              </div>
            </div>
          </div>

          {loading ? (
            <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Carregando faturas...</div>
          ) : topInvoice ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
              {invoices.slice(0, 3).map((inv, i) => (
                <div
                  key={`${inv.accountId}-${inv.invoiceMonth}-${i}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    padding: '0.7rem 0',
                    borderTop: i === 0 ? '1px solid #1e2130' : '1px solid #1e2130',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#e5e7eb' }}>{inv.accountName}</div>
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                      {formatMonth(inv.invoiceMonth)} · vence {formatDueDate(inv.dueDate)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f8fafc' }}>
                      {formatBRL(Number(inv.effectiveOpenAmountMinor))}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: statusColor(inv.status), fontWeight: 700 }}>
                      {inv.status === 'PAID' ? 'Pago' : inv.status === 'OVERDUE' ? 'Vencido' : 'Em aberto'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Nenhuma fatura em aberto.</div>
          )}
        </SectionCard>

        <SectionCard
          eyebrow="Editorias"
          title="Caixa"
          subtitle="Saldo operacional e contas correntes em destaque."
          tone={totalBalance >= 0 ? 'green' : 'red'}
          footer={
            <button
              onClick={() => navigate('/cashflow')}
              style={{
                background: 'transparent',
                color: '#e5e7eb',
                border: '1px solid #374151',
                borderRadius: 12,
                padding: '0.75rem 0.9rem',
                fontSize: '0.86rem',
                fontWeight: 700,
                cursor: 'pointer',
                width: '100%',
                textAlign: 'left',
              }}
            >
              Ver fluxo de caixa →
            </button>
          }
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
            <div style={{ padding: '0.85rem', borderRadius: 12, background: 'rgba(74, 222, 128, 0.08)', border: '1px solid rgba(74, 222, 128, 0.18)' }}>
              <div style={{ fontSize: '0.68rem', color: '#86efac', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Líquido
              </div>
              <div style={{ marginTop: 4, fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }}>
                {loading ? '...' : formatBRL(liquidBalance)}
              </div>
            </div>
            <div style={{ padding: '0.85rem', borderRadius: 12, background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.18)' }}>
              <div style={{ fontSize: '0.68rem', color: '#93c5fd', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Contas
              </div>
              <div style={{ marginTop: 4, fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }}>
                {bankAccounts.length}
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          eyebrow="Editorias"
          title="Orçamento"
          subtitle="Área para simular compra, cortar gastos e medir impacto."
          tone="blue"
          footer={
            <button
              onClick={() => navigate('/budget')}
              style={{
                background: 'transparent',
                color: '#e5e7eb',
                border: '1px solid #374151',
                borderRadius: 12,
                padding: '0.75rem 0.9rem',
                fontSize: '0.86rem',
                fontWeight: 700,
                cursor: 'pointer',
                width: '100%',
                textAlign: 'left',
              }}
            >
              Abrir orçamento →
            </button>
          }
        >
          <div style={{ color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.55 }}>
            Use esta editoria para responder “posso comprar isso agora?” sem sair do painel.
          </div>
        </SectionCard>

        <SectionCard
          eyebrow="Editorias"
          title="Economias"
          subtitle="Reserva, poupança e colchão financeiro."
          tone="green"
          footer={
            <button
              onClick={() => navigate('/accounts')}
              style={{
                background: 'transparent',
                color: '#e5e7eb',
                border: '1px solid #374151',
                borderRadius: 12,
                padding: '0.75rem 0.9rem',
                fontSize: '0.86rem',
                fontWeight: 700,
                cursor: 'pointer',
                width: '100%',
                textAlign: 'left',
              }}
            >
              Ver contas de reserva →
            </button>
          }
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
            <div style={{ padding: '0.85rem', borderRadius: 12, background: 'rgba(74, 222, 128, 0.08)', border: '1px solid rgba(74, 222, 128, 0.18)' }}>
              <div style={{ fontSize: '0.68rem', color: '#86efac', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Poupança
              </div>
              <div style={{ marginTop: 4, fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }}>
                {loading ? '...' : formatBRL(savingsBalance)}
              </div>
            </div>
            <div style={{ padding: '0.85rem', borderRadius: 12, background: 'rgba(74, 222, 128, 0.08)', border: '1px solid rgba(74, 222, 128, 0.18)' }}>
              <div style={{ fontSize: '0.68rem', color: '#86efac', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Contas
              </div>
              <div style={{ marginTop: 4, fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }}>
                {savingsAccounts.length}
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          eyebrow="Editorias"
          title="Investimentos"
          subtitle="O que está aplicado fora do caixa."
          tone="violet"
          footer={
            <button
              onClick={() => navigate('/accounts')}
              style={{
                background: 'transparent',
                color: '#e5e7eb',
                border: '1px solid #374151',
                borderRadius: 12,
                padding: '0.75rem 0.9rem',
                fontSize: '0.86rem',
                fontWeight: 700,
                cursor: 'pointer',
                width: '100%',
                textAlign: 'left',
              }}
            >
              Conferir posições →
            </button>
          }
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
            <div style={{ padding: '0.85rem', borderRadius: 12, background: 'rgba(167, 139, 250, 0.08)', border: '1px solid rgba(167, 139, 250, 0.18)' }}>
              <div style={{ fontSize: '0.68rem', color: '#c4b5fd', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Aplicado
              </div>
              <div style={{ marginTop: 4, fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }}>
                {loading ? '...' : formatBRL(investmentsBalance)}
              </div>
            </div>
            <div style={{ padding: '0.85rem', borderRadius: 12, background: 'rgba(167, 139, 250, 0.08)', border: '1px solid rgba(167, 139, 250, 0.18)' }}>
              <div style={{ fontSize: '0.68rem', color: '#c4b5fd', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Posições
              </div>
              <div style={{ marginTop: 4, fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }}>
                {investmentAccounts.length}
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          eyebrow="Editorias"
          title="Alertas"
          subtitle="O que pede decisão antes de virar problema."
          tone={negativeAccounts.length > 0 || overdueInvoices.length > 0 ? 'red' : 'amber'}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ padding: '0.85rem', borderRadius: 12, background: 'rgba(248, 113, 113, 0.08)', border: '1px solid rgba(248, 113, 113, 0.18)' }}>
              <div style={{ fontSize: '0.68rem', color: '#fca5a5', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Itens críticos
              </div>
              <div style={{ marginTop: 4, fontSize: '1rem', fontWeight: 800, color: '#f8fafc' }}>
                {overdueInvoices.length + negativeAccounts.length}
              </div>
            </div>
            <div style={{ color: '#94a3b8', fontSize: '0.82rem', lineHeight: 1.55 }}>
              {overdueInvoices.length > 0
                ? `Há ${overdueInvoices.length} fatura${overdueInvoices.length !== 1 ? 's' : ''} vencida${overdueInvoices.length !== 1 ? 's' : ''}.`
                : 'Sem faturas vencidas no momento.'}
              {' '}
              {negativeAccounts.length > 0
                ? `${negativeAccounts.length} conta${negativeAccounts.length !== 1 ? 's' : ''} está(ão) negativa(s).`
                : 'Nenhuma conta negativa detectada.'}
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Contas em destaque */}
      <SectionCard
        eyebrow="Balancete"
        title="Contas em destaque"
        subtitle="As principais contas aparecem aqui como notas de rodapé da edição."
        tone="neutral"
      >
        {loading ? (
          <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Carregando contas...</div>
        ) : accounts.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
            Nenhuma conta cadastrada.
            {' '}
            <button
              onClick={() => navigate('/statements/upload')}
              style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', padding: 0, fontSize: '0.85rem' }}
            >
              Importar extrato →
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
            {accounts.slice(0, 8).map((acc) => (
              <button
                key={acc.id}
                onClick={() => navigate(`/accounts/${acc.id}`)}
                style={{
                  background: '#0f1117',
                  border: '1px solid #1e2130',
                  borderRadius: 12,
                  padding: '0.85rem 1rem',
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.borderColor = '#6366f1')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.borderColor = '#1e2130')}
              >
                <div style={{ fontSize: '0.68rem', color: '#6b7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {accountGroupLabel(acc.type)}
                </div>
                <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#e5e7eb', marginBottom: 2 }}>
                  {acc.name}
                </div>
                {acc.institutionName && <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{acc.institutionName}</div>}
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
      </SectionCard>

      {/* Editoria de serviços */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '1rem',
          marginTop: '1rem',
        }}
      >
        <button
          onClick={() => navigate('/statements/upload')}
          style={{
            background: 'linear-gradient(180deg, rgba(20,22,36,0.98), rgba(15,17,23,0.98))',
            border: '1px dashed #3b425c',
            borderRadius: 18,
            padding: '1rem 1.25rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            transition: 'border-color 0.15s',
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.borderColor = '#6366f1')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.borderColor = '#3b425c')}
        >
          <span style={{ fontSize: '1.3rem' }}>🧾</span>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#e5e7eb' }}>Importar extrato</div>
            <div style={{ fontSize: '0.72rem', color: '#6b7280' }}>OFX, CSV ou PDF bancário</div>
          </div>
        </button>

        <button
          onClick={() => navigate('/invoices/upload')}
          style={{
            background: 'linear-gradient(180deg, rgba(20,22,36,0.98), rgba(15,17,23,0.98))',
            border: '1px dashed #3b425c',
            borderRadius: 18,
            padding: '1rem 1.25rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            transition: 'border-color 0.15s',
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.borderColor = '#6366f1')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.borderColor = '#3b425c')}
        >
          <span style={{ fontSize: '1.3rem' }}>📤</span>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#e5e7eb' }}>Importar fatura</div>
            <div style={{ fontSize: '0.72rem', color: '#6b7280' }}>PDF de cartão de crédito</div>
          </div>
        </button>
      </div>
    </div>
  )
}

/**
 * Dashboard.tsx — Tela inicial do Previa Finance
 *
 * Apresenta cards de sumário e links rápidos para as telas principais.
 * Não faz chamadas de API directamente — serve como ponto de entrada
 * e orientação para o utilizador.
 */
import { useNavigate } from 'react-router-dom'
import { Card, Badge, Button, SectionTitle } from '../components/ui'

const QUICK_ACTIONS = [
  {
    label: 'Projecção de CashFlow',
    description: 'Visualize seu saldo mês a mês com base em receitas, despesas e faturas.',
    icon: '📈',
    path: '/cashflow',
    badge: 'Core',
    badgeVariant: 'blue' as const,
  },
  {
    label: 'Análise de Orçamento',
    description: 'Simule o impacto de uma transação no seu orçamento mensal.',
    icon: '🎯',
    path: '/budget',
    badge: 'Core',
    badgeVariant: 'blue' as const,
  },
]

const STATUS_ITEMS = [
  { label: 'Schema do banco',       status: 'v4 implementado',  variant: 'green'  as const },
  { label: 'Motor de CashFlow',     status: 'Operacional',      variant: 'green'  as const },
  { label: 'Motor de Orçamento',    status: 'Operacional',      variant: 'green'  as const },
  { label: 'Reconciliação',         status: 'Base pronta',      variant: 'yellow' as const },
  { label: 'Open Finance (Pluggy)', status: 'Fase 4',           variant: 'gray'   as const },
  { label: 'Parser de faturas',     status: 'Em andamento',     variant: 'yellow' as const },
]

export function Dashboard() {
  const navigate = useNavigate()

  return (
    <div style={{ maxWidth: 900 }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#e5e7eb', margin: 0 }}>
          Previa Finance
        </h1>
        <p style={{ color: '#6b7280', marginTop: '0.35rem', fontSize: '0.9rem' }}>
          Gestão financeira orientada a fluxo futuro, dívida e consolidação mensal.
        </p>
      </div>

      {/* Quick actions */}
      <SectionTitle>Acções rápidas</SectionTitle>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '1rem',
          marginBottom: '2rem',
        }}
      >
        {QUICK_ACTIONS.map((action) => (
          <Card key={action.path}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '1.75rem' }}>{action.icon}</span>
              <Badge variant={action.badgeVariant}>{action.badge}</Badge>
            </div>
            <h3 style={{ fontWeight: 700, fontSize: '0.95rem', color: '#e5e7eb', margin: '0 0 0.4rem' }}>
              {action.label}
            </h3>
            <p style={{ fontSize: '0.82rem', color: '#6b7280', marginBottom: '1rem', lineHeight: 1.5 }}>
              {action.description}
            </p>
            <Button onClick={() => navigate(action.path)} fullWidth>
              Abrir →
            </Button>
          </Card>
        ))}
      </div>

      {/* Status do produto */}
      <SectionTitle>Estado do produto</SectionTitle>
      <Card>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: '0.75rem',
          }}
        >
          {STATUS_ITEMS.map(({ label, status, variant }) => (
            <div
              key={label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.5rem 0',
                borderBottom: '1px solid #1e2130',
              }}
            >
              <span style={{ fontSize: '0.82rem', color: '#9ca3af' }}>{label}</span>
              <Badge variant={variant}>{status}</Badge>
            </div>
          ))}
        </div>
      </Card>

      {/* Princípio de produto */}
      <div
        style={{
          marginTop: '2rem',
          padding: '1rem 1.25rem',
          background: '#1a2a3a',
          borderLeft: '3px solid #6366f1',
          borderRadius: '0 8px 8px 0',
          fontSize: '0.85rem',
          color: '#93c5fd',
          lineHeight: 1.6,
        }}
      >
        <strong>Princípio central:</strong> Compra no cartão não é débito imediato — é dívida futura.
        O pagamento da fatura é o evento que afecta o caixa.
      </div>
    </div>
  )
}

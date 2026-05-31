import React, { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { UserButton, useUser } from '@clerk/clerk-react'
import { api, type SubscriptionStatus } from '../services/api'

const NAV_ITEMS = [
  { to: '/dashboard',          label: 'Dashboard',       icon: '🏠' },
  { to: '/cashflow',           label: 'Fluxo de caixa',  icon: '📈' },
  { to: '/budget',             label: 'Orçamento',       icon: '🎯' },
  { to: '/accounts',           label: 'Contas',          icon: '🏦' },
  { to: '/statements/upload',  label: 'Upload Extrato',  icon: '🧾' },
  { to: '/invoices/upload',    label: 'Upload Fatura',   icon: '📤' },
  { to: '/categories',         label: 'Categorias',      icon: '🏷️' },
  { to: '/assess/spending',    label: 'Aval. Gastos',    icon: '📊' },
  { to: '/assess/debt',        label: 'Aval. Dívidas',   icon: '💳' },
  { to: '/receipt-documents',  label: 'Notas Fiscais',   icon: '🧾' },
  { to: '/chat',               label: 'Previa Bot',      icon: '🤖' },
]

export function Layout({ children }: { children: React.ReactNode }) {
  const { user } = useUser()
  const navigate = useNavigate()
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null)

  const displayName = user?.firstName
    ? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}`
    : user?.emailAddresses?.[0]?.emailAddress ?? 'Utilizador'

  useEffect(() => {
    api.subscription.me().then(setSubscription).catch(() => {
      // Silenciar erros de rede — não bloquear o layout
    })
  }, [])

  const showTrialBanner =
    subscription?.status === 'trialing' &&
    subscription.isActive &&
    subscription.daysRemaining <= 15

  const showExpiredBanner =
    subscription !== null && !subscription.isActive

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0f1117', color: '#e5e7eb' }}>
      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside
        style={{
          width: 220,
          minHeight: '100vh',
          background: '#141624',
          borderRight: '1px solid #1e2130',
          display: 'flex',
          flexDirection: 'column',
          padding: '1.5rem 0',
          flexShrink: 0,
        }}
      >
        {/* Logo */}
        <div style={{ padding: '0 1.5rem 1.5rem', borderBottom: '1px solid #1e2130' }}>
          <span style={{ fontWeight: 800, fontSize: '1.1rem', color: '#6366f1', letterSpacing: '-0.02em' }}>
            Previa Finance
          </span>
        </div>

        {/* Nav */}
        <nav style={{ padding: '1rem 0.75rem', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {NAV_ITEMS.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/dashboard'}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                padding: '0.55rem 0.85rem',
                borderRadius: 8,
                textDecoration: 'none',
                fontSize: '0.9rem',
                fontWeight: isActive ? 700 : 400,
                color: isActive ? '#6366f1' : '#9ca3af',
                background: isActive ? '#1e2130' : 'transparent',
                transition: 'all 0.15s',
              })}
            >
              <span>{icon}</span>
              <span>{label}</span>
            </NavLink>
          ))}

          {/* Link de upgrade na sidebar */}
          <NavLink
            to="/upgrade"
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              padding: '0.55rem 0.85rem',
              borderRadius: 8,
              textDecoration: 'none',
              fontSize: '0.9rem',
              fontWeight: isActive ? 700 : 400,
              color: isActive ? '#f59e0b' : '#f59e0b',
              background: isActive ? '#1e2130' : 'transparent',
              marginTop: 8,
              borderTop: '1px solid #1e2130',
              paddingTop: '0.75rem',
            })}
          >
            <span>⭐</span>
            <span>Assinar</span>
          </NavLink>
        </nav>

        {/* Utilizador + Logout */}
        <div
          style={{
            marginTop: 'auto',
            padding: '1rem 1.25rem',
            borderTop: '1px solid #1e2130',
            display: 'flex',
            alignItems: 'center',
            gap: '0.65rem',
          }}
        >
          {/* UserButton do Clerk — avatar + menu de conta + logout */}
          <UserButton
            afterSignOutUrl="/"
            appearance={{
              elements: {
                avatarBox: { width: 32, height: 32 },
              },
            }}
          />
          <div style={{ overflow: 'hidden' }}>
            <div
              style={{
                fontSize: '0.8rem',
                fontWeight: 600,
                color: '#e5e7eb',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 140,
              }}
            >
              {displayName}
            </div>
            <div style={{ fontSize: '0.7rem', color: '#4b5563' }}>MVP · beta</div>
          </div>
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────────── */}
      <main style={{ flex: 1, overflowY: 'auto', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Banner de trial a expirar */}
        {showTrialBanner && (
          <div
            style={{
              background: 'linear-gradient(90deg, #1e1b4b, #312e81)',
              borderBottom: '1px solid #4338ca',
              padding: '0.6rem 2rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: '0.875rem', color: '#c7d2fe' }}>
              ⏳ O seu trial gratuito expira em{' '}
              <strong style={{ color: '#e0e7ff' }}>
                {subscription!.daysRemaining === 1
                  ? '1 dia'
                  : `${subscription!.daysRemaining} dias`}
              </strong>
              .
            </span>
            <button
              onClick={() => navigate('/upgrade')}
              style={{
                background: '#6366f1',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '0.35rem 0.9rem',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Assinar agora
            </button>
          </div>
        )}

        {/* Banner de assinatura expirada */}
        {showExpiredBanner && (
          <div
            style={{
              background: 'linear-gradient(90deg, #450a0a, #7f1d1d)',
              borderBottom: '1px solid #dc2626',
              padding: '0.6rem 2rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: '0.875rem', color: '#fecaca' }}>
              🔒 O seu acesso expirou. Assine para continuar a usar o Previa Finance.
            </span>
            <button
              onClick={() => navigate('/upgrade')}
              style={{
                background: '#dc2626',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '0.35rem 0.9rem',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Reativar acesso
            </button>
          </div>
        )}

        <div style={{ flex: 1, padding: '2rem' }}>
          {children}
        </div>
      </main>
    </div>
  )
}

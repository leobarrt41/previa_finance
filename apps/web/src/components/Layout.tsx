import React, { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { api } from '../services/api'

const NAV_ITEMS = [
  { to: '/',                label: 'Dashboard',       icon: '🏠' },
  { to: '/cashflow',        label: 'Fluxo de caixa',  icon: '📈' },
  { to: '/budget',          label: 'Orçamento',       icon: '🎯' },
  { to: '/accounts',        label: 'Contas',          icon: '🏦' },
  { to: '/statements/upload', label: 'Upload Extrato', icon: '🧾' },
  { to: '/invoices/upload', label: 'Upload Fatura',   icon: '📤' },
  { to: '/categories',      label: 'Categorias',      icon: '🏷️' },
  { to: '/assess/spending',  label: 'Aval. Gastos',    icon: '📊' },
  { to: '/assess/debt',      label: 'Aval. Dívidas',   icon: '💳' },
  { to: '/receipt-documents', label: 'Notas Fiscais',   icon: '🧾' },
]

export function Layout({ children }: { children: React.ReactNode }) {
  const [authLabel, setAuthLabel] = useState('Carregando usuario...')

  useEffect(() => {
    let active = true

    api.auth.me()
      .then((me) => {
        if (!active) return
        setAuthLabel(`${me.clerkUserId} (owner ${me.ownerId})`)
      })
      .catch(() => {
        if (!active) return
        setAuthLabel('Nao autenticado')
      })

    return () => {
      active = false
    }
  }, [])

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#0f1117', color: '#e5e7eb' }}>
      {/* Sidebar */}
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
        <nav style={{ padding: '1rem 0.75rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {NAV_ITEMS.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
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
        </nav>

        {/* Footer */}
        <div style={{ marginTop: 'auto', padding: '1rem 1.5rem', borderTop: '1px solid #1e2130' }}>
          <span style={{ fontSize: '0.7rem', color: '#4b5563' }}>
            MVP · feat/frontend-manus
          </span>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, padding: '2rem', overflowY: 'auto' }}>
        <div
          style={{
            marginBottom: '1rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.45rem',
            padding: '0.35rem 0.65rem',
            borderRadius: 999,
            border: '1px solid #2b3150',
            background: '#171b2e',
            color: '#c7d2fe',
            fontSize: '0.78rem',
            fontWeight: 600,
          }}
        >
          <span>Usuario ativo:</span>
          <span style={{ color: '#e0e7ff' }}>{authLabel}</span>
        </div>
        {children}
      </main>
    </div>
  )
}

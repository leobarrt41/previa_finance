import React from 'react'
import { NavLink } from 'react-router-dom'

const NAV_ITEMS = [
  { to: '/',                label: 'Dashboard',       icon: '🏠' },
  { to: '/cashflow',        label: 'CashFlow',        icon: '📈' },
  { to: '/budget',          label: 'Orçamento',       icon: '🎯' },
  { to: '/invoices/upload', label: 'Upload Fatura',   icon: '📤' },
  { to: '/categories',      label: 'Categorias',      icon: '🏷️' },
]

export function Layout({ children }: { children: React.ReactNode }) {
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
        {children}
      </main>
    </div>
  )
}

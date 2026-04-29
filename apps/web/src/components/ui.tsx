/**
 * ui.tsx — Componentes base reutilizáveis do Previa Finance
 * Sem dependências externas de UI — CSS puro via classes inline.
 */
import React from 'react'

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
export function Card({
  children,
  className = '',
  style,
  onClick,
}: {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      style={{
        background: '#1e2130',
        borderRadius: 12,
        padding: '1.25rem 1.5rem',
        border: '1px solid #2a2f45',
        ...style,
      }}
      className={className}
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
type BadgeVariant = 'green' | 'red' | 'yellow' | 'blue' | 'gray'
const badgeColors: Record<BadgeVariant, { bg: string; color: string }> = {
  green:  { bg: '#1a3a2a', color: '#4ade80' },
  red:    { bg: '#3a1a1a', color: '#f87171' },
  yellow: { bg: '#3a2f1a', color: '#fbbf24' },
  blue:   { bg: '#1a2a3a', color: '#60a5fa' },
  gray:   { bg: '#2a2f45', color: '#9ca3af' },
}
export function Badge({
  children,
  variant = 'gray',
}: {
  children: React.ReactNode
  variant?: BadgeVariant
}) {
  const { bg, color } = badgeColors[variant]
  return (
    <span
      style={{
        background: bg,
        color,
        borderRadius: 6,
        padding: '2px 10px',
        fontSize: '0.75rem',
        fontWeight: 600,
        display: 'inline-block',
      }}
    >
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------
export function Spinner({ size = 24 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        border: `3px solid #2a2f45`,
        borderTop: `3px solid #6366f1`,
        borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
        display: 'inline-block',
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Alert
// ---------------------------------------------------------------------------
type AlertVariant = 'error' | 'warning' | 'info' | 'success'
const alertColors: Record<AlertVariant, { bg: string; color: string; border: string }> = {
  error:   { bg: '#3a1a1a', color: '#f87171', border: '#7f1d1d' },
  warning: { bg: '#3a2f1a', color: '#fbbf24', border: '#78350f' },
  info:    { bg: '#1a2a3a', color: '#60a5fa', border: '#1e3a5f' },
  success: { bg: '#1a3a2a', color: '#4ade80', border: '#14532d' },
}
export function Alert({
  children,
  variant = 'error',
  style,
}: {
  children: React.ReactNode
  variant?: AlertVariant
  style?: React.CSSProperties
}) {
  const { bg, color, border } = alertColors[variant]
  return (
    <div
      style={{
        background: bg,
        color,
        border: `1px solid ${border}`,
        borderRadius: 8,
        padding: '0.75rem 1rem',
        fontSize: '0.875rem',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------
export function EmptyState({
  icon = '📭',
  title,
  description,
}: {
  icon?: string
  title: string
  description?: string
}) {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '3rem 1rem',
        color: '#6b7280',
      }}
    >
      <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>{icon}</div>
      <p style={{ fontWeight: 600, color: '#9ca3af', marginBottom: '0.25rem' }}>
        {title}
      </p>
      {description && <p style={{ fontSize: '0.875rem' }}>{description}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
type ButtonVariant = 'primary' | 'secondary' | 'danger'
const buttonStyles: Record<ButtonVariant, React.CSSProperties> = {
  primary:   { background: '#6366f1', color: '#fff', border: 'none' },
  secondary: { background: '#2a2f45', color: '#e5e7eb', border: '1px solid #3a3f55' },
  danger:    { background: '#7f1d1d', color: '#fca5a5', border: 'none' },
}
export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled = false,
  fullWidth = false,
  style,
}: {
  children: React.ReactNode
  onClick?: () => void
  type?: 'button' | 'submit' | 'reset'
  variant?: ButtonVariant
  disabled?: boolean
  fullWidth?: boolean
  style?: React.CSSProperties
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        ...buttonStyles[variant],
        padding: '0.6rem 1.25rem',
        borderRadius: 8,
        fontWeight: 600,
        fontSize: '0.9rem',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        width: fullWidth ? '100%' : undefined,
        transition: 'opacity 0.15s',
        ...style,
      }}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
export function Input({
  label,
  error,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string
  error?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && (
        <label style={{ fontSize: '0.8rem', color: '#9ca3af', fontWeight: 500 }}>
          {label}
        </label>
      )}
      <input
        {...props}
        style={{
          background: '#141624',
          border: `1px solid ${error ? '#7f1d1d' : '#2a2f45'}`,
          borderRadius: 8,
          padding: '0.55rem 0.85rem',
          color: '#e5e7eb',
          fontSize: '0.9rem',
          outline: 'none',
          width: '100%',
          boxSizing: 'border-box',
        }}
      />
      {error && (
        <span style={{ fontSize: '0.75rem', color: '#f87171' }}>{error}</span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------
export function Select({
  label,
  error,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string
  error?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && (
        <label style={{ fontSize: '0.8rem', color: '#9ca3af', fontWeight: 500 }}>
          {label}
        </label>
      )}
      <select
        {...props}
        style={{
          background: '#141624',
          border: `1px solid ${error ? '#7f1d1d' : '#2a2f45'}`,
          borderRadius: 8,
          padding: '0.55rem 0.85rem',
          color: '#e5e7eb',
          fontSize: '0.9rem',
          outline: 'none',
          width: '100%',
        }}
      >
        {children}
      </select>
      {error && (
        <span style={{ fontSize: '0.75rem', color: '#f87171' }}>{error}</span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SectionTitle
// ---------------------------------------------------------------------------
export function SectionTitle({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <h2
      style={{
        fontSize: '1rem',
        fontWeight: 700,
        color: '#e5e7eb',
        marginBottom: '1rem',
        letterSpacing: '0.01em',
        ...style,
      }}
    >
      {children}
    </h2>
  )
}

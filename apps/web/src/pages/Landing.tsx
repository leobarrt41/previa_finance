/**
 * Landing.tsx — Página inicial pública do Previa Finance
 *
 * Rota: / (pública, sem autenticação)
 * Exibe proposta de valor e CTAs para login/signup via Clerk Hosted Pages.
 * Quando o utilizador já está autenticado (window.Clerk.session), redireciona
 * automaticamente para /dashboard.
 *
 * Clerk Hosted Pages:
 *   Sign In:  https://<clerk-domain>/sign-in
 *   Sign Up:  https://<clerk-domain>/sign-up
 * Configurar VITE_CLERK_SIGN_IN_URL e VITE_CLERK_SIGN_UP_URL no .env
 */
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const SIGN_IN_URL = (import.meta as any).env?.VITE_CLERK_SIGN_IN_URL ?? '/sign-in'
const SIGN_UP_URL = (import.meta as any).env?.VITE_CLERK_SIGN_UP_URL ?? '/sign-up'

const FEATURES = [
  {
    icon: '📈',
    title: 'Fluxo de caixa futuro',
    desc: 'Veja mês a mês quanto vai sobrar — antes de gastar.',
  },
  {
    icon: '💳',
    title: 'Faturas com preview',
    desc: 'Importe PDFs dos cartões suportados, revise o preview e confirme antes de salvar.',
  },
  {
    icon: '🎯',
    title: 'Orçamento inteligente',
    desc: 'Simule uma compra parcelada e saiba se pode fazer antes de decidir.',
  },
  {
    icon: '🤖',
    title: 'Previa Bot',
    desc: 'Pergunte sobre suas finanças em linguagem natural. A IA responde com seus dados reais.',
  },
]

export function Landing({ devAuthBypass = false }: { devAuthBypass?: boolean }) {
  const navigate = useNavigate()

  // Em dev bypass, entra directo no app sem passar pela tela pública.
  // Se Clerk estiver autenticado, também vai para o dashboard.
  useEffect(() => {
    if (devAuthBypass) {
      navigate('/dashboard', { replace: true })
      return
    }

    const clerk = (window as any).Clerk
    if (clerk?.session) {
      navigate('/dashboard', { replace: true })
    }
  }, [devAuthBypass, navigate])

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0f1117',
        color: '#e5e7eb',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* ── Navbar ──────────────────────────────────────────────────── */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '1.25rem 2rem',
          borderBottom: '1px solid #1e2130',
          background: '#141624',
        }}
      >
        <span style={{ fontWeight: 800, fontSize: '1.1rem', color: '#6366f1', letterSpacing: '-0.02em' }}>
          Previa Finance
        </span>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <a
            href={SIGN_IN_URL}
            style={{
              padding: '0.5rem 1.1rem',
              borderRadius: 8,
              border: '1px solid #2b3150',
              background: 'transparent',
              color: '#e5e7eb',
              fontSize: '0.875rem',
              fontWeight: 600,
              textDecoration: 'none',
              cursor: 'pointer',
            }}
          >
            Entrar
          </a>
          <a
            href={SIGN_UP_URL}
            style={{
              padding: '0.5rem 1.1rem',
              borderRadius: 8,
              border: 'none',
              background: '#6366f1',
              color: '#fff',
              fontSize: '0.875rem',
              fontWeight: 700,
              textDecoration: 'none',
              cursor: 'pointer',
            }}
          >
            Criar conta grátis
          </a>
        </div>
      </header>

      {/* ── Hero ────────────────────────────────────────────────────── */}
      <section
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '5rem 2rem 3rem',
          maxWidth: 720,
          margin: '0 auto',
          width: '100%',
        }}
      >
        <div
          style={{
            display: 'inline-block',
            padding: '0.35rem 0.85rem',
            borderRadius: 999,
            border: '1px solid #2b3150',
            background: '#171b2e',
            color: '#c7d2fe',
            fontSize: '0.78rem',
            fontWeight: 600,
            marginBottom: '1.5rem',
            letterSpacing: '0.04em',
          }}
        >
          MVP · Acesso antecipado
        </div>

        <h1
          style={{
            fontSize: 'clamp(2rem, 5vw, 3rem)',
            fontWeight: 900,
            lineHeight: 1.15,
            margin: '0 0 1.25rem',
            letterSpacing: '-0.03em',
          }}
        >
          Suas finanças,{' '}
          <span style={{ color: '#6366f1' }}>antes de acontecer</span>
        </h1>

        <p
          style={{
            fontSize: '1.1rem',
            color: '#9ca3af',
            lineHeight: 1.7,
            marginBottom: '2.5rem',
            maxWidth: 560,
          }}
        >
          Previa Finance conecta extratos, faturas e receitas para mostrar exactamente
          quanto você vai ter — mês a mês — antes de tomar qualquer decisão financeira.
        </p>

        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          <a
            href={devAuthBypass ? '/dashboard' : SIGN_UP_URL}
            style={{
              padding: '0.85rem 2rem',
              borderRadius: 10,
              border: 'none',
              background: '#6366f1',
              color: '#fff',
              fontSize: '1rem',
              fontWeight: 700,
              textDecoration: 'none',
              cursor: 'pointer',
            }}
          >
            {devAuthBypass ? 'Entrar no app' : 'Começar grátis por 15 dias'}
          </a>
          <a
            href={devAuthBypass ? '/dashboard' : SIGN_IN_URL}
            style={{
              padding: '0.85rem 2rem',
              borderRadius: 10,
              border: '1px solid #2b3150',
              background: 'transparent',
              color: '#e5e7eb',
              fontSize: '1rem',
              fontWeight: 600,
              textDecoration: 'none',
              cursor: 'pointer',
            }}
          >
            {devAuthBypass ? 'Abrir dashboard' : 'Já tenho conta'}
          </a>
        </div>
      </section>

      {/* ── Trial badge ──────────────────────────────────────────── */}
      <div style={{ textAlign: 'center', padding: '0.5rem 2rem 0', color: '#6b7280', fontSize: '0.82rem' }}>
        🎁 Trial gratuito de 15 dias · depois R$14,99/mês · Cancele a qualquer momento
      </div>

      {/* ── Features ────────────────────────────────────────────────── */}
      <section
        style={{
          padding: '3rem 2rem 5rem',
          maxWidth: 960,
          margin: '0 auto',
          width: '100%',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '1.25rem',
          }}
        >
          {FEATURES.map((f) => (
            <div
              key={f.title}
              style={{
                background: '#141624',
                border: '1px solid #1e2130',
                borderRadius: 12,
                padding: '1.5rem',
              }}
            >
              <div style={{ fontSize: '1.75rem', marginBottom: '0.75rem' }}>{f.icon}</div>
              <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#e5e7eb', marginBottom: '0.5rem' }}>
                {f.title}
              </div>
              <div style={{ fontSize: '0.82rem', color: '#6b7280', lineHeight: 1.6 }}>
                {f.desc}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Pricing ───────────────────────────────────────────────── */}
      <section
        style={{
          padding: '3rem 2rem 4rem',
          maxWidth: 680,
          margin: '0 auto',
          width: '100%',
          textAlign: 'center',
        }}
      >
        <h2
          style={{
            fontSize: 'clamp(1.4rem, 3vw, 1.9rem)',
            fontWeight: 800,
            color: '#e5e7eb',
            marginBottom: '0.5rem',
            letterSpacing: '-0.02em',
          }}
        >
          Simples e transparente
        </h2>
        <p style={{ color: '#6b7280', fontSize: '0.95rem', marginBottom: '2rem' }}>
          Um plano. Sem surpresas.
        </p>

        <div
          style={{
            background: '#141624',
            border: '2px solid #4338ca',
            borderRadius: 16,
            padding: '2.5rem 2rem',
            position: 'relative',
          }}
        >
          {/* Badge */}
          <div
            style={{
              position: 'absolute',
              top: -14,
              left: '50%',
              transform: 'translateX(-50%)',
              background: '#6366f1',
              color: '#fff',
              fontSize: '0.75rem',
              fontWeight: 700,
              padding: '0.25rem 0.9rem',
              borderRadius: 999,
              whiteSpace: 'nowrap',
            }}
          >
            🎁 15 dias grátis
          </div>

          <div style={{ fontSize: '1rem', color: '#9ca3af', marginBottom: '0.5rem' }}>Plano mensal</div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: '0.25rem', marginBottom: '1.5rem' }}>
            <span style={{ fontSize: '1.1rem', color: '#c7d2fe' }}>R$</span>
            <span style={{ fontSize: '3.5rem', fontWeight: 900, color: '#e0e7ff', lineHeight: 1 }}>14</span>
            <span style={{ fontSize: '1.75rem', fontWeight: 700, color: '#c7d2fe' }}>,99</span>
            <span style={{ fontSize: '0.9rem', color: '#6b7280', marginLeft: '0.25rem' }}>/mês</span>
          </div>

          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: '0 0 2rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              textAlign: 'left',
              maxWidth: 360,
              marginLeft: 'auto',
              marginRight: 'auto',
            }}
          >
            {[
              'Dashboard, fluxo de caixa e orçamento',
              'Upload e análise de faturas de cartão',
              'Previa Bot — assistente financeiro com IA',
              'Importação de extratos bancários',
              'Cancele a qualquer momento',
            ].map((item) => (
              <li key={item} style={{ display: 'flex', gap: '0.6rem', fontSize: '0.9rem', color: '#d1d5db' }}>
                <span style={{ color: '#6366f1', flexShrink: 0 }}>✓</span>
                {item}
              </li>
            ))}
          </ul>

          <a
            href={SIGN_UP_URL}
            style={{
              display: 'inline-block',
              padding: '0.85rem 2.5rem',
              borderRadius: 10,
              border: 'none',
              background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
              color: '#fff',
              fontSize: '1rem',
              fontWeight: 700,
              textDecoration: 'none',
              cursor: 'pointer',
            }}
          >
            Começar grátis por 15 dias
          </a>
          <div style={{ fontSize: '0.75rem', color: '#4b5563', marginTop: '0.75rem' }}>
            Sem cartão de crédito para iniciar o trial
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <footer
        style={{
          borderTop: '1px solid #1e2130',
          padding: '1.25rem 2rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.78rem',
          color: '#4b5563',
        }}
      >
        <span>© 2026 Previa Finance</span>
        <div style={{ display: 'flex', gap: '1.5rem' }}>
          <a href="/privacy" style={{ color: '#4b5563', textDecoration: 'none' }}>Privacidade</a>
          <a href="/terms" style={{ color: '#4b5563', textDecoration: 'none' }}>Termos</a>
        </div>
      </footer>
    </div>
  )
}

import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, type SubscriptionStatus } from '../services/api'

export function Upgrade() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const checkoutResult = searchParams.get('checkout')

  useEffect(() => {
    api.subscription
      .me()
      .then(setSubscription)
      .catch(() => setError('Não foi possível carregar o estado da assinatura.'))
      .finally(() => setLoading(false))
  }, [])

  async function handleCheckout() {
    setCheckoutLoading(true)
    setError(null)
    try {
      const { url } = await api.subscription.createCheckout({
        successUrl: `${window.location.origin}/dashboard?checkout=success`,
        cancelUrl: `${window.location.origin}/upgrade?checkout=canceled`,
      })
      if (url) {
        window.location.href = url
      }
    } catch (err) {
      setError('Não foi possível iniciar o checkout. Tente novamente.')
      setCheckoutLoading(false)
    }
  }

  const isAlreadyActive =
    subscription?.status === 'active' && subscription.isActive

  return (
    <div
      style={{
        maxWidth: 520,
        margin: '3rem auto',
        padding: '0 1rem',
        color: '#e5e7eb',
      }}
    >
      {/* Feedback de checkout */}
      {checkoutResult === 'success' && (
        <div
          style={{
            background: '#052e16',
            border: '1px solid #16a34a',
            borderRadius: 10,
            padding: '1rem 1.25rem',
            marginBottom: '1.5rem',
            color: '#bbf7d0',
            fontSize: '0.9rem',
          }}
        >
          ✅ Assinatura ativada com sucesso! Bem-vindo ao Previa Finance.
        </div>
      )}
      {checkoutResult === 'canceled' && (
        <div
          style={{
            background: '#1c1917',
            border: '1px solid #78716c',
            borderRadius: 10,
            padding: '1rem 1.25rem',
            marginBottom: '1.5rem',
            color: '#d6d3d1',
            fontSize: '0.9rem',
          }}
        >
          ℹ️ Checkout cancelado. Pode tentar novamente quando quiser.
        </div>
      )}

      {/* Card principal */}
      <div
        style={{
          background: '#141624',
          border: '1px solid #1e2130',
          borderRadius: 16,
          padding: '2rem',
        }}
      >
        {/* Cabeçalho */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⭐</div>
          <h1
            style={{
              fontSize: '1.5rem',
              fontWeight: 800,
              color: '#e0e7ff',
              margin: 0,
              marginBottom: '0.5rem',
            }}
          >
            Previa Finance
          </h1>
          <p style={{ color: '#9ca3af', fontSize: '0.95rem', margin: 0 }}>
            Controle total das suas finanças pessoais
          </p>
        </div>

        {/* Preço */}
        <div
          style={{
            background: 'linear-gradient(135deg, #1e1b4b, #312e81)',
            borderRadius: 12,
            padding: '1.5rem',
            textAlign: 'center',
            marginBottom: '1.5rem',
            border: '1px solid #4338ca',
          }}
        >
          <div style={{ fontSize: '0.8rem', color: '#a5b4fc', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Plano mensal
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: '0.25rem' }}>
            <span style={{ fontSize: '1rem', color: '#c7d2fe' }}>R$</span>
            <span style={{ fontSize: '3rem', fontWeight: 900, color: '#e0e7ff', lineHeight: 1 }}>14</span>
            <span style={{ fontSize: '1.5rem', fontWeight: 700, color: '#c7d2fe' }}>,99</span>
            <span style={{ fontSize: '0.9rem', color: '#818cf8', marginLeft: '0.25rem' }}>/mês</span>
          </div>
          <div
            style={{
              marginTop: '0.75rem',
              background: '#4338ca',
              borderRadius: 20,
              padding: '0.3rem 0.9rem',
              display: 'inline-block',
              fontSize: '0.8rem',
              color: '#e0e7ff',
              fontWeight: 600,
            }}
          >
            🎁 15 dias grátis para novos utilizadores
          </div>
        </div>

        {/* Features */}
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '0 0 1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.6rem',
          }}
        >
          {[
            'Dashboard com visão completa das finanças',
            'Fluxo de caixa e projeções mensais',
            'Upload e análise de faturas de cartão',
            'Orçamento por categoria',
            'Avaliação de gastos e dívidas',
            'Previa Bot — assistente financeiro com IA',
            'Importação de extratos bancários',
          ].map((feature) => (
            <li
              key={feature}
              style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', fontSize: '0.9rem', color: '#d1d5db' }}
            >
              <span style={{ color: '#6366f1', flexShrink: 0, marginTop: 1 }}>✓</span>
              {feature}
            </li>
          ))}
        </ul>

        {/* Estado atual da assinatura */}
        {!loading && subscription && (
          <div
            style={{
              background: '#0f1117',
              borderRadius: 8,
              padding: '0.75rem 1rem',
              marginBottom: '1.25rem',
              fontSize: '0.85rem',
              color: '#9ca3af',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>Estado actual:</span>
            <span
              style={{
                fontWeight: 600,
                color:
                  subscription.status === 'active'
                    ? '#34d399'
                    : subscription.status === 'trialing'
                    ? '#818cf8'
                    : '#f87171',
              }}
            >
              {subscription.status === 'trialing'
                ? `Trial — ${subscription.daysRemaining} dias restantes`
                : subscription.status === 'active'
                ? 'Ativo'
                : subscription.status === 'past_due'
                ? 'Pagamento em atraso'
                : subscription.status === 'canceled'
                ? 'Cancelado'
                : 'Expirado'}
            </span>
          </div>
        )}

        {/* Erro */}
        {error && (
          <div
            style={{
              background: '#450a0a',
              border: '1px solid #dc2626',
              borderRadius: 8,
              padding: '0.75rem 1rem',
              marginBottom: '1rem',
              fontSize: '0.85rem',
              color: '#fca5a5',
            }}
          >
            {error}
          </div>
        )}

        {/* CTA */}
        {isAlreadyActive ? (
          <div style={{ textAlign: 'center' }}>
            <div
              style={{
                background: '#052e16',
                border: '1px solid #16a34a',
                borderRadius: 10,
                padding: '1rem',
                color: '#bbf7d0',
                fontSize: '0.9rem',
                marginBottom: '1rem',
              }}
            >
              ✅ A sua assinatura está ativa. Aproveite o Previa Finance!
            </div>
            <button
              onClick={() => navigate('/dashboard')}
              style={{
                background: '#6366f1',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '0.75rem 1.5rem',
                fontSize: '0.95rem',
                fontWeight: 600,
                cursor: 'pointer',
                width: '100%',
              }}
            >
              Ir para o Dashboard
            </button>
          </div>
        ) : (
          <button
            onClick={handleCheckout}
            disabled={checkoutLoading || loading}
            style={{
              background: checkoutLoading ? '#4338ca' : 'linear-gradient(135deg, #6366f1, #4f46e5)',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              padding: '0.9rem 1.5rem',
              fontSize: '1rem',
              fontWeight: 700,
              cursor: checkoutLoading ? 'not-allowed' : 'pointer',
              width: '100%',
              opacity: checkoutLoading ? 0.8 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {checkoutLoading
              ? 'A redirecionar para o pagamento...'
              : subscription?.status === 'trialing'
              ? 'Assinar — R$14,99/mês'
              : 'Reativar assinatura — R$14,99/mês'}
          </button>
        )}

        <p
          style={{
            textAlign: 'center',
            fontSize: '0.75rem',
            color: '#4b5563',
            marginTop: '1rem',
            marginBottom: 0,
          }}
        >
          Pagamento seguro via Stripe. Cancele a qualquer momento.
        </p>
      </div>

      {/* Link de volta */}
      <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
        <button
          onClick={() => navigate('/dashboard')}
          style={{
            background: 'none',
            border: 'none',
            color: '#6b7280',
            fontSize: '0.85rem',
            cursor: 'pointer',
            textDecoration: 'underline',
          }}
        >
          ← Voltar ao Dashboard
        </button>
      </div>
    </div>
  )
}

/**
 * PreviaBot.tsx — Chat contextual financeiro com IA
 *
 * Funcionalidades:
 * - Sugestões de onboarding para novos utilizadores
 * - Atalhos rápidos para os fluxos principais do MVP
 * - Contexto financeiro real injectado pelo backend
 * - Respostas em linguagem natural sobre finanças pessoais
 */
import { useState, useRef, useEffect, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../services/api'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

// ---------------------------------------------------------------------------
// Sugestões por contexto
// ---------------------------------------------------------------------------
const ONBOARDING_SUGGESTIONS = [
  'Como funciona o Previa Finance?',
  'Como importo minha fatura de cartão?',
  'Qual a diferença entre extrato e fatura?',
  'O que é o período de trial?',
  'Como funciona a projeção de caixa?',
]

const FINANCIAL_SUGGESTIONS = [
  'Como está meu orçamento este mês?',
  'Quais são minhas maiores despesas?',
  'Tenho faturas em aberto?',
  'Posso fazer uma compra de R$ 500?',
  'Como está meu fluxo de caixa?',
  'Qual minha categoria de maior gasto?',
]

// ---------------------------------------------------------------------------
// Atalhos rápidos para os fluxos do MVP
// ---------------------------------------------------------------------------
const QUICK_ACTIONS = [
  { label: 'Importar fatura', to: '/invoices/upload', icon: '📄' },
  { label: 'Ver cashflow', to: '/cashflow', icon: '📈' },
  { label: 'Transações', to: '/transactions', icon: '💳' },
  { label: 'Avaliar compra', to: '/assess', icon: '🧮' },
]

// ---------------------------------------------------------------------------
// Mensagem de boas-vindas
// ---------------------------------------------------------------------------
const WELCOME_MESSAGE = `Olá! Sou o **Previa Bot**, seu assistente financeiro.

Posso ajudar você a entender suas finanças com base nos seus dados reais — receitas, despesas, faturas de cartão e projeção de caixa.

**Para começar**, importe sua fatura de cartão (PDF) ou extrato bancário. Depois, pergunte o que quiser sobre suas finanças.

O que você gostaria de saber?`

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br />')
}

export function PreviaBot() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return
    setShowOnboarding(false)
    const userMsg: Message = { role: 'user', content: text.trim() }
    const newHistory = [...messages, userMsg]
    setMessages(newHistory)
    setInput('')
    setLoading(true)
    try {
      const res = await api.chat.send({
        message: text.trim(),
        month: currentMonth(),
        history: newHistory.slice(-10),
      })
      setMessages([...newHistory, { role: 'assistant', content: res.reply }])
    } catch {
      setMessages([...newHistory, {
        role: 'assistant',
        content: 'Não consegui processar sua pergunta agora. Verifique sua conexão e tente novamente.',
      }])
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    sendMessage(input)
  }

  function handleClear() {
    setMessages([])
    setShowOnboarding(true)
    setInput('')
  }

  const suggestions = messages.length === 0 ? ONBOARDING_SUGGESTIONS : FINANCIAL_SUGGESTIONS

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100vh - 4rem)',
      maxWidth: 760,
      margin: '0 auto',
    }}>
      {/* Header */}
      <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#e5e7eb', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.5rem' }}>🤖</span> Previa Bot
          </h1>
          <p style={{ fontSize: '0.82rem', color: '#6b7280', margin: '0.2rem 0 0' }}>
            Assistente financeiro com dados reais da sua conta
          </p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={handleClear}
            style={{
              padding: '0.35rem 0.75rem',
              borderRadius: 8,
              border: '1px solid #2b3150',
              background: 'transparent',
              color: '#6b7280',
              fontSize: '0.78rem',
              cursor: 'pointer',
            }}
          >
            Limpar conversa
          </button>
        )}
      </div>

      {/* Atalhos rápidos */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {QUICK_ACTIONS.map((action) => (
          <Link
            key={action.to}
            to={action.to}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.35rem 0.75rem',
              borderRadius: 8,
              border: '1px solid #2b3150',
              background: '#141624',
              color: '#c7d2fe',
              fontSize: '0.78rem',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            <span>{action.icon}</span>
            {action.label}
          </Link>
        ))}
      </div>

      {/* Área de mensagens */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        paddingBottom: '1rem',
      }}>
        {/* Estado vazio — boas-vindas + sugestões de onboarding */}
        {messages.length === 0 && showOnboarding && (
          <div>
            {/* Mensagem de boas-vindas */}
            <div style={{
              padding: '1rem 1.25rem',
              borderRadius: '12px 12px 12px 4px',
              background: '#141624',
              border: '1px solid #1e2130',
              color: '#e5e7eb',
              fontSize: '0.9rem',
              lineHeight: 1.7,
              marginBottom: '1.25rem',
            }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(WELCOME_MESSAGE) }}
            />

            {/* Sugestões */}
            <p style={{ color: '#6b7280', fontSize: '0.82rem', marginBottom: '0.6rem', fontWeight: 600 }}>
              Perguntas frequentes:
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  style={{
                    padding: '0.4rem 0.85rem',
                    borderRadius: 999,
                    border: '1px solid #2b3150',
                    background: '#141624',
                    color: '#c7d2fe',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Histórico de mensagens */}
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <div style={{
              maxWidth: '82%',
              padding: '0.75rem 1rem',
              borderRadius: msg.role === 'user'
                ? '16px 16px 4px 16px'
                : '16px 16px 16px 4px',
              background: msg.role === 'user' ? '#6366f1' : '#141624',
              border: msg.role === 'assistant' ? '1px solid #1e2130' : 'none',
              color: '#e5e7eb',
              fontSize: '0.88rem',
              lineHeight: 1.65,
            }}
              dangerouslySetInnerHTML={{
                __html: msg.role === 'assistant'
                  ? renderMarkdown(msg.content)
                  : msg.content.replace(/\n/g, '<br />'),
              }}
            />
          </div>
        ))}

        {/* Indicador de carregamento */}
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{
              padding: '0.75rem 1rem',
              borderRadius: '16px 16px 16px 4px',
              background: '#141624',
              border: '1px solid #1e2130',
              color: '#6b7280',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}>
              <span style={{ display: 'inline-block', animation: 'none' }}>⏳</span>
              Analisando seus dados...
            </div>
          </div>
        )}

        {/* Sugestões contextuais após conversa iniciada */}
        {messages.length > 0 && !loading && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.25rem' }}>
            {FINANCIAL_SUGGESTIONS.slice(0, 3).map((s) => (
              <button
                key={s}
                onClick={() => sendMessage(s)}
                style={{
                  padding: '0.3rem 0.7rem',
                  borderRadius: 999,
                  border: '1px solid #2b3150',
                  background: 'transparent',
                  color: '#6b7280',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          gap: '0.75rem',
          paddingTop: '1rem',
          borderTop: '1px solid #1e2130',
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Pergunte sobre suas finanças..."
          disabled={loading}
          style={{
            flex: 1,
            padding: '0.75rem 1rem',
            borderRadius: 10,
            border: '1px solid #2b3150',
            background: '#141624',
            color: '#e5e7eb',
            fontSize: '0.9rem',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          style={{
            padding: '0.75rem 1.25rem',
            borderRadius: 10,
            border: 'none',
            background: loading || !input.trim() ? '#2b3150' : '#6366f1',
            color: '#fff',
            fontSize: '0.9rem',
            fontWeight: 700,
            cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Enviar
        </button>
      </form>
    </div>
  )
}

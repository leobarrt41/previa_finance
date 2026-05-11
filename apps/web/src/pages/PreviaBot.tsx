/**
 * PreviaBot.tsx — Chat Contextual Financeiro
 *
 * - Histórico apenas em memória (sem persistência)
 * - Envia o histórico da sessão a cada mensagem para contexto
 * - Classifica intenção no backend e busca dados relevantes
 */
import { useRef, useState, useEffect } from 'react'
import { api, currentMonth, formatBRL } from '../services/api'
import { Card, Button, SectionTitle } from '../components/ui'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatResponse {
  reply: string
  contextUsed: string[]
  month: string
  intent: string
}

// ---------------------------------------------------------------------------
// Sugestões de perguntas iniciais
// ---------------------------------------------------------------------------
const SUGGESTIONS = [
  'Como está meu orçamento este mês?',
  'Quanto tenho disponível para gastar?',
  'Quais são minhas maiores dívidas?',
  'Onde estou gastando mais?',
  'Qual é minha previsão de gastos para o próximo mês?',
  'Tenho alguma fatura vencendo em breve?',
]

// ---------------------------------------------------------------------------
// Componente de mensagem
// ---------------------------------------------------------------------------
function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'
  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: '0.75rem',
    }}>
      {!isUser && (
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: '#6366f1', display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: '1rem', flexShrink: 0,
          marginRight: '0.5rem', marginTop: 2,
        }}>
          🤖
        </div>
      )}
      <div style={{
        maxWidth: '75%',
        padding: '0.65rem 0.9rem',
        borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        background: isUser ? '#6366f1' : '#1e2130',
        color: '#e5e7eb',
        fontSize: '0.88rem',
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
      }}>
        {msg.content}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export function PreviaBot() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [month] = useState(currentMonth())
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Scroll automático para o fim
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function sendMessage(text: string) {
    const trimmed = text.trim()
    if (!trimmed || loading) return

    const userMsg: ChatMessage = { role: 'user', content: trimmed }
    const newHistory = [...messages, userMsg]
    setMessages(newHistory)
    setInput('')
    setLoading(true)
    setError(null)

    try {
      // Envia histórico sem a última mensagem do utilizador (já está em `message`)
      const historyToSend = messages.slice(-10).map(m => ({ role: m.role, content: m.content }))
      const data = await api.chat.send({
        message: trimmed,
        month,
        history: historyToSend,
      })
      const botMsg: ChatMessage = { role: 'assistant', content: data.reply }
      setMessages(prev => [...prev, botMsg])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro ao enviar mensagem')
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage(input)
    }
  }

  const isEmpty = messages.length === 0

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 6rem)' }}>
      {/* Cabeçalho */}
      <div style={{ marginBottom: '1rem', flexShrink: 0 }}>
        <SectionTitle>Previa Bot 🤖</SectionTitle>
        <p style={{ color: '#9ca3af', fontSize: '0.85rem', marginTop: 0 }}>
          Pergunte sobre seu orçamento, dívidas, gastos ou previsões. O bot busca seus dados em tempo real.
        </p>
      </div>

      {/* Área de mensagens */}
      <Card style={{ flex: 1, overflowY: 'auto', marginBottom: '1rem', padding: '1rem', minHeight: 0 }}>
        {isEmpty ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1.5rem' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🤖</div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#e5e7eb', marginBottom: 4 }}>Olá! Sou o Previa Bot.</div>
              <div style={{ fontSize: '0.85rem', color: '#9ca3af' }}>
                Tenho acesso aos seus dados financeiros e posso responder perguntas sobre eles.
              </div>
            </div>
            {/* Sugestões */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center', maxWidth: 500 }}>
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => void sendMessage(s)}
                  style={{
                    background: '#1e2130',
                    border: '1px solid #2a2f45',
                    borderRadius: 20,
                    padding: '0.4rem 0.85rem',
                    color: '#9ca3af',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { (e.target as HTMLButtonElement).style.color = '#e5e7eb'; (e.target as HTMLButtonElement).style.borderColor = '#6366f1' }}
                  onMouseLeave={e => { (e.target as HTMLButtonElement).style.color = '#9ca3af'; (e.target as HTMLButtonElement).style.borderColor = '#2a2f45' }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} />
            ))}
            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: '#6366f1', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: '1rem', flexShrink: 0,
                }}>
                  🤖
                </div>
                <div style={{ background: '#1e2130', borderRadius: '16px 16px 16px 4px', padding: '0.65rem 0.9rem' }}>
                  <span style={{ color: '#6b7280', fontSize: '0.85rem' }}>Consultando seus dados</span>
                  <span style={{ color: '#6366f1', animation: 'none' }}> ...</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </>
        )}
      </Card>

      {/* Erro */}
      {error && (
        <div style={{ color: '#f87171', fontSize: '0.82rem', marginBottom: '0.5rem', padding: '0.5rem 0.75rem', background: 'rgba(248,113,113,0.08)', borderRadius: 8 }}>
          {error}
        </div>
      )}

      {/* Input */}
      <div style={{ flexShrink: 0, display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pergunte sobre suas finanças... (Enter para enviar, Shift+Enter para nova linha)"
            rows={2}
            style={{
              width: '100%',
              background: '#141624',
              border: '1px solid #2a2f45',
              borderRadius: 12,
              padding: '0.75rem 1rem',
              color: '#e5e7eb',
              fontSize: '0.9rem',
              resize: 'none',
              outline: 'none',
              boxSizing: 'border-box',
              lineHeight: 1.5,
            }}
            onFocus={e => { e.target.style.borderColor = '#6366f1' }}
            onBlur={e => { e.target.style.borderColor = '#2a2f45' }}
            disabled={loading}
          />
        </div>
        <Button
          onClick={() => void sendMessage(input)}
          disabled={loading || !input.trim()}
          variant="primary"
          style={{ height: 56, paddingLeft: '1.25rem', paddingRight: '1.25rem', flexShrink: 0 }}
        >
          {loading ? '...' : '↑'}
        </Button>
      </div>

      {/* Rodapé informativo */}
      <div style={{ textAlign: 'center', marginTop: '0.5rem', fontSize: '0.72rem', color: '#4b5563' }}>
        O histórico desta conversa é mantido apenas enquanto a página estiver aberta. Mês de referência: {month}.
      </div>
    </div>
  )
}

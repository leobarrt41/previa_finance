/**
 * PreviaBot.tsx — Chat contextual financeiro com IA
 */
import { useState, useRef, useEffect, FormEvent } from 'react'
import { api } from '../services/api'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTIONS = [
  'Como está meu orçamento este mês?',
  'Quais são minhas maiores despesas?',
  'Tenho faturas em aberto?',
  'Posso fazer uma compra de R$ 500?',
  'Como está meu fluxo de caixa?',
  'Estou endividado?',
]

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function PreviaBot() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return
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
      setMessages([...newHistory, { role: 'assistant', content: 'Erro ao processar. Tente novamente.' }])
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    sendMessage(input)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 4rem)', maxWidth: 720, margin: '0 auto' }}>
      <div style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#e5e7eb', margin: 0 }}>🤖 Previa Bot</h1>
        <p style={{ fontSize: '0.85rem', color: '#6b7280', margin: '0.25rem 0 0' }}>
          Pergunte sobre suas finanças. O histórico é apagado ao fechar a página.
        </p>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem', paddingBottom: '1rem' }}>
        {messages.length === 0 && (
          <div>
            <p style={{ color: '#6b7280', fontSize: '0.9rem', marginBottom: '1rem' }}>Sugestões:</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => sendMessage(s)}
                  style={{ padding: '0.45rem 0.9rem', borderRadius: 999, border: '1px solid #2b3150', background: '#141624', color: '#c7d2fe', fontSize: '0.82rem', cursor: 'pointer' }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{ maxWidth: '80%', padding: '0.75rem 1rem', borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px', background: msg.role === 'user' ? '#6366f1' : '#141624', border: msg.role === 'assistant' ? '1px solid #1e2130' : 'none', color: '#e5e7eb', fontSize: '0.9rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ padding: '0.75rem 1rem', borderRadius: '16px 16px 16px 4px', background: '#141624', border: '1px solid #1e2130', color: '#6b7280', fontSize: '0.85rem' }}>
              Analisando seus dados...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '0.75rem', paddingTop: '1rem', borderTop: '1px solid #1e2130' }}>
        <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="Pergunte algo sobre suas finanças..." disabled={loading}
          style={{ flex: 1, padding: '0.75rem 1rem', borderRadius: 10, border: '1px solid #2b3150', background: '#141624', color: '#e5e7eb', fontSize: '0.9rem', outline: 'none' }} />
        <button type="submit" disabled={loading || !input.trim()}
          style={{ padding: '0.75rem 1.25rem', borderRadius: 10, border: 'none', background: loading || !input.trim() ? '#2b3150' : '#6366f1', color: '#fff', fontSize: '0.9rem', fontWeight: 700, cursor: loading || !input.trim() ? 'not-allowed' : 'pointer' }}>
          Enviar
        </button>
      </form>
    </div>
  )
}

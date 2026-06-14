import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * PreviaBot.tsx — Chat contextual financeiro com IA
 *
 * Funcionalidades:
 * - Sugestões de onboarding para novos utilizadores
 * - Atalhos rápidos para os fluxos principais do MVP
 * - Contexto financeiro real injectado pelo backend
 * - Respostas em linguagem natural sobre finanças pessoais
 */
import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../services/api';
// ---------------------------------------------------------------------------
// Sugestões por contexto
// ---------------------------------------------------------------------------
const ONBOARDING_SUGGESTIONS = [
    'Como funciona o Previa Finance?',
    'Como importo minha fatura de cartão?',
    'Qual a diferença entre extrato e fatura?',
    'O que é o período de trial?',
    'Como funciona a projeção de caixa?',
];
const FINANCIAL_SUGGESTIONS = [
    'Como está meu orçamento este mês?',
    'Quais são minhas maiores despesas?',
    'Tenho faturas em aberto?',
    'Posso fazer uma compra de R$ 500?',
    'Como está meu fluxo de caixa?',
    'Qual minha categoria de maior gasto?',
];
// ---------------------------------------------------------------------------
// Atalhos rápidos para os fluxos do MVP
// ---------------------------------------------------------------------------
const QUICK_ACTIONS = [
    { label: 'Importar fatura', to: '/invoices/upload', icon: '📄' },
    { label: 'Ver cashflow', to: '/cashflow', icon: '📈' },
    { label: 'Transações', to: '/transactions', icon: '💳' },
    { label: 'Simular compra', to: '/budget', icon: '🛒' },
];
// ---------------------------------------------------------------------------
// Mensagem de boas-vindas
// ---------------------------------------------------------------------------
const WELCOME_MESSAGE = `Olá! Sou o **Previa Bot**, seu assistente financeiro.

Posso ajudar você a entender suas finanças com base nos seus dados reais — receitas, despesas, faturas de cartão e projeção de caixa.

**Para começar**, importe sua fatura de cartão (PDF) ou extrato bancário. Depois, pergunte o que quiser sobre suas finanças.

O que você gostaria de saber?`;
function currentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
const MONTH_ALIASES = {
    janeiro: 1,
    fevereiro: 2,
    marco: 3,
    abril: 4,
    maio: 5,
    junho: 6,
    julho: 7,
    agosto: 8,
    setembro: 9,
    outubro: 10,
    novembro: 11,
    dezembro: 12,
};
function shiftMonth(month, offset) {
    const [year, monthIndex] = month.split('-').map(Number);
    const d = new Date(Date.UTC(year, monthIndex - 1 + offset, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function normalizeMonthText(text) {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}
function detectMonthFromText(text) {
    const normalized = normalizeMonthText(text);
    if (/\b(este|esse|nesse) mes\b|\bmes atual\b/.test(normalized))
        return currentMonth();
    if (/\bmes passado\b|\bultimo mes\b|\bmes anterior\b/.test(normalized))
        return shiftMonth(currentMonth(), -1);
    const explicit = normalized.match(/\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s+de\s+(\d{4}))?\b/);
    if (!explicit)
        return null;
    const month = MONTH_ALIASES[explicit[1]];
    const year = explicit[2] ? Number(explicit[2]) : new Date().getFullYear();
    if (!month || !Number.isInteger(year))
        return null;
    return `${year}-${String(month).padStart(2, '0')}`;
}
function renderMarkdown(text) {
    return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br />');
}
export function PreviaBot() {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [showOnboarding, setShowOnboarding] = useState(true);
    const bottomRef = useRef(null);
    const inputRef = useRef(null);
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, loading]);
    function formatChatError(error) {
        if (error instanceof ApiError) {
            return 'Erro ao consultar o chat (' + String(error.status) + '): ' + error.message;
        }
        if (error instanceof Error) {
            return 'Falha ao consultar o chat: ' + error.message;
        }
        return 'Falha ao consultar o chat: erro desconhecido.';
    }
    async function sendMessage(text) {
        if (!text.trim() || loading)
            return;
        setShowOnboarding(false);
        const userMsg = { role: 'user', content: text.trim() };
        const newHistory = [...messages, userMsg];
        setMessages(newHistory);
        setInput('');
        setLoading(true);
        try {
            const res = await api.chat.send({
                message: text.trim(),
                month: detectMonthFromText(text.trim()) ?? currentMonth(),
                history: newHistory.slice(-10),
            });
            setMessages([...newHistory, { role: 'assistant', content: res.reply }]);
        }
        catch (error) {
            console.error('[PreviaBot] chat send failed:', error);
            setMessages([...newHistory, {
                    role: 'assistant',
                    content: formatChatError(error),
                }]);
        }
        finally {
            setLoading(false);
            setTimeout(() => inputRef.current?.focus(), 100);
        }
    }
    function handleSubmit(e) {
        e.preventDefault();
        sendMessage(input);
    }
    function handleClear() {
        setMessages([]);
        setShowOnboarding(true);
        setInput('');
    }
    const suggestions = messages.length === 0 ? ONBOARDING_SUGGESTIONS : FINANCIAL_SUGGESTIONS;
    return (_jsxs("div", { style: {
            display: 'flex',
            flexDirection: 'column',
            height: 'calc(100vh - 4rem)',
            maxWidth: 760,
            margin: '0 auto',
        }, children: [_jsxs("div", { style: { marginBottom: '1rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }, children: [_jsxs("div", { children: [_jsxs("h1", { style: { fontSize: '1.35rem', fontWeight: 800, color: '#e5e7eb', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }, children: [_jsx("span", { style: { fontSize: '1.5rem' }, children: "\uD83E\uDD16" }), " Previa Bot"] }), _jsx("p", { style: { fontSize: '0.82rem', color: '#6b7280', margin: '0.2rem 0 0' }, children: "Assistente financeiro com dados reais da sua conta" })] }), messages.length > 0 && (_jsx("button", { onClick: handleClear, style: {
                            padding: '0.35rem 0.75rem',
                            borderRadius: 8,
                            border: '1px solid #2b3150',
                            background: 'transparent',
                            color: '#6b7280',
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                        }, children: "Limpar conversa" }))] }), _jsx("div", { style: { display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }, children: QUICK_ACTIONS.map((action) => (_jsxs(Link, { to: action.to, style: {
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
                    }, children: [_jsx("span", { children: action.icon }), action.label] }, action.to))) }), _jsxs("div", { style: {
                    flex: 1,
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem',
                    paddingBottom: '1rem',
                }, children: [messages.length === 0 && showOnboarding && (_jsxs("div", { children: [_jsx("div", { style: {
                                    padding: '1rem 1.25rem',
                                    borderRadius: '12px 12px 12px 4px',
                                    background: '#141624',
                                    border: '1px solid #1e2130',
                                    color: '#e5e7eb',
                                    fontSize: '0.9rem',
                                    lineHeight: 1.7,
                                    marginBottom: '1.25rem',
                                }, dangerouslySetInnerHTML: { __html: renderMarkdown(WELCOME_MESSAGE) } }), _jsx("p", { style: { color: '#6b7280', fontSize: '0.82rem', marginBottom: '0.6rem', fontWeight: 600 }, children: "Perguntas frequentes:" }), _jsx("div", { style: { display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }, children: suggestions.map((s) => (_jsx("button", { onClick: () => sendMessage(s), style: {
                                        padding: '0.4rem 0.85rem',
                                        borderRadius: 999,
                                        border: '1px solid #2b3150',
                                        background: '#141624',
                                        color: '#c7d2fe',
                                        fontSize: '0.8rem',
                                        cursor: 'pointer',
                                        transition: 'border-color 0.15s',
                                    }, children: s }, s))) })] })), messages.map((msg, i) => (_jsx("div", { style: {
                            display: 'flex',
                            justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                        }, children: _jsx("div", { style: {
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
                            }, dangerouslySetInnerHTML: {
                                __html: msg.role === 'assistant'
                                    ? renderMarkdown(msg.content)
                                    : msg.content.replace(/\n/g, '<br />'),
                            } }) }, i))), loading && (_jsx("div", { style: { display: 'flex', justifyContent: 'flex-start' }, children: _jsxs("div", { style: {
                                padding: '0.75rem 1rem',
                                borderRadius: '16px 16px 16px 4px',
                                background: '#141624',
                                border: '1px solid #1e2130',
                                color: '#6b7280',
                                fontSize: '0.85rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                            }, children: [_jsx("span", { style: { display: 'inline-block', animation: 'none' }, children: "\u23F3" }), "Analisando seus dados..."] }) })), messages.length > 0 && !loading && (_jsx("div", { style: { display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.25rem' }, children: FINANCIAL_SUGGESTIONS.slice(0, 3).map((s) => (_jsx("button", { onClick: () => sendMessage(s), style: {
                                padding: '0.3rem 0.7rem',
                                borderRadius: 999,
                                border: '1px solid #2b3150',
                                background: 'transparent',
                                color: '#6b7280',
                                fontSize: '0.75rem',
                                cursor: 'pointer',
                            }, children: s }, s))) })), _jsx("div", { ref: bottomRef })] }), _jsxs("form", { onSubmit: handleSubmit, style: {
                    display: 'flex',
                    gap: '0.75rem',
                    paddingTop: '1rem',
                    borderTop: '1px solid #1e2130',
                }, children: [_jsx("input", { ref: inputRef, type: "text", value: input, onChange: (e) => setInput(e.target.value), placeholder: "Pergunte sobre suas finan\u00E7as...", disabled: loading, style: {
                            flex: 1,
                            padding: '0.75rem 1rem',
                            borderRadius: 10,
                            border: '1px solid #2b3150',
                            background: '#141624',
                            color: '#e5e7eb',
                            fontSize: '0.9rem',
                            outline: 'none',
                        } }), _jsx("button", { type: "submit", disabled: loading || !input.trim(), style: {
                            padding: '0.75rem 1.25rem',
                            borderRadius: 10,
                            border: 'none',
                            background: loading || !input.trim() ? '#2b3150' : '#6366f1',
                            color: '#fff',
                            fontSize: '0.9rem',
                            fontWeight: 700,
                            cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                            whiteSpace: 'nowrap',
                        }, children: "Enviar" })] })] }));
}

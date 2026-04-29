import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../services/api';
const NAV_ITEMS = [
    { to: '/', label: 'Dashboard', icon: '🏠' },
    { to: '/cashflow', label: 'CashFlow', icon: '📈' },
    { to: '/budget', label: 'Orçamento', icon: '🎯' },
    { to: '/accounts', label: 'Contas', icon: '🏦' },
    { to: '/statements/upload', label: 'Upload Extrato', icon: '🧾' },
    { to: '/invoices/upload', label: 'Upload Fatura', icon: '📤' },
    { to: '/categories', label: 'Categorias', icon: '🏷️' },
];
export function Layout({ children }) {
    const [authLabel, setAuthLabel] = useState('Carregando usuario...');
    useEffect(() => {
        let active = true;
        api.auth.me()
            .then((me) => {
            if (!active)
                return;
            setAuthLabel(`${me.clerkUserId} (owner ${me.ownerId})`);
        })
            .catch(() => {
            if (!active)
                return;
            setAuthLabel('Nao autenticado');
        });
        return () => {
            active = false;
        };
    }, []);
    return (_jsxs("div", { style: { display: 'flex', minHeight: '100vh', background: '#0f1117', color: '#e5e7eb' }, children: [_jsxs("aside", { style: {
                    width: 220,
                    minHeight: '100vh',
                    background: '#141624',
                    borderRight: '1px solid #1e2130',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '1.5rem 0',
                    flexShrink: 0,
                }, children: [_jsx("div", { style: { padding: '0 1.5rem 1.5rem', borderBottom: '1px solid #1e2130' }, children: _jsx("span", { style: { fontWeight: 800, fontSize: '1.1rem', color: '#6366f1', letterSpacing: '-0.02em' }, children: "Previa Finance" }) }), _jsx("nav", { style: { padding: '1rem 0.75rem', display: 'flex', flexDirection: 'column', gap: 4 }, children: NAV_ITEMS.map(({ to, label, icon }) => (_jsxs(NavLink, { to: to, end: to === '/', style: ({ isActive }) => ({
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
                            }), children: [_jsx("span", { children: icon }), _jsx("span", { children: label })] }, to))) }), _jsx("div", { style: { marginTop: 'auto', padding: '1rem 1.5rem', borderTop: '1px solid #1e2130' }, children: _jsx("span", { style: { fontSize: '0.7rem', color: '#4b5563' }, children: "MVP \u00B7 feat/frontend-manus" }) })] }), _jsxs("main", { style: { flex: 1, padding: '2rem', overflowY: 'auto' }, children: [_jsxs("div", { style: {
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
                        }, children: [_jsx("span", { children: "Usuario ativo:" }), _jsx("span", { style: { color: '#e0e7ff' }, children: authLabel })] }), children] })] }));
}

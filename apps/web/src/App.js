import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SignIn, SignUp, SignedIn, SignedOut, RedirectToSignIn } from '@clerk/clerk-react';
import { Layout } from './components/Layout';
import { Landing } from './pages/Landing';
import { Dashboard } from './pages/Dashboard';
import { CashFlow } from './pages/CashFlow';
import { Budget } from './pages/Budget';
import { Categories } from './pages/Categories';
import { Accounts } from './pages/Accounts';
import { AccountDetail } from './pages/AccountDetail';
import { InvoiceUpload } from './pages/InvoiceUpload';
import { StatementUpload } from './pages/StatementUpload';
import { SpendingAssessor } from './pages/SpendingAssessor';
import { DebtAssessor } from './pages/DebtAssessor';
import ReceiptDocuments from './pages/ReceiptDocuments';
import { PreviaBot } from './pages/PreviaBot';
import { Upgrade } from './pages/Upgrade';
const DEV_AUTH_BYPASS = import.meta.env.VITE_DEV_AUTH_BYPASS === 'true';
const AFTER_SIGN_IN_URL = import.meta.env.VITE_CLERK_AFTER_SIGN_IN_URL ?? '/dashboard';
const AFTER_SIGN_UP_URL = import.meta.env.VITE_CLERK_AFTER_SIGN_UP_URL ?? '/dashboard';
/**
 * ProtectedRoute — redireciona para /sign-in se não autenticado.
 * Usa SignedIn/SignedOut do Clerk para proteger as rotas internas.
 * Em dev, quando VITE_DEV_AUTH_BYPASS=true, o acesso é liberado sem Clerk.
 */
function ProtectedRoute({ children }) {
    if (DEV_AUTH_BYPASS) {
        return _jsx(_Fragment, { children: children });
    }
    return (_jsxs(_Fragment, { children: [_jsx(SignedIn, { children: children }), _jsx(SignedOut, { children: _jsx(RedirectToSignIn, {}) })] }));
}
export default function App() {
    return (_jsx(BrowserRouter, { children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(Landing, { devAuthBypass: DEV_AUTH_BYPASS }) }), !DEV_AUTH_BYPASS && (_jsxs(_Fragment, { children: [_jsx(Route, { path: "/sign-in/*", element: _jsx("div", { style: {
                                    minHeight: '100vh',
                                    background: '#0f1117',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }, children: _jsx(SignIn, { routing: "path", path: "/sign-in", afterSignInUrl: AFTER_SIGN_IN_URL }) }) }), _jsx(Route, { path: "/sign-up/*", element: _jsx("div", { style: {
                                    minHeight: '100vh',
                                    background: '#0f1117',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }, children: _jsx(SignUp, { routing: "path", path: "/sign-up", afterSignUpUrl: AFTER_SIGN_UP_URL }) }) })] })), _jsx(Route, { path: "/*", element: _jsx(ProtectedRoute, { children: _jsx(Layout, { children: _jsxs(Routes, { children: [_jsx(Route, { path: "/dashboard", element: _jsx(Dashboard, {}) }), _jsx(Route, { path: "/cashflow", element: _jsx(CashFlow, {}) }), _jsx(Route, { path: "/budget", element: _jsx(Budget, {}) }), _jsx(Route, { path: "/accounts", element: _jsx(Accounts, {}) }), _jsx(Route, { path: "/accounts/:accountId", element: _jsx(AccountDetail, {}) }), _jsx(Route, { path: "/categories", element: _jsx(Categories, {}) }), _jsx(Route, { path: "/statements/upload", element: _jsx(StatementUpload, {}) }), _jsx(Route, { path: "/invoices/upload", element: _jsx(InvoiceUpload, {}) }), _jsx(Route, { path: "/assess/spending", element: _jsx(SpendingAssessor, {}) }), _jsx(Route, { path: "/assess/debt", element: _jsx(DebtAssessor, {}) }), _jsx(Route, { path: "/receipt-documents", element: _jsx(ReceiptDocuments, {}) }), _jsx(Route, { path: "/chat", element: _jsx(PreviaBot, {}) }), _jsx(Route, { path: "/upgrade", element: _jsx(Upgrade, {}) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/dashboard", replace: true }) })] }) }) }) })] }) }));
}

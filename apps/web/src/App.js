import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
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
export default function App() {
    return (_jsx(BrowserRouter, { children: _jsx(Layout, { children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(Dashboard, {}) }), _jsx(Route, { path: "/cashflow", element: _jsx(CashFlow, {}) }), _jsx(Route, { path: "/budget", element: _jsx(Budget, {}) }), _jsx(Route, { path: "/accounts", element: _jsx(Accounts, {}) }), _jsx(Route, { path: "/accounts/:accountId", element: _jsx(AccountDetail, {}) }), _jsx(Route, { path: "/categories", element: _jsx(Categories, {}) }), _jsx(Route, { path: "/statements/upload", element: _jsx(StatementUpload, {}) }), _jsx(Route, { path: "/invoices/upload", element: _jsx(InvoiceUpload, {}) }), _jsx(Route, { path: "/assess/spending", element: _jsx(SpendingAssessor, {}) }), _jsx(Route, { path: "/assess/debt", element: _jsx(DebtAssessor, {}) }), _jsx(Route, { path: "/receipt-documents", element: _jsx(ReceiptDocuments, {}) })] }) }) }));
}

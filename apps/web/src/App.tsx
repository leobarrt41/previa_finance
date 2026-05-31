import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Landing } from './pages/Landing'
import { Dashboard } from './pages/Dashboard'
import { CashFlow } from './pages/CashFlow'
import { Budget } from './pages/Budget'
import { Categories } from './pages/Categories'
import { Accounts } from './pages/Accounts'
import { AccountDetail } from './pages/AccountDetail'
import { InvoiceUpload } from './pages/InvoiceUpload'
import { StatementUpload } from './pages/StatementUpload'
import { SpendingAssessor } from './pages/SpendingAssessor'
import { DebtAssessor } from './pages/DebtAssessor'
import ReceiptDocuments from './pages/ReceiptDocuments'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Rota pública — sem Layout (sidebar) */}
        <Route path="/" element={<Landing />} />

        {/* Rotas autenticadas — com Layout (sidebar) */}
        <Route
          path="/*"
          element={
            <Layout>
              <Routes>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/cashflow" element={<CashFlow />} />
                <Route path="/budget" element={<Budget />} />
                <Route path="/accounts" element={<Accounts />} />
                <Route path="/accounts/:accountId" element={<AccountDetail />} />
                <Route path="/categories" element={<Categories />} />
                <Route path="/statements/upload" element={<StatementUpload />} />
                <Route path="/invoices/upload" element={<InvoiceUpload />} />
                <Route path="/assess/spending" element={<SpendingAssessor />} />
                <Route path="/assess/debt" element={<DebtAssessor />} />
                <Route path="/receipt-documents" element={<ReceiptDocuments />} />
              </Routes>
            </Layout>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}

import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { CashFlow } from './pages/CashFlow'
import { Budget } from './pages/Budget'
import { Categories } from './pages/Categories'
import { Accounts } from './pages/Accounts'
import { AccountDetail } from './pages/AccountDetail'
import { InvoiceUpload } from './pages/InvoiceUpload'
import { StatementUpload } from './pages/StatementUpload'

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/cashflow" element={<CashFlow />} />
          <Route path="/budget" element={<Budget />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/accounts/:accountId" element={<AccountDetail />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/statements/upload" element={<StatementUpload />} />
          <Route path="/invoices/upload" element={<InvoiceUpload />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}

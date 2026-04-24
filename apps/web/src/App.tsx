import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { CashFlow } from './pages/CashFlow'
import { Budget } from './pages/Budget'
import { Categories } from './pages/Categories'
import { InvoiceUpload } from './pages/InvoiceUpload'

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/cashflow" element={<CashFlow />} />
          <Route path="/budget" element={<Budget />} />
          <Route path="/categories" element={<Categories />} />
          <Route path="/invoices/upload" element={<InvoiceUpload />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}

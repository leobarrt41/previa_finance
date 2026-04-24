import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { CashFlow } from './pages/CashFlow'
import { Budget } from './pages/Budget'

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/cashflow" element={<CashFlow />} />
          <Route path="/budget" element={<Budget />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}

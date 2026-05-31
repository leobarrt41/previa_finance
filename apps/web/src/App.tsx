import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { SignIn, SignUp, SignedIn, SignedOut, RedirectToSignIn } from '@clerk/clerk-react'
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
import { PreviaBot } from './pages/PreviaBot'

/**
 * ProtectedRoute — redireciona para /sign-in se não autenticado.
 * Usa SignedIn/SignedOut do Clerk para proteger as rotas internas.
 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ── Rotas públicas ──────────────────────────────────────── */}
        <Route path="/" element={<Landing />} />

        {/* Clerk Hosted Components embutidos nas rotas */}
        <Route
          path="/sign-in/*"
          element={
            <div style={{
              minHeight: '100vh',
              background: '#0f1117',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <SignIn routing="path" path="/sign-in" afterSignInUrl="/dashboard" />
            </div>
          }
        />
        <Route
          path="/sign-up/*"
          element={
            <div style={{
              minHeight: '100vh',
              background: '#0f1117',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <SignUp routing="path" path="/sign-up" afterSignUpUrl="/dashboard" />
            </div>
          }
        />

        {/* ── Rotas autenticadas ───────────────────────────────────── */}
        <Route
          path="/*"
          element={
            <ProtectedRoute>
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
                  <Route path="/chat" element={<PreviaBot />} />
                  {/* Fallback — redireciona para dashboard */}
                  <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Routes>
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}

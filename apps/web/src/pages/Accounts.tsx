import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type AccountSummary } from '../services/api'
import { Alert, Badge, Card, EmptyState, SectionTitle, Spinner } from '../components/ui'

export function Accounts() {
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const navigate = useNavigate()

  async function loadAccounts() {
    setLoading(true)
    setErrorMsg('')
    try {
      const result = await api.accounts.list()
      setAccounts(result.items)
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Erro ao carregar contas')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAccounts().catch(() => {})
  }, [])

  const hasAccounts = useMemo(() => accounts.length > 0, [accounts])
  const bankAccounts = useMemo(
    () => accounts.filter((account) => account.financialChannel === 'bank_account'),
    [accounts],
  )
  const invoiceAccounts = useMemo(
    () => accounts.filter((account) => account.financialChannel === 'credit_card'),
    [accounts],
  )

  function renderAccountCard(account: AccountSummary) {
    const totalMonths =
      new Set([
        ...account.invoiceMonths.map((m) => m.month),
        ...account.bankMonths.map((m) => m.month),
      ]).size

    return (
      <Card
        key={account.id}
        style={{ cursor: 'pointer', transition: 'border-color 0.15s' }}
        className="account-card"
        onClick={() => navigate(`/accounts/${account.id}`)}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <SectionTitle style={{ marginBottom: '0.3rem' }}>{account.displayName}</SectionTitle>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <Badge variant="blue">{account.financialChannel}</Badge>
              <Badge variant="gray">{account.type}</Badge>
              {account.institutionName && <Badge variant="gray">{account.institutionName}</Badge>}
              {account.cardBrand && <Badge variant="gray">{account.cardBrand}</Badge>}
              {account.cardLast4 && <Badge variant="gray">**** {account.cardLast4}</Badge>}
            </div>
          </div>

          <div style={{ fontSize: '0.8rem', color: '#9ca3af', textAlign: 'right' }}>
            <div>{totalMonths} {totalMonths === 1 ? 'mês' : 'meses'}</div>
            <div style={{ marginTop: '0.15rem', color: '#6366f1', fontSize: '0.78rem' }}>Ver detalhes →</div>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <div style={{ maxWidth: 960 }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#e5e7eb', margin: 0 }}>
          Contas
        </h1>
        <p style={{ color: '#6b7280', marginTop: '0.3rem', fontSize: '0.85rem' }}>
          Contas ativas com extratos ou faturas importadas. Clique em uma conta para ver os meses.
        </p>
      </div>

      {loading && (
        <Card style={{ textAlign: 'center', padding: '2.5rem' }}>
          <Spinner size={36} />
        </Card>
      )}

      {!loading && errorMsg && (
        <Alert variant="error" style={{ marginBottom: '1rem' }}>
          {errorMsg}
        </Alert>
      )}

      {!loading && !hasAccounts && (
        <Card>
          <EmptyState
            icon="🏦"
            title="Nenhuma conta ativa"
            description="Importe um extrato bancario ou uma fatura de cartao para ver contas aqui."
          />
        </Card>
      )}

      {!loading && hasAccounts && (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div>
            <h2 style={{ fontSize: '1rem', margin: '0 0 0.6rem 0', color: '#c7d2fe', fontWeight: 700 }}>
              Contas bancárias (extratos)
            </h2>
            <div style={{ display: 'grid', gap: '0.8rem' }}>
              {bankAccounts.length > 0 ? (
                bankAccounts.map((account) => renderAccountCard(account))
              ) : (
                <Card>
                  <EmptyState
                    icon="🏦"
                    title="Sem extratos bancarios"
                    description="Nenhum extrato importado para o usuario ativo."
                  />
                </Card>
              )}
            </div>
          </div>

          <div style={{ marginTop: '0.4rem' }}>
            <h2 style={{ fontSize: '1rem', margin: '0 0 0.6rem 0', color: '#c7d2fe', fontWeight: 700 }}>
              Faturas de cartão
            </h2>
            <div style={{ display: 'grid', gap: '0.8rem' }}>
              {invoiceAccounts.length > 0 ? (
                invoiceAccounts.map((account) => renderAccountCard(account))
              ) : (
                <Card>
                  <EmptyState
                    icon="💳"
                    title="Sem faturas de cartao"
                    description="Nenhuma fatura importada para o usuario ativo."
                  />
                </Card>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

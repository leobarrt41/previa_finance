import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  api,
  formatBRL,
  type AccountInvoiceDetails,
  type AccountStatementDetails,
  type AccountSummary,
  type Category,
} from '../services/api'
import { Alert, Badge, Button, Card, Spinner } from '../components/ui'

function getAllMonths(acc: AccountSummary): string[] {
  const set = new Set<string>()
  for (const m of acc.bankMonths) set.add(m.month)
  for (const m of acc.invoiceMonths) set.add(m.month)
  for (const m of acc.receiptMonths) set.add(m.month)
  return Array.from(set).sort((a, b) => b.localeCompare(a))
}

export function AccountDetail() {
  const { accountId } = useParams<{ accountId: string }>()
  const navigate = useNavigate()

  const [account, setAccount] = useState<AccountSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [activeMonth, setActiveMonth] = useState<string>('')
  const [deleting, setDeleting] = useState(false)
  const [invoiceDetails, setInvoiceDetails] = useState<AccountInvoiceDetails | null>(null)
  const [invoiceLoading, setInvoiceLoading] = useState(false)
  const [invoiceError, setInvoiceError] = useState('')
  const [statementDetails, setStatementDetails] = useState<AccountStatementDetails | null>(null)
  const [statementLoading, setStatementLoading] = useState(false)
  const [statementError, setStatementError] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [updatingTxId, setUpdatingTxId] = useState<number | null>(null)

  async function loadAccount(keepActiveMonth = false) {
    setLoading(true)
    setErrorMsg('')
    try {
      const result = await api.accounts.list()
      const found = result.items.find((a) => a.id === Number(accountId))
      if (!found) {
        setErrorMsg('Conta não encontrada.')
        return
      }
      setAccount(found)
      if (!keepActiveMonth) {
        const months = getAllMonths(found)
        if (months.length > 0) setActiveMonth(months[0])
      }
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Erro ao carregar conta')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAccount().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  useEffect(() => {
    api.categories.list().then(setCategories).catch(() => {})
  }, [])

  useEffect(() => {
    if (!account || !activeMonth) {
      setInvoiceDetails(null)
      return
    }

    const accountIdValue = account.id

    let cancelled = false
    async function loadInvoice() {
      setInvoiceLoading(true)
      setInvoiceError('')
      try {
        const details = await api.accounts.invoiceDetails(accountIdValue, activeMonth)
        if (!cancelled) setInvoiceDetails(details)
      } catch (error) {
        if (!cancelled) {
          setInvoiceDetails(null)
          setInvoiceError(error instanceof Error ? error.message : 'Erro ao carregar fatura')
        }
      } finally {
        if (!cancelled) setInvoiceLoading(false)
      }
    }

    loadInvoice().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [account, activeMonth])

  useEffect(() => {
    if (!account || !activeMonth) {
      setStatementDetails(null)
      return
    }

    const accountIdValue = account.id

    let cancelled = false
    async function loadStatement() {
      setStatementLoading(true)
      setStatementError('')
      try {
        const details = await api.accounts.statementDetails(accountIdValue, activeMonth)
        if (!cancelled) setStatementDetails(details)
      } catch (error) {
        if (!cancelled) {
          setStatementDetails(null)
          setStatementError(error instanceof Error ? error.message : 'Erro ao carregar extrato')
        }
      } finally {
        if (!cancelled) setStatementLoading(false)
      }
    }

    loadStatement().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [account, activeMonth])

  async function handleDeleteMonth() {
    if (!account || !activeMonth) return
    const ok = window.confirm(
      `Excluir todos os dados de ${activeMonth} para "${account.displayName}"?\nEsta ação não pode ser desfeita.`,
    )
    if (!ok) return

    setDeleting(true)
    setErrorMsg('')
    try {
      const result = await api.accounts.deleteByMonth(account.id, activeMonth)
      if (!result.hasRemainingData) {
        navigate('/accounts')
        return
      }
      // reload and pick the next available month
      const updatedResult = await api.accounts.list()
      const updated = updatedResult.items.find((a) => a.id === account.id)
      if (!updated) {
        navigate('/accounts')
        return
      }
      setAccount(updated)
      const months = getAllMonths(updated)
      setActiveMonth(months[0] ?? '')
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Erro ao excluir mês')
    } finally {
      setDeleting(false)
      setLoading(false)
    }
  }

  async function handleCategoryChange(cardTransactionId: number, newCategoryId: string) {
    setUpdatingTxId(cardTransactionId)
    setInvoiceError('')
    try {
      const updated = await api.accounts.updateCardTransactionCategory(
        cardTransactionId,
        newCategoryId || null,
      )

      setInvoiceDetails((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          transactions: prev.transactions.map((tx) =>
            tx.id === cardTransactionId
              ? {
                  ...tx,
                  categoryId: updated.categoryId,
                  categoryName: updated.categoryName,
                }
              : tx,
          ),
        }
      })
    } catch (error) {
      setInvoiceError(error instanceof Error ? error.message : 'Erro ao atualizar categoria')
    } finally {
      setUpdatingTxId(null)
    }
  }

  async function handleBankCategoryChange(transactionId: number, newCategoryId: string) {
    setUpdatingTxId(transactionId)
    try {
      const updated = await api.accounts.updateBankTransactionCategory(
        transactionId,
        newCategoryId || null,
      )

      setStatementDetails((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          transactions: prev.transactions.map((tx) =>
            tx.id === transactionId
              ? { ...tx, categoryId: updated.categoryId, categoryName: updated.categoryName }
              : tx,
          ),
        }
      })
    } catch {
      // silently keep previous value
    } finally {
      setUpdatingTxId(null)
    }
  }

  function getMovementTypeLabel(movementType: string) {
    if (movementType === 'income') return 'Receita'
    if (movementType === 'expense') return 'Despesa'
    if (movementType === 'transfer') return 'Transferencia'
    return movementType
  }

  function isCategoryEditableForBankTransaction(movementType: string, movementSubtype: string | null) {
    if (movementType === 'transfer') return false
    if (movementSubtype === 'investment_redeem') return false
    if (movementSubtype === 'investment_apply') return false
    return true
  }

  // Estrutura hierarquicamente as categorias para exibição prática
  const getCategoryOptions = (type: 'expense' | 'income') => {
    const filteredCategories = categories.filter((c) => c.type === type)
    const parents = filteredCategories.filter((c) => !c.parentId)
    const byParent = new Map<string | null, typeof filteredCategories>()
    filteredCategories.forEach((cat) => {
      const key = cat.parentId || null
      if (!byParent.has(key)) byParent.set(key, [])
      byParent.get(key)!.push(cat)
    })

    const options: { id: string; label: string; isParent: boolean }[] = []
    for (const parent of parents) {
      options.push({ id: parent.id, label: parent.name, isParent: true })
      const children = byParent.get(parent.id) || []
      for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
        options.push({ id: child.id, label: `  └ ${child.name}`, isParent: false })
      }
    }
    return options
  }

  const months = account ? getAllMonths(account) : []
  const bankEntry = account?.bankMonths.find((m) => m.month === activeMonth)
  const invoiceEntry = account?.invoiceMonths.find((m) => m.month === activeMonth)

  return (
    <div style={{ maxWidth: 800 }}>
      {/* Back navigation */}
      <div style={{ marginBottom: '1.25rem' }}>
        <button
          onClick={() => navigate('/accounts')}
          style={{
            background: 'none',
            border: 'none',
            color: '#6366f1',
            cursor: 'pointer',
            fontSize: '0.9rem',
            fontWeight: 600,
            padding: '0.25rem 0',
            display: 'flex',
            alignItems: 'center',
            gap: '0.35rem',
          }}
        >
          ← Contas
        </button>
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

      {!loading && account && (
        <>
          {/* Account header card */}
          <Card style={{ marginBottom: '1.25rem' }}>
            <h1
              style={{ fontSize: '1.25rem', fontWeight: 800, color: '#e5e7eb', margin: '0 0 0.6rem' }}
            >
              {account.displayName}
            </h1>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <Badge variant="blue">{account.financialChannel}</Badge>
              <Badge variant="gray">{account.type}</Badge>
              {account.institutionName && <Badge variant="gray">{account.institutionName}</Badge>}
              {account.cardBrand && <Badge variant="gray">{account.cardBrand}</Badge>}
              {account.cardLast4 && <Badge variant="gray">**** {account.cardLast4}</Badge>}
            </div>
          </Card>

          {/* Month tabs */}
          {months.length === 0 ? (
            <Card>
              <p style={{ color: '#6b7280', textAlign: 'center', margin: 0 }}>
                Nenhum dado encontrado para esta conta.
              </p>
            </Card>
          ) : (
            <Card>
              {/* Tab bar */}
              <div
                style={{
                  display: 'flex',
                  gap: 0,
                  flexWrap: 'wrap',
                  borderBottom: '1px solid #2a2f45',
                  marginBottom: '1.5rem',
                }}
              >
                {months.map((month) => {
                  const isActive = month === activeMonth
                  return (
                    <button
                      key={month}
                      onClick={() => setActiveMonth(month)}
                      style={{
                        background: 'none',
                        border: 'none',
                        borderBottom: isActive ? '2px solid #6366f1' : '2px solid transparent',
                        color: isActive ? '#6366f1' : '#9ca3af',
                        cursor: 'pointer',
                        padding: '0.5rem 1rem',
                        fontSize: '0.88rem',
                        fontWeight: isActive ? 700 : 400,
                        marginBottom: '-1px',
                        transition: 'color 0.15s',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {month}
                    </button>
                  )
                })}
              </div>

              {/* Tab content */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-end',
                  flexWrap: 'wrap',
                  gap: '1.5rem',
                }}
              >
                <div style={{ display: 'flex', gap: '2.5rem', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ color: '#6b7280', fontSize: '0.75rem', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Transações bancárias
                    </div>
                    <div style={{ color: '#e5e7eb', fontSize: '2rem', fontWeight: 700, lineHeight: 1 }}>
                      {bankEntry?.count ?? 0}
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#6b7280', fontSize: '0.75rem', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Lançamentos de fatura
                    </div>
                    <div style={{ color: '#e5e7eb', fontSize: '2rem', fontWeight: 700, lineHeight: 1 }}>
                      {invoiceEntry?.count ?? 0}
                    </div>
                  </div>
                </div>

                <Button variant="danger" onClick={handleDeleteMonth} disabled={deleting}>
                  {deleting ? 'Excluindo...' : `Excluir ${activeMonth}`}
                </Button>
              </div>

              <div style={{ marginTop: '1.6rem', borderTop: '1px solid #2a2f45', paddingTop: '1rem' }}>
                <h3 style={{ margin: 0, color: '#e5e7eb', fontSize: '1rem', fontWeight: 700 }}>
                  Extrato do mês
                </h3>

                {statementLoading && (
                  <div style={{ marginTop: '0.8rem', color: '#9ca3af', fontSize: '0.85rem' }}>
                    Carregando extrato bancário...
                  </div>
                )}

                {!statementLoading && statementError && (
                  <Alert variant="error" style={{ marginTop: '0.8rem' }}>
                    {statementError}
                  </Alert>
                )}

                {!statementLoading && !statementError && (statementDetails?.transactions.length ?? 0) === 0 && (
                  <p style={{ margin: '0.8rem 0 0', color: '#9ca3af', fontSize: '0.85rem' }}>
                    Este mês não possui extrato importado para esta conta.
                  </p>
                )}

                {!statementLoading && !statementError && (statementDetails?.transactions.length ?? 0) > 0 && (
                  <div style={{ marginTop: '1rem', overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #2a2f45', textAlign: 'left' }}>
                          <th style={{ padding: '0.5rem', color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }}>Data</th>
                          <th style={{ padding: '0.5rem', color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }}>Descrição</th>
                          <th style={{ padding: '0.5rem', color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }}>Categoria</th>
                          <th style={{ padding: '0.5rem', color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }}>Tipo</th>
                          <th style={{ padding: '0.5rem', color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600, textAlign: 'right' }}>Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statementDetails!.transactions.map((tx) => (
                          <tr key={tx.id} style={{ borderBottom: '1px solid #1f2436' }}>
                            <td style={{ padding: '0.5rem', color: '#cbd5e1', fontSize: '0.82rem' }}>
                              {String(tx.occurredAt).slice(0, 10)}
                            </td>
                            <td style={{ padding: '0.5rem', color: '#f3f4f6', fontSize: '0.84rem' }}>
                              {tx.description}
                            </td>
                            <td style={{ padding: '0.5rem', color: '#94a3b8', fontSize: '0.8rem' }}>
                              {isCategoryEditableForBankTransaction(tx.movementType, tx.movementSubtype) ? (
                                <select
                                  value={tx.categoryId ?? ''}
                                  disabled={updatingTxId === tx.id}
                                  onChange={(e) => handleBankCategoryChange(tx.id, e.target.value)}
                                  style={{
                                    background: '#0f1117',
                                    border: '1px solid #2a2f45',
                                    borderRadius: 6,
                                    padding: '4px 8px',
                                    color: '#e5e7eb',
                                    fontSize: '0.78rem',
                                    minWidth: 180,
                                    fontFamily: 'monospace',
                                  }}
                                >
                                  <option value="">Sem categoria</option>
                                  {getCategoryOptions(tx.amountMinor >= 0 ? 'income' : 'expense').map((opt) => (
                                    <option
                                      key={opt.id}
                                      value={opt.id}
                                      disabled={opt.isParent}
                                      style={{
                                        fontWeight: opt.isParent ? 'bold' : 'normal',
                                        color: opt.isParent ? '#94a3b8' : '#e5e7eb',
                                      }}
                                    >
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span style={{ color: '#94a3b8' }}>
                                  {tx.categoryName ?? 'Nao editavel'}
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '0.5rem', color: '#94a3b8', fontSize: '0.8rem' }}>
                              <Badge variant={tx.movementType === 'income' ? 'green' : tx.movementType === 'transfer' ? 'blue' : 'gray'}>
                                {getMovementTypeLabel(tx.movementType)}
                              </Badge>
                            </td>
                            <td
                              style={{
                                padding: '0.5rem',
                                color: tx.amountMinor < 0 ? '#f87171' : '#4ade80',
                                fontSize: '0.85rem',
                                textAlign: 'right',
                                fontWeight: 600,
                              }}
                            >
                              {formatBRL(tx.amountMinor)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div style={{ marginTop: '1.6rem', borderTop: '1px solid #2a2f45', paddingTop: '1rem' }}>
                <h3 style={{ margin: 0, color: '#e5e7eb', fontSize: '1rem', fontWeight: 700 }}>
                  Fatura do mês
                </h3>

                {invoiceLoading && (
                  <div style={{ marginTop: '0.8rem', color: '#9ca3af', fontSize: '0.85rem' }}>
                    Carregando detalhes da fatura...
                  </div>
                )}

                {!invoiceLoading && invoiceError && (
                  <Alert variant="error" style={{ marginTop: '0.8rem' }}>
                    {invoiceError}
                  </Alert>
                )}

                {!invoiceLoading && !invoiceError && !invoiceDetails?.invoice && (
                  <p style={{ margin: '0.8rem 0 0', color: '#9ca3af', fontSize: '0.85rem' }}>
                    Este mês não possui fatura importada para esta conta.
                  </p>
                )}

                {!invoiceLoading && !invoiceError && invoiceDetails?.invoice && (
                  <>
                    <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', marginTop: '0.8rem' }}>
                      <Badge variant="gray">Status: {invoiceDetails.invoice.status}</Badge>
                      <Badge variant="gray">Vencimento: {String(invoiceDetails.invoice.dueDate).slice(0, 10)}</Badge>
                      {invoiceDetails.invoice.cardBrand && <Badge variant="gray">{invoiceDetails.invoice.cardBrand}</Badge>}
                      {invoiceDetails.invoice.cardLast4 && <Badge variant="gray">**** {invoiceDetails.invoice.cardLast4}</Badge>}
                      {invoiceDetails.invoice.parserStrategy && (
                        <Badge variant="blue">Parser: {invoiceDetails.invoice.parserStrategy}</Badge>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', marginTop: '0.9rem' }}>
                      <div>
                        <div style={{ color: '#6b7280', fontSize: '0.75rem', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Total da fatura
                        </div>
                        <div style={{ color: '#f3f4f6', fontWeight: 700, fontSize: '1.05rem' }}>
                          {formatBRL(invoiceDetails.invoice.totalAmountMinor)}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: '#6b7280', fontSize: '0.75rem', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Valor pago
                        </div>
                        <div style={{ color: '#f3f4f6', fontWeight: 700, fontSize: '1.05rem' }}>
                          {formatBRL(invoiceDetails.invoice.paidAmountMinor)}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: '#6b7280', fontSize: '0.75rem', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Em aberto
                        </div>
                        <div style={{ color: '#f3f4f6', fontWeight: 700, fontSize: '1.05rem' }}>
                          {formatBRL(invoiceDetails.invoice.emAbertoMinor)}
                        </div>
                      </div>
                    </div>

                    <div style={{ marginTop: '1rem', overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid #2a2f45', textAlign: 'left' }}>
                            <th style={{ padding: '0.5rem', color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }}>Data</th>
                            <th style={{ padding: '0.5rem', color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }}>Descrição</th>
                            <th style={{ padding: '0.5rem', color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }}>Categoria</th>
                            <th style={{ padding: '0.5rem', color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600, textAlign: 'right' }}>Valor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {invoiceDetails.transactions.map((tx) => (
                            <tr key={tx.id} style={{ borderBottom: '1px solid #1f2436' }}>
                              <td style={{ padding: '0.5rem', color: '#cbd5e1', fontSize: '0.82rem' }}>
                                {String(tx.occurredAt).slice(0, 10)}
                              </td>
                              <td style={{ padding: '0.5rem', color: '#f3f4f6', fontSize: '0.84rem' }}>
                                {tx.description}
                                {tx.installmentNumber && tx.installmentTotal
                                  ? ` (${tx.installmentNumber}/${tx.installmentTotal})`
                                  : ''}
                              </td>
                              <td style={{ padding: '0.5rem', color: '#94a3b8', fontSize: '0.8rem' }}>
                                <select
                                  value={tx.categoryId ?? ''}
                                  disabled={updatingTxId === tx.id}
                                  onChange={(e) => handleCategoryChange(tx.id, e.target.value)}
                                  style={{
                                    background: '#0f1117',
                                    border: '1px solid #2a2f45',
                                    borderRadius: 6,
                                    padding: '4px 8px',
                                    color: '#e5e7eb',
                                    fontSize: '0.78rem',
                                    minWidth: 180,
                                    fontFamily: 'monospace',
                                  }}
                                >
                                  <option value="">Sem categoria</option>
                                  {getCategoryOptions('expense').map((opt) => (
                                    <option
                                      key={opt.id}
                                      value={opt.id}
                                      disabled={opt.isParent}
                                      style={{
                                        paddingLeft: opt.isParent ? '0' : '20px',
                                        fontWeight: opt.isParent ? 'bold' : 'normal',
                                        color: opt.isParent ? '#94a3b8' : '#e5e7eb',
                                      }}
                                    >
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td style={{ padding: '0.5rem', color: '#f87171', fontSize: '0.85rem', textAlign: 'right', fontWeight: 600 }}>
                                {formatBRL(tx.amountMinor)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

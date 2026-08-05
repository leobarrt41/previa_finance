import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  api,
  formatBRL,
  type OpenCardInvoiceSummary,
  type AccountInvoiceDetails,
  type AccountStatementDetails,
  type AccountSummary,
  type Category,
} from '../services/api'
import { Alert, Badge, Button, Card, Spinner } from '../components/ui'
import { InvoicePaymentSelector, buildInvoicePaymentOptions, formatInvoicePaymentLabel } from '../components/InvoicePaymentSelector'
import { buildCategoryOptions } from '../utils/categoryOptions'

function getAllMonths(acc: AccountSummary): string[] {
  const set = new Set<string>()
  for (const m of acc.bankMonths) set.add(m.month)
  for (const m of acc.invoiceMonths) set.add(m.month)
  for (const m of acc.receiptMonths) set.add(m.month)
  return Array.from(set).sort((a, b) => b.localeCompare(a))
}

function normalizeCategoryText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function isCreditCardInvoiceCategoryId(
  categoryId: string | null,
  categories: Category[],
): boolean {
  if (!categoryId) return false

  const byId = new Map(categories.map((category) => [category.id, category]))
  let current = byId.get(categoryId) ?? null
  let sawInvoice = false
  let sawCard = false

  while (current) {
    const text = normalizeCategoryText(`${current.name} ${current.slug ?? ''}`)
    if (/fatura/.test(text)) sawInvoice = true
    if (/cartao|credito/.test(text)) sawCard = true
    current = current.parentId ? byId.get(current.parentId) ?? null : null
  }

  return sawInvoice && sawCard
}

type InvoiceComponent = NonNullable<AccountInvoiceDetails['components']>[number]

function getInvoiceComponentLabel(componentType: string): string {
  if (componentType === 'installment_principal') return 'Parcelamento'
  if (componentType === 'iof') return 'IOF'
  if (componentType === 'finance_charge') return 'Encargo financeiro'
  if (componentType === 'fee') return 'Tarifa'
  if (componentType === 'previous_balance') return 'Saldo anterior'
  if (componentType === 'payment_received') return 'Pagamento recebido'
  if (componentType === 'credits_and_refunds') return 'Créditos e estornos'
  if (componentType === 'monthly_expenses') return 'Compras do mês'
  if (componentType === 'charges_total') return 'Encargos totais'
  if (componentType === 'financed_balance') return 'Saldo financiado'
  if (componentType === 'total_invoice') return 'Total da fatura'
  return componentType
}

function InvoiceComponentsPanel({
  installments,
  fees,
  progress,
}: {
  installments: InvoiceComponent[]
  fees: InvoiceComponent[]
  progress: {
    progressPct: number
    seriesCount: number
    withPositionCount: number
  } | null
}) {
  if (installments.length === 0 && fees.length === 0) return null

  return (
    <Card style={{ marginBottom: '1rem', border: '1px solid #334155', background: '#10121a' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
        <div>
          <p style={{ margin: 0, color: '#fbbf24', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Componentes da fatura
          </p>
          <p style={{ margin: '0.25rem 0 0', color: '#e5e7eb', fontWeight: 700, fontSize: '0.92rem' }}>
            Parcelamentos, encargos e taxas são guardados em separado da lista principal
          </p>
        </div>
        <div style={{ color: '#9ca3af', fontSize: '0.78rem', alignSelf: 'flex-end' }}>
          Tudo isso continua vinculado à mesma fatura
        </div>
      </div>

      {progress && progress.seriesCount > 0 && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.9rem',
            border: '1px solid #243042',
            borderRadius: 12,
            background: '#0f1117',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.45rem' }}>
            <div>
              <div style={{ color: '#e5e7eb', fontSize: '0.86rem', fontWeight: 800 }}>
                Progresso total dos parcelamentos
              </div>
              <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
                Barra agregada das séries visíveis nesta fatura
              </div>
            </div>
            <div style={{ color: '#cbd5e1', fontSize: '0.8rem', fontWeight: 700, alignSelf: 'center' }}>
              {Math.round(progress.progressPct * 100)}% · {progress.seriesCount} série(s) · {progress.withPositionCount} item(ns) com parcela identificada
            </div>
          </div>
          <div style={{ height: 10, borderRadius: 999, background: '#1f2937', overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.max(0, Math.min(100, Math.round(progress.progressPct * 100)))}%`,
                height: '100%',
                borderRadius: 999,
                background: 'linear-gradient(90deg, #6366f1 0%, #22c55e 100%)',
                transition: 'width 0.2s ease',
              }}
            />
          </div>
        </div>
      )}

      {installments.length > 0 && (
        <div style={{ marginBottom: fees.length > 0 ? '1rem' : 0 }}>
          <div style={{ color: '#e5e7eb', fontSize: '0.86rem', fontWeight: 700, marginBottom: '0.5rem' }}>
            Parcelamentos detectados
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', tableLayout: 'fixed' }}>
              <thead>
                <tr style={{ color: '#6b7280', borderBottom: '1px solid #2a2f45', background: '#0f1117' }}>
                  <th style={{ padding: '0.5rem', textAlign: 'left' }}>Descrição</th>
                  <th style={{ padding: '0.5rem', width: 100, textAlign: 'left' }}>Parcela</th>
                  <th style={{ padding: '0.5rem', width: 104, textAlign: 'left' }}>Data</th>
                  <th style={{ padding: '0.5rem', width: 110, textAlign: 'right' }}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {installments.map((item, index) => (
                  <tr key={`${item.id}-${index}`} style={{ borderBottom: '1px solid #1a1e2e' }}>
                    <td style={{ padding: '0.55rem 0.5rem', color: '#e5e7eb', overflowWrap: 'anywhere' }}>
                      {item.description}
                    </td>
                    <td style={{ padding: '0.55rem 0.5rem', color: '#cbd5e1', whiteSpace: 'nowrap' }}>
                      {item.installmentNumber && item.installmentTotal ? `${item.installmentNumber}/${item.installmentTotal}` : '—'}
                    </td>
                    <td style={{ padding: '0.55rem 0.5rem', color: '#9ca3af', whiteSpace: 'nowrap' }}>
                      {item.sourceDate ? String(item.sourceDate).slice(0, 10) : '—'}
                    </td>
                    <td style={{ padding: '0.55rem 0.5rem', textAlign: 'right', color: '#f87171', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {formatBRL(item.amountMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {fees.length > 0 && (
        <div>
          <div style={{ color: '#e5e7eb', fontSize: '0.86rem', fontWeight: 700, marginBottom: '0.5rem' }}>
            Encargos, IOF e taxas
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', tableLayout: 'fixed' }}>
              <thead>
                <tr style={{ color: '#6b7280', borderBottom: '1px solid #2a2f45', background: '#0f1117' }}>
                  <th style={{ padding: '0.5rem', width: 170, textAlign: 'left' }}>Tipo</th>
                  <th style={{ padding: '0.5rem', textAlign: 'left' }}>Descrição</th>
                  <th style={{ padding: '0.5rem', width: 104, textAlign: 'left' }}>Data</th>
                  <th style={{ padding: '0.5rem', width: 110, textAlign: 'right' }}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {fees.map((item, index) => (
                  <tr key={`${item.id}-${index}`} style={{ borderBottom: '1px solid #1a1e2e' }}>
                    <td style={{ padding: '0.55rem 0.5rem', color: '#cbd5e1', whiteSpace: 'nowrap' }}>
                      {getInvoiceComponentLabel(item.componentType)}
                    </td>
                    <td style={{ padding: '0.55rem 0.5rem', color: '#e5e7eb', overflowWrap: 'anywhere' }}>
                      {item.description ?? '—'}
                    </td>
                    <td style={{ padding: '0.55rem 0.5rem', color: '#9ca3af', whiteSpace: 'nowrap' }}>
                      {item.sourceDate ? String(item.sourceDate).slice(0, 10) : '—'}
                    </td>
                    <td style={{ padding: '0.55rem 0.5rem', textAlign: 'right', color: '#f87171', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {formatBRL(item.amountMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  )
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
  const [openInvoices, setOpenInvoices] = useState<OpenCardInvoiceSummary[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [updatingTxId, setUpdatingTxId] = useState<number | null>(null)
  const [linkingPaymentId, setLinkingPaymentId] = useState<number | null>(null)

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
    if (!activeMonth) return
    api.accounts.openCardInvoices(activeMonth).then((result) => setOpenInvoices(result.items)).catch(() => {})
  }, [activeMonth])

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
      const shouldShowInvoiceSelector = isCreditCardInvoiceCategoryId(updated.categoryId, categories)

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
                  cardInvoiceId: shouldShowInvoiceSelector ? tx.cardInvoiceId : null,
                  settledInvoice: shouldShowInvoiceSelector ? tx.settledInvoice : null,
                  settlementAllocatedMinor: shouldShowInvoiceSelector ? tx.settlementAllocatedMinor : null,
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

      const shouldShowInvoiceSelector = isCreditCardInvoiceCategoryId(updated.categoryId, categories)
      const currentTx = statementDetails?.transactions.find((tx) => tx.id === transactionId) ?? null

      if (!shouldShowInvoiceSelector && currentTx?.cardInvoiceId) {
        await api.accounts.updateBankTransactionCardInvoice(transactionId, null)
      }

      setStatementDetails((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          transactions: prev.transactions.map((tx) =>
            tx.id === transactionId
              ? {
                  ...tx,
                  categoryId: updated.categoryId,
                  categoryName: updated.categoryName,
                  cardInvoiceId: shouldShowInvoiceSelector ? tx.cardInvoiceId : null,
                  settledInvoice: shouldShowInvoiceSelector ? tx.settledInvoice : null,
                  settlementAllocatedMinor: shouldShowInvoiceSelector ? tx.settlementAllocatedMinor : null,
                }
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

  const occupiedInvoiceIds = useMemo(() => {
    const ids = new Set<number>()
    for (const tx of statementDetails?.transactions ?? []) {
      if (typeof tx.cardInvoiceId === 'number' && tx.cardInvoiceId > 0) {
        ids.add(tx.cardInvoiceId)
      }
    }
    for (const tx of invoiceDetails?.transactions ?? []) {
      if (typeof tx.cardInvoiceId === 'number' && tx.cardInvoiceId > 0) {
        ids.add(tx.cardInvoiceId)
      }
    }
    return ids
  }, [statementDetails, invoiceDetails])

  function getAvailableInvoiceOptions(
    currentInvoiceId: number | null,
    currentInvoiceSummary: OpenCardInvoiceSummary | null,
    occupiedInvoiceIds: Set<number>,
    cardInvoiceSummary?: OpenCardInvoiceSummary | null,
  ) {
    // Prioridade: settledInvoice > cardInvoiceSummary (do backend) > procura em openInvoices
    const currentInvoice = currentInvoiceSummary
      ?? cardInvoiceSummary
      ?? (currentInvoiceId
        ? openInvoices.find((invoice) => invoice.id === currentInvoiceId) ?? null
        : null)

    // Se a fatura está associada mas já foi paga (não está em openInvoices),
    // criamos uma opção de fallback para que o dropdown mostre a associação existente
    const currentOption = currentInvoice
      ? {
          id: currentInvoice.id,
          label: formatInvoicePaymentLabel(currentInvoice),
        }
      : currentInvoiceId
        ? {
            id: currentInvoiceId,
            label: `Fatura #${currentInvoiceId} (já associada)`,
          }
        : null

    const availableInvoices = openInvoices.filter((invoice) => invoice.id === currentInvoiceId || !occupiedInvoiceIds.has(invoice.id))
    return buildInvoicePaymentOptions(currentOption, availableInvoices)
  }

  async function handleStatementInvoiceChange(transactionId: number, cardInvoiceId: number | null) {
    setLinkingPaymentId(transactionId)
    try {
      await api.accounts.updateBankTransactionCardInvoice(
        transactionId,
        cardInvoiceId,
      )

      if (account && activeMonth) {
        const [updatedInvoice, updatedStatement, updatedOpenInvoices] = await Promise.all([
          api.accounts.invoiceDetails(account.id, activeMonth),
          api.accounts.statementDetails(account.id, activeMonth),
          api.accounts.openCardInvoices(activeMonth),
        ])
        setInvoiceDetails(updatedInvoice)
        setStatementDetails(updatedStatement)
        setOpenInvoices(updatedOpenInvoices.items)
      }
    } catch (error) {
      setStatementError(error instanceof Error ? error.message : 'Erro ao vincular fatura')
    } finally {
      setLinkingPaymentId(null)
    }
  }

  // Estrutura hierarquicamente as categorias para exibição prática
  const getCategoryOptions = (type: 'expense' | 'income') =>
    buildCategoryOptions(categories, type).map((option) => ({
      id: option.id,
      label: option.label,
      isParent: option.disabled,
    }))

  const months = account ? getAllMonths(account) : []
  const bankEntry = account?.bankMonths.find((m) => m.month === activeMonth)
  const invoiceEntry = account?.invoiceMonths.find((m) => m.month === activeMonth)
  const invoiceComponents = invoiceDetails?.components ?? []
  const invoiceInstallments = invoiceComponents.filter((item) => item.componentScope === 'line_item' && item.componentType === 'installment_principal')
  const invoiceFees = invoiceComponents.filter((item) => item.componentScope === 'line_item' && item.componentType !== 'installment_principal')
  const invoiceVisibleTransactions = invoiceDetails?.transactions ?? []
  const invoiceInstallmentProgress = useMemo(() => {
    const grouped = new Map<string, { current: number; total: number }>()

    for (const item of invoiceInstallments) {
      if (!item.installmentNumber || !item.installmentTotal || item.installmentTotal <= 0) continue
      const key = `${item.description ?? ''}::${item.installmentTotal}`
      const current = grouped.get(key) ?? { current: 0, total: 0 }
      current.current += Math.min(item.installmentNumber, item.installmentTotal)
      current.total += item.installmentTotal
      grouped.set(key, current)
    }

    if (grouped.size === 0) return null

    let weightedProgress = 0
    let weightedTotal = 0
    for (const entry of grouped.values()) {
      const ratio = entry.total > 0 ? entry.current / entry.total : 0
      weightedProgress += ratio * entry.total
      weightedTotal += entry.total
    }

    return {
      progressPct: weightedTotal > 0 ? weightedProgress / weightedTotal : 0,
      seriesCount: grouped.size,
      withPositionCount: invoiceInstallments.filter((item) => item.installmentNumber && item.installmentTotal).length,
    }
  }, [invoiceInstallments])
  const previousInvoiceOpenMinor = invoiceDetails?.invoice
    ? Math.max(0, invoiceDetails.invoice.previousBalanceMinor - invoiceDetails.invoice.paidAmountMinor)
    : 0
  const liabilityPayments = statementDetails?.transactions.filter((tx) => tx.movementType === 'liability_payment') ?? []

  return (
    <div style={{ width: '100%', maxWidth: 1200 }}>
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
                  <div style={{ marginTop: '1rem' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #2a2f45', textAlign: 'left' }}>
                          <th style={{ padding: '0.5rem', width: 92, color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }}>Data</th>
                          <th style={{ padding: '0.5rem', color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }}>Descrição</th>
                          <th style={{ padding: '0.5rem', width: 220, color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }}>Categoria</th>
                          <th style={{ padding: '0.5rem', width: 280, color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }}>Fatura</th>
                          <th style={{ padding: '0.5rem', width: 112, color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }}>Tipo</th>
                          <th style={{ padding: '0.5rem', width: 110, color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600, textAlign: 'right' }}>Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statementDetails!.transactions.map((tx) => (
                          <tr key={tx.id} style={{ borderBottom: '1px solid #1f2436' }}>
                            <td style={{ padding: '0.5rem', color: '#cbd5e1', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                              {String(tx.occurredAt).slice(0, 10)}
                            </td>
                            <td style={{ padding: '0.5rem', color: '#f3f4f6', fontSize: '0.84rem', overflowWrap: 'anywhere' }}>
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
                                    width: '100%',
                                    minWidth: 0,
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
                              <td style={{ padding: '0.5rem', color: '#94a3b8', fontSize: '0.8rem', verticalAlign: 'top' }}>
                                {tx.movementType === 'liability_payment' || isCreditCardInvoiceCategoryId(tx.categoryId, categories) ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <InvoicePaymentSelector
                                      value={tx.cardInvoiceId ?? null}
                                      options={getAvailableInvoiceOptions(tx.cardInvoiceId ?? null, tx.settledInvoice, occupiedInvoiceIds, tx.cardInvoiceSummary)}
                                      disabled={linkingPaymentId === tx.id}
                                    onChange={(invoiceId) => handleStatementInvoiceChange(tx.id, invoiceId)}
                                    style={{ width: '100%', minWidth: 0 }}
                                  />
                                  {tx.settledInvoice && (
                                    <span style={{ color: '#94a3b8', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                                      {formatBRL(tx.settlementAllocatedMinor ?? 0)}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span style={{ color: '#475569' }}>—</span>
                              )}
                            </td>
                            <td style={{ padding: '0.5rem', color: '#94a3b8', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
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
                                whiteSpace: 'nowrap',
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
                          Total da fatura anterior
                        </div>
                        <div style={{ color: '#f3f4f6', fontWeight: 700, fontSize: '1.05rem' }}>
                          {formatBRL(invoiceDetails.invoice.previousBalanceMinor)}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: '#6b7280', fontSize: '0.75rem', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Pago na fatura anterior
                        </div>
                        <div style={{ color: '#f3f4f6', fontWeight: 700, fontSize: '1.05rem' }}>
                          {formatBRL(invoiceDetails.invoice.paidAmountMinor)}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: '#6b7280', fontSize: '0.75rem', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Saldo da fatura anterior
                        </div>
                        <div style={{ color: previousInvoiceOpenMinor === 0 ? '#4ade80' : '#f87171', fontWeight: 700, fontSize: '1.05rem' }}>
                          {formatBRL(previousInvoiceOpenMinor)}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: '#6b7280', fontSize: '0.75rem', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Total da fatura atual
                        </div>
                        <div style={{ color: '#f3f4f6', fontWeight: 700, fontSize: '1.05rem' }}>
                          {formatBRL(invoiceDetails.invoice.totalAmountMinor)}
                        </div>
                      </div>
                      <div>
                        <div style={{ color: '#6b7280', fontSize: '0.75rem', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          Em aberto da fatura atual
                        </div>
                        <div style={{ color: '#f3f4f6', fontWeight: 700, fontSize: '1.05rem' }}>
                          {formatBRL(invoiceDetails.invoice.emAbertoMinor)}
                        </div>
                      </div>
                    </div>

                    <InvoiceComponentsPanel installments={invoiceInstallments} fees={invoiceFees} progress={invoiceInstallmentProgress} />

                    {liabilityPayments.length > 0 && (
                      <div
                        style={{
                          marginTop: '1rem',
                          padding: '0.9rem',
                          border: '1px solid #2a2f45',
                          borderRadius: 10,
                          background: '#0f1117',
                        }}
                      >
                        <h4 style={{ margin: '0 0 0.75rem', color: '#e5e7eb', fontSize: '0.92rem', fontWeight: 700 }}>
                          Pagamentos do extrato vinculados
                        </h4>
                        <div>
                          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                            <thead>
                              <tr style={{ borderBottom: '1px solid #2a2f45', textAlign: 'left' }}>
                                <th style={{ padding: '0.45rem', width: 110, color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }}>Data</th>
                                <th style={{ padding: '0.45rem', color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }}>Descrição</th>
                                <th style={{ padding: '0.45rem', width: 380, color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }}>Fatura</th>
                                <th style={{ padding: '0.45rem', width: 120, color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600, textAlign: 'right' }}>Valor</th>
                              </tr>
                            </thead>
                            <tbody>
                              {liabilityPayments.map((tx) => (
                                <tr key={tx.id} style={{ borderBottom: '1px solid #1f2436' }}>
                                  <td style={{ padding: '0.45rem', color: '#cbd5e1', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                                    {String(tx.occurredAt).slice(0, 10)}
                                  </td>
                                  <td style={{ padding: '0.45rem', color: '#f3f4f6', fontSize: '0.84rem', overflowWrap: 'anywhere' }}>
                                    {tx.description}
                                  </td>
                                  <td style={{ padding: '0.45rem', color: '#94a3b8', fontSize: '0.8rem', verticalAlign: 'top' }}>
                                    <InvoicePaymentSelector
                                      value={tx.cardInvoiceId ?? null}
                                      options={getAvailableInvoiceOptions(tx.cardInvoiceId ?? null, tx.settledInvoice, occupiedInvoiceIds, tx.cardInvoiceSummary)}
                                      disabled={linkingPaymentId === tx.id}
                                      onChange={(invoiceId) => handleStatementInvoiceChange(tx.id, invoiceId)}
                                      style={{ width: '100%', minWidth: 0 }}
                                    />
                                  </td>
                                  <td style={{ padding: '0.45rem', color: '#f87171', fontSize: '0.85rem', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                    {formatBRL(tx.amountMinor)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    <div style={{ marginTop: '1rem' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid #2a2f45', textAlign: 'left' }}>
                            <th style={{ padding: '0.5rem', width: 110, color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }}>Data</th>
                            <th style={{ padding: '0.5rem', color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }}>Descrição</th>
                            <th style={{ padding: '0.5rem', width: 220, color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }}>Categoria</th>
                            <th style={{ padding: '0.5rem', width: 360, color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600 }}>Fatura vinculada</th>
                            <th style={{ padding: '0.5rem', width: 120, color: '#9ca3af', fontSize: '0.75rem', fontWeight: 600, textAlign: 'right' }}>Valor</th>
                          </tr>
                        </thead>
                        <tbody>
                          {invoiceVisibleTransactions.map((tx) => (
                            <tr key={tx.id} style={{ borderBottom: '1px solid #1f2436' }}>
                              <td style={{ padding: '0.5rem', color: '#cbd5e1', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                                {String(tx.occurredAt).slice(0, 10)}
                              </td>
                              <td style={{ padding: '0.5rem', color: '#f3f4f6', fontSize: '0.84rem', overflowWrap: 'anywhere' }}>
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
                                    width: '100%',
                                    minWidth: 0,
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
                              <td style={{ padding: '0.5rem', color: '#94a3b8', fontSize: '0.8rem', verticalAlign: 'top' }}>
                                {tx.movementType === 'liability_payment' || isCreditCardInvoiceCategoryId(tx.categoryId, categories) ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <InvoicePaymentSelector
                                      value={tx.cardInvoiceId ?? null}
                                      options={getAvailableInvoiceOptions(tx.cardInvoiceId ?? null, tx.settledInvoice, occupiedInvoiceIds, tx.cardInvoiceSummary)}
                                      disabled={linkingPaymentId === tx.id}
                                      onChange={(invoiceId) => handleStatementInvoiceChange(tx.id, invoiceId)}
                                      style={{ width: '100%', minWidth: 0 }}
                                    />
                                    {tx.settledInvoice && (
                                      <span style={{ color: '#94a3b8', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                                        {formatBRL(tx.settlementAllocatedMinor ?? 0)}
                                      </span>
                                    )}
                                  </div>
                                ) : tx.settledInvoice ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <span style={{ color: '#e5e7eb', fontSize: '0.8rem' }}>
                                      {formatInvoicePaymentLabel(tx.settledInvoice)}
                                    </span>
                                    <span style={{ color: '#94a3b8', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                                      {formatBRL(tx.settlementAllocatedMinor ?? tx.amountMinor)}
                                    </span>
                                  </div>
                                ) : (
                                  <span style={{ color: '#475569' }}>—</span>
                                )}
                              </td>
                              <td style={{ padding: '0.5rem', color: '#f87171', fontSize: '0.85rem', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                {formatBRL(tx.amountMinor)}
                              </td>
                            </tr>
                          ))}
                          {invoiceVisibleTransactions.length === 0 && (
                            <tr>
                              <td colSpan={5} style={{ padding: '0.85rem 0.5rem', color: '#94a3b8', fontSize: '0.82rem' }}>
                                Nenhum lançamento principal nesta fatura. Os parcelamentos aparecem acima em "Componentes da fatura".
                              </td>
                            </tr>
                          )}
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

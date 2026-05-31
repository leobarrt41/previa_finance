import { useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  currentMonth,
  formatBRL,
  type Category,
  type StatementPreviewTransaction,
} from '../services/api'
import { Alert, Button, Card, SectionTitle, Spinner } from '../components/ui'

type UploadStep = 'select' | 'parsing' | 'preview' | 'importing' | 'done' | 'error'
type CategoryOption = { id: string; label: string; disabled: boolean }

function isInvestmentSweep(description: string): boolean {
  return /(rende\s*facil|rende\s*fácil|aplica(c|ç)(a|ã)o|resgate|investimento|cdb|tesouro|fundo)/i.test(
    description,
  )
}

function normalizeCategoryText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

function isCreditCardInvoiceCategoryId(
  categoryId: string | null,
  categories: Category[],
): boolean {
  if (!categoryId) return false

  const byId = new Map(categories.map((category) => [category.id, category]))
  let current = byId.get(categoryId) ?? null
  let sawPayment = false
  let sawInvoice = false
  let sawCard = false

  while (current) {
    const text = normalizeCategoryText(`${current.name} ${current.slug ?? ''}`)
    if (/(pagament|pagos?)/.test(text)) sawPayment = true
    if (/fatura/.test(text)) sawInvoice = true
    if (/cartao|credito/.test(text)) sawCard = true
    current = current.parentId ? byId.get(current.parentId) ?? null : null
  }

  return sawPayment && sawInvoice && sawCard
}

function DropZone({ onFile }: { onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) onFile(file)
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `2px dashed ${dragging ? '#6366f1' : '#2a2f45'}`,
        borderRadius: 12,
        padding: '2.5rem 1.5rem',
        textAlign: 'center',
        cursor: 'pointer',
        background: dragging ? 'rgba(99,102,241,0.06)' : '#0f1117',
      }}
    >
      <div style={{ fontSize: '2.2rem', marginBottom: '0.65rem' }}>🏦</div>
      <p style={{ color: '#e5e7eb', fontWeight: 700, marginBottom: '0.35rem' }}>
        Arraste seu extrato OFX ou CSV
      </p>
      <p style={{ color: '#6b7280', fontSize: '0.82rem' }}>
        ou clique para selecionar o arquivo
      </p>
      <p style={{ color: '#4b5563', fontSize: '0.74rem', marginTop: '0.55rem' }}>
        Suportado: .ofx e .csv
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".ofx,.csv"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
        }}
      />
    </div>
  )
}

function TransactionRow({
  tx,
  categoryOptions,
  onChange,
}: {
  tx: StatementPreviewTransaction
  categoryOptions: CategoryOption[]
  onChange: (id: string, patch: Partial<StatementPreviewTransaction>) => void
}) {
  const categoryEditable = tx.movementType !== 'transfer'

  return (
    <tr style={{ borderBottom: '1px solid #1f2436', opacity: tx.include ? 1 : 0.45 }}>
      <td style={{ padding: '0.5rem', textAlign: 'center' }}>
        <input
          type="checkbox"
          checked={tx.include}
          onChange={(e) => onChange(tx.id, { include: e.target.checked })}
        />
      </td>
      <td style={{ padding: '0.5rem', color: '#cbd5e1', fontSize: '0.8rem' }}>{tx.date}</td>
      <td style={{ padding: '0.5rem', color: '#f3f4f6', fontSize: '0.84rem' }}>{tx.description}</td>
      <td
        style={{
          padding: '0.5rem',
          color: tx.amountMinor < 0 ? '#f87171' : '#4ade80',
          textAlign: 'right',
          fontWeight: 700,
          fontSize: '0.83rem',
        }}
      >
        {formatBRL(tx.amountMinor)}
      </td>
      <td style={{ padding: '0.5rem' }}>
        <input
          value={tx.competencyMonth}
          onChange={(e) => onChange(tx.id, { competencyMonth: e.target.value })}
          style={{
            background: '#0f1117',
            border: '1px solid #2a2f45',
            borderRadius: 6,
            color: '#e5e7eb',
            padding: '4px 8px',
            fontSize: '0.78rem',
            width: 90,
          }}
        />
      </td>
      <td style={{ padding: '0.5rem' }}>
        {categoryEditable ? (
          <select
            value={tx.categoryId ?? ''}
            onChange={(e) => onChange(tx.id, { categoryId: e.target.value || null })}
            style={{
              background: '#0f1117',
              border: '1px solid #2a2f45',
              borderRadius: 6,
              color: '#e5e7eb',
              padding: '4px 8px',
              fontSize: '0.78rem',
              minWidth: 210,
              maxWidth: 260,
              fontFamily: 'monospace',
            }}
          >
            <option value="">— sem categoria —</option>
            {categoryOptions.map((opt) => (
              <option key={opt.id} value={opt.id} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : (
          <span style={{ color: '#94a3b8', fontSize: '0.82rem' }}>Não editável</span>
        )}
      </td>
    </tr>
  )
}

export function StatementUpload() {
  const [step, setStep] = useState<UploadStep>('select')
  const [file, setFile] = useState<File | null>(null)
  const [transactions, setTransactions] = useState<StatementPreviewTransaction[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [accountHint, setAccountHint] = useState<{
    institutionName: string | null
    providerAccountId: string | null
    accountLast4: string | null
  } | null>(null)
  const [detectedAccount, setDetectedAccount] = useState<{ id: number; displayName: string } | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [result, setResult] = useState<{ imported: number; skippedDuplicates: number; skippedInvalid: number } | null>(null)

  useEffect(() => {
    api.categories.list().then(setCategories).catch(() => {})
  }, [])

  const categoryOptionsByType = useMemo(() => {
    const buildOptions = (type: 'expense' | 'income') => {
      const filtered = categories.filter((c) => c.type === type)
      const parents = filtered.filter((c) => !c.parentId)
      const byParent = new Map<string, Category[]>()

      for (const c of filtered) {
        if (!c.parentId) continue
        const arr = byParent.get(c.parentId) || []
        arr.push(c)
        byParent.set(c.parentId, arr)
      }

      const sortByName = (a: Category, b: Category) => a.name.localeCompare(b.name)
      const options: CategoryOption[] = []
      for (const p of [...parents].sort(sortByName)) {
        const children = [...(byParent.get(p.id) || [])].sort(sortByName)
        if (children.length > 0) {
          options.push({ id: p.id, label: p.name, disabled: true })
          for (const child of children) {
            options.push({ id: child.id, label: `  └ ${child.name}`, disabled: false })
          }
        } else {
          options.push({ id: p.id, label: p.name, disabled: false })
        }
      }
      return options
    }

    return {
      expense: buildOptions('expense'),
      income: buildOptions('income'),
    }
  }, [categories])

  const included = transactions.filter((tx) => tx.include)
  const neutralIncluded = included.filter((tx) => tx.movementType === 'transfer')
  const total = included
    .filter((tx) => tx.movementType !== 'transfer')
    .reduce((sum, tx) => sum + tx.amountMinor, 0)
  const monthFallback = currentMonth()

  function updateRow(id: string, patch: Partial<StatementPreviewTransaction>) {
    setTransactions((prev) => prev.map((tx) => (tx.id === id ? { ...tx, ...patch } : tx)))
  }

  function updateRowCategory(id: string, categoryId: string | null) {
    const isInvoicePayment = isCreditCardInvoiceCategoryId(categoryId, categories)
    updateRow(id, {
      categoryId,
      movementType: isInvoicePayment ? 'liability_payment' : undefined,
    })
  }

  async function ensureCategoriesLoaded(): Promise<Category[]> {
    if (categories.length > 0) return categories

    try {
      const loaded = await api.categories.list()
      setCategories(loaded)
      return loaded
    } catch {
      return []
    }
  }

  async function classifyWithAI(
    parsedTransactions: StatementPreviewTransaction[],
    availableCategories: Category[],
  ): Promise<StatementPreviewTransaction[]> {
    if (availableCategories.length === 0) return parsedTransactions

    // Investment sweeps are internal movements and should be neutral in cashflow.
    const normalized = parsedTransactions.map((tx) => {
      if (isInvestmentSweep(tx.description)) {
        return {
          ...tx,
          movementType: 'transfer',
          categoryId: null,
        }
      }
      return tx
    })

    const pending = normalized.filter(
      (tx) => tx.include && tx.movementType !== 'transfer' && !tx.categoryId,
    )

    if (pending.length === 0) return normalized

    try {
      const response = await api.transactions.classifyStatement({
        transactions: pending.map((tx) => ({
          id: tx.id,
          description: tx.description,
          amountMinor: tx.amountMinor,
          movementType: tx.movementType,
          categoryId: tx.categoryId ?? null,
        })),
        categories: availableCategories.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          type: c.type,
          parentId: c.parentId,
        })),
      })

      const suggestions = response.suggestions ?? {}
      if (Object.keys(suggestions).length === 0) return normalized

      return normalized.map((tx) => {
        const suggestion = suggestions[tx.id]
        if (!suggestion) return tx
        return {
          ...tx,
          categoryId: suggestion.subcategoryId ?? suggestion.categoryId,
        }
      })
    } catch {
      return normalized
    }
  }

  async function handleFile(selected: File) {
    setFile(selected)
    setStep('parsing')
    setErrorMsg('')

    try {
      const parsed = await api.transactions.parseStatement(selected)
      setAccountHint(parsed.sourceAccount)
      setDetectedAccount(parsed.detectedAccount)
      const baseTransactions = parsed.transactions.map((tx) => ({
          ...tx,
          competencyMonth: tx.competencyMonth || tx.date.slice(0, 7) || monthFallback,
          include: tx.include !== false,
      }))

          const loadedCategories = await ensureCategoriesLoaded()
          const classified = await classifyWithAI(baseTransactions, loadedCategories)
      setTransactions(classified)
      setStep('preview')
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Erro ao processar extrato')
      setStep('error')
    }
  }

  async function handleImport() {
    setStep('importing')
    setErrorMsg('')

    try {
      const response = await api.transactions.importStatement({
        accountId: detectedAccount?.id,
        sourceAccount: accountHint ?? undefined,
        transactions: transactions.map((tx) => ({
          date: tx.date,
          description: tx.description,
          amountMinor: tx.amountMinor,
          competencyMonth: tx.competencyMonth,
          movementType: tx.movementType,
          movementSubtype: tx.movementSubtype ?? null,
          providerTransactionId: tx.providerTransactionId ?? null,
          categoryId: tx.categoryId ?? null,
          include: tx.include,
        })),
      })
      setResult(response)
      setStep('done')
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Erro ao importar extrato')
      setStep('error')
    }
  }

  function reset() {
    setStep('select')
    setFile(null)
    setTransactions([])
    setAccountHint(null)
    setDetectedAccount(null)
    setErrorMsg('')
    setResult(null)
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ marginBottom: '1.4rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#e5e7eb', margin: 0 }}>
          🏦 Upload de Extratos Bancários
        </h1>
        <p style={{ color: '#6b7280', marginTop: '0.3rem', fontSize: '0.85rem' }}>
          Envie OFX ou CSV, revise os lançamentos e importe sem duplicar transações já existentes.
        </p>
      </div>

      {step === 'select' && (
        <Card style={{ maxWidth: 680 }}>
          <SectionTitle>Arquivo de extrato</SectionTitle>

          <DropZone onFile={handleFile} />
          {errorMsg && <Alert variant="error" style={{ marginTop: '1rem' }}>{errorMsg}</Alert>}
        </Card>
      )}

      {step === 'parsing' && (
        <Card style={{ textAlign: 'center', padding: '3rem' }}>
          <Spinner size={40} />
          <p style={{ marginTop: '1rem', color: '#9ca3af' }}>
            Processando <strong style={{ color: '#e5e7eb' }}>{file?.name}</strong>...
          </p>
        </Card>
      )}

      {step === 'preview' && (
        <>
          <Card style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <p style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: 4 }}>Arquivo</p>
                <p style={{ fontSize: '0.9rem', color: '#e5e7eb', fontWeight: 700 }}>{file?.name}</p>
              </div>
              <div>
                <p style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: 4 }}>Conta</p>
                <p style={{ fontSize: '0.9rem', color: '#e5e7eb', fontWeight: 700 }}>
                  {detectedAccount?.displayName ?? 'Conta será identificada/criada automaticamente'}
                </p>
                {accountHint?.institutionName && (
                  <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: 4 }}>
                    Instituição detectada: {accountHint.institutionName}
                    {accountHint.accountLast4 ? ` ••••${accountHint.accountLast4}` : ''}
                  </p>
                )}
              </div>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <p style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: 2 }}>
                  Selecionadas
                </p>
                <p style={{ fontSize: '1.1rem', color: '#e5e7eb', fontWeight: 800 }}>{included.length}</p>
                {neutralIncluded.length > 0 && (
                  <p style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 2 }}>
                    {neutralIncluded.length} neutra(s)
                  </p>
                )}
                <p style={{ fontSize: '0.85rem', color: total < 0 ? '#f87171' : '#4ade80', fontWeight: 700 }}>
                  {formatBRL(total)}
                </p>
              </div>
            </div>
          </Card>

          {errorMsg && <Alert variant="error" style={{ marginBottom: '1rem' }}>{errorMsg}</Alert>}

          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', minWidth: 980 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #2a2f45', background: '#0f1117', color: '#9ca3af' }}>
                    <th style={{ padding: '0.5rem', width: 36 }} />
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Data</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Descrição</th>
                    <th style={{ padding: '0.5rem', textAlign: 'right' }}>Valor</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Competência</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Categoria</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <TransactionRow
                      key={tx.id}
                      tx={tx}
                      categoryOptions={tx.movementType === 'income' ? categoryOptionsByType.income : categoryOptionsByType.expense}
                      onChange={(id, patch) => {
                        if (patch.categoryId !== undefined) {
                          updateRowCategory(id, patch.categoryId)
                          return
                        }
                        updateRow(id, patch)
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={reset}>Cancelar</Button>
            <Button onClick={handleImport} disabled={included.length === 0}>
              Importar {included.length} lançamento(s)
            </Button>
          </div>
        </>
      )}

      {step === 'importing' && (
        <Card style={{ textAlign: 'center', padding: '3rem' }}>
          <Spinner size={40} />
          <p style={{ color: '#9ca3af', marginTop: '1rem' }}>Importando lançamentos...</p>
        </Card>
      )}

      {step === 'done' && result && (
        <Card style={{ textAlign: 'center', padding: '2.4rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.8rem' }}>✅</div>
          <h2 style={{ color: '#4ade80', fontSize: '1.2rem', fontWeight: 800, marginBottom: '0.8rem' }}>
            Extrato importado
          </h2>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '1.2rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <span style={{ color: '#e5e7eb' }}>Importadas: <strong>{result.imported}</strong></span>
            <span style={{ color: '#fbbf24' }}>Duplicadas: <strong>{result.skippedDuplicates}</strong></span>
            <span style={{ color: '#f87171' }}>Inválidas: <strong>{result.skippedInvalid}</strong></span>
          </div>
          <Button onClick={reset} fullWidth>Importar outro extrato</Button>
        </Card>
      )}

      {step === 'error' && (
        <Card style={{ textAlign: 'center', padding: '2.5rem' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.8rem' }}>❌</div>
          <Alert variant="error" style={{ marginBottom: '1rem' }}>{errorMsg}</Alert>
          <Button onClick={reset}>Tentar novamente</Button>
        </Card>
      )}
    </div>
  )
}

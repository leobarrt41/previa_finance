/**
 * InvoiceUpload.tsx — Upload e Preview de Fatura
 *
 * Fluxo:
 *  1. Utilizador selecciona PDF ou CSV
 *  2. Frontend envia para POST /api/invoices/parse (multipart)
 *  3. API retorna lista de transacções extraídas (preview)
 *  4. Utilizador pode categorizar cada linha e ajustar o mês de competência
 *  5. Confirma importação → POST /api/invoices/import
 *
 * Enquanto o parser não está implementado na API, o frontend
 * simula o preview com dados de exemplo para permitir testar o fluxo.
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import { api, formatBRL, currentMonth, type Category, type InvoiceTransaction, type InvoiceParseResult } from '../services/api'
import {
  Card,
  Badge,
  Button,
  Select,
  Alert,
  Spinner,
  SectionTitle,
  EmptyState,
} from '../components/ui'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ParsedTransaction = InvoiceTransaction

type UploadStep = 'select' | 'parsing' | 'preview' | 'importing' | 'done' | 'error'

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function DropZone({ onFile }: { onFile: (f: File) => void }) {
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDrag(false)
    const file = e.dataTransfer.files[0]
    if (file) onFile(file)
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `2px dashed ${drag ? '#6366f1' : '#2a2f45'}`,
        borderRadius: 12,
        padding: '3rem 2rem',
        textAlign: 'center',
        cursor: 'pointer',
        background: drag ? 'rgba(99,102,241,0.05)' : '#0f1117',
        transition: 'all 0.2s',
      }}
    >
      <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>📄</div>
      <p style={{ color: '#e5e7eb', fontWeight: 600, marginBottom: '0.35rem' }}>
        Arraste o PDF ou CSV da fatura aqui
      </p>
      <p style={{ color: '#6b7280', fontSize: '0.82rem' }}>
        ou clique para seleccionar o arquivo
      </p>
      <p style={{ color: '#4b5563', fontSize: '0.75rem', marginTop: '0.5rem' }}>
        Suportado: Nubank PDF · Nubank CSV · (Itaú em breve)
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.csv"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
      />
    </div>
  )
}

function TransactionPreviewRow({
  tx,
  categories,
  onChange,
}: {
  tx: ParsedTransaction
  categories: Category[]
  onChange: (id: string, patch: Partial<ParsedTransaction>) => void
}) {
  return (
    <tr style={{ borderBottom: '1px solid #1a1e2e', opacity: tx.include ? 1 : 0.4 }}>
      <td style={{ padding: '0.45rem 0.5rem', textAlign: 'center' }}>
        <input
          type="checkbox"
          checked={tx.include}
          onChange={(e) => onChange(tx.id, { include: e.target.checked })}
          style={{ cursor: 'pointer' }}
        />
      </td>
      <td style={{ padding: '0.45rem 0.5rem', fontSize: '0.8rem', color: '#9ca3af' }}>
        {tx.date}
      </td>
      <td style={{ padding: '0.45rem 0.5rem', fontSize: '0.82rem', color: '#e5e7eb' }}>
        {tx.description}
        {tx.installment && (
          <span style={{ marginLeft: 6, fontSize: '0.72rem', color: '#6366f1' }}>
            parcela {tx.installment}
          </span>
        )}
      </td>
      <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right', fontSize: '0.85rem', color: '#f87171', fontWeight: 600 }}>
        {formatBRL(tx.amountMinor)}
      </td>
      <td style={{ padding: '0.45rem 0.5rem' }}>
        <input
          value={tx.competencyMonth}
          onChange={(e) => onChange(tx.id, { competencyMonth: e.target.value })}
          placeholder="YYYY-MM"
          style={{
            background: '#0f1117', border: '1px solid #2a2f45', borderRadius: 6,
            padding: '3px 6px', color: '#e5e7eb', fontSize: '0.78rem', width: 80,
          }}
        />
      </td>
      <td style={{ padding: '0.45rem 0.5rem' }}>
        <select
          value={tx.categoryId ?? ''}
          onChange={(e) => onChange(tx.id, { categoryId: e.target.value || null })}
          style={{
            background: '#0f1117', border: `1px solid ${tx.categoryId ? '#2a2f45' : '#f87171'}`,
            borderRadius: 6, padding: '3px 6px', color: '#e5e7eb', fontSize: '0.78rem', maxWidth: 160,
          }}
        >
          <option value="">— sem categoria —</option>
          {categories
            .filter((c) => c.type === 'expense')
            .map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
        </select>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export function InvoiceUpload() {
  const [step, setStep] = useState<UploadStep>('select')
  const [file, setFile] = useState<File | null>(null)
  const [pdfPassword, setPdfPassword] = useState('')
  const [awaitingPassword, setAwaitingPassword] = useState(false)
  const [transactions, setTransactions] = useState<ParsedTransaction[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [invoiceMonth, setInvoiceMonth] = useState(currentMonth())
  const [dueMonth, setDueMonth] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null)
  const [invoiceSummary, setInvoiceSummary] = useState<InvoiceParseResult['summary'] | null>(null)
  const [invoiceBank, setInvoiceBank] = useState<string | null>(null)

  useEffect(() => {
    api.categories.list().then(setCategories).catch(() => {})
  }, [])

  function isPasswordRequiredError(error: unknown): boolean {
    return error instanceof Error
      && error.message.toLowerCase().includes('pdf protegido por senha')
  }

  function parseSelectedFile(selectedFile: File, password?: string) {
    setStep('parsing')
    setErrorMsg('')

    api.invoices.parse(selectedFile, { password })
      .then((result) => {
        if (result.summary.dueMonth) setDueMonth(result.summary.dueMonth)
        if (result.summary.invoiceMonth) setInvoiceMonth(result.summary.invoiceMonth)
        setInvoiceSummary(result.summary)
        setTransactions(result.transactions)
        setAwaitingPassword(false)
        setStep('preview')
      })
      .catch((e: unknown) => {
        if (isPasswordRequiredError(e)) {
          setAwaitingPassword(true)
          setErrorMsg('Esta fatura exige senha. Informe a senha para gerar o preview.')
          setStep('select')
          return
        }
        setErrorMsg(e instanceof Error ? e.message : 'Erro ao processar o arquivo. Verifique se é um PDF válido.')
        setStep('error')
      })
  }

  function handleFile(f: File) {
    setFile(f)
    setPdfPassword('')
    setAwaitingPassword(false)
    parseSelectedFile(f)
  }

  function submitPassword() {
    if (!file) {
      setErrorMsg('Selecione a fatura novamente.')
      return
    }

    const password = pdfPassword.trim()
    if (!password) {
      setErrorMsg('Informe a senha da fatura para continuar.')
      return
    }

    parseSelectedFile(file, password)
  }

  function handleChange(id: string, patch: Partial<ParsedTransaction>) {
    setTransactions((prev) => prev.map((t) => t.id === id ? { ...t, ...patch } : t))
  }

  function selectAll(include: boolean) {
    setTransactions((prev) => prev.map((t) => ({ ...t, include })))
  }

  const included = transactions.filter((t) => t.include)
  const uncategorized = included.filter((t) => !t.categoryId)
  const total = included.reduce((sum, t) => sum + t.amountMinor, 0)

  async function handleImport() {
    if (!dueMonth) { setErrorMsg('Informe o mês de vencimento da fatura'); return }
    setStep('importing')
    setErrorMsg('')
    try {
      const result = await api.invoices.import({
        transactions: included.map(({ date, description, amountMinor, categoryId, competencyMonth, installment }) => ({
          date, description, amountMinor, categoryId, competencyMonth, installment,
        })),
        invoiceMonth,
        dueMonth,
        bank: invoiceBank ?? undefined,
        cardLast4: invoiceSummary?.cardLast4 ?? undefined,
        product: invoiceSummary?.product ?? undefined,
        sourceFileName: file?.name,
      })
      setImportResult({ imported: result.imported, skipped: result.skipped })
      setStep('done')
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : 'Erro ao importar')
      setStep('error')
    }
  }

  function reset() {
    setStep('select')
    setFile(null)
    setPdfPassword('')
    setAwaitingPassword(false)
    setTransactions([])
    setInvoiceMonth(currentMonth())
    setDueMonth('')
    setErrorMsg('')
    setImportResult(null)
    setInvoiceSummary(null)
    setInvoiceBank(null)
  }

  return (
    <div style={{ maxWidth: 1000 }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#e5e7eb', margin: 0 }}>
          📤 Upload de Fatura
        </h1>
        <p style={{ color: '#6b7280', marginTop: '0.3rem', fontSize: '0.85rem' }}>
          Importe faturas de cartão em PDF ou CSV. Revise e categorize antes de confirmar.
        </p>
      </div>

      {/* Step: select */}
      {step === 'select' && (
        <div style={{ maxWidth: 560 }}>
          <Card>
            <SectionTitle>Seleccionar arquivo</SectionTitle>
            <DropZone onFile={handleFile} />
            {awaitingPassword && file && (
              <div
                style={{
                  marginTop: '1rem',
                  padding: '0.85rem',
                  background: '#1f1627',
                  borderLeft: '3px solid #f59e0b',
                  borderRadius: '0 8px 8px 0',
                }}
              >
                <p style={{ color: '#fcd34d', fontSize: '0.82rem', marginTop: 0, marginBottom: '0.55rem' }}>
                  Arquivo protegido detectado: <strong>{file.name}</strong>
                </p>
                <label
                  htmlFor="invoice-pdf-password"
                  style={{ display: 'block', color: '#e5e7eb', fontSize: '0.8rem', marginBottom: '0.35rem' }}
                >
                  Digite a senha para continuar
                </label>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    id="invoice-pdf-password"
                    type="password"
                    value={pdfPassword}
                    onChange={(e) => setPdfPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitPassword()
                    }}
                    placeholder="Senha do PDF"
                    style={{
                      flex: 1,
                      background: '#0f1117',
                      border: '1px solid #2a2f45',
                      borderRadius: 8,
                      padding: '0.65rem 0.75rem',
                      color: '#e5e7eb',
                      fontSize: '0.82rem',
                    }}
                  />
                  <Button variant="primary" onClick={submitPassword}>Continuar</Button>
                </div>
              </div>
            )}
            <div
              style={{
                marginTop: '1rem',
                padding: '0.75rem',
                background: '#1a2a3a',
                borderLeft: '3px solid #6366f1',
                borderRadius: '0 8px 8px 0',
                fontSize: '0.82rem',
                color: '#93c5fd',
              }}
            >
              <strong>Princípio:</strong> compra no cartão é dívida, não débito imediato.
              O pagamento da fatura é o evento que afecta o caixa.
            </div>
          </Card>
        </div>
      )}

      {/* Step: parsing */}
      {step === 'parsing' && (
        <Card style={{ textAlign: 'center', padding: '3rem' }}>
          <Spinner size={40} />
          <p style={{ color: '#9ca3af', marginTop: '1rem', fontSize: '0.9rem' }}>
            Processando <strong style={{ color: '#e5e7eb' }}>{file?.name}</strong>...
          </p>
        </Card>
      )}

      {/* Step: preview */}
      {step === 'preview' && (
        <>
          {/* Invoice metadata */}
          <Card style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div>
                <p style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: 4 }}>Arquivo</p>
                <p style={{ fontSize: '0.88rem', color: '#e5e7eb', fontWeight: 600 }}>{file?.name}</p>
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: '#6b7280', display: 'block', marginBottom: 4 }}>
                  Mês de competência
                </label>
                <input
                  value={invoiceMonth}
                  onChange={(e) => setInvoiceMonth(e.target.value)}
                  placeholder="YYYY-MM"
                  style={{
                    background: '#141624', border: '1px solid #2a2f45', borderRadius: 8,
                    padding: '0.45rem 0.75rem', color: '#e5e7eb', fontSize: '0.85rem', width: 110,
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: '#6b7280', display: 'block', marginBottom: 4 }}>
                  Mês de vencimento *
                </label>
                <input
                  value={dueMonth}
                  onChange={(e) => setDueMonth(e.target.value)}
                  placeholder="YYYY-MM"
                  style={{
                    background: '#141624',
                    border: `1px solid ${dueMonth ? '#2a2f45' : '#f87171'}`,
                    borderRadius: 8,
                    padding: '0.45rem 0.75rem', color: '#e5e7eb', fontSize: '0.85rem', width: 110,
                  }}
                />
              </div>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <p style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: 2 }}>Total seleccionado</p>
                <p style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f87171' }}>{formatBRL(total)}</p>
              </div>
            </div>

            {/* Invoice breakdown — shows carry-over from previous month */}
            {invoiceSummary && invoiceSummary.previousBalanceMinor > 0 && (
              <div style={{
                marginTop: '1rem', paddingTop: '1rem',
                borderTop: '1px solid #1e2130',
                display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.82rem',
                alignItems: 'center',
              }}>
                <div>
                  <span style={{ color: '#6b7280' }}>Saldo anterior: </span>
                  <span style={{ color: '#f87171', fontWeight: 600 }}>{formatBRL(invoiceSummary.previousBalanceMinor)}</span>
                </div>
                <div>
                  <span style={{ color: '#6b7280' }}>Pagamentos: </span>
                  <span style={{ color: '#4ade80', fontWeight: 600 }}>−{formatBRL(invoiceSummary.paymentsMinor)}</span>
                </div>
                <div>
                  <span style={{ color: '#6b7280' }}>Novas compras: </span>
                  <span style={{ color: '#e5e7eb', fontWeight: 600 }}>+{formatBRL(invoiceSummary.nationalPurchasesMinor + invoiceSummary.internationalPurchasesMinor)}</span>
                </div>
                {invoiceSummary.chargesMinor > 0 && (
                  <div>
                    <span style={{ color: '#6b7280' }}>Encargos: </span>
                    <span style={{ color: '#fbbf24', fontWeight: 600 }}>+{formatBRL(invoiceSummary.chargesMinor)}</span>
                  </div>
                )}
                <div style={{ marginLeft: 'auto', background: '#1a1f35', borderRadius: 8, padding: '0.4rem 0.8rem' }}>
                  <span style={{ color: '#93c5fd', fontSize: '0.78rem' }}>
                    💳 Total a pagar em {dueMonth || invoiceSummary.dueMonth}: </span>
                  <span style={{ color: '#f87171', fontWeight: 800, fontSize: '0.9rem' }}>
                    {formatBRL(invoiceSummary.totalMinor)}
                  </span>
                </div>
              </div>
            )}
          </Card>

          {/* Warnings */}
          {uncategorized.length > 0 && (
            <Alert variant="warning" style={{ marginBottom: '1rem' }}>
              <strong>{uncategorized.length} transacção(ões)</strong> sem categoria. Categorize antes de importar para melhor análise.
            </Alert>
          )}

          {errorMsg && <Alert variant="error" style={{ marginBottom: '1rem' }}>{errorMsg}</Alert>}

          {/* Table */}
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #1e2130', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <SectionTitle style={{ margin: 0 }}>
                {transactions.length} transacções extraídas · {included.length} seleccionadas
              </SectionTitle>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => selectAll(true)}
                  style={{ background: 'none', border: '1px solid #2a2f45', borderRadius: 6, color: '#9ca3af', cursor: 'pointer', padding: '3px 10px', fontSize: '0.78rem' }}
                >
                  Seleccionar tudo
                </button>
                <button
                  onClick={() => selectAll(false)}
                  style={{ background: 'none', border: '1px solid #2a2f45', borderRadius: 6, color: '#9ca3af', cursor: 'pointer', padding: '3px 10px', fontSize: '0.78rem' }}
                >
                  Desmarcar tudo
                </button>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ color: '#6b7280', borderBottom: '1px solid #2a2f45', background: '#0f1117' }}>
                    <th style={{ padding: '0.5rem', width: 36 }}></th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Data</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Descrição</th>
                    <th style={{ padding: '0.5rem', textAlign: 'right' }}>Valor</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Competência</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Categoria</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <TransactionPreviewRow
                      key={tx.id}
                      tx={tx}
                      categories={categories}
                      onChange={handleChange}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
            <Button onClick={reset} variant="secondary">Cancelar</Button>
            <Button
              onClick={handleImport}
              disabled={included.length === 0 || !dueMonth}
            >
              Importar {included.length} transacções →
            </Button>
          </div>
        </>
      )}

      {/* Step: importing */}
      {step === 'importing' && (
        <Card style={{ textAlign: 'center', padding: '3rem' }}>
          <Spinner size={40} />
          <p style={{ color: '#9ca3af', marginTop: '1rem', fontSize: '0.9rem' }}>
            Importando {included.length} transacções...
          </p>
        </Card>
      )}

      {/* Step: done */}
      {step === 'done' && importResult && (
        <Card style={{ textAlign: 'center', padding: '2.5rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
          <h2 style={{ color: '#4ade80', fontWeight: 800, marginBottom: '0.5rem', fontSize: '1.2rem' }}>
            Fatura importada com sucesso!
          </h2>
          <div style={{ display: 'flex', gap: '2rem', justifyContent: 'center', marginTop: '1rem', marginBottom: '1.5rem' }}>
            <div>
              <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>Importadas</p>
              <p style={{ fontSize: '1.5rem', fontWeight: 800, color: '#4ade80' }}>{importResult.imported}</p>
            </div>
            <div>
              <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>Ignoradas</p>
              <p style={{ fontSize: '1.5rem', fontWeight: 800, color: '#6b7280' }}>{importResult.skipped}</p>
            </div>
            <div>
              <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>Total fatura</p>
              <p style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f87171' }}>
                {formatBRL(invoiceSummary?.totalMinor ?? 0)}
              </p>
            </div>
          </div>
          <div
            style={{
              padding: '0.75rem 1rem',
              background: '#1a2a3a',
              borderLeft: '3px solid #6366f1',
              borderRadius: '0 8px 8px 0',
              fontSize: '0.82rem',
              color: '#93c5fd',
              textAlign: 'left',
              marginBottom: '1.5rem',
            }}
          >
            A fatura foi registada com vencimento em <strong>{dueMonth}</strong>. O pagamento da fatura afectará o caixa quando for processado.
          </div>
          <Button onClick={reset} fullWidth>Importar outra fatura</Button>
        </Card>
      )}

      {/* Step: error */}
      {step === 'error' && (
        <Card style={{ textAlign: 'center', padding: '2.5rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>❌</div>
          <Alert variant="error" style={{ marginBottom: '1.5rem' }}>{errorMsg}</Alert>
          <Button onClick={reset}>Tentar novamente</Button>
        </Card>
      )}
    </div>
  )
}

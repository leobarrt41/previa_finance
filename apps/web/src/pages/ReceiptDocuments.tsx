/**
 * ReceiptDocuments.tsx — Notas Fiscais & Comprovantes
 *
 * Hierarquia ETP §6.3: nota_fiscal (nível 4) > manual (nível 5)
 *
 * Fluxo:
 *   1. Usuário registra nota (cartão ou débito) → data_state = 'projected'
 *   2. Nota entra no CashFlow como previsão (laranja=cartão, vermelho=débito)
 *   3. Quando fatura/extrato chega → reconciliação automática → some do cashflow manual
 *
 * Botão rápido (FAB) fixo no canto inferior direito para uso no estabelecimento.
 */
import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  api,
  formatBRL,
  currentMonth,
  type ReceiptDocument,
  type ReceiptDocumentSummary,
  type Category,
  type AccountSummary,
} from '../services/api'
import {
  Card,
  Badge,
  Spinner,
  Alert,
  Button,
  Input,
  Select,
  SectionTitle,
} from '../components/ui'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function stateLabel(s: string) {
  if (s === 'projected')  return 'Pendente'
  if (s === 'reconciled') return 'Reconciliada'
  if (s === 'cancelled')  return 'Cancelada'
  return s
}

function stateColor(s: string): string {
  if (s === 'projected')  return '#f59e0b'
  if (s === 'reconciled') return '#22c55e'
  if (s === 'cancelled')  return '#6b7280'
  return '#9ca3af'
}

function paymentType(doc: ReceiptDocument): string {
  if (doc.expectedInvoiceMonth) return 'Cartão'
  return 'Débito'
}

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------
interface FormState {
  amountMinor: string
  purchaseDate: string
  purchaseMonth: string
  expectedInvoiceMonth: string
  merchantName: string
  merchantCnpj: string
  categoryId: string
  accountId: string
  nfeKey: string
  installmentTotal: string
  installmentCurrent: string
  description: string
  fileUrl: string
  fileType: string
  paymentKind: 'card' | 'debit'
}

const emptyForm = (): FormState => {
  const today = new Date()
  const mm = String(today.getMonth() + 1).padStart(2, '0')
  const dd = String(today.getDate()).padStart(2, '0')
  const yyyy = today.getFullYear()
  return {
    amountMinor: '',
    purchaseDate: `${yyyy}-${mm}-${dd}`,
    purchaseMonth: `${yyyy}-${mm}`,
    expectedInvoiceMonth: '',
    merchantName: '',
    merchantCnpj: '',
    categoryId: '',
    accountId: '',
    nfeKey: '',
    installmentTotal: '',
    installmentCurrent: '',
    description: '',
    fileUrl: '',
    fileType: '',
    paymentKind: 'card',
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ReceiptDocuments() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [month, setMonth] = useState(currentMonth())
  const [stateFilter, setStateFilter] = useState<string>('projected')
  const [docs, setDocs] = useState<ReceiptDocument[]>([])
  const [summary, setSummary] = useState<ReceiptDocumentSummary | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Modal
  const [showModal, setShowModal] = useState(false)
  const [modalMode, setModalMode] = useState<'quick' | 'full'>('quick')
  const [form, setForm] = useState<FormState>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Expanded card
  const [expandedId, setExpandedId] = useState<number | null>(null)

  // ---------------------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------------------
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [docsRes, sumRes] = await Promise.all([
        api.receiptDocuments.list({ month, state: stateFilter || undefined }),
        api.receiptDocuments.summary(month),
      ])
      setDocs(docsRes.data)
      setSummary(sumRes)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [month, stateFilter])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    api.categories.list().then(setCategories).catch(() => {})
    api.accounts.list().then(r => setAccounts(r.items)).catch(() => {})
  }, [])

  // Open quick modal if ?quick=1 in URL (botão rápido externo)
  useEffect(() => {
    if (searchParams.get('quick') === '1') {
      setModalMode('quick')
      setShowModal(true)
    }
  }, [searchParams])

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------
  async function handleSave() {
    if (!form.amountMinor || !form.purchaseDate || !form.purchaseMonth) {
      setSaveError('Valor, data e mês são obrigatórios.')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const amountMinor = Math.round(parseFloat(form.amountMinor.replace(',', '.')) * 100)
      await api.receiptDocuments.create({
        amountMinor,
        purchaseDate: new Date(form.purchaseDate).toISOString(),
        purchaseMonth: form.purchaseMonth,
        expectedInvoiceMonth: form.paymentKind === 'card' && form.expectedInvoiceMonth
          ? form.expectedInvoiceMonth
          : null,
        merchantName: form.merchantName || null,
        merchantCnpj: form.merchantCnpj || null,
        categoryId: form.categoryId || null,
        accountId: form.accountId ? Number(form.accountId) : null,
        nfeKey: form.nfeKey || null,
        installmentTotal: form.installmentTotal ? Number(form.installmentTotal) : null,
        installmentCurrent: form.installmentCurrent ? Number(form.installmentCurrent) : null,
        description: form.description || null,
        fileUrl: form.fileUrl || null,
        fileType: form.fileType || null,
      })
      setShowModal(false)
      setForm(emptyForm())
      load()
    } catch (e: any) {
      setSaveError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------
  async function handleDelete(id: number) {
    if (!confirm('Cancelar esta nota?')) return
    try {
      await api.receiptDocuments.remove(id)
      load()
    } catch (e: any) {
      alert(e.message)
    }
  }

  // ---------------------------------------------------------------------------
  // Photo upload (câmera nativa mobile)
  // ---------------------------------------------------------------------------
  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // Por ora guarda o nome local; upload S3 será implementado na próxima fase
    setForm(f => ({ ...f, fileUrl: file.name, fileType: file.type }))
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------
  const expenseCategories = categories.filter(c => c.type === 'expense' && !c.parentId)
  const cardAccounts = accounts.filter(a => a.type === 'credit_card')
  const debitAccounts = accounts.filter(a => a.type !== 'credit_card')

  // ---------------------------------------------------------------------------
  // Modal
  // ---------------------------------------------------------------------------
  function renderModal() {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        zIndex: 1000,
      }}>
        <div style={{
          background: '#1a1f35', borderRadius: '16px 16px 0 0',
          padding: '1.5rem', width: '100%', maxWidth: 480,
          maxHeight: '90vh', overflowY: 'auto',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ color: '#e5e7eb', margin: 0, fontSize: '1.1rem' }}>
              {modalMode === 'quick' ? '🧾 Nota Rápida' : '🧾 Nova Nota Fiscal'}
            </h3>
            <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: '1.4rem', cursor: 'pointer' }}>×</button>
          </div>

          {/* Tipo de pagamento */}
          <div style={{ display: 'flex', gap: 8, marginBottom: '1rem' }}>
            {(['card', 'debit'] as const).map(k => (
              <button key={k} onClick={() => setForm(f => ({ ...f, paymentKind: k }))}
                style={{
                  flex: 1, padding: '0.5rem', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: form.paymentKind === k ? (k === 'card' ? '#f59e0b' : '#ef4444') : '#2a2f45',
                  color: form.paymentKind === k ? '#000' : '#9ca3af', fontWeight: 600, fontSize: '0.85rem',
                }}>
                {k === 'card' ? '💳 Cartão' : '🏦 Débito'}
              </button>
            ))}
          </div>

          {/* Campos obrigatórios */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <Input
              label="Valor (R$) *"
              placeholder="0,00"
              value={form.amountMinor}
              onChange={e => setForm(f => ({ ...f, amountMinor: e.target.value }))}
              inputMode="decimal"
            />
            <Input
              label="Estabelecimento"
              placeholder="Nome do estabelecimento"
              value={form.merchantName}
              onChange={e => setForm(f => ({ ...f, merchantName: e.target.value }))}
            />
            <Input
              label="Data da compra *"
              type="date"
              value={form.purchaseDate}
              onChange={e => {
                const d = e.target.value
                const pm = d.substring(0, 7)
                setForm(f => ({ ...f, purchaseDate: d, purchaseMonth: pm }))
              }}
            />
            {form.paymentKind === 'card' && (
              <Input
                label="Mês estimado da fatura (YYYY-MM)"
                placeholder="2026-06"
                value={form.expectedInvoiceMonth}
                onChange={e => setForm(f => ({ ...f, expectedInvoiceMonth: e.target.value }))}
              />
            )}

            {/* Campos extras (modo full) */}
            {modalMode === 'full' && (
              <>
                <Select
                  label="Categoria"
                  value={form.categoryId}
                  onChange={e => setForm(f => ({ ...f, categoryId: e.target.value }))}
                >
                  <option value="">— Selecionar —</option>
                  {expenseCategories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
                <Select
                  label={form.paymentKind === 'card' ? 'Cartão' : 'Conta'}
                  value={form.accountId}
                  onChange={e => setForm(f => ({ ...f, accountId: e.target.value }))}
                >
                  <option value="">— Selecionar —</option>
                  {(form.paymentKind === 'card' ? cardAccounts : debitAccounts).map(a => (
                    <option key={a.id} value={a.id}>{a.displayName}</option>
                  ))}
                </Select>
                <Input
                  label="Chave NF-e (44 dígitos)"
                  placeholder="Chave de acesso da nota fiscal"
                  value={form.nfeKey}
                  onChange={e => setForm(f => ({ ...f, nfeKey: e.target.value }))}
                />
                <Input
                  label="CNPJ do estabelecimento"
                  placeholder="00.000.000/0000-00"
                  value={form.merchantCnpj}
                  onChange={e => setForm(f => ({ ...f, merchantCnpj: e.target.value }))}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <Input
                    label="Parcela atual"
                    type="number"
                    min={1}
                    value={form.installmentCurrent}
                    onChange={e => setForm(f => ({ ...f, installmentCurrent: e.target.value }))}
                  />
                  <Input
                    label="Total de parcelas"
                    type="number"
                    min={1}
                    value={form.installmentTotal}
                    onChange={e => setForm(f => ({ ...f, installmentTotal: e.target.value }))}
                  />
                </div>
                <Input
                  label="Descrição"
                  placeholder="Observações sobre a compra"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                />
              </>
            )}

            {/* Foto do comprovante */}
            <div>
              <label style={{ fontSize: '0.8rem', color: '#9ca3af', fontWeight: 500, display: 'block', marginBottom: 4 }}>
                Foto do comprovante
              </label>
              <input
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                onChange={handlePhotoChange}
                style={{ color: '#e5e7eb', fontSize: '0.85rem' }}
              />
              {form.fileUrl && (
                <p style={{ fontSize: '0.75rem', color: '#22c55e', marginTop: 4 }}>
                  Arquivo selecionado: {form.fileUrl}
                </p>
              )}
            </div>
          </div>

          {saveError && <Alert variant="error" style={{ marginTop: '0.75rem' }}>{saveError}</Alert>}

          {/* Acções */}
          <div style={{ display: 'flex', gap: 8, marginTop: '1rem' }}>
            {modalMode === 'quick' && (
              <Button variant="secondary" onClick={() => setModalMode('full')}>
                + Detalhes
              </Button>
            )}
            <Button onClick={handleSave} disabled={saving} fullWidth>
              {saving ? 'Salvando...' : 'Salvar Nota'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------
  return (
    <div style={{ padding: '1rem', maxWidth: 700, margin: '0 auto', paddingBottom: 100 }}>
      <SectionTitle>🧾 Notas Fiscais</SectionTitle>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, marginBottom: '1rem', flexWrap: 'wrap' }}>
        <Input
          type="month"
          value={month}
          onChange={e => setMonth(e.target.value)}
          style={{ width: 160 }}
        />
        <Select
          value={stateFilter}
          onChange={e => setStateFilter(e.target.value)}
          style={{ width: 160 }}
        >
          <option value="">Todas</option>
          <option value="projected">Pendentes</option>
          <option value="reconciled">Reconciliadas</option>
          <option value="cancelled">Canceladas</option>
        </Select>
        <Button onClick={() => { setModalMode('full'); setShowModal(true) }} variant="secondary">
          + Nova Nota
        </Button>
      </div>

      {/* Resumo */}
      {summary && (
        <div style={{ display: 'flex', gap: 8, marginBottom: '1rem', flexWrap: 'wrap' }}>
          <Card style={{ flex: 1, minWidth: 120, textAlign: 'center' }}>
            <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: 4 }}>Pendente</div>
            <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: '1.1rem' }}>{formatBRL(summary.projected)}</div>
          </Card>
          <Card style={{ flex: 1, minWidth: 120, textAlign: 'center' }}>
            <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: 4 }}>Reconciliada</div>
            <div style={{ color: '#22c55e', fontWeight: 700, fontSize: '1.1rem' }}>{formatBRL(summary.reconciled)}</div>
          </Card>
          <Card style={{ flex: 1, minWidth: 120, textAlign: 'center' }}>
            <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: 4 }}>Total</div>
            <div style={{ color: '#60a5fa', fontWeight: 700, fontSize: '1.1rem' }}>{formatBRL(summary.total)}</div>
          </Card>
        </div>
      )}

      {/* Conteúdo */}
      {loading && <div style={{ textAlign: 'center', padding: '2rem' }}><Spinner /></div>}
      {error && <Alert variant="error">{error}</Alert>}

      {!loading && !error && docs.length === 0 && (
        <Card style={{ textAlign: 'center', padding: '2rem', color: '#6b7280' }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>🧾</div>
          <div>Nenhuma nota registrada para este mês.</div>
          <div style={{ fontSize: '0.85rem', marginTop: 4 }}>
            Use o botão <strong>+</strong> no canto inferior direito para registrar uma compra no estabelecimento.
          </div>
        </Card>
      )}

      {/* Lista de notas */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {docs.map(doc => (
          <Card key={doc.id} style={{ cursor: 'pointer' }} onClick={() => setExpandedId(expandedId === doc.id ? null : doc.id)}>
            {/* Linha principal */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Badge variant={doc.dataState === 'projected' ? 'yellow' : doc.dataState === 'reconciled' ? 'green' : 'gray'}>
                    {stateLabel(doc.dataState)}
                  </Badge>
                  <Badge variant={doc.expectedInvoiceMonth ? 'blue' : 'gray'}>
                    {paymentType(doc)}
                  </Badge>
                </div>
                <div style={{ color: '#e5e7eb', fontWeight: 600 }}>
                  {doc.merchantName || 'Estabelecimento não informado'}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#9ca3af' }}>
                  {fmtDate(doc.purchaseDate)}
                  {doc.installmentTotal && ` · ${doc.installmentCurrent}/${doc.installmentTotal}x`}
                  {doc.expectedInvoiceMonth && ` · Fatura ${doc.expectedInvoiceMonth}`}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: '#f87171', fontWeight: 700, fontSize: '1.1rem' }}>
                  -{formatBRL(doc.amountMinor)}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 2 }}>
                  {expandedId === doc.id ? '▲' : '▼'}
                </div>
              </div>
            </div>

            {/* Detalhes expandidos */}
            {expandedId === doc.id && (
              <div style={{ marginTop: '0.75rem', borderTop: '1px solid #2a2f45', paddingTop: '0.75rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.82rem', color: '#9ca3af' }}>
                  {doc.merchantCnpj && <div><strong>CNPJ:</strong> {doc.merchantCnpj}</div>}
                  {doc.categoryId && <div><strong>Categoria:</strong> {doc.categoryId}</div>}
                  {doc.nfeKey && <div style={{ gridColumn: '1/-1' }}><strong>Chave NF-e:</strong> <span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{doc.nfeKey}</span></div>}
                  {doc.description && <div style={{ gridColumn: '1/-1' }}><strong>Descrição:</strong> {doc.description}</div>}
                  {doc.fileUrl && (
                    <div style={{ gridColumn: '1/-1' }}>
                      <strong>Comprovante:</strong>{' '}
                      {doc.fileType?.startsWith('image/') ? (
                        <img src={doc.fileUrl} alt="comprovante" style={{ maxWidth: 200, borderRadius: 8, marginTop: 4 }} />
                      ) : (
                        <a href={doc.fileUrl} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>Ver arquivo</a>
                      )}
                    </div>
                  )}
                  {doc.reconciledAt && <div><strong>Reconciliada em:</strong> {fmtDate(doc.reconciledAt)}</div>}
                </div>

                {/* Acções */}
                {doc.dataState === 'projected' && (
                  <div style={{ display: 'flex', gap: 8, marginTop: '0.75rem' }}>
                    <Button
                      variant="danger"
                      onClick={() => handleDelete(doc.id)}
                    >
                      Cancelar nota
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* Modal */}
      {showModal && renderModal()}

      {/* FAB — Botão rápido */}
      <button
        onClick={() => { setModalMode('quick'); setForm(emptyForm()); setShowModal(true) }}
        title="Registrar nota rápida"
        style={{
          position: 'fixed', bottom: 24, right: 24,
          width: 56, height: 56, borderRadius: '50%',
          background: '#3b82f6', border: 'none',
          color: '#fff', fontSize: '1.6rem', cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(59,130,246,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 999,
        }}
      >
        +
      </button>
    </div>
  )
}

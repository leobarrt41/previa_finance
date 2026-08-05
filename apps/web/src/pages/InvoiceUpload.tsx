/**
 * InvoiceUpload.tsx — Upload e Preview de Fatura
 *
 * Fluxo:
 *  1. Utilizador selecciona um PDF de fatura
 *  2. Frontend envia para POST /api/invoices/parse (multipart)
 *  3. API retorna lista de transacções extraídas (preview)
 *  4. Utilizador pode categorizar cada linha e ajustar o mês de competência
 *  5. Confirma importação → POST /api/invoices/import
 *
 * Enquanto o parser não está implementado na API, o frontend
 * simula o preview com dados de exemplo para permitir testar o fluxo.
 */
import { useState, useRef, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  api,
  formatBRL,
  currentMonth,
  type Category,
  type OpenCardInvoiceSummary,
  type InvoiceTransaction,
  type InvoiceParseDebug,
  type InvoiceParseResult,
} from '../services/api'
import { buildCategoryOptions, type CategoryOption } from '../utils/categoryOptions'
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
import { InvoicePaymentSelector, buildInvoicePaymentOptions } from '../components/InvoicePaymentSelector'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ParsedTransaction = InvoiceTransaction
type ParsedInstallment = NonNullable<InvoiceParseResult['analysis']>['installments'][number]
type InstallmentCategoryMap = Record<string, string | null>

type UploadStep = 'select' | 'parsing' | 'preview' | 'importing' | 'done' | 'error'

function isInvalidInstallmentDescription(value: string): boolean {
  const description = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()

  return description.includes('pagamento efetuado')
    || description.includes('total desta fatura')
    || description.includes('total da fatura')
}

function sanitizeInvoiceAnalysis(
  analysis: InvoiceParseResult['analysis'] | null,
): InvoiceParseResult['analysis'] | null {
  if (!analysis) return null
  return {
    ...analysis,
    installments: analysis.installments.filter(
      (item) => !isInvalidInstallmentDescription(item.description),
    ),
  }
}

function installmentKey(item: ParsedInstallment, index: number): string {
  return [item.description, item.date ?? '', item.current ?? '', item.total ?? '', item.amount, index].join('|')
}

function getInitialDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return params.get('debug') === '1' || params.get('debug') === 'true'
}

function normalizeCategoryText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

function toCompetencyMonth(value: string | undefined, fallbackDate?: string): string {
  if (value && /^\d{4}-\d{2}$/.test(value)) return value
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(0, 7)
  if (fallbackDate && /^\d{4}-\d{2}-\d{2}$/.test(fallbackDate)) return fallbackDate.slice(0, 7)
  return value?.slice(0, 7) || ''
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
        Arraste o PDF da fatura aqui
      </p>
      <p style={{ color: '#6b7280', fontSize: '0.82rem' }}>
        ou clique para seleccionar o arquivo
      </p>
      <p style={{ color: '#fbbf24', fontSize: '0.75rem', marginTop: '0.5rem', fontWeight: 600 }}>
        Fatura de cartão: apenas PDF. OFX não é usado neste fluxo.
      </p>
      <p style={{ color: '#fbbf24', fontSize: '0.72rem', marginTop: '0.2rem' }}>
        Suportado: Banco do Brasil PDF · Bradesco PDF · Itaú PDF
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
      />
    </div>
  )
}

function TransactionPreviewRow({
  tx,
  categoryOptions,
  invoiceOptions,
  showInvoiceSelector,
  onChange,
}: {
  tx: ParsedTransaction
  categoryOptions: CategoryOption[]
  invoiceOptions: { id: number; label: string }[]
  showInvoiceSelector: boolean
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
      <td style={{ padding: '0.45rem 0.5rem', fontSize: '0.8rem', color: '#9ca3af', whiteSpace: 'nowrap' }}>
        {tx.date}
      </td>
      <td style={{ padding: '0.45rem 0.5rem', fontSize: '0.82rem', color: '#e5e7eb', overflowWrap: 'anywhere' }}>
        {tx.description}
        {tx.installment && (
          <span style={{ marginLeft: 6, fontSize: '0.72rem', color: '#6366f1' }}>
            parcela {tx.installment}
          </span>
        )}
      </td>
      <td style={{ padding: '0.45rem 0.5rem', textAlign: 'right', fontSize: '0.85rem', color: '#f87171', fontWeight: 600, whiteSpace: 'nowrap' }}>
        {formatBRL(tx.amountMinor)}
      </td>
      <td style={{ padding: '0.45rem 0.5rem' }}>
        <input
          value={tx.competencyMonth}
          onChange={(e) => onChange(tx.id, { competencyMonth: e.target.value })}
          placeholder="YYYY-MM"
          style={{
            background: '#0f1117', border: '1px solid #2a2f45', borderRadius: 6,
            padding: '3px 6px', color: '#e5e7eb', fontSize: '0.78rem', width: '100%', minWidth: 0,
          }}
        />
      </td>
      <td style={{ padding: '0.45rem 0.5rem' }}>
        <SearchableCategorySelect
          value={tx.categoryId ?? ''}
          options={categoryOptions}
          onChange={(categoryId) => onChange(tx.id, { categoryId })}
        />
      </td>
      <td style={{ padding: '0.45rem 0.5rem' }}>
        {showInvoiceSelector ? (
          <InvoicePaymentSelector
            value={tx.settlesInvoiceId ?? null}
            options={invoiceOptions}
            onChange={(invoiceId) => onChange(tx.id, { settlesInvoiceId: invoiceId })}
            style={{ width: '100%', minWidth: 0 }}
          />
        ) : (
          <span style={{ color: '#475569', fontSize: '0.82rem' }}>—</span>
        )}
      </td>
    </tr>
  )
}

function SearchableCategorySelect({
  value,
  options,
  onChange,
}: {
  value: string
  options: CategoryOption[]
  onChange: (categoryId: string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const selectedOption = options.find((option) => option.id === value)
  const cleanLabel = (label: string) => label.replace(/^\s*└\s*/, '').trim()
  const [query, setQuery] = useState(selectedOption ? cleanLabel(selectedOption.label) : '')
  const [open, setOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, width: 320 })

  const groups = useMemo(() => {
    const result: Array<{ category: CategoryOption | null; subcategories: CategoryOption[] }> = []
    let current: { category: CategoryOption | null; subcategories: CategoryOption[] } | null = null

    for (const option of options) {
      if (option.disabled) {
        current = { category: option, subcategories: [] }
        result.push(current)
        continue
      }

      if (!current) {
        current = { category: null, subcategories: [] }
        result.push(current)
      }
      current.subcategories.push(option)
    }

    return result
  }, [options])

  const visibleGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR')
    if (!normalizedQuery) return groups

    return groups.flatMap((group) => {
      const categoryMatches = group.category
        ? cleanLabel(group.category.label).toLocaleLowerCase('pt-BR').includes(normalizedQuery)
        : false
      const subcategories = categoryMatches
        ? group.subcategories
        : group.subcategories.filter((option) =>
            cleanLabel(option.label).toLocaleLowerCase('pt-BR').includes(normalizedQuery),
          )
      return categoryMatches || subcategories.length > 0 ? [{ ...group, subcategories }] : []
    })
  }, [groups, query])

  useEffect(() => {
    setQuery(selectedOption ? cleanLabel(selectedOption.label) : '')
  }, [selectedOption?.id, selectedOption?.label])

  useEffect(() => {
    if (!open) return

    const updatePosition = () => {
      const rect = inputRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.max(320, rect.width)
      setMenuPosition({
        top: rect.bottom + 6,
        left: Math.min(rect.left, Math.max(8, window.innerWidth - width - 8)),
        width,
      })
    }
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (!inputRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      document.removeEventListener('mousedown', closeOnOutsideClick)
    }
  }, [open])

  const firstVisibleSubcategory = visibleGroups.flatMap((group) => group.subcategories)[0]

  const isPending = !value

  return (
    <>
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
          if (!event.target.value.trim()) onChange(null)
        }}
        onFocus={(event) => {
          event.currentTarget.select()
          setOpen(true)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
          if (event.key === 'Enter' && firstVisibleSubcategory) {
            event.preventDefault()
            onChange(firstVisibleSubcategory.id)
            setQuery(cleanLabel(firstVisibleSubcategory.label))
            setOpen(false)
          }
        }}
        placeholder="🔎 Pesquisar subcategoria..."
        aria-label="Pesquisar e selecionar subcategoria"
        aria-expanded={open}
        title={isPending ? 'Categoria obrigatória: pesquise e selecione uma subcategoria' : selectedOption?.label}
        style={{
          background: isPending ? '#450a0a' : '#0f1117',
          border: `2px solid ${isPending ? '#ef4444' : '#2a2f45'}`,
          boxShadow: isPending ? '0 0 0 2px rgba(239, 68, 68, 0.22)' : 'none',
          borderRadius: 6,
          padding: '4px 7px',
          color: isPending ? '#fecaca' : '#e5e7eb',
          fontSize: '0.78rem',
          fontWeight: isPending ? 800 : 500,
          width: '100%',
          minWidth: 0,
          boxSizing: 'border-box',
          outline: 'none',
        }}
      />
      {open && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          style={{
            position: 'fixed',
            zIndex: 10000,
            top: menuPosition.top,
            left: menuPosition.left,
            width: menuPosition.width,
            maxHeight: 390,
            overflowY: 'auto',
            background: '#111318',
            border: '1px solid #ef4444',
            borderRadius: 10,
            boxShadow: '0 18px 45px rgba(0, 0, 0, 0.65)',
            padding: '6px 0',
          }}
        >
          {visibleGroups.length === 0 && (
            <div style={{ padding: '12px 14px', color: '#9ca3af', fontSize: '0.8rem' }}>
              Nenhuma subcategoria encontrada
            </div>
          )}
          {visibleGroups.map((group, groupIndex) => (
            <div key={group.category?.id ?? `uncategorized-${groupIndex}`}>
              {group.category && (
                <div
                  style={{
                    padding: '9px 14px 6px',
                    color: '#ff3b30',
                    background: '#2b0b0b',
                    borderTop: groupIndex > 0 ? '1px solid #4c1111' : 'none',
                    fontSize: '0.78rem',
                    fontWeight: 900,
                    letterSpacing: '0.055em',
                    textTransform: 'uppercase',
                  }}
                >
                  {cleanLabel(group.category.label)}
                </div>
              )}
              {group.subcategories.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={option.id === value}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(option.id)
                    setQuery(cleanLabel(option.label))
                    setOpen(false)
                  }}
                  onMouseEnter={(event) => { event.currentTarget.style.background = '#312e3f' }}
                  onMouseLeave={(event) => { event.currentTarget.style.background = option.id === value ? '#29213a' : 'transparent' }}
                  style={{
                    display: 'block',
                    width: '100%',
                    border: 0,
                    background: option.id === value ? '#29213a' : 'transparent',
                    padding: '8px 14px 8px 28px',
                    color: '#f8fafc',
                    textAlign: 'left',
                    fontSize: '0.84rem',
                    fontWeight: option.id === value ? 800 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {cleanLabel(option.label)}
                </button>
              ))}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}

function DebugStageCard({ label, content }: { label: string; content: string }) {
  return (
    <details
      style={{
        background: '#0f1117',
        border: '1px solid #2a2f45',
        borderRadius: 10,
        padding: '0.7rem 0.85rem',
      }}
    >
      <summary style={{ cursor: 'pointer', color: '#e5e7eb', fontWeight: 700, fontSize: '0.86rem' }}>
        {label}
      </summary>
      <pre
        style={{
          marginTop: '0.75rem',
          marginBottom: 0,
          padding: '0.75rem',
          background: '#0b0d14',
          borderRadius: 8,
          color: '#cbd5e1',
          fontSize: '0.72rem',
          lineHeight: 1.45,
          whiteSpace: 'pre-wrap',
          overflowX: 'auto',
          maxHeight: 320,
        }}
      >
        {content}
      </pre>
    </details>
  )
}

function InvoiceDebugPanel({ debug }: { debug: InvoiceParseDebug }) {
  return (
    <Card style={{ marginBottom: '1rem', border: '1px solid #4b5563', background: '#10121a' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <div>
          <p style={{ margin: 0, color: '#fbbf24', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Debug temporário
          </p>
          <p style={{ margin: '0.25rem 0 0', color: '#e5e7eb', fontWeight: 700, fontSize: '0.95rem' }}>
            {debug.strategy} · {debug.sourceBank}
          </p>
        </div>
        <div style={{ color: '#94a3b8', fontSize: '0.8rem', alignSelf: 'flex-end' }}>
          Mostrando etapas da leitura
        </div>
      </div>
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {debug.stages.map((stage) => (
          <DebugStageCard key={stage.label} label={stage.label} content={stage.content} />
        ))}
      </div>
    </Card>
  )
}

function InvoiceInstallmentsPanel({
  installments,
  categoryOptions,
  categoryIds,
  onCategoryChange,
}: {
  installments: ParsedInstallment[]
  categoryOptions: CategoryOption[]
  categoryIds: InstallmentCategoryMap
  onCategoryChange: (key: string, categoryId: string | null) => void
}) {
  if (installments.length === 0) return null

  return (
    <Card style={{ marginBottom: '1rem', border: '1px solid #334155', background: '#10121a' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.85rem' }}>
        <div>
          <p style={{ margin: 0, color: '#fbbf24', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Parcelamentos detectados
          </p>
          <p style={{ margin: '0.25rem 0 0', color: '#e5e7eb', fontWeight: 700, fontSize: '0.92rem' }}>
            Itens já parcelados, financiamentos e séries de parcelas da fatura
          </p>
        </div>
        <div style={{ color: '#9ca3af', fontSize: '0.78rem', alignSelf: 'flex-end' }}>
          São importados junto com a fatura, mas não entram no total seleccionado desta página
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', tableLayout: 'fixed' }}>
          <thead>
            <tr style={{ color: '#6b7280', borderBottom: '1px solid #2a2f45', background: '#0f1117' }}>
              <th style={{ padding: '0.5rem', textAlign: 'left' }}>Descrição</th>
              <th style={{ padding: '0.5rem', width: 100, textAlign: 'right' }}>Valor</th>
              <th style={{ padding: '0.5rem', width: 104, textAlign: 'left' }}>Data</th>
              <th style={{ padding: '0.5rem', width: 100, textAlign: 'left' }}>Parcela</th>
              <th style={{ padding: '0.5rem', width: 240, textAlign: 'left' }}>Categoria</th>
            </tr>
          </thead>
          <tbody>
            {installments.map((item, index) => (
              <tr
                key={`${item.description}-${item.date ?? 'nodate'}-${index}`}
                style={{ borderBottom: '1px solid #1a1e2e', opacity: item.isPrepayment ? 0.6 : 1 }}
              >
                <td style={{ padding: '0.55rem 0.5rem', color: '#e5e7eb', overflowWrap: 'anywhere' }}>
                  {item.description}
                  {item.isPrepayment && (
                    <span
                      title="Adiantamento automático de parcelas — não entra nos gastos mensais"
                      style={{
                        marginLeft: '0.4rem',
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        color: '#f59e0b',
                        background: '#78350f33',
                        border: '1px solid #92400e',
                        borderRadius: 4,
                        padding: '1px 5px',
                        verticalAlign: 'middle',
                        letterSpacing: 0.3,
                      }}
                    >
                      ADIANTAMENTO
                    </span>
                  )}
                </td>
                <td style={{ padding: '0.55rem 0.5rem', textAlign: 'right', color: item.isPrepayment ? '#6b7280' : '#f87171', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {formatBRL(Math.round(item.amount * 100))}
                </td>
                <td style={{ padding: '0.55rem 0.5rem', color: '#9ca3af', whiteSpace: 'nowrap' }}>
                  {item.date ?? '—'}
                </td>
                <td style={{ padding: '0.55rem 0.5rem', color: '#cbd5e1' }}>
                  {item.current && item.total ? `${item.current}/${item.total}` : '—'}
                </td>
                <td style={{ padding: '0.45rem 0.5rem' }}>
                  <SearchableCategorySelect
                    value={categoryIds[installmentKey(item, index)] ?? ''}
                    options={categoryOptions}
                    onChange={(categoryId) => onCategoryChange(installmentKey(item, index), categoryId)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function DebugStatusCard({ debugEnabled, hasDebug, isReprocessing }: { debugEnabled: boolean; hasDebug: boolean; isReprocessing: boolean }) {
  if (!debugEnabled) return null

  return (
    <Card style={{ marginBottom: '1rem', border: '1px solid #3f3f46', background: '#111827' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <p style={{ margin: 0, color: '#fbbf24', fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase' }}>
            Debug de leitura
          </p>
          <p style={{ margin: '0.25rem 0 0', color: '#e5e7eb', fontWeight: 700, fontSize: '0.9rem' }}>
            {hasDebug ? 'Etapas carregadas' : isReprocessing ? 'Reprocessando fatura para gerar ASCII e JSON...' : 'Aguardando leitura da fatura'}
          </p>
        </div>
        <div style={{ color: '#9ca3af', fontSize: '0.78rem' }}>
          {hasDebug ? 'Role para ver o ASCII abaixo.' : 'Se a fatura já estiver aberta, o upload será repetido.'}
        </div>
      </div>
    </Card>
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
  const [invoiceAnalysis, setInvoiceAnalysis] = useState<InvoiceParseResult['analysis'] | null>(null)
  const [installmentCategoryIds, setInstallmentCategoryIds] = useState<InstallmentCategoryMap>({})
  const [invoiceBank, setInvoiceBank] = useState<string | null>(null)
  const [openInvoices, setOpenInvoices] = useState<OpenCardInvoiceSummary[]>([])
  const [parseDebug, setParseDebug] = useState<InvoiceParseDebug | null>(null)
  const [debugEnabled, setDebugEnabled] = useState<boolean>(getInitialDebugEnabled())
  const [debugReprocessing, setDebugReprocessing] = useState(false)

  const categoryOptions = useMemo(() => {
    return buildCategoryOptions(categories, 'expense')
  }, [categories])

  const expenseCategories = useMemo(
    () => categories.filter((c) => c.type === 'expense'),
    [categories]
  )

  const invoiceOptions = useMemo(
    () => buildInvoicePaymentOptions(null, openInvoices),
    [openInvoices],
  )

  useEffect(() => {
    api.categories.list().then(setCategories).catch(() => {})
  }, [])

  useEffect(() => {
    api.accounts.openCardInvoices().then((result) => setOpenInvoices(result.items)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!debugEnabled || !file || step !== 'preview') return
    setDebugReprocessing(true)
    parseSelectedFile(file, pdfPassword.trim() || undefined).finally(() => setDebugReprocessing(false))
    // Reprocessa só quando o debug é activado com a fatura já carregada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debugEnabled])

  function isPasswordRequiredError(error: unknown): boolean {
    return error instanceof Error
      && error.message.toLowerCase().includes('pdf protegido por senha')
  }

  async function suggestCategoriesWithAI(
    parsedTransactions: ParsedTransaction[],
    parsedInstallments: ParsedInstallment[],
    availableExpenseCategories: Category[] = expenseCategories,
  ): Promise<{ transactions: ParsedTransaction[]; installmentCategories: InstallmentCategoryMap }> {
    if (availableExpenseCategories.length === 0) {
      return { transactions: parsedTransactions, installmentCategories: {} }
    }

    const pending = parsedTransactions.filter((t) => t.include && !t.categoryId)
    const installmentCandidates = parsedInstallments.map((item, index) => ({
      id: `invoice-installment-${index}`,
      key: installmentKey(item, index),
      item,
    }))
    if (pending.length === 0 && installmentCandidates.length === 0) {
      return { transactions: parsedTransactions, installmentCategories: {} }
    }

    try {
      const response = await api.invoices.classify({
        transactions: [
          ...pending.map((t) => ({
            id: t.id,
            description: t.description,
            amountMinor: t.amountMinor,
            country: t.country,
            installment: t.installment,
          })),
          ...installmentCandidates.map(({ id, item }) => ({
            id,
            description: item.description,
            amountMinor: Math.round(item.amount * 100),
            installment: item.current && item.total ? `${item.current}/${item.total}` : undefined,
          })),
        ],
        categories: availableExpenseCategories.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          type: c.type,
          parentId: c.parentId,
        })),
      })

      const suggestions = response.suggestions ?? {}
      const installmentCategories = Object.fromEntries(
        installmentCandidates.map(({ id, key }) => {
          const suggestion = suggestions[id]
          return [key, suggestion ? (suggestion.subcategoryId ?? suggestion.categoryId) : null]
        }),
      )

      return {
        transactions: parsedTransactions.map((t) => {
          const suggestion = suggestions[t.id]
          if (!suggestion) return t
          return {
            ...t,
            categoryId: suggestion.subcategoryId ?? suggestion.categoryId,
          }
        }),
        installmentCategories,
      }
    } catch {
      return { transactions: parsedTransactions, installmentCategories: {} }
    }
  }

  async function parseSelectedFile(selectedFile: File, password?: string) {
    setStep('parsing')
    setErrorMsg('')
    setParseDebug(null)

    try {
      const result = await api.invoices.parse(selectedFile, { password, debug: debugEnabled })
      if (result.summary.dueMonth) setDueMonth(result.summary.dueMonth)
      if (result.summary.invoiceMonth) setInvoiceMonth(result.summary.invoiceMonth)
      setInvoiceSummary(result.summary)
      const sanitizedAnalysis = sanitizeInvoiceAnalysis(result.analysis ?? null)
      setInvoiceAnalysis(sanitizedAnalysis)
      setInvoiceBank(result.bank)
      setParseDebug(result.debug ?? null)

      let availableExpenseCategories = expenseCategories
      if (availableExpenseCategories.length === 0) {
        try {
          const loadedCategories = await api.categories.list()
          setCategories(loadedCategories)
          availableExpenseCategories = loadedCategories.filter((category) => category.type === 'expense')
        } catch {
          // A categorização continua manual quando as categorias não puderem ser carregadas.
        }
      }

      const categorized = await suggestCategoriesWithAI(
        result.transactions,
        sanitizedAnalysis?.installments ?? [],
        availableExpenseCategories,
      )
      setTransactions(categorized.transactions)
      setInstallmentCategoryIds(categorized.installmentCategories)

      setAwaitingPassword(false)
      setStep('preview')
    } catch (e: unknown) {
      if (isPasswordRequiredError(e)) {
        setAwaitingPassword(true)
        setErrorMsg('Esta fatura exige senha. Informe a senha para gerar o preview.')
        setStep('select')
        return
      }
      setErrorMsg(e instanceof Error ? e.message : 'Erro ao processar o arquivo. Verifique se é um PDF válido.')
      setStep('error')
    }
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
    setTransactions((prev) => prev.map((t) => {
      if (t.id !== id) return t
      const next = { ...t, ...patch }
      if (patch.categoryId !== undefined && !isCreditCardInvoiceCategoryId(patch.categoryId, categories)) {
        next.settlesInvoiceId = null
      }
      return next
    }))
  }

  function selectAll(include: boolean) {
    setTransactions((prev) => prev.map((t) => ({ ...t, include })))
  }

  const included = transactions.filter((t) => t.include)
  const uncategorized = included.filter((t) => !t.categoryId)
  const uncategorizedInstallments = (invoiceAnalysis?.installments ?? []).filter(
    (item, index) => !installmentCategoryIds[installmentKey(item, index)],
  )
  const total = included.reduce((sum, t) => sum + t.amountMinor, 0)

  async function handleImport() {
    if (!dueMonth) { setErrorMsg('Informe o mês de vencimento da fatura'); return }
    setStep('importing')
    setErrorMsg('')
    try {
      const result = await api.invoices.import({
        transactions: included.map(({ date, description, amountMinor, categoryId, competencyMonth, installment, settlesInvoiceId }) => ({
          date,
          description,
          amountMinor,
          categoryId,
          competencyMonth: toCompetencyMonth(competencyMonth, date),
          installment,
          settlesInvoiceId,
        })),
        installments: invoiceAnalysis?.installments.map((item, index) => ({
          date: item.date ?? invoiceSummary?.dueDate ?? `${invoiceMonth}-01`,
          description: item.description,
          amountMinor: Math.round(item.amount * 100),
          competencyMonth: toCompetencyMonth(item.date?.slice(0, 7), item.date ?? invoiceSummary?.dueDate ?? `${invoiceMonth}-01`),
          installment: item.current && item.total ? `${item.current}/${item.total}` : undefined,
          categoryId: installmentCategoryIds[installmentKey(item, index)] ?? null,
          isPrepayment: item.isPrepayment ?? false,
        })) ?? [],
        invoiceMonth,
        dueMonth,
        bank: invoiceBank ?? undefined,
        cardLast4: invoiceSummary?.cardLast4 ?? undefined,
        product: invoiceSummary?.product ?? undefined,
        sourceFileName: file?.name,
        dueDate: invoiceSummary?.dueDate ?? undefined,
        closingDate: invoiceSummary?.closingDate ?? undefined,
        totalMinor: invoiceSummary?.totalMinor ?? undefined,
        previousBalanceMinor: invoiceSummary?.previousBalanceMinor ?? undefined,
        paymentsMinor: invoiceSummary?.paymentsMinor ?? undefined,
        monthlyExpensesMinor: invoiceSummary?.monthlyExpensesMinor ?? undefined,
        creditsAndRefundsMinor: invoiceSummary?.creditsAndRefundsMinor ?? undefined,
        chargesMinor: invoiceSummary?.chargesMinor ?? undefined,
        financedBalanceMinor: invoiceSummary?.financedBalanceMinor ?? undefined,
        openBalanceMinor: invoiceSummary?.openBalanceMinor ?? undefined,
        analysis: invoiceAnalysis
          ? {
              ...invoiceAnalysis,
              installments: invoiceAnalysis.installments?.map((item) => ({
                ...item,
                current: item.current && item.current > 0 ? item.current : undefined,
                total: item.total && item.total > 0 ? item.total : undefined,
              })),
            }
          : undefined,
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
    setInvoiceAnalysis(null)
    setInstallmentCategoryIds({})
    setInvoiceBank(null)
    setParseDebug(null)
  }

  return (
    <div style={{ maxWidth: 1000 }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#e5e7eb', margin: 0 }}>
              📤 Upload de Fatura
            </h1>
            <p style={{ color: '#6b7280', marginTop: '0.3rem', fontSize: '0.85rem' }}>
              Importe faturas de cartão em PDF ou CSV. Revise e categorize antes de confirmar.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDebugEnabled((v) => !v)}
            style={{
              alignSelf: 'flex-start',
              background: debugEnabled ? '#1f2937' : '#111827',
              border: `1px solid ${debugEnabled ? '#f59e0b' : '#374151'}`,
              borderRadius: 999,
              color: debugEnabled ? '#fbbf24' : '#9ca3af',
              cursor: 'pointer',
              padding: '0.5rem 0.85rem',
              fontSize: '0.78rem',
              fontWeight: 700,
            }}
          >
            {debugEnabled ? 'Debug ligado' : 'Debug desligado'}
          </button>
        </div>
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
                  <span style={{ color: '#6b7280' }}>Total da fatura anterior: </span>
                  <span style={{ color: '#f87171', fontWeight: 600 }}>{formatBRL(invoiceSummary.previousBalanceMinor)}</span>
                </div>
                {typeof invoiceSummary.financedBalanceMinor === 'number' && invoiceSummary.financedBalanceMinor > 0 && (
                  <div>
                    <span style={{ color: '#6b7280' }}>Saldo financiado: </span>
                    <span style={{ color: '#f87171', fontWeight: 600 }}>{formatBRL(invoiceSummary.financedBalanceMinor)}</span>
                  </div>
                )}
                <div>
                  <span style={{ color: '#6b7280' }}>Pagamentos: </span>
                  <span style={{ color: '#4ade80', fontWeight: 600 }}>−{formatBRL(invoiceSummary.paymentsMinor)}</span>
                </div>
                <div>
                  <span style={{ color: '#6b7280' }}>Novas compras: </span>
                  <span style={{ color: '#e5e7eb', fontWeight: 600 }}>
                    +{formatBRL(invoiceSummary.monthlyExpensesMinor ?? (invoiceSummary.nationalPurchasesMinor + invoiceSummary.internationalPurchasesMinor))}
                  </span>
                </div>
                {invoiceSummary.creditsAndRefundsMinor > 0 && (
                  <div>
                    <span style={{ color: '#6b7280' }}>Créditos e estornos: </span>
                    <span style={{ color: '#4ade80', fontWeight: 600 }}>+{formatBRL(invoiceSummary.creditsAndRefundsMinor)}</span>
                  </div>
                )}
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

          <DebugStatusCard
            debugEnabled={debugEnabled}
            hasDebug={Boolean(parseDebug)}
            isReprocessing={debugReprocessing}
          />

          {parseDebug && debugEnabled && (
            <InvoiceDebugPanel debug={parseDebug} />
          )}

          {invoiceAnalysis?.installments && invoiceAnalysis.installments.length > 0 && (
            <InvoiceInstallmentsPanel
              installments={invoiceAnalysis.installments}
              categoryOptions={categoryOptions}
              categoryIds={installmentCategoryIds}
              onCategoryChange={(key, categoryId) => setInstallmentCategoryIds((current) => ({
                ...current,
                [key]: categoryId,
              }))}
            />
          )}

          {uncategorizedInstallments.length > 0 && (
            <Alert variant="warning" style={{ marginBottom: '1rem' }}>
              <strong>{uncategorizedInstallments.length} parcelamento(s)</strong> sem categoria. Categorize para melhorar os relatórios por categoria.
            </Alert>
          )}

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
            <div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', tableLayout: 'fixed' }}>
                <thead>
                  <tr style={{ color: '#6b7280', borderBottom: '1px solid #2a2f45', background: '#0f1117' }}>
                    <th style={{ padding: '0.5rem', width: 36 }}></th>
                    <th style={{ padding: '0.5rem', width: 104, textAlign: 'left' }}>Data</th>
                    <th style={{ padding: '0.5rem', textAlign: 'left' }}>Descrição</th>
                    <th style={{ padding: '0.5rem', width: 100, textAlign: 'right' }}>Valor</th>
                    <th style={{ padding: '0.5rem', width: 100, textAlign: 'left' }}>Competência</th>
                    <th style={{ padding: '0.5rem', width: 240, textAlign: 'left' }}>Categoria</th>
                    <th style={{ padding: '0.5rem', width: 250, textAlign: 'left' }}>Fatura paga</th>
                  </tr>
                </thead>
                  <tbody>
                    {transactions.map((tx) => (
                    <TransactionPreviewRow
                        key={tx.id}
                        tx={tx}
                        categoryOptions={categoryOptions}
                        invoiceOptions={invoiceOptions}
                        showInvoiceSelector={isCreditCardInvoiceCategoryId(tx.categoryId ?? null, categories)}
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

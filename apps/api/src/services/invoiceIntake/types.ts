export type PdfWord = {
  text: string
  x0: number
  x1: number
  top: number
  bottom: number
}

export type PdfPageCapture = {
  pageNumber: number
  width: number
  height: number
  words: PdfWord[]
}

export type Redaction = {
  type: 'nome_titular' | 'nome_dependente' | 'endereco' | 'outro_pii'
  text: string
  replacement: string
  line_start: number
  line_end: number
}

export type PiiDetectionResult = {
  status: 'found' | 'not_found'
  redactions: Redaction[]
}

export type SanitizationReport = {
  source_lines: number
  local_redactions: number
  pii_redactions: number
  windows_scanned: number
  sanitized_ascii: string
}

export type FinancialExtractionResult = {
  document_type: 'fatura_cartao'
  institution: string
  card_last4: string
  billing_period: string
  due_date: string
  total_amount: number
  transactions: Array<{
    date: string
    description: string
    amount: number
    installment?: string
    category?: string
    country?: string
    originalAmountMinor?: number
    originalCurrencyCode?: string
    exchangeRate?: number
  }>
  installments: Array<{
    description: string
    amount: number
    current?: number
    total?: number
    date?: string
  }>
  fees: Array<{
    description: string
    amount: number
    kind?: string
  }>
  payments: Array<{
    date?: string
    description: string
    amount: number
    source?: string
  }>
  warnings: string[]
}

export type InvoiceWindow = {
  window_index: number
  line_start: number
  line_end: number
  content: string
}

export type InvoicePipelineStage = {
  label: string
  content: string
}

export type InvoicePipelineDebug = {
  strategy: 'ascii'
  sourceBank: string
  stages: InvoicePipelineStage[]
}

export type InvoicePreviewTransaction = {
  id: string
  date: string
  description: string
  amountMinor: number
  installment?: string
  categoryId: string | null
  competencyMonth: string
  include: boolean
  category: string
  country?: string
}

export type InvoicePreviewPayload = {
  bank: string
  summary: {
    cardLast4: string
    product: string
    invoiceMonth: string
    dueDate: string
    dueMonth: string
    closingDate: string
    totalMinor: number
    previousBalanceMinor: number
    financedBalanceMinor?: number
    paymentsMinor: number
    monthlyExpensesMinor: number
    creditsAndRefundsMinor: number
    nationalPurchasesMinor: number
    internationalPurchasesMinor: number
    chargesMinor: number
    openBalanceMinor: number
  }
  transactions: InvoicePreviewTransaction[]
  forecasts: Array<{
    id: string
    competencyMonth: string
    amountMinor: number
    recurrence: 'one-time'
    description: string
  }>
  analysis?: FinancialExtractionResult
  piiDetection?: PiiDetectionResult
  sanitizationReport?: SanitizationReport
}

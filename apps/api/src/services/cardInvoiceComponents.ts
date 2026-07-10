import type { NewCardInvoiceComponent } from '@previa/db'

type SummaryInput = {
  previousBalanceMinor?: number | null
  paymentsMinor?: number | null
  creditsAndRefundsMinor?: number | null
  monthlyExpensesMinor?: number | null
  chargesMinor?: number | null
  financedBalanceMinor?: number | null
  totalMinor?: number | null
}

type ImportAnalysisInput = {
  installments?: Array<{
    description: string
    amount: number
    current?: number
    total?: number
    date?: string
  }>
  fees?: Array<{
    description: string
    amount: number
    kind?: string
  }>
}

type BuildInvoiceComponentRowsInput = {
  userId: number
  cardInvoiceId: number
  summary: SummaryInput
  analysis?: ImportAnalysisInput | null
  source?: string
}

function toMinor(amount: number): bigint {
  if (!Number.isFinite(amount)) return 0n
  return BigInt(Math.round(amount * 100))
}

function normalizeLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function classifyFeeType(description: string, kind?: string | null): 'iof' | 'finance_charge' | 'fee' {
  const text = normalizeLabel(`${kind ?? ''} ${description}`)
  if (/iof/.test(text)) return 'iof'
  if (/juros|encargo|rotativo|financeir|parcelam/.test(text)) return 'finance_charge'
  return 'fee'
}

export function buildInvoiceComponentRows(
  input: BuildInvoiceComponentRowsInput,
): NewCardInvoiceComponent[] {
  const rows: NewCardInvoiceComponent[] = []
  const source = input.source ?? 'pdf_invoice'

  const pushSummary = (
    componentType: string,
    amountMinor: number | null | undefined,
    description: string,
  ) => {
    if (amountMinor === null || amountMinor === undefined) return
    const minor = BigInt(Math.trunc(amountMinor))
    if (minor === 0n) return

    rows.push({
      userId: input.userId,
      cardInvoiceId: input.cardInvoiceId,
      componentScope: 'summary',
      componentType,
      amountMinor: minor,
      currencyCode: 'BRL',
      description,
      source,
    })
  }

  pushSummary('previous_balance', input.summary.previousBalanceMinor, 'Fatura anterior')
  pushSummary('payment_received', input.summary.paymentsMinor ? -Math.abs(input.summary.paymentsMinor) : input.summary.paymentsMinor, 'Pagamento recebido')
  pushSummary('credits_and_refunds', input.summary.creditsAndRefundsMinor, 'Créditos e estornos')
  pushSummary('monthly_expenses', input.summary.monthlyExpensesMinor, 'Despesas do mês')
  pushSummary('charges_total', input.summary.chargesMinor, 'Encargos totais')
  pushSummary('financed_balance', input.summary.financedBalanceMinor, 'Saldo financiado')
  pushSummary('total_invoice', input.summary.totalMinor, 'Total da fatura')

  for (const [index, installment] of (input.analysis?.installments ?? []).entries()) {
    const minor = toMinor(Math.abs(installment.amount))
    if (minor === 0n) continue

    rows.push({
      userId: input.userId,
      cardInvoiceId: input.cardInvoiceId,
      componentScope: 'line_item',
      componentType: 'installment_principal',
      amountMinor: minor,
      currencyCode: 'BRL',
      description: installment.description,
      source,
      sourceDate: installment.date ? new Date(`${installment.date}T12:00:00Z`) : undefined,
      installmentNumber: installment.current ?? null,
      installmentTotal: installment.total ?? null,
      providerPayload: {
        source: 'analysis.installments',
        index,
      },
    })
  }

  for (const [index, fee] of (input.analysis?.fees ?? []).entries()) {
    const minor = toMinor(Math.abs(fee.amount))
    if (minor === 0n) continue
    const componentType = classifyFeeType(fee.description, fee.kind)

    rows.push({
      userId: input.userId,
      cardInvoiceId: input.cardInvoiceId,
      componentScope: 'line_item',
      componentType,
      amountMinor: minor,
      currencyCode: 'BRL',
      description: fee.description,
      source,
      providerPayload: {
        source: 'analysis.fees',
        index,
        kind: fee.kind ?? null,
      },
    })
  }

  return rows
}

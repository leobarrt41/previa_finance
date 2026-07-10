import type React from 'react'
import { formatBRL, type OpenCardInvoiceSummary } from '../services/api'

export type InvoicePaymentOption = {
  id: number
  label: string
}

export function formatInvoicePaymentLabel(invoice: OpenCardInvoiceSummary): string {
  return `${invoice.displayName} · ${invoice.invoiceMonth} · vence ${invoice.dueDate.slice(0, 10)} · ${invoice.status} · ${formatBRL(invoice.openAmountMinor)} em aberto`
}

export function buildInvoicePaymentOptions(
  currentInvoice: InvoicePaymentOption | null | undefined,
  openInvoices: OpenCardInvoiceSummary[],
): InvoicePaymentOption[] {
  const seen = new Set<number>()
  const options: InvoicePaymentOption[] = []

  if (currentInvoice) {
    seen.add(currentInvoice.id)
    options.push(currentInvoice)
  }

  for (const invoice of openInvoices) {
    if (seen.has(invoice.id)) continue
    seen.add(invoice.id)
    options.push({ id: invoice.id, label: formatInvoicePaymentLabel(invoice) })
  }

  return options
}

export function InvoicePaymentSelector({
  value,
  options,
  disabled,
  placeholder = '— selecione a fatura aberta —',
  onChange,
  style,
}: {
  value: number | null
  options: InvoicePaymentOption[]
  disabled?: boolean
  placeholder?: string
  onChange: (invoiceId: number | null) => void
  style?: React.CSSProperties
}) {
  return (
    <select
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      style={{
        background: '#0f1117',
        border: `1px solid ${value ? '#2a2f45' : '#f59e0b'}`,
        borderRadius: 6,
        padding: '4px 8px',
        color: '#e5e7eb',
        fontSize: '0.78rem',
        minWidth: 240,
        fontFamily: 'monospace',
        ...style,
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((invoice) => (
        <option key={invoice.id} value={invoice.id}>
          {invoice.label}
        </option>
      ))}
    </select>
  )
}

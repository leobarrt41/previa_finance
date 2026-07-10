import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { formatBRL } from '../services/api';
export function formatInvoicePaymentLabel(invoice) {
    return `${invoice.displayName} · ${invoice.invoiceMonth} · vence ${invoice.dueDate.slice(0, 10)} · ${invoice.status} · ${formatBRL(invoice.openAmountMinor)} em aberto`;
}
export function buildInvoicePaymentOptions(currentInvoice, openInvoices) {
    const seen = new Set();
    const options = [];
    if (currentInvoice) {
        seen.add(currentInvoice.id);
        options.push(currentInvoice);
    }
    for (const invoice of openInvoices) {
        if (seen.has(invoice.id))
            continue;
        seen.add(invoice.id);
        options.push({ id: invoice.id, label: formatInvoicePaymentLabel(invoice) });
    }
    return options;
}
export function InvoicePaymentSelector({ value, options, disabled, placeholder = '— selecione a fatura aberta —', onChange, style, }) {
    return (_jsxs("select", { value: value ?? '', disabled: disabled, onChange: (e) => onChange(e.target.value ? Number(e.target.value) : null), style: {
            background: '#0f1117',
            border: `1px solid ${value ? '#2a2f45' : '#f59e0b'}`,
            borderRadius: 6,
            padding: '4px 8px',
            color: '#e5e7eb',
            fontSize: '0.78rem',
            minWidth: 240,
            fontFamily: 'monospace',
            ...style,
        }, children: [_jsx("option", { value: "", children: placeholder }), options.map((invoice) => (_jsx("option", { value: invoice.id, children: invoice.label }, invoice.id)))] }));
}

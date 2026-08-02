const mockExtractAsciiStructuralTextFromPdf = jest.fn()
const mockSanitizeInvoiceAsciiDeterministically = jest.fn()
const mockDetectPiiRedactionsWithAI = jest.fn()
const mockApplyPiiRedactionsToAscii = jest.fn()
const mockSanitizeSensitiveText = jest.fn()
const mockExtractFinancialInvoiceWithAI = jest.fn()

jest.mock('../pdfAsciiExtractor.js', () => ({
  extractAsciiStructuralTextFromPdf: (...args: any[]) => mockExtractAsciiStructuralTextFromPdf(...args),
}))

jest.mock('../piiSanitizer.js', () => ({
  sanitizeInvoiceAsciiDeterministically: (...args: any[]) => mockSanitizeInvoiceAsciiDeterministically(...args),
  applyPiiRedactionsToAscii: (...args: any[]) => mockApplyPiiRedactionsToAscii(...args),
}))

jest.mock('../piiDetector.js', () => ({
  detectPiiRedactionsWithAI: (...args: any[]) => mockDetectPiiRedactionsWithAI(...args),
}))

jest.mock('../../textSanitizer.js', () => ({
  sanitizeSensitiveText: (...args: any[]) => mockSanitizeSensitiveText(...args),
}))

jest.mock('../financialExtractor.js', () => ({
  extractFinancialInvoiceWithAI: (...args: any[]) => mockExtractFinancialInvoiceWithAI(...args),
}))

import { runInvoiceAsciiIngestionPipeline } from '../pipeline.js'

describe('runInvoiceAsciiIngestionPipeline', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    const installmentAscii = [
      '03 MAI Oticachillibeans - Parcela 5/10 R$ 77,99',
      '03 MAI Solumedi Jacarei - Parcela 2/2 R$ 82,50',
    ].join('\n')

    mockExtractAsciiStructuralTextFromPdf.mockResolvedValue({
      asciiText: installmentAscii,
    })

    mockSanitizeInvoiceAsciiDeterministically.mockReturnValue({
      source_lines: 2,
      local_redactions: 0,
      sanitized_ascii: installmentAscii,
    })

    mockDetectPiiRedactionsWithAI.mockResolvedValue({
      windows: [],
      result: { redactions: [] },
    })

    mockApplyPiiRedactionsToAscii.mockReturnValue({
      appliedCount: 0,
      sanitizedAscii: installmentAscii,
    })

    mockSanitizeSensitiveText.mockReturnValue({
      source_lines: 2,
      local_redactions: 0,
      sanitizedText: installmentAscii,
    })

    mockExtractFinancialInvoiceWithAI.mockResolvedValue({
      document_type: 'fatura_cartao',
      institution: 'Itau',
      card_last4: '9970',
      billing_period: '2026-06',
      due_date: '2026-07-06',
      total_amount: 2268.85,
      transactions: [
        {
          date: '2026-06-23',
          description: 'POSTO QUATRO TREVOS',
          amount: 50,
          category: 'Transporte',
        },
        {
          date: '2026-07-01',
          description: 'COMPRA JULHO',
          amount: 75,
          category: 'Outros',
        },
      ],
      installments: [
        {
          description: 'Oticachillibeans - Parcela',
          amount: 0,
          current: 5,
          total: 10,
          date: undefined,
        },
      ],
      fees: [],
      payments: [],
      warnings: [],
    })
  })

  it('usa o mês do vencimento como mês da fatura e preserva a competência das transações', async () => {
    const result = await runInvoiceAsciiIngestionPipeline(Buffer.from('pdf'), {
      filename: 'fatura-itau-julho.pdf',
    })

    expect(result.payload.summary.invoiceMonth).toBe('2026-07')
    expect(result.payload.summary.dueMonth).toBe('2026-07')
    expect(result.payload.forecasts).toHaveLength(1)
    expect(result.payload.forecasts[0].competencyMonth).toBe('2026-07')

    expect(result.payload.transactions).toHaveLength(2)
    expect(result.payload.transactions[0].competencyMonth).toBe('2026-06')
    expect(result.payload.transactions[1].competencyMonth).toBe('2026-07')

    expect(result.payload.analysis?.installments).toHaveLength(1)
    expect(result.payload.analysis?.installments[0]).toMatchObject({
      description: 'Oticachillibeans - Parcela',
      amount: 0,
      current: 5,
      total: 10,
    })
  })

  it('remove total da fatura quando a IA o coloca em transactions', async () => {
    mockExtractFinancialInvoiceWithAI.mockResolvedValue({
      document_type: 'fatura_cartao', institution: 'Itau', card_last4: '9970',
      billing_period: '2026-07', due_date: '2026-08-06', total_amount: 1879.67,
      transactions: [
        { date: '2026-08-06', description: 'Vencimento: 06/08/2026 = Total desta fatura', amount: 1879.67 },
        { date: '2026-07-15', description: 'SUPERMERCADO EXTRA', amount: 150.00 },
      ],
      installments: [], fees: [], payments: [], warnings: [],
    })

    const result = await runInvoiceAsciiIngestionPipeline(Buffer.from('pdf'), {
      filename: 'fatura-itau-agosto.pdf',
    })

    // O total da fatura não deve aparecer como transação
    expect(result.payload.transactions).toHaveLength(1)
    expect(result.payload.transactions[0].description).toBe('SUPERMERCADO EXTRA')
    // O warning deve ser adicionado
    expect(result.payload.analysis?.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('resumo(s) de pagamento/fatura removido(s) das transações')])
    )
  })

  it('remove pagamento efetuado em DD/MM/AAAA quando a IA o coloca em transactions', async () => {
    mockExtractFinancialInvoiceWithAI.mockResolvedValue({
      document_type: 'fatura_cartao', institution: 'Itau', card_last4: '9970',
      billing_period: '2026-07', due_date: '2026-08-06', total_amount: 500.00,
      transactions: [
        { date: '2026-07-07', description: 'Pagamento efetuado em 07/07/2026', amount: 2268.85 },
        { date: '2026-07-20', description: 'NETFLIX', amount: 55.90 },
      ],
      installments: [], fees: [], payments: [], warnings: [],
    })

    const result = await runInvoiceAsciiIngestionPipeline(Buffer.from('pdf'), {
      filename: 'fatura-itau-agosto.pdf',
    })

    // O pagamento efetuado não deve aparecer como transação
    expect(result.payload.transactions).toHaveLength(1)
    expect(result.payload.transactions[0].description).toBe('NETFLIX')
  })

  it('não interpreta datas completas de pagamentos e totais como parcelas', async () => {
    const ascii = [
      '[REDACTED] Pagamento efetuado em 07/07/2026 R$ 2.268,85',
      'Vencimento: 06/08/2026 = Total desta fatura R$ 1.879,67',
      'Contratação em 08/12/2025 - Parcela 7/12 R$ 3,77',
    ].join('\n')

    mockExtractAsciiStructuralTextFromPdf.mockResolvedValue({ asciiText: ascii })
    mockSanitizeInvoiceAsciiDeterministically.mockReturnValue({ source_lines: 3, local_redactions: 0, sanitized_ascii: ascii })
    mockApplyPiiRedactionsToAscii.mockReturnValue({ appliedCount: 0, sanitizedAscii: ascii })
    mockSanitizeSensitiveText.mockReturnValue({ source_lines: 3, local_redactions: 0, sanitizedText: ascii })
    mockExtractFinancialInvoiceWithAI.mockResolvedValue({
      document_type: 'fatura_cartao', institution: 'Itau', card_last4: '9970',
      billing_period: '2026-07', due_date: '2026-08-06', total_amount: 1879.67,
      transactions: [],
      installments: [
        { description: '[REDACTED] Pagamento efetuado em 07/07/2026', amount: 2268.85, current: 7, total: 7 },
        { description: 'Vencimento: 06/08/2026 = Total desta fatura', amount: 1879.67, current: 6, total: 8 },
        { description: 'FINANCIAM FAT', amount: 3.77, current: 7, total: 12 },
      ],
      fees: [], payments: [], warnings: [],
    })

    const result = await runInvoiceAsciiIngestionPipeline(Buffer.from('pdf'), {
      filename: 'fatura-itau-agosto.pdf',
    })

    expect(result.payload.analysis?.installments).toEqual([
      expect.objectContaining({
        description: 'FINANCIAM FAT',
        amount: 3.77,
        current: 7,
        total: 12,
      }),
    ])
  })
})

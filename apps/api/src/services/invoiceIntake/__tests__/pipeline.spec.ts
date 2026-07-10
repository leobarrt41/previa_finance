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
})

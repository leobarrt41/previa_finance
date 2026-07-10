import { z } from 'zod'
import { callStructuredJsonAI } from './aiClient.js'
import { applyPiiRedactionsToAscii, buildInvoiceAsciiWindows } from './piiSanitizer.js'
import type { InvoiceWindow, PiiDetectionResult, Redaction } from './types.js'

const piiResponseSchema = z.object({
  status: z.enum(['found', 'not_found']),
  redactions: z.array(
    z.object({
      type: z.enum(['nome_titular', 'nome_dependente', 'endereco', 'outro_pii']),
      text: z.string().min(1),
      replacement: z.string().min(1),
      line_start: z.number().int().positive(),
      line_end: z.number().int().positive(),
    })
  ).default([]),
})

function normalizeForKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function dedupeRedactions(redactions: Redaction[]): Redaction[] {
  const seen = new Set<string>()
  const output: Redaction[] = []
  for (const redaction of redactions) {
    const key = [
      redaction.type,
      redaction.line_start,
      redaction.line_end,
      normalizeForKey(redaction.text),
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    output.push(redaction)
  }
  return output
}

export async function detectPiiRedactionsWithAI(
  sanitizedAscii: string,
  meta: { filename: string },
): Promise<{ result: PiiDetectionResult; windows: InvoiceWindow[] }> {
  let currentAscii = sanitizedAscii
  const detected: Redaction[] = []
  const windows: InvoiceWindow[] = []

  for (let windowIndex = 0; ; windowIndex += 1) {
    const currentWindows = buildInvoiceAsciiWindows(currentAscii, 20, 0)
    const window = currentWindows[windowIndex]
    if (!window) break
    windows.push(window)

    const raw = await callStructuredJsonAI(
      [
        'Voce recebe um trecho de ASCII de fatura já pré-sanitizado.',
        'Seu trabalho é APENAS identificar nomes de pessoas e endereços postais que ainda estejam visíveis.',
        'Procure nome e endereço SOMENTE em áreas cadastrais: cabeçalho, bloco Titular, bloco Nome do Pagador, bloco Endereço / Cidade / UF / CEP e boleto / recibo.',
        'NÃO oculte cidades, estados ou localidades dentro de lançamentos, categorias, estabelecimentos ou descrições de compra.',
        'NÃO interprete a fatura, NÃO extraia transações, NÃO categorize despesas e NÃO mencione outros dados.',
        'Responda somente JSON no formato {"status":"found|not_found","redactions":[{"type":"nome_titular|nome_dependente|endereco|outro_pii","text":"...","replacement":"...","line_start":1,"line_end":1}]}.',
        'Use line_start e line_end com os números de linha exibidos no bloco.',
        'Se nada sensível aparecer, responda {"status":"not_found","redactions":[]}.',
      ].join(' '),
      {
        filename: meta.filename,
        window,
      },
      12000,
    )

    const parsed = piiResponseSchema.safeParse(raw)
    if (!parsed.success) continue

    const redactions = parsed.data.redactions
    if (redactions.length === 0) continue

    detected.push(...redactions)
    currentAscii = applyPiiRedactionsToAscii(currentAscii, redactions).sanitizedAscii
  }

  const redactions = dedupeRedactions(detected)
  return {
    result: {
      status: redactions.length > 0 ? 'found' : 'not_found',
      redactions,
    },
    windows,
  }
}

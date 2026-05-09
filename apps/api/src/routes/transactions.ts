/**
 * routes/transactions.ts - Transaction CRUD endpoints
 */

import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import { and, desc, eq, gt, gte, inArray, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  accounts,
  cardInvoicePayments,
  cardInvoices,
  cardTransactions,
  categories,
  DATA_STATE_VALUES,
  FINANCIAL_CHANNEL_VALUES,
  MOVEMENT_TYPE_VALUES,
  SOURCE_VALUES,
  transactions,
  receiptDocuments,
} from '@previa/db'
import { buildFingerprintFromRaw, normalizeDescription } from '@previa/core'
import { getDatabase } from '../config/database.js'
import { requireClerkAuth } from '../middlewares/auth.js'
import { createError } from '../middlewares/errorHandler.js'
import { resolveOwnerId } from '../services/ownerStore.js'
import { syncCardInvoiceSemanticFields } from '../services/cardInvoiceSemantics.js'

const router: Router = Router()

const statementUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const lower = file.originalname.toLowerCase()
    if (lower.endsWith('.ofx') || lower.endsWith('.csv')) {
      cb(null, true)
      return
    }
    cb(new Error('Only OFX or CSV files are accepted'))
  },
})

const timestampSchema = z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))

const createTransactionSchema = z.object({
  accountId: z.number().int().positive().optional(),
  amountMinor: z.union([z.number(), z.bigint()]),
  occurredAt: timestampSchema.optional(),
  competencyMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  description: z.string().trim().min(1).max(4000),
  source: z.enum(SOURCE_VALUES).default('manual'),
  dataState: z.enum(DATA_STATE_VALUES).default('consolidated'),
  movementType: z.enum(MOVEMENT_TYPE_VALUES),
  movementSubtype: z.string().trim().max(50).optional(),
  financialChannel: z.enum(FINANCIAL_CHANNEL_VALUES).default('bank_account'),
  categoryId: z.string().trim().min(1).max(128).optional(),
  balanceAfterMinor: z.union([z.number(), z.bigint()]).optional(),
  isRecurring: z.boolean().optional(),
  recurringRuleId: z.number().int().positive().optional(),
  reconciledGroupId: z.string().trim().max(255).optional(),
})

const listQuerySchema = z.object({
  startMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  endMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  accountId: z.coerce.number().int().positive().optional(),
  categoryId: z.string().trim().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

const updateTransactionSchema = createTransactionSchema.partial().extend({
  amountMinor: z.union([z.number(), z.bigint()]).optional(),
  description: z.string().trim().min(1).max(4000).optional(),
})

const statementRowSchema = z.object({
  date: z.string().min(1),
  description: z.string().trim().min(1).max(4000),
  memo: z.string().trim().max(4000).nullable().optional(),
  amountMinor: z.number().int(),
  competencyMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  categoryId: z.string().trim().min(1).max(128).nullable().optional(),
  providerCategory: z.string().trim().max(128).nullable().optional(),
  providerCategoryRaw: z.string().trim().max(255).nullable().optional(),
  categoryAssignedBy: z.enum(['provider', 'history', 'ai', 'user', 'legacy']).nullable().optional(),
  movementType: z.enum(MOVEMENT_TYPE_VALUES).optional(),
  movementSubtype: z.string().trim().max(50).nullable().optional(),
  providerTransactionId: z.string().trim().max(255).nullable().optional(),
  include: z.boolean().optional(),
})

const statementImportSchema = z.object({
  accountId: z.number().int().positive().optional(),
  sourceAccount: z
    .object({
      institutionName: z.string().trim().max(200).nullable().optional(),
      providerAccountId: z.string().trim().max(255).nullable().optional(),
      accountLast4: z.string().trim().max(4).nullable().optional(),
    })
    .optional(),
  transactions: z.array(statementRowSchema).max(3000),
})

const statementClassifySchema = z.object({
  transactions: z.array(
    z.object({
      id: z.string(),
      description: z.string().trim().min(1).max(4000),
      amountMinor: z.number().int(),
      movementType: z.enum(MOVEMENT_TYPE_VALUES),
      categoryId: z.string().trim().min(1).max(128).nullable().optional(),
    }),
  ).max(1000),
  categories: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      slug: z.string().optional(),
      type: z.string(),
      parentId: z.string().nullable().optional(),
    }),
  ).max(500),
})

type AiAssignment = {
  transactionId: string
  categoryId: string
  subcategoryId?: string | null
}

function parseAiAssignments(raw: string): Array<AiAssignment> {
  try {
    const parsed = JSON.parse(raw) as {
      assignments?: Array<{ transactionId?: string; categoryId?: string; subcategoryId?: string | null }>
    }
    if (!parsed.assignments || !Array.isArray(parsed.assignments)) return []
    return parsed.assignments
      .filter((item) => Boolean(item?.transactionId && item?.categoryId))
      .map((item) => ({
        transactionId: item.transactionId as string,
        categoryId: item.categoryId as string,
        subcategoryId: item.subcategoryId ?? null,
      }))
  } catch {
    return []
  }
}

async function classifyTransactionsWithAI(
  txs: Array<{ id: string; description: string; amountMinor: number }>,
  availableCategories: Array<{ id: string; name: string; slug?: string; type: string; parentId?: string | null }>,
  type: 'expense' | 'income',
): Promise<Record<string, { categoryId: string; subcategoryId: string | null }>> {
  if (!txs.length || !availableCategories.length) return {}

  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || ''
  const model = process.env.AI_MODEL || process.env.LLM_MODEL_CLASSIFIER || 'gpt-4o-mini'
  const baseUrl = (process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')
  if (!apiKey) return {}

  const typedCategories = availableCategories.filter((c) => c.type === type)
  const byId = new Map(typedCategories.map((c) => [c.id, c]))
  const parentCategories = typedCategories.filter((c) => !c.parentId)
  const subcategories = typedCategories.filter((c) => Boolean(c.parentId))
  if (parentCategories.length === 0) return {}

  const categoryCatalog = parentCategories.map((c) => ({ id: c.id, name: c.name, slug: c.slug ?? '' }))
  const subcategoryCatalog = subcategories.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug ?? '',
    parentId: c.parentId as string,
    parentName: byId.get(c.parentId as string)?.name ?? '',
  }))

  const parentIds = new Set(parentCategories.map((c) => c.id))
  const subById = new Map(subcategories.map((c) => [c.id, c]))
  const suggestions: Record<string, { categoryId: string; subcategoryId: string | null }> = {}

  const chunkSize = 12
  for (let i = 0; i < txs.length; i += chunkSize) {
    const chunk = txs.slice(i, i + chunkSize)
    try {
      const useWebHints = process.env.STATEMENT_WEB_HINTS !== 'false'
      const withHints = await Promise.all(
        chunk.map(async (tx) => ({
          ...tx,
          webHint: useWebHints ? await fetchWebMerchantHint(tx.description) : null,
        })),
      )

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                `Voce classifica transacoes bancarias brasileiras do tipo ${type === 'expense' ? 'despesa' : 'receita'} em categoria e subcategoria. Quando houver webHint, use isso como contexto adicional. Responda SOMENTE JSON no formato {"assignments":[{"transactionId":"...","categoryId":"...","subcategoryId":"...|null"}]}. categoryId deve ser uma categoria pai valida; subcategoryId deve pertencer a essa categoria pai (ou null quando nao houver).`,
            },
            {
              role: 'user',
              content: JSON.stringify({
                transactions: withHints,
                categories: categoryCatalog,
                subcategories: subcategoryCatalog,
              }),
            },
          ],
        }),
        signal: AbortSignal.timeout(15000),
      })

      if (!response.ok) continue

      const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
      const content = json.choices?.[0]?.message?.content ?? ''
      const assignments = parseAiAssignments(content)

      for (const item of assignments) {
        let categoryId = item.categoryId
        let subcategoryId: string | null = item.subcategoryId ?? null

        if (!parentIds.has(categoryId) && subById.has(categoryId)) {
          const leaf = subById.get(categoryId)!
          categoryId = leaf.parentId as string
          subcategoryId = leaf.id
        }

        if (!parentIds.has(categoryId)) continue
        if (subcategoryId) {
          const sub = subById.get(subcategoryId)
          if (!sub || sub.parentId !== categoryId) continue
        }

        suggestions[item.transactionId] = { categoryId, subcategoryId }
      }
    } catch {
      continue
    }
  }

  return suggestions
}

function toMinor(value: number | bigint) {
  return typeof value === 'bigint' ? value : BigInt(value)
}

function toDateInput(value?: string) {
  return value ?? new Date().toISOString()
}

function toCompetencyMonth(dateInput: string) {
  return dateInput.slice(0, 7)
}

function parseCurrencyToMinor(raw: string): number {
  const cleaned = raw
    .trim()
    .replace(/R\$\s?/g, '')
    .replace(/\s+/g, '')

  if (!cleaned) return 0

  let normalized = cleaned
  if (normalized.includes(',') && normalized.includes('.')) {
    normalized = normalized.replace(/\./g, '').replace(',', '.')
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.')
  }

  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return 0
  return Math.round(parsed * 100)
}

function parseLooseDateToYmd(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null

  const isValidYear = (yearText: string) => {
    const year = Number(yearText)
    return Number.isFinite(year) && year >= 2000 && year <= 2100
  }

  const ymd = value.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/)
  if (ymd && isValidYear(ymd[1])) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`

  const dmy = value.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/)
  if (dmy && isValidYear(dmy[3])) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`

  const compact = value.match(/^(\d{4})(\d{2})(\d{2})/)
  if (compact && isValidYear(compact[1])) return `${compact[1]}-${compact[2]}-${compact[3]}`

  return null
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cell += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (ch === delimiter && !inQuotes) {
      cells.push(cell.trim())
      cell = ''
      continue
    }

    cell += ch
  }

  cells.push(cell.trim())
  return cells
}

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function headerIndex(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const idx = headers.indexOf(alias)
    if (idx >= 0) return idx
  }
  return -1
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function canonicalDescriptionForLearning(rawOrNormalized: string): string {
  const normalized = normalizeDescription(rawOrNormalized)
  return normalized.replace(/^(\d{2}\s+){2,4}/, '').trim()
}

function stripDatePrefixFromDescription(value: string): string {
  return value
    .replace(/^\d{2}\/\d{2}\s+\d{2}:\d{2}\s+/i, '')
    .replace(/^\d{2}\/\d{2}\s+/i, '')
    .trim()
}

async function fetchWebMerchantHint(description: string): Promise<string | null> {
  const query = stripDatePrefixFromDescription(description)
  if (!query) return null

  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(2500),
    })
    if (!response.ok) return null
    const body = await response.json() as {
      AbstractText?: string
      AbstractURL?: string
      Heading?: string
    }

    const text = (body.AbstractText || '').trim()
    const heading = (body.Heading || '').trim()
    const source = (body.AbstractURL || '').trim()
    if (!text && !heading) return null

    return [heading, text, source].filter(Boolean).join(' | ').slice(0, 400)
  } catch {
    return null
  }
}

function findExpenseCategoryIdByName(
  availableCategories: Array<{ id: string; name: string; type: string }>,
  candidates: string[],
): string | null {
  for (const candidate of candidates) {
    const found = availableCategories.find(
      (c) => c.type === 'expense' && normalizeText(c.name) === normalizeText(candidate),
    )
    if (found) return found.id
  }
  return null
}

function suggestCategoryIdByMerchantRule(
  description: string,
  movementType: string,
  availableCategories: Array<{ id: string; name: string; type: string }>,
): string | null {
  if (movementType !== 'expense') return null
  const text = normalizeText(description)

  if (text.includes('master da web') || text.includes('hosting') || text.includes('vps') || text.includes('cloud')) {
    return findExpenseCategoryIdByName(availableCategories, ['cloud storage', 'produtividade', 'assinaturas', 'internet'])
  }
  if (text.includes('tokio marine')) {
    return findExpenseCategoryIdByName(availableCategories, ['seguro', 'plano de saúde'])
  }
  if (text.includes('carrefour')) {
    return findExpenseCategoryIdByName(availableCategories, ['supermercado'])
  }
  if (text.includes('claro')) {
    return findExpenseCategoryIdByName(availableCategories, ['telefone', 'internet'])
  }
  if (text.includes('sem parar') || text.includes('pedagio') || text.includes('pedágio')) {
    return findExpenseCategoryIdByName(availableCategories, ['pedágio', 'pedagio'])
  }

  return null
}

function isCashNeutralSweep(description: string): boolean {
  const normalized = normalizeText(description)
  return normalized.includes('rende facil')
    || normalized.includes('rendefacil')
    || normalized.includes('aplicacao')
    || normalized.includes('resgate')
    || normalized.includes('investimento')
    || normalized.includes('tesouro')
    || normalized.includes('cdb')
    || normalized.includes('fundo')
}

function isLikelyCardPayment(description: string): boolean {
  const normalized = normalizeText(description)
  if (CARD_PAYMENT_PATTERN.test(description)) return true

  const hasTransferMarker =
    normalized.includes('pix')
    || normalized.includes('ted')
    || normalized.includes('doc')
    || normalized.includes('transferencia')
    || normalized.includes('transfer')
    || normalized.includes('transf')

  if (!hasTransferMarker) return false

  return normalized.includes('cartao')
    || normalized.includes('fatura')
    || normalized.includes('pagto')
    || normalized.includes('pgto')
    || normalized.includes('pagamento')
    || normalized.includes('credito')
}

function isNonTransactionalDescription(description: string): boolean {
  const normalized = normalizeText(description)
  return normalized.includes('saldo do dia')
    || normalized.includes('saldo anterior')
    || normalized.includes('saldo final')
    || normalized.includes('saldo disponivel')
    || normalized.includes('resumo do periodo')
}

function parseCsvStatement(buffer: Buffer) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length < 2) return [] as Array<Record<string, unknown>>

  const delimiter = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0)
    ? ';'
    : ','
  const rawHeaders = parseCsvLine(lines[0], delimiter).map(normalizeHeader)

  const dateIdx = headerIndex(rawHeaders, ['data', 'date', 'dt'])
  const descIdx = headerIndex(rawHeaders, ['descricao', 'historico', 'memo', 'description', 'narrativa'])
  const amountIdx = headerIndex(rawHeaders, ['valor', 'amount', 'valorfinal', 'vlr'])
  const debitIdx = headerIndex(rawHeaders, ['debito', 'debit', 'valor debito', 'valordebito'])
  const creditIdx = headerIndex(rawHeaders, ['credito', 'credit', 'valor credito', 'valorcredito'])
  const fitIdIdx = headerIndex(rawHeaders, ['fitid', 'id', 'idtransacao', 'transacaoid'])

  if (dateIdx < 0 || descIdx < 0 || (amountIdx < 0 && debitIdx < 0 && creditIdx < 0)) {
    throw createError('CSV sem colunas mínimas. Esperado: data + descrição + valor (ou débito/crédito).', 400)
  }

  const parsed: Array<Record<string, unknown>> = []

  for (let lineNo = 1; lineNo < lines.length; lineNo += 1) {
    const cells = parseCsvLine(lines[lineNo], delimiter)
    const dateYmd = parseLooseDateToYmd(cells[dateIdx] ?? '')
    const description = (cells[descIdx] ?? '').trim()
    if (!dateYmd || !description) continue
    if (isNonTransactionalDescription(description)) continue

    let amountMinor = 0
    if (amountIdx >= 0) {
      amountMinor = parseCurrencyToMinor(cells[amountIdx] ?? '')
    } else {
      const debit = debitIdx >= 0 ? Math.abs(parseCurrencyToMinor(cells[debitIdx] ?? '')) : 0
      const credit = creditIdx >= 0 ? Math.abs(parseCurrencyToMinor(cells[creditIdx] ?? '')) : 0
      amountMinor = credit - debit
    }

    if (amountMinor === 0) continue

    const movementType = amountMinor < 0 && isLikelyCardPayment(description)
      ? 'liability_payment'
      : isCashNeutralSweep(description)
        ? 'transfer'
        : (amountMinor < 0 ? 'expense' : 'income')

    parsed.push({
      id: `row-${parsed.length + 1}`,
      date: dateYmd,
      description,
      amountMinor,
      competencyMonth: dateYmd.slice(0, 7),
      movementType,
      movementSubtype: null,
      providerTransactionId: fitIdIdx >= 0 ? (cells[fitIdIdx] || null) : null,
      include: true,
    })
  }

  return parsed
}

function parseOfxTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}>([^<\r\n]+)`, 'i'))
  return match?.[1]?.trim() ?? null
}

function parseOfxStatement(buffer: Buffer) {
  const text = buffer.toString('latin1')
  const txBlocks = [...text.matchAll(/<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi)]
  const parsed: Array<Record<string, unknown>> = []

  const providerAccountId = parseOfxTag(text, 'ACCTID')
  const org = parseOfxTag(text, 'ORG')
  const fid = parseOfxTag(text, 'FID')
  const institutionName = org ?? fid ?? null
  const accountLast4 = providerAccountId
    ? providerAccountId.replace(/\D/g, '').slice(-4) || null
    : null

  for (const [_, block] of txBlocks) {
    const dateRaw = parseOfxTag(block, 'DTPOSTED') ?? parseOfxTag(block, 'DTUSER')
    const dateYmd = dateRaw ? parseLooseDateToYmd(dateRaw) : null
    const amountRaw = parseOfxTag(block, 'TRNAMT')
    const fitid = parseOfxTag(block, 'FITID')
    const memo = parseOfxTag(block, 'MEMO')
    const name = parseOfxTag(block, 'NAME')
    const trnType = parseOfxTag(block, 'TRNTYPE')

    if (!dateYmd || !amountRaw) continue

    const description = memo || name || fitid || `Lançamento ${parsed.length + 1}`
    if (isNonTransactionalDescription(description)) continue

    const amountMinor = parseCurrencyToMinor(amountRaw)
    if (amountMinor === 0) continue

    const movementType = amountMinor < 0 && isLikelyCardPayment(description)
      ? 'liability_payment'
      : isCashNeutralSweep(description)
        ? 'transfer'
        : (amountMinor < 0 ? 'expense' : 'income')

    parsed.push({
      id: `row-${parsed.length + 1}`,
      date: dateYmd,
      description,
      memo: memo || null,
      amountMinor,
      competencyMonth: dateYmd.slice(0, 7),
      movementType,
      movementSubtype: trnType ? trnType.toLowerCase() : null,
      providerTransactionId: fitid,
      include: true,
    })
  }

  return {
    transactions: parsed,
    sourceAccount: {
      institutionName,
      providerAccountId,
      accountLast4,
    },
  }
}

function buildDedupeKey(args: {
  competencyMonth: string
  amountMinor: bigint
  normalizedDescription: string
  occurredYmd: string
}) {
  return `${args.competencyMonth}|${args.amountMinor.toString()}|${args.normalizedDescription}|${args.occurredYmd}`
}

function inferInstitutionFromName(fileName: string): string | null {
  const lower = fileName.toLowerCase()
  if (lower.includes('itau') || lower.includes('itaú')) return 'Itaú'
  if (lower.includes('bradesco')) return 'Bradesco'
  if (lower.includes('santander')) return 'Santander'
  if (lower.includes('nubank') || lower.includes('nu ')) return 'Nubank'
  if (lower.includes('banco do brasil') || lower.includes('bb')) return 'Banco do Brasil'
  if (lower.includes('caixa')) return 'Caixa'
  if (lower.includes('picpay')) return 'PicPay'
  return null
}

type StatementSourceAccount = {
  institutionName: string | null
  providerAccountId: string | null
  accountLast4: string | null
}

async function detectStatementAccount(ownerId: number, sourceAccount: StatementSourceAccount) {
  const db = getDatabase()

  if (sourceAccount.providerAccountId) {
    const [byProvider] = await db
      .select({ id: accounts.id, displayName: accounts.displayName })
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, ownerId),
          eq(accounts.financialChannel, 'bank_account'),
          eq(accounts.providerAccountId, sourceAccount.providerAccountId),
        ),
      )
      .limit(1)
    if (byProvider) return byProvider
  }

  if (sourceAccount.institutionName) {
    const [byInstitution] = await db
      .select({
        id: accounts.id,
        displayName: accounts.displayName,
        providerAccountId: accounts.providerAccountId,
      })
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, ownerId),
          eq(accounts.financialChannel, 'bank_account'),
          eq(accounts.institutionName, sourceAccount.institutionName),
        ),
      )
      .orderBy(desc(accounts.id))
      .limit(1)

    if (byInstitution) {
      if (!sourceAccount.providerAccountId || byInstitution.providerAccountId === sourceAccount.providerAccountId) {
        return { id: byInstitution.id, displayName: byInstitution.displayName }
      }
    }
  }

  return null
}

async function resolveStatementAccountId(
  ownerId: number,
  providedAccountId: number | undefined,
  sourceAccount: StatementSourceAccount,
) {
  const db = getDatabase()

  if (providedAccountId) {
    const [account] = await db
      .select({ id: accounts.id, userId: accounts.userId, financialChannel: accounts.financialChannel })
      .from(accounts)
      .where(eq(accounts.id, providedAccountId))
      .limit(1)

    if (!account || account.userId !== ownerId) {
      throw createError('Conta não encontrada', 404)
    }
    if (account.financialChannel !== 'bank_account') {
      throw createError('Importação de extrato permite apenas conta bancária.', 400)
    }

    return account.id
  }

  const detected = await detectStatementAccount(ownerId, sourceAccount)
  if (detected) return detected.id

  if (sourceAccount.providerAccountId || sourceAccount.institutionName || sourceAccount.accountLast4) {
    const suffix = sourceAccount.accountLast4
      ?? (sourceAccount.providerAccountId ? sourceAccount.providerAccountId.slice(-4) : null)
    const displayName = sourceAccount.institutionName
      ? `${sourceAccount.institutionName}${suffix ? ` ••••${suffix}` : ''}`
      : `Conta importada${suffix ? ` ••••${suffix}` : ''}`

    await db.insert(accounts).values({
      userId: ownerId,
      type: 'CHECKING',
      financialChannel: 'bank_account',
      displayName,
      institutionName: sourceAccount.institutionName,
      providerAccountId: sourceAccount.providerAccountId,
      source: 'manual',
      currencyCode: 'BRL',
      isActive: true,
    })

    const [created] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(
        and(
          eq(accounts.userId, ownerId),
          eq(accounts.financialChannel, 'bank_account'),
          eq(accounts.displayName, displayName),
        ),
      )
      .orderBy(desc(accounts.id))
      .limit(1)

    if (created) return created.id
  }

  return resolveDefaultAccountId(ownerId)
}

async function resolveDefaultAccountId(ownerId: number) {
  const db = getDatabase()
  const [existing] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, ownerId), eq(accounts.financialChannel, 'bank_account')))
    .orderBy(desc(accounts.id))
    .limit(1)

  if (existing) {
    return existing.id
  }

  await db.insert(accounts).values({
    userId: ownerId,
    type: 'CHECKING',
    financialChannel: 'bank_account',
    displayName: 'Conta principal',
    source: 'manual',
    currencyCode: 'BRL',
    isActive: true,
  })

  const [created] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, ownerId), eq(accounts.financialChannel, 'bank_account')))
    .orderBy(desc(accounts.id))
    .limit(1)

  if (!created) {
    throw createError('Failed to create default account', 500)
  }

  return created.id
}

router.use(requireClerkAuth)

router.get('/', async (req: Request, res: Response) => {
  const owner = await resolveOwnerId(req.authUser!.clerkUserId)
  const query = listQuerySchema.parse(req.query)
  const db = getDatabase()

  const filters = [eq(transactions.userId, owner.id)]
  if (query.accountId) {
    filters.push(eq(transactions.accountId, query.accountId))
  }
  if (query.categoryId) {
    filters.push(eq(transactions.categoryId, query.categoryId))
  }
  if (query.startMonth) {
    filters.push(gte(transactions.competencyMonth, query.startMonth))
  }
  if (query.endMonth) {
    filters.push(lte(transactions.competencyMonth, query.endMonth))
  }

  const rows = await db
    .select()
    .from(transactions)
    .where(and(...filters))
    .orderBy(desc(transactions.occurredAt))
    .limit(query.limit ?? 100)

  res.json({
    items: rows.map((row) => ({
      ...row,
      amountMinor: row.amountMinor.toString(),
      balanceAfterMinor: row.balanceAfterMinor?.toString() ?? null,
      categoryId: row.categoryId ?? null,
    })),
  })
})

router.post('/statement/parse', statementUpload.single('file'), async (req: Request, res: Response) => {
  const owner = await resolveOwnerId(req.authUser!.clerkUserId)

  if (!req.file) {
    throw createError('Nenhum arquivo enviado. Use multipart/form-data com field "file".', 400)
  }

  const lowerName = req.file.originalname.toLowerCase()
  const parsedOutput = lowerName.endsWith('.ofx')
    ? parseOfxStatement(req.file.buffer)
    : {
        transactions: parseCsvStatement(req.file.buffer),
        sourceAccount: {
          institutionName: inferInstitutionFromName(req.file.originalname),
          providerAccountId: null,
          accountLast4: null,
        },
      }

  if (parsedOutput.transactions.length === 0) {
    throw createError('Nenhuma transação encontrada no arquivo.', 400)
  }

  const detectedAccount = await detectStatementAccount(owner.id, parsedOutput.sourceAccount)

  res.json({
    fileName: req.file.originalname,
    sourceAccount: parsedOutput.sourceAccount,
    detectedAccount,
    transactions: parsedOutput.transactions,
  })
})

router.post('/statement/classify', async (req: Request, res: Response) => {
  const owner = await resolveOwnerId(req.authUser!.clerkUserId)
  const body = statementClassifySchema.parse(req.body)
  const db = getDatabase()

  const pending = body.transactions.filter((tx) => tx.movementType !== 'transfer' && !tx.categoryId)
  if (pending.length === 0) {
    res.json({ suggestions: {} })
    return
  }

  const normalizedDescriptions = [...new Set(pending.map((tx) => canonicalDescriptionForLearning(tx.description)).filter(Boolean))]
  const suggestions: Record<string, { categoryId: string; subcategoryId: string | null; source: 'history' | 'ai' }> = {}


  if (normalizedDescriptions.length > 0) {
    const historicalBank = await db
      .select({
        normalizedDescription: transactions.normalizedDescription,
        movementType: transactions.movementType,
        categoryId: transactions.categoryId,
        updatedAt: transactions.updatedAt,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, owner.id),
          inArray(transactions.normalizedDescription, normalizedDescriptions),
        ),
      )
      .orderBy(desc(transactions.updatedAt))

    const historicalCard = await db
      .select({
        normalizedDescription: cardTransactions.normalizedDescription,
        categoryId: cardTransactions.categoryId,
        updatedAt: cardTransactions.updatedAt,
      })
      .from(cardTransactions)
      .where(
        and(
          eq(cardTransactions.userId, owner.id),
          inArray(cardTransactions.normalizedDescription, normalizedDescriptions),
        ),
      )
      .orderBy(desc(cardTransactions.updatedAt))

    const historyByKey = new Map<string, string>()
    for (const row of historicalBank) {
      if (!row.normalizedDescription || !row.categoryId) continue
      const key = `${canonicalDescriptionForLearning(row.normalizedDescription)}|${row.movementType}`
      if (!historyByKey.has(key)) historyByKey.set(key, row.categoryId)
    }
    for (const row of historicalCard) {
      if (!row.normalizedDescription || !row.categoryId) continue
      const key = `${canonicalDescriptionForLearning(row.normalizedDescription)}|expense`
      if (!historyByKey.has(key)) historyByKey.set(key, row.categoryId)
    }

    for (const tx of pending) {
      const key = `${canonicalDescriptionForLearning(tx.description)}|${tx.movementType}`
      const matchedCategoryId = historyByKey.get(key)
      if (matchedCategoryId) {
        suggestions[tx.id] = {
          categoryId: matchedCategoryId,
          subcategoryId: null,
          source: 'history',
        }
      }
    }
  }

  for (const tx of pending) {
    if (suggestions[tx.id]) continue
    const ruleCategoryId = suggestCategoryIdByMerchantRule(tx.description, tx.movementType, body.categories)
    if (!ruleCategoryId) continue

    suggestions[tx.id] = {
      categoryId: ruleCategoryId,
      subcategoryId: null,
      source: 'ai',
    }
  }

  const remaining = pending.filter((tx) => !suggestions[tx.id])
  const expenseSuggestions = await classifyTransactionsWithAI(
    remaining
      .filter((tx) => tx.movementType === 'expense')
      .map((tx) => ({ id: tx.id, description: tx.description, amountMinor: Math.abs(tx.amountMinor) })),
    body.categories,
    'expense',
  )
  const incomeSuggestions = await classifyTransactionsWithAI(
    remaining
      .filter((tx) => tx.movementType === 'income')
      .map((tx) => ({ id: tx.id, description: tx.description, amountMinor: Math.abs(tx.amountMinor) })),
    body.categories,
    'income',
  )

  for (const [id, suggestion] of Object.entries({ ...expenseSuggestions, ...incomeSuggestions })) {
    suggestions[id] = {
      categoryId: suggestion.categoryId,
      subcategoryId: suggestion.subcategoryId,
      source: 'ai',
    }
  }

  res.json({ suggestions })
})

// ---------------------------------------------------------------------------
// Invoice reconciliation helpers
// ---------------------------------------------------------------------------

/**
 * Maps known institution name fragments found in bank statement descriptions
 * to the key used in `accounts.institution_name`.
 * Order matters: more specific patterns first.
 */
const INSTITUTION_PATTERNS: Array<{ pattern: RegExp; key: string }> = [
  { pattern: /BANCO DO BRASIL|PAG\s*BB\b/i, key: 'Banco do Brasil' },
  { pattern: /ITAU\s+UNIBANCO|ITAU\b|ITAÚ/i, key: 'Itaú' },
  { pattern: /BRADESCO/i, key: 'Bradesco' },
  { pattern: /NUBANK|NU PAG/i, key: 'Nubank' },
  { pattern: /SANTANDER/i, key: 'Santander' },
  { pattern: /CAIXA|C\.E\.F/i, key: 'Caixa' },
  { pattern: /BTG/i, key: 'BTG' },
  { pattern: /\bINTER\b/i, key: 'Inter' },
  { pattern: /\bC6\b/i, key: 'C6' },
  { pattern: /PICPAY/i, key: 'PicPay' },
  { pattern: /SICOOB/i, key: 'Sicoob' },
  { pattern: /SICREDI/i, key: 'Sicredi' },
  { pattern: /XP INVESTIMENTOS|XP INC/i, key: 'XP' },
]

const CARD_PAYMENT_PATTERN =
  /PAG(AMENTO)?\s+(FATURA|CART[A\u00c3]O|FAT)|FATURA\s+CART[A\u00c3]O|PAGTO\s+CART[A\u00c3]O(\s+CR[E\u00c9]DITO)?|PAYMENT\s+CREDIT|PAG\s+CARTAO|PAGTO\s+CART\b/i

/**
 * Returns the institution key to look up in `card_invoices` for a given
 * liability_payment transaction.
 *
 * Rule: if another bank is named in the description → that institution.
 * Otherwise → same institution as the source bank account.
 */
function detectInvoiceTargetInstitution(
  description: string,
  sourceInstitution: string | null,
): string | null {
  if (!CARD_PAYMENT_PATTERN.test(description)) return null
  for (const { pattern, key } of INSTITUTION_PATTERNS) {
    if (pattern.test(description)) return key
  }
  return sourceInstitution
}

type DbType = ReturnType<typeof getDatabase>

/**
 * Allocates a liability_payment transaction to open card invoices.
 * Oldest-due-date first, partial payments supported.
 */
async function reconcileInvoicePayment(
  db: DbType,
  userId: number,
  payment: { id: number; amountMinor: bigint; occurredAt: Date; description: string },
  sourceInstitution: string | null,
): Promise<void> {
  // Payment amount is negative in the bank account → negate to get positive
  const paymentAmount = payment.amountMinor < 0n ? -payment.amountMinor : payment.amountMinor
  if (paymentAmount === 0n) return

  const targetInstitution = detectInvoiceTargetInstitution(payment.description, sourceInstitution)
  if (!targetInstitution) return

  // Skip if this transaction was already reconciled
  const existing = await db
    .select({ id: cardInvoicePayments.id })
    .from(cardInvoicePayments)
    .where(eq(cardInvoicePayments.transactionId, payment.id))
    .limit(1)
  if (existing.length > 0) return

  // Janela assimétrica: pagamento ocorre tipicamente antes ou no dia do vencimento.
  // -60 dias: cobre pagamentos antecipados de faturas em aberto.
  // +5 dias: tolerância mínima para atraso, evita alocar faturas futuras erradas.
  const windowStart = new Date(payment.occurredAt.getTime() - 60 * 24 * 60 * 60 * 1000)
  const windowEnd = new Date(payment.occurredAt.getTime() + 5 * 24 * 60 * 60 * 1000)

  // When targetInstitution == sourceInstitution the payment description is generic
  // (e.g. "Pagto cartão crédito" from BB) and does not name the card institution.
  // In that case we search ALL open invoices within the window and use the payment
  // amount as the matching signal (exact match first, then oldest-due-date order).
  const isGenericPayment = targetInstitution === sourceInstitution

  const baseConditions = and(
    eq(cardInvoices.userId, userId),
    gt(cardInvoices.openAmountMinor, 0n),
    gte(cardInvoices.dueDate, windowStart),
    lte(cardInvoices.dueDate, windowEnd),
  )

  const openInvoices = await db
    .select({
      id: cardInvoices.id,
      dueDate: cardInvoices.dueDate,
      openAmountMinor: cardInvoices.openAmountMinor,
      paidAmountMinor: cardInvoices.paidAmountMinor,
    })
    .from(cardInvoices)
    .innerJoin(accounts, eq(accounts.id, cardInvoices.accountId))
    .where(
      isGenericPayment
        ? baseConditions
        : and(
            baseConditions,
            sql`LOWER(${accounts.institutionName}) LIKE LOWER(${`%${targetInstitution}%`})`,
          ),
    )
    .orderBy(cardInvoices.dueDate)

  if (openInvoices.length === 0) return

  // For generic payments: prefer invoices whose openAmountMinor exactly matches
  // the payment amount (most likely the correct fatura). Sort exact matches first.
  const sortedInvoices = isGenericPayment
    ? [
        ...openInvoices.filter((inv) => inv.openAmountMinor === paymentAmount),
        ...openInvoices.filter((inv) => inv.openAmountMinor !== paymentAmount),
      ]
    : openInvoices

  let remaining = paymentAmount
  for (const invoice of sortedInvoices) {
    if (remaining <= 0n) break
    const allocate = remaining < invoice.openAmountMinor ? remaining : invoice.openAmountMinor

    await db.insert(cardInvoicePayments).values({
      userId,
      cardInvoiceId: invoice.id,
      transactionId: payment.id,
      allocatedAmountMinor: allocate,
      currencyCode: 'BRL',
      paymentDate: payment.occurredAt,
      source: isGenericPayment ? 'statement_reconciliation_generic' : 'statement_reconciliation_institution',
      matchedBy: invoice.openAmountMinor === paymentAmount ? 'exact_open_amount' : 'oldest_due_open_invoice',
      confidenceScore: invoice.openAmountMinor === paymentAmount ? '1.0000' : '0.7000',
    }).onDuplicateKeyUpdate({ set: { allocatedAmountMinor: allocate } })

    const newPaid = invoice.paidAmountMinor + allocate
    const newOpen = invoice.openAmountMinor - allocate
    await db.update(cardInvoices)
      .set({
        paidAmountMinor: newPaid,
        openAmountMinor: newOpen,
        status: newOpen === 0n ? 'PAID' : 'OPEN',
      })
      .where(eq(cardInvoices.id, invoice.id))

    await syncCardInvoiceSemanticFields(db, invoice.id)

    remaining -= allocate
  }
}

router.post('/statement/import', async (req: Request, res: Response) => {
  const owner = await resolveOwnerId(req.authUser!.clerkUserId)
  const body = statementImportSchema.parse(req.body)
  const db = getDatabase()

  const sourceAccount: StatementSourceAccount = {
    institutionName: body.sourceAccount?.institutionName ?? null,
    providerAccountId: body.sourceAccount?.providerAccountId ?? null,
    accountLast4: body.sourceAccount?.accountLast4 ?? null,
  }

  const destinationAccountId = await resolveStatementAccountId(owner.id, body.accountId, sourceAccount)

  const selected = body.transactions.filter((tx) => tx.include !== false)
  if (selected.length === 0) {
    res.json({ imported: 0, skippedDuplicates: 0, skippedInvalid: 0 })
    return
  }

  const requestedCategoryIds = [...new Set(selected.map((tx) => tx.categoryId).filter(Boolean) as string[])]
  const validCategoryIds = new Set<string>()
  if (requestedCategoryIds.length > 0) {
    const found = await db
      .select({ id: categories.id })
      .from(categories)
      .where(inArray(categories.id, requestedCategoryIds))
    for (const row of found) validCategoryIds.add(row.id)
  }

  let skippedInvalid = 0
  let skippedDuplicates = 0

  const prepared: Array<{
    competencyMonth: string
    amountMinor: bigint
    normalizedDescription: string
    occurredAt: Date
    dedupeKey: string
    providerTransactionId: string | null
    values: typeof transactions.$inferInsert
  }> = []

  for (const tx of selected) {
    const dateYmd = parseLooseDateToYmd(tx.date)
    if (!dateYmd || !tx.description.trim() || tx.amountMinor === 0) {
      skippedInvalid += 1
      continue
    }

    if (tx.categoryId && !validCategoryIds.has(tx.categoryId)) {
      skippedInvalid += 1
      continue
    }

    const competencyMonth = tx.competencyMonth ?? dateYmd.slice(0, 7)
    const amountMinor = BigInt(tx.amountMinor)
    const occurredAt = new Date(`${dateYmd}T12:00:00.000Z`)
    const { fingerprint, normalizedDescription } = buildFingerprintFromRaw({
      competencyMonth,
      amountMinor,
      rawDescription: tx.description,
    })
    const dedupeKey = buildDedupeKey({
      competencyMonth,
      amountMinor,
      normalizedDescription,
      occurredYmd: dateYmd,
    })

    prepared.push({
      competencyMonth,
      amountMinor,
      normalizedDescription,
      occurredAt,
      dedupeKey,
      providerTransactionId: tx.providerTransactionId ?? null,
      values: {
        userId: owner.id,
        accountId: destinationAccountId,
        source: 'pdf_statement',
        dataState: 'consolidated',
        movementType: tx.movementType ?? (tx.amountMinor < 0 ? 'expense' : 'income'),
        movementSubtype: tx.movementSubtype ?? null,
        financialChannel: 'bank_account',
        amountMinor,
        currencyCode: 'BRL',
        balanceAfterMinor: null,
        occurredAt,
        competencyMonth,
        description: tx.description.trim(),
        memo: tx.memo ?? null,
        normalizedDescription,
        categoryId: tx.categoryId ?? null,
        providerCategory: tx.providerCategory ?? null,
        providerCategoryRaw: tx.providerCategoryRaw ?? null,
        categoryAssignedBy: tx.categoryAssignedBy ?? (tx.categoryId ? 'user' : null),
        installmentNumber: null,
        installmentTotal: null,
        installmentGroupId: null,
        isRecurring: false,
        recurringRuleId: null,
        fingerprint,
        isReconciled: false,
        reconciledGroupId: null,
        providerTransactionId: tx.providerTransactionId ?? null,
        providerPayload: null,
      },
    })
  }

  if (prepared.length === 0) {
    res.json({ imported: 0, skippedDuplicates, skippedInvalid })
    return
  }

  const months = prepared.map((tx) => tx.competencyMonth)
  const minMonth = months.reduce((acc, m) => (m < acc ? m : acc), months[0])
  const maxMonth = months.reduce((acc, m) => (m > acc ? m : acc), months[0])

  const existing = await db
    .select({
      competencyMonth: transactions.competencyMonth,
      amountMinor: transactions.amountMinor,
      normalizedDescription: transactions.normalizedDescription,
      description: transactions.description,
      occurredAt: transactions.occurredAt,
      providerTransactionId: transactions.providerTransactionId,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, owner.id),
        eq(transactions.accountId, destinationAccountId),
        gte(transactions.competencyMonth, minMonth),
        lte(transactions.competencyMonth, maxMonth),
      ),
    )

  const existingKeys = new Set<string>()
  const existingProviderIds = new Set<string>()
  for (const row of existing) {
    const normalizedDescription = row.normalizedDescription
      ?? buildFingerprintFromRaw({
        competencyMonth: row.competencyMonth,
        amountMinor: row.amountMinor,
        rawDescription: row.description,
      }).normalizedDescription
    existingKeys.add(buildDedupeKey({
      competencyMonth: row.competencyMonth,
      amountMinor: row.amountMinor,
      normalizedDescription,
      occurredYmd: row.occurredAt.toISOString().slice(0, 10),
    }))
    if (row.providerTransactionId) existingProviderIds.add(row.providerTransactionId)
  }

  const toInsert: Array<typeof transactions.$inferInsert> = []
  for (const item of prepared) {
    if (item.providerTransactionId && existingProviderIds.has(item.providerTransactionId)) {
      skippedDuplicates += 1
      continue
    }
    if (existingKeys.has(item.dedupeKey)) {
      skippedDuplicates += 1
      continue
    }
    toInsert.push(item.values)
    existingKeys.add(item.dedupeKey)
    if (item.providerTransactionId) existingProviderIds.add(item.providerTransactionId)
  }

  if (toInsert.length > 0) {
    await db.insert(transactions).values(toInsert)

    // Reconcile liability_payment transactions against open card invoices
    const liabilityItems = toInsert.filter(tx => tx.movementType === 'liability_payment')
    if (liabilityItems.length > 0) {
      try {
        const fps = liabilityItems.map(tx => tx.fingerprint).filter(Boolean) as string[]
        const [sourceAcc] = await db
          .select({ institutionName: accounts.institutionName })
          .from(accounts)
          .where(eq(accounts.id, destinationAccountId))
          .limit(1)

        const insertedPayments = fps.length > 0
          ? await db
              .select({
                id: transactions.id,
                amountMinor: transactions.amountMinor,
                occurredAt: transactions.occurredAt,
                description: transactions.description,
              })
              .from(transactions)
              .where(
                and(
                  eq(transactions.userId, owner.id),
                  eq(transactions.accountId, destinationAccountId),
                  inArray(transactions.fingerprint, fps),
                ),
              )
          : []

        for (const tx of insertedPayments) {
          await reconcileInvoicePayment(db, owner.id, tx, sourceAcc?.institutionName ?? null)
        }
      } catch (err) {
        // Reconciliation failure must not roll back the import
        console.error('[reconcileInvoicePayment] error:', err)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Reconciliação automática de receipt_documents (débito)
  // Cruza notas projetadas SEM expectedInvoiceMonth com transactions recém-inseridas
  // Critério: amount_minor igual + merchant_name fuzzy (8 chars) + competencyMonth
  // Best-effort: não bloqueia o import em caso de erro
  // -------------------------------------------------------------------------
  if (toInsert.length > 0) {
    try {
      const projectedDebitNotes = await db
        .select()
        .from(receiptDocuments)
        .where(
          and(
            eq(receiptDocuments.ownerId, owner.id),
            eq(receiptDocuments.dataState, 'projected'),
          )
        )

      const debitNotes = projectedDebitNotes.filter((n) => !n.expectedInvoiceMonth)

      if (debitNotes.length > 0) {
        const insertedFps = toInsert.map((t) => t.fingerprint).filter(Boolean) as string[]
        const insertedTxs = insertedFps.length > 0
          ? await db
              .select()
              .from(transactions)
              .where(
                and(
                  eq(transactions.userId, owner.id),
                  inArray(transactions.fingerprint, insertedFps),
                )
              )
          : []

        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)

        for (const note of debitNotes) {
          const match = insertedTxs.find((tx) => {
            const amtOk = BigInt(tx.amountMinor ?? 0) === BigInt(note.amountMinor ?? 0)
            const merchantOk = note.merchantName
              ? normalize(tx.description ?? '') === normalize(note.merchantName)
              : true
            const monthOk = tx.competencyMonth === note.purchaseMonth
            return amtOk && (merchantOk || monthOk)
          })
          if (match) {
            await db
              .update(transactions)
              .set({
                receiptDocumentId: note.id,
                updatedAt: new Date(),
              })
              .where(eq(transactions.id, match.id))

            await db
              .update(receiptDocuments)
              .set({
                dataState: 'reconciled',
                transactionId: match.id,
                reconcileSource: 'statement_import',
                reconciledAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(receiptDocuments.id, note.id))
          }
        }
      }
    } catch (reconcileErr) {
      console.warn('[transactions/statement] receipt reconciliation error (non-blocking):', reconcileErr)
    }
  }

  res.json({
    imported: toInsert.length,
    skippedDuplicates,
    skippedInvalid,
  })
})

router.get('/:id', async (req: Request, res: Response) => {
  const owner = await resolveOwnerId(req.authUser!.clerkUserId)
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    throw createError('Invalid transaction id', 400)
  }

  const db = getDatabase()
  const [row] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, owner.id)))
    .limit(1)

  if (!row) {
    throw createError('Transaction not found', 404)
  }

  res.json({
    ...row,
    amountMinor: row.amountMinor.toString(),
    balanceAfterMinor: row.balanceAfterMinor?.toString() ?? null,
    categoryId: row.categoryId ?? null,
  })
})

router.post('/', async (req: Request, res: Response) => {
  const owner = await resolveOwnerId(req.authUser!.clerkUserId)
  const body = createTransactionSchema.parse(req.body)
  const db = getDatabase()

  if (body.categoryId) {
    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, body.categoryId))
      .limit(1)

    if (!category) {
      throw createError('Category not found', 400)
    }
  }

  const accountId = body.accountId ?? (await resolveDefaultAccountId(owner.id))
  const occurredAt = toDateInput(body.occurredAt)
  const competencyMonth = body.competencyMonth ?? toCompetencyMonth(occurredAt)
  const amountMinor = toMinor(body.amountMinor)
  const { fingerprint, normalizedDescription } = buildFingerprintFromRaw({
    competencyMonth,
    amountMinor,
    rawDescription: body.description,
  })

  const values = {
    userId: owner.id,
    accountId,
    source: body.source,
    dataState: body.dataState,
    movementType: body.movementType,
    movementSubtype: body.movementSubtype ?? null,
    financialChannel: body.financialChannel,
    amountMinor,
    currencyCode: 'BRL',
    balanceAfterMinor: body.balanceAfterMinor !== undefined ? toMinor(body.balanceAfterMinor) : null,
    occurredAt: new Date(occurredAt),
    competencyMonth,
    description: body.description,
    normalizedDescription,
    categoryId: body.categoryId ?? null,
    installmentNumber: null,
    installmentTotal: null,
    installmentGroupId: null,
    isRecurring: body.isRecurring ?? false,
    recurringRuleId: body.recurringRuleId ?? null,
    fingerprint,
    isReconciled: false,
    reconciledGroupId: body.reconciledGroupId ?? null,
    providerTransactionId: null,
    providerPayload: null,
  }

  const result = await db.insert(transactions).values(values)
  const insertedId = Number((result as { insertId?: number }).insertId || 0)

  res.status(201).json({
    id: insertedId || null,
    ...values,
    amountMinor: amountMinor.toString(),
    balanceAfterMinor: values.balanceAfterMinor?.toString() ?? null,
    categoryId: values.categoryId,
    occurredAt: values.occurredAt.toISOString(),
  })
})

router.put('/:id', async (req: Request, res: Response) => {
  const owner = await resolveOwnerId(req.authUser!.clerkUserId)
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    throw createError('Invalid transaction id', 400)
  }

  const body = updateTransactionSchema.parse(req.body)
  const db = getDatabase()
  const [existing] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, owner.id)))
    .limit(1)

  if (!existing) {
    throw createError('Transaction not found', 404)
  }

  if (body.categoryId) {
    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, body.categoryId))
      .limit(1)

    if (!category) {
      throw createError('Category not found', 400)
    }
  }

  const occurredAt = body.occurredAt ?? existing.occurredAt.toISOString()
  const description = body.description ?? existing.description
  const amountMinor = body.amountMinor !== undefined ? toMinor(body.amountMinor) : existing.amountMinor
  const competencyMonth = body.competencyMonth ?? existing.competencyMonth
  const { fingerprint, normalizedDescription } = buildFingerprintFromRaw({
    competencyMonth,
    amountMinor,
    rawDescription: description,
  })

  const patch = {
    accountId: body.accountId ?? existing.accountId,
    source: body.source ?? existing.source,
    dataState: body.dataState ?? existing.dataState,
    movementType: body.movementType ?? existing.movementType,
    movementSubtype: body.movementSubtype ?? existing.movementSubtype,
    financialChannel: body.financialChannel ?? existing.financialChannel,
    amountMinor,
    balanceAfterMinor: body.balanceAfterMinor !== undefined ? toMinor(body.balanceAfterMinor) : existing.balanceAfterMinor,
    occurredAt: new Date(occurredAt),
    competencyMonth,
    description,
    normalizedDescription,
    categoryId: body.categoryId ?? existing.categoryId,
    isRecurring: body.isRecurring ?? existing.isRecurring,
    recurringRuleId: body.recurringRuleId ?? existing.recurringRuleId,
    fingerprint,
    reconciledGroupId: body.reconciledGroupId ?? existing.reconciledGroupId,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  }

  await db
    .update(transactions)
    .set(patch)
    .where(and(eq(transactions.id, id), eq(transactions.userId, owner.id)))

  const { updatedAt: _updatedAt, ...responsePatch } = patch

  res.json({
    id,
    ...responsePatch,
    amountMinor: amountMinor.toString(),
    balanceAfterMinor: responsePatch.balanceAfterMinor?.toString() ?? null,
    occurredAt: responsePatch.occurredAt.toISOString(),
    categoryId: responsePatch.categoryId ?? null,
  })
})

router.delete('/:id', async (req: Request, res: Response) => {
  const owner = await resolveOwnerId(req.authUser!.clerkUserId)
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    throw createError('Invalid transaction id', 400)
  }

  const db = getDatabase()
  await db
    .delete(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.userId, owner.id)))

  res.json({
    deleted: true,
    id,
  })
})

export { router as transactionRouter }

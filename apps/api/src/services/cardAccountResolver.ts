import { and, eq } from 'drizzle-orm'
import { accounts } from '@previa/db'

type NullableString = string | null | undefined

export type CreditCardIdentity = {
  institutionName?: NullableString
  cardBrand?: NullableString
  cardLast4?: NullableString
}

function normalizeText(value: NullableString): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function normalizeLast4(value: NullableString): string | null {
  if (typeof value !== 'string') return null
  const digits = value.replace(/\D/g, '')
  if (digits.length < 4) return null
  return digits.slice(-4)
}

function formatBrandDisplay(value: string | null): string | null {
  if (!value) return null
  const upper = value.toUpperCase()
  if (upper.includes('MASTERCARD') || upper.includes('MASTER')) return 'Mastercard'
  if (upper.includes('VISA')) return 'Visa'
  if (upper.includes('ELO')) return 'Elo'
  if (upper.includes('AMERICAN EXPRESS') || upper.includes('AMEX')) return 'Amex'
  if (upper.includes('HIPERCARD')) return 'Hipercard'
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
}

export function buildCreditCardDisplayName(
  institutionName: NullableString,
  cardBrand: NullableString,
  cardLast4: NullableString,
): string {
  const institution = normalizeText(institutionName) ?? 'Cartão'
  const brand = formatBrandDisplay(normalizeText(cardBrand))
  const suffix = normalizeLast4(cardLast4)
  return [institution, brand, suffix ? `•••• ${suffix}` : null].filter(Boolean).join(' ')
}

type ExistingCreditCardAccount = {
  id: number
  institutionName: string | null
  cardBrand: string | null
  displayName: string
}

export async function resolveOrCreateCreditCardAccount(
  db: any,
  ownerId: number,
  identity: CreditCardIdentity,
  source: 'manual' | 'receipt_document' = 'manual',
): Promise<number | null> {
  const institutionName = normalizeText(identity.institutionName)
  const cardLast4 = normalizeLast4(identity.cardLast4)
  const cardBrand = normalizeText(identity.cardBrand)?.toUpperCase() ?? null

  if (!cardLast4) {
    return null
  }

  const existingRows = (await db
    .select({
      id: accounts.id,
      institutionName: accounts.institutionName,
      cardBrand: accounts.cardBrand,
      displayName: accounts.displayName,
    })
    .from(accounts)
    .where(and(
      eq(accounts.userId, ownerId),
      eq(accounts.financialChannel, 'credit_card'),
      eq(accounts.cardLast4, cardLast4),
    ))
    .limit(20)) as ExistingCreditCardAccount[]

  if (existingRows.length > 0) {
    if (institutionName) {
      const normalizedInstitution = institutionName.toLowerCase()
      const exactInstitutionMatch = existingRows.find((row) =>
        normalizeText(row.institutionName)?.toLowerCase() === normalizedInstitution,
      )
      if (exactInstitutionMatch) {
        return exactInstitutionMatch.id
      }
    }

    if (cardBrand) {
      const exactBrandMatch = existingRows.find((row) =>
        normalizeText(row.cardBrand)?.toUpperCase() === cardBrand,
      )
      if (exactBrandMatch) {
        return exactBrandMatch.id
      }
    }

    return existingRows[0].id
  }

  await db.insert(accounts).values({
    userId: ownerId,
    type: 'CREDIT_CARD',
    financialChannel: 'credit_card',
    displayName: buildCreditCardDisplayName(institutionName, cardBrand, cardLast4),
    institutionName,
    cardBrand: cardBrand ?? undefined,
    cardLast4,
    source,
    currencyCode: 'BRL',
    isActive: true,
  })

  const [created] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(
      eq(accounts.userId, ownerId),
      eq(accounts.financialChannel, 'credit_card'),
      eq(accounts.cardLast4, cardLast4),
    ))
    .limit(1)

  return created?.id ?? null
}

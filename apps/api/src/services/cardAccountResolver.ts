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

export async function resolveOrCreateCreditCardAccount(
  db: any,
  ownerId: number,
  identity: CreditCardIdentity,
  source: 'manual' | 'receipt_document' = 'manual',
): Promise<number | null> {
  const institutionName = normalizeText(identity.institutionName)
  const cardLast4 = normalizeLast4(identity.cardLast4)
  const cardBrand = normalizeText(identity.cardBrand)?.toUpperCase() ?? null

  if (!institutionName || !cardLast4) {
    return null
  }

  const [existing] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(
      eq(accounts.userId, ownerId),
      eq(accounts.financialChannel, 'credit_card'),
      eq(accounts.institutionName, institutionName),
      eq(accounts.cardLast4, cardLast4),
    ))
    .limit(1)

  if (existing) {
    return existing.id
  }

  const institutionDisplay = institutionName
  const cardBrandDisplay = cardBrand ? ` ${cardBrand}` : ''
  const last4Display = ` ••••${cardLast4}`

  await db.insert(accounts).values({
    userId: ownerId,
    type: 'CREDIT_CARD',
    financialChannel: 'credit_card',
    displayName: `${institutionDisplay}${cardBrandDisplay}${last4Display}`.trim(),
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
      eq(accounts.institutionName, institutionName),
      eq(accounts.cardLast4, cardLast4),
    ))
    .limit(1)

  return created?.id ?? null
}

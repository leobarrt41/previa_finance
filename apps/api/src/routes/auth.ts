import { Router, type Request, type Response } from 'express'
import { desc, eq } from 'drizzle-orm'
import { accounts } from '@previa/db'
import { getDatabase } from '../config/database.js'
import { requireClerkAuth } from '../middlewares/auth.js'
import { createError } from '../middlewares/errorHandler.js'
import { resolveOwnerId } from '../services/ownerStore.js'

const router: Router = Router()

async function ensureDefaultAccount(ownerId: number) {
  const db = getDatabase()
  const existing = await db
    .select({
      id: accounts.id,
      displayName: accounts.displayName,
      financialChannel: accounts.financialChannel,
    })
    .from(accounts)
    .where(eq(accounts.userId, ownerId))
    .limit(1)

  if (existing.length > 0) {
    return existing[0]
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
    .select({
      id: accounts.id,
      displayName: accounts.displayName,
      financialChannel: accounts.financialChannel,
    })
    .from(accounts)
    .where(eq(accounts.userId, ownerId))
    .orderBy(desc(accounts.id))
    .limit(1)

  return created ?? {
    id: ownerId,
    displayName: 'Conta principal',
    financialChannel: 'bank_account',
  }
}

router.get('/me', requireClerkAuth, async (req: Request, res: Response) => {
  const owner = await resolveOwnerId(req.authUser!.clerkUserId)
  res.json({
    clerkUserId: req.authUser!.clerkUserId,
    sessionId: req.authUser!.sessionId,
    ownerId: owner.id,
    authorizedParty: req.authUser!.authorizedParty || null,
  })
})

router.post('/bootstrap', requireClerkAuth, async (req: Request, res: Response) => {
  try {
    const owner = await resolveOwnerId(req.authUser!.clerkUserId)
    const account = await ensureDefaultAccount(owner.id)

    res.status(201).json({
      clerkUserId: req.authUser!.clerkUserId,
      ownerId: owner.id,
      defaultAccount: account,
    })
  } catch (error) {
    throw createError('Failed to bootstrap Clerk account', 500)
  }
})

export { router as authRouter }

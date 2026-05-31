/**
 * middlewares/checkSubscription.ts
 *
 * Guard de assinatura: bloqueia rotas premium quando o trial expirou
 * ou a assinatura foi cancelada/expirada.
 *
 * Bypass automático quando DEV_AUTH_BYPASS=true.
 */

import type { Request, Response, NextFunction } from 'express'
import { eq } from 'drizzle-orm'
import { getDatabase } from '../config/database.js'
import { subscriptions } from '@previa/db'

function isActive(sub: typeof subscriptions.$inferSelect): boolean {
  const now = new Date()
  if (sub.status === 'trialing') {
    return sub.trialEndsAt > now
  }
  if (sub.status === 'active') {
    return sub.currentPeriodEnd ? sub.currentPeriodEnd > now : true
  }
  return false
}

export async function checkSubscription(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Bypass em modo dev
  if (process.env.DEV_AUTH_BYPASS === 'true') {
    next()
    return
  }

  const clerkUserId = req.authUser?.clerkUserId
  if (!clerkUserId) {
    res.status(401).json({ error: 'Não autenticado' })
    return
  }

  try {
    const db = getDatabase()
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.clerkUserId, clerkUserId))
      .limit(1)

    if (!sub) {
      // Utilizador sem registo de assinatura — redirecionar para criar trial
      res.status(402).json({
        error: 'subscription_required',
        message: 'Inicie o seu período de trial gratuito de 15 dias.',
        upgradeUrl: '/upgrade',
      })
      return
    }

    if (isActive(sub)) {
      next()
      return
    }

    res.status(402).json({
      error: 'subscription_required',
      message:
        sub.status === 'trialing'
          ? 'O seu período de trial expirou. Assine para continuar.'
          : 'A sua assinatura está inativa. Renove para continuar.',
      upgradeUrl: '/upgrade',
      status: sub.status,
    })
  } catch (err) {
    next(err)
  }
}

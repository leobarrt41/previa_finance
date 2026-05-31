/**
 * routes/subscription.ts — Endpoints de assinatura Stripe
 *
 * GET  /api/subscription/me              — retorna estado da assinatura (cria trial se não existe)
 * POST /api/subscription/create-checkout — cria sessão de checkout Stripe
 * POST /api/subscription/webhook         — recebe eventos Stripe (raw body)
 * POST /api/subscription/cancel          — cancela assinatura no Stripe
 */

import { Router, type Request, type Response, type NextFunction } from 'express'
import Stripe from 'stripe'
import { eq } from 'drizzle-orm'
import { getDatabase } from '../config/database.js'
import { config } from '../config/env.js'
import { requireClerkAuth } from '../middlewares/auth.js'
import { createError } from '../middlewares/errorHandler.js'
import { subscriptions } from '@previa/db'

export const subscriptionRouter = Router()

// ---------------------------------------------------------------------------
// Instância Stripe (lazy — só inicializa se a chave estiver configurada)
// ---------------------------------------------------------------------------
function getStripe(): Stripe {
  if (!config.billing.stripeSecretKey) {
    throw createError('Stripe não está configurado (STRIPE_SECRET_KEY ausente)', 500)
  }
  return new Stripe(config.billing.stripeSecretKey, {
    apiVersion: '2025-05-28.basil',
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function daysRemaining(end: Date): number {
  const diff = end.getTime() - Date.now()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

function isSubscriptionActive(sub: typeof subscriptions.$inferSelect): boolean {
  const now = new Date()
  if (sub.status === 'trialing') {
    return sub.trialEndsAt > now
  }
  if (sub.status === 'active') {
    return sub.currentPeriodEnd ? sub.currentPeriodEnd > now : true
  }
  return false
}

// ---------------------------------------------------------------------------
// GET /me — retorna estado da assinatura; cria trial se não existe
// ---------------------------------------------------------------------------
subscriptionRouter.get(
  '/me',
  requireClerkAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clerkUserId = req.authUser!.clerkUserId
      const db = getDatabase()

      const [existing] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.clerkUserId, clerkUserId))
        .limit(1)

      if (existing) {
        const active = isSubscriptionActive(existing)
        const days =
          existing.status === 'trialing'
            ? daysRemaining(existing.trialEndsAt)
            : existing.currentPeriodEnd
            ? daysRemaining(existing.currentPeriodEnd)
            : 0

        return res.json({
          status: existing.status,
          trialEndsAt: existing.trialEndsAt,
          currentPeriodEnd: existing.currentPeriodEnd,
          daysRemaining: days,
          isActive: active,
          plan: existing.plan,
          stripeCustomerId: existing.stripeCustomerId,
          stripeSubscriptionId: existing.stripeSubscriptionId,
        })
      }

      // Criar trial para novo utilizador
      const now = new Date()
      const trialEndsAt = addDays(now, config.billing.trialDays)

      await db.insert(subscriptions).values({
        clerkUserId,
        plan: 'monthly',
        status: 'trialing',
        trialStartedAt: now,
        trialEndsAt,
      })

      return res.status(201).json({
        status: 'trialing',
        trialEndsAt,
        currentPeriodEnd: null,
        daysRemaining: config.billing.trialDays,
        isActive: true,
        plan: 'monthly',
        stripeCustomerId: null,
        stripeSubscriptionId: null,
      })
    } catch (err) {
      next(err)
    }
  },
)

// ---------------------------------------------------------------------------
// POST /create-checkout — cria sessão de checkout Stripe
// ---------------------------------------------------------------------------
subscriptionRouter.post(
  '/create-checkout',
  requireClerkAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clerkUserId = req.authUser!.clerkUserId
      const stripe = getStripe()
      const db = getDatabase()

      const [sub] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.clerkUserId, clerkUserId))
        .limit(1)

      const successUrl =
        (req.body?.successUrl as string) ||
        `${config.frontend.url}/dashboard?checkout=success`
      const cancelUrl =
        (req.body?.cancelUrl as string) ||
        `${config.frontend.url}/upgrade?checkout=canceled`

      // Reutilizar customer Stripe se já existir
      const customerParams: Stripe.Checkout.SessionCreateParams['customer_creation'] =
        undefined
      let customer: string | undefined = sub?.stripeCustomerId ?? undefined

      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: 'subscription',
        line_items: [
          {
            price: config.billing.stripePriceId,
            quantity: 1,
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          clerkUserId,
        },
        subscription_data: {
          metadata: {
            clerkUserId,
          },
        },
      }

      if (customer) {
        sessionParams.customer = customer
      } else {
        sessionParams.customer_creation = 'always'
      }

      const session = await stripe.checkout.sessions.create(sessionParams)

      return res.json({ url: session.url, sessionId: session.id })
    } catch (err) {
      next(err)
    }
  },
)

// ---------------------------------------------------------------------------
// POST /webhook — recebe eventos Stripe (raw body, sem requireClerkAuth)
// ---------------------------------------------------------------------------
subscriptionRouter.post(
  '/webhook',
  async (req: Request, res: Response, next: NextFunction) => {
    const sig = req.headers['stripe-signature'] as string

    // Em dev sem webhook secret configurado, aceitar sem verificar
    const webhookSecret = config.billing.stripeWebhookSecret
    const isPlaceholder =
      !webhookSecret || webhookSecret === 'whsec_placeholder'

    let event: Stripe.Event

    try {
      const stripe = getStripe()
      const rawBody = req.body as Buffer

      if (isPlaceholder) {
        // Modo dev: parsear o body diretamente sem verificação de assinatura
        const bodyStr =
          Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : JSON.stringify(rawBody)
        event = JSON.parse(bodyStr) as Stripe.Event
      } else {
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
      }
    } catch (err) {
      console.error('[Stripe Webhook] Falha na verificação:', err)
      res.status(400).json({ error: 'Webhook signature verification failed' })
      return
    }

    try {
      const db = getDatabase()
      await handleStripeEvent(db, event)
      res.json({ received: true })
    } catch (err) {
      console.error('[Stripe Webhook] Erro ao processar evento:', err)
      next(err)
    }
  },
)

// ---------------------------------------------------------------------------
// POST /cancel — cancela assinatura no Stripe
// ---------------------------------------------------------------------------
subscriptionRouter.post(
  '/cancel',
  requireClerkAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clerkUserId = req.authUser!.clerkUserId
      const stripe = getStripe()
      const db = getDatabase()

      const [sub] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.clerkUserId, clerkUserId))
        .limit(1)

      if (!sub) {
        throw createError('Assinatura não encontrada', 404)
      }

      if (sub.stripeSubscriptionId) {
        // Cancelar no Stripe no final do período atual
        await stripe.subscriptions.update(sub.stripeSubscriptionId, {
          cancel_at_period_end: true,
        })
      }

      const now = new Date()
      await db
        .update(subscriptions)
        .set({
          status: 'canceled',
          canceledAt: now,
          updatedAt: now,
        })
        .where(eq(subscriptions.clerkUserId, clerkUserId))

      return res.json({ success: true, canceledAt: now })
    } catch (err) {
      next(err)
    }
  },
)

// ---------------------------------------------------------------------------
// Processador de eventos Stripe
// ---------------------------------------------------------------------------
async function handleStripeEvent(
  db: ReturnType<typeof getDatabase>,
  event: Stripe.Event,
): Promise<void> {
  const now = new Date()

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const clerkUserId = session.metadata?.clerkUserId
      if (!clerkUserId) {
        console.warn('[Stripe Webhook] checkout.session.completed sem clerkUserId')
        return
      }

      const customerId =
        typeof session.customer === 'string'
          ? session.customer
          : session.customer?.id ?? null

      const subscriptionId =
        typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id ?? null

      // Buscar detalhes da subscription para obter current_period_end
      let periodEnd: Date | null = null
      if (subscriptionId) {
        try {
          const stripe = getStripe()
          const stripeSub = await stripe.subscriptions.retrieve(subscriptionId)
          periodEnd = new Date(stripeSub.current_period_end * 1000)
        } catch {
          // Não bloquear o webhook por falha ao buscar detalhes
        }
      }

      await db
        .update(subscriptions)
        .set({
          status: 'active',
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          stripePriceId: config.billing.stripePriceId,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          updatedAt: now,
        })
        .where(eq(subscriptions.clerkUserId, clerkUserId))

      console.log(`[Stripe] Assinatura ativada para ${clerkUserId}`)
      break
    }

    case 'customer.subscription.updated': {
      const stripeSub = event.data.object as Stripe.Subscription
      const clerkUserId = stripeSub.metadata?.clerkUserId
      if (!clerkUserId) return

      const periodEnd = new Date(stripeSub.current_period_end * 1000)
      const periodStart = new Date(stripeSub.current_period_start * 1000)

      const statusMap: Record<string, string> = {
        active: 'active',
        past_due: 'past_due',
        canceled: 'canceled',
        unpaid: 'past_due',
        trialing: 'trialing',
        paused: 'canceled',
        incomplete: 'past_due',
        incomplete_expired: 'expired',
      }
      const newStatus = statusMap[stripeSub.status] ?? 'active'

      await db
        .update(subscriptions)
        .set({
          status: newStatus,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          updatedAt: now,
        })
        .where(eq(subscriptions.clerkUserId, clerkUserId))

      console.log(`[Stripe] Subscription atualizada para ${clerkUserId}: ${newStatus}`)
      break
    }

    case 'customer.subscription.deleted': {
      const stripeSub = event.data.object as Stripe.Subscription
      const clerkUserId = stripeSub.metadata?.clerkUserId
      if (!clerkUserId) return

      await db
        .update(subscriptions)
        .set({
          status: 'canceled',
          canceledAt: now,
          updatedAt: now,
        })
        .where(eq(subscriptions.clerkUserId, clerkUserId))

      console.log(`[Stripe] Assinatura cancelada para ${clerkUserId}`)
      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      const customerId =
        typeof invoice.customer === 'string'
          ? invoice.customer
          : invoice.customer?.id ?? null
      if (!customerId) return

      await db
        .update(subscriptions)
        .set({
          status: 'past_due',
          updatedAt: now,
        })
        .where(eq(subscriptions.stripeCustomerId, customerId))

      console.log(`[Stripe] Pagamento falhou para customer ${customerId}`)
      break
    }

    default:
      // Ignorar eventos não tratados
      break
  }
}

/**
 * env.ts - Configuration from environment variables
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadDotenv } from 'dotenv'

const envCandidates = [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../.env'),
  resolve(process.cwd(), '../../.env'),
]

for (const candidate of envCandidates) {
  if (existsSync(candidate)) {
    loadDotenv({ path: candidate })
  }
}

function parseDatabaseUrl(url?: string) {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return {
      host: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : 3306,
      username: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//, ''),
    }
  } catch {
    return null
  }
}

const dbFromUrl = parseDatabaseUrl(process.env.DATABASE_URL)

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3001', 10),
    environment: process.env.NODE_ENV || 'development'
  },
  
  database: {
    host: process.env.DB_HOST ?? dbFromUrl?.host ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? String(dbFromUrl?.port ?? 3306), 10),
    username: process.env.DB_USERNAME ?? dbFromUrl?.username ?? 'root',
    password: process.env.DB_PASSWORD ?? dbFromUrl?.password ?? '',
    database: process.env.DB_NAME ?? dbFromUrl?.database ?? 'previa_finance'
  },
  
  auth: {
    clerkJwtKey: process.env.CLERK_JWT_KEY || '',
    clerkSecretKey: process.env.CLERK_SECRET_KEY || '',
    clerkAuthorizedParties: (process.env.CLERK_AUTHORIZED_PARTIES || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  },
  
  frontend: {
    url: process.env.FRONTEND_URL || 'http://localhost:5173'
  },

  ai: {
    provider: (process.env.LLM_PROVIDER || process.env.AI_PROVIDER || 'openai').toLowerCase(),
    apiKey:
      (process.env.LLM_PROVIDER || process.env.AI_PROVIDER || 'openai').toLowerCase() === 'gemini'
        ? process.env.GEMINI_API_KEY || ''
        : process.env.AI_API_KEY || process.env.OPENAI_API_KEY || '',
    model:
      process.env.AI_MODEL
      || process.env.LLM_MODEL_ANALYSIS
      || process.env.LLM_MODEL_CLASSIFIER
      || 'gpt-4o-mini',
    baseUrl: process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  },

  billing: {
    stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    stripePriceId: process.env.STRIPE_PRICE_ID || 'price_1TdEEy2HW1BQKySlLGuQ5MtM',
    trialDays: parseInt(process.env.TRIAL_DAYS || '15', 10),
    monthlyPriceBRL: parseFloat(process.env.MONTHLY_PRICE_BRL || '14.99'),
  }
}

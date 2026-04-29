import type { NextFunction, Request, Response } from 'express'
import jwt, { type JwtPayload } from 'jsonwebtoken'
import { config } from '../config/env.js'
import { createError } from './errorHandler.js'

export interface ClerkAuthContext {
  clerkUserId: string
  sessionId: string
  authorizedParty?: string
}

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return null
  }

  const token = header.slice('Bearer '.length).trim()
  return token.length > 0 ? token : null
}

export function requireClerkAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = getBearerToken(req)

    const devAuthBypass = process.env.DEV_AUTH_BYPASS === 'true'
    if (!token && devAuthBypass) {
      const clerkUserId = process.env.DEV_USER_OPEN_ID || 'dev-user'
      req.authUser = {
        clerkUserId,
        sessionId: 'dev-session',
        authorizedParty: 'dev-local',
      }
      next()
      return
    }

    if (!token) {
      throw createError('Missing authorization token', 401)
    }

    if (!config.auth.clerkJwtKey) {
      throw createError('CLERK_JWT_KEY is not configured', 500)
    }

    const decoded = jwt.verify(token, config.auth.clerkJwtKey, {
      algorithms: ['RS256'],
    }) as JwtPayload

    const clerkUserId = typeof decoded.sub === 'string' ? decoded.sub : ''
    const sessionId = typeof decoded.sid === 'string' ? decoded.sid : ''
    const authorizedParty = typeof decoded.azp === 'string' ? decoded.azp : undefined

    if (!clerkUserId || !sessionId) {
      throw createError('Invalid Clerk session token', 401)
    }

    if (config.auth.clerkAuthorizedParties.length > 0 && authorizedParty) {
      const isAllowed = config.auth.clerkAuthorizedParties.includes(authorizedParty)
      if (!isAllowed) {
        throw createError('Token origin is not allowed', 401)
      }
    }

    req.authUser = {
      clerkUserId,
      sessionId,
      authorizedParty,
    }

    next()
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) {
      next(error)
      return
    }

    next(createError('Unauthorized', 401))
  }
}

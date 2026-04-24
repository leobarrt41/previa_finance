import type { ClerkAuthContext } from '../middlewares/auth.js'

declare global {
  namespace Express {
    interface Request {
      authUser?: ClerkAuthContext
    }
  }
}

export {}

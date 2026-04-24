/**
 * routes/index.ts - Main router setup
 */

import { Router } from 'express'
import { cashflowRouter } from './cashflow.js'
import { budgetRouter } from './budget.js'
import { transactionRouter } from './transactions.js'
import { categoryRouter } from './categories.js'
import { authRouter } from './auth.js'

export function setupRoutes(): Router {
  const router: Router = Router()

  // API version and basic info
  router.get('/', (req, res) => {
    res.json({
      name: 'Previa Finance API',
      version: '1.0.0',
      endpoints: {
        auth: '/api/auth',
        cashflow: '/api/cashflow',
        budget: '/api/budget', 
        transactions: '/api/transactions',
        categories: '/api/categories'
      }
    })
  })

  // Mount feature routers
  router.use('/cashflow', cashflowRouter)
  router.use('/budget', budgetRouter)
  router.use('/auth', authRouter)
  router.use('/transactions', transactionRouter)
  router.use('/categories', categoryRouter)

  return router
}

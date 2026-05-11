/**
 * routes/index.ts - Main router setup
 */

import { Router } from 'express'
import { cashflowRouter } from './cashflow.js'
import { budgetRouter } from './budget.js'
import { transactionRouter } from './transactions.js'
import { categoryRouter } from './categories.js'
import { authRouter } from './auth.js'
import { invoiceRouter } from './invoices.js'
import { accountRouter } from './accounts.js'
import { assessRouter } from './assess.js'
import { receiptDocumentsRouter } from './receiptDocuments.js'
import { chatRouter } from './chat.js'

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
        accounts: '/api/accounts',
        categories: '/api/categories',
        invoices: '/api/invoices',
        assess: '/api/assess',
        receiptDocuments: '/api/receipt-documents',
        chat: '/api/chat',
      }
    })
  })

  // Mount feature routers
  router.use('/cashflow', cashflowRouter)
  router.use('/budget', budgetRouter)
  router.use('/auth', authRouter)
  router.use('/transactions', transactionRouter)
  router.use('/accounts', accountRouter)
  router.use('/categories', categoryRouter)
  router.use('/invoices', invoiceRouter)
  router.use('/assess', assessRouter)
  router.use('/receipt-documents', receiptDocumentsRouter)
  router.use('/chat', chatRouter)

  return router
}

/**
 * routes/categories.ts - Categories endpoints
 */

import { Router } from 'express'

const router: Router = Router()

router.get('/', (req, res) => {
  // TODO: Buscar do banco via @previa/db
  res.json([
    {
      id: 'food',
      name: 'Alimentação',
      slug: 'alimentacao',
      type: 'expense',
      parentId: null,
      isSystem: true
    },
    {
      id: 'transport', 
      name: 'Transporte',
      slug: 'transporte',
      type: 'expense',
      parentId: null,
      isSystem: true
    }
  ])
})

export { router as categoryRouter }

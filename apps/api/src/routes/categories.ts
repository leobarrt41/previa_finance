/**
 * routes/categories.ts — Categories CRUD with Database Persistence
 *
 * Suporta hierarquia: categoria → subcategoria via parentId.
 * Todas as categorias são persistidas no banco de dados (MySQL via Drizzle).
 *
 * Endpoints:
 *   GET    /api/categories          — lista todas (flat, com parentId)
 *   GET    /api/categories/tree     — lista em árvore (categoria + children)
 *   POST   /api/categories          — cria categoria ou subcategoria
 *   PUT    /api/categories/:id      — actualiza
 *   DELETE /api/categories/:id      — remove (bloqueia se tiver filhos)
 */
import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { and, eq, or, sql } from 'drizzle-orm'
import { categories } from '@previa/db'
import { getDatabase } from '../config/database.js'
import { createError } from '../middlewares/errorHandler.js'
import { requireClerkAuth } from '../middlewares/auth.js'
import { resolveOwnerId } from '../services/ownerStore.js'

const router: Router = Router()
router.use(requireClerkAuth)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Category {
  id: string
  name: string
  slug: string
  type: 'expense' | 'income'
  parentId: string | null
  isSystem: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------
const createSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['expense', 'income']),
  parentId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
})

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: z.enum(['expense', 'income']).optional(),
  parentId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toTree(flat: any[]): object[] {
  const roots = flat.filter((c) => c.parentId === null)
  const byParent = new Map<string, any[]>()
  flat.filter((c) => c.parentId !== null).forEach((c) => {
    const arr = byParent.get(c.parentId!) || []
    arr.push(c)
    byParent.set(c.parentId!, arr)
  })
  return roots
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((root) => ({
      ...root,
      children: (byParent.get(root.id) || []).sort((a, b) => a.sortOrder - b.sortOrder),
    }))
}

function visibleCategoryCondition(ownerExternalId: string) {
  return or(
    eq(categories.isSystem, true),
    eq(categories.externalOwnerId, ownerExternalId),
  )
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDatabase()
    const owner = await resolveOwnerId(req.authUser!.clerkUserId)
    const all = await db
      .select()
      .from(categories)
      .where(visibleCategoryCondition(String(owner.id)))
      .orderBy(categories.sortOrder, categories.name)
    res.json(all)
  } catch (error) {
    next(error)
  }
})

router.get('/tree', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDatabase()
    const owner = await resolveOwnerId(req.authUser!.clerkUserId)
    const all = await db
      .select()
      .from(categories)
      .where(visibleCategoryCondition(String(owner.id)))
      .orderBy(categories.sortOrder, categories.name)
    res.json(toTree(all))
  } catch (error) {
    next(error)
  }
})

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDatabase()
    const owner = await resolveOwnerId(req.authUser!.clerkUserId)
    const body = createSchema.parse(req.body)

    // Validate parentId exists if provided
    if (body.parentId) {
      const [parent] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, body.parentId), visibleCategoryCondition(String(owner.id))))
        .limit(1)
      if (!parent) {
        throw createError('Categoria pai não encontrada', 400)
      }
    }

    // Generate stable ID from slug
    const slug = slugify(body.name)
    const id = `custom-${slug}-${Date.now()}`

    await db.insert(categories).values({
      id,
      name: body.name,
      slug,
      type: body.type,
      parentId: body.parentId ?? null,
      isSystem: false,
      sortOrder: body.sortOrder ?? 50,
      externalOwnerId: String(owner.id),
    })

    const [created] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, id))
      .limit(1)

    res.status(201).json(created)
  } catch (error) {
    next(error)
  }
})

router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDatabase()
    const owner = await resolveOwnerId(req.authUser!.clerkUserId)
    const { id } = req.params
    const body = updateSchema.parse(req.body)

    // Verify category exists
    const [existing] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), visibleCategoryCondition(String(owner.id))))
      .limit(1)
    if (!existing) {
      throw createError('Categoria não encontrada', 404)
    }
    if (existing.isSystem || existing.externalOwnerId !== String(owner.id)) {
      throw createError('Categoria de sistema ou de outro usuário não pode ser alterada', 403)
    }

    // Validate parentId if provided
    if (body.parentId !== undefined && body.parentId !== null) {
      const [parent] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.id, body.parentId), visibleCategoryCondition(String(owner.id))))
        .limit(1)
      if (!parent) {
        throw createError('Categoria pai não encontrada', 400)
      }
    }

    // Keep payload strongly typed to avoid Drizzle mapper losing column types.
    const updatePayload: {
      name?: string
      slug?: string
      type?: 'expense' | 'income'
      parentId?: string | null
      sortOrder?: number
    } = {}
    if (body.name !== undefined) {
      updatePayload.name = body.name
      updatePayload.slug = slugify(body.name)
    }
    if (body.type !== undefined) {
      updatePayload.type = body.type
    }
    if (body.parentId !== undefined) {
      updatePayload.parentId = body.parentId
    }
    if (body.sortOrder !== undefined) {
      updatePayload.sortOrder = body.sortOrder
    }

    const setClauses: ReturnType<typeof sql>[] = []
    if (updatePayload.name !== undefined) {
      setClauses.push(sql`name = ${updatePayload.name}`)
    }
    if (updatePayload.slug !== undefined) {
      setClauses.push(sql`slug = ${updatePayload.slug}`)
    }
    if (updatePayload.type !== undefined) {
      setClauses.push(sql`type = ${updatePayload.type}`)
    }
    if (updatePayload.parentId !== undefined) {
      setClauses.push(sql`parent_id = ${updatePayload.parentId}`)
    }
    if (updatePayload.sortOrder !== undefined) {
      setClauses.push(sql`sort_order = ${updatePayload.sortOrder}`)
    }
    if (setClauses.length > 0) {
      setClauses.push(sql`updated_at = CURRENT_TIMESTAMP`)
      await db.execute(sql`
        UPDATE categories
        SET ${sql.join(setClauses, sql`, `)}
        WHERE id = ${id}
      `)
    }

    const [updated] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, id))
      .limit(1)

    res.json(updated)
  } catch (error) {
    next(error)
  }
})

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const db = getDatabase()
    const owner = await resolveOwnerId(req.authUser!.clerkUserId)
    const { id } = req.params

    // Verify category exists
    const [existing] = await db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), visibleCategoryCondition(String(owner.id))))
      .limit(1)
    if (!existing) {
      throw createError('Categoria não encontrada', 404)
    }
    if (existing.isSystem || existing.externalOwnerId !== String(owner.id)) {
      throw createError('Categoria de sistema ou de outro usuário não pode ser removida', 403)
    }

    // Check for child categories
    const [hasChildren] = await db
      .select({ count: categories.id })
      .from(categories)
      .where(eq(categories.parentId, id))
      .limit(1)
    if (hasChildren) {
      throw createError(
        'Não é possível deletar uma categoria com subcategorias. Remova as subcategorias primeiro.',
        400,
      )
    }

    await db.delete(categories).where(eq(categories.id, id))

    res.json({ deleted: true, id })
  } catch (error) {
    next(error)
  }
})

export { router as categoryRouter }

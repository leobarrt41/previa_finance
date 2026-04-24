/**
 * routes/categories.ts — Categories CRUD
 *
 * Suporta hierarquia: categoria → subcategoria via parentId.
 * Enquanto o banco não está conectado, usa um store em memória
 * inicializado com um seed financeiro realista.
 *
 * Endpoints:
 *   GET    /api/categories          — lista todas (flat, com parentId)
 *   GET    /api/categories/tree     — lista em árvore (categoria + children)
 *   POST   /api/categories          — cria categoria ou subcategoria
 *   PUT    /api/categories/:id      — actualiza
 *   DELETE /api/categories/:id      — remove (bloqueia se tiver filhos)
 */
import { Router, Request, Response } from 'express'
import { z } from 'zod'

const router: Router = Router()

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

function nowIso(): string {
  return new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Seed financeiro realista
// ---------------------------------------------------------------------------
const SEED: Category[] = [
  // DESPESAS
  { id: 'moradia',        name: 'Moradia',            slug: 'moradia',            type: 'expense', parentId: null,          isSystem: true, sortOrder: 10, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'aluguel',        name: 'Aluguel',             slug: 'aluguel',            type: 'expense', parentId: 'moradia',     isSystem: true, sortOrder: 11, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'condominio',     name: 'Condomínio',          slug: 'condominio',         type: 'expense', parentId: 'moradia',     isSystem: true, sortOrder: 12, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'energia',        name: 'Energia elétrica',    slug: 'energia-eletrica',   type: 'expense', parentId: 'moradia',     isSystem: true, sortOrder: 13, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'agua',           name: 'Água e esgoto',       slug: 'agua-esgoto',        type: 'expense', parentId: 'moradia',     isSystem: true, sortOrder: 14, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'internet',       name: 'Internet',            slug: 'internet',           type: 'expense', parentId: 'moradia',     isSystem: true, sortOrder: 15, createdAt: nowIso(), updatedAt: nowIso() },

  { id: 'alimentacao',    name: 'Alimentação',         slug: 'alimentacao',        type: 'expense', parentId: null,          isSystem: true, sortOrder: 20, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'supermercado',   name: 'Supermercado',        slug: 'supermercado',       type: 'expense', parentId: 'alimentacao', isSystem: true, sortOrder: 21, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'restaurante',    name: 'Restaurante',         slug: 'restaurante',        type: 'expense', parentId: 'alimentacao', isSystem: true, sortOrder: 22, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'delivery',       name: 'Delivery',            slug: 'delivery',           type: 'expense', parentId: 'alimentacao', isSystem: true, sortOrder: 23, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'padaria',        name: 'Padaria / Café',      slug: 'padaria-cafe',       type: 'expense', parentId: 'alimentacao', isSystem: true, sortOrder: 24, createdAt: nowIso(), updatedAt: nowIso() },

  { id: 'transporte',     name: 'Transporte',          slug: 'transporte',         type: 'expense', parentId: null,          isSystem: true, sortOrder: 30, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'combustivel',    name: 'Combustível',         slug: 'combustivel',        type: 'expense', parentId: 'transporte',  isSystem: true, sortOrder: 31, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'uber',           name: 'Uber / Táxi',         slug: 'uber-taxi',          type: 'expense', parentId: 'transporte',  isSystem: true, sortOrder: 32, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'transporte-pub', name: 'Transporte público',  slug: 'transporte-publico', type: 'expense', parentId: 'transporte',  isSystem: true, sortOrder: 33, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'estacionamento', name: 'Estacionamento',      slug: 'estacionamento',     type: 'expense', parentId: 'transporte',  isSystem: true, sortOrder: 34, createdAt: nowIso(), updatedAt: nowIso() },

  { id: 'saude',          name: 'Saúde',               slug: 'saude',              type: 'expense', parentId: null,          isSystem: true, sortOrder: 40, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'plano-saude',    name: 'Plano de saúde',      slug: 'plano-saude',        type: 'expense', parentId: 'saude',       isSystem: true, sortOrder: 41, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'farmacia',       name: 'Farmácia',            slug: 'farmacia',           type: 'expense', parentId: 'saude',       isSystem: true, sortOrder: 42, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'consulta',       name: 'Consultas',           slug: 'consultas',          type: 'expense', parentId: 'saude',       isSystem: true, sortOrder: 43, createdAt: nowIso(), updatedAt: nowIso() },

  { id: 'educacao',       name: 'Educação',            slug: 'educacao',           type: 'expense', parentId: null,          isSystem: true, sortOrder: 50, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'mensalidade',    name: 'Mensalidade escolar', slug: 'mensalidade-escolar',type: 'expense', parentId: 'educacao',    isSystem: true, sortOrder: 51, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'cursos',         name: 'Cursos / Livros',     slug: 'cursos-livros',      type: 'expense', parentId: 'educacao',    isSystem: true, sortOrder: 52, createdAt: nowIso(), updatedAt: nowIso() },

  { id: 'lazer',          name: 'Lazer',               slug: 'lazer',              type: 'expense', parentId: null,          isSystem: true, sortOrder: 60, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'streaming',      name: 'Streaming',           slug: 'streaming',          type: 'expense', parentId: 'lazer',       isSystem: true, sortOrder: 61, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'viagem',         name: 'Viagem',              slug: 'viagem',             type: 'expense', parentId: 'lazer',       isSystem: true, sortOrder: 62, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'cinema',         name: 'Cinema / Shows',      slug: 'cinema-shows',       type: 'expense', parentId: 'lazer',       isSystem: true, sortOrder: 63, createdAt: nowIso(), updatedAt: nowIso() },

  { id: 'financeiro',     name: 'Financeiro',          slug: 'financeiro',         type: 'expense', parentId: null,          isSystem: true, sortOrder: 70, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'fatura-cartao',  name: 'Fatura de cartão',    slug: 'fatura-cartao',      type: 'expense', parentId: 'financeiro',  isSystem: true, sortOrder: 71, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'juros',          name: 'Juros / IOF',         slug: 'juros-iof',          type: 'expense', parentId: 'financeiro',  isSystem: true, sortOrder: 72, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'seguro',         name: 'Seguros',             slug: 'seguros',            type: 'expense', parentId: 'financeiro',  isSystem: true, sortOrder: 73, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'imposto',        name: 'Impostos / Taxas',    slug: 'impostos-taxas',     type: 'expense', parentId: 'financeiro',  isSystem: true, sortOrder: 74, createdAt: nowIso(), updatedAt: nowIso() },

  { id: 'outros-desp',    name: 'Outros (despesa)',    slug: 'outros-despesa',     type: 'expense', parentId: null,          isSystem: true, sortOrder: 99, createdAt: nowIso(), updatedAt: nowIso() },

  // RECEITAS
  { id: 'salario',        name: 'Salário',             slug: 'salario',            type: 'income',  parentId: null,          isSystem: true, sortOrder: 10, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'salario-clt',    name: 'Salário CLT',         slug: 'salario-clt',        type: 'income',  parentId: 'salario',     isSystem: true, sortOrder: 11, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'salario-pj',     name: 'Salário PJ',          slug: 'salario-pj',         type: 'income',  parentId: 'salario',     isSystem: true, sortOrder: 12, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'freelance',      name: 'Freelance',           slug: 'freelance',          type: 'income',  parentId: 'salario',     isSystem: true, sortOrder: 13, createdAt: nowIso(), updatedAt: nowIso() },

  { id: 'rendimentos',    name: 'Rendimentos',         slug: 'rendimentos',        type: 'income',  parentId: null,          isSystem: true, sortOrder: 20, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'dividendos',     name: 'Dividendos',          slug: 'dividendos',         type: 'income',  parentId: 'rendimentos', isSystem: true, sortOrder: 21, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'juros-rec',      name: 'Juros recebidos',     slug: 'juros-recebidos',    type: 'income',  parentId: 'rendimentos', isSystem: true, sortOrder: 22, createdAt: nowIso(), updatedAt: nowIso() },
  { id: 'aluguel-rec',    name: 'Aluguel recebido',    slug: 'aluguel-recebido',   type: 'income',  parentId: 'rendimentos', isSystem: true, sortOrder: 23, createdAt: nowIso(), updatedAt: nowIso() },

  { id: 'outros-rec',     name: 'Outros (receita)',    slug: 'outros-receita',     type: 'income',  parentId: null,          isSystem: true, sortOrder: 99, createdAt: nowIso(), updatedAt: nowIso() },
]

const store: Map<string, Category> = new Map(SEED.map((c) => [c.id, c]))

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
function toTree(flat: Category[]): object[] {
  const roots = flat.filter((c) => c.parentId === null)
  const byParent = new Map<string, Category[]>()
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

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
router.get('/', (_req: Request, res: Response) => {
  const all = Array.from(store.values()).sort((a, b) => a.sortOrder - b.sortOrder)
  res.json(all)
})

router.get('/tree', (_req: Request, res: Response) => {
  const all = Array.from(store.values())
  res.json(toTree(all))
})

router.post('/', (req: Request, res: Response) => {
  const body = createSchema.parse(req.body)
  if (body.parentId && !store.has(body.parentId)) {
    res.status(400).json({ error: 'parentId not found' }); return
  }
  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const category: Category = {
    id,
    name: body.name,
    slug: slugify(body.name),
    type: body.type,
    parentId: body.parentId ?? null,
    isSystem: false,
    sortOrder: body.sortOrder ?? 50,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  store.set(id, category)
  res.status(201).json(category)
})

router.put('/:id', (req: Request, res: Response) => {
  const { id } = req.params
  const existing = store.get(id)
  if (!existing) { res.status(404).json({ error: 'Category not found' }); return }
  const body = updateSchema.parse(req.body)
  if (body.parentId && !store.has(body.parentId)) {
    res.status(400).json({ error: 'parentId not found' }); return
  }
  const updated: Category = {
    ...existing,
    ...(body.name !== undefined && { name: body.name, slug: slugify(body.name) }),
    ...(body.type !== undefined && { type: body.type }),
    ...(body.parentId !== undefined && { parentId: body.parentId }),
    ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
    updatedAt: nowIso(),
  }
  store.set(id, updated)
  res.json(updated)
})

router.delete('/:id', (req: Request, res: Response) => {
  const { id } = req.params
  if (!store.has(id)) { res.status(404).json({ error: 'Category not found' }); return }
  const hasChildren = Array.from(store.values()).some((c) => c.parentId === id)
  if (hasChildren) {
    res.status(400).json({ error: 'Cannot delete category with subcategories. Remove subcategories first.' })
    return
  }
  store.delete(id)
  res.json({ deleted: true, id })
})

export { router as categoryRouter }

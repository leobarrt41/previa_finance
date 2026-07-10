export interface CategoryLike {
  id: string
  name: string
  type: string
  parentId: string | null
  sortOrder?: number | null
}

export interface CategoryOption {
  id: string
  label: string
  disabled: boolean
}

function compareCategories(a: CategoryLike, b: CategoryLike) {
  const sortA = a.sortOrder ?? 50
  const sortB = b.sortOrder ?? 50
  if (sortA !== sortB) return sortA - sortB
  return a.name.localeCompare(b.name)
}

function buildIndentedLabel(name: string, depth: number): string {
  if (depth <= 0) return name
  return `${'  '.repeat(depth)}└ ${name}`
}

export function buildCategoryOptions(
  categories: CategoryLike[],
  type: 'expense' | 'income',
): CategoryOption[] {
  const filtered = categories.filter((category) => category.type === type)
  const childrenByParent = new Map<string | null, CategoryLike[]>()
  const byId = new Map(filtered.map((category) => [category.id, category]))

  for (const category of filtered) {
    const key = category.parentId ?? null
    const list = childrenByParent.get(key) ?? []
    list.push(category)
    childrenByParent.set(key, list)
  }

  const visited = new Set<string>()
  const options: CategoryOption[] = []

  function walk(parentId: string | null, depth: number) {
    const siblings = [...(childrenByParent.get(parentId) ?? [])].sort(compareCategories)

    for (const category of siblings) {
      if (visited.has(category.id)) continue
      visited.add(category.id)

      const hasChildren = (childrenByParent.get(category.id) ?? []).length > 0
      options.push({
        id: category.id,
        label: buildIndentedLabel(category.name, depth),
        disabled: hasChildren,
      })

      walk(category.id, depth + 1)
    }
  }

  walk(null, 0)

  // Fallback: if a category is orphaned (parent not present in the filtered set),
  // surface it at root so it is not hidden from the user.
  for (const category of filtered) {
    if (visited.has(category.id)) continue
    const hasChildren = (childrenByParent.get(category.id) ?? []).length > 0
    options.push({
      id: category.id,
      label: buildIndentedLabel(category.name, 0),
      disabled: hasChildren,
    })
    visited.add(category.id)
    walk(category.id, 1)
  }

  return options
}

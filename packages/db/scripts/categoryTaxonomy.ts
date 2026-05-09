export type CategoryTaxonomyType = "expense" | "income";

export type CategoryTaxonomyDef = {
  id: string;
  name: string;
  slug: string;
  type: CategoryTaxonomyType;
  sortOrder: number;
  parentId?: string;
};

// Single canonical source for the full built-in taxonomy used by the app.
// The SQL migration 0007 remains a minimal bootstrap only.
const topLevel: Array<{ name: string; type: CategoryTaxonomyType; sortOrder: number }> = [
  { name: "Transporte", type: "expense", sortOrder: 10 },
  { name: "Alimentação", type: "expense", sortOrder: 20 },
  { name: "Moradia", type: "expense", sortOrder: 30 },
  { name: "Saúde", type: "expense", sortOrder: 40 },
  { name: "Educação", type: "expense", sortOrder: 50 },
  { name: "Lazer", type: "expense", sortOrder: 60 },
  { name: "Outros", type: "expense", sortOrder: 999 },
  { name: "Salário", type: "income", sortOrder: 10 },
];

const children: Record<string, string[]> = {
  Transporte: [
    "combustível",
    "manutenção",
    "pedágio",
    "estacionamento",
    "transporte público",
    "app de corrida",
  ],
  "Alimentação": [
    "supermercado",
    "restaurante",
    "delivery",
    "café e lanches",
    "feira",
  ],
  Moradia: [
    "aluguel",
    "condomínio",
    "energia",
    "água",
    "internet",
    "gás",
    "manutenção doméstica",
  ],
  Saúde: [
    "plano de saúde",
    "farmácia",
    "consulta",
    "exames",
    "dentista",
  ],
  Educação: [
    "cursos",
    "livros",
    "mensalidade",
    "material escolar",
  ],
  Lazer: [
    "cinema",
    "streaming",
    "viagens",
    "hobbies",
    "eventos",
  ],
  Outros: [
    "taxas",
    "tarifas bancárias",
    "doações",
    "presentes",
    "impostos",
  ],
};

const legacyChildIds: Record<string, string> = {
  "educacao:cursos": "cursos",
};

export function slugifyCategoryName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function buildSystemCategoryTaxonomy(): CategoryTaxonomyDef[] {
  const cats: CategoryTaxonomyDef[] = [];

  for (const parent of topLevel) {
    const slug = slugifyCategoryName(parent.name);
    cats.push({
      id: slug,
      name: parent.name,
      slug,
      type: parent.type,
      sortOrder: parent.sortOrder,
    });

    const subs = children[parent.name] || [];
    for (const sub of subs) {
      const subSlug = slugifyCategoryName(sub);
      const childKey = `${slug}:${subSlug}`;
      const childId = legacyChildIds[childKey] ?? `${slug}-${subSlug}`;
      cats.push({
        id: childId,
        name: sub,
        slug: subSlug,
        type: parent.type,
        sortOrder: parent.sortOrder + 1,
        parentId: slug,
      });
    }
  }

  return cats;
}

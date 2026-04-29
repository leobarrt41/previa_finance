import mysql from "mysql2/promise";

// lightweight ambient declarations to avoid requiring @types/node in this
// package (this script is intended to be run via node directly)
declare const process: any;
declare const require: any;
declare const module: any;

// Simple slugify: lower-case, replace spaces and accented chars, keep ASCII letters/numbers and hyphens
const slugify = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

type CatDef = {
  id: string;
  name: string;
  slug: string;
  type: "expense" | "income";
  sortOrder: number;
  parentId?: string;
};

const topLevel: Array<{ name: string; type: "expense" | "income"; sortOrder: number }> = [
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

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required (mysql connection string)");
    process.exit(1);
  }

  const pool = await mysql.createPool(url);

  try {
    const cats: CatDef[] = [];

    // top-level
    for (const parent of topLevel) {
      const slug = slugify(parent.name);
      cats.push({
        id: slug,
        name: parent.name,
        slug,
        type: parent.type,
        sortOrder: parent.sortOrder,
      });

      const subs = children[parent.name] || [];
      for (const sub of subs) {
        const subSlug = slugify(sub);
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

    // Insert with ON DUPLICATE KEY UPDATE for idempotency
    const insertSql = `
      INSERT INTO categories (id, name, slug, type, parent_id, is_system, sort_order, external_owner_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, NULL, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        slug = VALUES(slug),
        type = VALUES(type),
        parent_id = VALUES(parent_id),
        is_system = VALUES(is_system),
        sort_order = VALUES(sort_order),
        external_owner_id = VALUES(external_owner_id),
        updated_at = NOW();
    `;

    for (const c of cats) {
      const params = [c.id, c.name, c.slug, c.type, c.parentId ?? null, c.sortOrder];
      await (pool as any).execute(insertSql, params);
      console.log("Upserted category:", c.id, c.name);
    }

    console.log("Seeding completed.");
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export {};

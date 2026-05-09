import mysql from "mysql2/promise";
import { buildSystemCategoryTaxonomy } from "./categoryTaxonomy";

// lightweight ambient declarations to avoid requiring @types/node in this
// package (this script is intended to be run via node directly)
declare const process: any;
declare const require: any;
declare const module: any;

type CatDef = {
  id: string;
  name: string;
  slug: string;
  type: "expense" | "income";
  sortOrder: number;
  parentId?: string;
};

async function main() {
  const pool = process.env.DATABASE_URL
    ? await mysql.createPool(process.env.DATABASE_URL)
    : await mysql.createPool({
        host: process.env.DB_HOST ?? "localhost",
        port: parseInt(process.env.DB_PORT ?? "3306", 10),
        user: process.env.DB_USERNAME ?? "root",
        password: process.env.DB_PASSWORD ?? "",
        database: process.env.DB_NAME ?? "previa_finance",
        timezone: "+00:00",
      });

  try {
    const cats: CatDef[] = buildSystemCategoryTaxonomy();

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

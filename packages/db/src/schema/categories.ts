import {
  mysqlTable,
  varchar,
  boolean,
  int,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

/**
 * categories.ts — hierarchical categories for financial domain
 * - id: VARCHAR primary key (flexible, supports UUIDs)
 * - parentId: nullable VARCHAR referencing categories.id (no FK enforced)
 * - externalOwnerId: nullable VARCHAR used only as an external reference (no FK)
 */
export const categories = mysqlTable(
  "categories",
  {
    id: varchar("id", { length: 128 }).notNull().primaryKey(),

    name: varchar("name", { length: 200 }).notNull(),
    slug: varchar("slug", { length: 200 }).notNull(),
    type: varchar("type", { length: 50 }).notNull(), // expense | income

    parentId: varchar("parent_id", { length: 128 }),

    isSystem: boolean("is_system").notNull().default(true),
    sortOrder: int("sort_order").notNull().default(0),

    /**
     * Quando true, esta categoria representa um movimento financeiro que não é
     * gasto de consumo (ex: pagamento de fatura, transferência).
     * Deve ser excluída dos relatórios de gastos por categoria mas incluída
     * no fluxo de caixa.
     */
    isNonConsumptionExpense: boolean("is_non_consumption_expense").notNull().default(false),

    externalOwnerId: varchar("external_owner_id", { length: 255 }),

    createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    index("idx_categories_parent_id").on(t.parentId),
    index("idx_categories_type").on(t.type),
    index("idx_categories_external_owner").on(t.externalOwnerId),
    index("idx_categories_slug").on(t.slug),
    // Practical uniqueness: prevent duplicate slugs per owner. Note: MySQL
    // allows multiple NULLs in a UNIQUE index, so system categories (externalOwnerId = NULL)
    // must be deduplicated at the application layer or by using a sentinel owner id.
    uniqueIndex("uq_categories_owner_slug").on(t.externalOwnerId, t.slug),
  ],
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;

import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration for Previa Finance.
 *
 * Environment variables required:
 *   DATABASE_URL — MySQL 8+ connection string
 *   Example: mysql://user:password@localhost:3306/previa_finance
 *
 * Usage:
 *   pnpm db:generate   — generate SQL migrations from schema changes
 *   pnpm db:migrate    — apply pending migrations to the database
 *   pnpm db:studio     — open Drizzle Studio for visual inspection
 */
export default defineConfig({
  dialect: "mysql",
  schema: "./src/schema.ts",
  out: "./migrations/v3",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "",
  },
  // Verbose output helps during development
  verbose: true,
  strict: true,
});

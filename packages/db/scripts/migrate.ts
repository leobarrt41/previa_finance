#!/usr/bin/env tsx
/**
 * scripts/migrate.ts — SQL migration runner for Previa Finance
 *
 * Tracks applied migrations in a `schema_migrations` table.
 * Reads all *.sql files from the migrations/ directory in sorted order
 * and applies only those not yet recorded.
 *
 * Usage:
 *   pnpm db:setup            — apply all pending migrations
 *   pnpm db:setup --bootstrap — mark 0001-0005 as applied without re-running
 *                               (use on DBs that were set up manually)
 *
 * Environment variables (same as API):
 *   DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_NAME
 */

import mysql from 'mysql2/promise'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations')

// ── DB connection ─────────────────────────────────────────────────────────────
async function connect() {
  return mysql.createConnection({
    host:     process.env.DB_HOST     ?? 'localhost',
    port:     parseInt(process.env.DB_PORT ?? '3306', 10),
    user:     process.env.DB_USERNAME ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME     ?? 'previa_finance',
    multipleStatements: true,   // required for files with multiple statements
    timezone: '+00:00',
  })
}

// ── schema_migrations table ───────────────────────────────────────────────────
async function ensureTrackingTable(conn: mysql.Connection) {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration  VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (migration)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
}

async function appliedMigrations(conn: mysql.Connection): Promise<Set<string>> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    'SELECT migration FROM schema_migrations ORDER BY migration'
  )
  return new Set(rows.map((r) => r.migration as string))
}

async function markApplied(conn: mysql.Connection, name: string) {
  await conn.execute(
    'INSERT IGNORE INTO schema_migrations (migration) VALUES (?)',
    [name]
  )
}

// ── migration files ───────────────────────────────────────────────────────────
function listMigrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
}

// ── bootstrap mode ────────────────────────────────────────────────────────────
// Marks the given files as applied WITHOUT executing them.
// Use when the DB was created manually (0001-0005 applied outside the runner).
async function bootstrap(conn: mysql.Connection, files: string[]) {
  const already = await appliedMigrations(conn)
  let count = 0
  for (const f of files) {
    if (!already.has(f)) {
      await markApplied(conn, f)
      console.log(`  ✓ bootstrapped ${f}`)
      count++
    } else {
      console.log(`  — already recorded ${f}`)
    }
  }
  console.log(`\nBootstrapped ${count} migration(s).`)
}

// ── apply mode ────────────────────────────────────────────────────────────────
async function applyPending(conn: mysql.Connection, files: string[]) {
  const already = await appliedMigrations(conn)
  const pending = files.filter((f) => !already.has(f))

  if (pending.length === 0) {
    console.log('✅  No pending migrations.')
    return
  }

  console.log(`Found ${pending.length} pending migration(s):\n`)

  for (const file of pending) {
    const filePath = path.join(MIGRATIONS_DIR, file)
    const sql = fs.readFileSync(filePath, 'utf8')

    process.stdout.write(`  ▶  ${file} … `)
    try {
      await conn.query(sql)
      await markApplied(conn, file)
      console.log('✓')
    } catch (err) {
      console.log('✗')
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`\n  ERROR in ${file}:\n  ${msg}\n`)
      process.exit(1)
    }
  }

  console.log(`\n✅  ${pending.length} migration(s) applied successfully.`)
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  const isBootstrap = process.argv.includes('--bootstrap')
  const conn = await connect()

  try {
    await ensureTrackingTable(conn)
    const files = listMigrationFiles()

    console.log(`\nPrevia Finance — DB migration runner`)
    console.log(`Database : ${process.env.DB_NAME ?? 'previa_finance'}`)
    console.log(`Mode     : ${isBootstrap ? 'bootstrap (mark-only)' : 'apply'}`)
    console.log(`Files    : ${files.length} found in migrations/\n`)

    if (isBootstrap) {
      await bootstrap(conn, files)
    } else {
      await applyPending(conn, files)
    }
  } finally {
    await conn.end()
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})

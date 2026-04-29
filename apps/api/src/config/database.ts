/**
 * database.ts - Database connection setup
 */

import mysql from 'mysql2/promise'
import { drizzle } from 'drizzle-orm/mysql2'
import * as schema from '@previa/db'
import { config } from './env.js'

let db: ReturnType<typeof drizzle>

const REQUIRED_TABLES = [
  'financial_connections',
  'financial_connection_consents',
  'accounts',
  'categories',
  'transactions',
  'card_invoices',
  'card_transactions',
  'card_invoice_payments',
  'investments',
  'investment_transactions',
  'provider_webhook_events',
  'sync_runs',
] as const

async function assertSchemaIsReady(connection: mysql.Connection) {
  const placeholders = REQUIRED_TABLES.map(() => '?').join(', ')
  const sql = `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = ?
      AND table_name IN (${placeholders})
  `

  const [rows] = await connection.query<mysql.RowDataPacket[]>(sql, [
    config.database.database,
    ...REQUIRED_TABLES,
  ])

  const existing = new Set(rows.map((row) => String(row.TABLE_NAME ?? row.table_name)))
  const missing = REQUIRED_TABLES.filter((tableName) => !existing.has(tableName))

  if (missing.length > 0) {
    throw new Error(
      [
        `Database schema is outdated for \"${config.database.database}\".`,
        `Missing tables: ${missing.join(', ')}.`,
        'Run migrations: pnpm --filter @previa/db db:setup',
      ].join(' '),
    )
  }
}

export async function setupDatabase() {
  const connection = await mysql.createConnection({
    host: config.database.host,
    port: config.database.port,
    user: config.database.username,
    password: config.database.password,
    database: config.database.database,
    timezone: '+00:00' // UTC
  })

  db = drizzle(connection, { schema, mode: 'default' })
  
  // Test connection
  await connection.execute('SELECT 1')
  await assertSchemaIsReady(connection)
  
  return db
}

export function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call setupDatabase() first.')
  }
  return db
}
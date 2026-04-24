/**
 * database.ts - Database connection setup
 */

import mysql from 'mysql2/promise'
import { drizzle } from 'drizzle-orm/mysql2'
import * as schema from '@previa/db'
import { config } from './env.js'

let db: ReturnType<typeof drizzle>

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
  
  return db
}

export function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call setupDatabase() first.')
  }
  return db
}
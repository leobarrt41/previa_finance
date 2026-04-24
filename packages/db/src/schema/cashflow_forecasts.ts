import { mysqlTable, varchar, timestamp, text, bigint, index } from 'drizzle-orm/mysql-core'
import { sql } from 'drizzle-orm'

export const cashflowForecasts = mysqlTable('cashflow_forecasts', {
  id: varchar('id', { length: 128 }).notNull().primaryKey(),
  externalOwnerId: varchar('external_owner_id', { length: 255 }),
  competencyMonth: varchar('competency_month', { length: 7 }).notNull(),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
  recurrence: varchar('recurrence', { length: 20 }).notNull().default('one-time'),
  recurrenceEnd: varchar('recurrence_end', { length: 7 }),
  description: text('description'),
  createdBy: varchar('created_by', { length: 128 }),
  createdAt: timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
})

export type CashflowForecast = typeof cashflowForecasts.$inferSelect
export type NewCashflowForecast = typeof cashflowForecasts.$inferInsert

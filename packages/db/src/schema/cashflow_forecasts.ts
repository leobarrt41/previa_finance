import { mysqlTable, varchar, timestamp, text, bigint, index, boolean, int, primaryKey } from 'drizzle-orm/mysql-core'
import { sql } from 'drizzle-orm'

export const cashflowForecasts = mysqlTable('cashflow_forecasts', {
  id: varchar('id', { length: 128 }).notNull().primaryKey(),
  userId: int('user_id').notNull(),
  externalOwnerId: varchar('external_owner_id', { length: 255 }),
  competencyMonth: varchar('competency_month', { length: 7 }).notNull(),
  amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
  recurrence: varchar('recurrence', { length: 20 }).notNull().default('one-time'),
  recurrenceEnd: varchar('recurrence_end', { length: 7 }),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: varchar('created_by', { length: 128 }),
  createdAt: timestamp('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`).$onUpdate(() => sql`CURRENT_TIMESTAMP`),
}, (t) => [
  index('idx_cashflow_forecasts_user').on(t.userId),
  index('idx_cashflow_forecasts_month').on(t.competencyMonth),
])

export const cashflowForecastMonthStatus = mysqlTable('cashflow_forecast_month_status', {
  forecastId: varchar('forecast_id', { length: 128 }).notNull(),
  userId: int('user_id').notNull(),
  competencyMonth: varchar('competency_month', { length: 7 }).notNull(),
  isPaid: boolean('is_paid').notNull().default(false),
  updatedAt: timestamp('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`).$onUpdate(() => sql`CURRENT_TIMESTAMP`),
}, (t) => [
  primaryKey({ columns: [t.forecastId, t.competencyMonth] }),
  index('idx_cashflow_fc_month_status_user').on(t.userId),
])

export type CashflowForecast = typeof cashflowForecasts.$inferSelect
export type NewCashflowForecast = typeof cashflowForecasts.$inferInsert
export type CashflowForecastMonthStatus = typeof cashflowForecastMonthStatus.$inferSelect
export type NewCashflowForecastMonthStatus = typeof cashflowForecastMonthStatus.$inferInsert

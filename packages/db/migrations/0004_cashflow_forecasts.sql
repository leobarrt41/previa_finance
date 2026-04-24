-- Migration: add cashflow_forecasts table

CREATE TABLE IF NOT EXISTS cashflow_forecasts (
  id VARCHAR(128) PRIMARY KEY,
  external_owner_id VARCHAR(255) NULL,
  competency_month CHAR(7) NOT NULL,
  amount_minor BIGINT NOT NULL,
  recurrence VARCHAR(20) NOT NULL DEFAULT 'one-time',
  recurrence_end CHAR(7) NULL,
  description TEXT NULL,
  created_by VARCHAR(128) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- rollback
-- DROP TABLE IF EXISTS cashflow_forecasts;

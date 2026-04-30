-- Migration: recurring cashflow persistence + paid month control

CREATE TABLE IF NOT EXISTS cashflow_forecasts (
  id VARCHAR(128) PRIMARY KEY,
  user_id INT NOT NULL,
  external_owner_id VARCHAR(255) NULL,
  competency_month CHAR(7) NOT NULL,
  amount_minor BIGINT NOT NULL,
  recurrence VARCHAR(20) NOT NULL DEFAULT 'one-time',
  recurrence_end CHAR(7) NULL,
  description TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by VARCHAR(128) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

SET @add_user_id = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE cashflow_forecasts ADD COLUMN user_id INT NULL',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'cashflow_forecasts'
    AND column_name = 'user_id'
);
PREPARE stmt FROM @add_user_id;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_is_active = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE cashflow_forecasts ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'cashflow_forecasts'
    AND column_name = 'is_active'
);
PREPARE stmt FROM @add_is_active;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_updated_at = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE cashflow_forecasts ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'cashflow_forecasts'
    AND column_name = 'updated_at'
);
PREPARE stmt FROM @add_updated_at;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_fc_user = (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE INDEX idx_cashflow_forecasts_user ON cashflow_forecasts(user_id)',
    'SELECT 1'
  )
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'cashflow_forecasts'
    AND index_name = 'idx_cashflow_forecasts_user'
);
PREPARE stmt FROM @idx_fc_user;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_fc_month = (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE INDEX idx_cashflow_forecasts_month ON cashflow_forecasts(competency_month)',
    'SELECT 1'
  )
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'cashflow_forecasts'
    AND index_name = 'idx_cashflow_forecasts_month'
);
PREPARE stmt FROM @idx_fc_month;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS cashflow_forecast_month_status (
  forecast_id VARCHAR(128) NOT NULL,
  user_id INT NOT NULL,
  competency_month CHAR(7) NOT NULL,
  is_paid BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (forecast_id, competency_month)
);

SET @idx_fc_month_status_user = (
  SELECT IF(
    COUNT(*) = 0,
    'CREATE INDEX idx_cashflow_fc_month_status_user ON cashflow_forecast_month_status(user_id)',
    'SELECT 1'
  )
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'cashflow_forecast_month_status'
    AND index_name = 'idx_cashflow_fc_month_status_user'
);
PREPARE stmt FROM @idx_fc_month_status_user;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

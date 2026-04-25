-- =============================================================================
-- Migration 0006 — Schema v4: column renames
-- Previa Finance
--
-- Changes introduced in schema v4:
--   1. `currency`  → `currency_code`  (accounts, transactions,
--      card_transactions, investments, investment_transactions)
--      Reason: naming consistency — every monetary field now carries its unit
--      explicitly (amount_minor / currency_code pairs).
--
--   2. `date`      → `occurred_at`    (transactions, card_transactions)
--      Reason: `date` is a MySQL reserved word and was semantically ambiguous.
--
-- Idempotency: each block checks information_schema before renaming, so the
-- migration is safe to run on both fresh databases (columns still have old
-- names) and databases that were already patched manually (columns already
-- have new names).  Uses PREPARE/EXECUTE to avoid DELIMITER syntax, which is
-- unsupported via the Node mysql2 driver.
-- =============================================================================

-- ─── accounts: currency → currency_code ──────────────────────────────────────
SET @_sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'accounts' AND COLUMN_NAME = 'currency') > 0,
  "ALTER TABLE `accounts` CHANGE `currency` `currency_code` VARCHAR(3) NOT NULL DEFAULT 'BRL'",
  'SELECT 1'
);
PREPARE _stmt FROM @_sql; EXECUTE _stmt; DEALLOCATE PREPARE _stmt;

-- ─── transactions: currency → currency_code ───────────────────────────────────
SET @_sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactions' AND COLUMN_NAME = 'currency') > 0,
  "ALTER TABLE `transactions` CHANGE `currency` `currency_code` VARCHAR(3) NOT NULL DEFAULT 'BRL'",
  'SELECT 1'
);
PREPARE _stmt FROM @_sql; EXECUTE _stmt; DEALLOCATE PREPARE _stmt;

-- ─── card_transactions: currency → currency_code ─────────────────────────────
SET @_sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'card_transactions' AND COLUMN_NAME = 'currency') > 0,
  "ALTER TABLE `card_transactions` CHANGE `currency` `currency_code` VARCHAR(3) NOT NULL DEFAULT 'BRL'",
  'SELECT 1'
);
PREPARE _stmt FROM @_sql; EXECUTE _stmt; DEALLOCATE PREPARE _stmt;

-- ─── investments: currency → currency_code ───────────────────────────────────
SET @_sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'investments' AND COLUMN_NAME = 'currency') > 0,
  "ALTER TABLE `investments` CHANGE `currency` `currency_code` VARCHAR(3) NOT NULL DEFAULT 'BRL'",
  'SELECT 1'
);
PREPARE _stmt FROM @_sql; EXECUTE _stmt; DEALLOCATE PREPARE _stmt;

-- ─── investment_transactions: currency → currency_code ───────────────────────
SET @_sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'investment_transactions' AND COLUMN_NAME = 'currency') > 0,
  "ALTER TABLE `investment_transactions` CHANGE `currency` `currency_code` VARCHAR(3) NOT NULL DEFAULT 'BRL'",
  'SELECT 1'
);
PREPARE _stmt FROM @_sql; EXECUTE _stmt; DEALLOCATE PREPARE _stmt;

-- ─── transactions: date → occurred_at ────────────────────────────────────────
SET @_sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transactions' AND COLUMN_NAME = 'date') > 0,
  'ALTER TABLE `transactions` CHANGE `date` `occurred_at` TIMESTAMP NOT NULL',
  'SELECT 1'
);
PREPARE _stmt FROM @_sql; EXECUTE _stmt; DEALLOCATE PREPARE _stmt;

-- ─── card_transactions: date → occurred_at ───────────────────────────────────
SET @_sql = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'card_transactions' AND COLUMN_NAME = 'date') > 0,
  'ALTER TABLE `card_transactions` CHANGE `date` `occurred_at` TIMESTAMP NOT NULL',
  'SELECT 1'
);
PREPARE _stmt FROM @_sql; EXECUTE _stmt; DEALLOCATE PREPARE _stmt;

-- rollback (only run manually if needed):
-- ALTER TABLE `accounts`                CHANGE `currency_code` `currency` VARCHAR(3) NOT NULL DEFAULT 'BRL';
-- ALTER TABLE `transactions`            CHANGE `currency_code` `currency` VARCHAR(3) NOT NULL DEFAULT 'BRL';
-- ALTER TABLE `card_transactions`       CHANGE `currency_code` `currency` VARCHAR(3) NOT NULL DEFAULT 'BRL';
-- ALTER TABLE `investments`             CHANGE `currency_code` `currency` VARCHAR(3) NOT NULL DEFAULT 'BRL';
-- ALTER TABLE `investment_transactions` CHANGE `currency_code` `currency` VARCHAR(3) NOT NULL DEFAULT 'BRL';
-- ALTER TABLE `transactions`            CHANGE `occurred_at` `date` TIMESTAMP NOT NULL;
-- ALTER TABLE `card_transactions`       CHANGE `occurred_at` `date` TIMESTAMP NOT NULL;

-- =============================================================================
-- Migration 0007 — create categories table (v4)
-- Previa Finance
--
-- Problem solved:
--   Some environments have category_id columns already migrated to VARCHAR,
--   but the `categories` table itself is missing, causing API crashes on
--   invoice import when validating category ids.
--
-- Strategy:
--   1) Create `categories` if it does not exist.
--   2) Seed a minimal system taxonomy idempotently with INSERT IGNORE.
-- =============================================================================

CREATE TABLE IF NOT EXISTS `categories` (
  `id`                VARCHAR(128) NOT NULL,
  `name`              VARCHAR(200) NOT NULL,
  `slug`              VARCHAR(200) NOT NULL,
  `type`              VARCHAR(50)  NOT NULL,
  `parent_id`         VARCHAR(128) NULL,
  `is_system`         BOOLEAN      NOT NULL DEFAULT TRUE,
  `sort_order`        INT          NOT NULL DEFAULT 0,
  `external_owner_id` VARCHAR(255) NULL,
  `created_at`        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  INDEX `idx_categories_parent_id` (`parent_id`),
  INDEX `idx_categories_type` (`type`),
  INDEX `idx_categories_external_owner` (`external_owner_id`),
  INDEX `idx_categories_slug` (`slug`),
  UNIQUE INDEX `uq_categories_owner_slug` (`external_owner_id`, `slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Minimal default system categories used by import flows
INSERT IGNORE INTO `categories`
  (`id`, `name`, `slug`, `type`, `parent_id`, `is_system`, `sort_order`, `external_owner_id`)
VALUES
  ('transporte', 'Transporte', 'transporte', 'expense', NULL, TRUE, 10, NULL),
  ('alimentacao', 'Alimentação', 'alimentacao', 'expense', NULL, TRUE, 20, NULL),
  ('moradia', 'Moradia', 'moradia', 'expense', NULL, TRUE, 30, NULL),
  ('saude', 'Saúde', 'saude', 'expense', NULL, TRUE, 40, NULL),
  ('educacao', 'Educação', 'educacao', 'expense', NULL, TRUE, 50, NULL),
  ('cursos', 'Cursos', 'cursos', 'expense', 'educacao', TRUE, 51, NULL),
  ('lazer', 'Lazer', 'lazer', 'expense', NULL, TRUE, 60, NULL),
  ('salario', 'Salário', 'salario', 'income', NULL, TRUE, 10, NULL),
  ('outros', 'Outros', 'outros', 'expense', NULL, TRUE, 999, NULL);

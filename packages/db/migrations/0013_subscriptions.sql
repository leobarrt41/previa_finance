-- Migration 0013: Sistema de assinaturas com trial e Stripe
-- Criado em: 2026-05-31

CREATE TABLE IF NOT EXISTS `subscriptions` (
  `id`                      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `clerk_user_id`           VARCHAR(255) NOT NULL,
  `plan`                    VARCHAR(50) NOT NULL DEFAULT 'monthly',
  `status`                  ENUM('trialing','active','past_due','canceled','expired') NOT NULL DEFAULT 'trialing',
  `trial_started_at`        DATETIME NOT NULL,
  `trial_ends_at`           DATETIME NOT NULL,
  `current_period_start`    DATETIME NULL,
  `current_period_end`      DATETIME NULL,
  `canceled_at`             DATETIME NULL,
  `stripe_customer_id`      VARCHAR(255) NULL,
  `stripe_subscription_id`  VARCHAR(255) NULL,
  `stripe_price_id`         VARCHAR(255) NULL,
  `created_at`              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_subscriptions_clerk_user` (`clerk_user_id`),
  KEY `idx_subscriptions_status` (`status`),
  KEY `idx_subscriptions_stripe_customer` (`stripe_customer_id`),
  KEY `idx_subscriptions_stripe_sub` (`stripe_subscription_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

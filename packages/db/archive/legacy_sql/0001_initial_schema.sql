-- Migration 0001: Initial Schema (Accounts and Connections)
-- Cria as tabelas base para conexões financeiras (Pluggy) e contas.

CREATE TABLE `financial_connections` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL, -- Referência externa à tabela users
  `provider` VARCHAR(50) NOT NULL DEFAULT 'pluggy', -- pluggy, manual, etc.
  `provider_item_id` VARCHAR(255) UNIQUE, -- ID do item no Pluggy
  `provider_connector_id` INT, -- ID do conector no Pluggy
  `status` VARCHAR(50) NOT NULL, -- UPDATED, UPDATING, LOGIN_ERROR, etc.
  `last_sync_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_fin_conn_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Propósito: Gerenciar a conexão de um usuário com uma instituição financeira via Open Finance (ex: Pluggy Item).

CREATE TABLE `financial_connection_consents` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `financial_connection_id` INT NOT NULL,
  `provider_consent_id` VARCHAR(255) NOT NULL,
  `status` VARCHAR(50) NOT NULL,
  `expires_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_consent_connection` FOREIGN KEY (`financial_connection_id`) REFERENCES `financial_connections` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Propósito: Rastrear o consentimento do Open Finance, incluindo data de expiração para alertar o usuário.

CREATE TABLE `accounts` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `financial_connection_id` INT NULL, -- NULL se for conta manual
  `name` VARCHAR(200) NOT NULL,
  `type` VARCHAR(50) NOT NULL, -- CHECKING, SAVINGS, CREDIT_CARD
  `subtype` VARCHAR(50) NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'BRL',
  `provider_account_id` VARCHAR(255) UNIQUE, -- ID da conta no Pluggy
  `balance_minor` BIGINT NOT NULL DEFAULT 0, -- Saldo em centavos
  `credit_limit_minor` BIGINT NULL, -- Limite de crédito em centavos (para cartões)
  `available_credit_limit_minor` BIGINT NULL,
  `closing_day` INT NULL, -- Dia de fechamento da fatura
  `due_day` INT NULL, -- Dia de vencimento da fatura
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_accounts_user` (`user_id`),
  CONSTRAINT `fk_account_connection` FOREIGN KEY (`financial_connection_id`) REFERENCES `financial_connections` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Propósito: Representar uma conta bancária ou cartão de crédito, unificando contas manuais e conectadas via Open Finance.

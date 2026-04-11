-- Migration 0003: Payments, Investments, Webhooks, Sync Runs
-- Finaliza a modelagem de pagamentos de faturas, investimentos e gestão do Open Finance.

CREATE TABLE `card_invoice_payments` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `card_invoice_id` INT NOT NULL,
  `transaction_id` INT NOT NULL, -- A transação na conta corrente que efetivou o pagamento
  `allocated_amount_minor` BIGINT NOT NULL, -- Quanto desta transação pagou esta fatura
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `idx_payment_invoice_trans` (`card_invoice_id`, `transaction_id`),
  CONSTRAINT `fk_payment_invoice` FOREIGN KEY (`card_invoice_id`) REFERENCES `card_invoices` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_payment_transaction` FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Propósito: Substitui a redundância de card_invoice_allocations. Relaciona diretamente o débito no caixa (transaction) com a obrigação (card_invoice).

CREATE TABLE `investments` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `account_id` INT NOT NULL, -- Referência à conta de investimento
  `name` VARCHAR(200) NOT NULL,
  `type` VARCHAR(50) NOT NULL, -- FIXED_INCOME, MUTUAL_FUND, EQUITY, etc.
  `balance_minor` BIGINT NOT NULL DEFAULT 0, -- Valor atual do investimento
  `currency` VARCHAR(3) NOT NULL DEFAULT 'BRL',
  `provider_investment_id` VARCHAR(255) UNIQUE NULL,
  `provider_payload` JSON NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_investments_user` (`user_id`),
  CONSTRAINT `fk_investment_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Propósito: Rastrear a posição atual de investimentos (saldo).

CREATE TABLE `investment_transactions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `investment_id` INT NOT NULL,
  `type` VARCHAR(50) NOT NULL, -- BUY, SELL, YIELD, TAX
  `amount_minor` BIGINT NOT NULL,
  `date` TIMESTAMP NOT NULL,
  `provider_transaction_id` VARCHAR(255) UNIQUE NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_inv_trans_user` (`user_id`),
  CONSTRAINT `fk_inv_trans_investment` FOREIGN KEY (`investment_id`) REFERENCES `investments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Propósito: Registrar o histórico de movimentações do investimento.

CREATE TABLE `provider_webhook_events` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `provider` VARCHAR(50) NOT NULL DEFAULT 'pluggy',
  `event_type` VARCHAR(100) NOT NULL, -- ITEM_UPDATED, ITEM_ERROR, etc.
  `provider_item_id` VARCHAR(255) NULL,
  `payload` JSON NOT NULL,
  `processed` BOOLEAN NOT NULL DEFAULT FALSE,
  `error_message` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `processed_at` TIMESTAMP NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_webhook_item` (`provider_item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Propósito: Receber e enfileirar webhooks do Open Finance para processamento assíncrono seguro.

CREATE TABLE `sync_runs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `financial_connection_id` INT NOT NULL,
  `status` VARCHAR(50) NOT NULL, -- STARTED, SUCCESS, FAILED
  `started_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finished_at` TIMESTAMP NULL,
  `error_message` TEXT NULL,
  `metrics` JSON NULL, -- Quantidade de transações novas, atualizadas, etc.
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_sync_run_connection` FOREIGN KEY (`financial_connection_id`) REFERENCES `financial_connections` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Propósito: Auditoria e log de execuções de sincronização (manual ou via webhook).

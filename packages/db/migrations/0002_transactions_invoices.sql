-- Migration 0002: Transactions and Card Invoices
-- Cria tabelas principais para transações e faturas de cartão de crédito.

CREATE TABLE `transactions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL, -- Referência externa
  `account_id` INT NOT NULL,
  
  -- Hierarquia de Confiabilidade
  `source` VARCHAR(50) NOT NULL, -- pluggy, pdf_statement, pdf_invoice, nota_fiscal, manual
  `data_state` VARCHAR(50) NOT NULL, -- projected, consolidated, official
  
  -- Classificação de Negócio
  `movement_type` VARCHAR(50) NOT NULL, -- income, expense, transfer, investment, liability_payment, card_purchase
  `movement_subtype` VARCHAR(50) NULL, -- pix, ted, boleto, auto_debit, invoice_payment
  `financial_channel` VARCHAR(50) NOT NULL, -- bank_account, credit_card, investment_account, cash
  
  -- Detalhes Financeiros
  `amount_minor` BIGINT NOT NULL, -- Valor em centavos (negativo para despesa, positivo para receita)
  `currency` VARCHAR(3) NOT NULL DEFAULT 'BRL',
  `date` TIMESTAMP NOT NULL, -- Data da transação (hora do evento)
  `description` TEXT NOT NULL,
  `category_id` INT NULL, -- Referência externa à tabela de categorias
  
  -- Parcelamento (para projeções)
  `installment_number` INT NULL,
  `installment_total` INT NULL,
  `installment_group_id` VARCHAR(255) NULL,
  
  -- Recorrência
  `is_recurring` BOOLEAN NOT NULL DEFAULT FALSE,
  `recurring_rule_id` INT NULL, -- Referência futura se necessário
  
  -- Open Finance
  `provider_transaction_id` VARCHAR(255) UNIQUE NULL,
  `provider_payload` JSON NULL, -- Guarda dados brutos do provedor para reconciliação ou debug
  
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_trans_user_date` (`user_id`, `date`),
  CONSTRAINT `fk_trans_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Propósito: Centralizar transações de contas correntes e carteiras, distinguindo projetadas de consolidadas e oficiais.

CREATE TABLE `card_invoices` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `account_id` INT NOT NULL, -- Referência ao cartão de crédito em accounts
  
  -- Período
  `month_reference` VARCHAR(7) NOT NULL, -- YYYY-MM
  `closing_date` TIMESTAMP NULL,
  `due_date` TIMESTAMP NOT NULL,
  
  -- Valores
  `total_amount_minor` BIGINT NOT NULL DEFAULT 0, -- Valor total da fatura
  `minimum_payment_minor` BIGINT NULL,
  `previous_balance_minor` BIGINT NOT NULL DEFAULT 0, -- Saldo não pago do mês anterior (carry)
  `paid_amount_minor` BIGINT NOT NULL DEFAULT 0, -- Quanto já foi pago
  `remaining_amount_minor` BIGINT NOT NULL DEFAULT 0, -- Saldo devedor restante
  
  -- Estado
  `status` VARCHAR(50) NOT NULL DEFAULT 'OPEN', -- OPEN, CLOSED, PAID, PARTIALLY_PAID
  `source` VARCHAR(50) NOT NULL, -- pluggy, pdf_invoice, manual (para projeção)
  `data_state` VARCHAR(50) NOT NULL, -- projected, consolidated, official
  
  -- Open Finance
  `provider_bill_id` VARCHAR(255) UNIQUE NULL,
  
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `idx_invoice_acc_month` (`account_id`, `month_reference`),
  CONSTRAINT `fk_invoice_account` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Propósito: Representar a obrigação mensal (passivo) gerada pelo uso do cartão de crédito.

CREATE TABLE `card_transactions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `card_invoice_id` INT NOT NULL,
  
  -- Hierarquia
  `source` VARCHAR(50) NOT NULL, -- pluggy, pdf_invoice, nota_fiscal, manual
  `data_state` VARCHAR(50) NOT NULL, -- projected, consolidated, official
  
  -- Detalhes Financeiros
  `amount_minor` BIGINT NOT NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'BRL',
  `date` TIMESTAMP NOT NULL,
  `description` TEXT NOT NULL,
  `category_id` INT NULL,
  
  -- Parcelamento
  `installment_number` INT NULL,
  `installment_total` INT NULL,
  `installment_group_id` VARCHAR(255) NULL,
  
  -- Open Finance / Documentos
  `provider_transaction_id` VARCHAR(255) UNIQUE NULL,
  `provider_payload` JSON NULL,
  `receipt_document_id` INT NULL, -- Link para a nota fiscal, se houver
  
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_card_trans_user_date` (`user_id`, `date`),
  CONSTRAINT `fk_card_trans_invoice` FOREIGN KEY (`card_invoice_id`) REFERENCES `card_invoices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Propósito: Registrar as compras individuais no cartão de crédito que compõem uma fatura.

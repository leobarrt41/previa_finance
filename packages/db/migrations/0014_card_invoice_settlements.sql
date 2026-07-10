-- Migration 0014: liquidação de fatura paga com outro cartão
-- Modela o abatimento de uma fatura-alvo a partir de uma compra em outro cartão.

CREATE TABLE IF NOT EXISTS `card_invoice_settlements` (
  `id`                        INT          NOT NULL AUTO_INCREMENT,
  `user_id`                   INT          NOT NULL,
  `source_card_transaction_id` INT         NOT NULL,
  `target_card_invoice_id`    INT          NOT NULL,
  `allocated_amount_minor`    BIGINT       NOT NULL,
  `currency_code`             VARCHAR(3)   NOT NULL DEFAULT 'BRL',
  `settlement_date`           TIMESTAMP    NOT NULL,
  `source`                    VARCHAR(50)  NOT NULL DEFAULT 'manual',
  `matched_by`                VARCHAR(50)  NULL,
  `confidence_score`          DECIMAL(5,4) NULL,
  `notes`                     TEXT         NULL,
  `provider_payload`          JSON         NULL,
  `created_at`                TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`                TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_settlement_source_target` (`source_card_transaction_id`, `target_card_invoice_id`),
  KEY `idx_settlement_user` (`user_id`),
  KEY `idx_settlement_source` (`source_card_transaction_id`),
  KEY `idx_settlement_target` (`target_card_invoice_id`),
  KEY `idx_settlement_source_kind` (`source`),
  CONSTRAINT `fk_settlement_source_transaction`
    FOREIGN KEY (`source_card_transaction_id`)
    REFERENCES `card_transactions` (`id`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_settlement_target_invoice`
    FOREIGN KEY (`target_card_invoice_id`)
    REFERENCES `card_invoices` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

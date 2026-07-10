-- Migration 0015: componentes semânticos da fatura
-- Guarda o breakdown da fatura por camadas: resumo do cabeçalho e itens
-- lineares como parcelas, juros, IOF e taxas. Isso permite responder ao
-- usuário quanto foi compra nova, parcela, juros, encargo/IOF e pagamento
-- da fatura anterior sem depender exclusivamente de Open Finance.

CREATE TABLE IF NOT EXISTS `card_invoice_components` (
  `id`                  INT          NOT NULL AUTO_INCREMENT,
  `user_id`             INT          NOT NULL,
  `card_invoice_id`     INT          NOT NULL,
  `component_scope`     VARCHAR(20)  NOT NULL,
  `component_type`      VARCHAR(50)  NOT NULL,
  `amount_minor`        BIGINT       NOT NULL,
  `currency_code`       VARCHAR(3)   NOT NULL DEFAULT 'BRL',
  `description`         VARCHAR(255) NULL,
  `source`              VARCHAR(50)  NOT NULL DEFAULT 'pdf_invoice',
  `source_date`         TIMESTAMP    NULL,
  `card_transaction_id` INT          NULL,
  `transaction_id`      INT          NULL,
  `installment_number`   INT          NULL,
  `installment_total`    INT          NULL,
  `provider_payload`    JSON         NULL,
  `created_at`          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_invoice_component_user` (`user_id`),
  KEY `idx_invoice_component_invoice` (`card_invoice_id`),
  KEY `idx_invoice_component_scope` (`component_scope`),
  KEY `idx_invoice_component_type` (`component_type`),
  KEY `idx_invoice_component_card_tx` (`card_transaction_id`),
  KEY `idx_invoice_component_transaction` (`transaction_id`),
  CONSTRAINT `fk_invoice_component_invoice`
    FOREIGN KEY (`card_invoice_id`)
    REFERENCES `card_invoices` (`id`)
    ON DELETE CASCADE,
  CONSTRAINT `fk_invoice_component_card_transaction`
    FOREIGN KEY (`card_transaction_id`)
    REFERENCES `card_transactions` (`id`)
    ON DELETE SET NULL,
  CONSTRAINT `fk_invoice_component_transaction`
    FOREIGN KEY (`transaction_id`)
    REFERENCES `transactions` (`id`)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration 0009: receipt_documents
-- Tabela para notas fiscais e comprovantes avulsos
-- Nivel 4 na hierarquia de confiabilidade (ETP §6.3): nota_fiscal > manual
-- Suporta cartao de credito (expected_invoice_month) e debito (sem expected_invoice_month)
-- data_state = 'projected' -> entra no cashflow como previsao (laranja=cartao, vermelho=debito)
-- data_state = 'reconciled' -> fatura/extrato real chegou, some do cashflow manual

CREATE TABLE IF NOT EXISTS receipt_documents (
  id                     INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id                VARCHAR(128) NOT NULL,
  owner_id               INT NOT NULL,

  amount_minor           INT NOT NULL,
  currency_code          VARCHAR(3) NOT NULL DEFAULT 'BRL',

  purchase_date          TIMESTAMP NOT NULL,
  purchase_month         CHAR(7) NOT NULL,
  expected_invoice_month CHAR(7) NULL,

  merchant_name          VARCHAR(255) NULL,
  merchant_cnpj          VARCHAR(20) NULL,
  merchant_document      VARCHAR(20) NULL,

  category_id            VARCHAR(128) NULL,
  account_id             INT NULL,

  nfe_key                VARCHAR(64) NULL,
  nfe_number             VARCHAR(20) NULL,
  nfe_series             VARCHAR(5) NULL,
  raw_payload            JSON NULL,

  file_url               TEXT NULL,
  file_type              VARCHAR(20) NULL,

  installment_total      INT NULL,
  installment_current    INT NULL,

  data_state             VARCHAR(20) NOT NULL DEFAULT 'projected',
  card_transaction_id    INT NULL,
  transaction_id         INT NULL,
  reconcile_source       VARCHAR(20) NULL,
  reconciled_at          TIMESTAMP NULL,

  description            TEXT NULL,

  created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_rd_user (user_id),
  INDEX idx_rd_owner (owner_id),
  INDEX idx_rd_purchase_month (purchase_month),
  INDEX idx_rd_expected_invoice_month (expected_invoice_month),
  INDEX idx_rd_status (data_state),
  INDEX idx_rd_nfe_key (nfe_key),
  INDEX idx_rd_card_transaction (card_transaction_id),
  INDEX idx_rd_transaction (transaction_id)
);

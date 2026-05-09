-- Migration 0010: backend reconciliation semantics
-- Primeira etapa conservadora para tirar semântica financeira do frontend.
-- Apenas adições. Nenhum campo legado é removido ou renomeado nesta fase.

-- ---------------------------------------------------------------------------
-- card_invoices: separar valores reportados pela fatura, saldo carregado,
-- pagamentos reais alocados e saldo efetivo em aberto.
-- ---------------------------------------------------------------------------
ALTER TABLE card_invoices
  ADD COLUMN reported_previous_balance_minor BIGINT NOT NULL DEFAULT 0 AFTER open_amount_minor,
  ADD COLUMN reported_paid_amount_minor BIGINT NOT NULL DEFAULT 0 AFTER reported_previous_balance_minor,
  ADD COLUMN carried_open_amount_minor BIGINT NOT NULL DEFAULT 0 AFTER reported_paid_amount_minor,
  ADD COLUMN payments_allocated_minor BIGINT NOT NULL DEFAULT 0 AFTER carried_open_amount_minor,
  ADD COLUMN effective_open_amount_minor BIGINT NOT NULL DEFAULT 0 AFTER payments_allocated_minor;

-- ---------------------------------------------------------------------------
-- card_invoice_payments: rastreabilidade da origem e qualidade da reconciliação
-- ---------------------------------------------------------------------------
ALTER TABLE card_invoice_payments
  ADD COLUMN source VARCHAR(50) NOT NULL DEFAULT 'statement_reconciliation' AFTER payment_date,
  ADD COLUMN matched_by VARCHAR(50) NULL AFTER source,
  ADD COLUMN confidence_score DECIMAL(5,4) NULL AFTER matched_by,
  ADD COLUMN notes TEXT NULL AFTER confidence_score,
  ADD COLUMN provider_payload JSON NULL AFTER notes;

CREATE INDEX idx_payment_source ON card_invoice_payments (source);

-- ---------------------------------------------------------------------------
-- receipt_documents: persistir hints de cartão e OCR em colunas consultáveis
-- ---------------------------------------------------------------------------
ALTER TABLE receipt_documents
  ADD COLUMN payment_kind VARCHAR(20) NULL AFTER merchant_document,
  ADD COLUMN issuer_name VARCHAR(200) NULL AFTER payment_kind,
  ADD COLUMN card_brand VARCHAR(50) NULL AFTER issuer_name,
  ADD COLUMN card_last4 VARCHAR(4) NULL AFTER card_brand,
  ADD COLUMN masked_number VARCHAR(32) NULL AFTER card_last4,
  ADD COLUMN owner_name VARCHAR(200) NULL AFTER masked_number,
  ADD COLUMN closing_day INT NULL AFTER owner_name,
  ADD COLUMN due_day INT NULL AFTER closing_day,
  ADD COLUMN ocr_confidence_score DECIMAL(5,4) NULL AFTER due_day;

CREATE INDEX idx_rd_payment_kind ON receipt_documents (payment_kind);
CREATE INDEX idx_rd_card_last4 ON receipt_documents (card_last4);

-- ---------------------------------------------------------------------------
-- transactions: vínculo explícito com receipt_documents no lado do extrato
-- ---------------------------------------------------------------------------
ALTER TABLE transactions
  ADD COLUMN receipt_document_id INT NULL AFTER provider_payload;

CREATE INDEX idx_trans_receipt_document ON transactions (receipt_document_id);

-- ---------------------------------------------------------------------------
-- cashflow_forecast_month_status: status explícito mantendo compatibilidade
-- com o campo legado is_paid.
-- ---------------------------------------------------------------------------
ALTER TABLE cashflow_forecast_month_status
  ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'pending' AFTER is_paid,
  ADD COLUMN realized_transaction_id INT NULL AFTER status,
  ADD COLUMN resolved_at TIMESTAMP NULL AFTER realized_transaction_id;

CREATE INDEX idx_cashflow_fc_month_status_status ON cashflow_forecast_month_status (status);

-- ---------------------------------------------------------------------------
-- Backfill conservador
-- ---------------------------------------------------------------------------

-- 1) card_invoices: copiar campos legados reportados
UPDATE card_invoices
SET
  reported_previous_balance_minor = COALESCE(previous_balance_minor, 0),
  reported_paid_amount_minor = COALESCE(paid_amount_minor, 0),
  carried_open_amount_minor = GREATEST(COALESCE(previous_balance_minor, 0) - COALESCE(paid_amount_minor, 0), 0);

-- 2) card_invoices: somar pagamentos reais já alocados
UPDATE card_invoices ci
LEFT JOIN (
  SELECT card_invoice_id, COALESCE(SUM(allocated_amount_minor), 0) AS allocated_sum
  FROM card_invoice_payments
  GROUP BY card_invoice_id
) p ON p.card_invoice_id = ci.id
SET ci.payments_allocated_minor = COALESCE(p.allocated_sum, 0);

-- 3) card_invoices: saldo efetivo
-- Regra conservadora:
-- - se já existem pagamentos reais alocados, usa total - pagamentos reais;
-- - senão, se open_amount foi provavelmente derivado de total - paid_amount,
--   considera que paid_amount era informativo da competência anterior e mantém
--   o total atual como saldo efetivo;
-- - caso contrário, preserva o open_amount legado.
UPDATE card_invoices
SET effective_open_amount_minor = CASE
  WHEN COALESCE(payments_allocated_minor, 0) > 0
    THEN GREATEST(COALESCE(total_amount_minor, 0) - COALESCE(payments_allocated_minor, 0), 0)
  WHEN COALESCE(paid_amount_minor, 0) > 0
       AND COALESCE(open_amount_minor, 0) = GREATEST(COALESCE(total_amount_minor, 0) - COALESCE(paid_amount_minor, 0), 0)
    THEN COALESCE(total_amount_minor, 0)
  ELSE GREATEST(COALESCE(open_amount_minor, 0), 0)
END;

-- 4) receipt_documents: materializar hints já presentes no raw_payload
UPDATE receipt_documents
SET payment_kind = JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.paymentKind'))
WHERE payment_kind IS NULL
  AND raw_payload IS NOT NULL
  AND JSON_EXTRACT(raw_payload, '$.paymentKind') IS NOT NULL
  AND JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.paymentKind')) <> 'null';

UPDATE receipt_documents
SET issuer_name = JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.issuerName'))
WHERE issuer_name IS NULL
  AND raw_payload IS NOT NULL
  AND JSON_EXTRACT(raw_payload, '$.issuerName') IS NOT NULL
  AND JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.issuerName')) <> 'null';

UPDATE receipt_documents
SET card_brand = JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.cardBrand'))
WHERE card_brand IS NULL
  AND raw_payload IS NOT NULL
  AND JSON_EXTRACT(raw_payload, '$.cardBrand') IS NOT NULL
  AND JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.cardBrand')) <> 'null';

UPDATE receipt_documents
SET card_last4 = JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.cardLast4'))
WHERE card_last4 IS NULL
  AND raw_payload IS NOT NULL
  AND JSON_EXTRACT(raw_payload, '$.cardLast4') IS NOT NULL
  AND JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.cardLast4')) <> 'null';

UPDATE receipt_documents
SET masked_number = JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.maskedNumber'))
WHERE masked_number IS NULL
  AND raw_payload IS NOT NULL
  AND JSON_EXTRACT(raw_payload, '$.maskedNumber') IS NOT NULL
  AND JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.maskedNumber')) <> 'null';

UPDATE receipt_documents
SET owner_name = JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.ownerName'))
WHERE owner_name IS NULL
  AND raw_payload IS NOT NULL
  AND JSON_EXTRACT(raw_payload, '$.ownerName') IS NOT NULL
  AND JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.ownerName')) <> 'null';

UPDATE receipt_documents
SET closing_day = CAST(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.closingDay')) AS SIGNED)
WHERE closing_day IS NULL
  AND raw_payload IS NOT NULL
  AND JSON_EXTRACT(raw_payload, '$.closingDay') IS NOT NULL
  AND JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.closingDay')) REGEXP '^[0-9]+$';

UPDATE receipt_documents
SET due_day = CAST(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.dueDay')) AS SIGNED)
WHERE due_day IS NULL
  AND raw_payload IS NOT NULL
  AND JSON_EXTRACT(raw_payload, '$.dueDay') IS NOT NULL
  AND JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.dueDay')) REGEXP '^[0-9]+$';

UPDATE receipt_documents
SET ocr_confidence_score = CAST(JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.confidence')) AS DECIMAL(5,4))
WHERE ocr_confidence_score IS NULL
  AND raw_payload IS NOT NULL
  AND JSON_EXTRACT(raw_payload, '$.confidence') IS NOT NULL
  AND JSON_UNQUOTE(JSON_EXTRACT(raw_payload, '$.confidence')) REGEXP '^[0-9]+(\\.[0-9]+)?$';

-- 5) cashflow_forecast_month_status: manter compatibilidade e explicitar status
UPDATE cashflow_forecast_month_status
SET
  status = CASE WHEN is_paid THEN 'realized' ELSE 'pending' END,
  resolved_at = CASE WHEN is_paid AND resolved_at IS NULL THEN updated_at ELSE resolved_at END;

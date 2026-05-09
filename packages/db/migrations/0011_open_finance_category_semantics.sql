-- Migration 0011: preserve provider category semantics alongside internal taxonomy
-- Goal:
--   avoid ambiguity between provider/Open Finance categories and the app's
--   internal hierarchical categoryId.
--
-- Strategy:
--   - keep category_id as the final internal category used by the app
--   - add provider_category/provider_category_raw to preserve provider meaning
--   - add category_assigned_by to preserve who/what chose the internal category

ALTER TABLE transactions
  ADD COLUMN provider_category VARCHAR(128) NULL AFTER category_id,
  ADD COLUMN provider_category_raw VARCHAR(255) NULL AFTER provider_category,
  ADD COLUMN category_assigned_by VARCHAR(50) NULL AFTER provider_category_raw;

CREATE INDEX idx_trans_provider_category ON transactions (provider_category);
CREATE INDEX idx_trans_category_assigned_by ON transactions (category_assigned_by);

ALTER TABLE card_transactions
  ADD COLUMN provider_category VARCHAR(128) NULL AFTER category_id,
  ADD COLUMN provider_category_raw VARCHAR(255) NULL AFTER provider_category,
  ADD COLUMN category_assigned_by VARCHAR(50) NULL AFTER provider_category_raw;

CREATE INDEX idx_card_trans_provider_category ON card_transactions (provider_category);
CREATE INDEX idx_card_trans_category_assigned_by ON card_transactions (category_assigned_by);

-- Conservative backfill:
-- existing rows with category_id populated were already classified somehow,
-- but we cannot reliably infer whether by user, AI, history or provider.
-- Mark them as legacy so future writes can become explicit.
UPDATE transactions
SET category_assigned_by = 'legacy'
WHERE category_assigned_by IS NULL
  AND category_id IS NOT NULL;

UPDATE card_transactions
SET category_assigned_by = 'legacy'
WHERE category_assigned_by IS NULL
  AND category_id IS NOT NULL;

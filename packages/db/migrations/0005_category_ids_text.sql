-- Migration: align transaction category ids with categories.id (text)

ALTER TABLE transactions
  MODIFY COLUMN category_id VARCHAR(128) NULL;

ALTER TABLE card_transactions
  MODIFY COLUMN category_id VARCHAR(128) NULL;


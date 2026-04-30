-- Migration 0007: Adiciona coluna memo em transactions
ALTER TABLE transactions ADD COLUMN memo TEXT NULL AFTER description;

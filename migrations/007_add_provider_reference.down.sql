-- Rollback: 007_add_provider_reference
-- Removes provider_reference column from transactions

DROP INDEX IF EXISTS idx_transactions_provider_reference;
ALTER TABLE transactions DROP COLUMN IF EXISTS provider_reference;


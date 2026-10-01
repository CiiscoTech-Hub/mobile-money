-- Rollback: 004_add_transaction_metadata
-- Removes metadata JSONB column from transactions

DROP INDEX IF EXISTS idx_transactions_metadata;
ALTER TABLE transactions DROP COLUMN IF EXISTS metadata;


-- Rollback: 20260421_add_provider_reference_to_transactions
-- Removes provider_reference column from transactions table

ALTER TABLE transactions DROP COLUMN IF EXISTS provider_reference;


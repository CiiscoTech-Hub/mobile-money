-- Rollback: 20260327_add_vaults_support
-- Drops vault tables and removes vault_id from transactions

DROP INDEX IF EXISTS idx_transactions_vault_id;
ALTER TABLE transactions DROP COLUMN IF EXISTS vault_id;
DROP INDEX IF EXISTS idx_vault_transactions_reference_id;
DROP INDEX IF EXISTS idx_vault_transactions_created_at;
DROP INDEX IF EXISTS idx_vault_transactions_user_id;
DROP INDEX IF EXISTS idx_vault_transactions_vault_id;
DROP TABLE IF EXISTS vault_transactions;
DROP TRIGGER IF EXISTS vaults_updated_at ON vaults;
DROP FUNCTION IF EXISTS update_vaults_updated_at();
DROP INDEX IF EXISTS idx_vaults_created_at;
DROP INDEX IF EXISTS idx_vaults_user_active;
DROP INDEX IF EXISTS idx_vaults_user_id;
DROP TABLE IF EXISTS vaults;


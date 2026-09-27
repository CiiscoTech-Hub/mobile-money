-- Rollback: 004_create_accounting_tables
-- Drops accounting tables and removes fee_category column

DROP TRIGGER IF EXISTS update_accounting_connections_updated_at ON accounting_connections;
DROP FUNCTION IF EXISTS update_updated_at_column();
DROP INDEX IF EXISTS idx_sync_logs_synced_at;
DROP INDEX IF EXISTS idx_sync_logs_status;
DROP INDEX IF EXISTS idx_sync_logs_sync_type;
DROP INDEX IF EXISTS idx_sync_logs_connection_id;
DROP INDEX IF EXISTS idx_category_mappings_connection_id;
DROP INDEX IF EXISTS idx_accounting_connections_is_active;
DROP INDEX IF EXISTS idx_accounting_connections_provider;
DROP INDEX IF EXISTS idx_accounting_connections_user_id;
DROP TABLE IF EXISTS sync_logs;
DROP TABLE IF EXISTS category_mappings;
DROP TABLE IF EXISTS accounting_connections;
ALTER TABLE transactions DROP COLUMN IF EXISTS fee_category;


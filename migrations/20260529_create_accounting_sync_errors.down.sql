-- Rollback: 20260529_create_accounting_sync_errors
-- Drops accounting_sync_errors table

DROP TRIGGER IF EXISTS accounting_sync_errors_updated_at ON accounting_sync_errors;
DROP FUNCTION IF EXISTS update_accounting_sync_errors_updated_at();
DROP INDEX IF EXISTS idx_accounting_sync_errors_created_at;
DROP INDEX IF EXISTS idx_accounting_sync_errors_status;
DROP INDEX IF EXISTS idx_accounting_sync_errors_provider_type;
DROP INDEX IF EXISTS idx_accounting_sync_errors_transaction_id;
DROP TABLE IF EXISTS accounting_sync_errors;

-- Rollback: 20260423_create_accounting_sync_queue
-- Drops accounting_sync_queue table

DROP INDEX IF EXISTS idx_accounting_sync_queue_transaction;
DROP INDEX IF EXISTS idx_accounting_sync_queue_status;
DROP TABLE IF EXISTS accounting_sync_queue;


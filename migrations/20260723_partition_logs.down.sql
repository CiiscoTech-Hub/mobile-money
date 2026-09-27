-- Rollback: 20260723_partition_logs
-- Reverses the transaction_logs partitioning migration
-- Drops the partitioned parent table, detaches legacy, renames it back

DROP TRIGGER IF EXISTS trg_route_transaction_logs ON transaction_logs;
DROP FUNCTION IF EXISTS route_transaction_logs_partition();
DROP INDEX IF EXISTS idx_transaction_logs_metadata;
DROP INDEX IF EXISTS idx_transaction_logs_action_created;
DROP INDEX IF EXISTS idx_transaction_logs_user_id;
DROP INDEX IF EXISTS idx_transaction_logs_transaction_id;
DROP INDEX IF EXISTS idx_transaction_logs_created_at;
DROP FUNCTION IF EXISTS create_monthly_log_partition(TIMESTAMP WITH TIME ZONE);

-- Detach the legacy table from the partitioned parent
ALTER TABLE transaction_logs DETACH PARTITION transaction_logs_legacy;

-- Drop the partitioned parent
DROP TABLE IF EXISTS transaction_logs;

-- Restore the original table name
ALTER TABLE IF EXISTS transaction_logs_legacy RENAME TO transaction_logs;

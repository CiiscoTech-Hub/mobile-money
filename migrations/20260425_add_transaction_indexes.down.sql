-- Rollback: 20260425_add_transaction_indexes
-- Removes all indexes added by this migration

DROP INDEX IF EXISTS idx_aml_review_history_created_at;
DROP INDEX IF EXISTS idx_aml_review_history_alert_id;
DROP INDEX IF EXISTS idx_aml_alerts_user_status;
DROP INDEX IF EXISTS idx_aml_alerts_status_created;
DROP INDEX IF EXISTS idx_aml_alerts_severity;
DROP INDEX IF EXISTS idx_aml_alerts_transaction_id;
DROP INDEX IF EXISTS idx_aml_alerts_user_id;
DROP INDEX IF EXISTS idx_aml_alerts_status;
DROP INDEX IF EXISTS idx_transactions_idempotency_expires_at;
DROP INDEX IF EXISTS idx_transactions_idempotency_key;
DROP INDEX IF EXISTS idx_transactions_status_created_covering;
DROP INDEX IF EXISTS idx_transactions_phone_number;
DROP INDEX IF EXISTS idx_transactions_notes_fts;
DROP INDEX IF EXISTS idx_transactions_status_created_at;
DROP INDEX IF EXISTS idx_transactions_provider;

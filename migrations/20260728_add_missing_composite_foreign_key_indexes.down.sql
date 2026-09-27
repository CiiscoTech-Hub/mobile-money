-- Rollback: add_missing_composite_foreign_key_indexes
-- Removes composite foreign key indexes

DROP INDEX IF EXISTS idx_transactions_id_user;
DROP INDEX IF EXISTS idx_aml_review_history_alert_user;
DROP INDEX IF EXISTS idx_aml_alerts_transaction_user;
DROP INDEX IF EXISTS idx_transactions_vault_user;

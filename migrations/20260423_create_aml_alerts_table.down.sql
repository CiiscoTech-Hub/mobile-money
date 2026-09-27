-- Rollback: 20260423_create_aml_alerts_table
-- Drops aml_alerts and aml_alert_review_history tables

DROP TRIGGER IF EXISTS aml_alerts_updated_at ON aml_alerts;
DROP FUNCTION IF EXISTS update_aml_alerts_updated_at();
DROP INDEX IF EXISTS idx_aml_review_history_created_at;
DROP INDEX IF EXISTS idx_aml_review_history_reviewed_by;
DROP INDEX IF EXISTS idx_aml_review_history_alert_id;
DROP TABLE IF EXISTS aml_alert_review_history;
DROP INDEX IF EXISTS idx_aml_alerts_user_status;
DROP INDEX IF EXISTS idx_aml_alerts_status_created;
DROP INDEX IF EXISTS idx_aml_alerts_created_at;
DROP INDEX IF EXISTS idx_aml_alerts_severity;
DROP INDEX IF EXISTS idx_aml_alerts_transaction_id;
DROP INDEX IF EXISTS idx_aml_alerts_user_id;
DROP INDEX IF EXISTS idx_aml_alerts_status;
DROP TABLE IF EXISTS aml_alerts;


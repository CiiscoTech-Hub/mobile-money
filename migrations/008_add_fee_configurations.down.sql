-- Rollback: 008_add_fee_configurations
-- Drops fee_configurations and fee_configuration_audit tables

DROP TRIGGER IF EXISTS fee_configurations_updated_at ON fee_configurations;
DROP FUNCTION IF EXISTS update_fee_configurations_updated_at();
DROP INDEX IF EXISTS idx_fee_audit_changed_by;
DROP INDEX IF EXISTS idx_fee_audit_changed_at;
DROP INDEX IF EXISTS idx_fee_audit_config_id;
DROP INDEX IF EXISTS idx_fee_configurations_created_at;
DROP INDEX IF EXISTS idx_fee_configurations_active;
DROP INDEX IF EXISTS idx_fee_configurations_name;
DROP TABLE IF EXISTS fee_configuration_audit;
DROP TABLE IF EXISTS fee_configurations;


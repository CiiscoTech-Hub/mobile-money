-- Rollback: 20260424_create_fee_strategies
-- Drops fee_strategies and fee_strategy_audit tables and cleans up custom types

DROP TRIGGER IF EXISTS fee_strategies_updated_at ON fee_strategies;
DROP FUNCTION IF EXISTS update_fee_strategies_updated_at();
DROP INDEX IF EXISTS idx_fee_strategies_priority;
DROP INDEX IF EXISTS idx_fee_strategies_provider;
DROP INDEX IF EXISTS idx_fee_strategies_user;
DROP INDEX IF EXISTS idx_fee_strategies_scope;
DROP INDEX IF EXISTS idx_fee_strategies_active;
DROP INDEX IF EXISTS idx_fee_strategy_audit_changed_at;
DROP INDEX IF EXISTS idx_fee_strategy_audit_strategy_id;
DROP TABLE IF EXISTS fee_strategy_audit;
DROP TABLE IF EXISTS fee_strategies;
DROP TYPE IF EXISTS fee_strategy_scope;
DROP TYPE IF EXISTS fee_strategy_type;

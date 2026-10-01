-- Rollback: 20260423_add_travel_rule_records
-- Drops travel_rule_records table

DROP INDEX IF EXISTS idx_travel_rule_exported;
DROP INDEX IF EXISTS idx_travel_rule_created_at;
DROP INDEX IF EXISTS idx_travel_rule_transaction;
DROP TABLE IF EXISTS travel_rule_records;


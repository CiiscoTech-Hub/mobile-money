-- Rollback: 20260624_create_provider_settlement_records
-- Drops provider_settlement_records table

DROP INDEX IF EXISTS idx_psr_status;
DROP INDEX IF EXISTS idx_psr_provider;
DROP INDEX IF EXISTS idx_psr_settlement_date;
DROP TABLE IF EXISTS provider_settlement_records;

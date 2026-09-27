-- Rollback: 20240326_provider_performance
-- Drops provider_performance_logs table

DROP INDEX IF EXISTS idx_provider_performance_created_at;
DROP INDEX IF EXISTS idx_provider_performance_provider;
DROP TABLE IF EXISTS provider_performance_logs;


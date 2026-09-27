-- Rollback: 20260624_create_provider_maintenance_outages
-- Drops provider_maintenance_outages table

DROP INDEX IF EXISTS idx_provider_maintenance_starts_at;
DROP INDEX IF EXISTS idx_provider_maintenance_active;
DROP TABLE IF EXISTS provider_maintenance_outages;

-- Rollback: 20260601_create_accounting_contact_mappings
-- Drops accounting_contact_mappings table

DROP INDEX IF EXISTS idx_accounting_contact_mappings_provider_tenant;
DROP INDEX IF EXISTS idx_accounting_contact_mappings_user_id;
DROP TABLE IF EXISTS accounting_contact_mappings;

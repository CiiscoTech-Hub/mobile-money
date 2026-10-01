-- Rollback: 20260327_create_refresh_token_families
-- Drops refresh_token_families table

DROP INDEX IF EXISTS idx_refresh_token_families_token;
DROP INDEX IF EXISTS idx_refresh_token_families_family_id;
DROP TABLE IF EXISTS refresh_token_families;


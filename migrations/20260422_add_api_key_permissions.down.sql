-- Rollback: 20260422_add_api_key_permissions
-- Removes permissions and label columns from api_keys table

DROP INDEX IF EXISTS idx_api_keys_permissions;
ALTER TABLE api_keys DROP COLUMN IF EXISTS label;
ALTER TABLE api_keys DROP COLUMN IF EXISTS permissions;


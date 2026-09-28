-- Rollback: 20260602_add_scopes_to_api_keys
-- Removes scopes column from api_keys table

ALTER TABLE api_keys DROP COLUMN IF EXISTS scopes;

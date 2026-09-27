-- Rollback: 20260421_create_api_keys_table
-- Drops api_keys table

DROP INDEX IF EXISTS idx_api_keys_key;
DROP TABLE IF EXISTS api_keys;


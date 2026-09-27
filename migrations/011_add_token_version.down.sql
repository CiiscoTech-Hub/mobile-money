-- Rollback: 011_add_token_version
-- Removes token_version column from users table

ALTER TABLE users DROP COLUMN IF EXISTS token_version;


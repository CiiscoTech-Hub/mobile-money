-- Rollback: 009_add_push_tokens
-- Drops push_tokens table

DROP TRIGGER IF EXISTS push_tokens_updated_at ON push_tokens;
DROP FUNCTION IF EXISTS update_push_tokens_updated_at();
DROP INDEX IF EXISTS idx_push_tokens_updated_at;
DROP INDEX IF EXISTS idx_push_tokens_platform;
DROP INDEX IF EXISTS idx_push_tokens_token;
DROP INDEX IF EXISTS idx_push_tokens_user_id;
DROP TABLE IF EXISTS push_tokens;


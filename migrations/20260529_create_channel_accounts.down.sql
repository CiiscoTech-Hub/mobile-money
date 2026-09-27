-- Rollback: 20260529_create_channel_accounts
-- Drops channel_accounts table

DROP TRIGGER IF EXISTS trg_channel_accounts_updated_at ON channel_accounts;
DROP FUNCTION IF EXISTS update_channel_accounts_updated_at();
DROP INDEX IF EXISTS idx_channel_accounts_locked_at;
DROP INDEX IF EXISTS idx_channel_accounts_status;
DROP TABLE IF EXISTS channel_accounts;

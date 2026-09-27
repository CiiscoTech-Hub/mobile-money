-- Rollback: 20260329_add_user_backup_codes
-- Drops the composite index added for backup codes lookups

DROP INDEX IF EXISTS idx_backup_codes_user_id_used;
-- Note: The backup_codes column drop on users is not reverted since the column
-- was erroneous and never should have existed. The backup_codes table itself
-- is managed by migration 003_add_2fa_support.


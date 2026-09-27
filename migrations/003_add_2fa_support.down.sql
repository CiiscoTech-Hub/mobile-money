-- Rollback: 003_add_2fa_support
-- Removes 2FA fields from users and drops backup_codes table

DROP TRIGGER IF EXISTS backup_codes_used_at ON backup_codes;
DROP FUNCTION IF EXISTS update_backup_codes_used_at();
DROP INDEX IF EXISTS idx_users_email;
DROP INDEX IF EXISTS idx_backup_codes_used;
DROP INDEX IF EXISTS idx_backup_codes_user_id;
ALTER TABLE backup_codes DROP CONSTRAINT IF EXISTS chk_backup_codes_used_at;
DROP TABLE IF EXISTS backup_codes;
ALTER TABLE users DROP COLUMN IF EXISTS two_factor_secret;
ALTER TABLE users DROP COLUMN IF EXISTS two_factor_enabled;
ALTER TABLE users DROP COLUMN IF EXISTS two_factor_verified;
ALTER TABLE users DROP COLUMN IF EXISTS email;


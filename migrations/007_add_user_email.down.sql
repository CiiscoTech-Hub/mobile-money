-- Rollback: 007_add_user_email
-- Removes email column from users table

DROP INDEX IF EXISTS idx_users_email;
ALTER TABLE users DROP COLUMN IF EXISTS email;


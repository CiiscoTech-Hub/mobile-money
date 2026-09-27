-- Rollback: 20260329_add_user_role
-- Removes role_id column and foreign key constraint from users table

ALTER TABLE users DROP CONSTRAINT IF EXISTS user_role_fkey;
DROP INDEX IF EXISTS idx_users_role_id;
ALTER TABLE users DROP COLUMN IF EXISTS role_id;


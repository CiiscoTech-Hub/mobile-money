-- Rollback: 010_add_session_metadata_to_users
-- Removes session security metadata columns from users table

ALTER TABLE users DROP COLUMN IF EXISTS last_login_user_agent;
ALTER TABLE users DROP COLUMN IF EXISTS last_login_ip;
ALTER TABLE users DROP COLUMN IF EXISTS last_login_at;


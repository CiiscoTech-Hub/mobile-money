-- Rollback: 009_add_profile_url_to_users
-- Removes profile_url column from users table

ALTER TABLE users DROP COLUMN IF EXISTS profile_url;


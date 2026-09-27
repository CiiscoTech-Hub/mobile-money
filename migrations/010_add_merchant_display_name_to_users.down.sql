-- Rollback: 010_add_merchant_display_name_to_users
-- Removes display_name column from users table

ALTER TABLE users DROP COLUMN IF EXISTS display_name;


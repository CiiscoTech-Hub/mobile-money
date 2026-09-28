-- Rollback: 20260424_add_sms_opt_out_to_users
-- Removes sms_opt_out column from users table

ALTER TABLE users DROP COLUMN IF EXISTS sms_opt_out;

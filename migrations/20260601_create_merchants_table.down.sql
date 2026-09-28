-- Rollback: 20260601_create_merchants_table
-- Drops merchants and merchant_batch_jobs tables

DROP TRIGGER IF EXISTS merchants_updated_at ON merchants;
DROP FUNCTION IF EXISTS update_merchants_updated_at();
DROP INDEX IF EXISTS idx_merchant_batch_jobs_created_at;
DROP INDEX IF EXISTS idx_merchant_batch_jobs_status;
DROP INDEX IF EXISTS idx_merchant_batch_jobs_job_id;
DROP TABLE IF EXISTS merchant_batch_jobs;
DROP INDEX IF EXISTS idx_merchants_invitation_token;
DROP INDEX IF EXISTS idx_merchants_kyc_status;
DROP INDEX IF EXISTS idx_merchants_status;
DROP INDEX IF EXISTS idx_merchants_phone_number;
DROP INDEX IF EXISTS idx_merchants_email;
DROP TABLE IF EXISTS merchants;

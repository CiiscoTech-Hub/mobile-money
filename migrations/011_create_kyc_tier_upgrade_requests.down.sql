-- Rollback: 011_create_kyc_tier_upgrade_requests
-- Drops kyc_tier_upgrade_requests table

DROP TRIGGER IF EXISTS kyc_tier_upgrade_requests_updated_at ON kyc_tier_upgrade_requests;
DROP FUNCTION IF EXISTS update_kyc_tier_upgrade_requests_updated_at();
DROP INDEX IF EXISTS idx_kyc_upgrade_created_at;
DROP INDEX IF EXISTS idx_kyc_upgrade_status;
DROP INDEX IF EXISTS idx_kyc_upgrade_user_id;
DROP TABLE IF EXISTS kyc_tier_upgrade_requests;


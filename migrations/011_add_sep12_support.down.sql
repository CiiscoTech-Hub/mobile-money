-- Rollback: 011_add_sep12_support
-- Drops kyc_applicants table and removes stellar_address from users

DROP TRIGGER IF EXISTS kyc_applicants_updated_at ON kyc_applicants;
DROP FUNCTION IF EXISTS update_kyc_applicants_updated_at();
DROP INDEX IF EXISTS idx_kyc_applicants_updated_at;
DROP INDEX IF EXISTS idx_kyc_applicants_verification_status;
DROP INDEX IF EXISTS idx_kyc_applicants_applicant_id;
DROP INDEX IF EXISTS idx_kyc_applicants_user_id;
DROP TABLE IF EXISTS kyc_applicants;
DROP INDEX IF EXISTS idx_users_stellar_address;
ALTER TABLE users DROP COLUMN IF EXISTS stellar_address;


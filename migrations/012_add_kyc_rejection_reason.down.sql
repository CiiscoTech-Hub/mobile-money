-- Rollback: 012_add_kyc_rejection_reason
-- Removes rejection_reason columns from KYC tables

ALTER TABLE kyc_tier_upgrade_requests DROP COLUMN IF EXISTS rejection_reason;
ALTER TABLE kyc_applicants DROP COLUMN IF EXISTS rejection_reason;


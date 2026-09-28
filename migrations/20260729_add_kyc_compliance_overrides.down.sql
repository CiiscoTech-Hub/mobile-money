DROP INDEX IF EXISTS idx_kyc_applicants_override_status;

ALTER TABLE kyc_applicants
  DROP COLUMN IF EXISTS override_status,
  DROP COLUMN IF EXISTS override_reason,
  DROP COLUMN IF EXISTS overridden_by,
  DROP COLUMN IF EXISTS overridden_at;

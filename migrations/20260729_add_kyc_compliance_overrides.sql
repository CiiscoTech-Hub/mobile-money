-- Manual compliance override support for automated KYC decisions (#1574)
-- Lets an admin/compliance officer override the automated verification_status
-- on a kyc_applicants record, with a full audit trail of who/when/why.

ALTER TABLE kyc_applicants
  ADD COLUMN IF NOT EXISTS override_status VARCHAR(20)
    CHECK (override_status IN ('approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS override_reason TEXT,
  ADD COLUMN IF NOT EXISTS overridden_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS overridden_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_kyc_applicants_override_status
  ON kyc_applicants(override_status);

COMMENT ON COLUMN kyc_applicants.override_status IS
  'Manual decision applied by a compliance officer/admin, overriding the automated verification_status. NULL means no manual override has been made.';
COMMENT ON COLUMN kyc_applicants.override_reason IS
  'Free-text reason recorded by the reviewer for the manual override.';
COMMENT ON COLUMN kyc_applicants.overridden_by IS
  'Admin/compliance officer user id who applied the manual override.';
COMMENT ON COLUMN kyc_applicants.overridden_at IS
  'Timestamp the manual override was applied.';

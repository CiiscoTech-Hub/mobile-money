CREATE TABLE IF NOT EXISTS vault_proof_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_id UUID NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  applicant_id VARCHAR(255) NOT NULL,
  proof_type VARCHAR(100) NOT NULL,
  proof_version VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('issued', 'verified', 'review', 'rejected')),
  commitment TEXT NOT NULL,
  signature TEXT NOT NULL,
  signature_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  proof_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  compliance_score INTEGER,
  compliance_checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  artifact_ciphertext TEXT NOT NULL,
  artifact_hash VARCHAR(128) NOT NULL,
  provider_reference VARCHAR(255),
  document_hash VARCHAR(128) NOT NULL,
  document_filename VARCHAR(255),
  document_mime_type VARCHAR(100),
  issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_vault_proof_artifacts_vault_id
  ON vault_proof_artifacts(vault_id);

CREATE INDEX IF NOT EXISTS idx_vault_proof_artifacts_user_id
  ON vault_proof_artifacts(user_id);

CREATE INDEX IF NOT EXISTS idx_vault_proof_artifacts_applicant_id
  ON vault_proof_artifacts(applicant_id);

CREATE INDEX IF NOT EXISTS idx_vault_proof_artifacts_status
  ON vault_proof_artifacts(status);

CREATE INDEX IF NOT EXISTS idx_vault_proof_artifacts_created_at
  ON vault_proof_artifacts(created_at DESC);

CREATE OR REPLACE FUNCTION update_vault_proof_artifacts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS vault_proof_artifacts_updated_at ON vault_proof_artifacts;
CREATE TRIGGER vault_proof_artifacts_updated_at
  BEFORE UPDATE ON vault_proof_artifacts
  FOR EACH ROW EXECUTE FUNCTION update_vault_proof_artifacts_updated_at();

COMMENT ON TABLE vault_proof_artifacts IS 'Stores encrypted KYC proof artifacts linked to internal user vault containers';
COMMENT ON COLUMN vault_proof_artifacts.artifact_ciphertext IS 'Encrypted serialized proof bundle; no raw utility bill content should be stored';

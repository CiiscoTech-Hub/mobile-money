-- Multi-Signature Custody Ledger System
-- Requires M-of-N authorization signatures for large balance movements

-- Multi-sig configurations table
CREATE TABLE IF NOT EXISTS multisig_configs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  account_type VARCHAR(50) NOT NULL CHECK (account_type IN ('escrow', 'issuance', 'vault')),
  account_id VARCHAR(255) NOT NULL,
  required_signatures INTEGER NOT NULL,
  total_signers INTEGER NOT NULL,
  daily_cap_xaf DECIMAL(20, 7) NOT NULL,
  per_transaction_cap_xaf DECIMAL(20, 7) NOT NULL,
  time_lock_minutes INTEGER DEFAULT 30,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_type, account_id)
);

CREATE INDEX IF NOT EXISTS idx_multisig_configs_account ON multisig_configs(account_type, account_id);
CREATE INDEX IF NOT EXISTS idx_multisig_configs_active ON multisig_configs(is_active);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_multisig_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS multisig_configs_updated_at ON multisig_configs;
CREATE TRIGGER multisig_configs_updated_at
  BEFORE UPDATE ON multisig_configs
  FOR EACH ROW EXECUTE FUNCTION update_multisig_configs_updated_at();

-- Multi-sig signers table
CREATE TABLE IF NOT EXISTS multisig_signers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  config_id UUID NOT NULL REFERENCES multisig_configs(id) ON DELETE CASCADE,
  signer_id VARCHAR(255) NOT NULL,
  signer_name VARCHAR(255) NOT NULL,
  signer_email VARCHAR(255),
  public_key VARCHAR(255) NOT NULL,
  weight INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(config_id, signer_id)
);

CREATE INDEX IF NOT EXISTS idx_multisig_signers_config ON multisig_signers(config_id);
CREATE INDEX IF NOT EXISTS idx_multisig_signers_active ON multisig_signers(is_active);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_multisig_signers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS multisig_signers_updated_at ON multisig_signers;
CREATE TRIGGER multisig_signers_updated_at
  BEFORE UPDATE ON multisig_signers
  FOR EACH ROW EXECUTE FUNCTION update_multisig_signers_updated_at();

-- Multi-sig signature requests table
CREATE TABLE IF NOT EXISTS multisig_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  config_id UUID NOT NULL REFERENCES multisig_configs(id),
  request_type VARCHAR(50) NOT NULL CHECK (request_type IN ('transfer', 'issuance', 'vault_operation')),
  account_id VARCHAR(255) NOT NULL,
  amount_xaf DECIMAL(20, 7) NOT NULL,
  destination VARCHAR(255) NOT NULL,
  metadata JSONB DEFAULT '{}',
  status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired')) DEFAULT 'pending',
  required_signatures INTEGER NOT NULL,
  collected_signatures INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMP NOT NULL,
  created_by VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  executed_at TIMESTAMP,
  executed_by VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_multisig_requests_config ON multisig_requests(config_id);
CREATE INDEX IF NOT EXISTS idx_multisig_requests_status ON multisig_requests(status);
CREATE INDEX IF NOT EXISTS idx_multisig_requests_created_at ON multisig_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_multisig_requests_pending ON multisig_requests(status, expires_at);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_multisig_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS multisig_requests_updated_at ON multisig_requests;
CREATE TRIGGER multisig_requests_updated_at
  BEFORE UPDATE ON multisig_requests
  FOR EACH ROW EXECUTE FUNCTION update_multisig_requests_updated_at();

-- Multi-sig signatures table
CREATE TABLE IF NOT EXISTS multisig_signatures (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID NOT NULL REFERENCES multisig_requests(id) ON DELETE CASCADE,
  signer_id VARCHAR(255) NOT NULL,
  signature_data TEXT NOT NULL,
  signature_type VARCHAR(50) NOT NULL CHECK (signature_type IN ('webhook', 'manual', 'api')),
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(request_id, signer_id)
);

CREATE INDEX IF NOT EXISTS idx_multisig_signatures_request ON multisig_signatures(request_id);
CREATE INDEX IF NOT EXISTS idx_multisig_signatures_signer ON multisig_signatures(signer_id);
CREATE INDEX IF NOT EXISTS idx_multisig_signatures_created_at ON multisig_signatures(created_at DESC);

-- Multi-sig audit log table
CREATE TABLE IF NOT EXISTS multisig_audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID REFERENCES multisig_requests(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  actor VARCHAR(255) NOT NULL,
  details JSONB DEFAULT '{}',
  ip_address VARCHAR(45),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_multisig_audit_request ON multisig_audit_log(request_id);
CREATE INDEX IF NOT EXISTS idx_multisig_audit_action ON multisig_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_multisig_audit_created_at ON multisig_audit_log(created_at DESC);

-- Insert default multi-sig configurations
INSERT INTO multisig_configs (account_type, account_id, required_signatures, total_signers, daily_cap_xaf, per_transaction_cap_xaf, time_lock_minutes)
VALUES
  ('escrow', 'default', 3, 5, 10000000.00, 5000000.00, 30),
  ('issuance', 'default', 2, 3, 5000000.00, 2000000.00, 15),
  ('vault', 'default', 2, 3, 3000000.00, 1500000.00, 15)
ON CONFLICT (account_type, account_id) DO NOTHING;

-- Insert default signers for escrow
INSERT INTO multisig_signers (config_id, signer_id, signer_name, signer_email, public_key, weight)
SELECT 
  'default',
  'admin-001',
  'Admin User 1',
  'admin1@example.com',
  'G' || encode(gen_random_bytes(32), 'hex'),
  1
FROM multisig_configs
WHERE account_type = 'escrow' AND account_id = 'default'
ON CONFLICT (config_id, signer_id) DO NOTHING;

-- Insert default signers for issuance
INSERT INTO multisig_signers (config_id, signer_id, signer_name, signer_email, public_key, weight)
SELECT 
  'default',
  'issuer-001',
  'Issuer Admin',
  'issuer@example.com',
  'G' || encode(gen_random_bytes(32), 'hex'),
  1
FROM multisig_configs
WHERE account_type = 'issuance' AND account_id = 'default'
ON CONFLICT (config_id, signer_id) DO NOTHING;
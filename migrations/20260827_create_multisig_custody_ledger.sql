-- Migration: Multi-Signature Custody Ledger System
-- Description: Requires M-of-N authorization signatures for large balance
--              movements (escrow/issuance/vault accounts) and admin
--              withdrawals. Backs src/services/multisigCustodyLedgerService.ts,
--              which already existed but had no matching migration in this
--              directory (an earlier draft, database/migrations/20240626_add_multisig_custody_ledger.sql,
--              was never wired into the migration runner — that directory
--              isn't read by src/scripts/migrate.ts).

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: multisig_configs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS multisig_configs (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  account_type            VARCHAR(50) NOT NULL CHECK (account_type IN ('escrow', 'issuance', 'vault')),
  account_id              VARCHAR(255) NOT NULL,
  required_signatures     INTEGER NOT NULL CHECK (required_signatures > 0),
  total_signers           INTEGER NOT NULL CHECK (total_signers >= required_signatures),
  daily_cap_xaf           DECIMAL(20, 7) NOT NULL,
  per_transaction_cap_xaf DECIMAL(20, 7) NOT NULL,
  time_lock_minutes       INTEGER NOT NULL DEFAULT 30,
  is_active               BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_type, account_id)
);

CREATE INDEX IF NOT EXISTS idx_multisig_configs_account ON multisig_configs(account_type, account_id);
CREATE INDEX IF NOT EXISTS idx_multisig_configs_active ON multisig_configs(is_active);

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

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: multisig_signers
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS multisig_signers (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  config_id      UUID NOT NULL REFERENCES multisig_configs(id) ON DELETE CASCADE,
  signer_id      VARCHAR(255) NOT NULL,
  signer_name    VARCHAR(255) NOT NULL,
  signer_email   VARCHAR(255),
  -- Stellar public key ("G...") or PEM-encoded public key used to verify
  -- this signer's approval signatures. Never store private key material here.
  public_key     VARCHAR(500) NOT NULL,
  weight         INTEGER NOT NULL DEFAULT 1,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(config_id, signer_id)
);

CREATE INDEX IF NOT EXISTS idx_multisig_signers_config ON multisig_signers(config_id);
CREATE INDEX IF NOT EXISTS idx_multisig_signers_active ON multisig_signers(is_active);

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

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: multisig_requests
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS multisig_requests (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  config_id            UUID NOT NULL REFERENCES multisig_configs(id),
  -- 'withdrawal' backs the admin withdrawal flow (src/routes/adminWithdrawals.ts);
  -- the other three predate it and cover generic ledger transfers.
  request_type         VARCHAR(50) NOT NULL CHECK (request_type IN ('transfer', 'issuance', 'vault_operation', 'withdrawal')),
  account_id           VARCHAR(255) NOT NULL,
  amount_xaf           DECIMAL(20, 7) NOT NULL CHECK (amount_xaf > 0),
  destination          VARCHAR(255) NOT NULL,
  metadata             JSONB NOT NULL DEFAULT '{}',
  status               VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired', 'executed')) DEFAULT 'pending',
  required_signatures  INTEGER NOT NULL,
  collected_signatures INTEGER NOT NULL DEFAULT 0,
  expires_at           TIMESTAMP NOT NULL,
  created_by           VARCHAR(255) NOT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  executed_at          TIMESTAMP,
  executed_by          VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_multisig_requests_config ON multisig_requests(config_id);
CREATE INDEX IF NOT EXISTS idx_multisig_requests_status ON multisig_requests(status);
CREATE INDEX IF NOT EXISTS idx_multisig_requests_created_at ON multisig_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_multisig_requests_pending ON multisig_requests(status, expires_at);

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

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: multisig_signatures
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS multisig_signatures (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id      UUID NOT NULL REFERENCES multisig_requests(id) ON DELETE CASCADE,
  signer_id       VARCHAR(255) NOT NULL,
  signature_data  TEXT NOT NULL,
  signature_type  VARCHAR(50) NOT NULL CHECK (signature_type IN ('webhook', 'manual', 'api')),
  ip_address      VARCHAR(45),
  user_agent      TEXT,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(request_id, signer_id)
);

CREATE INDEX IF NOT EXISTS idx_multisig_signatures_request ON multisig_signatures(request_id);
CREATE INDEX IF NOT EXISTS idx_multisig_signatures_signer ON multisig_signatures(signer_id);
CREATE INDEX IF NOT EXISTS idx_multisig_signatures_created_at ON multisig_signatures(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: multisig_audit_log
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS multisig_audit_log (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id  UUID REFERENCES multisig_requests(id) ON DELETE SET NULL,
  action      VARCHAR(100) NOT NULL,
  actor       VARCHAR(255) NOT NULL,
  details     JSONB NOT NULL DEFAULT '{}',
  ip_address  VARCHAR(45),
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_multisig_audit_request ON multisig_audit_log(request_id);
CREATE INDEX IF NOT EXISTS idx_multisig_audit_action ON multisig_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_multisig_audit_created_at ON multisig_audit_log(created_at DESC);

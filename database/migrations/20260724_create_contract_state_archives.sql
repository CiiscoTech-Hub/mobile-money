CREATE TABLE IF NOT EXISTS contract_state_archives (
  id BIGSERIAL PRIMARY KEY,
  contract_id TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  ledger BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  event_name TEXT,
  event_details JSONB,
  snapshot_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contract_state_archives_contract_id_created_at
  ON contract_state_archives (contract_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contract_state_archives_tx_hash
  ON contract_state_archives (tx_hash);

-- Optimize transaction queries that filter by status and provider before
-- ordering by the keyset pagination columns.

CREATE INDEX IF NOT EXISTS idx_transactions_status_provider_created_id
  ON transactions (status, provider, created_at DESC, id DESC);


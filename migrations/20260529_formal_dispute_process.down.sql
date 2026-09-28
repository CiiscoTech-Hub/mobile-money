-- Rollback: 20260529_formal_dispute_process
-- Reverts dispute process changes including status constraints, columns, and tables

-- Drop newly created tables
DROP INDEX IF EXISTS idx_dispute_timeline_created_at;
DROP INDEX IF EXISTS idx_dispute_timeline_dispute_id;
DROP INDEX IF EXISTS idx_dispute_evidence_dispute_id;
DROP TABLE IF EXISTS dispute_timeline;
DROP TABLE IF EXISTS dispute_evidence;

-- Remove added columns from disputes table
ALTER TABLE disputes DROP COLUMN IF EXISTS internal_notes;
ALTER TABLE disputes DROP COLUMN IF EXISTS sla_warning_sent;
ALTER TABLE disputes DROP COLUMN IF EXISTS sla_due_date;
ALTER TABLE disputes DROP COLUMN IF EXISTS category;
ALTER TABLE disputes DROP COLUMN IF EXISTS priority;
ALTER TABLE disputes DROP CONSTRAINT IF EXISTS disputes_priority_check;

-- Restore original disputes status check
ALTER TABLE disputes DROP CONSTRAINT IF EXISTS disputes_status_check;
ALTER TABLE disputes
  ADD CONSTRAINT disputes_status_check
  CHECK (status IN ('open', 'investigating', 'resolved', 'rejected'));

-- Restore original transactions status check
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_status_check;
ALTER TABLE transactions
  ADD CONSTRAINT transactions_status_check
  CHECK (status IN ('pending', 'completed', 'failed', 'cancelled', 'clawed_back'));

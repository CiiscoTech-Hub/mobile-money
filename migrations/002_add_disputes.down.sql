-- Rollback: 002_add_disputes
-- Drops disputes and dispute_notes tables

DROP TRIGGER IF EXISTS disputes_updated_at ON disputes;
DROP FUNCTION IF EXISTS update_disputes_updated_at();
DROP INDEX IF EXISTS idx_dispute_notes_dispute_id;
DROP INDEX IF EXISTS idx_disputes_created_at;
DROP INDEX IF EXISTS idx_disputes_assigned_to;
DROP INDEX IF EXISTS idx_disputes_status;
DROP INDEX IF EXISTS idx_disputes_transaction_id;
DROP INDEX IF EXISTS idx_disputes_open_transaction;
DROP TABLE IF EXISTS dispute_notes;
DROP TABLE IF EXISTS disputes;


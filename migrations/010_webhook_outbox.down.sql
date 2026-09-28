-- Rollback: 010_webhook_outbox
-- Drops webhook_outbox table

DROP INDEX IF EXISTS idx_webhook_outbox_status_next_retry;
DROP TABLE IF EXISTS webhook_outbox;


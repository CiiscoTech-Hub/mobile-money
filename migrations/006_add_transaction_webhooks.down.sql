-- Rollback: 006_add_transaction_webhooks
-- Removes webhook delivery tracking fields from transactions

ALTER TABLE transactions DROP COLUMN IF EXISTS webhook_delivery_status;
ALTER TABLE transactions DROP COLUMN IF EXISTS webhook_last_attempt_at;
ALTER TABLE transactions DROP COLUMN IF EXISTS webhook_delivered_at;
ALTER TABLE transactions DROP COLUMN IF EXISTS webhook_last_error;


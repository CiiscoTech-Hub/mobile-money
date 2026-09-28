-- Rollback: 20260529_create_merchant_webhooks
-- Drops merchant_webhooks and webhook_delivery_logs tables

DROP INDEX IF EXISTS idx_webhook_delivery_logs_status;
DROP INDEX IF EXISTS idx_webhook_delivery_logs_webhook_id;
DROP TABLE IF EXISTS webhook_delivery_logs;
DROP INDEX IF EXISTS idx_merchant_webhooks_active;
DROP INDEX IF EXISTS idx_merchant_webhooks_user_id;
DROP TABLE IF EXISTS merchant_webhooks;

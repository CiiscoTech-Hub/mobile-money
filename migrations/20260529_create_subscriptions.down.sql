-- Rollback: 20260529_create_subscriptions
-- Drops subscriptions and subscription_attempts tables, removes subscription_id from transactions

DROP INDEX IF EXISTS idx_transactions_subscription_id;
ALTER TABLE transactions DROP COLUMN IF EXISTS subscription_id;
DROP INDEX IF EXISTS idx_subscription_attempts_subscription_id;
DROP TABLE IF EXISTS subscription_attempts;
DROP INDEX IF EXISTS idx_subscriptions_merchant_id;
DROP INDEX IF EXISTS idx_subscriptions_next_run_at;
DROP TABLE IF EXISTS subscriptions;

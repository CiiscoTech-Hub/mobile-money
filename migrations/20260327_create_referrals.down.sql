-- Rollback: 20260327_create_referrals
-- Drops referrals table

DROP INDEX IF EXISTS idx_referrals_referred_by;
DROP INDEX IF EXISTS idx_referrals_user_id;
DROP TABLE IF EXISTS referrals;


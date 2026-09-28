-- Rollback: 20260424_create_daily_snapshots
-- Drops daily_snapshots table

DROP INDEX IF EXISTS idx_daily_snapshots_date;
DROP TABLE IF EXISTS daily_snapshots;

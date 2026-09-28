-- Migration: 20260723_partition_logs
-- Description: Design database partition script for transaction logs.
--              Partitions transaction_logs table entries by month (RANGE on created_at),
--              improving read latency and log maintenance efficiency.

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1: Ensure base table exists (if unpartitioned) and normalize columns.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transaction_logs (
    id             UUID                     NOT NULL DEFAULT gen_random_uuid(),
    transaction_id UUID,
    user_id        UUID,
    action         VARCHAR(100)             NOT NULL,
    status         VARCHAR(50)              NOT NULL,
    message        TEXT,
    metadata       JSONB                    DEFAULT '{}',
    ip_address     VARCHAR(45),
    user_agent     TEXT,
    created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Backfill any NULL timestamps and enforce NOT NULL (required for partition key)
UPDATE transaction_logs SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL;
ALTER TABLE transaction_logs ALTER COLUMN created_at SET NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2: Zero-downtime conversion of transaction_logs to partitioned parent.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_is_partitioned BOOLEAN := FALSE;
BEGIN
  SELECT (c.relkind = 'p') INTO v_is_partitioned
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'transaction_logs'
    AND n.nspname = current_schema();

  IF NOT v_is_partitioned THEN
    -- Rename existing unpartitioned table to legacy
    ALTER TABLE transaction_logs RENAME TO transaction_logs_legacy;

    -- Create partitioned parent table
    CREATE TABLE transaction_logs (
      id             UUID                     NOT NULL DEFAULT gen_random_uuid(),
      transaction_id UUID,
      user_id        UUID,
      action         VARCHAR(100)             NOT NULL,
      status         VARCHAR(50)              NOT NULL,
      message        TEXT,
      metadata       JSONB                    DEFAULT '{}',
      ip_address     VARCHAR(45),
      user_agent     TEXT,
      created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) PARTITION BY RANGE (created_at);

    -- Attach existing table as DEFAULT partition to ensure all historical logs remain intact
    ALTER TABLE transaction_logs ATTACH PARTITION transaction_logs_legacy DEFAULT;
  END IF;
END$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3: Helper function to create monthly partition structures.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_monthly_log_partition(partition_date TIMESTAMP WITH TIME ZONE)
RETURNS TEXT AS $func$
DECLARE
  month_start    DATE;
  month_end      DATE;
  partition_name TEXT;
BEGIN
  month_start    := date_trunc('month', partition_date)::DATE;
  month_end      := (month_start + INTERVAL '1 month')::DATE;
  partition_name := 'transaction_logs_' || to_char(month_start, 'YYYY_MM');

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = partition_name
      AND n.nspname = current_schema()
  ) THEN
    BEGIN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF transaction_logs
         FOR VALUES FROM (%L) TO (%L)',
        partition_name,
        month_start,
        month_end
      );
      RAISE NOTICE 'Created monthly transaction log partition: %', partition_name;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipped partition creation for %: %', partition_name, SQLERRM;
    END;
  END IF;

  RETURN partition_name;
END;
$func$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 4: Pre-create monthly partition structures (past, current, next 3 months).
-- ─────────────────────────────────────────────────────────────────────────────
SELECT create_monthly_log_partition((date_trunc('month', CURRENT_TIMESTAMP) - INTERVAL '1 month')::TIMESTAMPTZ);
SELECT create_monthly_log_partition(date_trunc('month', CURRENT_TIMESTAMP)::TIMESTAMPTZ);
SELECT create_monthly_log_partition((date_trunc('month', CURRENT_TIMESTAMP) + INTERVAL '1 month')::TIMESTAMPTZ);
SELECT create_monthly_log_partition((date_trunc('month', CURRENT_TIMESTAMP) + INTERVAL '2 month')::TIMESTAMPTZ);
SELECT create_monthly_log_partition((date_trunc('month', CURRENT_TIMESTAMP) + INTERVAL '3 month')::TIMESTAMPTZ);

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 5: Write partition routing trigger to dynamically handle new insertions.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION route_transaction_logs_partition()
RETURNS TRIGGER AS $func$
DECLARE
  target_date TIMESTAMP WITH TIME ZONE;
BEGIN
  target_date := COALESCE(NEW.created_at, CURRENT_TIMESTAMP);
  NEW.created_at := target_date;

  -- Ensure the partition for the log entry's date exists before insertion
  PERFORM create_monthly_log_partition(target_date);

  RETURN NEW;
END;
$func$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_route_transaction_logs ON transaction_logs;
CREATE TRIGGER trg_route_transaction_logs
  BEFORE INSERT ON transaction_logs
  FOR EACH ROW EXECUTE FUNCTION route_transaction_logs_partition();

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 6: Recreate performance indexes on partitioned parent table.
--         Indexes propagate automatically to all current and future partitions.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_transaction_logs_created_at
  ON transaction_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transaction_logs_transaction_id
  ON transaction_logs (transaction_id)
  WHERE transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transaction_logs_user_id
  ON transaction_logs (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transaction_logs_action_created
  ON transaction_logs (action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transaction_logs_metadata
  ON transaction_logs USING GIN (metadata);

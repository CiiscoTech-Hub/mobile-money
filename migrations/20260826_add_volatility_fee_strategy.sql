-- Migration: Add volatility-based fee strategy support (1/2)
-- Description: Extends the Dynamic Fee Strategy Engine (see
--              20260424_create_fee_strategies.sql) with a "volatility_based"
--              strategy type that prices transactions using a surcharge
--              derived from recent asset price volatility (coefficient of
--              variation of historical price snapshots), on top of the
--              existing flat/percentage/time_based/volume_based types.
--
-- Split into two migrations: PostgreSQL forbids using a newly-added enum
-- value (e.g. in a CHECK constraint) within the same transaction that added
-- it ("unsafe use of new value ... of enum type"). The supporting columns
-- and constraint that reference 'volatility_based' live in the companion
-- 20260826_add_volatility_fee_strategy_columns.sql migration instead.

-- ─────────────────────────────────────────────────────────────────────────────
-- ENUM: add 'volatility_based' to fee_strategy_type
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TYPE fee_strategy_type ADD VALUE IF NOT EXISTS 'volatility_based';

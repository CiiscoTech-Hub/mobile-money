-- Migration: Add volatility-based fee strategy support (2/2)
-- Description: Supporting columns and constraint for the 'volatility_based'
--              fee_strategy_type value added in the companion
--              20260826_add_volatility_fee_strategy.sql migration. Split out
--              because PostgreSQL forbids referencing a brand-new enum value
--              (e.g. in a CHECK constraint) within the same transaction that
--              added it.

-- ─────────────────────────────────────────────────────────────────────────────
-- COLUMNS: volatility strategy parameters
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE fee_strategies
  ADD COLUMN IF NOT EXISTS volatility_base_currency  VARCHAR(10),
  ADD COLUMN IF NOT EXISTS volatility_quote_currency VARCHAR(10),
  -- Multiplier applied to the coefficient of variation (%) to derive the surcharge
  ADD COLUMN IF NOT EXISTS volatility_multiplier     DECIMAL(8,4) DEFAULT 1.0,
  -- Lookback window (hours) used to compute volatility from historical_prices
  ADD COLUMN IF NOT EXISTS volatility_window_hours   INTEGER DEFAULT 24;

ALTER TABLE fee_strategies
  DROP CONSTRAINT IF EXISTS chk_volatility_currencies;
ALTER TABLE fee_strategies
  ADD CONSTRAINT chk_volatility_currencies
  CHECK (
    strategy_type != 'volatility_based'
    OR (volatility_base_currency IS NOT NULL AND volatility_quote_currency IS NOT NULL)
  );

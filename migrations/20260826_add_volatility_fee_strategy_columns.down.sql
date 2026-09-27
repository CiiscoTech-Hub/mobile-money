-- Rollback: Remove volatility-based fee strategy columns/constraint (2/2)

ALTER TABLE fee_strategies
  DROP CONSTRAINT IF EXISTS chk_volatility_currencies;

ALTER TABLE fee_strategies
  DROP COLUMN IF EXISTS volatility_base_currency,
  DROP COLUMN IF EXISTS volatility_quote_currency,
  DROP COLUMN IF EXISTS volatility_multiplier,
  DROP COLUMN IF EXISTS volatility_window_hours;

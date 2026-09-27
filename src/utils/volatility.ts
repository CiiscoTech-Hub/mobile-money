/**
 * Asset volatility helpers.
 *
 * Computes a coefficient-of-variation (stddev / mean) over recent historical
 * price snapshots for a currency pair. This is used as a lightweight
 * volatility proxy by both the exchange rate buffer service (dynamic spread)
 * and the fee strategy engine's volatility-based fee strategy.
 */

import {
  findRange,
  type CurrencyCode,
  type HistoricalPriceRow,
} from "../models/historicalPrice";

export interface VolatilityMetrics {
  mean: number;
  stddev: number;
  /** Coefficient of variation, expressed as a percentage (stddev / mean * 100). */
  coefficientOfVariation: number;
  sampleSize: number;
}

/**
 * Compute volatility metrics for a currency pair over a lookback window.
 * Returns null when fewer than 2 price snapshots are available in the
 * window — the caller should fall back to a static default in that case.
 */
export async function computeVolatility(
  baseCurrency: CurrencyCode,
  quoteCurrency: CurrencyCode,
  windowHours = 24,
): Promise<VolatilityMetrics | null> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowHours * 60 * 60 * 1000);

  const snapshots: HistoricalPriceRow[] = await findRange(
    baseCurrency,
    quoteCurrency,
    windowStart,
    now,
  );

  if (!snapshots || snapshots.length < 2) return null;

  const prices = snapshots.map((s) => s.price);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance =
    prices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / prices.length;
  const stddev = Math.sqrt(variance);
  const coefficientOfVariation = mean === 0 ? 0 : (stddev / mean) * 100;

  return {
    mean,
    stddev,
    coefficientOfVariation,
    sampleSize: prices.length,
  };
}

/**
 * Dynamic Spread Service – Issue #1631
 *
 * Implements a financial algorithm that dynamically scales transaction cost
 * spreads based on two key dimensions:
 *
 *   1. **Liquidity depth** (30-day payout volume per provider from the ledger):
 *      High volume  → tighter spread  (market is liquid, lower cost to hedge)
 *      Low volume   → wider spread    (illiquid market, higher inventory risk)
 *
 *   2. **Telecom provider settlement time** (from provider_settings.timeout_ms):
 *      Faster settlement → tighter spread (less funding cost / counterparty risk)
 *      Slower settlement → wider spread   (capital tied up longer, more risk)
 *
 * Final spread formula:
 *   spread = BASE_SPREAD_PCT
 *            × liquidityScaleFactor(volume)
 *            × settlementScaleFactor(settlementMs)
 *
 * Both scale factors are clamped to configurable min/max bounds so the
 * spread never goes below the platform's cost floor or above a ceiling
 * that would make rates uncompetitive.
 */

import { pool } from "../config/database";
import { providerSettingsService } from "./providerSettingsService";
import logger from "../utils/logger";

// ─────────────────────────────────────────────────────────────────────────────
// Constants & tuneable parameters
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base spread percentage applied before any scaling (e.g. 1.5 %).
 * Override via DYNAMIC_SPREAD_BASE_PCT env var.
 */
const BASE_SPREAD_PCT = parseFloat(
  process.env.DYNAMIC_SPREAD_BASE_PCT ?? "1.5",
);

/**
 * Reference liquidity volume (USD equivalent) representing a "normal"
 * market.  Volumes above this reduce the spread; below it increase the spread.
 * Override via DYNAMIC_SPREAD_REFERENCE_VOLUME env var.
 */
const REFERENCE_VOLUME_USD = parseFloat(
  process.env.DYNAMIC_SPREAD_REFERENCE_VOLUME ?? "100000",
);

/**
 * Reference settlement time in milliseconds representing typical settlement
 * (e.g. 30 seconds = 30_000 ms). Faster → lower penalty; slower → higher.
 * Override via DYNAMIC_SPREAD_REFERENCE_SETTLEMENT_MS env var.
 */
const REFERENCE_SETTLEMENT_MS = parseFloat(
  process.env.DYNAMIC_SPREAD_REFERENCE_SETTLEMENT_MS ?? "30000",
);

/**
 * Rate at which the settlement penalty increases per millisecond of extra delay.
 * Default: every additional second of settlement time adds 0.00001 % to spread.
 * Override via DYNAMIC_SPREAD_SETTLEMENT_PENALTY env var.
 */
const SETTLEMENT_PENALTY_PER_MS = parseFloat(
  process.env.DYNAMIC_SPREAD_SETTLEMENT_PENALTY ?? "0.00001",
);

/** Minimum total spread the algorithm can produce (platform cost floor). */
const MIN_SPREAD_PCT = parseFloat(process.env.DYNAMIC_SPREAD_MIN_PCT ?? "0.3");

/** Maximum total spread the algorithm can produce (competitive ceiling). */
const MAX_SPREAD_PCT = parseFloat(
  process.env.DYNAMIC_SPREAD_MAX_PCT ?? "8.0",
);

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface SpreadInputs {
  /** Mobile money provider identifier (e.g. 'mtn', 'airtel') */
  provider: string;
  /** Source currency code (e.g. 'NGN') */
  fromCurrency: string;
  /** Destination currency code (e.g. 'USD') */
  toCurrency: string;
  /**
   * Optional: override the liquidity volume (USD equivalent) for this
   * provider.  If omitted, the service queries the ledger for the 30-day
   * payout volume.
   */
  liquidityVolumeUsd?: number;
  /**
   * Optional: override the settlement time in milliseconds.
   * If omitted, the service reads `timeout_ms` from provider_settings.
   */
  settlementTimeMs?: number;
}

export interface SpreadResult {
  /** The final spread percentage to apply to the raw exchange rate */
  spreadPct: number;
  /** The raw mid-market rate provided by the caller */
  rawRate: number;
  /** The rate after dynamic spread is applied (sell direction: rate / (1+spread)) */
  adjustedRate: number;
  /** Breakdown of how the spread was calculated */
  breakdown: {
    baseSpreadPct: number;
    liquidityVolumeUsd: number;
    liquidityScaleFactor: number;
    settlementTimeMs: number;
    settlementScaleFactor: number;
  };
  provider: string;
  currencyPair: string;
  direction: "sell" | "buy";
  calculatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Algorithm helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the liquidity scale factor.
 *
 * Uses an inverse-logarithmic curve so that:
 *   - Very high volume (>>REFERENCE_VOLUME) → factor approaches 0 (tight spread)
 *   - Volume at REFERENCE_VOLUME → factor ≈ 1 (no adjustment to base spread)
 *   - Very low volume (→ 0) → factor approaches MAX_LIQUIDITY_FACTOR (wide spread)
 *
 * Formula:
 *   normalised = volume / REFERENCE_VOLUME
 *   factor = log(1 + REFERENCE_VOLUME) / log(1 + volume)   [clamped]
 */
export function computeLiquidityScaleFactor(volumeUsd: number): number {
  const MIN_VOLUME = 1; // avoid log(0)
  const safeVolume = Math.max(volumeUsd, MIN_VOLUME);

  // At reference volume the ratio = 1; above → < 1; below → > 1
  const factor =
    Math.log(1 + REFERENCE_VOLUME_USD) / Math.log(1 + safeVolume);

  // Clamp: never compress spread below 20% of base, never expand more than 4×
  return Math.min(Math.max(factor, 0.2), 4.0);
}

/**
 * Compute the settlement time scale factor.
 *
 * Uses a linear penalty above the reference settlement time:
 *   factor = 1 + (settlementMs - REFERENCE_SETTLEMENT_MS) × PENALTY_RATE
 *
 * Fast settlement (< reference) yields a small discount (< 1.0).
 * Slow settlement (> reference) yields a penalty surcharge (> 1.0).
 */
export function computeSettlementScaleFactor(settlementMs: number): number {
  const delta = settlementMs - REFERENCE_SETTLEMENT_MS;
  const factor = 1 + delta * SETTLEMENT_PENALTY_PER_MS;

  // Clamp: never reduce spread by more than 30% or inflate by more than 3×
  return Math.min(Math.max(factor, 0.7), 3.0);
}

/**
 * Apply the combined scale factors and clamp to global bounds.
 */
export function computeSpread(
  liquidityFactor: number,
  settlementFactor: number,
): number {
  const raw = BASE_SPREAD_PCT * liquidityFactor * settlementFactor;
  return Math.min(Math.max(raw, MIN_SPREAD_PCT), MAX_SPREAD_PCT);
}

// ─────────────────────────────────────────────────────────────────────────────
// Liquidity volume query
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch 30-day payout volume for a provider from the ledger_entries table.
 * Returns 0 if no data is available (treated as an illiquid market).
 */
async function fetchProviderLiquidityVolume(provider: string): Promise<number> {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await pool.query<{ volume: string }>(
      `SELECT COALESCE(SUM(le.credit_amount), 0) AS volume
       FROM ledger_entries le
       JOIN accounts a ON le.account_id = a.id
       WHERE a.code = '1100'
         AND le.entry_date >= $1
         AND (le.metadata->>'provider' = $2 OR le.metadata->>'provider' IS NULL AND $2 = 'unknown')`,
      [since, provider.toLowerCase()],
    );
    return parseFloat(result.rows[0]?.volume ?? "0") || 0;
  } catch (err) {
    logger.warn(
      { err, provider },
      "[DynamicSpread] Failed to fetch liquidity volume, defaulting to 0",
    );
    return 0;
  }
}

/**
 * Fetch settlement time for a provider from provider_settings.
 * Falls back to REFERENCE_SETTLEMENT_MS if the provider has no config.
 */
async function fetchProviderSettlementTime(provider: string): Promise<number> {
  try {
    const settings = await providerSettingsService.getProviderSettings(
      provider,
    );
    return settings?.timeout_ms ?? REFERENCE_SETTLEMENT_MS;
  } catch (err) {
    logger.warn(
      { err, provider },
      "[DynamicSpread] Failed to fetch settlement time, using reference value",
    );
    return REFERENCE_SETTLEMENT_MS;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Service class
// ─────────────────────────────────────────────────────────────────────────────

export class DynamicSpreadService {
  /**
   * Calculate the dynamic spread for a rate query.
   *
   * @param rawRate    The mid-market exchange rate (e.g., 1550 NGN/USD)
   * @param inputs     Spread parameters (provider, currencies, optional overrides)
   * @param direction  'sell' = user sells fromCurrency (platform buys)
   *                   'buy'  = user buys fromCurrency (platform sells)
   */
  async calculateSpread(
    rawRate: number,
    inputs: SpreadInputs,
    direction: "sell" | "buy" = "sell",
  ): Promise<SpreadResult> {
    const { provider, fromCurrency, toCurrency } = inputs;

    // Resolve liquidity volume (use override or query ledger)
    const liquidityVolumeUsd =
      inputs.liquidityVolumeUsd !== undefined
        ? inputs.liquidityVolumeUsd
        : await fetchProviderLiquidityVolume(provider);

    // Resolve settlement time (use override or query provider_settings)
    const settlementTimeMs =
      inputs.settlementTimeMs !== undefined
        ? inputs.settlementTimeMs
        : await fetchProviderSettlementTime(provider);

    // Compute individual scale factors
    const liquidityScaleFactor =
      computeLiquidityScaleFactor(liquidityVolumeUsd);
    const settlementScaleFactor =
      computeSettlementScaleFactor(settlementTimeMs);

    // Combine into final spread
    const spreadPct = computeSpread(liquidityScaleFactor, settlementScaleFactor);

    // Apply spread to raw rate
    // sell: user gets less  → divide by (1 + spread/100)
    // buy:  user pays more  → multiply by (1 + spread/100)
    const multiplier = 1 + spreadPct / 100;
    const adjustedRate =
      direction === "sell" ? rawRate / multiplier : rawRate * multiplier;

    logger.info(
      {
        provider,
        pair: `${fromCurrency}_${toCurrency}`,
        liquidityVolumeUsd,
        settlementTimeMs,
        liquidityScaleFactor: liquidityScaleFactor.toFixed(4),
        settlementScaleFactor: settlementScaleFactor.toFixed(4),
        spreadPct: spreadPct.toFixed(4),
        rawRate,
        adjustedRate: adjustedRate.toFixed(7),
        direction,
      },
      "[DynamicSpread] Spread calculated",
    );

    return {
      spreadPct: Math.round(spreadPct * 1e6) / 1e6,
      rawRate,
      adjustedRate: Math.round(adjustedRate * 1e7) / 1e7,
      breakdown: {
        baseSpreadPct: BASE_SPREAD_PCT,
        liquidityVolumeUsd,
        liquidityScaleFactor: Math.round(liquidityScaleFactor * 1e6) / 1e6,
        settlementTimeMs,
        settlementScaleFactor: Math.round(settlementScaleFactor * 1e6) / 1e6,
      },
      provider,
      currencyPair: `${fromCurrency}_${toCurrency}`,
      direction,
      calculatedAt: new Date().toISOString(),
    };
  }

  /**
   * Get the current spread parameters for a provider without applying them
   * to a rate.  Useful for dashboards / debugging.
   */
  async getSpreadParameters(
    provider: string,
    liquidityVolumeUsd?: number,
    settlementTimeMs?: number,
  ): Promise<{
    provider: string;
    baseSpreadPct: number;
    liquidityVolumeUsd: number;
    liquidityScaleFactor: number;
    settlementTimeMs: number;
    settlementScaleFactor: number;
    effectiveSpreadPct: number;
    minSpreadPct: number;
    maxSpreadPct: number;
  }> {
    const volume =
      liquidityVolumeUsd !== undefined
        ? liquidityVolumeUsd
        : await fetchProviderLiquidityVolume(provider);

    const settlement =
      settlementTimeMs !== undefined
        ? settlementTimeMs
        : await fetchProviderSettlementTime(provider);

    const liquidityScaleFactor = computeLiquidityScaleFactor(volume);
    const settlementScaleFactor = computeSettlementScaleFactor(settlement);
    const effectiveSpreadPct = computeSpread(
      liquidityScaleFactor,
      settlementScaleFactor,
    );

    return {
      provider,
      baseSpreadPct: BASE_SPREAD_PCT,
      liquidityVolumeUsd: volume,
      liquidityScaleFactor: Math.round(liquidityScaleFactor * 1e6) / 1e6,
      settlementTimeMs: settlement,
      settlementScaleFactor: Math.round(settlementScaleFactor * 1e6) / 1e6,
      effectiveSpreadPct: Math.round(effectiveSpreadPct * 1e6) / 1e6,
      minSpreadPct: MIN_SPREAD_PCT,
      maxSpreadPct: MAX_SPREAD_PCT,
    };
  }
}

export const dynamicSpreadService = new DynamicSpreadService();

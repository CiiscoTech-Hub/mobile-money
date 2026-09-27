import logger from "../utils/logger";
import axios from "axios";
import {
  exchangeRateBufferService,
  BufferedRate,
} from "./exchangeRateBufferService";
import {
  dynamicSpreadService,
  SpreadInputs,
  SpreadResult,
} from "./dynamicSpreadService";

// ---------------------------------------------------------------------------
// Supported currencies
// ---------------------------------------------------------------------------

export const SUPPORTED_CURRENCIES = [
  "USD",
  "XAF",
  "NGN",
  "KES",
  "GHS",
  "TZS",
  "ZMW",
  "RWF",
  "GNF",
  "MGA",
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

/** All exchange rates expressed as units-per-USD (i.e. USD = 1). */
type ExchangeRates = Record<string, number>;

/** Base currency for all conversions (stored amounts are in this currency). */
export const BASE_CURRENCY: SupportedCurrency = "USD";

// ---------------------------------------------------------------------------
// Internal API response shape (exchangerate-api.com v6)
// ---------------------------------------------------------------------------

interface ExchangeRateApiResponse {
  result: "success" | "error";
  "error-type"?: string;
  base_code: string;
  conversion_rates: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ConversionResult {
  originalAmount: number;
  originalCurrency: SupportedCurrency;
  convertedAmount: number;
  baseCurrency: SupportedCurrency;
  /** Rate applied: how many baseCurrency units equal 1 originalCurrency unit. */
  rate: number;
  buffer?: {
    bufferPct: number;
    bufferedAmount: number;
    rawAmount: number;
  };
}

export interface CurrencyServiceStatus {
  cachePopulated: boolean;
  isStale: boolean;
  lastUpdated: Date | null;
  usingFallback: boolean;
  rates: ExchangeRates;
}

// ---------------------------------------------------------------------------
// Static fallback rates (approximate — updated 2025 Q1)
// Used when the API is unavailable to ensure the service degrades gracefully.
// ---------------------------------------------------------------------------

const FALLBACK_RATES: ExchangeRates = {
  USD: 1,
  XAF: 600, // Central African CFA franc (pegged to EUR/USD)
  NGN: 1550, // Nigerian Naira
  KES: 130, // Kenyan Shilling
  GHS: 15, // Ghanaian Cedi
  TZS: 2600, // Tanzanian Shilling
  ZMW: 27, // Zambian Kwacha
  RWF: 1320, // Rwandan Franc
  GNF: 8500, // Guinean Franc
  MGA: 4500, // Malagasy Ariary
};

// ---------------------------------------------------------------------------
// CurrencyService
// ---------------------------------------------------------------------------

export class CurrencyService {
  private readonly apiBaseUrl = "https://v6.exchangerate-api.com/v6";
  private readonly cacheTtlMs = 60 * 60 * 1000; // 1 hour
  private readonly fetchTimeoutMs = 10_000;

  private cache: { rates: ExchangeRates; fetchedAt: Date } | null = null;
  private usingFallback = false;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Fetch initial rates and schedule hourly refreshes.
   * Call this once during application startup.
   */
  async initialize(): Promise<void> {
    await this.fetchRates();

    this.refreshTimer = setInterval(() => {
      this.fetchRates().catch((err: Error) => {
        logger.error(
          "[CurrencyService] Scheduled rate refresh failed:",
          err.message,
        );
      });
    }, this.cacheTtlMs);
  }

  /** Stop the background refresh timer (call during graceful shutdown). */
  shutdown(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Public query methods
  // -------------------------------------------------------------------------

  isSupportedCurrency(currency: string): currency is SupportedCurrency {
    return (SUPPORTED_CURRENCIES as readonly string[]).includes(currency);
  }

  /**
   * Convert `amount` from `from` currency to `to` currency.
   * Throws if either currency has no known rate.
   */
  convert(
    amount: number,
    from: SupportedCurrency,
    to: SupportedCurrency,
  ): ConversionResult {
    if (amount < 0) throw new Error("Amount must be non-negative");

    const rates = this.getRates();

    if (rates[from] === undefined)
      throw new Error(`No exchange rate for source currency: ${from}`);
    if (rates[to] === undefined)
      throw new Error(`No exchange rate for destination currency: ${to}`);

    // Convert via USD base: amount * (rates[to] / rates[from])
    const rateInUsd = rates[from];
    const rateOutUsd = rates[to];
    const effectiveRate = rateOutUsd / rateInUsd;

    const convertedAmount = amount * effectiveRate;

    return {
      originalAmount: amount,
      originalCurrency: from,
      convertedAmount,
      baseCurrency: BASE_CURRENCY,
      rate: effectiveRate,
    };
  }

  /**
   * Convert with dynamic spread scaling (liquidity depth + settlement time).
   */
  async convertWithDynamicSpread(
    amount: number,
    from: SupportedCurrency,
    to: SupportedCurrency,
    provider: string,
    direction: "sell" | "buy" = "sell",
    overrides?: { liquidityVolumeUsd?: number; settlementTimeMs?: number },
  ): Promise<{
    originalAmount: number;
    originalCurrency: SupportedCurrency;
    convertedAmount: number;
    baseCurrency: SupportedCurrency;
    rate: number;
    spreadResult: SpreadResult;
  }> {
    const baseConversion = this.convert(amount, from, to);
    const spreadResult = await dynamicSpreadService.calculateSpread(
      baseConversion.rate,
      {
        provider,
        fromCurrency: from,
        toCurrency: to,
        liquidityVolumeUsd: overrides?.liquidityVolumeUsd,
        settlementTimeMs: overrides?.settlementTimeMs,
      },
      direction,
    );

    return {
      ...baseConversion,
      convertedAmount: spreadResult.adjustedRate * amount,
      rate: spreadResult.adjustedRate,
      spreadResult,
    };
  }

  convertWithBuffer(
    amount: number,
    from: SupportedCurrency,
    to: SupportedCurrency,
    _provider?: string,
    _direction: "sell" | "buy" = "sell",
  ): ConversionResult {
    return this.convert(amount, from, to);
  }

  convertToBase(amount: number, from: SupportedCurrency): ConversionResult {
    return this.convert(amount, from, BASE_CURRENCY);
  }

  getRates(): ExchangeRates {
    if (this.cache && !this.isStale()) {
      return this.cache.rates;
    }
    return FALLBACK_RATES;
  }

  isStale(): boolean {
    if (!this.cache) return true;
    const age = Date.now() - this.cache.fetchedAt.getTime();
    return age > this.cacheTtlMs;
  }

  private async fetchRates(): Promise<void> {
    // Placeholder for rate fetching implementation
    this.cache = {
      rates: FALLBACK_RATES,
      fetchedAt: new Date(),
    };
  }
}

export const currencyService = new CurrencyService();

/**
 * Frontend Transaction Fee Calculator
 *
 * Pure-JavaScript module that mirrors the fee logic from src/utils/fees.ts
 * for use in browser-based calculator components.
 *
 * Rules (matching backend defaults):
 *   - Fee  = amount × (feePercentage / 100)
 *   - Fee  = max(fee, feeMinimum)
 *   - Fee  = min(fee, feeMaximum)
 *   - Total = amount + fee
 *
 * VIP tier discounts are applied by multiplying the effective rate by
 * (1 - discountPercent / 100) before the min/max clamp.
 */

"use strict";

// ---------------------------------------------------------------------------
// Default configuration (matches backend env defaults)
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = {
  feePercentage: 1.5,   // %
  feeMinimum:    50,    // base currency units
  feeMaximum:    5000,  // base currency units
};

// ---------------------------------------------------------------------------
// VIP tier table (matches VIP_TIERS in src/utils/fees.ts)
// ---------------------------------------------------------------------------

const VIP_TIERS = [
  { tier: "DIAMOND",  minVolume: 50_000, discountPercent: 65 },
  { tier: "PLATINUM", minVolume: 20_000, discountPercent: 50 },
  { tier: "GOLD",     minVolume:  5_000, discountPercent: 35 },
  { tier: "SILVER",   minVolume:  1_000, discountPercent: 20 },
  { tier: "STANDARD", minVolume:      0, discountPercent:  0 },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Calculate fee for a given amount using the provided config.
 *
 * @param {number} amount         Transaction amount (≥ 0)
 * @param {object} [config]       Optional fee configuration overrides
 * @param {number} [config.feePercentage]
 * @param {number} [config.feeMinimum]
 * @param {number} [config.feeMaximum]
 * @returns {{ fee: number, total: number, configUsed: string }}
 */
function calculateFee(amount, config) {
  if (typeof amount !== "number" || isNaN(amount) || amount < 0) {
    throw new TypeError("amount must be a non-negative number");
  }

  const cfg = Object.assign({}, DEFAULT_CONFIG, config);

  let fee = amount * (cfg.feePercentage / 100);
  if (fee < cfg.feeMinimum) fee = cfg.feeMinimum;
  if (fee > cfg.feeMaximum) fee = cfg.feeMaximum;

  return {
    fee:        parseFloat(fee.toFixed(2)),
    total:      parseFloat((amount + fee).toFixed(2)),
    configUsed: "calculator",
  };
}

/**
 * Map a 30-day trailing volume to the matching VIP tier.
 *
 * @param {number} volume  30-day completed-transaction volume
 * @returns {{ tier: string, discountPercent: number }}
 */
function mapVolumeToTier(volume) {
  return (
    VIP_TIERS.find((t) => volume >= t.minVolume) ||
    VIP_TIERS[VIP_TIERS.length - 1]
  );
}

/**
 * Calculate the discounted fee for a user based on their VIP tier.
 *
 * @param {number} amount       Transaction amount
 * @param {number} volume       User's 30-day trailing volume
 * @param {object} [config]     Optional fee configuration overrides
 * @returns {{ fee: number, total: number, tier: string, discountPercent: number }}
 */
function calculateFeeWithDiscount(amount, volume, config) {
  if (typeof amount !== "number" || isNaN(amount) || amount < 0) {
    throw new TypeError("amount must be a non-negative number");
  }
  if (typeof volume !== "number" || isNaN(volume) || volume < 0) {
    throw new TypeError("volume must be a non-negative number");
  }

  const cfg      = Object.assign({}, DEFAULT_CONFIG, config);
  const tierInfo = mapVolumeToTier(volume);
  const multiplier   = 1 - tierInfo.discountPercent / 100;
  const effectiveRate = cfg.feePercentage * multiplier;

  let fee = amount * (effectiveRate / 100);
  const discountedMin = cfg.feeMinimum * multiplier;
  const discountedMax = cfg.feeMaximum * multiplier;

  if (fee < discountedMin) fee = discountedMin;
  if (fee > discountedMax) fee = discountedMax;

  return {
    fee:             parseFloat(fee.toFixed(2)),
    total:           parseFloat((amount + fee).toFixed(2)),
    tier:            tierInfo.tier,
    discountPercent: tierInfo.discountPercent,
  };
}

/**
 * Format a numeric value as a locale-aware currency string.
 *
 * @param {number} value
 * @param {string} [currency="XAF"]
 * @returns {string}
 */
function formatCurrency(value, currency) {
  if (typeof value !== "number" || isNaN(value)) return "—";
  return new Intl.NumberFormat("fr-CM", {
    style:    "currency",
    currency: currency || "XAF",
    maximumFractionDigits: 2,
  }).format(value);
}

// ---------------------------------------------------------------------------
// DOM calculator component (browser / JSDOM)
// ---------------------------------------------------------------------------

/**
 * Bind a calculator component to a set of DOM elements.
 *
 * Expected HTML shape:
 *   <input  id="calc-amount"      type="number" />
 *   <input  id="calc-volume"      type="number" />   <!-- optional VIP volume -->
 *   <output id="calc-fee"         />
 *   <output id="calc-total"       />
 *   <output id="calc-tier"        />                  <!-- optional -->
 *   <output id="calc-discount"    />                  <!-- optional -->
 *
 * @param {Document} [doc=document]  Target document (allows JSDOM injection in tests)
 * @param {object}   [config]        Optional fee config overrides
 * @returns {{ update: function, destroy: function }}
 */
function bindCalculator(doc, config) {
  const _doc = doc || (typeof document !== "undefined" ? document : null);
  if (!_doc) throw new Error("No document available");

  const amountInput  = _doc.getElementById("calc-amount");
  const volumeInput  = _doc.getElementById("calc-volume");
  const feeOutput    = _doc.getElementById("calc-fee");
  const totalOutput  = _doc.getElementById("calc-total");
  const tierOutput   = _doc.getElementById("calc-tier");
  const discountOut  = _doc.getElementById("calc-discount");

  if (!amountInput) throw new Error('Element #calc-amount not found');
  if (!feeOutput)   throw new Error('Element #calc-fee not found');
  if (!totalOutput) throw new Error('Element #calc-total not found');

  function update() {
    const amount = parseFloat(amountInput.value) || 0;
    const volume = volumeInput ? (parseFloat(volumeInput.value) || 0) : 0;

    let result;
    if (volumeInput) {
      result = calculateFeeWithDiscount(amount, volume, config);
    } else {
      result = calculateFee(amount, config);
    }

    feeOutput.value   = result.fee;
    totalOutput.value = result.total;

    if (tierOutput)   tierOutput.value   = result.tier            || "STANDARD";
    if (discountOut)  discountOut.value  = result.discountPercent != null
      ? result.discountPercent + "%"
      : "0%";
  }

  // Listen on both 'input' (live) and 'keyup' (acceptance criterion)
  amountInput.addEventListener("input",  update);
  amountInput.addEventListener("keyup",  update);
  if (volumeInput) {
    volumeInput.addEventListener("input", update);
    volumeInput.addEventListener("keyup", update);
  }

  function destroy() {
    amountInput.removeEventListener("input",  update);
    amountInput.removeEventListener("keyup",  update);
    if (volumeInput) {
      volumeInput.removeEventListener("input", update);
      volumeInput.removeEventListener("keyup", update);
    }
  }

  return { update, destroy };
}

// ---------------------------------------------------------------------------
// Exports (CommonJS for Jest; also works as browser global)
// ---------------------------------------------------------------------------

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_CONFIG,
    VIP_TIERS,
    calculateFee,
    mapVolumeToTier,
    calculateFeeWithDiscount,
    formatCurrency,
    bindCalculator,
  };
}

/**
 * Wave Senegal payment routing
 * ────────────────────────────
 * Wave is the dominant mobile wallet in Senegal (XOF). This module decides
 * when a payment/payout should be routed to {@link WaveSenegalProvider} and
 * provides thin, validated entry points that normalise the provider response
 * to the shape the rest of the bridge consumes.
 *
 * A request routes to Wave Senegal when either:
 *   • the caller explicitly selects the `wave_senegal` provider key, or
 *   • no provider is forced and the MSISDN is a valid Senegalese number
 *     (`+221` + 9 digits).
 */

import {
  MobileMoneyProvider,
  validateProviderLimits,
} from "../../config/providers";
import { WaveSenegalProvider } from "./providers/waveSenegal";
import { isValidSenegalPhoneNumber } from "./mobileMoneyService";
import logger from "../../utils/logger";

export const WAVE_SENEGAL_PROVIDER_KEY = "wave_senegal";

export interface WaveRouteQuery {
  /** Explicit provider key chosen by the caller, if any. */
  provider?: string | null;
  /** Destination / source MSISDN. */
  phoneNumber?: string | null;
}

export interface WaveRouteResult {
  success: boolean;
  data?: unknown;
  error?: unknown;
}

/** Returns true when the given request should be handled by Wave Senegal. */
export function isWaveSenegalRoute(query: WaveRouteQuery): boolean {
  const provider = query.provider?.trim().toLowerCase();
  if (provider) {
    return provider === WAVE_SENEGAL_PROVIDER_KEY;
  }
  return query.phoneNumber
    ? isValidSenegalPhoneNumber(query.phoneNumber)
    : false;
}

let cachedProvider: WaveSenegalProvider | null = null;

/** Lazily construct (and reuse) a single Wave Senegal provider instance. */
export function getWaveSenegalProvider(): WaveSenegalProvider {
  if (!cachedProvider) {
    cachedProvider = new WaveSenegalProvider();
  }
  return cachedProvider;
}

/** Test/DI seam — override or reset the cached provider instance. */
export function setWaveSenegalProvider(
  provider: WaveSenegalProvider | null,
): void {
  cachedProvider = provider;
}

function amountToNumber(amount: string | number): number {
  return typeof amount === "number" ? amount : Number.parseFloat(amount);
}

function guardAmount(amount: string | number): WaveRouteResult | null {
  const numeric = amountToNumber(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return { success: false, error: new Error(`Invalid amount: ${amount}`) };
  }
  const limits = validateProviderLimits(
    MobileMoneyProvider.WAVE_SENEGAL,
    numeric,
  );
  if (!limits.valid) {
    return { success: false, error: new Error(limits.error) };
  }
  return null;
}

/**
 * Route a collection (customer pays in) through Wave Senegal after validating
 * the MSISDN and the amount against the provider's configured limits.
 */
export async function routeWaveSenegalPayment(
  phoneNumber: string,
  amount: string | number,
): Promise<WaveRouteResult> {
  if (!isValidSenegalPhoneNumber(phoneNumber)) {
    return {
      success: false,
      error: new Error(
        "Invalid Senegal phone number format. Use +221 followed by 9 digits.",
      ),
    };
  }

  const amountError = guardAmount(amount);
  if (amountError) return amountError;

  logger.info(
    { provider: WAVE_SENEGAL_PROVIDER_KEY, operation: "payment" },
    "WaveSenegalRouting: routing collection",
  );
  return getWaveSenegalProvider().requestPayment(phoneNumber, String(amount));
}

/** Route a payout (bridge pays out) through Wave Senegal. */
export async function routeWaveSenegalPayout(
  phoneNumber: string,
  amount: string | number,
): Promise<WaveRouteResult> {
  if (!isValidSenegalPhoneNumber(phoneNumber)) {
    return {
      success: false,
      error: new Error(
        "Invalid Senegal phone number format. Use +221 followed by 9 digits.",
      ),
    };
  }

  const amountError = guardAmount(amount);
  if (amountError) return amountError;

  logger.info(
    { provider: WAVE_SENEGAL_PROVIDER_KEY, operation: "payout" },
    "WaveSenegalRouting: routing payout",
  );
  return getWaveSenegalProvider().sendPayout(phoneNumber, String(amount));
}

/** Canonical transaction status for a Wave transaction id. */
export async function getWaveSenegalTransactionStatus(
  transactionId: string,
): Promise<{ status: "completed" | "failed" | "pending" | "unknown" }> {
  return getWaveSenegalProvider().getTransactionStatus(transactionId);
}

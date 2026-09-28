/**
 * NetworkOutageFallbackService — Fallback provider switching on network outages
 *
 * Complements the existing FallbackRouter (which handles per-request timeouts)
 * by maintaining a registry of providers currently experiencing outages and
 * automatically routing any new transaction to the best available alternative.
 *
 * Outage Detection Sources
 * ─────────────────────────
 *  1. Proactive health-check results from `checkMobileMoneyHealth()`.
 *  2. Reactive signal: callers can call `recordProviderFailure()` after a live
 *     transaction failure to trigger an immediate outage check.
 *
 * Fallback Selection Strategy
 * ────────────────────────────
 *  For each primary provider the service maintains a prioritised list of
 *  fallback candidates, configurable via `PROVIDER_FALLBACK_MAP`.
 *  The first candidate that is currently "up" is selected; if none are
 *  available the original provider is returned (fail-open strategy) so callers
 *  can still try and surface a meaningful error.
 *
 * Recovery
 * ─────────
 *  The watchdog checks every `RECOVERY_POLL_INTERVAL_MS` (default 30 s) and
 *  clears outage records for providers that respond successfully to a ping.
 */

import { EventEmitter } from "events";
import { checkMobileMoneyHealth } from "./providers/healthCheck";
import {
  providerFailoverAlerts,
  providerFailoverTotal,
} from "../../utils/metrics";
import logger from "../../utils/logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export type KnownProvider =
  | "mtn"
  | "airtel"
  | "orange"
  | "orange_madagascar"
  | "orange_guinea"
  | "wave_senegal"
  | "sms_portal";

export interface OutageRecord {
  provider: KnownProvider;
  detectedAt: string; // ISO-8601
  failureCount: number;
  lastCheckedAt: string | null;
}

export interface FallbackDecision {
  /** The provider the caller should actually use */
  resolvedProvider: KnownProvider;
  /** True when the resolved provider differs from the requested one */
  didFallback: boolean;
  outage?: OutageRecord;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Ordered list of fallback candidates for each primary provider.
 * The first healthy entry wins.
 */
const PROVIDER_FALLBACK_MAP: Record<KnownProvider, KnownProvider[]> = {
  mtn: ["airtel", "orange", "sms_portal"],
  airtel: ["mtn", "orange", "sms_portal"],
  orange: ["mtn", "airtel", "sms_portal"],
  orange_madagascar: ["orange", "sms_portal"],
  orange_guinea: ["orange", "sms_portal"],
  // Senegal (XOF): Wave first, then Orange Money Senegal, then SMS portal.
  wave_senegal: ["orange", "sms_portal"],
  sms_portal: [],
};

/**
 * Number of consecutive failures required before a provider is marked as
 * outage-suspected (reduces noise from transient blips).
 */
const FAILURE_THRESHOLD = Number(process.env.OUTAGE_FAILURE_THRESHOLD) || 3;

/** Poll interval in ms for the background recovery watchdog. */
const RECOVERY_POLL_INTERVAL_MS =
  Number(process.env.OUTAGE_RECOVERY_POLL_MS) || 30_000;

// ── Service ───────────────────────────────────────────────────────────────────

export class NetworkOutageFallbackService extends EventEmitter {
  /** Live map of providers currently considered "down". */
  private readonly outageMap = new Map<KnownProvider, OutageRecord>();

  /** In-process failure counter (resets on successful resolution). */
  private readonly failureCounts = new Map<KnownProvider, number>();

  private recoveryTimer: ReturnType<typeof setInterval> | null = null;

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Resolve which provider to use for an operation, applying the outage
   * fallback strategy if the requested provider is currently down.
   *
   * @param requested  The provider originally specified by the caller.
   * @returns A `FallbackDecision` indicating the resolved provider.
   */
  resolveProvider(requested: KnownProvider): FallbackDecision {
    const outage = this.outageMap.get(requested);

    if (!outage) {
      return { resolvedProvider: requested, didFallback: false };
    }

    // Provider is in outage — find the first healthy fallback.
    const candidates = PROVIDER_FALLBACK_MAP[requested] ?? [];
    for (const candidate of candidates) {
      if (!this.outageMap.has(candidate)) {
        logger.warn(
          {
            requestedProvider: requested,
            resolvedProvider: candidate,
            outageDetectedAt: outage.detectedAt,
            failureCount: outage.failureCount,
          },
          `[NetworkOutageFallback] Routing away from "${requested}" -> "${candidate}"`,
        );

        if (providerFailoverTotal) {
          providerFailoverTotal.inc({
            type: "outage_switch",
            from_provider: requested,
            to_provider: candidate,
            reason: "network_outage",
          });
        }

        if (providerFailoverAlerts) {
          providerFailoverAlerts.inc({
            provider: requested,
          });
        }

        this.emit("fallback", {
          from: requested,
          to: candidate,
          outage,
        });

        return { resolvedProvider: candidate, didFallback: true, outage };
      }
    }

    // All fallbacks are also down — fail-open with original provider.
    logger.error(
      { requested, candidates },
      "[NetworkOutageFallback] All fallback providers are also in outage — using original provider",
    );
    return { resolvedProvider: requested, didFallback: false, outage };
  }

  /**
   * Record a transaction failure for a provider.
   * When the failure count crosses `FAILURE_THRESHOLD` the provider is
   * immediately marked as "outage" without waiting for the health-check poll.
   *
   * @param provider  Provider that failed.
   * @param reason    Optional description of the failure.
   */
  recordProviderFailure(provider: KnownProvider, reason?: string): void {
    const prev = this.failureCounts.get(provider) ?? 0;
    const next = prev + 1;
    this.failureCounts.set(provider, next);

    logger.warn(
      { provider, failureCount: next, threshold: FAILURE_THRESHOLD, reason },
      "[NetworkOutageFallback] Provider failure recorded",
    );

    if (next >= FAILURE_THRESHOLD && !this.outageMap.has(provider)) {
      this.markProviderDown(provider, next);
    }
  }

  /**
   * Explicitly mark a provider as down (e.g. from the health-check job).
   *
   * @param provider      Provider identifier.
   * @param failureCount  Number of consecutive failures observed.
   */
  markProviderDown(provider: KnownProvider, failureCount = 1): void {
    if (this.outageMap.has(provider)) return; // already tracked

    const record: OutageRecord = {
      provider,
      detectedAt: new Date().toISOString(),
      failureCount,
      lastCheckedAt: null,
    };

    this.outageMap.set(provider, record);

    logger.error(
      { provider, failureCount, detectedAt: record.detectedAt },
      `[NetworkOutageFallback] Provider "${provider}" marked DOWN`,
    );

    this.emit("outage", record);
  }

  /**
   * Explicitly clear an outage for a provider (e.g. after a successful health
   * ping confirms recovery).
   *
   * @param provider  Provider identifier.
   */
  markProviderUp(provider: KnownProvider): void {
    const record = this.outageMap.get(provider);
    if (!record) return;

    this.outageMap.delete(provider);
    this.failureCounts.delete(provider);

    logger.info(
      {
        provider,
        outageDurationMs: Date.now() - new Date(record.detectedAt).getTime(),
        detectedAt: record.detectedAt,
      },
      `[NetworkOutageFallback] Provider "${provider}" recovered — outage cleared`,
    );

    this.emit("recovery", { provider, record });
  }

  /** Returns the current outage map (snapshot). */
  getOutages(): ReadonlyMap<KnownProvider, OutageRecord> {
    return this.outageMap;
  }

  /** Returns the failure counts per provider (snapshot). */
  getFailureCounts(): ReadonlyMap<KnownProvider, number> {
    return this.failureCounts;
  }

  /** Returns `true` when the given provider is currently in outage. */
  isProviderDown(provider: KnownProvider): boolean {
    return this.outageMap.has(provider);
  }

  // ── Background recovery watchdog ──────────────────────────────────────────

  /**
   * Start the background watchdog that periodically pings providers in the
   * outage map and clears their outage records on recovery.
   *
   * Safe to call multiple times — subsequent calls are no-ops if the timer
   * is already running.
   */
  startRecoveryWatchdog(): void {
    if (this.recoveryTimer) return;

    this.recoveryTimer = setInterval(
      () => void this.runRecoveryCheck(),
      RECOVERY_POLL_INTERVAL_MS,
    );
  }

  /** Stop the background recovery watchdog. */
  stopRecoveryWatchdog(): void {
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  /**
   * Perform a single pass of the recovery check.
   * Called automatically by the watchdog timer; can also be called manually
   * in tests or by the cron scheduler.
   */
  async runRecoveryCheck(): Promise<void> {
    const downProviders = [...this.outageMap.keys()];
    if (downProviders.length === 0) return;

    logger.info(
      { downProviders },
      "[NetworkOutageFallback] Running recovery check",
    );

    let healthResult: Awaited<ReturnType<typeof checkMobileMoneyHealth>>;
    try {
      healthResult = await checkMobileMoneyHealth(undefined, fetch);
    } catch (err) {
      logger.error(
        { err },
        "[NetworkOutageFallback] Health check failed during recovery poll",
      );
      return;
    }

    for (const provider of downProviders) {
      const health =
        healthResult.providers[provider as keyof typeof healthResult.providers];

      if (!health) continue;

      const now = new Date().toISOString();
      const record = this.outageMap.get(provider);
      if (record) {
        record.lastCheckedAt = now;
      }

      if (health.status === "up") {
        this.markProviderUp(provider);
      } else {
        logger.warn(
          { provider },
          "[NetworkOutageFallback] Provider still down during recovery check",
        );
      }
    }
  }

  // ── Testing / reset helpers ───────────────────────────────────────────────

  /** Reset all internal state — use ONLY in tests. */
  _reset(): void {
    this.outageMap.clear();
    this.failureCounts.clear();
    this.stopRecoveryWatchdog();
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const networkOutageFallbackService = new NetworkOutageFallbackService();

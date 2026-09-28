import { pool } from "../config/database";
import { layeredCache } from "./layeredCache";
import logger from "../utils/logger";

export interface ProviderMaintenanceOutage {
  id?: string;
  provider_name: string;
  starts_at: Date;
  ends_at: Date;
  reason: string | null;
  fallback_provider: string | null;
  notify_users: boolean;
  created_by: string | null;
  created_at?: Date;
  updated_at?: Date;
}

export interface CreateProviderMaintenanceOutageInput {
  providerName: string;
  startsAt: Date | string;
  endsAt: Date | string;
  reason?: string | null;
  fallbackProvider?: string | null;
  notifyUsers?: boolean;
  createdBy?: string | null;
}

export type ProviderMaintenanceRoutingDecision =
  | { action: "proceed" }
  | {
      action: "fallback";
      provider: string;
      outage: ProviderMaintenanceOutage;
      message: string;
    }
  | {
      action: "abort";
      outage: ProviderMaintenanceOutage;
      message: string;
    };

export interface ProviderSettings {
  id?: string;
  provider_name: string;
  failure_threshold: number;
  timeout_ms: number;
  fallback_order: string | null;
  /** Manual on/off toggle for unscheduled maintenance (#1550). Defaults to true. */
  is_enabled?: boolean;
  disabled_reason?: string | null;
  disabled_by?: string | null;
  disabled_at?: Date | null;
  created_at?: Date;
  updated_at?: Date;
}

/**
 * Canonical cache key namespace for provider settings.
 * All cache operations must use these keys so that invalidation
 * is consistent across the service, tests, and any future consumers.
 */
export const PROVIDER_CACHE_KEYS = {
  /** Cache key for the full list of provider settings */
  all: (): string => "provider_settings:all",

  /** Cache key for a single provider's settings */
  single: (providerName: string): string =>
    `provider_settings:${providerName.toLowerCase()}`,

  /** Cache key for the active maintenance outage of a provider */
  outage: (providerName: string): string =>
    `provider_outage:${providerName.toLowerCase()}`,

  /** Glob pattern that matches every provider settings key */
  pattern: (): string => "provider_settings:*",

  /** Glob pattern that matches every provider outage key */
  outagePattern: (): string => "provider_outage:*",
} as const;

/**
 * TTL constants (seconds) for provider config entries.
 *
 * Provider settings are relatively stable but must propagate instantly
 * on modification. The TTL here is a safety ceiling – explicit invalidation
 * via LayeredCache.del() (which publishes to the Redis Pub/Sub invalidation
 * channel) is the primary freshness mechanism.
 */
const TTL = {
  /** Settings records: 5 minutes ceiling, always invalidated on write */
  SETTINGS: 300,
  /** Active outage window: 30-second ceiling, always invalidated on write */
  OUTAGE: 30,
} as const;

export class ProviderSettingsService {
  /**
   * Retrieves settings for all providers.
   *
   * Cache strategy: LayeredCache (L1 memory → L2 Redis).
   * On a config modification, `upsertProviderSettings` deletes this key
   * which (a) removes it from local L1, (b) removes it from Redis L2, and
   * (c) publishes an invalidation message so every other cluster instance
   * also evicts it from their L1 immediately.
   */
  public async getAllSettings(): Promise<ProviderSettings[]> {
    const cacheKey = PROVIDER_CACHE_KEYS.all();
    const cached = await layeredCache.get<ProviderSettings[]>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const query = "SELECT * FROM provider_settings ORDER BY provider_name ASC";
    const result = await pool.query(query);
    await layeredCache.set(cacheKey, result.rows, TTL.SETTINGS);
    return result.rows;
  }

  /**
   * Retrieves settings for a specific provider.
   *
   * Cache strategy: same as getAllSettings() – LayeredCache with cross-cluster
   * invalidation on modification.
   */
  public async getProviderSettings(
    providerName: string,
  ): Promise<ProviderSettings | null> {
    const cacheKey = PROVIDER_CACHE_KEYS.single(providerName);
    const cached = await layeredCache.get<ProviderSettings>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const query = "SELECT * FROM provider_settings WHERE provider_name = $1";
    const result = await pool.query(query, [providerName.toLowerCase()]);

    if (result.rows.length === 0) {
      return null;
    }

    await layeredCache.set(cacheKey, result.rows[0], TTL.SETTINGS);
    return result.rows[0];
  }

  /**
   * Updates or creates settings for a specific provider.
   *
   * Invalidation strategy:
   *   1. Write to DB (source of truth).
   *   2. Delete the per-provider and the all-settings cache keys.
   *      LayeredCache.del() performs:
   *        a. Local L1 eviction (this instance)
   *        b. Redis L2 deletion
   *        c. Redis Pub/Sub publish to `cache:invalidate:l1` → every other
   *           instance evicts the key from their own L1 immediately.
   *   3. Force-repopulate the per-provider key so the next reader gets a
   *      fresh L1/L2 hit instead of a DB round-trip.
   */
  public async upsertProviderSettings(
    providerName: string,
    failureThreshold: number,
    timeoutMs: number,
    fallbackOrder: string | null,
  ): Promise<ProviderSettings> {
    const pName = providerName.toLowerCase();
    const query = `
      INSERT INTO provider_settings (provider_name, failure_threshold, timeout_ms, fallback_order)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (provider_name) 
      DO UPDATE SET 
        failure_threshold = EXCLUDED.failure_threshold,
        timeout_ms = EXCLUDED.timeout_ms,
        fallback_order = EXCLUDED.fallback_order,
        updated_at = NOW()
      RETURNING *;
    `;
    const result = await pool.query(query, [
      pName,
      failureThreshold,
      timeoutMs,
      fallbackOrder,
    ]);

    const updated: ProviderSettings = result.rows[0];

    // Invalidate across all cluster instances via LayeredCache (L1 + L2 + Pub/Sub).
    await this._invalidateProviderKeys(pName);

    // Eagerly repopulate so the next read is a cache hit everywhere.
    await layeredCache.set(
      PROVIDER_CACHE_KEYS.single(pName),
      updated,
      TTL.SETTINGS,
    );

    logger.info(
      { providerName: pName, failureThreshold, timeoutMs, fallbackOrder },
      "[ProviderSettingsService] Config updated and cache invalidated across all instances",
    );

    return updated;
  }

  /**
   * Manually enables or disables a provider for unscheduled maintenance (#1550).
   *
   * Distinct from `createMaintenanceOutage()`, which schedules a time-windowed
   * outage: this is an immediate toggle an admin flips during an unplanned
   * incident. If the provider has no settings row yet, one is created with
   * default threshold/timeout values.
   *
   * Invalidation strategy matches `upsertProviderSettings()`: DB write, then
   * cache eviction + eager repopulation via LayeredCache.
   */
  public async setProviderEnabled(
    providerName: string,
    enabled: boolean,
    updatedBy: string | null,
    reason: string | null = null,
  ): Promise<ProviderSettings> {
    const pName = providerName.trim().toLowerCase();
    if (!pName) {
      throw new Error("providerName is required");
    }

    const query = `
      INSERT INTO provider_settings (
        provider_name, failure_threshold, timeout_ms, fallback_order,
        is_enabled, disabled_reason, disabled_by, disabled_at
      )
      VALUES ($1, 3, 5000, NULL, $2, $3, $4, $5)
      ON CONFLICT (provider_name)
      DO UPDATE SET
        is_enabled = EXCLUDED.is_enabled,
        disabled_reason = EXCLUDED.disabled_reason,
        disabled_by = EXCLUDED.disabled_by,
        disabled_at = EXCLUDED.disabled_at,
        updated_at = NOW()
      RETURNING *;
    `;

    const disabledAt = enabled ? null : new Date();
    const result = await pool.query(query, [
      pName,
      enabled,
      enabled ? null : reason,
      enabled ? null : updatedBy,
      disabledAt,
    ]);

    const updated: ProviderSettings = result.rows[0];

    await this._invalidateProviderKeys(pName);
    await layeredCache.set(
      PROVIDER_CACHE_KEYS.single(pName),
      updated,
      TTL.SETTINGS,
    );

    logger.info(
      { providerName: pName, enabled, updatedBy, reason },
      "[ProviderSettingsService] Manual provider toggle updated and cache invalidated",
    );

    return updated;
  }

  /**
   * Creates a scheduled provider maintenance outage.
   * Invalidates the active-outage cache key for the provider across all instances.
   */
  public async createMaintenanceOutage(
    input: CreateProviderMaintenanceOutageInput,
  ): Promise<ProviderMaintenanceOutage> {
    const providerName = input.providerName.trim().toLowerCase();
    const fallbackProvider =
      input.fallbackProvider?.trim().toLowerCase() || null;
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);

    if (!providerName) {
      throw new Error("providerName is required");
    }

    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw new Error("startsAt and endsAt must be valid timestamps");
    }

    if (startsAt >= endsAt) {
      throw new Error("startsAt must be before endsAt");
    }

    if (fallbackProvider === providerName) {
      throw new Error("fallbackProvider must differ from providerName");
    }

    const query = `
      INSERT INTO provider_maintenance_outages (
        provider_name, starts_at, ends_at, reason, fallback_provider, notify_users, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;

    const result = await pool.query(query, [
      providerName,
      startsAt,
      endsAt,
      input.reason ?? null,
      fallbackProvider,
      input.notifyUsers ?? true,
      input.createdBy ?? null,
    ]);

    // Invalidate the outage cache entry across all cluster instances.
    await layeredCache.del(PROVIDER_CACHE_KEYS.outage(providerName));

    logger.info(
      { providerName, startsAt, endsAt },
      "[ProviderSettingsService] Maintenance outage created and cache invalidated",
    );

    return result.rows[0];
  }

  /**
   * Returns the active outage for a provider, if the current time is inside a
   * scheduled window.
   */
  public async getActiveMaintenanceOutage(
    providerName: string,
    at: Date = new Date(),
  ): Promise<ProviderMaintenanceOutage | null> {
    const pName = providerName.toLowerCase();
    const cacheKey = PROVIDER_CACHE_KEYS.outage(pName);
    const cached =
      await layeredCache.get<ProviderMaintenanceOutage | null>(cacheKey);

    if (cached !== undefined && cached !== null) {
      return cached;
    }

    const query = `
      SELECT *
      FROM provider_maintenance_outages
      WHERE provider_name = $1
        AND starts_at <= $2
        AND ends_at > $2
      ORDER BY starts_at DESC
      LIMIT 1;
    `;
    const result = await pool.query(query, [pName, at]);
    const outage = result.rows[0] ?? null;

    await layeredCache.set(cacheKey, outage, TTL.OUTAGE);
    return outage;
  }

  /**
   * Determines whether a transaction should proceed, fallback, or abort due to
   * maintenance.
   */
  public async resolveMaintenanceRouting(
    providerName: string,
  ): Promise<ProviderMaintenanceRoutingDecision> {
    const outage = await this.getActiveMaintenanceOutage(providerName);

    if (!outage) {
      return { action: "proceed" };
    }

    const message = `Provider ${outage.provider_name} is under scheduled maintenance until ${new Date(
      outage.ends_at,
    ).toISOString()}`;

    if (outage.fallback_provider) {
      return {
        action: "fallback",
        provider: outage.fallback_provider,
        outage,
        message: `${message}; routing to ${outage.fallback_provider}`,
      };
    }

    return { action: "abort", outage, message };
  }

  /**
   * Force-refreshes the in-memory and Redis cache for a specific provider by
   * re-fetching from the database and re-populating both cache layers.
   *
   * Use this when you need to guarantee that the latest DB state is visible
   * to all system modules on the current instance immediately (e.g. after an
   * out-of-band DB change or during startup warm-up).
   */
  public async forceRefreshProviderSettings(
    providerName: string,
  ): Promise<ProviderSettings | null> {
    const pName = providerName.toLowerCase();

    // Evict first so the next get() hits the DB.
    await this._invalidateProviderKeys(pName);

    // Re-fetch and repopulate.
    return this.getProviderSettings(pName);
  }

  /**
   * Clears ALL provider settings and outage cache keys across all cluster
   * instances (nuclear option for bulk config changes or cache poisoning recovery).
   */
  public async invalidateAll(): Promise<void> {
    // Delete the well-known aggregated key.
    await layeredCache.del(PROVIDER_CACHE_KEYS.all());

    // Delete any remaining per-provider keys by pattern.
    await layeredCache.delPattern(PROVIDER_CACHE_KEYS.pattern());
    await layeredCache.delPattern(PROVIDER_CACHE_KEYS.outagePattern());

    logger.warn(
      "[ProviderSettingsService] All provider config caches invalidated across all instances",
    );
  }

  /**
   * Internal helper: invalidates the per-provider settings key AND the
   * aggregated all-settings key across all cluster nodes via LayeredCache
   * (L1 eviction + Redis DEL + Pub/Sub broadcast).
   */
  private async _invalidateProviderKeys(pName: string): Promise<void> {
    await Promise.all([
      layeredCache.del(PROVIDER_CACHE_KEYS.single(pName)),
      layeredCache.del(PROVIDER_CACHE_KEYS.all()),
    ]);
  }
}

export const providerSettingsService = new ProviderSettingsService();

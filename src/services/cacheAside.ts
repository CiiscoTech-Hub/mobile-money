import { NextFunction, Request, Response } from "express";
import {
  cachedQueryManager,
  QUERY_TTL_POLICIES,
  CacheTags,
} from "./cachedQueryManager";
import { layeredCache } from "./layeredCache";
import logger from "../utils/logger";
import { PROVIDER_CACHE_KEYS } from "./providerSettingsService";

/**
 * Cache-aside middleware wrapper for expensive queries
 * Provides decorator/wrapper for caching query results with automatic invalidation
 */

interface CacheAsideOptions {
  baseKey: string;
  ttlSeconds?: number;
  tags: string[];
  paramsExtractor?: (req: Request) => Record<string, any>;
}

/**
 * Wraps a query function with cache-aside pattern
 * Returns the cached result if available, otherwise calls the function and caches it
 */
export async function withCacheAside<T>(
  queryFn: () => Promise<T>,
  options: CacheAsideOptions,
  params?: Record<string, any>,
): Promise<T> {
  const ttl = options.ttlSeconds || QUERY_TTL_POLICIES.TRANSACTION_HISTORY;
  const fullParams = { ...params };
  const cacheKey = generateCacheKey(options.baseKey, fullParams);

  const result = await cachedQueryManager.getOrFetch(cacheKey, queryFn, {
    ttlSeconds: ttl,
    tags: options.tags,
  });

  return result.data;
}

/**
 * Express middleware for caching GET requests with query-based cache keys
 */
export function cacheAsideMiddleware(options: CacheAsideOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Extract cache parameters from request
      const params = options.paramsExtractor?.(req) || req.query;
      const ttl = options.ttlSeconds || QUERY_TTL_POLICIES.TRANSACTION_HISTORY;
      const cacheKey = generateCacheKey(options.baseKey, params);

      // Try to get from cache
      const cached = await cachedQueryManager.get(cacheKey);
      if (cached !== null) {
        res.setHeader("X-Cache", "HIT");
        return res.json(cached);
      }

      // Mark cache miss
      res.setHeader("X-Cache", "MISS");

      // Intercept response to cache it
      const originalJson = res.json.bind(res);
      res.json = function (data: any) {
        // Cache successful responses
        if (res.statusCode === 200 && data) {
          setImmediate(() => {
            cachedQueryManager
              .set(cacheKey, data, {
                ttlSeconds: ttl,
                tags: options.tags,
              })
              .catch((error) => {
                logger.warn({ cacheKey, error }, "Failed to cache response");
              });
          });
        }
        return originalJson(data);
      };

      next();
    } catch (error) {
      logger.warn(
        { error },
        "Cache-aside middleware error, continuing without cache",
      );
      next();
    }
  };
}

/**
 * Helper to generate cache key with parameters
 */
function generateCacheKey(
  baseKey: string,
  params?: Record<string, any>,
): string {
  if (!params || Object.keys(params).length === 0) {
    return `cache:${baseKey}`;
  }

  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${key}=${encodeURIComponent(JSON.stringify(params[key]))}`)
    .join("&");

  return `cache:${baseKey}:${Buffer.from(sortedParams).toString("base64")}`;
}

/**
 * Transaction-related cache invalidation helpers
 */
export class TransactionCacheInvalidation {
  /**
   * Invalidate all caches related to a user when their transaction changes
   */
  static async invalidateUserCaches(userId: string): Promise<void> {
    const tags = [
      CacheTags.userHistory(userId),
      CacheTags.userStats(userId),
      CacheTags.userTransaction(userId),
    ];

    await cachedQueryManager.invalidateByTags(tags);
    logger.info({ userId, tags }, "User transaction caches invalidated");
  }

  /**
   * Invalidate provider-wide stats when a new transaction is created
   */
  static async invalidateProviderStats(provider: string): Promise<void> {
    const tags = [
      CacheTags.provider(provider),
      CacheTags.providerVolumes(),
      CacheTags.generalStats(),
    ];

    await cachedQueryManager.invalidateByTags(tags);
    logger.info({ provider, tags }, "Provider stats caches invalidated");
  }

  /**
   * Invalidate all general statistics caches on any significant event
   */
  static async invalidateGeneralStats(): Promise<void> {
    await cachedQueryManager.invalidateByTag(CacheTags.generalStats());
    logger.info("General stats cache invalidated");
  }

  /**
   * Invalidate all caches (nuclear option for migrations, config changes)
   */
  static async invalidateAll(): Promise<void> {
    await cachedQueryManager.clear();
    logger.warn("All caches cleared");
  }
}

/**
 * Webhook recovery cache invalidation helpers
 * Handles cache invalidation when webhook clients reconnect successfully
 */
export class WebhookCacheInvalidation {
  /**
   * Invalidate merchant configuration caches when webhook recovers
   * This ensures fresh settings are loaded after a webhook client reconnects
   */
  static async invalidateOnWebhookRecovery(
    userId: string,
    webhookId: string,
  ): Promise<void> {
    const tags = [
      CacheTags.merchantConfig(userId),
      CacheTags.merchantWebhooks(userId),
    ];

    const invalidatedCount = await cachedQueryManager.invalidateByTags(tags);

    logger.info(
      {
        userId,
        webhookId,
        tags,
        invalidatedCount,
        event: "webhook_recovery",
      },
      "Merchant configuration caches invalidated on webhook recovery",
    );
  }

  /**
   * Invalidate all merchant-related caches for a specific user
   * Used when webhook configuration changes or when webhook is deleted
   */
  static async invalidateMerchantCaches(userId: string): Promise<void> {
    const tags = [
      CacheTags.merchantConfig(userId),
      CacheTags.merchantWebhooks(userId),
    ];

    const invalidatedCount = await cachedQueryManager.invalidateByTags(tags);

    logger.info(
      {
        userId,
        tags,
        invalidatedCount,
        event: "merchant_cache_invalidation",
      },
      "All merchant caches invalidated",
    );
  }
}

/**
 * Provider configuration cache invalidation helpers.
 *
 * Called automatically by ProviderSettingsService on every write. Consumers
 * that modify provider config through out-of-band means (e.g. direct DB
 * migrations) should call these helpers manually to keep all cluster nodes
 * consistent.
 */
export class ProviderConfigCacheInvalidation {
  /**
   * Invalidate all caches that depend on a provider's configuration.
   *
   * Steps:
   *   1. Delete the per-provider and all-settings LayeredCache entries
   *      (triggers L1 eviction + Redis DEL + Pub/Sub broadcast to all nodes).
   *   2. Invalidate the provider config tags in the CachedQueryManager so
   *      any tag-keyed query caches that embed provider config are also cleared.
   *
   * Call this after any provider config modification that must propagate
   * instantly across all cluster instances.
   */
  static async invalidateOnConfigModification(
    providerName: string,
  ): Promise<void> {
    const pName = providerName.toLowerCase();

    // 1. LayeredCache invalidation (L1 + L2 + cross-cluster Pub/Sub).
    await Promise.all([
      layeredCache.del(PROVIDER_CACHE_KEYS.single(pName)),
      layeredCache.del(PROVIDER_CACHE_KEYS.all()),
      layeredCache.del(PROVIDER_CACHE_KEYS.outage(pName)),
    ]);

    // 2. Tag-based invalidation in CachedQueryManager.
    const tags = [
      CacheTags.providerConfig(pName),
      CacheTags.providerConfig(), // global provider config tag
      CacheTags.provider(pName),
    ];
    const invalidatedCount = await cachedQueryManager.invalidateByTags(tags);

    logger.info(
      {
        providerName: pName,
        tags,
        invalidatedCount,
        event: "provider_config_invalidation",
      },
      "[ProviderConfigCacheInvalidation] Provider config caches invalidated across all instances",
    );
  }

  /**
   * Force-refresh all provider config caches (nuclear option).
   *
   * Clears ALL provider settings and outage cache keys from L1, L2, and all
   * sibling instances via Pub/Sub. Use after bulk config migrations or when
   * cache poisoning is suspected.
   */
  static async forceRefreshAll(): Promise<void> {
    // LayeredCache pattern-delete broadcasts to all instances.
    await Promise.all([
      layeredCache.del(PROVIDER_CACHE_KEYS.all()),
      layeredCache.delPattern(PROVIDER_CACHE_KEYS.pattern()),
      layeredCache.delPattern(PROVIDER_CACHE_KEYS.outagePattern()),
    ]);

    // Tag-based invalidation.
    await cachedQueryManager.invalidateByTag(CacheTags.providerConfig());

    logger.warn(
      { event: "provider_config_force_refresh_all" },
      "[ProviderConfigCacheInvalidation] All provider config caches force-cleared across all instances",
    );
  }

  /**
   * Verify that the latest settings for a provider are reflected across the
   * cache layers (L1 and L2) by comparing the cached value against the DB.
   *
   * Returns `true` if the cache is consistent with the DB (or absent, which
   * means the next read will re-populate from DB — also acceptable).
   * Returns `false` if a stale value is detected.
   *
   * This is primarily intended for health-check endpoints and integration
   * tests to assert that settings updates reflect across system modules
   * immediately after a modification call.
   */
  static async verifySettingsReflectedAcrossModules(
    providerName: string,
    expectedSettings: { failure_threshold: number; timeout_ms: number },
  ): Promise<boolean> {
    // Re-fetch directly from cache (no DB fallback) to verify freshness.
    const cached = await layeredCache.get<{
      failure_threshold: number;
      timeout_ms: number;
    }>(PROVIDER_CACHE_KEYS.single(providerName));

    if (cached === null) {
      // Cache absent = acceptable (will re-populate on next read from DB).
      logger.info(
        { providerName, event: "provider_config_verify" },
        "[ProviderConfigCacheInvalidation] Cache absent — will re-populate on next read",
      );
      return true;
    }

    const isConsistent =
      cached.failure_threshold === expectedSettings.failure_threshold &&
      cached.timeout_ms === expectedSettings.timeout_ms;

    if (!isConsistent) {
      logger.error(
        {
          providerName,
          cached,
          expectedSettings,
          event: "provider_config_stale_cache",
        },
        "[ProviderConfigCacheInvalidation] STALE cache detected — cached values do not match expected settings",
      );
    } else {
      logger.info(
        { providerName, event: "provider_config_verify" },
        "[ProviderConfigCacheInvalidation] Cache is consistent with expected settings",
      );
    }

    return isConsistent;
  }
}

/**
 * Cache key generator helpers
 */
export const CacheKeyGenerators = {
  userTransactionHistory: (userId: string) => `user-history:${userId}`,
  userTransactionStats: (userId: string) => `user-stats:${userId}`,
  generalStats: () => "general-stats",
  volumeByProvider: (startDate: string, endDate: string) =>
    `volume-provider:${startDate}:${endDate}`,
  activeUsersCount: (startDate: string, endDate: string) =>
    `active-users:${startDate}:${endDate}`,
  userStatusHistory: (userId: string) => `status-history:${userId}`,
};

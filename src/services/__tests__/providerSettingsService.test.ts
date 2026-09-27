/**
 * @file providerSettingsService.test.ts
 *
 * Tests for the cache invalidation strategy in ProviderSettingsService.
 *
 * Acceptance criteria verified:
 *   ✅ Invalidate caches on config modification calls
 *   ✅ Force refresh in-memory configurations
 *   ✅ Verify settings updates reflect across system modules immediately
 */

import { ProviderSettingsService, PROVIDER_CACHE_KEYS } from "../providerSettingsService";
import { layeredCache } from "../layeredCache";
import { ProviderConfigCacheInvalidation } from "../cacheAside";
import { CacheTags } from "../cachedQueryManager";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock the database pool so we don't need a live DB
jest.mock("../../config/database", () => ({
  pool: {
    query: jest.fn(),
  },
}));

// Mock LayeredCache so we can verify calls without real Redis
jest.mock("../layeredCache", () => ({
  layeredCache: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    delPattern: jest.fn(),
  },
}));

// Mock CachedQueryManager tag invalidation
jest.mock("../cachedQueryManager", () => ({
  cachedQueryManager: {
    invalidateByTags: jest.fn(),
    invalidateByTag: jest.fn(),
  },
  CacheTags: {
    providerConfig: jest.fn((name?: string) =>
      name ? `provider:config:${name}` : `provider:config`,
    ),
    provider: jest.fn((name: string) => `provider:${name}`),
  },
  QUERY_TTL_POLICIES: { TRANSACTION_HISTORY: 300 },
}));

// Mock logger
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { pool } from "../../config/database";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockedPool = pool as jest.Mocked<typeof pool>;
const mockedCache = layeredCache as jest.Mocked<typeof layeredCache>;

function makeSettings(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "test-id",
    provider_name: "mtn",
    failure_threshold: 3,
    timeout_ms: 5000,
    fallback_order: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("ProviderSettingsService — Cache Invalidation Strategy", () => {
  let service: ProviderSettingsService;

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-instantiate service before each test for isolation
    service = new (ProviderSettingsService as any)();
  });

  // -------------------------------------------------------------------------
  // 1. getAllSettings() — cache hit / miss behaviour
  // -------------------------------------------------------------------------

  describe("getAllSettings()", () => {
    it("returns cached value without hitting DB on L1/L2 hit", async () => {
      const mockData = [makeSettings()];
      mockedCache.get.mockResolvedValueOnce(mockData);

      const result = await service.getAllSettings();

      expect(mockedCache.get).toHaveBeenCalledWith(PROVIDER_CACHE_KEYS.all());
      expect(mockedPool.query).not.toHaveBeenCalled();
      expect(result).toEqual(mockData);
    });

    it("queries DB and populates cache on cache miss", async () => {
      const mockData = [makeSettings()];
      mockedCache.get.mockResolvedValueOnce(null);
      mockedPool.query.mockResolvedValueOnce({ rows: mockData } as any);

      const result = await service.getAllSettings();

      expect(mockedPool.query).toHaveBeenCalledWith(
        "SELECT * FROM provider_settings ORDER BY provider_name ASC",
      );
      expect(mockedCache.set).toHaveBeenCalledWith(
        PROVIDER_CACHE_KEYS.all(),
        mockData,
        expect.any(Number),
      );
      expect(result).toEqual(mockData);
    });
  });

  // -------------------------------------------------------------------------
  // 2. getProviderSettings() — per-provider cache
  // -------------------------------------------------------------------------

  describe("getProviderSettings()", () => {
    it("returns cached value on hit", async () => {
      const settings = makeSettings();
      mockedCache.get.mockResolvedValueOnce(settings);

      const result = await service.getProviderSettings("mtn");

      expect(mockedCache.get).toHaveBeenCalledWith(
        PROVIDER_CACHE_KEYS.single("mtn"),
      );
      expect(mockedPool.query).not.toHaveBeenCalled();
      expect(result).toEqual(settings);
    });

    it("normalises provider name to lowercase for cache key", async () => {
      mockedCache.get.mockResolvedValueOnce(null);
      mockedPool.query.mockResolvedValueOnce({ rows: [] } as any);

      await service.getProviderSettings("MTN");

      expect(mockedCache.get).toHaveBeenCalledWith(
        PROVIDER_CACHE_KEYS.single("mtn"),
      );
    });

    it("returns null and does NOT cache when provider does not exist", async () => {
      mockedCache.get.mockResolvedValueOnce(null);
      mockedPool.query.mockResolvedValueOnce({ rows: [] } as any);

      const result = await service.getProviderSettings("unknown");

      expect(result).toBeNull();
      expect(mockedCache.set).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 3. upsertProviderSettings() — cache invalidation on modification
  // -------------------------------------------------------------------------

  describe("upsertProviderSettings() — cache invalidation", () => {
    it("deletes per-provider AND all-settings cache keys after upsert", async () => {
      const updated = makeSettings({ failure_threshold: 5, timeout_ms: 8000 });
      mockedPool.query.mockResolvedValueOnce({ rows: [updated] } as any);
      mockedCache.del.mockResolvedValue(undefined);
      mockedCache.set.mockResolvedValue(undefined);

      await service.upsertProviderSettings("mtn", 5, 8000, null);

      // Both keys must be invalidated
      expect(mockedCache.del).toHaveBeenCalledWith(
        PROVIDER_CACHE_KEYS.single("mtn"),
      );
      expect(mockedCache.del).toHaveBeenCalledWith(PROVIDER_CACHE_KEYS.all());
    });

    it("eagerly repopulates per-provider key after invalidation", async () => {
      const updated = makeSettings({ failure_threshold: 5 });
      mockedPool.query.mockResolvedValueOnce({ rows: [updated] } as any);
      mockedCache.del.mockResolvedValue(undefined);
      mockedCache.set.mockResolvedValue(undefined);

      await service.upsertProviderSettings("mtn", 5, 5000, null);

      expect(mockedCache.set).toHaveBeenCalledWith(
        PROVIDER_CACHE_KEYS.single("mtn"),
        updated,
        expect.any(Number),
      );
    });

    it("does NOT set all-settings key eagerly (leaves it for natural re-population)", async () => {
      const updated = makeSettings();
      mockedPool.query.mockResolvedValueOnce({ rows: [updated] } as any);
      mockedCache.del.mockResolvedValue(undefined);
      mockedCache.set.mockResolvedValue(undefined);

      await service.upsertProviderSettings("mtn", 3, 5000, null);

      // set() should be called only for the per-provider key
      const setCalls = mockedCache.set.mock.calls;
      const allSettingsCalls = setCalls.filter(
        ([k]) => k === PROVIDER_CACHE_KEYS.all(),
      );
      expect(allSettingsCalls).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 3b. setProviderEnabled() — manual failover toggle (#1550)
  // -------------------------------------------------------------------------

  describe("setProviderEnabled() — manual failover toggle", () => {
    it("disables a provider and records who disabled it and why", async () => {
      const disabledAt = new Date();
      const updated = makeSettings({
        provider_name: "airtel",
        is_enabled: false,
        disabled_reason: "Unplanned outage",
        disabled_by: "admin-1",
        disabled_at: disabledAt,
      });
      mockedPool.query.mockResolvedValueOnce({ rows: [updated] } as any);
      mockedCache.del.mockResolvedValue(undefined);
      mockedCache.set.mockResolvedValue(undefined);

      const result = await service.setProviderEnabled(
        "airtel",
        false,
        "admin-1",
        "Unplanned outage",
      );

      expect(result.is_enabled).toBe(false);
      expect(result.disabled_reason).toBe("Unplanned outage");

      const [, params] = mockedPool.query.mock.calls[0];
      expect(params).toEqual([
        "airtel",
        false,
        "Unplanned outage",
        "admin-1",
        expect.any(Date),
      ]);
    });

    it("re-enables a provider and clears the disabled metadata", async () => {
      const updated = makeSettings({
        provider_name: "airtel",
        is_enabled: true,
        disabled_reason: null,
        disabled_by: null,
        disabled_at: null,
      });
      mockedPool.query.mockResolvedValueOnce({ rows: [updated] } as any);
      mockedCache.del.mockResolvedValue(undefined);
      mockedCache.set.mockResolvedValue(undefined);

      const result = await service.setProviderEnabled(
        "airtel",
        true,
        "admin-1",
      );

      expect(result.is_enabled).toBe(true);

      const [, params] = mockedPool.query.mock.calls[0];
      expect(params).toEqual(["airtel", true, null, null, null]);
    });

    it("invalidates both per-provider and all-settings cache keys", async () => {
      const updated = makeSettings({ is_enabled: false });
      mockedPool.query.mockResolvedValueOnce({ rows: [updated] } as any);
      mockedCache.del.mockResolvedValue(undefined);
      mockedCache.set.mockResolvedValue(undefined);

      await service.setProviderEnabled("mtn", false, "admin-1", "Testing");

      expect(mockedCache.del).toHaveBeenCalledWith(
        PROVIDER_CACHE_KEYS.single("mtn"),
      );
      expect(mockedCache.del).toHaveBeenCalledWith(PROVIDER_CACHE_KEYS.all());
    });

    it("throws when providerName is empty", async () => {
      await expect(
        service.setProviderEnabled("   ", false, "admin-1"),
      ).rejects.toThrow("providerName is required");
      expect(mockedPool.query).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 4. createMaintenanceOutage() — outage cache invalidation
  // -------------------------------------------------------------------------

  describe("createMaintenanceOutage() — cache invalidation", () => {
    it("deletes outage cache key after creating an outage", async () => {
      const outage = {
        id: "outage-1",
        provider_name: "mtn",
        starts_at: new Date(Date.now() + 3600_000),
        ends_at: new Date(Date.now() + 7200_000),
        reason: "Planned maintenance",
        fallback_provider: null,
        notify_users: true,
        created_by: null,
      };
      mockedPool.query.mockResolvedValueOnce({ rows: [outage] } as any);
      mockedCache.del.mockResolvedValue(undefined);

      await service.createMaintenanceOutage({
        providerName: "mtn",
        startsAt: outage.starts_at,
        endsAt: outage.ends_at,
        reason: "Planned maintenance",
      });

      expect(mockedCache.del).toHaveBeenCalledWith(
        PROVIDER_CACHE_KEYS.outage("mtn"),
      );
    });
  });

  // -------------------------------------------------------------------------
  // 5. forceRefreshProviderSettings() — force in-memory re-population
  // -------------------------------------------------------------------------

  describe("forceRefreshProviderSettings()", () => {
    it("invalidates first, then re-fetches from DB", async () => {
      const fresh = makeSettings({ failure_threshold: 7, timeout_ms: 9000 });
      mockedCache.del.mockResolvedValue(undefined);
      // Second call in getProviderSettings() after invalidation
      mockedCache.get.mockResolvedValueOnce(null);
      mockedPool.query.mockResolvedValueOnce({ rows: [fresh] } as any);
      mockedCache.set.mockResolvedValue(undefined);

      const result = await service.forceRefreshProviderSettings("mtn");

      // Must have invalidated both keys before fetching
      expect(mockedCache.del).toHaveBeenCalledWith(
        PROVIDER_CACHE_KEYS.single("mtn"),
      );
      expect(mockedCache.del).toHaveBeenCalledWith(PROVIDER_CACHE_KEYS.all());

      // Must have fetched from DB
      expect(mockedPool.query).toHaveBeenCalled();

      // Must have repopulated cache
      expect(mockedCache.set).toHaveBeenCalledWith(
        PROVIDER_CACHE_KEYS.single("mtn"),
        fresh,
        expect.any(Number),
      );

      expect(result).toEqual(fresh);
    });
  });

  // -------------------------------------------------------------------------
  // 6. invalidateAll() — nuclear flush
  // -------------------------------------------------------------------------

  describe("invalidateAll()", () => {
    it("deletes all-settings key and all per-provider patterns", async () => {
      mockedCache.del.mockResolvedValue(undefined);
      mockedCache.delPattern = jest.fn().mockResolvedValue(undefined);

      await service.invalidateAll();

      expect(mockedCache.del).toHaveBeenCalledWith(PROVIDER_CACHE_KEYS.all());
      expect(mockedCache.delPattern).toHaveBeenCalledWith(
        PROVIDER_CACHE_KEYS.pattern(),
      );
      expect(mockedCache.delPattern).toHaveBeenCalledWith(
        PROVIDER_CACHE_KEYS.outagePattern(),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// 7. ProviderConfigCacheInvalidation — cross-layer invalidation orchestration
// ---------------------------------------------------------------------------

describe("ProviderConfigCacheInvalidation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCache.del.mockResolvedValue(undefined);
    mockedCache.delPattern = jest.fn().mockResolvedValue(undefined);
  });

  describe("invalidateOnConfigModification()", () => {
    it("deletes per-provider, all-settings, and outage keys from LayeredCache", async () => {
      await ProviderConfigCacheInvalidation.invalidateOnConfigModification("mtn");

      expect(mockedCache.del).toHaveBeenCalledWith(
        PROVIDER_CACHE_KEYS.single("mtn"),
      );
      expect(mockedCache.del).toHaveBeenCalledWith(PROVIDER_CACHE_KEYS.all());
      expect(mockedCache.del).toHaveBeenCalledWith(
        PROVIDER_CACHE_KEYS.outage("mtn"),
      );
    });

    it("invalidates CachedQueryManager tags: per-provider, global, and provider stats", async () => {
      const { cachedQueryManager } = require("../cachedQueryManager");

      await ProviderConfigCacheInvalidation.invalidateOnConfigModification("airtel");

      expect(cachedQueryManager.invalidateByTags).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.stringContaining("airtel"),
          expect.stringContaining("provider:config"),
        ]),
      );
    });

    it("normalises providerName to lowercase", async () => {
      await ProviderConfigCacheInvalidation.invalidateOnConfigModification("MTN");

      expect(mockedCache.del).toHaveBeenCalledWith(
        PROVIDER_CACHE_KEYS.single("mtn"),
      );
    });
  });

  describe("forceRefreshAll()", () => {
    it("clears all provider settings and outage keys via pattern delete", async () => {
      const { cachedQueryManager } = require("../cachedQueryManager");

      await ProviderConfigCacheInvalidation.forceRefreshAll();

      expect(mockedCache.del).toHaveBeenCalledWith(PROVIDER_CACHE_KEYS.all());
      expect(mockedCache.delPattern).toHaveBeenCalledWith(
        PROVIDER_CACHE_KEYS.pattern(),
      );
      expect(mockedCache.delPattern).toHaveBeenCalledWith(
        PROVIDER_CACHE_KEYS.outagePattern(),
      );
      expect(cachedQueryManager.invalidateByTag).toHaveBeenCalledWith(
        expect.stringContaining("provider:config"),
      );
    });
  });

  describe("verifySettingsReflectedAcrossModules()", () => {
    it("returns true when cache is absent (will re-populate from DB on next read)", async () => {
      mockedCache.get.mockResolvedValueOnce(null);

      const result =
        await ProviderConfigCacheInvalidation.verifySettingsReflectedAcrossModules(
          "mtn",
          { failure_threshold: 3, timeout_ms: 5000 },
        );

      expect(result).toBe(true);
    });

    it("returns true when cached values match expected settings", async () => {
      mockedCache.get.mockResolvedValueOnce({
        failure_threshold: 3,
        timeout_ms: 5000,
      });

      const result =
        await ProviderConfigCacheInvalidation.verifySettingsReflectedAcrossModules(
          "mtn",
          { failure_threshold: 3, timeout_ms: 5000 },
        );

      expect(result).toBe(true);
    });

    it("returns false when cached values are STALE (do not match expected)", async () => {
      mockedCache.get.mockResolvedValueOnce({
        // Old stale values still in cache
        failure_threshold: 1,
        timeout_ms: 1000,
      });

      const result =
        await ProviderConfigCacheInvalidation.verifySettingsReflectedAcrossModules(
          "mtn",
          { failure_threshold: 3, timeout_ms: 5000 },
        );

      // Cache is stale — should detect mismatch
      expect(result).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// 8. PROVIDER_CACHE_KEYS — key consistency
// ---------------------------------------------------------------------------

describe("PROVIDER_CACHE_KEYS", () => {
  it("all() returns a stable key", () => {
    expect(PROVIDER_CACHE_KEYS.all()).toBe("provider_settings:all");
  });

  it("single() lowercases the provider name", () => {
    expect(PROVIDER_CACHE_KEYS.single("MTN")).toBe("provider_settings:mtn");
    expect(PROVIDER_CACHE_KEYS.single("Airtel")).toBe(
      "provider_settings:airtel",
    );
  });

  it("outage() lowercases the provider name", () => {
    expect(PROVIDER_CACHE_KEYS.outage("ORANGE")).toBe("provider_outage:orange");
  });

  it("pattern() covers all single-provider keys", () => {
    expect(PROVIDER_CACHE_KEYS.pattern()).toBe("provider_settings:*");
  });

  it("outagePattern() covers all outage keys", () => {
    expect(PROVIDER_CACHE_KEYS.outagePattern()).toBe("provider_outage:*");
  });
});

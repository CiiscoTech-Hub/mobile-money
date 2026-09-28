import { Router, Request, Response } from "express";
import * as StellarSdk from "@stellar/stellar-sdk";
import logger from "../utils/logger";
import { pool } from "../config/database";
import { redisClient } from "../config/redis";
import { checkMobileMoneyHealth } from "../services/mobilemoney/providers/healthCheck";

const router = Router();

interface ComponentStatus {
  status: "up" | "down";
  latencyMs?: number;
  error?: string;
}

interface DeepHealthResponse {
  status: "healthy" | "unhealthy";
  timestamp: string;
  uptimeSeconds: number;
  memory: {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
  };
  components: {
    database: ComponentStatus;
    redis: ComponentStatus;
    horizon: ComponentStatus;
    providers: Record<string, ComponentStatus>;
  };
}

/**
 * Pings PostgreSQL with a lightweight SELECT 1.
 */
async function checkDatabase(): Promise<ComponentStatus> {
  const start = Date.now();
  try {
    await pool.query("SELECT 1");
    return { status: "up", latencyMs: Date.now() - start };
  } catch (error) {
    logger.error("[health/deep] Database check failed:", error);
    return {
      status: "down",
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

/**
 * Pings Redis with PING. Treated as down when the client isn't open,
 * matching the convention already used by /ready and /health/lb.
 */
async function checkRedis(): Promise<ComponentStatus> {
  const start = Date.now();
  try {
    if (!redisClient?.isOpen) {
      return { status: "down", error: "Redis client not connected" };
    }
    await redisClient.ping();
    return { status: "up", latencyMs: Date.now() - start };
  } catch (error) {
    logger.error("[health/deep] Redis check failed:", error);
    return {
      status: "down",
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

/**
 * Pings the configured Stellar Horizon server's root endpoint.
 */
async function checkHorizon(): Promise<ComponentStatus> {
  const horizonUrl =
    process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org";
  const start = Date.now();
  try {
    const server = new StellarSdk.Horizon.Server(horizonUrl, {
      allowHttp: horizonUrl.startsWith("http://"),
    });
    await server.root();
    return { status: "up", latencyMs: Date.now() - start };
  } catch (error) {
    logger.error("[health/deep] Horizon check failed:", error);
    return {
      status: "down",
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

/**
 * Aggregates mobile money provider gateway health via the existing
 * circuit-breaker-backed checker used elsewhere in the service.
 */
async function checkProviders(): Promise<Record<string, ComponentStatus>> {
  try {
    const { providers } = await checkMobileMoneyHealth();
    const result: Record<string, ComponentStatus> = {};
    for (const [name, health] of Object.entries(providers)) {
      result[name] = {
        status: health.status,
        ...(health.responseTime !== null
          ? { latencyMs: health.responseTime }
          : {}),
      };
    }
    return result;
  } catch (error) {
    logger.error("[health/deep] Provider health aggregation failed:", error);
    return {};
  }
}

/**
 * GET /health/deep
 *
 * Full dependency health check: PostgreSQL, Redis, Stellar Horizon, and
 * mobile money provider gateways, plus process memory and uptime stats.
 *
 * Returns 200 when database and Redis (the two critical dependencies) are
 * reachable, and 503 otherwise. Horizon and provider gateway outages are
 * reported but do not by themselves flip the top-level status, since the
 * service can still accept and queue transactions while a downstream
 * provider is degraded.
 */
router.get("/health/deep", async (_req: Request, res: Response) => {
  const [database, redis, horizon, providers] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkHorizon(),
    checkProviders(),
  ]);

  const criticalHealthy = database.status === "up" && redis.status === "up";
  const memUsage = process.memoryUsage();

  const body: DeepHealthResponse = {
    status: criticalHealthy ? "healthy" : "unhealthy",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    memory: {
      rssMb: Math.round((memUsage.rss / (1024 * 1024)) * 100) / 100,
      heapUsedMb: Math.round((memUsage.heapUsed / (1024 * 1024)) * 100) / 100,
      heapTotalMb: Math.round((memUsage.heapTotal / (1024 * 1024)) * 100) / 100,
    },
    components: {
      database,
      redis,
      horizon,
      providers,
    },
  };

  res.status(criticalHealthy ? 200 : 503).json(body);
});

export default router;
export { checkDatabase, checkRedis, checkHorizon, checkProviders };

/**
 * Rate Limiter Middleware
 *
 * Exports two distinct limiters:
 *
 * 1. sep38RateLimiter  — fixed-window, 60 rpm per authenticated client (JWT
 *    subject or IP fallback). Used on SEP-38 /prices and /quote.
 *
 * 2. merchantRateLimiter — sliding-window per merchant API key with
 *    tier-based quotas (Starter: 60 rpm, Pro: 300 rpm, Enterprise: 1000 rpm).
 *    Reads the key from the X-API-Key header, resolves the tier from DB
 *    (with L1 + Redis caching), and enforces the limit using a Redis sorted-set
 *    sliding window.  Falls back to the Starter limit when the key is absent
 *    or the tier cannot be resolved, so public (unauthenticated) callers are
 *    still protected.
 *
 * Sliding window algorithm (Redis sorted set):
 *   Each API key owns a sorted set keyed as  rl:merchant:<keyHash>
 *   Score  = request timestamp in milliseconds.
 *   Member = "<timestampMs>:<random>" (unique per request).
 *
 *   On every request a Lua script atomically:
 *     1. Removes entries outside the current 60-second window (ZREMRANGEBYSCORE).
 *     2. Adds the current request (ZADD).
 *     3. Counts remaining entries (ZCARD).
 *     4. Sets the key TTL to the window duration (PEXPIRE) so idle keys are GC'd.
 *     5. Returns {count, windowMs}.
 *
 *   This gives a true sliding window with O(log N) per request and automatic
 *   eviction of old entries, unlike a fixed window which allows a burst of
 *   2× the limit at a window boundary.
 */

import { Request, Response, NextFunction } from "express";
import { redisClient } from "../config/redis";
import logger from "../utils/logger";
import {
  getMerchantTier,
  TIER_LIMITS,
  MerchantTier,
} from "../models/merchantApiKey";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const WINDOW_MS = 60_000; // 1 minute sliding window

// ---------------------------------------------------------------------------
// ─── SEP-38 fixed-window limiter ────────────────────────────────────────────
// ---------------------------------------------------------------------------

export const SEP38_RATE_LIMIT = 60;
export const SEP38_WINDOW_MS = WINDOW_MS;

const SEP38_KEY_PREFIX = "rl:sep38";

/**
 * Derives the SEP-38 rate-limit identity from the request.
 * JWT subject preferred; IP address as fallback for unauthenticated probes.
 */
function sep38ClientKey(req: Request): string {
  const subject =
    (req as any).jwtUser?.sub ||
    (req as any).jwtUser?.userId ||
    (req as any).user?.id;

  if (subject) return `${SEP38_KEY_PREFIX}:sub:${subject}`;

  const ip = req.ip ?? "unknown";
  return `${SEP38_KEY_PREFIX}:ip:${ip}`;
}

/**
 * Fixed-window Lua script — atomically increments a counter and sets TTL on
 * first use.  Returns [count, ttlMs].
 */
const FIXED_WINDOW_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {current, ttl}
`;

async function fixedWindowIncrement(
  key: string,
  windowMs: number,
): Promise<{ count: number; ttlMs: number }> {
  const result = (await redisClient.eval(FIXED_WINDOW_LUA, {
    keys: [key],
    arguments: [String(windowMs)],
  })) as [number, number];
  return { count: result[0], ttlMs: result[1] > 0 ? result[1] : windowMs };
}

function logSep38Violation(req: Request, key: string, count: number): void {
  logger.warn(
    {
      event: "rate_limit_violation",
      category: "security",
      limiter: "sep38",
      endpoint: req.path,
      method: req.method,
      clientKey: key,
      count,
      limit: SEP38_RATE_LIMIT,
      windowMs: SEP38_WINDOW_MS,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      requestId: (req as any).requestId,
      timestamp: new Date().toISOString(),
    },
    "[SEP38_RATE_LIMIT] Limit exceeded — possible high-frequency scraping",
  );
}

/**
 * SEP-38 fixed-window rate limiter (60 rpm per JWT subject / IP).
 * Apply to GET /sep38/prices and POST /sep38/quote.
 */
export async function sep38RateLimiter(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const key = sep38ClientKey(req);

  try {
    const { count, ttlMs } = await fixedWindowIncrement(key, SEP38_WINDOW_MS);
    const remaining = Math.max(0, SEP38_RATE_LIMIT - count);
    const retrySecs = Math.ceil(ttlMs / 1000);

    res.setHeader("X-RateLimit-Limit", SEP38_RATE_LIMIT);
    res.setHeader("X-RateLimit-Remaining", remaining);
    res.setHeader("X-RateLimit-Reset", new Date(Date.now() + ttlMs).toISOString());

    if (count > SEP38_RATE_LIMIT) {
      logSep38Violation(req, key, count);
      res.setHeader("Retry-After", String(retrySecs));
      res.status(429).json({
        error: "Too Many Requests",
        message: `SEP-38 rate limit of ${SEP38_RATE_LIMIT} requests per minute exceeded. Retry in ${retrySecs} second(s).`,
        retryAfter: retrySecs,
      });
      return;
    }

    next();
  } catch (err) {
    logger.error({ err, key }, "[SEP38_RATE_LIMIT] Redis error — failing open");
    next();
  }
}

// ---------------------------------------------------------------------------
// ─── Merchant sliding-window rate limiter ────────────────────────────────────
// ---------------------------------------------------------------------------

const MERCHANT_KEY_PREFIX = "rl:merchant";

/**
 * Sliding-window Lua script using a Redis sorted set.
 *
 * KEYS[1]  = sorted-set key for this merchant
 * ARGV[1]  = current timestamp (ms)
 * ARGV[2]  = window start timestamp (ms) = now - windowMs
 * ARGV[3]  = window duration (ms) for PEXPIRE
 * ARGV[4]  = unique member string for this request
 *
 * Returns [count_after_add, window_duration_ms]
 *
 * The sorted set entries are:  score=timestampMs, member="<ts>:<unique>"
 */
const SLIDING_WINDOW_LUA = `
local now        = tonumber(ARGV[1])
local windowStart = tonumber(ARGV[2])
local windowMs   = tonumber(ARGV[3])
local member     = ARGV[4]

-- 1. Evict requests that have slid out of the window
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', windowStart)

-- 2. Record this request
redis.call('ZADD', KEYS[1], now, member)

-- 3. Count all requests within the window
local count = redis.call('ZCARD', KEYS[1])

-- 4. Refresh TTL so the key is auto-evicted after one idle window
redis.call('PEXPIRE', KEYS[1], windowMs)

return {count, windowMs}
`;

async function slidingWindowIncrement(
  key: string,
  windowMs: number,
): Promise<{ count: number; windowMs: number }> {
  const now = Date.now();
  const windowStart = now - windowMs;
  // Unique member prevents duplicate-score collisions on concurrent requests
  const member = `${now}:${Math.random().toString(36).slice(2)}`;

  const result = (await redisClient.eval(SLIDING_WINDOW_LUA, {
    keys: [key],
    arguments: [
      String(now),
      String(windowStart),
      String(windowMs),
      member,
    ],
  })) as [number, number];

  return { count: result[0], windowMs: result[1] };
}

function merchantKey(keyHash: string): string {
  return `${MERCHANT_KEY_PREFIX}:${keyHash}`;
}

/** SHA-256 of the raw API key — avoids storing secrets in Redis keys. */
async function hashApiKey(raw: string): Promise<string> {
  const { createHash } = await import("crypto");
  return createHash("sha256").update(raw).digest("hex");
}

function logMerchantViolation(
  req: Request,
  apiKeyHash: string,
  tier: MerchantTier | "unknown",
  count: number,
  limit: number,
): void {
  logger.warn(
    {
      event: "rate_limit_violation",
      category: "security",
      limiter: "merchant",
      endpoint: req.path,
      method: req.method,
      apiKeyHash,
      tier,
      count,
      limit,
      windowMs: WINDOW_MS,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
      requestId: (req as any).requestId,
      timestamp: new Date().toISOString(),
    },
    "[MERCHANT_RATE_LIMIT] Quota exceeded",
  );
}

/**
 * Merchant sliding-window rate limiter.
 *
 * Reads X-API-Key from the request header, resolves the merchant tier from
 * the database (L1 map → Redis → Postgres), then enforces the tier quota
 * using a Redis sorted-set sliding window.
 *
 * Tier quotas (requests per minute):
 *   starter    →   60
 *   pro        →  300
 *   enterprise → 1000
 *
 * Requests without an X-API-Key header are treated as 'starter' tier so that
 * public endpoints remain protected without requiring authentication.
 *
 * On breach:  HTTP 429 + Retry-After + standard X-RateLimit-* headers.
 * On Redis failure:  fails open (request passes through).
 */
export async function merchantRateLimiter(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const rawApiKey = req.header("X-API-Key");

  // Resolve tier — null key or unrecognised key falls back to 'starter'
  let tier: MerchantTier = "starter";
  if (rawApiKey) {
    const resolved = await getMerchantTier(rawApiKey).catch((err) => {
      logger.warn({ err }, "[MERCHANT_RATE_LIMIT] Tier lookup failed — defaulting to starter");
      return null;
    });
    if (resolved) tier = resolved;
  }

  const limit = TIER_LIMITS[tier];

  // Build a stable, secret-free Redis key
  const keyHash = rawApiKey
    ? await hashApiKey(rawApiKey)
    : `ip:${req.ip ?? "unknown"}`;
  const redisKey = merchantKey(keyHash);

  try {
    const { count } = await slidingWindowIncrement(redisKey, WINDOW_MS);
    const remaining = Math.max(0, limit - count);
    // Reset = end of the current 1-minute window from now
    const resetAt = new Date(Date.now() + WINDOW_MS).toISOString();

    res.setHeader("X-RateLimit-Limit", limit);
    res.setHeader("X-RateLimit-Remaining", remaining);
    res.setHeader("X-RateLimit-Reset", resetAt);

    if (count > limit) {
      logMerchantViolation(req, keyHash, tier, count, limit);

      // Retry-After = approximate seconds until the oldest request slides out
      // For a sliding window this is at most windowMs/1000 seconds.
      res.setHeader("Retry-After", String(Math.ceil(WINDOW_MS / 1000)));
      res.status(429).json({
        error: "Too Many Requests",
        message: `Rate limit exceeded for tier '${tier}' (${limit} req/min). Retry after ${Math.ceil(WINDOW_MS / 1000)} second(s).`,
        tier,
        limit,
        retryAfter: Math.ceil(WINDOW_MS / 1000),
      });
      return;
    }

    next();
  } catch (err) {
    logger.error({ err, redisKey }, "[MERCHANT_RATE_LIMIT] Redis error — failing open");
    next();
  }
}

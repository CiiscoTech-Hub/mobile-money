import { Request, Response, NextFunction } from "express";
import { redisClient } from "../config/redis";
import logger from "../utils/logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** SEP-38 price/quote endpoints: 60 requests per minute per client */
export const SEP38_RATE_LIMIT = 60;
export const SEP38_WINDOW_MS = 60 * 1000; // 1 minute

/** Redis key prefix — namespaced to avoid collisions with other limiters */
const KEY_PREFIX = "rl:sep38";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derives the rate-limit client identity from the request.
 *
 * Priority:
 *  1. JWT subject (`req.jwtUser.sub` or `req.jwtUser.userId`) — preferred
 *     because it survives IP rotation / proxies and is the correct
 *     "per authenticated client" granularity requested by the issue.
 *  2. Fallback: remote IP — guards unauthenticated probes / bots.
 */
function clientKey(req: Request): string {
  const subject =
    (req as any).jwtUser?.sub ||
    (req as any).jwtUser?.userId ||
    (req as any).user?.id;

  if (subject) {
    return `${KEY_PREFIX}:sub:${subject}`;
  }

  // req.ip is set by Express (honours X-Forwarded-For when trust proxy is on)
  const ip = req.ip ?? "unknown";
  return `${KEY_PREFIX}:ip:${ip}`;
}

/**
 * Atomically increment the counter for `key` within the current fixed window
 * and return the resulting count plus when the window resets.
 *
 * Uses a Redis Lua script so the INCR + PEXPIRE are executed atomically,
 * avoiding the race where two concurrent requests both see count === 1 and
 * both try to set the TTL.
 */
const LUA_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {current, ttl}
`;

async function incrementCounter(
  key: string,
  windowMs: number,
): Promise<{ count: number; ttlMs: number }> {
  const result = (await redisClient.eval(LUA_SCRIPT, {
    keys: [key],
    arguments: [String(windowMs)],
  })) as [number, number];

  return { count: result[0], ttlMs: result[1] > 0 ? result[1] : windowMs };
}

// ---------------------------------------------------------------------------
// Structured security log
// ---------------------------------------------------------------------------

function logRateLimitViolation(req: Request, key: string, count: number): void {
  logger.warn({
    event: "rate_limit_violation",
    category: "security",
    endpoint: req.path,
    method: req.method,
    clientKey: key,
    count,
    limit: SEP38_RATE_LIMIT,
    windowMs: SEP38_WINDOW_MS,
    // Avoid logging raw IP in the key — log separately for analytics
    ip: req.ip,
    userAgent: req.headers["user-agent"],
    requestId: (req as any).requestId,
    timestamp: new Date().toISOString(),
  }, "[SEP38_RATE_LIMIT] Limit exceeded — possible high-frequency scraping");
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * SEP-38 rate limiter — enforces 60 price/quote queries per minute per
 * authenticated client (JWT subject) or per IP for unauthenticated requests.
 *
 * On breach:
 *  - Returns HTTP 429 with a `Retry-After` header (seconds until window reset)
 *  - Logs a structured security warning for analytics
 *
 * Apply to both GET /prices and POST /quote on the sep38 router.
 */
export async function sep38RateLimiter(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const key = clientKey(req);

  try {
    const { count, ttlMs } = await incrementCounter(key, SEP38_WINDOW_MS);
    const remaining = Math.max(0, SEP38_RATE_LIMIT - count);
    const retrySecs = Math.ceil(ttlMs / 1000);

    // Informational headers on every response (mirrors convention in rateLimit.ts)
    res.setHeader("X-RateLimit-Limit", SEP38_RATE_LIMIT);
    res.setHeader("X-RateLimit-Remaining", remaining);
    res.setHeader(
      "X-RateLimit-Reset",
      new Date(Date.now() + ttlMs).toISOString(),
    );

    if (count > SEP38_RATE_LIMIT) {
      logRateLimitViolation(req, key, count);

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
    // Redis is unavailable — fail open so a Redis outage doesn't block
    // legitimate traffic, but log the error.
    logger.error(
      { err, key },
      "[SEP38_RATE_LIMIT] Redis error — failing open",
    );
    next();
  }
}

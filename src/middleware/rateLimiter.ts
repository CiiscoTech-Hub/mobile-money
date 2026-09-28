import { Request, Response, NextFunction } from "express";
import { redisClient } from "../config/redis";
import { MerchantModel } from "../models/merchant";
import logger from "../utils/logger";
import rateLimit from "express-rate-limit";

// Merchant tier rate limits (requests per minute)
const TIER_LIMITS: Record<string, number> = {
  starter: 60,
  pro: 300,
  enterprise: 1000,
};

// Default tier if not specified
const DEFAULT_TIER = "starter";

export interface MerchantRequest extends Request {
  merchant?: {
    id: string;
    tier: string;
  };
}

/**
 * Sliding window rate limiter for merchant API keys.
 * Uses Redis to track request counts per merchant with a 1-minute window.
 */
export async function merchantRateLimiter(
  req: MerchantRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Extract merchant API key from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next();
    }

    const apiKey = authHeader.substring(7);
    if (!apiKey) {
      return next();
    }

    // Get merchant ID from API key (assuming key format: merchant_id:secret)
    const [merchantId] = apiKey.split(":");
    if (!merchantId) {
      return next();
    }

    // Fetch merchant tier from database
    const merchantModel = new MerchantModel();
    const merchant = await merchantModel.findById(merchantId);
    if (!merchant) {
      res.status(401).json({ error: "Invalid API key" });
      return;
    }

    // Get merchant tier (default to starter if not set)
    const tier = (merchant.metadata?.tier as string) || DEFAULT_TIER;
    const limit = TIER_LIMITS[tier.toLowerCase()] || TIER_LIMITS[DEFAULT_TIER];

    // Redis key for rate limit tracking (sliding window per minute)
    const now = Date.now();
    const windowStart = now - 60000; // 1 minute window
    const redisKey = `rate_limit:merchant:${merchantId}`;
    const countKey = `${redisKey}:${Math.floor(now / 1000)}`;

    // Increment counter for current second
    const currentCount = await redisClient.incr(countKey);

    // Set expiry for this key (ensure cleanup)
    if (currentCount === 1) {
      await redisClient.expire(countKey, 60);
    }

    // Get all requests in the sliding window
    const secondsInWindow = 60;
    let totalRequests = 0;
    for (let i = 0; i < secondsInWindow; i++) {
      const key = `${redisKey}:${Math.floor((now - i * 1000) / 1000)}`;
      const rawCount = await redisClient.get(key);
      if (rawCount) {
        totalRequests += parseInt(String(rawCount), 10);
      }
    }

    // Set rate limit headers
    const remaining = Math.max(0, limit - totalRequests);
    const resetTime = Math.ceil((windowStart + 60000) / 1000);

    res.setHeader("X-RateLimit-Limit", limit.toString());
    res.setHeader("X-RateLimit-Remaining", remaining.toString());
    res.setHeader("X-RateLimit-Reset", resetTime.toString());

    // Check if rate limit exceeded
    if (totalRequests >= limit) {
      logger.warn(
        { merchantId, tier, limit, totalRequests },
        "Rate limit exceeded for merchant",
      );
      res.status(429).json({
        error: "Too Many Requests",
        message: `Rate limit of ${limit} requests per minute exceeded for tier: ${tier}`,
        retryAfter: resetTime,
      });
      return;
    }

    // Attach merchant info to request for downstream handlers
    req.merchant = { id: merchantId, tier };
    next();
  } catch (error) {
    logger.error({ error }, "Rate limiter error");
    // On error, allow the request to proceed but log it
    next();
  }
}

// ---------------------------------------------------------------------------
// Device verification rate limiters (consumed by src/routes/auth.ts)
// ---------------------------------------------------------------------------

/**
 * Rate limiter for the device-verification OTP check endpoint.
 * Allows 5 attempts per 15 minutes per IP to prevent brute-force.
 */
export const verifyDeviceRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too Many Requests",
    message: "Too many device verification attempts, please try again later.",
  },
});

/**
 * Rate limiter for the resend-verification-OTP endpoint.
 * Allows 3 resend requests per 10 minutes per IP.
 */
export const resendVerificationRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too Many Requests",
    message: "Too many resend requests, please try again later.",
  },
});

// ---------------------------------------------------------------------------
// SEP-38 rate limiter (consumed by src/routes/sep38.ts)
// ---------------------------------------------------------------------------

/**
 * Rate limiter for SEP-38 price and quote endpoints.
 * Allows 60 requests per minute per IP to prevent high-frequency scraping.
 */
export const sep38RateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too Many Requests",
    message: "SEP-38 rate limit exceeded. Maximum 60 requests per minute.",
  },
});

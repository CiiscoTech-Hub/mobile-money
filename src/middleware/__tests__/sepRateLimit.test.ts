import { NextFunction, Request, Response } from "express";
import {
  RATE_LIMIT_CONFIG,
  rateLimitExport,
  rateLimitListQueries,
  sep12RateLimiter,
  sep24RateLimiter,
  sep31RateLimiter,
} from "../rateLimit";
import { redisClient } from "../../config/redis";

jest.mock("../../config/redis", () => ({
  redisClient: {
    isOpen: true,
    incr: jest.fn(),
    pexpire: jest.fn(),
    sendCommand: jest.fn(),
  },
}));

const mockRedisClient = redisClient as unknown as {
  isOpen: boolean;
  incr: jest.Mock;
  pexpire: jest.Mock;
};

function buildReq(userId?: string, query: Record<string, unknown> = {}) {
  return {
    user: userId ? { id: userId } : undefined,
    query,
    path: "/test",
    method: "POST",
  } as Request;
}

function buildRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

describe("SEP rate limiters", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisClient.isOpen = true;
  });

  describe("sep24RateLimiter", () => {
    const limiter = sep24RateLimiter;

    it("returns 401 when user is missing", async () => {
      const req = buildReq();
      const res = buildRes();
      const next = jest.fn();

      await limiter(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it("allows requests under the SEP-24 limit", async () => {
      mockRedisClient.incr.mockResolvedValue(1);
      mockRedisClient.pexpire.mockResolvedValue(1);

      const req = buildReq("user-sep24");
      const res = buildRes();
      const next = jest.fn();

      await limiter(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.setHeader).toHaveBeenCalledWith(
        "X-RateLimit-Limit",
        RATE_LIMIT_CONFIG.SEP24_LIMIT,
      );
    });

    it("rejects requests when SEP-24 limit is exceeded", async () => {
      mockRedisClient.incr.mockResolvedValue(RATE_LIMIT_CONFIG.SEP24_LIMIT + 1);
      mockRedisClient.pexpire.mockResolvedValue(1);

      const req = buildReq("user-sep24");
      const res = buildRes();
      const next = jest.fn();

      await limiter(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Rate limit exceeded for SEP-24 operations",
        }),
      );
    });
  });

  describe("sep31RateLimiter", () => {
    const limiter = sep31RateLimiter;

    it("rejects requests when SEP-31 limit is exceeded", async () => {
      mockRedisClient.incr.mockResolvedValue(RATE_LIMIT_CONFIG.SEP31_LIMIT + 1);
      mockRedisClient.pexpire.mockResolvedValue(1);

      const req = buildReq("user-sep31");
      const res = buildRes();
      const next = jest.fn();

      await limiter(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Rate limit exceeded for SEP-31 operations",
        }),
      );
    });
  });

  describe("sep12RateLimiter", () => {
    const limiter = sep12RateLimiter;

    it("rejects requests when SEP-12 limit is exceeded", async () => {
      mockRedisClient.incr.mockResolvedValue(RATE_LIMIT_CONFIG.SEP12_LIMIT + 1);
      mockRedisClient.pexpire.mockResolvedValue(1);

      const req = buildReq("user-sep12");
      const res = buildRes();
      const next = jest.fn();

      await limiter(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "Rate limit exceeded for SEP-12 operations",
        }),
      );
    });
  });

  describe("rateLimitExport", () => {
    it("rejects export requests when hourly limit is exceeded", async () => {
      mockRedisClient.incr.mockResolvedValue(RATE_LIMIT_CONFIG.EXPORT_LIMIT + 1);
      mockRedisClient.pexpire.mockResolvedValue(1);

      const req = buildReq("admin-1");
      const res = buildRes();
      const next = jest.fn();

      await rateLimitExport(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "TOO_MANY_EXPORT_REQUESTS",
        }),
      );
    });
  });

  describe("rateLimitListQueries", () => {
    it("rejects massive list queries above the configured threshold", () => {
      const req = buildReq("admin-1", {
        limit: RATE_LIMIT_CONFIG.MASSIVE_LIST_THRESHOLD + 1,
      });
      const res = buildRes();
      const next = jest.fn() as NextFunction;

      rateLimitListQueries(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: "LIST_LIMIT_TOO_HIGH",
          maxAllowed: RATE_LIMIT_CONFIG.MASSIVE_LIST_THRESHOLD,
        }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("allows list queries within the configured threshold", () => {
      const req = buildReq("admin-1", { limit: 100 });
      const res = buildRes();
      const next = jest.fn() as NextFunction;

      rateLimitListQueries(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});

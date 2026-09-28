import { NextFunction, Request, Response } from "express";

jest.mock("../../services/kyc/kycService", () => ({
  KYCService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("../../models/transaction", () => ({
  TransactionModel: jest.fn().mockImplementation(() => ({})),
}));

jest.mock("../../services/transactionLimit/transactionLimitService", () => ({
  TransactionLimitService: jest.fn().mockImplementation(() => ({})),
}));

import { createKycCheck } from "../kycCheck";

describe("kycCheck middleware", () => {
  const kycLevels = {
    unverified: "unverified",
    basic: "basic",
    full: "full",
  } as const;
  const checkTransactionLimit = jest.fn();
  const middleware = createKycCheck({ checkTransactionLimit });

  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      body: {
        userId: "user-1",
        amount: 5000,
      },
      jwtUser: {
        userId: "user-1",
      },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  it("retrieves the authenticated user's KYC limit and allows the request", async () => {
    checkTransactionLimit.mockResolvedValue({
      allowed: true,
      kycLevel: kycLevels.unverified,
      dailyLimit: 10000,
      currentDailyTotal: 2000,
      remainingLimit: 3000,
    });

    await middleware(req as Request, res as Response, next);

    expect(checkTransactionLimit).toHaveBeenCalledWith("user-1", 5000);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 403 with Basic upgrade instructions for an unverified user", async () => {
    checkTransactionLimit.mockResolvedValue({
      allowed: false,
      kycLevel: kycLevels.unverified,
      dailyLimit: 10000,
      currentDailyTotal: 8000,
      remainingLimit: 2000,
      message:
        "Transaction limit exceeded. Upgrade to Basic KYC for 100,000 XAF daily limit.",
      upgradeAvailable: true,
    });

    await middleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "TRANSACTION_LIMIT_EXCEEDED",
        message: expect.stringContaining("Upgrade to Basic KYC"),
        details: expect.objectContaining({
          kycLevel: kycLevels.unverified,
          dailyLimit: 10000,
          upgradeAvailable: true,
        }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 with Full upgrade instructions for a basic user", async () => {
    checkTransactionLimit.mockResolvedValue({
      allowed: false,
      kycLevel: kycLevels.basic,
      dailyLimit: 100000,
      currentDailyTotal: 99000,
      remainingLimit: 1000,
      message:
        "Transaction limit exceeded. Upgrade to Full KYC for 1,000,000 XAF daily limit.",
      upgradeAvailable: true,
    });

    await middleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Upgrade to Full KYC"),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("does not suggest an unavailable upgrade for a full KYC user", async () => {
    checkTransactionLimit.mockResolvedValue({
      allowed: false,
      kycLevel: kycLevels.full,
      dailyLimit: 1000000,
      currentDailyTotal: 990000,
      remainingLimit: 10000,
      message: "Transaction limit exceeded for the full KYC daily limit.",
      upgradeAvailable: false,
    });

    await middleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          kycLevel: kycLevels.full,
          upgradeAvailable: false,
        }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a transaction for a different user than the JWT subject", async () => {
    req.body = {
      userId: "other-user",
      amount: 5000,
    };

    await middleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "FORBIDDEN",
        message: expect.stringContaining("authenticated user"),
      }),
    );
    expect(checkTransactionLimit).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("passes service failures to the error handler", async () => {
    const error = new Error("KYC lookup failed");
    checkTransactionLimit.mockRejectedValue(error);

    await middleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it("returns 401 when no authenticated or requested user is present", async () => {
    req.body = { amount: 5000 };
    delete req.jwtUser;

    await middleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "UNAUTHORIZED",
        message: expect.stringContaining("Authentication is required"),
      }),
    );
    expect(checkTransactionLimit).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 when amount is missing or invalid", async () => {
    req.body = { userId: "user-1", amount: "not-a-number" };

    await middleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "INVALID_AMOUNT",
        message: expect.stringContaining("positive number"),
      }),
    );
    expect(checkTransactionLimit).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 when the user has a zero daily limit", async () => {
    checkTransactionLimit.mockResolvedValue({
      allowed: false,
      kycLevel: kycLevels.unverified,
      dailyLimit: 0,
      currentDailyTotal: 0,
      remainingLimit: 0,
      message: "Transactions are disabled for this account.",
      upgradeAvailable: true,
    });

    await middleware(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "TRANSACTION_LIMIT_EXCEEDED",
        details: expect.objectContaining({
          dailyLimit: 0,
        }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("allows requests using only jwtUser when body userId is omitted", async () => {
    req.body = { amount: 2500 };
    delete req.jwtUser;
    req.jwtUser = { userId: "user-1" };

    checkTransactionLimit.mockResolvedValue({
      allowed: true,
      kycLevel: kycLevels.basic,
      dailyLimit: 100000,
      currentDailyTotal: 1000,
      remainingLimit: 99000,
    });

    await middleware(req as Request, res as Response, next);

    expect(checkTransactionLimit).toHaveBeenCalledWith("user-1", 2500);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

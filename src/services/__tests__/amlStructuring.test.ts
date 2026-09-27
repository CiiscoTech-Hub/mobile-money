import { describe, expect, it, beforeEach, jest } from "@jest/globals";
import { AMLService, AMLTransactionRecord } from "../aml";

jest.mock("../../config/database", () => ({
  pool: {
    query: jest.fn<any>().mockResolvedValue({ rows: [] }),
  },
}));

jest.mock("../cachedTransactionService", () => ({
  getCachedAmlProfileSnapshot: jest.fn<any>().mockResolvedValue({
    historicalCount: 0,
    countLastHour: 0,
    countLast24Hours: 0,
    countLast7Days: 0,
    movingAverageAmount: 0,
    lastLocationMetadata: null,
    lastLocationAt: null,
  }),
}));

describe("AMLService - Suspicious Structuring Alerts (#1569)", () => {
  let amlService: AMLService;

  beforeEach(() => {
    amlService = new AMLService({
      singleTransactionThresholdXaf: 1_000_000,
      structuringThresholdRatio: 0.8,
      structuringFrequencyLimit: 3,
    });
  });

  it("should flag user submitting multiple transactions just below KYC threshold", async () => {
    const userId = "user-123";
    const now = new Date();

    const recentTxs: AMLTransactionRecord[] = [
      {
        id: "tx-1",
        userId,
        type: "deposit",
        amount: 850_000, // 85% of threshold
        createdAt: new Date(now.getTime() - 10 * 60 * 1000),
      },
      {
        id: "tx-2",
        userId,
        type: "deposit",
        amount: 900_000, // 90% of threshold
        createdAt: new Date(now.getTime() - 5 * 60 * 1000),
      },
    ];

    const currentTx: AMLTransactionRecord = {
      id: "tx-3",
      userId,
      type: "deposit",
      amount: 950_000, // 95% of threshold
      createdAt: now,
    };

    const result = await amlService.evaluateTransaction(currentTx, recentTxs);

    expect(result.flagged).toBe(true);
    expect(result.ruleHits.some((hit) => hit.rule === "threshold_structuring")).toBe(true);
    expect(result.reasons[0]).toContain("Structuring attempt detected");
  });

  it("should not flag transactions below the structuring floor ratio", async () => {
    const userId = "user-456";
    const now = new Date();

    const recentTxs: AMLTransactionRecord[] = [
      {
        id: "tx-1",
        userId,
        type: "deposit",
        amount: 100_000, // well below 80%
        createdAt: new Date(now.getTime() - 10 * 60 * 1000),
      },
    ];

    const currentTx: AMLTransactionRecord = {
      id: "tx-2",
      userId,
      type: "deposit",
      amount: 200_000,
      createdAt: now,
    };

    const result = await amlService.evaluateTransaction(currentTx, recentTxs);

    expect(result.flagged).toBe(false);
    expect(result.ruleHits.some((hit) => hit.rule === "threshold_structuring")).toBe(false);
  });
});

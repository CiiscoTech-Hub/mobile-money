jest.mock("../../src/models/historicalPrice", () => ({
  findRange: jest.fn(),
}));

import { findRange } from "../../src/models/historicalPrice";
import { computeVolatility } from "../../src/utils/volatility";

const mockFindRange = findRange as jest.Mock;

describe("computeVolatility", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns null when fewer than 2 snapshots are available", async () => {
    mockFindRange.mockResolvedValueOnce([
      { price: 0.12, recordedAt: new Date(), source: "test" },
    ]);

    const result = await computeVolatility("XLM", "USD");
    expect(result).toBeNull();
  });

  it("returns null when no snapshots are available", async () => {
    mockFindRange.mockResolvedValueOnce([]);

    const result = await computeVolatility("XLM", "USD");
    expect(result).toBeNull();
  });

  it("computes coefficient of variation from historical prices", async () => {
    mockFindRange.mockResolvedValueOnce([
      { price: 0.1, recordedAt: new Date(), source: "test" },
      { price: 0.2, recordedAt: new Date(), source: "test" },
    ]);

    const result = await computeVolatility("XLM", "USD");

    expect(result).not.toBeNull();
    expect(result!.sampleSize).toBe(2);
    expect(result!.mean).toBeCloseTo(0.15, 5);
    // stddev of [0.1, 0.2] (population) = 0.05
    expect(result!.stddev).toBeCloseTo(0.05, 5);
    // CV = 0.05 / 0.15 * 100 ≈ 33.333%
    expect(result!.coefficientOfVariation).toBeCloseTo(33.3333, 3);
  });

  it("returns zero coefficient of variation for perfectly stable prices", async () => {
    mockFindRange.mockResolvedValueOnce([
      { price: 1, recordedAt: new Date(), source: "test" },
      { price: 1, recordedAt: new Date(), source: "test" },
      { price: 1, recordedAt: new Date(), source: "test" },
    ]);

    const result = await computeVolatility("XLM", "USD");
    expect(result!.coefficientOfVariation).toBe(0);
  });

  it("passes the configured lookback window through to findRange", async () => {
    mockFindRange.mockResolvedValueOnce([
      { price: 1, recordedAt: new Date(), source: "test" },
      { price: 1.1, recordedAt: new Date(), source: "test" },
    ]);

    await computeVolatility("USD", "XAF", 6);

    expect(mockFindRange).toHaveBeenCalledTimes(1);
    const [base, quote, from, to] = mockFindRange.mock.calls[0];
    expect(base).toBe("USD");
    expect(quote).toBe("XAF");
    expect(to.getTime() - from.getTime()).toBe(6 * 60 * 60 * 1000);
  });
});

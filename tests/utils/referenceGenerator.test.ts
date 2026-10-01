import {
  isValidReferenceNumber,
  checkReferenceExists,
  isReferenceAvailable,
  generateReferenceNumber,
} from "../../src/utils/referenceGenerator";

jest.mock("../../src/utils/lock", () => ({
  lockManager: {
    withLock: jest.fn((key: string, fn: () => Promise<any>) => fn()),
  },
  LockKeys: {
    referenceNumber: (dateStr: string) => `lock:ref:${dateStr}`,
  },
}));

const mockQuery = jest.fn();
jest.mock("../../src/config/database", () => ({
  pool: {
    query: (...args: any[]) => mockQuery(...args),
  },
  queryRead: (...args: any[]) => mockQuery(...args),
}));

describe("Reference Number Generator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("isValidReferenceNumber", () => {
    it("should validate correct reference number format for various prefixes", () => {
      expect(isValidReferenceNumber("TXN-20260322-00001")).toBe(true);
      expect(isValidReferenceNumber("TXN-20260322-99999")).toBe(true);
      expect(isValidReferenceNumber("WTH-20260322-00001")).toBe(true);
      expect(isValidReferenceNumber("DEP-20260322-00001")).toBe(true);
      expect(isValidReferenceNumber("REF-20260322-00001")).toBe(true);
    });

    it("should reject invalid formats", () => {
      expect(isValidReferenceNumber("TXN-2026032-00001")).toBe(false); // Wrong date length
      expect(isValidReferenceNumber("TXN-20260322-0001")).toBe(false); // Wrong sequence length
      expect(isValidReferenceNumber("TX-20260322-00001")).toBe(false); // Wrong prefix
      expect(isValidReferenceNumber("TXN-20260322-ABCDE")).toBe(false); // Non-numeric sequence
      expect(isValidReferenceNumber("invalid")).toBe(false);
      expect(isValidReferenceNumber("")).toBe(false);
      expect(isValidReferenceNumber(null as any)).toBe(false);
    });
  });

  describe("checkReferenceExists & isReferenceAvailable", () => {
    it("should return true when reference number exists in DB index", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ exists: true }] });
      const exists = await checkReferenceExists("TXN-20260322-00001");
      expect(exists).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("SELECT EXISTS"),
        ["TXN-20260322-00001"],
      );
    });

    it("should return false when reference number does not exist", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ exists: false }] });
      const available = await isReferenceAvailable("TXN-20260322-00002");
      expect(available).toBe(true);
    });

    it("should return false for invalid or empty reference inputs without querying DB", async () => {
      expect(await checkReferenceExists("")).toBe(false);
      expect(await checkReferenceExists(null as any)).toBe(false);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe("generateReferenceNumber", () => {
    it("should generate sequence 00001 when no previous record exists today", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const ref = await generateReferenceNumber();
      expect(ref).toMatch(/^TXN-\d{8}-00001$/);
    });

    it("should increment sequence when previous records exist", async () => {
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      mockQuery.mockResolvedValueOnce({
        rows: [{ reference_number: `TXN-${today}-00042` }],
      });
      const ref = await generateReferenceNumber();
      expect(ref).toBe(`TXN-${today}-00043`);
    });
  });
});

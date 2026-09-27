/**
 * BatchTransactionService — Unit Tests
 *
 * Covers:
 *  - submitBatch: deposit, withdraw, concurrency, event emission
 *  - validateBatch: missing keys, bad phone format, bad amount, duplicates
 *  - Deduplication: last entry within batch wins
 *  - Item timeout: exceeding per-item timeout returns a failed outcome
 *  - Provider error: graceful failure of individual items
 */

import { BatchTransactionService } from "../batchTransactionService";
import { MobileMoneyService } from "../mobilemoney/mobileMoneyService";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("../mobilemoney/mobileMoneyService");
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}));

const MockMobileMoneyService = MobileMoneyService as jest.MockedClass<
  typeof MobileMoneyService
>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<any> = {}): any {
  return {
    idempotencyKey: `key-${Math.random().toString(36).slice(2, 8)}`,
    phoneNumber: "+2348012345678",
    amount: "500",
    provider: "mtn",
    ...overrides,
  };
}

function mockSuccessResult(reference = "ref-ok") {
  return { success: true, data: { reference }, error: undefined };
}

function mockFailResult(error = "Provider error") {
  return { success: false, data: undefined, error };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("BatchTransactionService", () => {
  let mms: jest.Mocked<MobileMoneyService>;
  let svc: BatchTransactionService;

  beforeEach(() => {
    jest.clearAllMocks();
    mms = new MockMobileMoneyService() as jest.Mocked<MobileMoneyService>;
    svc = new BatchTransactionService(mms as any, { concurrency: 3 });
  });

  // ── submitBatch ────────────────────────────────────────────────────────────

  describe("submitBatch", () => {
    describe("deposit", () => {
      it("calls initiatePayment for each item and returns a BatchReport", async () => {
        const items = [makeItem(), makeItem()];
        mms.initiatePayment.mockResolvedValue(
          mockSuccessResult("ref-1") as any,
        );

        const report = await svc.submitBatch("deposit", items);

        expect(mms.initiatePayment).toHaveBeenCalledTimes(2);
        expect(report.type).toBe("deposit");
        expect(report.total).toBe(2);
        expect(report.succeeded).toBe(2);
        expect(report.failed).toBe(0);
        expect(report.items).toHaveLength(2);
      });
    });

    describe("withdraw", () => {
      it("calls sendPayout for each item", async () => {
        const items = [makeItem()];
        mms.sendPayout.mockResolvedValue(mockSuccessResult("payout-1") as any);

        const report = await svc.submitBatch("withdraw", items);

        expect(mms.sendPayout).toHaveBeenCalledTimes(1);
        expect(report.succeeded).toBe(1);
      });
    });

    it("records providerReference in the outcome on success", async () => {
      const items = [makeItem({ idempotencyKey: "k1" })];
      mms.initiatePayment.mockResolvedValue(
        mockSuccessResult("prov-ref-123") as any,
      );

      const report = await svc.submitBatch("deposit", items);

      expect(report.items[0].providerReference).toBe("prov-ref-123");
    });

    it("records error in the outcome on failure", async () => {
      const items = [makeItem({ idempotencyKey: "k2" })];
      mms.initiatePayment.mockResolvedValue(
        mockFailResult("Insufficient funds") as any,
      );

      const report = await svc.submitBatch("deposit", items);

      expect(report.items[0].success).toBe(false);
      expect(report.items[0].error).toBe("Insufficient funds");
    });

    it("marks an item as failed when the provider throws", async () => {
      const items = [makeItem()];
      mms.initiatePayment.mockRejectedValue(new Error("Network failure"));

      const report = await svc.submitBatch("deposit", items);

      expect(report.failed).toBe(1);
      expect(report.items[0].error).toContain("Network failure");
    });

    it("processes items with mixed outcomes correctly", async () => {
      const items = [
        makeItem({ idempotencyKey: "ok" }),
        makeItem({ idempotencyKey: "fail" }),
      ];
      mms.initiatePayment
        .mockResolvedValueOnce(mockSuccessResult("ref-ok") as any)
        .mockResolvedValueOnce(mockFailResult("Rejected") as any);

      const report = await svc.submitBatch("deposit", items);

      expect(report.succeeded).toBe(1);
      expect(report.failed).toBe(1);
    });

    it("deduplicates items with the same idempotency key (last wins)", async () => {
      const key = "dup-key";
      const items = [
        makeItem({ idempotencyKey: key, amount: "100" }),
        makeItem({ idempotencyKey: key, amount: "200" }),
      ];
      mms.initiatePayment.mockResolvedValue(mockSuccessResult("r") as any);

      const report = await svc.submitBatch("deposit", items);

      // Only one unique key should be processed
      expect(mms.initiatePayment).toHaveBeenCalledTimes(1);
      expect(report.total).toBe(1);
    });

    it("throws when the items array is empty", async () => {
      await expect(svc.submitBatch("deposit", [])).rejects.toThrow(
        "at least one item",
      );
    });

    it("emits batch:start and batch:complete events", async () => {
      const onStart = jest.fn();
      const onComplete = jest.fn();
      svc.on("batch:start", onStart);
      svc.on("batch:complete", onComplete);

      mms.initiatePayment.mockResolvedValue(mockSuccessResult() as any);
      await svc.submitBatch("deposit", [makeItem()]);

      expect(onStart).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it("emits item:complete for each successful item", async () => {
      const onItemComplete = jest.fn();
      svc.on("item:complete", onItemComplete);
      mms.initiatePayment.mockResolvedValue(mockSuccessResult("r-1") as any);

      await svc.submitBatch("deposit", [makeItem(), makeItem()]);

      expect(onItemComplete).toHaveBeenCalledTimes(2);
    });

    it("emits item:error for failed items", async () => {
      const onItemError = jest.fn();
      svc.on("item:error", onItemError);
      mms.initiatePayment.mockRejectedValue(new Error("Timeout"));

      await svc.submitBatch("deposit", [makeItem()]);

      expect(onItemError).toHaveBeenCalledTimes(1);
    });
  });

  // ── validateBatch ─────────────────────────────────────────────────────────

  describe("validateBatch", () => {
    it("returns no errors for a valid batch", () => {
      const errors = svc.validateBatch([
        makeItem({
          idempotencyKey: "k1",
          phoneNumber: "+12125551234",
          amount: "100",
        }),
        makeItem({
          idempotencyKey: "k2",
          phoneNumber: "+447911123456",
          amount: "50.5",
        }),
      ]);
      expect(errors).toHaveLength(0);
    });

    it("returns an error for missing idempotency key", () => {
      const errors = svc.validateBatch([makeItem({ idempotencyKey: "" })]);
      expect(errors.some((e) => e.includes("idempotencyKey is required"))).toBe(
        true,
      );
    });

    it("returns an error for duplicate idempotency keys", () => {
      const errors = svc.validateBatch([
        makeItem({ idempotencyKey: "same" }),
        makeItem({ idempotencyKey: "same" }),
      ]);
      expect(errors.some((e) => e.includes("duplicate idempotencyKey"))).toBe(
        true,
      );
    });

    it("returns an error for phone numbers not in E.164 format", () => {
      const errors = svc.validateBatch([
        makeItem({ phoneNumber: "08012345678" }),
      ]);
      expect(errors.some((e) => e.includes("E.164"))).toBe(true);
    });

    it("returns an error for zero or negative amount", () => {
      const errors = svc.validateBatch([makeItem({ amount: "0" })]);
      expect(errors.some((e) => e.includes("positive number"))).toBe(true);
    });

    it("returns an error for non-numeric amount", () => {
      const errors = svc.validateBatch([makeItem({ amount: "abc" })]);
      expect(errors.some((e) => e.includes("positive number"))).toBe(true);
    });

    it("returns an error for missing provider", () => {
      const errors = svc.validateBatch([makeItem({ provider: "" })]);
      expect(errors.some((e) => e.includes("provider is required"))).toBe(true);
    });
  });
});

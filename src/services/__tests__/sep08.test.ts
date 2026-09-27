import { SEP08Service, sep08Service } from "../compliance/sep08";
import { Transaction } from "../../models/transaction";

describe("SEP-08 Compliance Service", () => {
  let service: SEP08Service;
  let mockFetch: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SEP08Service();
    mockFetch = global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;
  });

  describe("isEnabled", () => {
    it("returns false when approval server URL is not configured", () => {
      process.env.SEP08_APPROVAL_SERVER_URL = "";
      const testService = new SEP08Service();
      expect(testService.isEnabled()).toBe(false);
    });

    it("returns true when approval server URL is configured", () => {
      process.env.SEP08_APPROVAL_SERVER_URL = "https://approval.example.com";
      const testService = new SEP08Service();
      expect(testService.isEnabled()).toBe(true);
    });
  });

  describe("verifyApproval", () => {
    const mockRequest = {
      transactionId: "tx-123",
      stellarAddress: "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC",
      amount: 1000,
      assetCode: "USDC",
      operation: "deposit" as const,
      kycLevel: "tier2",
    };

    it("returns success when SEP-08 is not configured", async () => {
      process.env.SEP08_APPROVAL_SERVER_URL = "";
      const testService = new SEP08Service();

      const result = await testService.verifyApproval(mockRequest);

      expect(result.status).toBe("success");
      expect(result.message).toContain("not configured");
      expect(result.verifiedAt).toBeInstanceOf(Date);
    });

    it("returns success when approval server returns approved status", async () => {
      process.env.SEP08_APPROVAL_SERVER_URL = "https://approval.example.com";
      const testService = new SEP08Service();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          approved: true,
          pending: false,
          rejected: false,
        }),
      } as Response);

      const result = await testService.verifyApproval(mockRequest);

      expect(result.status).toBe("success");
      expect(result.message).toBe("Transaction approval verified");
      expect(result.approvalServer).toBe("https://approval.example.com");
      expect(result.verifiedAt).toBeInstanceOf(Date);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://approval.example.com/approval",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: expect.stringContaining(mockRequest.transactionId),
        }),
      );
    });

    it("returns failed when approval server returns rejected status", async () => {
      process.env.SEP08_APPROVAL_SERVER_URL = "https://approval.example.com";
      const testService = new SEP08Service();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          approved: false,
          pending: false,
          rejected: true,
          rejection_reason: "KYC verification required",
        }),
      } as Response);

      const result = await testService.verifyApproval(mockRequest);

      expect(result.status).toBe("failed");
      expect(result.message).toBe("KYC verification required");
      expect(result.approvalServer).toBe("https://approval.example.com");
    });

    it("returns pending when approval server returns pending status", async () => {
      process.env.SEP08_APPROVAL_SERVER_URL = "https://approval.example.com";
      const testService = new SEP08Service();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          approved: false,
          pending: true,
          rejected: false,
          required_fields: ["id_document", "selfie"],
        }),
      } as Response);

      const result = await testService.verifyApproval(mockRequest);

      expect(result.status).toBe("pending");
      expect(result.message).toBe("Transaction approval pending additional information");
      expect(result.approvalServer).toBe("https://approval.example.com");
    });

    it("returns failed when approval server returns non-approved status", async () => {
      process.env.SEP08_APPROVAL_SERVER_URL = "https://approval.example.com";
      const testService = new SEP08Service();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          approved: false,
          pending: false,
          rejected: false,
        }),
      } as Response);

      const result = await testService.verifyApproval(mockRequest);

      expect(result.status).toBe("failed");
      expect(result.message).toBe("Transaction approval status not confirmed");
    });

    it("returns failed when approval server is unavailable", async () => {
      process.env.SEP08_APPROVAL_SERVER_URL = "https://approval.example.com";
      const testService = new SEP08Service();

      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await testService.verifyApproval(mockRequest);

      expect(result.status).toBe("failed");
      expect(result.message).toBe("Approval verification service unavailable");
    });

    it("returns failed when approval server returns non-OK status", async () => {
      process.env.SEP08_APPROVAL_SERVER_URL = "https://approval.example.com";
      const testService = new SEP08Service();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as Response);

      const result = await testService.verifyApproval(mockRequest);

      expect(result.status).toBe("failed");
      expect(result.message).toBe("Approval verification service unavailable");
    });

    it("returns failed when approval server request times out", async () => {
      process.env.SEP08_APPROVAL_SERVER_URL = "https://approval.example.com";
      process.env.SEP08_TIMEOUT_MS = "50";
      const testService = new SEP08Service();

      mockFetch.mockImplementationOnce(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("AbortError: timeout")), 100),
          ),
      );

      const result = await testService.verifyApproval(mockRequest);

      expect(result.status).toBe("failed");
      expect(result.message).toBe("Approval verification service unavailable");
    });
  });

  describe("verifyDepositApproval", () => {
    const mockTransaction: Transaction = {
      id: "tx-123",
      referenceNumber: "REF-123",
      type: "deposit",
      amount: "1000",
      phoneNumber: "+237670000000",
      provider: "mtn",
      stellarAddress: "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC",
      status: "pending",
      userId: "user-123",
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        kycLevel: "tier2",
      },
    } as Transaction;

    it("calls verifyApproval with correct deposit parameters", async () => {
      process.env.SEP08_APPROVAL_SERVER_URL = "https://approval.example.com";
      const testService = new SEP08Service();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          approved: true,
          pending: false,
          rejected: false,
        }),
      } as Response);

      const result = await testService.verifyDepositApproval(mockTransaction, "USDC");

      expect(result.status).toBe("success");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://approval.example.com/approval",
        expect.objectContaining({
          body: expect.stringContaining('"operation":"deposit"'),
        }),
      );
    });
  });

  describe("verifyWithdrawalApproval", () => {
    const mockTransaction: Transaction = {
      id: "tx-123",
      referenceNumber: "REF-123",
      type: "withdraw",
      amount: "1000",
      phoneNumber: "+237670000000",
      provider: "mtn",
      stellarAddress: "GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC",
      status: "pending",
      userId: "user-123",
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        kycLevel: "tier2",
      },
    } as Transaction;

    it("calls verifyApproval with correct withdrawal parameters", async () => {
      process.env.SEP08_APPROVAL_SERVER_URL = "https://approval.example.com";
      const testService = new SEP08Service();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          approved: true,
          pending: false,
          rejected: false,
        }),
      } as Response);

      const result = await testService.verifyWithdrawalApproval(
        mockTransaction,
        "USDC",
      );

      expect(result.status).toBe("success");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://approval.example.com/approval",
        expect.objectContaining({
          body: expect.stringContaining('"operation":"withdraw"'),
        }),
      );
    });
  });
});

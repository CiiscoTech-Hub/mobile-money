import axios from "axios";
import crypto from "crypto";
import { VodacomProvider } from "../../src/services/mobilemoney/providers/vodacom";
import {
  resolveVodacomError,
  VODACOM_ERROR_MATRIX,
} from "../../src/services/mobilemoney/providers/errors/vodacomErrorMatrix";

jest.mock("../../src/services/providerSettingsService", () => ({
  providerSettingsService: {
    resolveMaintenanceRouting: jest.fn().mockResolvedValue({ action: "proceed" }),
  },
}));

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock("crypto", () => {
  const originalCrypto = jest.requireActual("crypto");
  return {
    ...originalCrypto,
    publicEncrypt: jest
      .fn()
      .mockImplementation((options: any, buffer: Buffer) => {
        return Buffer.from(`mock-encrypted:${buffer.toString()}`);
      }),
  };
});

function createMockClient() {
  return {
    get: jest.fn(),
    post: jest.fn(),
  };
}

describe("Vodacom Bridge Deposit Integration", () => {
  let provider: VodacomProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.VODACOM_API_KEY = "test-api-key";
    process.env.VODACOM_PUBLIC_KEY = "mock-public-key-pem";
    process.env.VODACOM_SERVICE_PROVIDER_CODE = "123456";
    process.env.VODACOM_BASE_URL = "https://sandbox.openapi.m-pesa.com";
    process.env.VODACOM_MARKET = "vodacomTZN";
    process.env.VODACOM_CURRENCY = "TZS";
  });

  describe("Full deposit lifecycle", () => {
    it("should complete a full deposit flow: auth → C2B payment → status check", async () => {
      const mockClient = {
        get: jest.fn()
          .mockResolvedValueOnce({
            data: {
              output_ResponseCode: "INS-0",
              output_ResponseDesc: "Request processed successfully",
              output_SessionID: "session-lifecycle-001",
            },
          })
          .mockResolvedValueOnce({
            data: {
              output_ResponseCode: "INS-0",
              output_TransactionStatus: "SUCCESSFUL",
              output_TransactionID: "TXN-LIFECYCLE-001",
            },
          }),
        post: jest.fn()
          .mockResolvedValueOnce({
            data: {
              output_ResponseCode: "INS-0",
              output_ResponseDesc: "Request processed successfully",
              output_TransactionID: "TXN-LIFECYCLE-001",
            },
          }),
      };

      mockedAxios.create.mockReturnValue(mockClient as any);
      provider = new VodacomProvider();

      const paymentResult = await provider.requestPayment(
        "255700000000",
        "5000",
      );

      expect(paymentResult.success).toBe(true);
      expect(paymentResult.data.output_TransactionID).toBe(
        "TXN-LIFECYCLE-001",
      );
      expect(paymentResult.providerResponseTimeMs).toBeGreaterThanOrEqual(0);

      const statusResult = await provider.getTransactionStatus(
        "TXN-LIFECYCLE-001",
      );

      expect(statusResult.status).toBe("completed");

      expect(mockClient.get).toHaveBeenCalledWith(
        "/vodacomTZN/getSession/",
        expect.any(Object),
      );

      expect(mockClient.post).toHaveBeenCalledWith(
        "/vodacomTZN/c2bPayment/singleStage/",
        expect.objectContaining({
          input_Amount: "5000",
          input_CustomerMSISDN: "255700000000",
          input_ServiceProviderCode: "123456",
          input_Currency: "TZS",
          input_Country: "TZN",
        }),
        expect.any(Object),
      );

      expect(mockClient.get).toHaveBeenCalledWith(
        "/vodacomTZN/queryTransactionStatus/",
        expect.objectContaining({
          params: expect.objectContaining({
            input_QueryReference: "TXN-LIFECYCLE-001",
            input_ServiceProviderCode: "123456",
          }),
        }),
      );
    });

    it("should handle deposit failure and still allow status check", async () => {
      const mockClient = {
        get: jest.fn()
          .mockResolvedValueOnce({
            data: {
              output_ResponseCode: "INS-0",
              output_SessionID: "session-002",
            },
          })
          .mockResolvedValueOnce({
            data: {
              output_ResponseCode: "INS-0",
              output_TransactionStatus: "FAILED",
            },
          }),
        post: jest.fn()
          .mockResolvedValueOnce({
            data: {
              output_ResponseCode: "INS-2",
              output_ResponseDesc: "Insufficient Balance",
            },
          }),
      };

      mockedAxios.create.mockReturnValue(mockClient as any);
      provider = new VodacomProvider();

      const paymentResult = await provider.requestPayment(
        "255700000000",
        "1000000",
      );

      expect(paymentResult.success).toBe(false);
      expect(paymentResult.error).toBeDefined();

      const statusResult = await provider.getTransactionStatus("TXN-UNKNOWN");
      expect(statusResult.status).toBe("failed");
    });
  });

  describe("Session token caching", () => {
    it("should reuse cached session token without re-authenticating", async () => {
      const mockClient = createMockClient();

      mockClient.get.mockResolvedValueOnce({
        data: {
          output_ResponseCode: "INS-0",
          output_SessionID: "cached-session-001",
        },
      });

      mockClient.post.mockResolvedValue({
        data: {
          output_ResponseCode: "INS-0",
          output_TransactionID: "TXN-CACHE-001",
        },
      });

      mockedAxios.create.mockReturnValue(mockClient as any);
      provider = new VodacomProvider();

      await provider.requestPayment("255700000000", "1000");

      await provider.requestPayment("255700000000", "2000");

      const getSessionCalls = mockClient.get.mock.calls.filter(
        (c) => c[0] === "/vodacomTZN/getSession/",
      );
      expect(getSessionCalls).toHaveLength(1);
    });

    it("should re-authenticate when session token expires", async () => {
      const mockClient = createMockClient();

      mockClient.get.mockResolvedValueOnce({
        data: {
          output_ResponseCode: "INS-0",
          output_SessionID: "session-expiring",
        },
      });

      mockClient.post.mockResolvedValue({
        data: {
          output_ResponseCode: "INS-0",
          output_TransactionID: "TXN-001",
        },
      });

      mockedAxios.create.mockReturnValue(mockClient as any);
      provider = new VodacomProvider();

      await provider.requestPayment("255700000000", "1000");

      (provider as any).sessionTokenExpiry = Date.now() - 1000;

      await provider.requestPayment("255700000000", "2000");

      const getSessionCalls = mockClient.get.mock.calls.filter(
        (c) => c[0] === "/vodacomTZN/getSession/",
      );
      expect(getSessionCalls).toHaveLength(2);
    });
  });

  describe("Error matrix resolution", () => {
    it("should resolve INS-0 as success (undefined)", () => {
      expect(resolveVodacomError("INS-0")).toBeUndefined();
    });

    it("should resolve all known INS-* codes", () => {
      const knownCodes = Object.keys(VODACOM_ERROR_MATRIX);

      for (const code of knownCodes) {
        const result = resolveVodacomError(code);
        expect(result).toBeDefined();
        expect(result!.errorCode).toBeTruthy();
        expect(result!.message).toBeTruthy();
        expect(typeof result!.retryable).toBe("boolean");
      }
    });

    it("should mark retryable errors correctly", () => {
      const retryableErrors = Object.entries(VODACOM_ERROR_MATRIX)
        .filter(([_, entry]) => entry.retryable)
        .map(([code]) => code);

      expect(retryableErrors).toContain("INS-1");
      expect(retryableErrors).toContain("INS-14");
      expect(retryableErrors).toContain("INS-21");
      expect(retryableErrors).toContain("INS-22");
      expect(retryableErrors).toContain("INS-24");
      expect(retryableErrors).toContain("INS-26");
    });

    it("should mark non-retryable errors correctly", () => {
      const nonRetryableErrors = Object.entries(VODACOM_ERROR_MATRIX)
        .filter(([_, entry]) => !entry.retryable)
        .map(([code]) => code);

      expect(nonRetryableErrors).toContain("INS-2");
      expect(nonRetryableErrors).toContain("INS-3");
      expect(nonRetryableErrors).toContain("INS-6");
      expect(nonRetryableErrors).toContain("INS-9");
      expect(nonRetryableErrors).toContain("INS-997");
    });

    it("should handle unknown INS codes gracefully", () => {
      const result = resolveVodacomError("INS-UNKNOWN-999");

      expect(result).toBeDefined();
      expect(result!.errorCode).toBe("PROVIDER_ERROR");
      expect(result!.message).toContain("Unrecognised");
      expect(result!.retryable).toBe(false);
    });

    it("should map insufficient balance error correctly", () => {
      const result = resolveVodacomError("INS-2");

      expect(result!.errorCode).toBe("INSUFFICIENT_BALANCE");
      expect(result!.retryable).toBe(false);
    });

    it("should map invalid phone number error correctly", () => {
      const result = resolveVodacomError("INS-6");

      expect(result!.errorCode).toBe("INVALID_PHONE_FORMAT");
      expect(result!.retryable).toBe(false);
    });

    it("should map session expired error as retryable", () => {
      const result = resolveVodacomError("INS-14");

      expect(result!.errorCode).toBe("UNAUTHORIZED");
      expect(result!.retryable).toBe(true);
    });
  });

  describe("C2B payment edge cases", () => {
    it("should include all required fields in C2B request", async () => {
      const mockClient = createMockClient();

      mockClient.get.mockResolvedValue({
        data: {
          output_ResponseCode: "INS-0",
          output_SessionID: "session-003",
        },
      });

      mockClient.post.mockResolvedValue({
        data: {
          output_ResponseCode: "INS-0",
          output_TransactionID: "TXN-003",
        },
      });

      mockedAxios.create.mockReturnValue(mockClient as any);
      provider = new VodacomProvider();

      await provider.requestPayment("255700000000", "1500");

      const c2bCall = mockClient.post.mock.calls[0];
      const payload = c2bCall[1];

      expect(payload).toHaveProperty("input_Amount", "1500");
      expect(payload).toHaveProperty("input_CustomerMSISDN", "255700000000");
      expect(payload).toHaveProperty("input_ServiceProviderCode", "123456");
      expect(payload).toHaveProperty("input_Currency", "TZS");
      expect(payload).toHaveProperty("input_Country", "TZN");
      expect(payload).toHaveProperty("input_PurchasedItemsDesc", "Stellar Deposit");
      expect(payload.input_ThirdPartyConversationID).toMatch(/^VODA-C2B-/);
      expect(payload.input_TransactionReference).toMatch(/^VODA-C2B-/);
    });

    it("should send encrypted token in authorization header", async () => {
      const mockClient = createMockClient();

      mockClient.get.mockResolvedValue({
        data: {
          output_ResponseCode: "INS-0",
          output_SessionID: "auth-token-001",
        },
      });

      mockClient.post.mockResolvedValue({
        data: {
          output_ResponseCode: "INS-0",
          output_TransactionID: "TXN-AUTH-001",
        },
      });

      mockedAxios.create.mockReturnValue(mockClient as any);
      provider = new VodacomProvider();

      await provider.requestPayment("255700000000", "1000");

      const postCall = mockClient.post.mock.calls[0];
      const authHeader = postCall[2].headers.Authorization;

      expect(authHeader).toMatch(/^Bearer /);

      const encryptedValue = authHeader.split(" ")[1];
      const decrypted = Buffer.from(encryptedValue, "base64").toString();
      expect(decrypted).toBe("mock-encrypted:auth-token-001");
    });

    it("should handle various INS error codes during C2B payment", async () => {
      const testCases = [
        { code: "INS-2", expectedError: "Insufficient balance" },
        { code: "INS-6", expectedError: "Invalid or unregistered MSISDN" },
        { code: "INS-9", expectedError: "Invalid transaction amount" },
        { code: "INS-10", expectedError: "Duplicate transaction detected" },
        { code: "INS-24", expectedError: "Vodacom system is overloaded" },
      ];

      for (const tc of testCases) {
        const mockClient = createMockClient();

        mockClient.get.mockResolvedValue({
          data: {
            output_ResponseCode: "INS-0",
            output_SessionID: "session-error",
          },
        });

        mockClient.post.mockResolvedValue({
          data: {
            output_ResponseCode: tc.code,
            output_ResponseDesc: tc.expectedError,
          },
        });

        mockedAxios.create.mockReturnValue(mockClient as any);
        provider = new VodacomProvider();

        const result = await provider.requestPayment(
          "255700000000",
          "1000",
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.error.message).toContain(tc.expectedError);
      }
    });
  });

  describe("B2C payout edge cases", () => {
    it("should include all required fields in B2C request", async () => {
      const mockClient = createMockClient();

      mockClient.get.mockResolvedValue({
        data: {
          output_ResponseCode: "INS-0",
          output_SessionID: "session-b2c",
        },
      });

      mockClient.post.mockResolvedValue({
        data: {
          output_ResponseCode: "INS-0",
          output_TransactionID: "TXN-B2C-001",
        },
      });

      mockedAxios.create.mockReturnValue(mockClient as any);
      provider = new VodacomProvider();

      await provider.sendPayout("255700000000", "2500");

      const b2cCall = mockClient.post.mock.calls[0];
      const payload = b2cCall[1];

      expect(b2cCall[0]).toBe("/vodacomTZN/b2cPayment/singleStage/");
      expect(payload.input_Amount).toBe("2500");
      expect(payload.input_CustomerMSISDN).toBe("255700000000");
      expect(payload.input_PurchasedItemsDesc).toBe("Stellar Payout");
      expect(payload.input_ThirdPartyConversationID).toMatch(/^VODA-B2C-/);
    });
  });

  describe("Transaction status mapping", () => {
    it("should map SUCCESSFUL status to completed", async () => {
      const mockClient = createMockClient();

      mockClient.get
        .mockResolvedValueOnce({
          data: {
            output_ResponseCode: "INS-0",
            output_SessionID: "session-status",
          },
        })
        .mockResolvedValueOnce({
          data: {
            output_ResponseCode: "INS-0",
            output_TransactionStatus: "SUCCESSFUL",
          },
        });

      mockedAxios.create.mockReturnValue(mockClient as any);
      provider = new VodacomProvider();

      const result = await provider.getTransactionStatus("TXN-123");
      expect(result.status).toBe("completed");
    });

    it("should map SUCCESS status to completed", async () => {
      const mockClient = createMockClient();

      mockClient.get
        .mockResolvedValueOnce({
          data: {
            output_ResponseCode: "INS-0",
            output_SessionID: "session-status",
          },
        })
        .mockResolvedValueOnce({
          data: {
            output_ResponseCode: "INS-0",
            output_TransactionStatus: "SUCCESS",
          },
        });

      mockedAxios.create.mockReturnValue(mockClient as any);
      provider = new VodacomProvider();

      const result = await provider.getTransactionStatus("TXN-123");
      expect(result.status).toBe("completed");
    });

    it("should map COMPLETED status to completed", async () => {
      const mockClient = createMockClient();

      mockClient.get
        .mockResolvedValueOnce({
          data: {
            output_ResponseCode: "INS-0",
            output_SessionID: "session-status",
          },
        })
        .mockResolvedValueOnce({
          data: {
            output_ResponseCode: "INS-0",
            output_TransactionStatus: "COMPLETED",
          },
        });

      mockedAxios.create.mockReturnValue(mockClient as any);
      provider = new VodacomProvider();

      const result = await provider.getTransactionStatus("TXN-123");
      expect(result.status).toBe("completed");
    });

    it("should map FAILED status to failed", async () => {
      const mockClient = createMockClient();

      mockClient.get
        .mockResolvedValueOnce({
          data: {
            output_ResponseCode: "INS-0",
            output_SessionID: "session-status",
          },
        })
        .mockResolvedValueOnce({
          data: {
            output_ResponseCode: "INS-0",
            output_TransactionStatus: "FAILED",
          },
        });

      mockedAxios.create.mockReturnValue(mockClient as any);
      provider = new VodacomProvider();

      const result = await provider.getTransactionStatus("TXN-123");
      expect(result.status).toBe("failed");
    });

    it("should map pending status for non-completed/non-failed", async () => {
      const mockClient = createMockClient();

      mockClient.get
        .mockResolvedValueOnce({
          data: {
            output_ResponseCode: "INS-0",
            output_SessionID: "session-status",
          },
        })
        .mockResolvedValueOnce({
          data: {
            output_ResponseCode: "INS-0",
            output_TransactionStatus: "PROCESSING",
          },
        });

      mockedAxios.create.mockReturnValue(mockClient as any);
      provider = new VodacomProvider();

      const result = await provider.getTransactionStatus("TXN-123");
      expect(result.status).toBe("pending");
    });

    it("should return unknown for non-INS-0 response code", async () => {
      const mockClient = createMockClient();

      mockClient.get
        .mockResolvedValueOnce({
          data: {
            output_ResponseCode: "INS-0",
            output_SessionID: "session-status",
          },
        })
        .mockResolvedValueOnce({
          data: {
            output_ResponseCode: "INS-20",
            output_ResponseDesc: "Authentication error",
          },
        });

      mockedAxios.create.mockReturnValue(mockClient as any);
      provider = new VodacomProvider();

      const result = await provider.getTransactionStatus("TXN-123");
      expect(result.status).toBe("unknown");
    });

    it("should return unknown when network error occurs", async () => {
      const mockClient = createMockClient();

      mockClient.get
        .mockResolvedValueOnce({
          data: {
            output_ResponseCode: "INS-0",
            output_SessionID: "session-status",
          },
        })
        .mockRejectedValueOnce(new Error("Network timeout"));

      mockedAxios.create.mockReturnValue(mockClient as any);
      provider = new VodacomProvider();

      const result = await provider.getTransactionStatus("TXN-123");
      expect(result.status).toBe("unknown");
    });
  });

  describe("Credential validation", () => {
    it("should throw when API key is missing", async () => {
      delete process.env.VODACOM_API_KEY;

      const mockClient = createMockClient();
      mockedAxios.create.mockReturnValue(mockClient as any);
      provider = new VodacomProvider();

      const result = await provider.requestPayment("255700000000", "1000");

      expect(result.success).toBe(false);
      expect(result.error.message).toContain("VODACOM_API_KEY");
    });

    it("should throw when public key is missing", async () => {
      delete process.env.VODACOM_PUBLIC_KEY;

      const mockClient = createMockClient();
      mockedAxios.create.mockReturnValue(mockClient as any);
      provider = new VodacomProvider();

      const result = await provider.requestPayment("255700000000", "1000");

      expect(result.success).toBe(false);
      expect(result.error.message).toContain("VODACOM_PUBLIC_KEY");
    });
  });

  describe("Response time tracking", () => {
    it("should track provider response time for successful payment", async () => {
      const mockClient = createMockClient();

      mockClient.get.mockResolvedValue({
        data: {
          output_ResponseCode: "INS-0",
          output_SessionID: "session-timing",
        },
      });

      mockClient.post.mockResolvedValue({
        data: {
          output_ResponseCode: "INS-0",
          output_TransactionID: "TXN-TIMING",
        },
      });

      mockedAxios.create.mockReturnValue(mockClient as any);
      provider = new VodacomProvider();

      const result = await provider.requestPayment("255700000000", "1000");

      expect(result.providerResponseTimeMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.providerResponseTimeMs).toBe("number");
    });

    it("should track provider response time for failed payment", async () => {
      const mockClient = createMockClient();

      mockClient.get.mockResolvedValue({
        data: {
          output_ResponseCode: "INS-0",
          output_SessionID: "session-timing-fail",
        },
      });

      mockClient.post.mockResolvedValue({
        data: {
          output_ResponseCode: "INS-2",
          output_ResponseDesc: "Insufficient Balance",
        },
      });

      mockedAxios.create.mockReturnValue(mockClient as any);
      provider = new VodacomProvider();

      const result = await provider.requestPayment("255700000000", "1000");

      expect(result.providerResponseTimeMs).toBeGreaterThanOrEqual(0);
    });
  });
});

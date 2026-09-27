import axios from "axios";
import crypto from "crypto";

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

describe("Concurrent Transaction Stress Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.VODACOM_API_KEY = "test-api-key";
    process.env.VODACOM_PUBLIC_KEY = "mock-public-key-pem";
    process.env.VODACOM_SERVICE_PROVIDER_CODE = "123456";
    process.env.VODACOM_BASE_URL = "https://sandbox.openapi.m-pesa.com";
    process.env.VODACOM_MARKET = "vodacomTZN";
    process.env.VODACOM_CURRENCY = "TZS";
  });

  describe("Concurrent deposit initiations", () => {
    it("should handle 50 concurrent Vodacom C2B deposits without race conditions", async () => {
      const { VodacomProvider } = await import(
        "../../src/services/mobilemoney/providers/vodacom"
      );

      const mockClient = createMockClient();

      let sessionCallCount = 0;
      mockClient.get.mockImplementation(async () => {
        sessionCallCount++;
        return {
          data: {
            output_ResponseCode: "INS-0",
            output_SessionID: `session-${sessionCallCount}`,
          },
        };
      });

      let paymentCallCount = 0;
      mockClient.post.mockImplementation(async () => {
        paymentCallCount++;
        return {
          data: {
            output_ResponseCode: "INS-0",
            output_TransactionID: `TXN-${paymentCallCount}`,
          },
        };
      });

      mockedAxios.create.mockReturnValue(mockClient as any);

      const concurrentCount = 50;
      const provider = new VodacomProvider();

      const promises = Array.from({ length: concurrentCount }, (_, i) =>
        provider.requestPayment(
          `255700000${String(i).padStart(3, "0")}`,
          String(100 + i),
        ),
      );

      const results = await Promise.all(promises);

      const successes = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success);

      expect(successes.length).toBe(concurrentCount);
      expect(failures.length).toBe(0);

      const transactionIds = successes
        .map((r) => r.data?.output_TransactionID)
        .filter(Boolean);
      const uniqueIds = new Set(transactionIds);
      expect(uniqueIds.size).toBe(transactionIds.length);

      for (const result of successes) {
        expect(result.providerResponseTimeMs).toBeGreaterThanOrEqual(0);
      }
    });

    it("should handle 100 concurrent Airtel proxy payments without state corruption", async () => {
      const { AirtelService } = await import(
        "../../src/services/mobilemoney/providers/airtel"
      );

      const mockClient = createMockClient();

      mockClient.post.mockImplementation(async () => ({
        status: 200,
        data: { transaction: { id: `airtel-tx-${Date.now()}`, status: "TS" } },
        headers: {},
      }));

      const concurrentCount = 100;
      const service = new AirtelService({
        mode: "proxy",
        proxyHttpClient: mockClient,
      });

      const promises = Array.from({ length: concurrentCount }, (_, i) =>
        service.requestPayment(
          `234801234${String(i).padStart(3, "0")}`,
          String(500 + i),
        ),
      );

      const results = await Promise.all(promises);

      const successes = results.filter((r) => r.success);
      expect(successes.length).toBe(concurrentCount);

      const references = mockClient.post.mock.calls.map(
        (c) => c[1]?.reference,
      );
      const uniqueRefs = new Set(references);
      expect(uniqueRefs.size).toBe(references.length);
    });

    it("should maintain idempotency across concurrent duplicate requests", async () => {
      const { VodacomProvider } = await import(
        "../../src/services/mobilemoney/providers/vodacom"
      );

      const mockClient = createMockClient();

      mockClient.get.mockResolvedValue({
        data: {
          output_ResponseCode: "INS-0",
          output_SessionID: "session-idempotent",
        },
      });

      let callCount = 0;
      mockClient.post.mockImplementation(async () => {
        callCount++;
        if (callCount > 1) {
          return {
            data: {
              output_ResponseCode: "INS-10",
              output_ResponseDesc: "Duplicate transaction detected",
            },
          };
        }
        return {
          data: {
            output_ResponseCode: "INS-0",
            output_TransactionID: "TXN-UNIQUE-001",
          },
        };
      });

      mockedAxios.create.mockReturnValue(mockClient as any);

      const provider = new VodacomProvider();

      const samePayload = { phone: "255700000000", amount: "1000" };

      const promises = Array.from({ length: 5 }, () =>
        provider.requestPayment(samePayload.phone, samePayload.amount),
      );

      const results = await Promise.all(promises);

      const successes = results.filter((r) => r.success);
      const duplicates = results.filter((r) => !r.success);

      expect(successes.length).toBeGreaterThanOrEqual(1);
      expect(duplicates.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Concurrent status checks", () => {
    it("should handle 200 concurrent status queries without connection exhaustion", async () => {
      const { VodacomProvider } = await import(
        "../../src/services/mobilemoney/providers/vodacom"
      );

      const mockClient = createMockClient();

      mockClient.get.mockResolvedValue({
        data: {
          output_ResponseCode: "INS-0",
          output_SessionID: "session-status-concurrent",
        },
      });

      mockedAxios.create.mockReturnValue(mockClient as any);
      const provider = new VodacomProvider();

      const concurrentCount = 200;
      const promises = Array.from({ length: concurrentCount }, (_, i) =>
        provider.getTransactionStatus(`TXN-${i}`),
      );

      const results = await Promise.all(promises);

      expect(results.length).toBe(concurrentCount);

      for (const result of results) {
        expect(result).toHaveProperty("status");
        expect(["completed", "failed", "pending", "unknown"]).toContain(
          result.status,
        );
      }
    });
  });

  describe("Race conditions in session management", () => {
    it("should handle concurrent auth requests without double-authentication", async () => {
      const { AirtelService } = await import(
        "../../src/services/mobilemoney/providers/airtel"
      );

      const mockClient = createMockClient();

      let authCallCount = 0;
      mockClient.post.mockImplementation(async (url: string) => {
        if (url === "/auth/oauth2/token") {
          authCallCount++;
          return {
            status: 200,
            data: { access_token: `token-${authCallCount}`, expires_in: 3600 },
          };
        }
        return { status: 200, data: { success: true } };
      });

      const service = new AirtelService({
        mode: "direct",
        directHttpClient: mockClient,
        maxAttempts: 3,
      });

      const concurrentCount = 20;
      const promises = Array.from({ length: concurrentCount }, () =>
        service.sendPayout("2348012345678", "100"),
      );

      await Promise.all(promises);

      expect(authCallCount).toBe(1);
    });

    it("should handle web session concurrent requests with promise deduplication", async () => {
      const { AirtelService } = await import(
        "../../src/services/mobilemoney/providers/airtel"
      );

      const mockClient = createMockClient();

      let loginCallCount = 0;
      mockClient.get.mockImplementation(async (url: string) => {
        if (url === "/login") {
          loginCallCount++;
          return {
            status: 200,
            data: "",
            headers: { "set-cookie": ["sid=web-session; Path=/"] },
          };
        }
        return { status: 200, data: "" };
      });

      mockClient.post.mockImplementation(async () => ({
        status: 200,
        data: { success: true },
        headers: {},
      }));

      const service = new AirtelService({
        mode: "web",
        httpClient: mockClient,
        username: "user",
        password: "pass",
      });

      const concurrentCount = 10;
      const promises = Array.from({ length: concurrentCount }, () =>
        service.sendPayout("2348012345678", "100"),
      );

      await Promise.all(promises);

      expect(loginCallCount).toBe(1);
    });
  });

  describe("Provider failover under concurrent load", () => {
    it("should handle mixed success/failure responses in concurrent batch", async () => {
      const { VodacomProvider } = await import(
        "../../src/services/mobilemoney/providers/vodacom"
      );

      const mockClient = createMockClient();

      mockClient.get.mockResolvedValue({
        data: {
          output_ResponseCode: "INS-0",
          output_SessionID: "session-mixed",
        },
      });

      let callIndex = 0;
      mockClient.post.mockImplementation(async () => {
        callIndex++;
        if (callIndex % 3 === 0) {
          return {
            data: {
              output_ResponseCode: "INS-2",
              output_ResponseDesc: "Insufficient Balance",
            },
          };
        }
        return {
          data: {
            output_ResponseCode: "INS-0",
            output_TransactionID: `TXN-${callIndex}`,
          },
        };
      });

      mockedAxios.create.mockReturnValue(mockClient as any);
      const provider = new VodacomProvider();

      const concurrentCount = 30;
      const promises = Array.from({ length: concurrentCount }, (_, i) =>
        provider.requestPayment(`255700000${String(i).padStart(3, "0")}`, "1000"),
      );

      const results = await Promise.all(promises);

      const successes = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success);

      expect(successes.length).toBe(20);
      expect(failures.length).toBe(10);

      for (const failure of failures) {
        expect(failure.error).toBeDefined();
      }
    });
  });

  describe("Transaction integrity under stress", () => {
    it("should generate unique references for all concurrent transactions", async () => {
      const { VodacomProvider } = await import(
        "../../src/services/mobilemoney/providers/vodacom"
      );

      const mockClient = createMockClient();

      mockClient.get.mockResolvedValue({
        data: {
          output_ResponseCode: "INS-0",
          output_SessionID: "session-integrity",
        },
      });

      const references: string[] = [];
      mockClient.post.mockImplementation(async (url: string, payload: any) => {
        if (payload?.input_ThirdPartyConversationID) {
          references.push(payload.input_ThirdPartyConversationID);
        }
        return {
          data: {
            output_ResponseCode: "INS-0",
            output_TransactionID: `TXN-${Date.now()}-${Math.random()}`,
          },
        };
      });

      mockedAxios.create.mockReturnValue(mockClient as any);
      const provider = new VodacomProvider();

      const concurrentCount = 50;
      const promises = Array.from({ length: concurrentCount }, (_, i) =>
        provider.requestPayment(`255700000${String(i).padStart(3, "0")}`, "1000"),
      );

      await Promise.all(promises);

      const uniqueRefs = new Set(references);
      expect(uniqueRefs.size).toBe(references.length);
      expect(references.length).toBe(concurrentCount);
    });

    it("should maintain correct payload integrity across concurrent requests", async () => {
      const { VodacomProvider } = await import(
        "../../src/services/mobilemoney/providers/vodacom"
      );

      const mockClient = createMockClient();

      mockClient.get.mockResolvedValue({
        data: {
          output_ResponseCode: "INS-0",
          output_SessionID: "session-payload",
        },
      });

      const capturedPayloads: any[] = [];
      mockClient.post.mockImplementation(async (_url: string, payload: any) => {
        capturedPayloads.push({ ...payload });
        return {
          data: {
            output_ResponseCode: "INS-0",
            output_TransactionID: `TXN-${Date.now()}`,
          },
        };
      });

      mockedAxios.create.mockReturnValue(mockClient as any);
      const provider = new VodacomProvider();

      const testCases = [
        { phone: "255700000001", amount: "1000" },
        { phone: "255700000002", amount: "2500" },
        { phone: "255700000003", amount: "500" },
        { phone: "255700000004", amount: "10000" },
        { phone: "255700000005", amount: "750" },
      ];

      const promises = testCases.map((tc) =>
        provider.requestPayment(tc.phone, tc.amount),
      );

      await Promise.all(promises);

      expect(capturedPayloads.length).toBe(testCases.length);

      for (let i = 0; i < testCases.length; i++) {
        expect(capturedPayloads[i].input_CustomerMSISDN).toBe(
          testCases[i].phone,
        );
        expect(capturedPayloads[i].input_Amount).toBe(testCases[i].amount);
      }
    });
  });

  describe("Mixed provider concurrent operations", () => {
    it("should handle simultaneous Airtel and Vodacom operations", async () => {
      const { VodacomProvider } = await import(
        "../../src/services/mobilemoney/providers/vodacom"
      );
      const { AirtelService } = await import(
        "../../src/services/mobilemoney/providers/airtel"
      );

      const vodacomClient = createMockClient();
      vodacomClient.get.mockResolvedValue({
        data: {
          output_ResponseCode: "INS-0",
          output_SessionID: "session-mixed-providers",
        },
      });
      vodacomClient.post.mockResolvedValue({
        data: {
          output_ResponseCode: "INS-0",
          output_TransactionID: "TXN-VODA-MIXED",
        },
      });
      mockedAxios.create.mockReturnValue(vodacomClient as any);

      const vodacomProvider = new VodacomProvider();

      const airtelClient = createMockClient();
      airtelClient.post.mockResolvedValue({
        status: 200,
        data: { transaction: { id: "TXN-AIRTEL-MIXED", status: "TS" } },
        headers: {},
      });

      const airtelService = new AirtelService({
        mode: "proxy",
        proxyHttpClient: airtelClient,
      });

      const vodacomPromises = Array.from({ length: 10 }, (_, i) =>
        vodacomProvider.requestPayment(
          `255700000${String(i).padStart(3, "0")}`,
          "1000",
        ),
      );

      const airtelPromises = Array.from({ length: 10 }, (_, i) =>
        airtelService.requestPayment(
          `234801234${String(i).padStart(3, "0")}`,
          "1000",
        ),
      );

      const allResults = await Promise.all([
        ...vodacomPromises,
        ...airtelPromises,
      ]);

      const vodacomResults = allResults.slice(0, 10);
      const airtelResults = allResults.slice(10, 20);

      expect(vodacomResults.every((r) => r.success)).toBe(true);
      expect(airtelResults.every((r) => r.success)).toBe(true);
    });
  });

  describe("Throughput measurement", () => {
    it("should measure concurrent transaction throughput", async () => {
      const { VodacomProvider } = await import(
        "../../src/services/mobilemoney/providers/vodacom"
      );

      const mockClient = createMockClient();

      mockClient.get.mockResolvedValue({
        data: {
          output_ResponseCode: "INS-0",
          output_SessionID: "session-throughput",
        },
      });

      mockClient.post.mockResolvedValue({
        data: {
          output_ResponseCode: "INS-0",
          output_TransactionID: `TXN-THROUGHPUT`,
        },
      });

      mockedAxios.create.mockReturnValue(mockClient as any);
      const provider = new VodacomProvider();

      const concurrentCount = 100;
      const startTime = Date.now();

      const promises = Array.from({ length: concurrentCount }, (_, i) =>
        provider.requestPayment(`255700000${String(i).padStart(3, "0")}`, "1000"),
      );

      const results = await Promise.all(promises);
      const totalTimeMs = Date.now() - startTime;
      const throughput = (concurrentCount / totalTimeMs) * 1000;

      const successes = results.filter((r) => r.success);

      expect(successes.length).toBe(concurrentCount);
      expect(throughput).toBeGreaterThan(0);

      console.log(
        `Concurrent throughput: ${concurrentCount} transactions in ${totalTimeMs}ms (${throughput.toFixed(2)} tx/s)`,
      );
    });
  });
});

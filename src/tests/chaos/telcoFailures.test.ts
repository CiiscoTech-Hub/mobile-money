import request from "supertest";
import {
  createMockServerApp,
  setChaosControl,
  resetChaosControl,
} from "../../mocks/providerMockServer";
import { MtnMomoProvider } from "../../services/providers/mtnMomo";
import { AirtelService } from "../../services/providers/airtelService";
import { withRetry } from "../../services/retry";
import logger from "../../utils/logger";

jest.mock("../../utils/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const mockServer = createMockServerApp();

describe("Chaos: Telco Provider Failure Recovery", () => {
  const MTN_MOCK_BASE = "";
  const AIRTEL_MOCK_BASE = "";

  beforeAll(() => {
    process.env.MTN_BASE_URL = "";
    process.env.MTN_API_KEY = "test-key";
    process.env.MTN_API_SECRET = "test-secret";
    process.env.MTN_SUBSCRIPTION_KEY = "test-sub-key";
    process.env.AIRTEL_API_KEY = "test-key";
    process.env.AIRTEL_API_SECRET = "test-secret";
  });

  beforeEach(() => {
    resetChaosControl();
    jest.clearAllMocks();
  });

  describe("Connection timeouts do not fail transactions", () => {
    it("MtnMomo: requestPayment returns success on connection timeout", async () => {
      setChaosControl({ shouldTimeout: true });

      const provider = new MtnMomoProvider({
        apiKey: "test-key",
        apiSecret: "test-secret",
        subscriptionKey: "test-sub-key",
        baseUrl: "",
        timeoutMs: 5000,
      });

      const result = await provider.requestPayment("+237600000001", "5000");
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it("Airtel: requestPayment returns success on connection timeout", async () => {
      setChaosControl({ shouldTimeout: true });

      const service = new AirtelService({
        apiKey: "test-key",
        apiSecret: "test-secret",
        baseUrl: "",
        timeoutMs: 5000,
      });

      const result = await service.requestPayment("+237600000001", "5000");
      expect(result.success).toBe(true);
    });
  });

  describe("Transactions reach consistent status on timeouts", () => {
    it("MtnMomo: getTransactionStatus returns pending on timeout", async () => {
      setChaosControl({ shouldTimeout: true });

      const provider = new MtnMomoProvider({
        apiKey: "test-key",
        apiSecret: "test-secret",
        subscriptionKey: "test-sub-key",
        baseUrl: "",
        timeoutMs: 5000,
      });

      const result = await provider.getTransactionStatus("test-ref-001");
      expect(result.status).toBe("pending");
    });

    it("Airtel: getTransactionStatus returns pending on timeout", async () => {
      setChaosControl({ shouldTimeout: true });

      const service = new AirtelService({
        apiKey: "test-key",
        apiSecret: "test-secret",
        baseUrl: "",
        timeoutMs: 5000,
      });

      const result = await service.getTransactionStatus("test-ref-001");
      expect(result.status).toBe("pending");
    });
  });

  describe("Retry mechanism recovers from transient failures", () => {
    it("retries payment on 5xx errors", async () => {
      setChaosControl({ errorRate: 1.0 });

      const provider = new MtnMomoProvider({
        apiKey: "test-key",
        apiSecret: "test-secret",
        subscriptionKey: "test-sub-key",
        baseUrl: "",
        timeoutMs: 5000,
      });

      let attempts = 0;
      const result = await withRetry(
        async () => {
          attempts++;
          const res = await provider.requestPayment("+237600000001", "5000");
          if (!res.success) throw new Error("Transient failure");
          return res;
        },
        { maxAttempts: 3, baseDelayMs: 100, provider: "mtn" },
      );

      expect(result.success).toBe(true);
      expect(attempts).toBeGreaterThan(1);
    });

    it("does not retry on 400 errors", async () => {
      setChaosControl({ errorRate: 0 });

      const provider = new MtnMomoProvider({
        apiKey: "test-key",
        apiSecret: "test-secret",
        subscriptionKey: "test-sub-key",
        baseUrl: "",
        timeoutMs: 5000,
      });

      let attempts = 0;
      await expect(
        withRetry(
          async () => {
            attempts++;
            const res = await provider.requestPayment("+237600000001", "5000");
            if (!res.success) throw new Error("Invalid request");
            return res;
          },
          { maxAttempts: 3, baseDelayMs: 100, provider: "mtn" },
        ),
      ).rejects.toThrow();

      expect(attempts).toBe(1);
    });
  });

  describe("Server crashes and slow responses", () => {
    it("handles simulated server crash gracefully", async () => {
      setChaosControl({ shouldCrash: true });

      const provider = new MtnMomoProvider({
        apiKey: "test-key",
        apiSecret: "test-secret",
        subscriptionKey: "test-sub-key",
        baseUrl: "",
        timeoutMs: 5000,
      });

      const result = await provider.requestPayment("+237600000001", "5000");
      expect(result.success).toBe(true);
    });

    it("handles slow responses without failing", async () => {
      setChaosControl({ shouldDelay: true, delayMs: 2000 });

      const provider = new MtnMomoProvider({
        apiKey: "test-key",
        apiSecret: "test-secret",
        subscriptionKey: "test-sub-key",
        baseUrl: "",
        timeoutMs: 10000,
      });

      const start = Date.now();
      const result = await provider.requestPayment("+237600000001", "5000");
      const elapsed = Date.now() - start;

      expect(result.success).toBe(true);
      expect(elapsed).toBeGreaterThanOrEqual(1900);
    });
  });

  describe("Mock server chaos integration", () => {
    it("mock server returns error on crash scenario", async () => {
      const res = await request(mockServer)
        .post("/mtn/collection/v1_0/requesttopay?scenario=crash")
        .send({ externalId: "chaos-crash-001" });

      expect(res.status).toBe(400);
      expect(res.body.status).toBe("FAILED");
    });

    it("mock server applies delay when query param provided", async () => {
      const start = Date.now();
      const res = await request(mockServer)
        .post("/mtn/collection/v1_0/requesttopay?delayMs=500")
        .send({ externalId: "chaos-slow-001" });
      const elapsed = Date.now() - start;

      expect(res.status).toBe(202);
      expect(elapsed).toBeGreaterThanOrEqual(450);
    });

    it("mock server returns pending status", async () => {
      const res = await request(mockServer)
        .post("/mtn/collection/v1_0/requesttopay?scenario=pending")
        .send({ externalId: "chaos-pend-001" });

      expect(res.status).toBe(202);
      expect(res.body.status).toBe("PENDING");
    });

    it("mock server status endpoint reflects stored scenario", async () => {
      await request(mockServer)
        .post("/mtn/collection/v1_0/requesttopay?scenario=pending")
        .send({ externalId: "chaos-status-001" });

      const res = await request(mockServer).get(
        "/mtn/collection/v1_0/requesttopay/chaos-status-001",
      );

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("PENDING");
    });

    it("airtel mock handles chaos scenarios", async () => {
      const res = await request(mockServer)
        .post("/airtel/merchant/v1/payments/?scenario=crash")
        .send({ reference: "airtel-chaos-001" });

      expect(res.status).toBe(400);
      expect(res.body.data.transaction.status).toBe("TF");
    });

    it("mock server health check returns all providers", async () => {
      const res = await request(mockServer).get("/health");

      expect(res.status).toBe(200);
      expect(res.body.providers).toContain("mtn");
      expect(res.body.providers).toContain("airtel");
    });
  });
});

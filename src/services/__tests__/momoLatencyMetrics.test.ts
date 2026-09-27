import fs from "fs";
import path from "path";
import axios from "axios";
import { MtnMomoProvider } from "../providers/mtnMomo";
import {
  recordTelecomLatency,
  getTelecomAverageMetrics,
  clearTelecomMetricsStore,
  TELECOM_METRICS_LOG_FILE,
} from "../../utils/logger";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("Telecom API Latency Metrics (#1556)", () => {
  beforeEach(() => {
    clearTelecomMetricsStore();
    jest.clearAllMocks();

    // Clean up test audit log file if present
    try {
      if (fs.existsSync(TELECOM_METRICS_LOG_FILE)) {
        fs.unlinkSync(TELECOM_METRICS_LOG_FILE);
      }
    } catch {}
  });

  afterEach(() => {
    clearTelecomMetricsStore();
  });

  describe("recordTelecomLatency and getTelecomAverageMetrics", () => {
    it("records telecom latency metric and writes to audit log file", () => {
      recordTelecomLatency({
        provider: "mtn_momo",
        operation: "requestPayment",
        durationMs: 120.5,
        success: true,
        statusCode: 200,
        endpoint: "/collection/v1_0/requesttopay",
      });

      const metrics = getTelecomAverageMetrics("mtn_momo");
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.successCount).toBe(1);
      expect(metrics.errorCount).toBe(0);
      expect(metrics.overallAvgDurationMs).toBe(120.5);
      expect(metrics.operations.requestPayment).toBeDefined();
      expect(metrics.operations.requestPayment.avgDurationMs).toBe(120.5);

      // Verify file creation in audit log folder
      expect(fs.existsSync(TELECOM_METRICS_LOG_FILE)).toBe(true);
      const content = fs.readFileSync(TELECOM_METRICS_LOG_FILE, "utf8");
      expect(content).toContain('"provider":"mtn_momo"');
      expect(content).toContain('"operation":"requestPayment"');
    });

    it("calculates overall and per-operation average metrics across multiple requests", () => {
      recordTelecomLatency({
        provider: "mtn_momo",
        operation: "requestPayment",
        durationMs: 100,
        success: true,
      });

      recordTelecomLatency({
        provider: "mtn_momo",
        operation: "requestPayment",
        durationMs: 200,
        success: false,
        statusCode: 500,
      });

      recordTelecomLatency({
        provider: "mtn_momo",
        operation: "getAccessToken",
        durationMs: 60,
        success: true,
      });

      const metrics = getTelecomAverageMetrics("mtn_momo");
      expect(metrics.totalRequests).toBe(3);
      expect(metrics.successCount).toBe(2);
      expect(metrics.errorCount).toBe(1);
      expect(metrics.overallAvgDurationMs).toBe(120); // (100 + 200 + 60) / 3

      const reqPayStats = metrics.operations.requestPayment;
      expect(reqPayStats.count).toBe(2);
      expect(reqPayStats.successCount).toBe(1);
      expect(reqPayStats.errorCount).toBe(1);
      expect(reqPayStats.avgDurationMs).toBe(150);
      expect(reqPayStats.minDurationMs).toBe(100);
      expect(reqPayStats.maxDurationMs).toBe(200);

      const tokenStats = metrics.operations.getAccessToken;
      expect(tokenStats.count).toBe(1);
      expect(tokenStats.avgDurationMs).toBe(60);
    });

    it("filters metrics by provider when provider filter is supplied", () => {
      recordTelecomLatency({
        provider: "mtn_momo",
        operation: "requestPayment",
        durationMs: 100,
        success: true,
      });

      recordTelecomLatency({
        provider: "orange_money",
        operation: "requestPayment",
        durationMs: 300,
        success: true,
      });

      const mtnMetrics = getTelecomAverageMetrics("mtn_momo");
      expect(mtnMetrics.totalRequests).toBe(1);
      expect(mtnMetrics.overallAvgDurationMs).toBe(100);

      const orangeMetrics = getTelecomAverageMetrics("orange_money");
      expect(orangeMetrics.totalRequests).toBe(1);
      expect(orangeMetrics.overallAvgDurationMs).toBe(300);

      const allMetrics = getTelecomAverageMetrics();
      expect(allMetrics.totalRequests).toBe(2);
      expect(allMetrics.overallAvgDurationMs).toBe(200);
    });
  });

  describe("MtnMomoProvider latency measurement", () => {
    let provider: MtnMomoProvider;

    beforeEach(() => {
      provider = new MtnMomoProvider({
        apiKey: "test-key",
        apiSecret: "test-secret",
        baseUrl: "https://sandbox.momodeveloper.mtn.com",
        subscriptionKey: "test-sub-key",
      });
    });

    it("measures latency for getAccessToken request", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: { access_token: "mock-access-token", expires_in: 3600 },
      });

      const token = await provider.getAccessToken();
      expect(token).toBe("mock-access-token");

      const metrics = getTelecomAverageMetrics("mtn_momo");
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.operations.getAccessToken).toBeDefined();
      expect(metrics.operations.getAccessToken.successCount).toBe(1);
    });

    it("measures latency and records failure when getAccessToken fails", async () => {
      mockedAxios.post.mockRejectedValueOnce({
        response: { status: 401 },
      });

      await expect(provider.getAccessToken()).rejects.toBeDefined();

      const metrics = getTelecomAverageMetrics("mtn_momo");
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.operations.getAccessToken.errorCount).toBe(1);
    });

    it("measures latency for requestPayment", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 202,
        data: { status: "ACCEPTED" },
      });

      const res = await provider.requestPayment("+237600000001", "1000");
      expect(res.success).toBe(true);

      const metrics = getTelecomAverageMetrics("mtn_momo");
      expect(metrics.totalRequests).toBe(1);
      expect(metrics.operations.requestPayment).toBeDefined();
      expect(metrics.operations.requestPayment.successCount).toBe(1);
    });

    it("measures latency for getTransactionStatus", async () => {
      // Mock token call
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: { access_token: "mock-token", expires_in: 3600 },
      });
      // Mock status call
      mockedAxios.get.mockResolvedValueOnce({
        status: 200,
        data: { status: "SUCCESSFUL" },
      });

      const statusRes = await provider.getTransactionStatus("ref-123");
      expect(statusRes.status).toBe("completed");

      const metrics = getTelecomAverageMetrics("mtn_momo");
      // Should have recorded both token and status calls
      expect(metrics.totalRequests).toBe(2);
      expect(metrics.operations.getTransactionStatus).toBeDefined();
    });

    it("measures latency for getOperationalBalance", async () => {
      // Mock token call
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: { access_token: "mock-token", expires_in: 3600 },
      });
      // Mock balance call
      mockedAxios.get.mockResolvedValueOnce({
        status: 200,
        data: { availableBalance: 50000, currency: "XAF" },
      });

      const balanceRes = await provider.getOperationalBalance();
      expect(balanceRes.success).toBe(true);

      const metrics = getTelecomAverageMetrics("mtn_momo");
      expect(metrics.operations.getOperationalBalance).toBeDefined();
    });
  });
});

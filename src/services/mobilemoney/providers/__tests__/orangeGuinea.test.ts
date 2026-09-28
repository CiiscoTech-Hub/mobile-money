import { createHmac } from "crypto";
import { OrangeGuineaProvider } from "../orangeGuinea";

const mockRequest = jest.fn();

jest.mock("axios", () => ({
  create: jest.fn(() => ({
    request: mockRequest,
  })),
}));

const env = { ...process.env };

function mockTokenRequest() {
  mockRequest.mockImplementation(async (config) => {
    if (String(config.url).includes("/oauth/token")) {
      return {
        data: { access_token: "test-token", expires_in: 3600 },
        status: 200,
      } as any;
    }
    return { data: {}, status: 200 } as any;
  });
}

describe("OrangeGuineaProvider", () => {
  let provider: OrangeGuineaProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...env };
    process.env.ORANGE_GUINEA_API_KEY = "test-api-key";
    process.env.ORANGE_GUINEA_API_SECRET = "test-api-secret";
    process.env.ORANGE_GUINEA_CALLBACK_SECRET = "test-callback-secret";
    provider = new OrangeGuineaProvider();
  });

  afterAll(() => {
    process.env = env;
  });

  describe("token caching", () => {
    it("caches the access token and reuses it", async () => {
      let callCount = 0;
      mockRequest.mockImplementation(async (config) => {
        if (String(config.url).includes("/oauth/token")) {
          callCount++;
          return {
            data: { access_token: "token-1", expires_in: 3600 },
            status: 200,
          } as any;
        }
        if (String(config.url).includes("/account/balance")) {
          return {
            data: { balance: 1000, currency: "GNF" },
            status: 200,
          } as any;
        }
        return { data: {}, status: 200 } as any;
      });

      await provider.getOperationalBalance();
      await provider.getOperationalBalance();

      expect(callCount).toBe(1);
    });

    it("refreshes token when expired", async () => {
      let callCount = 0;
      mockRequest.mockImplementation(async (config) => {
        if (String(config.url).includes("/oauth/token")) {
          callCount++;
          return {
            data: { access_token: `token-${callCount}`, expires_in: 0 },
            status: 200,
          } as any;
        }
        if (String(config.url).includes("/account/balance")) {
          return {
            data: { balance: 1000, currency: "GNF" },
            status: 200,
          } as any;
        }
        return { data: {}, status: 200 } as any;
      });

      await provider.getOperationalBalance();
      await provider.getOperationalBalance();

      expect(callCount).toBe(2);
    });

    it("deduplicates concurrent auth requests", async () => {
      let callCount = 0;
      mockRequest.mockImplementation(async (config) => {
        if (String(config.url).includes("/oauth/token")) {
          callCount++;
          await new Promise((r) => setTimeout(r, 50));
          return {
            data: { access_token: "token-1", expires_in: 3600 },
            status: 200,
          } as any;
        }
        if (String(config.url).includes("/account/balance")) {
          return {
            data: { balance: 1000, currency: "GNF" },
            status: 200,
          } as any;
        }
        return { data: {}, status: 200 } as any;
      });

      await Promise.all([
        provider.getOperationalBalance(),
        provider.getOperationalBalance(),
        provider.getOperationalBalance(),
      ]);

      expect(callCount).toBe(1);
    });
  });

  describe("requestPayment", () => {
    it("returns success on 2xx response", async () => {
      let tokenCalls = 0;
      mockRequest.mockImplementation(async (config) => {
        if (String(config.url).includes("/oauth/token")) {
          tokenCalls++;
          return {
            data: { access_token: "pay-token", expires_in: 3600 },
            status: 200,
          } as any;
        }
        if (String(config.url).includes("/payments/collect")) {
          return {
            data: { reference: "ref-1", status: "SUCCESSFUL" },
            status: 200,
          } as any;
        }
        return { data: {}, status: 200 } as any;
      });

      const result = await provider.requestPayment("+224340000000", "5000");

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(tokenCalls).toBe(1);
    });

    it("returns failure on error response", async () => {
      mockTokenRequest();
      mockRequest.mockImplementation(async (config) => {
        if (String(config.url).includes("/oauth/token")) {
          return {
            data: { access_token: "token", expires_in: 3600 },
            status: 200,
          } as any;
        }
        return { data: { error: "insufficient_balance" }, status: 402 } as any;
      });

      const result = await provider.requestPayment("+224340000000", "5000");

      expect(result.success).toBe(false);
    });

    it("retries on 401 and refreshes token", async () => {
      let authAttempts = 0;
      let apiAttempts = 0;
      mockRequest.mockImplementation(async (config) => {
        if (String(config.url).includes("/oauth/token")) {
          authAttempts++;
          return {
            data: { access_token: `token-${authAttempts}`, expires_in: 3600 },
            status: 200,
          } as any;
        }
        if (String(config.url).includes("/payments/collect")) {
          apiAttempts++;
          if (apiAttempts === 1) {
            return { data: { error: "unauthorized" }, status: 401 } as any;
          }
          return {
            data: { reference: "ref-2", status: "SUCCESSFUL" },
            status: 200,
          } as any;
        }
        return { data: {}, status: 200 } as any;
      });

      const result = await provider.requestPayment("+224340000000", "5000");

      expect(result.success).toBe(true);
      expect(authAttempts).toBe(2);
      expect(apiAttempts).toBe(2);
    });
  });

  describe("sendPayout", () => {
    it("returns success on 2xx response", async () => {
      mockTokenRequest();
      mockRequest.mockImplementation(async (config) => {
        if (String(config.url).includes("/oauth/token")) {
          return {
            data: { access_token: "token", expires_in: 3600 },
            status: 200,
          } as any;
        }
        if (String(config.url).includes("/payments/disburse")) {
          return {
            data: { reference: "payout-1", status: "PENDING" },
            status: 202,
          } as any;
        }
        return { data: {}, status: 200 } as any;
      });

      const result = await provider.sendPayout("+224340000000", "10000");

      expect(result.success).toBe(true);
    });
  });

  describe("getTransactionStatus", () => {
    it("returns completed for SUCCESSFUL status", async () => {
      mockTokenRequest();
      mockRequest.mockImplementation(async (config) => {
        if (String(config.url).includes("/oauth/token")) {
          return {
            data: { access_token: "token", expires_in: 3600 },
            status: 200,
          } as any;
        }
        return {
          data: { reference: "ref-1", status: "SUCCESSFUL" },
          status: 200,
        } as any;
      });

      const result = await provider.getTransactionStatus("ref-1");

      expect(result.status).toBe("completed");
    });

    it("returns failed for FAILED status", async () => {
      mockTokenRequest();
      mockRequest.mockImplementation(async (config) => {
        if (String(config.url).includes("/oauth/token")) {
          return {
            data: { access_token: "token", expires_in: 3600 },
            status: 200,
          } as any;
        }
        return { data: { status: "FAILED" }, status: 200 } as any;
      });

      const result = await provider.getTransactionStatus("ref-1");

      expect(result.status).toBe("failed");
    });

    it("returns pending for PENDING status", async () => {
      mockTokenRequest();
      mockRequest.mockImplementation(async (config) => {
        if (String(config.url).includes("/oauth/token")) {
          return {
            data: { access_token: "token", expires_in: 3600 },
            status: 200,
          } as any;
        }
        return { data: { status: "PENDING" }, status: 200 } as any;
      });

      const result = await provider.getTransactionStatus("ref-1");

      expect(result.status).toBe("pending");
    });

    it("returns unknown for unrecognized status", async () => {
      mockTokenRequest();
      mockRequest.mockImplementation(async (config) => {
        if (String(config.url).includes("/oauth/token")) {
          return {
            data: { access_token: "token", expires_in: 3600 },
            status: 200,
          } as any;
        }
        return { data: { status: "UNKNOWN_STATUS" }, status: 200 } as any;
      });

      const result = await provider.getTransactionStatus("ref-1");

      expect(result.status).toBe("unknown");
    });

    it("returns unknown on error", async () => {
      mockRequest.mockRejectedValue(new Error("Network error"));

      const result = await provider.getTransactionStatus("ref-1");

      expect(result.status).toBe("unknown");
    });
  });

  describe("getOperationalBalance", () => {
    it("returns balance data on success", async () => {
      mockTokenRequest();
      mockRequest.mockImplementation(async (config) => {
        if (String(config.url).includes("/oauth/token")) {
          return {
            data: { access_token: "token", expires_in: 3600 },
            status: 200,
          } as any;
        }
        return {
          data: { balance: 5000000, currency: "GNF" },
          status: 200,
        } as any;
      });

      const result = await provider.getOperationalBalance();

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it("returns failure on error", async () => {
      mockRequest.mockRejectedValue(new Error("Network error"));

      const result = await provider.getOperationalBalance();

      expect(result.success).toBe(false);
    });
  });

  describe("sendBatchPayout", () => {
    it("processes batch and maps results", async () => {
      mockTokenRequest();
      mockRequest.mockImplementation(async (config) => {
        if (String(config.url).includes("/oauth/token")) {
          return {
            data: { access_token: "token", expires_in: 3600 },
            status: 200,
          } as any;
        }
        return {
          data: {
            items: [
              {
                referenceId: "ref-1",
                status: "SUCCESSFUL",
                transactionId: "txn-001",
              },
              {
                referenceId: "ref-2",
                status: "FAILED",
                errorReason: "insufficient_balance",
              },
            ],
          },
          status: 200,
        } as any;
      });

      const result = await provider.sendBatchPayout([
        { referenceId: "ref-1", phoneNumber: "+224340000001", amount: "5000" },
        { referenceId: "ref-2", phoneNumber: "+224340000002", amount: "999999" },
      ]);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(false);
    });

    it("returns empty results for empty batch", async () => {
      const result = await provider.sendBatchPayout([]);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(0);
    });

    it("rejects batch exceeding max size", async () => {
      const items = Array.from({ length: 51 }, (_, i) => ({
        referenceId: `ref-${i}`,
        phoneNumber: "+224340000000",
        amount: "1000",
      }));

      const result = await provider.sendBatchPayout(items);

      expect(result.success).toBe(false);
      expect(result.results).toHaveLength(51);
      expect(result.results[0].error).toContain("exceeds maximum");
    });
  });

  describe("verifyCallbackSignature", () => {
    const rawBody = Buffer.from(
      JSON.stringify({ reference: "ref-1", status: "SUCCESSFUL" }),
    );
    let secret: string;

    beforeEach(() => {
      secret = "test-callback-secret";
      process.env.ORANGE_GUINEA_CALLBACK_SECRET = secret;
      provider = new OrangeGuineaProvider();
    });

    it("returns true for a valid hex signature", () => {
      const sig = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");

      expect(provider.verifyCallbackSignature(rawBody, sig)).toBe(true);
    });

    it("returns false for a tampered signature", () => {
      const sig = "sha256=" + createHmac("sha256", "wrong-secret")
        .update(rawBody)
        .digest("hex");

      expect(provider.verifyCallbackSignature(rawBody, sig)).toBe(false);
    });

    it("returns false when no callback secret is configured", () => {
      process.env.ORANGE_GUINEA_CALLBACK_SECRET = "";
      provider = new OrangeGuineaProvider();

      const sig = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");

      expect(provider.verifyCallbackSignature(rawBody, sig)).toBe(false);
    });

    it("returns false when no signature header is provided", () => {
      expect(provider.verifyCallbackSignature(rawBody, undefined)).toBe(false);
    });
  });

  describe("destroy", () => {
    it("marks provider as destroyed and clears resources", () => {
      provider.destroy();
      expect((provider as any).destroyed).toBe(true);
    });
  });
});

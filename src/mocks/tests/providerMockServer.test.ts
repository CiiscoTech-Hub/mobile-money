process.env.MOCK_WEBHOOK_LATENCY_MS = "0";
process.env.MOCK_WEBHOOK_LATENCY_ENABLED = "false";

const { createProviderMockApp } = require("../../../scripts/provider-mock-server");
import request = require("supertest");

describe("provider mock server – MTN response shapes", () => {
  const app = createProviderMockApp();

  describe("POST /mtn/collection/token/", () => {
    it("returns an access_token string matching the real MTN token shape", async () => {
      const res = await request(app).post("/mtn/collection/token/");

      expect(res.status).toBe(200);
      expect(typeof res.body.access_token).toBe("string");
      expect(res.body.access_token.length).toBeGreaterThan(0);
      expect(res.body.token_type).toBeDefined();
      expect(res.body.expires_in).toBeDefined();
    });
  });

  describe("POST /mtn/collection/v1_0/requesttopay", () => {
    it("returns 202 with SUCCESSFUL status and a referenceId on default scenario", async () => {
      const res = await request(app)
        .post("/mtn/collection/v1_0/requesttopay")
        .send({ externalId: "mtn-rtp-001" });

      expect(res.status).toBe(202);
      expect(res.body.status).toBe("SUCCESSFUL");
      expect(res.body.referenceId).toBe("mtn-rtp-001");
      expect(res.body.message).toBeDefined();
    });

    it("returns 400 with FAILED status when scenario=failed", async () => {
      const res = await request(app)
        .post("/mtn/collection/v1_0/requesttopay?scenario=failed")
        .send({ externalId: "mtn-rtp-fail" });

      expect(res.status).toBe(400);
      expect(res.body.status).toBe("FAILED");
      expect(res.body.referenceId).toBe("mtn-rtp-fail");
    });

    it("returns 202 with PENDING status when scenario=pending", async () => {
      const res = await request(app)
        .post("/mtn/collection/v1_0/requesttopay?scenario=pending")
        .send({ externalId: "mtn-rtp-pend" });

      expect(res.status).toBe(202);
      expect(res.body.status).toBe("PENDING");
      expect(res.body.referenceId).toBe("mtn-rtp-pend");
    });

    it("generates a referenceId when none is provided", async () => {
      const res = await request(app)
        .post("/mtn/collection/v1_0/requesttopay")
        .send({});

      expect(res.status).toBe(202);
      expect(typeof res.body.referenceId).toBe("string");
      expect(res.body.referenceId).toMatch(/^mtn-/);
    });
  });

  describe("GET /mtn/collection/v1_0/requesttopay/:referenceId", () => {
    it("returns the stored scenario status matching what the real provider reads", async () => {
      await request(app)
        .post("/mtn/collection/v1_0/requesttopay?scenario=pending")
        .send({ externalId: "mtn-status-001" });

      const res = await request(app).get(
        "/mtn/collection/v1_0/requesttopay/mtn-status-001",
      );

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        referenceId: "mtn-status-001",
        status: "PENDING",
      });
    });

    it("returns PENDING for unknown referenceId with scenario query", async () => {
      const res = await request(app).get(
        "/mtn/collection/v1_0/requesttopay/unknown-ref?scenario=pending",
      );

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("PENDING");
    });
  });

  describe("GET /mtn/disbursement/v1_0/account/balance", () => {
    it("returns availableBalance and currency matching MtnBalanceResponse shape", async () => {
      const res = await request(app).get(
        "/mtn/disbursement/v1_0/account/balance",
      );

      expect(res.status).toBe(200);
      expect(res.body.availableBalance).toBeDefined();
      expect(Number.isFinite(Number.parseFloat(String(res.body.availableBalance)))).toBe(true);
      expect(res.body.currency).toBe("XAF");
    });

    it("returns 503 on failure scenario", async () => {
      const res = await request(app).get(
        "/mtn/disbursement/v1_0/account/balance?scenario=failed",
      );

      expect(res.status).toBe(503);
      expect(res.body.message).toBeDefined();
    });
  });
});

describe("provider mock server – Airtel response shapes", () => {
  const app = createProviderMockApp();

  describe("POST /airtel/auth/oauth2/token", () => {
    it("returns an access_token matching the real Airtel token shape", async () => {
      const res = await request(app).post("/airtel/auth/oauth2/token");

      expect(res.status).toBe(200);
      expect(typeof res.body.access_token).toBe("string");
      expect(res.body.access_token.length).toBeGreaterThan(0);
      expect(res.body.token_type).toBe("Bearer");
      expect(res.body.expires_in).toBe(3600);
    });
  });

  describe("POST /airtel/merchant/v1/payments/", () => {
    it("returns TS status and nested AirtelResponse shape on success", async () => {
      const res = await request(app)
        .post("/airtel/merchant/v1/payments/")
        .send({ reference: "airtel-pay-001" });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: { success: true, code: "DP_SUCCESS" },
        data: {
          transaction: { id: "airtel-pay-001", status: "TS" },
        },
      });
    });

    it("returns TF status and error code on failure", async () => {
      const res = await request(app)
        .post("/airtel/merchant/v1/payments/?scenario=failed")
        .send({ reference: "airtel-pay-fail" });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        status: { success: false, code: "DP_REQUEST_FAILED" },
        data: {
          transaction: { id: "airtel-pay-fail", status: "TF" },
        },
      });
    });

    it("returns TP status on pending scenario", async () => {
      const res = await request(app)
        .post("/airtel/merchant/v1/payments/?scenario=pending")
        .send({ reference: "airtel-pay-pend" });

      expect(res.status).toBe(200);
      expect(res.body.status.code).toBe("DP_PENDING");
      expect(res.body.data.transaction.status).toBe("TP");
    });
  });

  describe("GET /airtel/standard/v1/payments/:reference", () => {
    it("returns TS status for a stored successful transaction", async () => {
      await request(app)
        .post("/airtel/merchant/v1/payments/")
        .send({ reference: "airtel-status-001" });

      const res = await request(app).get(
        "/airtel/standard/v1/payments/airtel-status-001",
      );

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: { success: true, code: "DP_STATUS_OK" },
        data: {
          transaction: { id: "airtel-status-001", status: "TS" },
        },
      });
    });

    it("returns TF status for a stored failed transaction", async () => {
      await request(app)
        .post("/airtel/merchant/v1/payments/?scenario=failed")
        .send({ reference: "airtel-status-fail" });

      const res = await request(app).get(
        "/airtel/standard/v1/payments/airtel-status-fail",
      );

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: { success: false, code: "DP_STATUS_FAILED" },
        data: {
          transaction: { id: "airtel-status-fail", status: "TF" },
        },
      });
    });
  });

  describe("GET /airtel/standard/v1/users/balance", () => {
    it("returns availableBalance and currency matching AirtelBalanceResponse shape", async () => {
      const res = await request(app).get(
        "/airtel/standard/v1/users/balance",
      );

      expect(res.status).toBe(200);
      expect(res.body.status).toMatchObject({
        success: true,
        code: "BALANCE_OK",
      });
      expect(res.body.data.availableBalance).toBeDefined();
      expect(
        Number.isFinite(Number.parseFloat(String(res.body.data.availableBalance))),
      ).toBe(true);
      expect(res.body.data.currency).toBeDefined();
    });

    it("returns 503 on failure scenario", async () => {
      const res = await request(app).get(
        "/airtel/standard/v1/users/balance?scenario=failed",
      );

      expect(res.status).toBe(503);
      expect(res.body.status).toMatchObject({
        success: false,
        code: "BALANCE_UNAVAILABLE",
      });
    });
  });

  describe("POST /airtel/standard/v1/disbursements/", () => {
    it("returns DS_SUCCESS status on success", async () => {
      const res = await request(app)
        .post("/airtel/standard/v1/disbursements/")
        .send({ reference: "airtel-disb-001" });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: { success: true, code: "DS_SUCCESS" },
        data: {
          transaction: { id: "airtel-disb-001", status: "TS" },
        },
      });
    });

    it("returns DS_REQUEST_FAILED on failure", async () => {
      const res = await request(app)
        .post("/airtel/standard/v1/disbursements/?scenario=failed")
        .send({ reference: "airtel-disb-fail" });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        status: { success: false, code: "DS_REQUEST_FAILED" },
        data: {
          transaction: { id: "airtel-disb-fail", status: "TF" },
        },
      });
    });

    it("returns DS_PENDING on pending scenario", async () => {
      const res = await request(app)
        .post("/airtel/standard/v1/disbursements/?scenario=pending")
        .send({ reference: "airtel-disb-pend" });

      expect(res.status).toBe(200);
      expect(res.body.status.code).toBe("DS_PENDING");
      expect(res.body.data.transaction.status).toBe("TP");
    });
  });

  describe("country-code prefixed routes", () => {
    it("POST /airtel/:countryCode/merchant/v1/payments/ works the same", async () => {
      const res = await request(app)
        .post("/airtel/NG/merchant/v1/payments/")
        .send({ reference: "airtel-ng-001" });

      expect(res.status).toBe(200);
      expect(res.body.data.transaction.status).toBe("TS");
    });

    it("GET /airtel/:countryCode/standard/v1/users/balance works the same", async () => {
      const res = await request(app).get(
        "/airtel/UG/standard/v1/users/balance",
      );

      expect(res.status).toBe(200);
      expect(res.body.data.availableBalance).toBeDefined();
    });
  });
});

describe("provider mock server – webhook callback parameters", () => {
  const app = createProviderMockApp();
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest
      .spyOn(console, "log")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("MTN success callback transmits referenceId, provider, status, and ISO timestamp", async () => {
    await request(app)
      .post("/mtn/collection/v1_0/requesttopay")
      .send({ externalId: "cb-mtn-001" });

    await new Promise((r) => setTimeout(r, 50));

    const webhookLog = consoleSpy.mock.calls.find(
      (call: unknown[]) =>
        Array.isArray(call) &&
        typeof call[0] === "string" &&
        call[0].includes("[webhook]") &&
        call[1] !== undefined,
    );

    expect(webhookLog).toBeDefined();
    const payload = webhookLog![1] as Record<string, unknown>;
    expect(payload.referenceId).toBe("cb-mtn-001");
    expect(payload.provider).toBe("mtn");
    expect(payload.status).toBe("SUCCESSFUL");
    expect(typeof payload.timestamp).toBe("string");
    expect(new Date(payload.timestamp as string).toISOString()).toBe(
      payload.timestamp as string,
    );
  });

  it("MTN failed callback transmits FAILED status", async () => {
    await request(app)
      .post("/mtn/collection/v1_0/requesttopay?scenario=failed")
      .send({ externalId: "cb-mtn-fail" });

    await new Promise((r) => setTimeout(r, 50));

    const webhookLog = consoleSpy.mock.calls.find(
      (call: unknown[]) =>
        Array.isArray(call) &&
        typeof call[0] === "string" &&
        call[0].includes("[webhook]") &&
        call[1] !== undefined,
    );

    expect(webhookLog).toBeDefined();
    const payload = webhookLog![1] as Record<string, unknown>;
    expect(payload.referenceId).toBe("cb-mtn-fail");
    expect(payload.provider).toBe("mtn");
    expect(payload.status).toBe("FAILED");
  });

  it("Airtel success callback transmits referenceId, provider, and TS status", async () => {
    await request(app)
      .post("/airtel/merchant/v1/payments/")
      .send({ reference: "cb-airtel-001" });

    await new Promise((r) => setTimeout(r, 50));

    const webhookLog = consoleSpy.mock.calls.find(
      (call: unknown[]) =>
        Array.isArray(call) &&
        typeof call[0] === "string" &&
        call[0].includes("[webhook]") &&
        call[1] !== undefined,
    );

    expect(webhookLog).toBeDefined();
    const payload = webhookLog![1] as Record<string, unknown>;
    expect(payload.referenceId).toBe("cb-airtel-001");
    expect(payload.provider).toBe("airtel");
    expect(payload.status).toBe("TS");
    expect(typeof payload.timestamp).toBe("string");
  });

  it("Airtel failed callback transmits TF status", async () => {
    await request(app)
      .post("/airtel/merchant/v1/payments/?scenario=failed")
      .send({ reference: "cb-airtel-fail" });

    await new Promise((r) => setTimeout(r, 50));

    const webhookLog = consoleSpy.mock.calls.find(
      (call: unknown[]) =>
        Array.isArray(call) &&
        typeof call[0] === "string" &&
        call[0].includes("[webhook]") &&
        call[1] !== undefined,
    );

    expect(webhookLog).toBeDefined();
    const payload = webhookLog![1] as Record<string, unknown>;
    expect(payload.referenceId).toBe("cb-airtel-fail");
    expect(payload.provider).toBe("airtel");
    expect(payload.status).toBe("TF");
  });
});

describe("provider mock server – response headers", () => {
  const app = createProviderMockApp();

  it("MTN token response has application/json content-type", async () => {
    const res = await request(app).post("/mtn/collection/token/");

    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });

  it("MTN requesttopay response has application/json content-type", async () => {
    const res = await request(app)
      .post("/mtn/collection/v1_0/requesttopay")
      .send({ externalId: "hdr-mtn-001" });

    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });

  it("MTN balance response has application/json content-type", async () => {
    const res = await request(app).get(
      "/mtn/disbursement/v1_0/account/balance",
    );

    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });

  it("Airtel token response has application/json content-type", async () => {
    const res = await request(app).post("/airtel/auth/oauth2/token");

    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });

  it("Airtel payment response has application/json content-type", async () => {
    const res = await request(app)
      .post("/airtel/merchant/v1/payments/")
      .send({ reference: "hdr-airtel-001" });

    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });

  it("Airtel balance response has application/json content-type", async () => {
    const res = await request(app).get(
      "/airtel/standard/v1/users/balance",
    );

    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });

  it("Airtel disbursement response has application/json content-type", async () => {
    const res = await request(app)
      .post("/airtel/standard/v1/disbursements/")
      .send({ reference: "hdr-airtel-disb" });

    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});

describe("provider mock server – scenario normalization", () => {
  const app = createProviderMockApp();

  it("treats 'error' as failure for MTN", async () => {
    const res = await request(app)
      .post("/mtn/collection/v1_0/requesttopay?scenario=error")
      .send({ externalId: "norm-err" });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe("FAILED");
  });

  it("treats 'fail' as failure for Airtel", async () => {
    const res = await request(app)
      .post("/airtel/merchant/v1/payments/?scenario=fail")
      .send({ reference: "norm-fail" });

    expect(res.status).toBe(400);
    expect(res.body.data.transaction.status).toBe("TF");
  });

  it("defaults to success when scenario is omitted", async () => {
    const res = await request(app)
      .post("/mtn/collection/v1_0/requesttopay")
      .send({ externalId: "norm-default" });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe("SUCCESSFUL");
  });

  it("reads scenario from x-mock-scenario header", async () => {
    const res = await request(app)
      .post("/mtn/collection/v1_0/requesttopay")
      .set("x-mock-scenario", "pending")
      .send({ externalId: "norm-header" });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe("PENDING");
  });
});

describe("provider mock server – Moov payment simulations", () => {
  const app = createProviderMockApp();

  describe("POST /moov/oauth/token", () => {
    it("returns an access_token matching the Moov CI OAuth shape", async () => {
      const res = await request(app).post("/moov/oauth/token");

      expect(res.status).toBe(200);
      expect(typeof res.body.access_token).toBe("string");
      expect(res.body.expires_in).toBe(3600);
    });
  });

  describe("POST /moov/payments/deposit", () => {
    it("returns SUCCESS with transactionId on default scenario", async () => {
      const res = await request(app)
        .post("/moov/payments/deposit")
        .send({ referenceId: "moov-dep-001" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("SUCCESS");
      expect(res.body.referenceId).toBe("moov-dep-001");
      expect(res.body.transactionId).toBe("moov-txn-moov-dep-001");
    });

    it("returns FAILED when scenario=failed", async () => {
      const res = await request(app)
        .post("/moov/payments/deposit?scenario=failed")
        .send({ referenceId: "moov-dep-fail" });

      expect(res.status).toBe(400);
      expect(res.body.status).toBe("FAILED");
    });

    it("returns PENDING when scenario=pending", async () => {
      const res = await request(app)
        .post("/moov/payments/deposit?scenario=pending")
        .send({ referenceId: "moov-dep-pend" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("PENDING");
    });
  });

  describe("GET /moov/payments/:referenceId", () => {
    it("returns stored scenario status for deposit lookups", async () => {
      await request(app)
        .post("/moov/payments/deposit?scenario=pending")
        .send({ referenceId: "moov-status-001" });

      const res = await request(app).get("/moov/payments/moov-status-001");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        referenceId: "moov-status-001",
        status: "PENDING",
      });
    });
  });

  describe("POST /moov/soap", () => {
    it("returns signed SOAP for RequestPayment", async () => {
      const res = await request(app)
        .post("/moov/soap")
        .set("SOAPAction", "RequestPayment")
        .send({ referenceId: "moov-soap-001" });

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/xml/);
      expect(res.text).toContain("RequestPaymentResponse");
      expect(res.text).toContain("<Status>SUCCESS</Status>");
    });

    it("returns FAILED status in SOAP when scenario=failed", async () => {
      const res = await request(app)
        .post("/moov/soap?scenario=failed")
        .set("SOAPAction", "SendPayout")
        .send({ referenceId: "moov-soap-fail" });

      expect(res.status).toBe(200);
      expect(res.text).toContain("SendPayoutResponse");
      expect(res.text).toContain("<Status>FAILED</Status>");
    });
  });
});

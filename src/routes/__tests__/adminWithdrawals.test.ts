import express from "express";
import request from "supertest";

jest.mock("../../middleware/auth", () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.jwtUser = { userId: "admin-1", role: "admin" };
    next();
  },
}));

jest.mock("../../middleware/rbac", () => ({
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock("../../services/multisigCustodyLedgerService", () => ({
  multisigCustodyLedgerService: {
    requestWithdrawal: jest.fn(),
    getRequestById: jest.fn(),
    getSigners: jest.fn(),
    verifyWebhookSignature: jest.fn(),
    addSignature: jest.fn(),
    executeApprovedRequest: jest.fn(),
    cancelRequest: jest.fn(),
    getPendingRequestsForSigner: jest.fn(),
  },
}));

import { multisigCustodyLedgerService } from "../../services/multisigCustodyLedgerService";
import adminWithdrawalsRouter from "../adminWithdrawals";
import { errorHandler } from "../../middleware/errorHandler";

const mockService = multisigCustodyLedgerService as jest.Mocked<
  typeof multisigCustodyLedgerService
>;

const REQUEST_ID = "req-1";
const CONFIG_ID = "config-1";

const pendingRequest = {
  id: REQUEST_ID,
  config_id: CONFIG_ID,
  request_type: "withdrawal",
  account_id: "vault-1",
  amount_xaf: 100_000,
  destination: "GDEST...",
  metadata: {},
  status: "pending",
  required_signatures: 2,
  collected_signatures: 0,
  expires_at: new Date(Date.now() + 60_000),
  created_by: "admin-1",
};

const registeredSigner = {
  id: "signer-row-1",
  config_id: CONFIG_ID,
  signer_id: "admin-1",
  signer_name: "Admin One",
  public_key: "registered-public-key",
  weight: 1,
  is_active: true,
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin/withdrawals", adminWithdrawalsRouter);
  app.use(errorHandler);
  return app;
}

describe("adminWithdrawals routes", () => {
  let app: express.Application;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  describe("POST /", () => {
    it("creates a withdrawal request and returns 201", async () => {
      mockService.requestWithdrawal.mockResolvedValueOnce(
        pendingRequest as any,
      );

      const response = await request(app).post("/api/admin/withdrawals").send({
        accountType: "vault",
        accountId: "vault-1",
        amountXaf: 100_000,
        destination: "GDEST...",
      });

      expect(response.status).toBe(201);
      expect(response.body.data.id).toBe(REQUEST_ID);
      expect(response.body.data.signingPayload).toBe(
        `${REQUEST_ID}:100000:GDEST...`,
      );
      expect(mockService.requestWithdrawal).toHaveBeenCalledWith(
        "vault",
        "vault-1",
        100_000,
        "GDEST...",
        "admin-1",
        undefined,
      );
    });

    it("returns 400 for an invalid payload", async () => {
      const response = await request(app).post("/api/admin/withdrawals").send({
        accountType: "not-a-real-type",
        accountId: "vault-1",
        amountXaf: -5,
        destination: "GDEST...",
      });

      expect(response.status).toBe(400);
      expect(mockService.requestWithdrawal).not.toHaveBeenCalled();
    });

    it("surfaces a rejection when no active multi-sig config exists", async () => {
      mockService.requestWithdrawal.mockRejectedValueOnce(
        new Error("No active multi-sig configuration for vault/vault-1"),
      );

      const response = await request(app).post("/api/admin/withdrawals").send({
        accountType: "vault",
        accountId: "vault-1",
        amountXaf: 100_000,
        destination: "GDEST...",
      });

      expect(response.status).toBe(400);
    });
  });

  describe("GET /:id", () => {
    it("returns the withdrawal request", async () => {
      mockService.getRequestById.mockResolvedValueOnce(pendingRequest as any);

      const response = await request(app).get(
        `/api/admin/withdrawals/${REQUEST_ID}`,
      );

      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe(REQUEST_ID);
    });

    it("returns 404 when not found", async () => {
      mockService.getRequestById.mockResolvedValueOnce(null);

      const response = await request(app).get("/api/admin/withdrawals/missing");

      expect(response.status).toBe(404);
    });
  });

  describe("POST /:id/sign", () => {
    it("verifies against the caller's registered signer key and records the signature", async () => {
      mockService.getRequestById.mockResolvedValueOnce(pendingRequest as any);
      mockService.getSigners.mockResolvedValueOnce([registeredSigner] as any);
      mockService.verifyWebhookSignature.mockReturnValueOnce(true);
      mockService.addSignature.mockResolvedValueOnce({
        success: true,
        message: "Signature recorded",
        fullyApproved: false,
      });

      const response = await request(app)
        .post(`/api/admin/withdrawals/${REQUEST_ID}/sign`)
        .send({ signature: "sig-data" });

      expect(response.status).toBe(200);
      expect(response.body.fullyApproved).toBe(false);
      expect(mockService.verifyWebhookSignature).toHaveBeenCalledWith(
        `${REQUEST_ID}:100000:GDEST...`,
        "sig-data",
        "registered-public-key",
      );
      expect(mockService.addSignature).toHaveBeenCalledWith(
        REQUEST_ID,
        "admin-1",
        "sig-data",
        "api",
        expect.any(String),
        undefined,
      );
    });

    it("rejects when the caller is not a registered signer", async () => {
      mockService.getRequestById.mockResolvedValueOnce(pendingRequest as any);
      mockService.getSigners.mockResolvedValueOnce([]);

      const response = await request(app)
        .post(`/api/admin/withdrawals/${REQUEST_ID}/sign`)
        .send({ signature: "sig-data" });

      expect(response.status).toBe(403);
      expect(mockService.verifyWebhookSignature).not.toHaveBeenCalled();
    });

    it("rejects an invalid signature", async () => {
      mockService.getRequestById.mockResolvedValueOnce(pendingRequest as any);
      mockService.getSigners.mockResolvedValueOnce([registeredSigner] as any);
      mockService.verifyWebhookSignature.mockReturnValueOnce(false);

      const response = await request(app)
        .post(`/api/admin/withdrawals/${REQUEST_ID}/sign`)
        .send({ signature: "bad-sig" });

      expect(response.status).toBe(400);
      expect(mockService.addSignature).not.toHaveBeenCalled();
    });
  });

  describe("POST /:id/execute", () => {
    it("executes an approved request", async () => {
      mockService.executeApprovedRequest.mockResolvedValueOnce({
        success: true,
        message: "Request executed successfully",
      });

      const response = await request(app).post(
        `/api/admin/withdrawals/${REQUEST_ID}/execute`,
      );

      expect(response.status).toBe(200);
      expect(mockService.executeApprovedRequest).toHaveBeenCalledWith(
        REQUEST_ID,
        "admin-1",
      );
    });

    it("returns 400 when execution is rejected (e.g. not yet approved)", async () => {
      mockService.executeApprovedRequest.mockResolvedValueOnce({
        success: false,
        message: "Request must be approved (current: pending)",
      });

      const response = await request(app).post(
        `/api/admin/withdrawals/${REQUEST_ID}/execute`,
      );

      expect(response.status).toBe(400);
    });
  });

  describe("POST /:id/cancel", () => {
    it("cancels a request with a reason", async () => {
      mockService.cancelRequest.mockResolvedValueOnce({
        success: true,
        message: "Request cancelled successfully",
      });

      const response = await request(app)
        .post(`/api/admin/withdrawals/${REQUEST_ID}/cancel`)
        .send({ reason: "duplicate request" });

      expect(response.status).toBe(200);
      expect(mockService.cancelRequest).toHaveBeenCalledWith(
        REQUEST_ID,
        "admin-1",
        "duplicate request",
      );
    });

    it("requires a reason", async () => {
      const response = await request(app)
        .post(`/api/admin/withdrawals/${REQUEST_ID}/cancel`)
        .send({});

      expect(response.status).toBe(400);
      expect(mockService.cancelRequest).not.toHaveBeenCalled();
    });
  });

  describe("GET /pending/mine", () => {
    it("returns pending requests for the authenticated signer", async () => {
      mockService.getPendingRequestsForSigner.mockResolvedValueOnce([
        pendingRequest,
      ] as any);

      const response = await request(app).get(
        "/api/admin/withdrawals/pending/mine",
      );

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(mockService.getPendingRequestsForSigner).toHaveBeenCalledWith(
        "admin-1",
      );
    });
  });
});

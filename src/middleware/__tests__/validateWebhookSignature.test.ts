import { createHmac } from "crypto";
import { Request, Response, NextFunction } from "express";

const mockGetConfigValue = jest.fn();
const mockLogSecurityAnomaly = jest.fn();
const mockGetCurrentRequestIp = jest.fn(() => "127.0.0.1");

jest.mock("../../config/appConfig", () => ({
  getConfigValue: mockGetConfigValue,
}));

jest.mock("../../services/logger", () => ({
  logSecurityAnomaly: mockLogSecurityAnomaly,
  getCurrentRequestIp: mockGetCurrentRequestIp,
}));

import { validateWebhookSignature } from "../validateWebhookSignature";

function makeReq(
  overrides: Partial<Request> & { rawBody?: Buffer } = {},
): Request {
  return {
    headers: {},
    body: {},
    method: "POST",
    originalUrl: "/api/mtn/callback",
    url: "/api/mtn/callback",
    ...overrides,
  } as unknown as Request;
}

function makeRes(): Response {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;
}

function hmacBase64(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64");
}

function hmacHex(payload: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
}

const SECRET = "test-secret";
const PAYLOAD = JSON.stringify({ status: "SUCCESSFUL", amount: "500" });

beforeEach(() => {
  jest.clearAllMocks();
  mockGetConfigValue.mockImplementation((key: string) => {
    if (key === "providers.mtn.callbackSecret") return SECRET;
    return undefined;
  });
});

describe("validateWebhookSignature", () => {
  describe("unknown provider", () => {
    it("returns 500 for an unknown provider", async () => {
      const middleware = validateWebhookSignature("unknown");
      const req = makeReq();
      const res = makeRes();
      const next: NextFunction = jest.fn();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "Unknown webhook provider: unknown",
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("secret not configured", () => {
    it("returns 500 and logs anomaly when secret is missing", async () => {
      mockGetConfigValue.mockImplementation((key: string) => {
        if (key === "providers.mtn.callbackSecret") return "";
        return undefined;
      });

      const middleware = validateWebhookSignature("mtn");
      const req = makeReq();
      const res = makeRes();
      const next: NextFunction = jest.fn();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: "mtn webhook verification not configured",
      });
      expect(next).not.toHaveBeenCalled();
      expect(mockLogSecurityAnomaly).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "webhook_secret_not_configured",
        }),
      );
    });
  });

  describe("signature header missing", () => {
    it("returns 401 and logs anomaly when no signature header is present", async () => {
      const middleware = validateWebhookSignature("mtn");
      const req = makeReq({ headers: {} });
      const res = makeRes();
      const next: NextFunction = jest.fn();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Unauthorized webhook",
      });
      expect(next).not.toHaveBeenCalled();
      expect(mockLogSecurityAnomaly).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "webhook_signature_missing",
        }),
      );
    });
  });

  describe("valid signatures", () => {
    it("calls next() for a valid base64 HMAC signature using rawBody", async () => {
      const rawBody = Buffer.from(PAYLOAD);
      const sig = hmacBase64(PAYLOAD, SECRET);
      const middleware = validateWebhookSignature("mtn");
      const req = makeReq({
        headers: { "x-callback-signature": sig },
        rawBody,
      });
      const res = makeRes();
      const next: NextFunction = jest.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockLogSecurityAnomaly).not.toHaveBeenCalled();
    });

    it("calls next() for a valid sha256= prefixed hex signature", async () => {
      const rawBody = Buffer.from(PAYLOAD);
      const sig = hmacHex(PAYLOAD, SECRET);
      const middleware = validateWebhookSignature("mtn");
      const req = makeReq({
        headers: { "x-callback-signature": sig },
        rawBody,
      });
      const res = makeRes();
      const next: NextFunction = jest.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("falls back to req.body when rawBody is absent", async () => {
      const body = { status: "SUCCESSFUL", amount: "500" };
      const sig = hmacBase64(JSON.stringify(body), SECRET);
      const middleware = validateWebhookSignature("mtn");
      const req = makeReq({
        headers: { "x-callback-signature": sig },
        body,
      });
      const res = makeRes();
      const next: NextFunction = jest.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it("accepts signature via the alt header x-mtn-signature", async () => {
      const rawBody = Buffer.from(PAYLOAD);
      const sig = hmacBase64(PAYLOAD, SECRET);
      const middleware = validateWebhookSignature("mtn");
      const req = makeReq({
        headers: { "x-mtn-signature": sig },
        rawBody,
      });
      const res = makeRes();
      const next: NextFunction = jest.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe("invalid signatures", () => {
    it("returns 401 for a tampered payload", async () => {
      const rawBody = Buffer.from(PAYLOAD);
      const sig = hmacBase64("different-payload", SECRET);
      const middleware = validateWebhookSignature("mtn");
      const req = makeReq({
        headers: { "x-callback-signature": sig },
        rawBody,
      });
      const res = makeRes();
      const next: NextFunction = jest.fn();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: "Invalid signature",
      });
      expect(next).not.toHaveBeenCalled();
      expect(mockLogSecurityAnomaly).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "webhook_signature_invalid",
        }),
      );
    });

    it("returns 401 for a wrong secret", async () => {
      const rawBody = Buffer.from(PAYLOAD);
      const sig = hmacBase64(PAYLOAD, "wrong-secret");
      const middleware = validateWebhookSignature("mtn");
      const req = makeReq({
        headers: { "x-callback-signature": sig },
        rawBody,
      });
      const res = makeRes();
      const next: NextFunction = jest.fn();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
      expect(mockLogSecurityAnomaly).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "webhook_signature_invalid",
        }),
      );
    });

    it("returns 401 for a signature with mismatched length", async () => {
      const rawBody = Buffer.from(PAYLOAD);
      const middleware = validateWebhookSignature("mtn");
      const req = makeReq({
        headers: { "x-callback-signature": "short" },
        rawBody,
      });
      const res = makeRes();
      const next: NextFunction = jest.fn();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it("logs anomaly with headerPresent=true for invalid signature", async () => {
      const rawBody = Buffer.from(PAYLOAD);
      const sig = hmacBase64("wrong", SECRET);
      const middleware = validateWebhookSignature("mtn");
      const req = makeReq({
        headers: { "x-callback-signature": sig },
        rawBody,
      });
      const res = makeRes();
      const next: NextFunction = jest.fn();

      await middleware(req, res, next);

      expect(mockLogSecurityAnomaly).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "webhook_signature_invalid",
          headerPresent: true,
        }),
      );
    });
  });
});

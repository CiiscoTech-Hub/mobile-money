import { createHmac, timingSafeEqual } from "crypto";
import { NextFunction, Request, Response } from "express";
import { getConfigValue } from "../config/appConfig";
import { getCurrentRequestIp, logSecurityAnomaly } from "../services/logger";

interface ProviderConfig {
  name: string;
  secretKey: string;
  primaryHeader: string;
  altHeader?: string;
}

const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  mtn: {
    name: "mtn",
    secretKey: "providers.mtn.callbackSecret",
    primaryHeader: "x-callback-signature",
    altHeader: "x-mtn-signature",
  },
  airtel: {
    name: "airtel",
    secretKey: "providers.airtel.callbackSecret",
    primaryHeader: "x-airtel-signature",
  },
  orange: {
    name: "orange",
    secretKey: "providers.orangeMadagascar.callbackSecret",
    primaryHeader: "x-callback-signature",
    altHeader: "x-orange-signature",
  },
  orangeGuinea: {
    name: "orangeGuinea",
    secretKey: "providers.orangeGuinea.callbackSecret",
    primaryHeader: "x-callback-signature",
    altHeader: "x-orange-signature",
  },
};

function getSecret(provider: string): string {
  const config = PROVIDER_CONFIGS[provider];
  if (!config) return "";
  const configuredHeader = getConfigValue(config.secretKey);
  const secret =
    getConfigValue(config.secretKey) ||
    process.env[config.secretKey.replace(/\./g, "_").toUpperCase()] ||
    "";
  return String(secret).trim();
}

function computeExpectedHash(
  rawBody: Buffer,
  secret: string,
  headerValue: string,
): string {
  const hash = createHmac("sha256", secret).update(rawBody);
  return headerValue.startsWith("sha256=") ? hash.digest("hex") : hash.digest("base64");
}

function verifyHash(rawBody: Buffer, headerValue: string, secret: string): boolean {
  const expected = computeExpectedHash(rawBody, secret, headerValue);
  const incoming = headerValue.startsWith("sha256=")
    ? headerValue.slice(7)
    : headerValue;

  if (incoming.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(incoming), Buffer.from(expected));
}

function logFailure(req: Request, provider: string, reason: string): void {
  logSecurityAnomaly({
    event: "security.anomaly",
    timestamp: new Date().toISOString(),
    path: req.originalUrl || req.url,
    method: req.method,
    ip: getCurrentRequestIp(req),
    reason,
    provider,
    headerPresent: reason !== "webhook_signature_missing",
  });
}

export function validateWebhookSignature(provider: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const config = PROVIDER_CONFIGS[provider];
    if (!config) {
      res.status(500).json({ error: `Unknown webhook provider: ${provider}` });
      return;
    }

    const secret = getSecret(provider);
    if (!secret) {
      logFailure(req, provider, "webhook_secret_not_configured");
      res.status(500).json({ error: `${provider} webhook verification not configured` });
      return;
    }

    const headerValue =
      (req.headers[config.primaryHeader] as string | undefined) ||
      (config.altHeader ? (req.headers[config.altHeader] as string | undefined) : undefined);

    if (!headerValue) {
      logFailure(req, provider, "webhook_signature_missing");
      res.status(401).json({ error: "Unauthorized webhook" });
      return;
    }

    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const payload = rawBody || Buffer.from(JSON.stringify(req.body || {}));

    try {
      if (!verifyHash(payload, headerValue, secret)) {
        logFailure(req, provider, "webhook_signature_invalid");
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
      next();
    } catch {
      logFailure(req, provider, "webhook_signature_error");
      res.status(401).json({ error: "Unauthorized webhook" });
    }
  };
}

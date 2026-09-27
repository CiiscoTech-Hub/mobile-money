import type { SessionOptions } from "express-session";
import { SESSION_TTL_SECONDS } from "./redis";

export interface SessionCookieConfig {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none" | boolean;
  maxAge?: number;
}

function normalizeSameSite(value?: string): SessionCookieConfig["sameSite"] {
  if (value === "strict" || value === "lax" || value === "none") {
    return value;
  }

  return "lax";
}

export function getSessionCookieOptions(
  env: NodeJS.ProcessEnv = process.env,
  maxAge = SESSION_TTL_SECONDS * 1000,
): SessionCookieConfig {
  const isProduction = env.NODE_ENV === "production";
  const secure = isProduction || env.SESSION_COOKIE_SECURE === "true";
  const sameSite = normalizeSameSite(env.SESSION_COOKIE_SAMESITE ?? (secure ? "strict" : "lax"));

  return {
    httpOnly: true,
    secure,
    sameSite,
    maxAge,
  };
}

export function getSessionTrustProxy(env: NodeJS.ProcessEnv = process.env): number {
  if (!env.TRUST_PROXY) {
    return 1;
  }

  const parsed = Number(env.TRUST_PROXY);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
}

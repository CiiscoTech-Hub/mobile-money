import cors, { type CorsOptions } from "cors";
import { getConfigValue } from "../config/appConfig";

function normalizeAllowedOrigins(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(
      (origin): origin is string =>
        typeof origin === "string" && origin.trim().length > 0,
    );
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);
  }

  return [];
}

export function getAllowedCorsOrigins(): string[] {
  const configOrigins = normalizeAllowedOrigins(
    getConfigValue("cors.allowedOrigins"),
  );

  if (configOrigins.length > 0) {
    return configOrigins;
  }

  const envOrigins = normalizeAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);
  if (envOrigins.length > 0) {
    return envOrigins;
  }

  return normalizeAllowedOrigins(process.env.ALLOWED_ORIGINS);
}

export function createCorsMiddleware(): ReturnType<typeof cors> {
  const allowedOrigins = getAllowedCorsOrigins();
  const isProduction = process.env.NODE_ENV === "production";

  const corsOptions: CorsOptions = {
    origin(requestOrigin: string | undefined, callback) {
      if (!requestOrigin) {
        return callback(null, !isProduction);
      }

      if (allowedOrigins.includes(requestOrigin)) {
        return callback(null, true);
      }

      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "X-Request-ID",
    ],
    exposedHeaders: [
      "X-Request-ID",
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
    ],
    maxAge: 600,
    optionsSuccessStatus: 204,
  };

  return cors(corsOptions);
}

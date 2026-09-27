/**
 * Shared / reusable OpenAPI component schemas.
 */

import { z } from "zod";
import { registry } from "../registry";

// ─── Error response ───────────────────────────────────────────────────────────

export const ErrorResponseSchema = registry.register(
  "ErrorResponse",
  z
    .object({
      error: z.string().openapi({ example: "Validation failed" }),
      message: z
        .string()
        .optional()
        .openapi({ example: "Amount must be a positive number" }),
    })
    .openapi("ErrorResponse", { description: "Standard error envelope" }),
);

// ─── Pagination ───────────────────────────────────────────────────────────────

export const PaginationSchema = registry.register(
  "Pagination",
  z
    .object({
      limit: z.number().int().openapi({ example: 50 }),
      offset: z.number().int().openapi({ example: 0 }),
      hasMore: z.boolean().openapi({ example: false }),
    })
    .openapi("Pagination"),
);

// ─── Security schemes ────────────────────────────────────────────────────────

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description:
    "JWT Bearer token obtained via POST /api/auth/login. " +
    "Include as: Authorization: Bearer <token>. " +
    "Tokens expire after 24 hours; use POST /api/auth/refresh to rotate.",
});

registry.registerComponent("securitySchemes", "apiKey", {
  type: "apiKey",
  in: "header",
  name: "X-API-Key",
  description:
    "API key for admin-level operations. " +
    "Include as: X-API-Key: <key>. " +
    "Admin API keys are generated via the dashboard and grant full access to admin endpoints.",
});

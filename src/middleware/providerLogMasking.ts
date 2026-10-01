import type { Request, Response, NextFunction } from "express";
import logger, { childLogger } from "../utils/logger";
import { maskPII } from "../utils/masking";
import { redact } from "../utils/redact";

export function providerLogMaskingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const traceId = req.headers["x-request-id"] as string | undefined;
  const reqLogger = traceId ? childLogger(traceId) : logger;
  const originalJson = res.json.bind(res);

  res.json = function (body: unknown): Response {
    try {
      const masked = redact(maskPII(body));
      reqLogger.info(
        { responseBody: masked, path: req.path, statusCode: res.statusCode },
        "provider api response",
      );
    } catch {
      // never throw from a logging path
    }
    return originalJson(body);
  };

  next();
}

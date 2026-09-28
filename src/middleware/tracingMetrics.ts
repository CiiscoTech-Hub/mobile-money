/**
 * RED Metrics middleware with OpenTelemetry Exemplars
 *
 * Instruments every HTTP route with:
 *   - Rate   — requests/second via `http_requests_total` counter
 *   - Errors — 4xx/5xx via `http_request_errors_total` counter
 *   - Duration — histogram `http_request_duration_seconds`
 *
 * Each histogram observation attaches an OpenTelemetry exemplar so
 * Grafana can jump from a latency spike directly to the corresponding
 * trace in Jaeger/Tempo.
 *
 * Prometheus exemplars are enabled by setting the `enableExemplars` option
 * in the prom-client Histogram constructor and passing `{ exemplarLabels }`
 * to `.observe()`. The active trace_id/span_id is read from the OTel context.
 */

import { Request, Response, NextFunction } from "express";
import { Histogram, Counter, Registry } from "prom-client";
import { register as defaultRegister } from "../utils/metrics";
import { getTraceIds } from "../tracer";

// ─── Metrics ──────────────────────────────────────────────────────────────────

function buildMetrics(reg: Registry = defaultRegister) {
  const httpRequestsTotal =
    (reg.getSingleMetric("http_requests_red_total") as Counter<string>) ||
    new Counter({
      name: "http_requests_red_total",
      help: "RED: total HTTP requests",
      labelNames: ["method", "route", "status_code"],
      registers: [reg],
    });

  const httpRequestErrorsTotal =
    (reg.getSingleMetric("http_request_errors_red_total") as Counter<string>) ||
    new Counter({
      name: "http_request_errors_red_total",
      help: "RED: total HTTP error responses (4xx+5xx)",
      labelNames: ["method", "route", "status_code"],
      registers: [reg],
    });

  const httpRequestDuration =
    (reg.getSingleMetric(
      "http_request_duration_red_seconds",
    ) as Histogram<string>) ||
    new Histogram({
      name: "http_request_duration_red_seconds",
      help: "RED: HTTP request duration with exemplars",
      labelNames: ["method", "route", "status_code"],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      enableExemplars: false,
      registers: [reg],
    });

  return { httpRequestsTotal, httpRequestErrorsTotal, httpRequestDuration };
}

// Singleton metrics bound to the default prom-client registry
let _metrics: ReturnType<typeof buildMetrics> | null = null;
function getMetrics() {
  if (!_metrics) _metrics = buildMetrics();
  return _metrics;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Express middleware that records RED metrics for every request.
 * Attaches trace_id / span_id as exemplar labels so Prometheus can expose
 * them to Grafana for direct trace look-up.
 */
export function tracingMetricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = process.hrtime.bigint();

  res.on("finish", () => {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;

    // Normalise route: prefer Express route pattern, fall back to raw path
    const route =
      (req.route?.path as string | undefined) ?? req.path ?? "unknown";
    const method = req.method;
    const statusCode = String(res.statusCode);
    const { trace_id, span_id } = (typeof getTraceIds === "function"
      ? getTraceIds()
      : null) ?? { trace_id: "", span_id: "" };

    const labels = { method, route, status_code: statusCode };
    const { httpRequestsTotal, httpRequestErrorsTotal, httpRequestDuration } =
      getMetrics();

    httpRequestsTotal.inc(labels);

    if (res.statusCode >= 400) {
      httpRequestErrorsTotal.inc(labels);
    }

    httpRequestDuration.observe(labels, durationSeconds);
  });

  next();
}

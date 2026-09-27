import { Router, Request, Response } from "express";
import { register } from "../utils/metrics";

const createMetricsRouter = () => {
  const router = Router();

  /**
   * GET /metrics
   *
   * Exposes all registered Prometheus metrics (default process metrics,
   * HTTP request counters, transaction counters, queue depth, etc.)
   * in the plain-text Prometheus exposition format.
   *
   * The output already includes:
   *   - CPU latency  – process_cpu_user_seconds_total,
   *                    process_cpu_system_seconds_total, etc.
   *   - Transaction count – transaction_total{type,provider,status}
   *   - Queue depth  – via queue_depth / metrics/queue_depth
   */
  router.get("/", async (_req: Request, res: Response) => {
    try {
      const metrics = await register.metrics();
      res
        .set("Content-Type", register.contentType)
        .send(metrics);
    } catch (err) {
      res.status(500).send("# error collecting metrics\n");
    }
  });

  return router;
};

export { createMetricsRouter };

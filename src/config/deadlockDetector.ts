import { Pool } from "pg";
import logger from "../utils/logger";

const DEADLOCK_DETECTOR_INTERVAL_MS = parseInt(
  process.env.DEADLOCK_DETECTOR_INTERVAL_MS || "2000",
  10,
);

const BLOCKED_QUERY_TIMEOUT_SECONDS = parseInt(
  process.env.BLOCKED_QUERY_TIMEOUT_SECONDS || "3",
  10,
);

let detectorInterval: ReturnType<typeof setInterval> | null = null;

function sanitizeQuery(query: string): string {
  if (!query || typeof query !== "string") return "";
  return query
    .replace(/'[^']*'/g, "'***'")
    .replace(/\b\d{10,}\b/g, "***")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, "***@***.***")
    .replace(/\b[A-Za-z0-9]{20,}\b/g, "***");
}

async function detectBlockedQueries(pool: Pool): Promise<void> {
  try {
    const result = await pool.query(
      `SELECT
        blocked.pid AS blocked_pid,
        LEFT(blocked.query, 500) AS blocked_query,
        blocking.pid AS blocking_pid,
        LEFT(blocking.query, 500) AS blocking_query,
        EXTRACT(EPOCH FROM (NOW() - blocked.query_start))::int AS blocked_duration_seconds
      FROM pg_stat_activity blocked
      JOIN LATERAL pg_blocking_pids(blocked.pid) blocking_pids ON true
      JOIN pg_stat_activity blocking ON blocking.pid = blocking_pids
      WHERE blocked.wait_event_type = 'Lock'
        AND blocked.state = 'active'
        AND blocked.pid <> pg_backend_pid()
        AND EXTRACT(EPOCH FROM (NOW() - blocked.query_start)) > $1
      ORDER BY blocked_duration_seconds DESC`,
      [BLOCKED_QUERY_TIMEOUT_SECONDS],
    );

    for (const row of result.rows) {
      logger.warn({
        type: "deadlock_detected",
        blockedPid: row.blocked_pid,
        blockedQuery: sanitizeQuery(row.blocked_query),
        blockedDurationSeconds: row.blocked_duration_seconds,
        blockingPid: row.blocking_pid,
        blockingQuery: sanitizeQuery(row.blocking_query),
        thresholdSeconds: BLOCKED_QUERY_TIMEOUT_SECONDS,
        message: `Query blocked for ${row.blocked_duration_seconds}s by PID ${row.blocking_pid}`,
      });

      try {
        await pool.query("SELECT pg_cancel_backend($1)", [row.blocking_pid]);
        logger.info(
          `[DeadlockDetector] Cancelled blocking query PID ${row.blocking_pid}`,
        );
      } catch (cancelError) {
        logger.error(
          `[DeadlockDetector] Failed to cancel blocking query PID ${row.blocking_pid}`,
          cancelError,
        );
      }
    }
  } catch (error) {
    logger.error("[DeadlockDetector] Failed to check for blocked queries", error);
  }
}

export function startDeadlockDetector(pool: Pool): void {
  if (detectorInterval) return;
  void detectBlockedQueries(pool);
  detectorInterval = setInterval(() => {
    void detectBlockedQueries(pool);
  }, DEADLOCK_DETECTOR_INTERVAL_MS);
  detectorInterval.unref();
}

export function stopDeadlockDetector(): void {
  if (detectorInterval) {
    clearInterval(detectorInterval);
    detectorInterval = null;
  }
}

import { Queue, Job } from "bullmq";
import { connection } from "./config";
import { Request, Response } from "express";
import { ERROR_CODES } from "../constants/errorCodes";
import { createError } from "../middleware/errorHandler";
import logger from "../utils/logger";

/**
 * Dead Letter Queue (DLQ) for transaction processing.
 *
 * This module provides infrastructure to isolate background jobs that have
 * persistently failed after maximum retries, ensuring they do not clog
 * primary processing queues while allowing for manual inspection.
 */

export const DLQ_NAME = "transaction-dlq";

export const deadLetterQueue = new Queue(DLQ_NAME, {
  connection,
});

/**
 * Evaluates if a job has exhausted its retry attempts and moves it to the DLQ.
 * This function should be integrated into the Worker's 'failed' event listener.
 *
 * @param job The BullMQ job that failed
 */
export async function capturePersistentFailure(job: Job) {
  const maxAttempts = job.opts.attempts || 3;

  if (job.attemptsMade >= maxAttempts) {
    await deadLetterQueue.add(
      "failed-transaction-payload",
      {
        originalJobId: job.id,
        queueName: job.queueName,
        data: job.data,
        failedReason: job.failedReason,
        attemptsMade: job.attemptsMade,
        timestamp: new Date().toISOString(),
      },
      {
        // Ensure records stay in DLQ until manual cleanup/inspection
        removeOnComplete: false,
        // No retries for the DLQ entry itself
        attempts: 1,
      },
    );

    console.warn(
      `[DLQ] Job ${job.id} moved to Dead Letter Queue after ${job.attemptsMade} failed attempts.`,
    );
  }
}

const DLQ_RETENTION_DAYS = parseInt(
  process.env.DLQ_RETENTION_DAYS || "90",
  10,
);

/**
 * Removes DLQ entries older than DLQ_RETENTION_DAYS (default 90 days).
 * Safe to run repeatedly — jobs that have already been removed are skipped.
 */
export async function runDlqCleanupJob(): Promise<void> {
  const cutoffMs = DLQ_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const cutoffTimestamp = Date.now() - cutoffMs;

  const jobs = await deadLetterQueue.getJobs(["waiting"], 0, 9999);
  const stale = jobs.filter((job) => job.timestamp < cutoffTimestamp);

  if (stale.length === 0) {
    logger.info("[dlq-cleanup] No stale DLQ entries to remove.");
    return;
  }

  let removed = 0;
  let failed = 0;

  for (const job of stale) {
    try {
      await job.remove();
      removed++;
    } catch (err) {
      failed++;
      logger.warn(`[dlq-cleanup] Failed to remove DLQ entry ${job.id}:`, err);
    }
  }

  logger.info(
    `[dlq-cleanup] Cleaned ${removed} stale DLQ entries older than ${DLQ_RETENTION_DAYS} days` +
      (failed > 0 ? ` (${failed} failed to remove)` : ""),
  );
}

/**
 * Express controller for the DLQ inspection endpoint.
 * Provides visibility into failing transactions for support and engineering teams.
 */
export async function dlqInspectorHandler(req: Request, res: Response) {
  try {
    const start = parseInt(req.query.start as string) || 0;
    const limit = parseInt(req.query.limit as string) || 50;
    const transactionId = req.query.transactionId as string | undefined;

    let jobs;
    if (transactionId) {
      // Fetch a larger set then filter in memory by transactionId
      const allJobs = await deadLetterQueue.getJobs(["waiting"], 0, 9999);
      jobs = allJobs.filter(
        (job) => job.data?.data?.transactionId === transactionId,
      );
    } else {
      jobs = await deadLetterQueue.getJobs(
        ["waiting"],
        start,
        start + limit - 1,
      );
    }

    const paginated = jobs.slice(start, start + limit);
    const items = paginated.map((job) => ({
      dlqId: job.id,
      ...job.data,
    }));

    return res.status(200).json({
      success: true,
      total: jobs.length,
      count: items.length,
      start,
      limit,
      ...(transactionId && { transactionId }),
      items,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw createError(ERROR_CODES.INTERNAL_ERROR, "Failed to fetch DLQ", {
      details: message,
    });
  }
}

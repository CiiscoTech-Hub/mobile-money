import { Pool } from "pg";
import cron from "node-cron";
import { pool as defaultPool } from "../config/database";
import logger from "../utils/logger";

export interface OutboxEvent {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: any;
  status: string;
  attempts: number;
  max_attempts: number;
  last_attempt_at: Date | null;
  next_attempt_at: Date;
  error_message: string | null;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface OutboxWorkerOptions {
  pool?: Pool;
  pollIntervalMs?: number;
  batchSize?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  pruneAfterHours?: number;
}

export interface OutboxWorkerSummary {
  processed: number;
  published: number;
  failed: number;
  pruned: number;
  durationMs: number;
}

/**
 * Outbox worker for transactional event publishing.
 * 
 * This worker implements the Transactional Outbox pattern to ensure atomic
 * consistency between database updates and external message brokers. Domain
 * events are written to the outbox table within the same DB transaction as the
 * business logic, then this worker polls and publishes them with at-least-once
 * delivery guarantee.
 */
export class OutboxWorker {
  private pool: Pool;
  private pollIntervalMs: number;
  private batchSize: number;
  private maxAttempts: number;
  private retryDelayMs: number;
  private pruneAfterHours: number;
  private scheduledTask: cron.ScheduledTask | null = null;
  private isRunning = false;

  constructor(options: OutboxWorkerOptions = {}) {
    this.pool = options.pool ?? defaultPool;
    this.pollIntervalMs = options.pollIntervalMs ?? 5000;
    this.batchSize = options.batchSize ?? 100;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.retryDelayMs = options.retryDelayMs ?? 60000;
    this.pruneAfterHours = options.pruneAfterHours ?? 24;
  }

  /**
   * Process pending outbox events by publishing them to external message brokers.
   * This method is called periodically by the cron scheduler or can be invoked manually.
   */
  public async process(): Promise<OutboxWorkerSummary> {
    if (this.isRunning) {
      logger.info("[OutboxWorker] Previous processing cycle still in progress. Skipping.");
      return { processed: 0, published: 0, failed: 0, pruned: 0, durationMs: 0 };
    }

    this.isRunning = true;
    const startedAt = Date.now();
    let processed = 0;
    let published = 0;
    let failed = 0;
    let pruned = 0;

    try {
      // 1. Fetch pending events ready for processing
      const events = await this.fetchPendingEvents();

      for (const event of events) {
        processed++;
        const result = await this.publishEvent(event);

        if (result.success) {
          await this.markAsPublished(event.id);
          published++;
        } else {
          await this.markAsFailed(event.id, result.error);
          failed++;
        }
      }

      // 2. Prune old published events
      pruned = await this.pruneOldEvents();

      logger.info(
        { processed, published, failed, pruned },
        "[OutboxWorker] Processing cycle completed",
      );
    } catch (error: any) {
      logger.error({ error: error.message }, "[OutboxWorker] Error during processing cycle");
      throw error;
    } finally {
      this.isRunning = false;
    }

    const durationMs = Date.now() - startedAt;
    return { processed, published, failed, pruned, durationMs };
  }

  /**
   * Fetch pending events that are ready for processing.
   */
  private async fetchPendingEvents(): Promise<OutboxEvent[]> {
    const result = await this.pool.query<OutboxEvent>(
      `SELECT id, event_type, aggregate_type, aggregate_id, payload, status, 
              attempts, max_attempts, last_attempt_at, next_attempt_at, 
              error_message, published_at, created_at, updated_at
       FROM outbox_events
       WHERE status IN ('pending', 'failed')
         AND next_attempt_at <= CURRENT_TIMESTAMP
       ORDER BY next_attempt_at ASC
       LIMIT $1`,
      [this.batchSize],
    );

    return result.rows;
  }

  /**
   * Publish a single event to the external message broker.
   * This is a placeholder implementation - in production, this would integrate
   * with your actual message broker (RabbitMQ, NATS, Kafka, etc.).
   */
  private async publishEvent(event: OutboxEvent): Promise<{ success: boolean; error?: string }> {
    try {
      // Update status to processing before attempting publish
      await this.pool.query(
        `UPDATE outbox_events
         SET status = 'processing', 
             last_attempt_at = CURRENT_TIMESTAMP,
             attempts = attempts + 1
         WHERE id = $1`,
        [event.id],
      );

      // TODO: Integrate with actual message broker
      // For now, we simulate successful publishing
      // In production, you would:
      // - Publish to RabbitMQ/NATS/Kafka based on event_type
      // - Handle broker-specific errors
      // - Implement idempotency keys if needed

      logger.info(
        {
          eventId: event.id,
          eventType: event.event_type,
          aggregateType: event.aggregate_type,
          aggregateId: event.aggregate_id,
        },
        "[OutboxWorker] Publishing event",
      );

      // Simulate successful publish
      return { success: true };
    } catch (error: any) {
      logger.error(
        {
          eventId: event.id,
          eventType: event.event_type,
          error: error.message,
        },
        "[OutboxWorker] Failed to publish event",
      );
      return { success: false, error: error.message };
    }
  }

  /**
   * Mark an event as successfully published.
   */
  private async markAsPublished(eventId: string): Promise<void> {
    await this.pool.query(
      `UPDATE outbox_events
       SET status = 'published',
           published_at = CURRENT_TIMESTAMP,
           next_attempt_at = NULL
       WHERE id = $1`,
      [eventId],
    );
  }

  /**
   * Mark an event as failed and schedule retry.
   */
  private async markAsFailed(eventId: string, errorMessage: string): Promise<void> {
    const event = await this.pool.query<OutboxEvent>(
      `SELECT attempts, max_attempts FROM outbox_events WHERE id = $1`,
      [eventId],
    );

    if (event.rows.length === 0) {
      return;
    }

    const { attempts, max_attempts } = event.rows[0];

    if (attempts >= max_attempts) {
      // Max attempts reached, mark as permanently failed
      await this.pool.query(
        `UPDATE outbox_events
         SET status = 'failed',
             error_message = $2,
             next_attempt_at = NULL
         WHERE id = $1`,
        [eventId, errorMessage],
      );
      logger.warn(
        { eventId, attempts: attempts, maxAttempts: max_attempts },
        "[OutboxWorker] Event max attempts reached, marked as failed",
      );
    } else {
      // Schedule retry with exponential backoff
      const delayMs = this.retryDelayMs * Math.pow(2, attempts);
      const nextAttemptAt = new Date(Date.now() + delayMs);

      await this.pool.query(
        `UPDATE outbox_events
         SET status = 'failed',
             error_message = $2,
             next_attempt_at = $3
         WHERE id = $1`,
        [eventId, errorMessage, nextAttemptAt],
      );
    }
  }

  /**
   * Prune old published events to prevent table bloat.
   */
  private async pruneOldEvents(): Promise<number> {
    const cutoffDate = new Date(Date.now() - this.pruneAfterHours * 60 * 60 * 1000);

    const result = await this.pool.query(
      `DELETE FROM outbox_events
       WHERE status = 'published'
         AND published_at < $1`,
      [cutoffDate],
    );

    const prunedCount = result.rowCount || 0;
    if (prunedCount > 0) {
      logger.info({ count: prunedCount }, "[OutboxWorker] Pruned old published events");
    }

    return prunedCount;
  }

  /**
   * Start periodic execution of the outbox worker using node-cron.
   * Default schedule is every 5 seconds.
   */
  public startCron(schedule = process.env.OUTBOX_WORKER_CRON || "*/5 * * * * *"): cron.ScheduledTask {
    if (this.scheduledTask) {
      return this.scheduledTask;
    }

    this.scheduledTask = cron.schedule(schedule, async () => {
      try {
        await this.process();
      } catch (err: any) {
        logger.error({ error: err.message }, "[OutboxWorker] Cron run encountered error");
      }
    });

    logger.info({ schedule }, "[OutboxWorker] Cron scheduler registered");
    return this.scheduledTask;
  }

  /**
   * Stop the active cron schedule.
   */
  public stopCron(): void {
    if (this.scheduledTask) {
      this.scheduledTask.stop();
      this.scheduledTask = null;
    }
    logger.info("[OutboxWorker] Cron scheduler stopped");
  }
}

export const outboxWorker = new OutboxWorker();

/**
 * Top-level job execution handler for centralized scheduler.
 */
export async function runOutboxWorkerJob(): Promise<void> {
  await outboxWorker.process();
}

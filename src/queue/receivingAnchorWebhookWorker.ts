import { Job, Worker } from "bullmq";
import {
  RECEIVING_ANCHOR_WEBHOOK_QUEUE,
  ReceivingAnchorWebhookJob,
  WebhookDispatcherService,
} from "../services/webhookService";
import { queueOptions } from "./config";
import logger from "../utils/logger";

let worker: Worker<ReceivingAnchorWebhookJob> | null = null;

export function startReceivingAnchorWebhookWorker(): void {
  if (worker) return;

  const dispatcher = new WebhookDispatcherService();
  worker = new Worker<ReceivingAnchorWebhookJob>(
    RECEIVING_ANCHOR_WEBHOOK_QUEUE,
    async (job: Job<ReceivingAnchorWebhookJob>) => dispatcher.deliver(job.data),
    queueOptions,
  );
  worker.on("failed", (job, error) =>
    logger.warn(
      { jobId: job?.id, attemptsMade: job?.attemptsMade, error },
      "Receiving-anchor webhook delivery failed; BullMQ will retry with exponential backoff",
    ),
  );
}

export async function closeReceivingAnchorWebhookWorker(): Promise<void> {
  await worker?.close();
  worker = null;
}

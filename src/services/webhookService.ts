import { createHmac } from "crypto";
import { Queue } from "bullmq";
import { queueOptions } from "../queue/config";
import logger from "../utils/logger";

/** Queue used for notifications sent to SEP-31 receiving anchors. */
export const RECEIVING_ANCHOR_WEBHOOK_QUEUE = "receiving-anchor-webhooks";

export type ReceivingAnchorWebhookStatus =
  "pending_receiver" | "completed" | "error";

export interface ReceivingAnchorWebhookPayload {
  id: string;
  status: ReceivingAnchorWebhookStatus;
  amount: string;
  stellar_transaction_id: string | null;
  started_at: string;
  completed_at?: string;
  stellar_memo?: string;
  stellar_memo_type?: string;
}

export interface ReceivingAnchorWebhookJob {
  callbackUrl: string;
  secret: string;
  payload: ReceivingAnchorWebhookPayload;
}

export const receivingAnchorWebhookQueue = new Queue<ReceivingAnchorWebhookJob>(
  RECEIVING_ANCHOR_WEBHOOK_QUEUE,
  queueOptions,
);

const maxAttempts = Number(process.env.SEP31_WEBHOOK_MAX_ATTEMPTS ?? 5);
const retryDelayMs = Number(process.env.SEP31_WEBHOOK_RETRY_DELAY_MS ?? 1_000);

/**
 * Queues signed callback notifications for a receiving anchor.  The callback
 * URL and shared secret are kept with the SEP-31 transaction metadata, so a
 * delivery always uses the registration that was active for that transfer.
 */
export class WebhookDispatcherService {
  async dispatch(
    callbackUrl: string | undefined,
    secret: string | undefined,
    payload: ReceivingAnchorWebhookPayload,
  ): Promise<void> {
    if (!callbackUrl) {
      logger.warn(
        { transactionId: payload.id },
        "SEP-31 webhook skipped: callback URL is not registered",
      );
      return;
    }
    if (!secret) {
      logger.warn(
        { transactionId: payload.id },
        "SEP-31 webhook skipped: callback secret is not configured",
      );
      return;
    }

    await receivingAnchorWebhookQueue.add(
      "deliver",
      {
        callbackUrl,
        secret,
        payload,
      },
      {
        jobId: `sep31-${payload.id}-${payload.status}-${Date.now()}`,
        attempts: maxAttempts,
        backoff: { type: "exponential", delay: retryDelayMs },
        removeOnComplete: { count: 200, age: 7 * 24 * 60 * 60 },
        removeOnFail: { count: 500, age: 30 * 24 * 60 * 60 },
      },
    );
  }

  /** Delivers a serialized payload and returns false for retriable HTTP failures. */
  async deliver(job: ReceivingAnchorWebhookJob): Promise<void> {
    const body = JSON.stringify(job.payload);
    const signature = `sha256=${createHmac("sha256", job.secret)
      .update(body)
      .digest("hex")}`;
    const response = await fetch(job.callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Stellar-Signature": signature,
      },
      body,
    });

    if (!response.ok) {
      throw new Error(
        `Receiving-anchor webhook returned HTTP ${response.status}`,
      );
    }
  }
}

export const webhookDispatcherService = new WebhookDispatcherService();

/** Enqueue only the status changes that SEP-31 requires receiving anchors to receive. */
export async function notifyReceivingAnchorStatus(
  transaction: { id: string; amount: string; createdAt?: Date | string },
  status: ReceivingAnchorWebhookStatus,
  metadata: Record<string, any>,
): Promise<void> {
  const sep31 = metadata.sep31 ?? {};
  await webhookDispatcherService.dispatch(
    sep31.callback_url ?? sep31.callback,
    sep31.callback_secret ?? sep31.webhook_secret,
    {
      id: transaction.id,
      status,
      amount: transaction.amount,
      stellar_transaction_id:
        sep31.stellar_transaction_id ?? sep31.transactionHash ?? null,
      started_at: new Date(transaction.createdAt ?? Date.now()).toISOString(),
      ...(status === "completed" || status === "error"
        ? { completed_at: new Date().toISOString() }
        : {}),
      stellar_memo: sep31.memo,
      stellar_memo_type: sep31.memo_type,
    },
  );
}

export async function closeReceivingAnchorWebhookQueue(): Promise<void> {
  await receivingAnchorWebhookQueue.close();
}

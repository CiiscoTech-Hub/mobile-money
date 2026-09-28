import logger from "../utils/logger";
import { TransactionModel, TransactionStatus } from "../models/transaction";
import {
  MtnMomoProvider,
  BatchPayoutItem,
  BatchPayoutResult,
} from "../services/providers/mtnMomo";
import { rabbitMQManager, EXCHANGES, ROUTING_KEYS } from "./rabbitmq";
import { EmailService } from "../services/email";
import { UserModel } from "../models/users";
import { SmsService } from "../services/sms";
import { notifyTransactionWebhook, WebhookService } from "../services/webhook";
import { pushNotificationService } from "../services/push";
import {
  batchPayoutTotal,
  batchPayoutItemsTotal,
  batchPayoutDurationSeconds,
  batchPayoutSize,
} from "../utils/metrics";

const transactionModel = new TransactionModel();
const mtnMomoProvider = new MtnMomoProvider();
const emailService = new EmailService();
const userModel = new UserModel();
const smsService = new SmsService();
const webhookService = new WebhookService();
const pushService = pushNotificationService;

const BATCH_SIZE = 100;
// Default to 1 hour (3600000ms), configurable via environment variable
const BATCH_SCHEDULE_INTERVAL_MS = parseInt(
  process.env.PAYOUT_BATCH_INTERVAL_MS || "3600000",
  10,
);
const SUPPORTED_PROVIDERS = ["mtn", "mtn_momo", "mtn_cameroon", "mtn_uganda", "mtn_rwanda"];

export interface PendingPayout {
  transactionId: string;
  phoneNumber: string;
  amount: string;
  provider: string;
}

async function sendTransactionNotifications(
  transactionId: string,
  phoneNumber: string,
  amount: string,
  provider: string,
  status: "completed" | "failed",
  errorMsg?: string,
): Promise<void> {
  const transaction = await transactionModel.findById(transactionId);
  if (!transaction?.userId) return;

  const user = await userModel.findById(transaction.userId);

  try {
    if (status === "completed") {
      if (user?.email) {
        await emailService.sendTransactionReceipt(
          user.email,
          transaction,
          user.preferredLanguage,
          user.displayName,
        );
      }
      await pushService.sendTransactionComplete(transaction.userId, {
        transactionId: transaction.id,
        referenceNumber: transaction.referenceNumber,
        type: "withdraw",
        amount: String(transaction.amount),
        status: "completed",
      });
      if (!user?.smsOptOut) {
        await smsService.notifyTransactionEvent(phoneNumber, {
          referenceNumber: transaction.referenceNumber || transactionId,
          type: "withdraw",
          amount: String(amount),
          provider,
          kind: "transaction_completed",
        });
      }
    } else {
      if (user?.email) {
        await emailService.sendTransactionFailure(
          user.email,
          transaction,
          errorMsg || "Batch payout failed",
          user.preferredLanguage,
          user.displayName,
        );
      }
      await pushService.sendTransactionFailed(transaction.userId, {
        transactionId: transaction.id,
        referenceNumber: transaction.referenceNumber,
        type: "withdraw",
        amount: String(transaction.amount),
        status: "failed",
        error: errorMsg,
      });
      if (!user?.smsOptOut) {
        await smsService.notifyTransactionEvent(phoneNumber, {
          referenceNumber: transaction.referenceNumber || transactionId,
          type: "withdraw",
          amount: String(amount),
          provider,
          kind: "transaction_failed",
          errorMessage: errorMsg,
        });
      }
    }
  } catch (notifyErr) {
    logger.error(`[${transactionId}] Batch notification dispatch error:`, notifyErr);
  }
}

/**
 * Fetch pending withdrawals for a given provider
 */
export async function fetchPendingPayoutsForProvider(
  provider: string,
  limit = BATCH_SIZE,
): Promise<PendingPayout[]> {
  const result = await transactionModel.findByStatusAndProvider(
    TransactionStatus.Pending,
    provider,
    "withdraw",
    limit,
  );

  return result.map((tx) => ({
    transactionId: tx.id,
    phoneNumber: tx.phoneNumber,
    amount: String(tx.amount),
    provider: tx.provider,
  }));
}

/**
 * Process batch payout results and update individual transactions atomically
 */
export async function processBatchPayoutResults(
  results: BatchPayoutResult[],
  payouts: PendingPayout[],
): Promise<void> {
  const resultMap = new Map(results.map((r) => [r.referenceId, r]));

  for (const payout of payouts) {
    const result = resultMap.get(payout.transactionId);

    if (!result || !result.success) {
      const errorMsg = result?.error || "Batch payout submission failed";
      await transactionModel.updateStatus(
        payout.transactionId,
        TransactionStatus.Failed,
      );
      await transactionModel.patchMetadata(payout.transactionId, {
        batchError: errorMsg,
        batchProcessedAt: new Date().toISOString(),
      });
      await notifyTransactionWebhook(
        payout.transactionId,
        "transaction.failed",
        {
          transactionModel,
          webhookService,
        },
      );
      await sendTransactionNotifications(
        payout.transactionId,
        payout.phoneNumber,
        payout.amount,
        payout.provider,
        "failed",
        errorMsg,
      );
      await rabbitMQManager.publish(
        EXCHANGES.TRANSACTIONS,
        ROUTING_KEYS.TRANSACTION_FAILED,
        {
          transactionId: payout.transactionId,
          status: "failed",
          error: errorMsg,
        },
      );
    } else {
      await transactionModel.updateStatus(
        payout.transactionId,
        TransactionStatus.Completed,
      );
      if (result.providerReference) {
        await transactionModel.patchMetadata(payout.transactionId, {
          providerReference: result.providerReference,
          batchProcessedAt: new Date().toISOString(),
        });
      }
      await notifyTransactionWebhook(
        payout.transactionId,
        "transaction.completed",
        {
          transactionModel,
          webhookService,
        },
      );
      await sendTransactionNotifications(
        payout.transactionId,
        payout.phoneNumber,
        payout.amount,
        payout.provider,
        "completed",
      );
      await rabbitMQManager.publish(
        EXCHANGES.TRANSACTIONS,
        ROUTING_KEYS.TRANSACTION_COMPLETED,
        {
          transactionId: payout.transactionId,
          status: "completed",
        },
      );
    }
  }
}

/**
 * Execute a single scheduled payout batch for a provider
 */
export async function executeProviderBatchPayout(
  provider: string,
): Promise<{ success: boolean; totalProcessed: number }> {
  const payouts = await fetchPendingPayoutsForProvider(provider);
  if (payouts.length === 0) {
    return { success: true, totalProcessed: 0 };
  }

  logger.info(
    `[PayoutBatchWorker] Processing ${payouts.length} aggregated payouts for provider ${provider}`,
  );

  const batchItems: BatchPayoutItem[] = payouts.map((p) => ({
    referenceId: p.transactionId,
    phoneNumber: p.phoneNumber,
    amount: p.amount,
  }));

  const startTime = Date.now();
  const result = await mtnMomoProvider.sendBatchPayout(batchItems);
  const durationMs = Date.now() - startTime;

  const successCount = result.results.filter((r) => r.success).length;
  const failureCount = result.results.filter((r) => !r.success).length;

  try {
    batchPayoutTotal.inc({
      provider,
      status: result.success ? "success" : "partial",
    });
    batchPayoutItemsTotal.inc({ provider, status: "success" }, successCount);
    batchPayoutItemsTotal.inc({ provider, status: "failed" }, failureCount);
    batchPayoutDurationSeconds.observe({ provider }, durationMs / 1000);
    batchPayoutSize.observe({ provider }, payouts.length);
  } catch (metricsErr) {
    logger.warn("[PayoutBatchWorker] Failed to record batch metrics", metricsErr);
  }

  await processBatchPayoutResults(result.results, payouts);

  return { success: result.success, totalProcessed: payouts.length };
}

let isRunning = false;
let intervalId: NodeJS.Timeout | null = null;

export async function runPayoutBatchCycle(): Promise<void> {
  if (isRunning) {
    logger.info("[PayoutBatchWorker] Batch cycle already in progress, skipping");
    return;
  }

  isRunning = true;
  try {
    for (const provider of SUPPORTED_PROVIDERS) {
      await executeProviderBatchPayout(provider);
    }
  } catch (error) {
    logger.error("[PayoutBatchWorker] Error running batch payout cycle:", error);
  } finally {
    isRunning = false;
  }
}

export function startPayoutBatchWorker(): void {
  if (intervalId) return;

  logger.info(
    `[PayoutBatchWorker] Starting scheduled payout batch worker (interval: ${BATCH_SCHEDULE_INTERVAL_MS}ms)`,
  );

  runPayoutBatchCycle().catch((err) =>
    logger.error("[PayoutBatchWorker] Error in initial batch execution:", err),
  );

  intervalId = setInterval(() => {
    runPayoutBatchCycle().catch((err) =>
      logger.error("[PayoutBatchWorker] Error in scheduled batch execution:", err),
    );
  }, BATCH_SCHEDULE_INTERVAL_MS);
}

export function stopPayoutBatchWorker(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info("[PayoutBatchWorker] Scheduled payout batch worker stopped");
  }
}

export const payoutBatchWorker = {
  start: startPayoutBatchWorker,
  stop: stopPayoutBatchWorker,
  isRunning: () => isRunning,
  executeProviderBatchPayout,
  runPayoutBatchCycle,
};

import { pool } from "../config/database";
import { TransactionModel, TransactionStatus } from "../models/transaction";
import { MobileMoneyService } from "../services/mobilemoney/mobileMoneyService";
import logger from "../utils/logger";

const transactionModel = new TransactionModel();

/**
 * Stale Transaction Watchdog
 * Schedule: Every hour (0 * * * *)
 *
 * Finds transactions stuck in 'pending' for over STALE_TRANSACTION_HOURS (default: 12).
 * For each stale transaction it calls the provider's Get Status endpoint:
 *   - 'completed' → finalises as completed
 *   - 'failed'/'rejected' → finalises as failed
 *   - 'pending', 'unknown', or an unreachable provider → finalises as
 *     expired (#1793) — the provider never actually reported a failure, so
 *     recording it as Failed would misrepresent it in disputes/refunds/
 *     reporting as an active rejection rather than a timeout with no
 *     infinite pending in DB.
 *
 * Follow-up (out of scope here): TransactionModel.findRefundableFailedPayouts
 * and refundWorker.ts's eligibility check both key on
 * TransactionStatus.Failed only, so a withdrawal that ends up Expired
 * (rather than Failed) via this watchdog won't be auto-queued for refund.
 * Whether an expired withdrawal should be treated the same as a failed one
 * for refund purposes is a product/financial-risk decision, not a pure
 * state-mapping fix — left for a follow-up rather than folded in here.
 */
export async function runStaleTransactionWatchdog(
  service?: InstanceType<typeof MobileMoneyService>,
): Promise<void> {
  const staleHours = parseInt(process.env.STALE_TRANSACTION_HOURS || "12", 10);

  const result = await pool.query<{
    id: string;
    reference_number: string;
    provider: string;
    created_at: Date;
  }>(
    `SELECT id, reference_number, provider, created_at
     FROM transactions
     WHERE status = 'pending'
       AND created_at < NOW() - INTERVAL '${staleHours} hours'
     ORDER BY created_at ASC`,
  );

  if (result.rows.length === 0) {
    logger.info("No stale transactions found");
    return;
  }

  logger.info(
    { count: result.rows.length, thresholdHours: staleHours },
    "Found stale transactions",
  );

  const mobileMoneyService = service ?? new MobileMoneyService();

  let resolved = 0;
  let expired = 0;
  let errors = 0;

  for (const row of result.rows) {
    try {
      // Check transaction status with provider
      const statusResponse = await mobileMoneyService.getTransactionStatus(
        row.provider as any,
        row.reference_number,
      );

      if (statusResponse.success && statusResponse.data) {
        const providerStatus = statusResponse.data.status;

        if (providerStatus === "completed" || providerStatus === "successful") {
          await transactionModel.updateStatus(
            row.id,
            TransactionStatus.Completed,
          );
          logger.info(
            { transactionId: row.id, reference: row.reference_number },
            "Resolved stale transaction as completed",
          );
          resolved++;
        } else if (
          providerStatus === "failed" ||
          providerStatus === "rejected"
        ) {
          await transactionModel.updateStatus(row.id, TransactionStatus.Failed);
          logger.info(
            { transactionId: row.id, reference: row.reference_number },
            "Resolved stale transaction as failed",
          );
          resolved++;
        } else {
          // Still pending or unknown at the provider - expired, not failed:
          // the provider never actually rejected it.
          await transactionModel.updateStatus(row.id, TransactionStatus.Expired);
          logger.warn(
            {
              transactionId: row.id,
              reference: row.reference_number,
              providerStatus,
            },
            "Expired stale transaction (still pending/unknown at provider)",
          );
          expired++;
        }
      } else {
        // Can't verify with provider - expired after stale period (no
        // failure was actually reported, we just couldn't confirm success).
        await transactionModel.updateStatus(row.id, TransactionStatus.Expired);
        logger.warn(
          {
            transactionId: row.id,
            reference: row.reference_number,
            error: statusResponse.error,
          },
          "Expired stale transaction (provider status check failed)",
        );
        expired++;
      }
    } catch (err) {
      logger.error(
        { error: err, transactionId: row.id },
        "Error processing stale transaction",
      );
      errors++;
    }
  }

  logger.info(
    { resolved, expired, errors },
    "Stale transaction watchdog completed",
  );
}

/**
 * Daily Provider Settlement Job
 *
 * Schedule: Daily at 01:00 AM UTC (after cleanup at 2 AM local / after EOD)
 * Cron env: DAILY_SETTLEMENT_CRON (default "0 1 * * *")
 *
 * Calls ProviderReconciliationService.runDailySettlement() which:
 *   - Audits the double-entry ledger for the previous day
 *   - Aggregates merchant fees + provider fees per provider
 *   - Posts immutable double-entry ledger entries for each sweep
 *   - Persists a settlement record for audit tracing
 */

import { providerReconciliationService } from "../services/providerReconciliationService";
import { providerSettlementService } from "../services/providerSettlementService";

export async function runDailySettlementJob(): Promise<void> {
  console.log("[settlement] Daily settlement job triggered");

  const reconciliationSummary =
    await providerReconciliationService.runDailySettlement();

  const reconSettled = reconciliationSummary.providers.filter(
    (p) => p.status === "settled",
  ).length;
  const reconSkipped = reconciliationSummary.providers.filter(
    (p) => p.status === "skipped",
  ).length;
  const reconFailed = reconciliationSummary.providers.filter(
    (p) => p.status === "failed",
  ).length;

  const settlementSummary =
    await providerSettlementService.runDailySettlement();

  const settled = settlementSummary.providers.filter(
    (p) => p.status === "settled",
  ).length;
  const skipped = settlementSummary.providers.filter(
    (p) => p.status === "skipped",
  ).length;
  const failed = settlementSummary.providers.filter(
    (p) => p.status === "failed",
  ).length;

  console.log(
    `[settlement] Summary for ${settlementSummary.settlementDate}: ` +
      `settled=${settled} skipped=${skipped} failed=${failed} ` +
      `merchantFeesSwept=${settlementSummary.totalMerchantFeesSwept.toFixed(2)} ` +
      `providerFeesSettled=${settlementSummary.totalProviderFeesSettled.toFixed(2)} ` +
      `txns=${settlementSummary.totalTransactionsProcessed}`,
  );

  if (settlementSummary.issues.length > 0) {
    console.log(
      `[settlement] Issues encountered (${settlementSummary.issues.length}):`,
    );
    settlementSummary.issues.forEach((issue, i) => {
      console.warn(`[settlement]   ${i + 1}. ${issue}`);
    });
  }

  if (failed > 0) {
    // Throw so the scheduler / cron logs register a job failure and
    // can be alerted via PagerDuty / monitoring.
    throw new Error(
      `[settlement] ${failed} provider(s) failed to settle on ${settlementSummary.settlementDate}. ` +
        `Check provider_settlement_records for details.`,
    );
  }
}

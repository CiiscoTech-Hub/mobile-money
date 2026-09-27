import logger from "../utils/logger";
import {
  getRebalancePaymentService,
  getBalanceTracker,
  onBalanceHook,
  onRebalanceTriggerHook,
} from "../services/stellar/payments";
import type {
  BalanceSnapshot,
  RebalanceTrigger,
} from "../services/stellar/payments";

interface RebalanceJobConfig {
  cronSchedule: string;
  enabled: boolean;
  balancePollingIntervalMs: number;
}

function getRebalanceJobConfig(): RebalanceJobConfig {
  return {
    cronSchedule:
      process.env.REBALANCE_JOB_CRON || "*/5 * * * *",
    enabled: process.env.REBALANCE_JOB_ENABLED !== "false",
    balancePollingIntervalMs: parseInt(
      process.env.REBALANCE_BALANCE_POLL_INTERVAL_MS || "30000",
      10,
    ),
  };
}

function registerBalanceHooks(): () => void {
  const balanceTracker = getBalanceTracker();

  const unsubBalance = balanceTracker.onBalanceHook(
    (snapshot, previous) => {
      logger.info(
        `[rebalance-job] Balance change detected: account=${snapshot.accountPublicKey} asset=${snapshot.asset}:${snapshot.assetIssuer} previous=${previous?.balance ?? "none"} current=${snapshot.balance} delta=${previous ? snapshot.balance - previous.balance : "N/A"}`,
      );
    },
  );

  const unsubTrigger = balanceTracker.onRebalanceTriggerHook(
    async (trigger) => {
      logger.info(
        `[rebalance-job] Float limit breach hook fired: account=${trigger.accountPublicKey} asset=${trigger.asset}:${trigger.assetIssuer} limitType=${trigger.limitType} currentBalance=${trigger.currentBalance} targetBalance=${trigger.targetBalance} deficitOrSurplus=${trigger.deficitOrSurplus}`,
      );
    },
  );

  return () => {
    unsubBalance();
    unsubTrigger();
  };
}

async function runRebalanceJob(): Promise<void> {
  const config = getRebalanceJobConfig();

  if (!config.enabled) {
    console.log(
      "[rebalance-job] Job is disabled via REBALANCE_JOB_ENABLED",
    );
    return;
  }

  console.log(
    `[rebalance-job] Starting rebalance cycle at ${new Date().toISOString()}`,
  );

  const paymentService = getRebalancePaymentService();
  const balanceTracker = getBalanceTracker();

  const unsubHooks = registerBalanceHooks();

  try {
    const results = await paymentService.runRebalanceCycle();

    const successful = results.filter(
      (r) => r.status === "success",
    ).length;
    const failed = results.filter((r) => r.status === "failed").length;
    const skipped = results.filter((r) => r.status === "skipped").length;

    console.log(
      `[rebalance-job] Cycle complete: successful=${successful} failed=${failed} skipped=${skipped} total=${results.length}`,
    );

    for (const result of results) {
      if (result.status === "success" && result.txHash) {
        logger.info(
          `[rebalance-job] Payment executed: txHash=${result.txHash} ledger=${result.ledger} from=${result.fromAccount} to=${result.toAccount} asset=${result.asset} amount=${result.amount}`,
        );
      } else if (result.status === "failed") {
        logger.error(
          `[rebalance-job] Payment failed: from=${result.fromAccount} to=${result.toAccount} asset=${result.asset} amount=${result.amount} error=${result.error}`,
        );
      } else {
        logger.warn(
          `[rebalance-job] Payment skipped: from=${result.fromAccount} to=${result.toAccount} asset=${result.asset} amount=${result.amount}`,
        );
      }
    }
  } catch (error) {
    logger.error(
      "[rebalance-job] Rebalance cycle failed:",
      error instanceof Error ? error : new Error(String(error)),
    );
    throw error;
  } finally {
    unsubHooks();
  }
}

export async function runRebalanceJobHandler(): Promise<void> {
  await runRebalanceJob();
}
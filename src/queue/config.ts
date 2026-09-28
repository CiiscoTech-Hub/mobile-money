import { QueueOptions } from "bullmq";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const url = new URL(redisUrl);

export const connection = {
  host: url.hostname,
  port: parseInt(url.port || "6379", 10),
  username: url.username || undefined,
  password: url.password || undefined,
  tls: url.protocol === "rediss:" ? {} : undefined,
  maxRetriesPerRequest: null,
};

export const queueOptions: QueueOptions = {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 2000, // Start with 2 seconds
    },
    removeOnComplete: {
      age: 86400, // Keep completed jobs for 24 hours
      count: 1000,
    },
    removeOnFail: {
      age: 604800, // Keep failed jobs for 7 days
      count: 5000,
    },
  },
};

// ---------------------------------------------------------------------------
// Telecom Provider Speed & Rate Limit Configurations
// ---------------------------------------------------------------------------
export interface ProviderRateLimit {
  concurrency: number;
  limiter: {
    max: number;
    duration: number;
  };
}

export const telecomProviderLimits: Record<string, ProviderRateLimit> = {
  MTN: { concurrency: 10, limiter: { max: 50, duration: 1000 } },
  AIRTEL: { concurrency: 5, limiter: { max: 20, duration: 1000 } },
  VODAFONE: { concurrency: 8, limiter: { max: 30, duration: 1000 } },
  // Safe default fallback boundary
  DEFAULT: { concurrency: 3, limiter: { max: 10, duration: 1000 } },
};

/**
 * Dynamically resolves rate limits matching a telecom provider's speed capabilities.
 */
export function getTelecomProviderLimits(provider?: string): ProviderRateLimit {
  const activeProvider = (provider || process.env.TELECOM_PROVIDER || "DEFAULT").toUpperCase();
  return telecomProviderLimits[activeProvider] || telecomProviderLimits.DEFAULT;
}

// ---------------------------------------------------------------------------
// Internal helper – parse a positive integer from an env var, returning null
// when the var is absent, empty, or not a valid positive integer.
// ---------------------------------------------------------------------------
function parsePositiveInt(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = parseInt(value, 10);
  return !isNaN(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------------------
// Internal helper – try to read a concurrency value from convict appConfig.
// Returns null on any error so callers can fall through to their defaults.
// ---------------------------------------------------------------------------
function readConvictConcurrency(key: string): number | null {
  try {
    const convictConfig = require("../config/appConfig").default;
    const value = convictConfig.get(key);
    return typeof value === "number" && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Dynamically retrieves the transaction worker concurrency limit.
 *
 * Resolution order (first valid positive integer wins):
 *   1. TRANSACTION_WORKER_CONCURRENCY env var
 *   2. worker.concurrency from convict appConfig / JSON config files
 *   3. Hard-coded production default (50)
 */
export function getWorkerConcurrency(): number {
  return (
    parsePositiveInt(process.env.TRANSACTION_WORKER_CONCURRENCY) ??
    readConvictConcurrency("worker.concurrency") ??
    50
  );
}

/**
 * Dynamically retrieves the accounting sync worker concurrency limit.
 *
 * Resolution order (first valid positive integer wins):
 *   1. SYNC_WORKER_CONCURRENCY env var
 *   2. worker.syncConcurrency from convict appConfig / JSON config files
 *   3. Hard-coded production default (20)
 */
export function getSyncWorkerConcurrency(): number {
  return (
    parsePositiveInt(process.env.SYNC_WORKER_CONCURRENCY) ??
    readConvictConcurrency("worker.syncConcurrency") ??
    20
  );
}

/**
 * Dynamically retrieves the webhook retry worker concurrency limit.
 *
 * Resolution order (first valid positive integer wins):
 *   1. WEBHOOK_RETRY_WORKER_CONCURRENCY env var
 *   2. worker.webhookRetryConcurrency from convict appConfig / JSON config files
 *   3. Hard-coded production default (10)
 */
export function getWebhookRetryWorkerConcurrency(): number {
  return (
    parsePositiveInt(process.env.WEBHOOK_RETRY_WORKER_CONCURRENCY) ??
    readConvictConcurrency("worker.webhookRetryConcurrency") ??
    10
  );
}

/**
 * Dynamically retrieves the accounting retry worker concurrency limit.
 *
 * Resolution order (first valid positive integer wins):
 *   1. ACCOUNTING_RETRY_WORKER_CONCURRENCY env var
 *   2. worker.accountingRetryConcurrency from convict appConfig / JSON config files
 *   3. Hard-coded production default (5)
 */
export function getAccountingRetryWorkerConcurrency(): number {
  return (
    parsePositiveInt(process.env.ACCOUNTING_RETRY_WORKER_CONCURRENCY) ??
    readConvictConcurrency("worker.accountingRetryConcurrency") ??
    5
  );
}

/**
 * Dynamically retrieves the accounting token refresh worker concurrency limit.
 *
 * Resolution order (first valid positive integer wins):
 *   1. ACCOUNTING_TOKEN_REFRESH_WORKER_CONCURRENCY env var
 *   2. worker.accountingTokenRefreshConcurrency from convict appConfig / JSON config files
 *   3. Hard-coded production default (3)
 */
export function getAccountingTokenRefreshWorkerConcurrency(): number {
  return (
    parsePositiveInt(process.env.ACCOUNTING_TOKEN_REFRESH_WORKER_CONCURRENCY) ??
    readConvictConcurrency("worker.accountingTokenRefreshConcurrency") ??
    3
  );
}

/**
 * Dynamically retrieves the provider balance alert worker concurrency limit.
 *
 * This worker intentionally runs sequentially (concurrency = 1) by default to
 * prevent duplicate balance alert notifications.  Override via env var only
 * when you are certain duplicate-suppression logic is in place.
 *
 * Resolution order (first valid positive integer wins):
 *   1. PROVIDER_BALANCE_ALERT_WORKER_CONCURRENCY env var
 *   2. worker.providerBalanceAlertConcurrency from convict appConfig / JSON config files
 *   3. Hard-coded default (1)
 */
export function getProviderBalanceAlertWorkerConcurrency(): number {
  return (
    parsePositiveInt(process.env.PROVIDER_BALANCE_ALERT_WORKER_CONCURRENCY) ??
    readConvictConcurrency("worker.providerBalanceAlertConcurrency") ??
    1
  );
}

/**
 * Dynamically retrieves the failed payout refund worker concurrency limit.
 *
 * Refunds move customer funds, so the worker defaults to low concurrency while
 * still allowing operators to scale once idempotency and monitoring are tuned.
 */
export function getRefundWorkerConcurrency(): number {
  return (
    parsePositiveInt(process.env.REFUND_WORKER_CONCURRENCY) ??
    readConvictConcurrency("worker.refundConcurrency") ??
    2
  );
}
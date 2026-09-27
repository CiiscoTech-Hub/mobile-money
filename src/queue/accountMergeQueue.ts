import { Queue } from "bullmq";
import { queueOptions } from "./config";

export const ACCOUNT_MERGE_QUEUE_NAME = "account-merge";

export interface AccountMergeJobData {
  sourceSecret: string;
  destinationPublicKey: string;
  inactivityDays: number;
  dryRun: boolean;
}

export interface AccountMergeJobResult {
  success: boolean;
  sourcePublicKey: string;
  destinationPublicKey: string;
  reclaimedXLM: string;
  transactionHash?: string;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

export const accountMergeQueue = new Queue<
  AccountMergeJobData,
  AccountMergeJobResult
>(ACCOUNT_MERGE_QUEUE_NAME, {
  ...queueOptions,
  defaultJobOptions: {
    ...queueOptions.defaultJobOptions,
    // Retention: clean up completed/failed job records to bound Redis memory
    removeOnComplete: {
      count: 100,
      age: 7 * 24 * 3600, // 7 days
    },
    removeOnFail: {
      count: 200,
      age: 30 * 24 * 3600, // 30 days
    },
  },
});

export async function addAccountMergeJob(
  data: AccountMergeJobData,
  options?: {
    priority?: number;
    delay?: number;
    jobId?: string;
  },
) {
  const jobId = options?.jobId ?? `account-merge-${Date.now()}`;
  return await accountMergeQueue.add("merge-account", data, {
    jobId,
    priority: options?.priority,
    delay: options?.delay,
  });
}

export async function addBatchAccountMergeJobs(
  jobs: AccountMergeJobData[],
  options?: {
    priority?: number;
  },
) {
  const jobPromises = jobs.map((data, index) =>
    addAccountMergeJob(data, {
      ...options,
      jobId: `account-merge-batch-${Date.now()}-${index}`,
    }),
  );
  return await Promise.all(jobPromises);
}

export async function getAccountMergeJobById(jobId: string) {
  return await accountMergeQueue.getJob(jobId);
}

export async function getAccountMergeQueueStats() {
  const [waiting, active, completed, failed] = await Promise.all([
    accountMergeQueue.getWaitingCount(),
    accountMergeQueue.getActiveCount(),
    accountMergeQueue.getCompletedCount(),
    accountMergeQueue.getFailedCount(),
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    isPaused: await accountMergeQueue.isPaused(),
  };
}

export async function pauseAccountMergeQueue() {
  await accountMergeQueue.pause();
}

export async function resumeAccountMergeQueue() {
  await accountMergeQueue.resume();
}

export async function drainAccountMergeQueue() {
  await accountMergeQueue.drain();
}

export async function closeAccountMergeQueue() {
  await accountMergeQueue.close();
}

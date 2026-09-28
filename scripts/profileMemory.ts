/**
 * Memory profiling script for batch payout workloads.
 *
 * Usage:
 *   # Basic heap snapshot (captures GC state before/after a simulated batch):
 *   node --expose-gc -r tsx/cjs scripts/profileMemory.ts
 *
 *   # With Chrome DevTools inspector (attach devtools to chrome://inspect):
 *   node --inspect --expose-gc -r tsx/cjs scripts/profileMemory.ts
 *
 *   # With built-in CPU profile (writes cpu.cpuprofile alongside heap snapshots):
 *   node --expose-gc --cpu-prof -r tsx/cjs scripts/profileMemory.ts
 *
 * Outputs:
 *   heap-before-<timestamp>.heapsnapshot  — baseline before batch
 *   heap-after-<timestamp>.heapsnapshot   — after batch, before forced GC
 *   heap-gc-<timestamp>.heapsnapshot      — after explicit GC (reveals true leaks)
 *
 * Open .heapsnapshot files in Chrome DevTools → Memory → Load profile.
 * Compare "heap-after" vs "heap-gc" to spot allocations that GC cannot reclaim.
 */

import v8 from "v8";
import fs from "fs";
import path from "path";

declare const gc: (() => void) | undefined;

const BATCH_SIZE = parseInt(process.env.PROFILE_BATCH_SIZE || "1000", 10);
const SNAPSHOT_DIR = process.env.PROFILE_SNAPSHOT_DIR || process.cwd();

function writeSnapshot(label: string): string {
  const timestamp = Date.now();
  const filename = path.join(SNAPSHOT_DIR, `heap-${label}-${timestamp}.heapsnapshot`);
  const snapshot = v8.writeHeapSnapshot(filename);
  console.log(`[profileMemory] Snapshot written: ${snapshot}`);
  return snapshot;
}

function forceGc(): void {
  if (typeof gc !== "function") {
    console.warn(
      "[profileMemory] gc() not available. Re-run with --expose-gc to enable forced GC.",
    );
    return;
  }
  gc();
  console.log("[profileMemory] Forced GC complete.");
}

function memUsageMb(): string {
  const u = process.memoryUsage();
  return (
    `rss=${(u.rss / 1048576).toFixed(1)}MB ` +
    `heapUsed=${(u.heapUsed / 1048576).toFixed(1)}MB ` +
    `heapTotal=${(u.heapTotal / 1048576).toFixed(1)}MB ` +
    `external=${(u.external / 1048576).toFixed(1)}MB`
  );
}

/**
 * Simulates a batch payout workload to surface allocation patterns.
 * Replace the body with actual payout logic (e.g. import and call
 * processBatchPayouts) to profile real code paths.
 */
async function simulateBatchPayout(batchSize: number): Promise<void> {
  const items: Array<{ id: string; amount: number; recipient: string }> = [];

  for (let i = 0; i < batchSize; i++) {
    // Mimic per-item allocation: object + string fields
    items.push({
      id: `payout-${i}-${Math.random().toString(36).slice(2)}`,
      amount: Math.round(Math.random() * 100000) / 100,
      recipient: `+2547${String(i).padStart(8, "0")}`,
    });
  }

  // Simulate async I/O delay per item (replace with actual provider calls)
  await Promise.all(
    items.map(
      (item) =>
        new Promise<void>((resolve) =>
          setImmediate(() => {
            void item; // prevent optimiser from eliminating the allocation
            resolve();
          }),
        ),
    ),
  );
}

async function main(): Promise<void> {
  console.log(`[profileMemory] Starting — batch size: ${BATCH_SIZE}`);
  console.log(`[profileMemory] Initial memory: ${memUsageMb()}`);

  writeSnapshot("before");

  console.log(`[profileMemory] Running simulated batch payout (${BATCH_SIZE} items)…`);
  await simulateBatchPayout(BATCH_SIZE);

  console.log(`[profileMemory] After batch: ${memUsageMb()}`);
  writeSnapshot("after");

  forceGc();
  console.log(`[profileMemory] After GC:    ${memUsageMb()}`);
  writeSnapshot("gc");

  console.log("[profileMemory] Done. Load the .heapsnapshot files in Chrome DevTools.");
  console.log(
    "[profileMemory] Tip: compare heap-after vs heap-gc — objects retained after GC indicate leaks.",
  );
}

main().catch((err) => {
  console.error("[profileMemory] Fatal:", err);
  process.exitCode = 1;
});

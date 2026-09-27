// src/services/stellar/ledgerEventSync.ts
import { getStellarServer } from "../../config/stellar";
import {
  getEventSyncCursor,
  setEventSyncCursor,
  INITIAL_SYNC_CURSOR,
} from "../../database/eventSyncStateRepository";

/**
 * Chunked ledger event sync engine (#1857).
 *
 * Replaces long-lived SSE streams (`cursor=now&limit=200`) with bounded,
 * cursor-checkpointed paging over Horizon:
 *
 *  - Fetches transactions for a contract account in chunks (`chunkSize`,
 *    default 200) in ascending order, following each page's `paging_token`.
 *  - Persists the cursor after every page, so a restart resumes exactly where
 *    the previous run stopped (catch-up after downtime is automatic).
 *  - Detects the ledger tip when a page returns fewer records than the chunk
 *    size, then polls on a fixed interval until new ledgers land.
 *  - Shares one implementation between the escrow event subscriber and the
 *    contract state archiver.
 */

export type LedgerEventHandler = (
  tx: any,
  operation: any,
) => Promise<void> | void;

export interface LedgerEventSyncConfig {
  /** Stellar contract/account address whose transactions are followed. */
  contractId: string;
  /** Stable per-stream key used for cursor persistence in `event_sync_state`. */
  streamKey: string;
  /** Number of transactions per page. Horizon caps this at 200. */
  chunkSize?: number;
  /** How long to wait between tip polls, in milliseconds. */
  pollIntervalMs?: number;
  /**
   * Horizon client. Defaults to the configured Stellar server; injectable for
   * tests.
   */
  horizon?: any;
}

export interface LedgerEventSyncResult {
  /** Number of pages fetched in this pass (0 when already at the tip). */
  pages: number;
  /** Number of transactions processed across all pages. */
  transactions: number;
}

export class LedgerEventSync {
  private readonly contractId: string;
  private readonly streamKey: string;
  private readonly chunkSize: number;
  private readonly pollIntervalMs: number;
  private readonly horizon: any;

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(config: LedgerEventSyncConfig) {
    this.contractId = config.contractId;
    this.streamKey = config.streamKey;
    this.chunkSize = Math.min(Math.max(1, config.chunkSize ?? 200), 200);
    this.pollIntervalMs = config.pollIntervalMs ?? 5000;
    this.horizon = config.horizon ?? getStellarServer();
  }

  /** Runs one chunked catch-up pass. Resolves when the tip is reached. */
  async syncOnce(handler: LedgerEventHandler): Promise<LedgerEventSyncResult> {
    let pages = 0;
    let transactions = 0;
    let cursor =
      (await getEventSyncCursor(this.streamKey)) ?? INITIAL_SYNC_CURSOR;

    while (true) {
      const response = await this.fetchPage(cursor);
      const records = response.records ?? [];

      if (records.length === 0) break;

      for (const tx of records) {
        await this.processTransaction(tx, handler);
        transactions++;
      }

      const lastRecord = records[records.length - 1];
      cursor = lastRecord.paging_token ?? cursor;
      await setEventSyncCursor(this.streamKey, cursor);
      pages++;

      // A short page means we have caught up to the tip of the ledger.
      if (records.length < this.chunkSize) break;
    }

    return { pages, transactions };
  }

  /**
   * Starts the sync loop: an immediate catch-up pass, then polling at the
   * configured interval. Idempotent — calling twice is a no-op.
   */
  start(handler: LedgerEventHandler): void {
    if (this.pollTimer) return;

    this.stopped = false;
    // Kick off immediately; never let a failed pass crash the loop.
    void this.runLoop(handler);

    this.pollTimer = setInterval(() => {
      void this.runLoop(handler);
    }, this.pollIntervalMs);
  }

  /** Stops the polling loop. An in-flight pass is allowed to finish. */
  stop(): void {
    this.stopped = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async runLoop(handler: LedgerEventHandler): Promise<void> {
    if (this.stopped) return;
    try {
      await this.syncOnce(handler);
    } catch (error) {
      console.error(
        `Ledger event sync failed for stream "${this.streamKey}"`,
        error,
      );
    }
  }

  private fetchPage(cursor: string): Promise<any> {
    let call = this.horizon
      .transactions()
      .forAccount(this.contractId)
      .limit(this.chunkSize)
      .order("asc");

    if (cursor && cursor !== INITIAL_SYNC_CURSOR) {
      call = call.cursor(cursor);
    }

    return call.call();
  }

  private async processTransaction(
    tx: any,
    handler: LedgerEventHandler,
  ): Promise<void> {
    const opsResponse = await this.horizon
      .operations()
      .forTransaction(tx.id)
      .call();

    for (const operation of opsResponse.records ?? []) {
      if (operation.type !== "contract_event") continue;
      if (operation.contract !== this.contractId) continue;
      await handler(tx, operation);
    }
  }
}

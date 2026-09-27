import { insertContractStateArchive } from "../../database/contractStateArchiveRepository";
import { LedgerEventSync } from "./ledgerEventSync";

export interface ContractArchiverConfig {
  contractId?: string;
  /** @deprecated SSE streaming was replaced by chunked paging (#1857). */
  streamUrl?: string;
}

export interface ContractStateArchivePayload {
  contractId: string;
  txHash: string;
  ledger: number;
  eventType: string;
  eventName?: string | null;
  eventDetails?: Record<string, any> | null;
  snapshotData?: Record<string, any> | null;
  createdAt?: Date;
}

export class ContractArchiverService {
  private readonly contractId: string;
  private readonly sync: LedgerEventSync;

  constructor(config: ContractArchiverConfig = {}) {
    this.contractId =
      config.contractId || process.env.SOROBAN_CONTRACT_ID || "";
    this.sync = new LedgerEventSync({
      contractId: this.contractId,
      streamKey: `archiver:${this.contractId}`,
    });
  }

  start(): void {
    if (!this.contractId) {
      console.warn(
        "SOROBAN_CONTRACT_ID not set – contract state archiver disabled",
      );
      return;
    }

    this.sync.start(async (tx, operation) => {
      const payload: ContractStateArchivePayload = {
        contractId: this.contractId,
        txHash: tx.hash,
        ledger: tx.ledger_seq,
        eventType: operation.type,
        eventName: operation.value?.type || operation.value?.name || null,
        eventDetails: operation.value?.payload || operation.value || null,
        snapshotData: {
          contract: this.contractId,
          txHash: tx.hash,
          ledger: tx.ledger_seq,
          value: operation.value || {},
        },
        createdAt: new Date(),
      };

      await insertContractStateArchive(payload);
    });
  }

  stop(): void {
    this.sync.stop();
  }
}

export function initializeContractArchiver() {
  const service = new ContractArchiverService();
  service.start();
  return service;
}

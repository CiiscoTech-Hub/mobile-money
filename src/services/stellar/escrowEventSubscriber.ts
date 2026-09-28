// src/services/stellar/escrowEventSubscriber.ts
import { insertEscrowEvent } from "../../database/escrowEventRepository";
import { LedgerEventSync } from "./ledgerEventSync";

interface EscrowEventPayload {
  escrowId: string;
  amount: string;
  asset: string;
  // Add more fields as needed
}

type EscrowEventType = "lock" | "release";

export function startEventSubscription(): LedgerEventSync | null {
  const escrowContractId = process.env.ESCROW_CONTRACT_ID;
  if (!escrowContractId) {
    console.warn(
      "ESCROW_CONTRACT_ID not set – escrow event subscription disabled",
    );
    return null;
  }

  const sync = new LedgerEventSync({
    contractId: escrowContractId,
    streamKey: `escrow:${escrowContractId}`,
  });

  sync.start(async (_tx, operation) => {
    const eventType: EscrowEventType = operation.value?.type;
    if (eventType !== "lock" && eventType !== "release") return;
    const payload: EscrowEventPayload = operation.value?.payload || {};
    await insertEscrowEvent({
      tx_hash: _tx.hash,
      ledger: _tx.ledger_seq,
      event_type: eventType,
      payload,
      created_at: new Date(),
    });
  });

  return sync;
}

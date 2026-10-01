import { startEventSubscription } from "../escrowEventSubscriber";
import { insertEscrowEvent } from "../../../database/escrowEventRepository";
import { LedgerEventSync } from "../ledgerEventSync";

jest.mock("../../../database/escrowEventRepository", () => ({
  insertEscrowEvent: jest.fn(),
}));

jest.mock("../ledgerEventSync", () => ({
  LedgerEventSync: jest.fn().mockImplementation(() => ({
    start: jest.fn((handler: any) => {
      // expose the handler so the test can feed it synthetic operations
      (LedgerEventSync as unknown as any).__lastHandler = handler;
    }),
    stop: jest.fn(),
  })),
}));

const mockInsert = insertEscrowEvent as jest.MockedFunction<
  typeof insertEscrowEvent
>;

const CONTRACT_ID = "CA_ESCROW";

function op(value: any) {
  return { type: "contract_event", contract: CONTRACT_ID, value };
}

describe("escrowEventSubscriber (chunked sync refactor, #1857)", () => {
  const originalEnv = process.env.ESCROW_CONTRACT_ID;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ESCROW_CONTRACT_ID = CONTRACT_ID;
  });

  afterAll(() => {
    if (originalEnv === undefined) {
      delete process.env.ESCROW_CONTRACT_ID;
    } else {
      process.env.ESCROW_CONTRACT_ID = originalEnv;
    }
  });

  it("returns null and warns when ESCROW_CONTRACT_ID is not set", () => {
    delete process.env.ESCROW_CONTRACT_ID;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(startEventSubscription()).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("starts a chunked sync for the escrow contract", () => {
    const sync = startEventSubscription();
    expect(sync).not.toBeNull();
    expect(LedgerEventSync).toHaveBeenCalledWith({
      contractId: CONTRACT_ID,
      streamKey: `escrow:${CONTRACT_ID}`,
    });
  });

  it("persists only lock/release events for the escrow contract", async () => {
    startEventSubscription();
    const handler = (LedgerEventSync as unknown as any).__lastHandler as (
      tx: any,
      operation: any,
    ) => Promise<void>;

    const tx = { hash: "txhash1", ledger_seq: 42 };

    await handler(
      tx,
      op({ type: "lock", payload: { escrowId: "e1", amount: "10" } }),
    );
    await handler(tx, op({ type: "release", payload: { escrowId: "e1" } }));
    // non lock/release event name – ignored
    await handler(tx, op({ type: "transfer" }));

    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(mockInsert).toHaveBeenNthCalledWith(1, {
      tx_hash: "txhash1",
      ledger: 42,
      event_type: "lock",
      payload: { escrowId: "e1", amount: "10" },
      created_at: expect.any(Date),
    });
    expect(mockInsert).toHaveBeenNthCalledWith(2, {
      tx_hash: "txhash1",
      ledger: 42,
      event_type: "release",
      payload: { escrowId: "e1" },
      created_at: expect.any(Date),
    });
  });
});

import { ContractArchiverService } from "../contractArchiver";
import { insertContractStateArchive } from "../../../database/contractStateArchiveRepository";
import { LedgerEventSync } from "../ledgerEventSync";

jest.mock("../../../database/contractStateArchiveRepository", () => ({
  insertContractStateArchive: jest.fn(),
  getContractStateArchiveHistory: jest.fn(),
}));

jest.mock("../ledgerEventSync", () => ({
  LedgerEventSync: jest.fn().mockImplementation(() => ({
    start: jest.fn((handler: any) => {
      (LedgerEventSync as unknown as any).__lastHandler = handler;
    }),
    stop: jest.fn(),
  })),
}));

const mockInsert = insertContractStateArchive as jest.MockedFunction<
  typeof insertContractStateArchive
>;

const CONTRACT_ID = "CA_ARCHIVER";

function op(value: any) {
  return { type: "contract_event", contract: CONTRACT_ID, value };
}

describe("ContractArchiverService (chunked sync refactor, #1857)", () => {
  const originalEnv = process.env.SOROBAN_CONTRACT_ID;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SOROBAN_CONTRACT_ID = CONTRACT_ID;
  });

  afterAll(() => {
    if (originalEnv === undefined) {
      delete process.env.SOROBAN_CONTRACT_ID;
    } else {
      process.env.SOROBAN_CONTRACT_ID = originalEnv;
    }
  });

  it("warns and does not start when no contract id is configured", () => {
    delete process.env.SOROBAN_CONTRACT_ID;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const service = new ContractArchiverService();
    service.start();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("starts a chunked sync for the configured contract", () => {
    const service = new ContractArchiverService();
    service.start();
    expect(LedgerEventSync).toHaveBeenCalledWith({
      contractId: CONTRACT_ID,
      streamKey: `archiver:${CONTRACT_ID}`,
    });
    expect(service.stop).toBeDefined();
  });

  it("archives every contract_event for the watched contract", async () => {
    const service = new ContractArchiverService();
    service.start();
    const handler = (LedgerEventSync as unknown as any).__lastHandler as (
      tx: any,
      operation: any,
    ) => Promise<void>;

    const tx = { hash: "txhash1", ledger_seq: 7 };
    await handler(tx, op({ type: "updated", payload: { counter: 1 } }));
    await handler(tx, op({ type: "updated", payload: { counter: 2 } }));

    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(mockInsert).toHaveBeenNthCalledWith(1, {
      contractId: CONTRACT_ID,
      txHash: "txhash1",
      ledger: 7,
      eventType: "contract_event",
      eventName: "updated",
      eventDetails: { counter: 1 },
      snapshotData: {
        contract: CONTRACT_ID,
        txHash: "txhash1",
        ledger: 7,
        value: { type: "updated", payload: { counter: 1 } },
      },
      createdAt: expect.any(Date),
    });
  });
});

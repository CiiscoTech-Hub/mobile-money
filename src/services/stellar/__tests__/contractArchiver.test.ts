import { pool } from "../../../config/database";
import {
  getContractStateArchiveHistory,
  insertContractStateArchive,
} from "../../../database/contractStateArchiveRepository";

jest.mock("../../../config/database", () => ({
  pool: {
    query: jest.fn(),
  },
}));

describe("contract state archive repository", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("persists contract state snapshots and returns them safely for recovery", async () => {
    const mockedPool = pool as jest.Mocked<typeof pool>;

    mockedPool.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [] } as any)
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 42,
            contract_id: "CA_TEST",
            tx_hash: "tx123",
            ledger: 99,
            event_type: "contract_event",
            event_name: "updated",
            event_details: { type: "updated", counter: 2 },
            snapshot_data: { state: "archived", counter: 2 },
            created_at: "2026-07-24T12:00:00.000Z",
          },
        ],
      } as any);

    await expect(
      insertContractStateArchive({
        contractId: "CA_TEST",
        txHash: "tx123",
        ledger: 99,
        eventType: "contract_event",
        eventName: "updated",
        eventDetails: { type: "updated", counter: 2 },
        snapshotData: { state: "archived", counter: 2 },
        createdAt: new Date("2026-07-24T12:00:00.000Z"),
      }),
    ).resolves.toBeDefined();

    const history = await getContractStateArchiveHistory("CA_TEST", 5);

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      contractId: "CA_TEST",
      txHash: "tx123",
      eventName: "updated",
      eventDetails: { type: "updated", counter: 2 },
      snapshotData: { state: "archived", counter: 2 },
    });
  });
});

import { LedgerEventSync } from "../ledgerEventSync";
import {
  getEventSyncCursor,
  setEventSyncCursor,
  INITIAL_SYNC_CURSOR,
} from "../../../database/eventSyncStateRepository";

jest.mock("../../../database/eventSyncStateRepository", () => ({
  getEventSyncCursor: jest.fn(),
  setEventSyncCursor: jest.fn(),
  INITIAL_SYNC_CURSOR: "now",
}));

const mockGetCursor = getEventSyncCursor as jest.MockedFunction<
  typeof getEventSyncCursor
>;
const mockSetCursor = setEventSyncCursor as jest.MockedFunction<
  typeof setEventSyncCursor
>;

const CONTRACT_ID = "CA_TEST_CONTRACT";
const STREAM_KEY = `escrow:${CONTRACT_ID}`;

/** Builds a fake Horizon server that pages over canned transaction records. */
function createFakeHorizon(
  pages: any[][],
  operationsByTxId: Record<string, any[]> = {},
): any {
  let pageIndex = 0;
  let pageCalls = 0;
  const limit = jest.fn(() => ({
    order: jest.fn(() => ({
      cursor: jest.fn(() => ({ call: nextPage })),
      call: nextPage,
    })),
  }));
  const forAccount = jest.fn(() => ({ limit }));
  const forTransaction = jest.fn((txId: string) => ({
    call: jest.fn(async () => ({
      records: operationsByTxId[txId] ?? [],
    })),
  }));

  async function nextPage() {
    pageCalls++;
    const records = pages[pageIndex] ?? [];
    // advance while more canned pages remain; otherwise re-serve the current
    // page so subsequent polls keep delivering records (new-ledger simulation)
    if (pageIndex < pages.length - 1) pageIndex++;
    return { records };
  }

  return {
    transactions: jest.fn(() => ({ forAccount })),
    operations: jest.fn(() => ({ forTransaction })),
    mocks: { forAccount, limit, forTransaction },
    pageIndex: () => pageIndex,
    pageCalls: () => pageCalls,
  };
}

/** Flushes all pending microtasks (and any queued timer callbacks). */
async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

function makeTx(id: string, pagingToken: string, ledgerSeq: number) {
  return {
    id,
    hash: `hash_${id}`,
    paging_token: pagingToken,
    ledger_seq: ledgerSeq,
  };
}

function makeEventOp(contract: string, value?: any, type = "contract_event") {
  return { type, contract, value: value ?? { type: "updated" } };
}

describe("LedgerEventSync (chunked paging, #1857)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("pages through full chunks until the tip, persisting the cursor after each page", async () => {
    const tx1 = makeTx("tx1", "100-1", 100);
    const tx2 = makeTx("tx2", "100-2", 100);
    const tx3 = makeTx("tx3", "101-1", 101);

    const horizon = createFakeHorizon(
      [
        [tx1, tx2], // full page (chunkSize 2)
        [tx3], // short page -> tip
      ],
      { tx1: [], tx2: [], tx3: [] },
    );

    mockGetCursor.mockResolvedValueOnce("50-1");
    mockSetCursor.mockResolvedValue();

    const sync = new LedgerEventSync({
      contractId: CONTRACT_ID,
      streamKey: STREAM_KEY,
      chunkSize: 2,
      horizon,
    });

    const handler = jest.fn();
    const result = await sync.syncOnce(handler);

    expect(result).toEqual({ pages: 2, transactions: 3 });
    // resumes from the persisted cursor on the first page
    expect(mockSetCursor).toHaveBeenNthCalledWith(1, STREAM_KEY, "100-2");
    expect(mockSetCursor).toHaveBeenNthCalledWith(2, STREAM_KEY, "101-1");
    expect(horizon.pageCalls()).toBe(2);
  });

  it("uses the initial 'now' cursor when no cursor is persisted", async () => {
    const tx1 = makeTx("tx1", "500-1", 500);
    const horizon = createFakeHorizon([[tx1]]);

    mockGetCursor.mockResolvedValueOnce(null);
    mockSetCursor.mockResolvedValue();

    const sync = new LedgerEventSync({
      contractId: CONTRACT_ID,
      streamKey: STREAM_KEY,
      chunkSize: 200,
      horizon,
    });

    await sync.syncOnce(jest.fn());

    expect(mockGetCursor).toHaveBeenCalledWith(STREAM_KEY);
    expect(mockSetCursor).toHaveBeenCalledWith(STREAM_KEY, "500-1");
  });

  it("delivers only contract_event operations for the watched contract", async () => {
    const tx1 = makeTx("tx1", "10-1", 10);
    const matching = makeEventOp(CONTRACT_ID, {
      type: "lock",
      payload: { escrowId: "e1" },
    });
    // contract_event emitted by a different contract – must be skipped
    const otherContract = makeEventOp("CA_OTHER", { type: "lock" });
    // non-contract_event operation – must be skipped
    const nonEvent = makeEventOp(CONTRACT_ID, { type: "lock" }, "payment");

    const horizon = createFakeHorizon([[tx1]], {
      tx1: [matching, otherContract, nonEvent],
    });

    mockGetCursor.mockResolvedValueOnce(null);
    mockSetCursor.mockResolvedValue();

    const sync = new LedgerEventSync({
      contractId: CONTRACT_ID,
      streamKey: STREAM_KEY,
      chunkSize: 200,
      horizon,
    });

    const handler = jest.fn();
    await sync.syncOnce(handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(tx1, matching);
  });

  it("reports zero pages when already at the tip", async () => {
    const horizon = createFakeHorizon([[]]);
    mockGetCursor.mockResolvedValueOnce("900-1");
    mockSetCursor.mockResolvedValue();

    const sync = new LedgerEventSync({
      contractId: CONTRACT_ID,
      streamKey: STREAM_KEY,
      chunkSize: 200,
      horizon,
    });

    const result = await sync.syncOnce(jest.fn());

    expect(result).toEqual({ pages: 0, transactions: 0 });
    expect(mockSetCursor).not.toHaveBeenCalled();
  });

  it("clamps chunk sizes to Horizon's 200-record cap", async () => {
    const tx1 = makeTx("tx1", "1-1", 1);
    const horizon = createFakeHorizon([[tx1]]);
    mockGetCursor.mockResolvedValueOnce(null);
    mockSetCursor.mockResolvedValue();

    const sync = new LedgerEventSync({
      contractId: CONTRACT_ID,
      streamKey: STREAM_KEY,
      chunkSize: 9999,
      horizon,
    });

    await sync.syncOnce(jest.fn());

    expect(horizon.mocks.limit).toHaveBeenCalledWith(200);
    expect(horizon.mocks.limit).not.toHaveBeenCalledWith(9999);
  });

  it("start() polls on the configured interval and stop() clears it", async () => {
    jest.useFakeTimers();

    const tx1 = makeTx("tx1", "1-1", 1);
    const event = makeEventOp(CONTRACT_ID, { type: "lock" });
    const horizon = createFakeHorizon([[tx1]], { tx1: [event] });
    mockGetCursor.mockResolvedValue(null);
    mockSetCursor.mockResolvedValue();

    const sync = new LedgerEventSync({
      contractId: CONTRACT_ID,
      streamKey: STREAM_KEY,
      chunkSize: 200,
      pollIntervalMs: 10_000,
      horizon,
    });

    const handler = jest.fn();
    sync.start(handler);

    // first pass runs immediately
    await jest.advanceTimersByTimeAsync(0);
    expect(handler).toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(10_000);
    // the interval callback is fire-and-forget; flush its async pass
    await jest.advanceTimersByTimeAsync(0);
    expect(handler.mock.calls.length).toBeGreaterThanOrEqual(2);

    sync.stop();
    const callsAfterStop = handler.mock.calls.length;
    await jest.advanceTimersByTimeAsync(30_000);
    await jest.advanceTimersByTimeAsync(0);
    expect(handler.mock.calls.length).toBe(callsAfterStop);

    jest.useRealTimers();
  });

  it("keeps polling after a handler throws instead of crashing the loop", async () => {
    jest.useFakeTimers();

    const tx1 = makeTx("tx1", "1-1", 1);
    const event = makeEventOp(CONTRACT_ID, { type: "lock" });
    const horizon = createFakeHorizon([[tx1]], { tx1: [event] });
    mockGetCursor.mockResolvedValue(null);
    mockSetCursor.mockResolvedValue();

    const sync = new LedgerEventSync({
      contractId: CONTRACT_ID,
      streamKey: STREAM_KEY,
      chunkSize: 200,
      pollIntervalMs: 10_000,
      horizon,
    });

    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const handler = jest.fn().mockRejectedValue(new Error("boom"));

    sync.start(handler);
    await jest.advanceTimersByTimeAsync(0);

    expect(consoleSpy).toHaveBeenCalled();

    // loop still alive for the next poll
    const callsBeforePoll = handler.mock.calls.length;
    await jest.advanceTimersByTimeAsync(10_000);
    await jest.advanceTimersByTimeAsync(0);
    expect(handler.mock.calls.length).toBeGreaterThan(callsBeforePoll);

    sync.stop();
    consoleSpy.mockRestore();
    jest.useRealTimers();
  });
});

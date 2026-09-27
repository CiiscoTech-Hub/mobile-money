import {
  fetchPendingTransactions,
  reconcilePendingTransactions,
  PendingTransaction,
} from "../providers/mtnMomo";
import { queryRead, queryWrite } from "../../config/database";
import { MTNProvider } from "../mobilemoney/providers/mtn";
import { TransactionStatus } from "../../models/transaction";

// ── mocks ─────────────────────────────────────────────────────────────────────
jest.mock("../../config/database");
jest.mock("../mobilemoney/providers/mtn");

const mockQueryRead = queryRead as jest.MockedFunction<typeof queryRead>;
const mockQueryWrite = queryWrite as jest.MockedFunction<typeof queryWrite>;
const MockMTNProvider = MTNProvider as jest.MockedClass<typeof MTNProvider>;

// ── helpers ───────────────────────────────────────────────────────────────────
function makePending(overrides: Partial<PendingTransaction> = {}): PendingTransaction {
  return {
    id: "tx-001",
    referenceNumber: "REF-001",
    providerReference: "prov-ref-001",
    phoneNumber: "+237600000001",
    amount: "5000",
    status: TransactionStatus.Pending,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

// ── fetchPendingTransactions ──────────────────────────────────────────────────
describe("fetchPendingTransactions", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns rows from queryRead", async () => {
    const rows = [makePending(), makePending({ id: "tx-002", referenceNumber: "REF-002" })];
    mockQueryRead.mockResolvedValueOnce({ rows } as any);

    const result = await fetchPendingTransactions();

    expect(result).toEqual(rows);
    expect(mockQueryRead).toHaveBeenCalledTimes(1);
    expect(mockQueryRead).toHaveBeenCalledWith(
      expect.stringContaining("status = $1"),
      [TransactionStatus.Pending],
    );
  });

  it("queries only pending MTN transactions", async () => {
    mockQueryRead.mockResolvedValueOnce({ rows: [] } as any);

    await fetchPendingTransactions();

    const [sql, params] = mockQueryRead.mock.calls[0];
    expect(sql).toMatch(/provider ILIKE 'mtn%'/i);
    expect(params).toContain(TransactionStatus.Pending);
  });

  it("returns empty array when no pending transactions exist", async () => {
    mockQueryRead.mockResolvedValueOnce({ rows: [] } as any);

    const result = await fetchPendingTransactions();

    expect(result).toEqual([]);
  });
});

// ── reconcilePendingTransactions ──────────────────────────────────────────────
describe("reconcilePendingTransactions", () => {
  let mockGetTransactionStatus: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTransactionStatus = jest.fn();
    MockMTNProvider.mockImplementation(() => ({
      getTransactionStatus: mockGetTransactionStatus,
    } as any));
  });

  it("returns zero updates when no pending transactions exist", async () => {
    mockQueryRead.mockResolvedValueOnce({ rows: [] } as any);

    const report = await reconcilePendingTransactions();

    expect(report.total).toBe(0);
    expect(report.updated).toBe(0);
    expect(report.results).toEqual([]);
    expect(mockQueryWrite).not.toHaveBeenCalled();
  });

  it("updates status to completed when provider reports SUCCESSFUL", async () => {
    const tx = makePending();
    mockQueryRead.mockResolvedValueOnce({ rows: [tx] } as any);
    mockGetTransactionStatus.mockResolvedValueOnce({ status: "completed" });
    mockQueryWrite.mockResolvedValueOnce({ rows: [] } as any);

    const report = await reconcilePendingTransactions();

    expect(report.total).toBe(1);
    expect(report.updated).toBe(1);
    expect(report.results[0].updated).toBe(true);
    expect(report.results[0].newStatus).toBe(TransactionStatus.Completed);
    expect(mockQueryWrite).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE transactions"),
      [TransactionStatus.Completed, tx.id],
    );
  });

  it("updates status to failed when provider reports FAILED", async () => {
    const tx = makePending();
    mockQueryRead.mockResolvedValueOnce({ rows: [tx] } as any);
    mockGetTransactionStatus.mockResolvedValueOnce({ status: "failed" });
    mockQueryWrite.mockResolvedValueOnce({ rows: [] } as any);

    const report = await reconcilePendingTransactions();

    expect(report.results[0].newStatus).toBe(TransactionStatus.Failed);
    expect(report.updated).toBe(1);
  });

  it("does not write when provider still reports pending", async () => {
    const tx = makePending();
    mockQueryRead.mockResolvedValueOnce({ rows: [tx] } as any);
    mockGetTransactionStatus.mockResolvedValueOnce({ status: "pending" });

    const report = await reconcilePendingTransactions();

    expect(report.updated).toBe(0);
    expect(report.results[0].updated).toBe(false);
    expect(report.results[0].newStatus).toBeNull();
    expect(mockQueryWrite).not.toHaveBeenCalled();
  });

  it("does not write when provider returns unknown status", async () => {
    const tx = makePending();
    mockQueryRead.mockResolvedValueOnce({ rows: [tx] } as any);
    mockGetTransactionStatus.mockResolvedValueOnce({ status: "unknown" });

    const report = await reconcilePendingTransactions();

    expect(report.updated).toBe(0);
    expect(mockQueryWrite).not.toHaveBeenCalled();
  });

  it("falls back to referenceNumber when providerReference is null", async () => {
    const tx = makePending({ providerReference: null });
    mockQueryRead.mockResolvedValueOnce({ rows: [tx] } as any);
    mockGetTransactionStatus.mockResolvedValueOnce({ status: "completed" });
    mockQueryWrite.mockResolvedValueOnce({ rows: [] } as any);

    await reconcilePendingTransactions();

    expect(mockGetTransactionStatus).toHaveBeenCalledWith(tx.referenceNumber);
  });

  it("uses providerReference when available", async () => {
    const tx = makePending({ providerReference: "prov-xyz" });
    mockQueryRead.mockResolvedValueOnce({ rows: [tx] } as any);
    mockGetTransactionStatus.mockResolvedValueOnce({ status: "completed" });
    mockQueryWrite.mockResolvedValueOnce({ rows: [] } as any);

    await reconcilePendingTransactions();

    expect(mockGetTransactionStatus).toHaveBeenCalledWith("prov-xyz");
  });

  it("continues processing remaining transactions if one provider query throws", async () => {
    const tx1 = makePending({ id: "tx-001", referenceNumber: "REF-001" });
    const tx2 = makePending({ id: "tx-002", referenceNumber: "REF-002" });
    mockQueryRead.mockResolvedValueOnce({ rows: [tx1, tx2] } as any);

    mockGetTransactionStatus
      .mockRejectedValueOnce(new Error("network timeout"))
      .mockResolvedValueOnce({ status: "completed" });
    mockQueryWrite.mockResolvedValueOnce({ rows: [] } as any);

    const report = await reconcilePendingTransactions();

    expect(report.total).toBe(2);
    // tx1 errored → not updated; tx2 succeeded → updated
    expect(report.updated).toBe(1);
    expect(report.results[0].updated).toBe(false);
    expect(report.results[1].updated).toBe(true);
  });

  it("counts updated vs not-updated correctly across a mixed batch", async () => {
    const txs = [
      makePending({ id: "a", referenceNumber: "R-A" }),
      makePending({ id: "b", referenceNumber: "R-B" }),
      makePending({ id: "c", referenceNumber: "R-C" }),
    ];
    mockQueryRead.mockResolvedValueOnce({ rows: txs } as any);

    mockGetTransactionStatus
      .mockResolvedValueOnce({ status: "completed" })
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({ status: "failed" });

    mockQueryWrite.mockResolvedValue({ rows: [] } as any);

    const report = await reconcilePendingTransactions();

    expect(report.total).toBe(3);
    expect(report.updated).toBe(2); // a=completed, c=failed
    expect(report.results.filter((r) => r.updated)).toHaveLength(2);
  });
});

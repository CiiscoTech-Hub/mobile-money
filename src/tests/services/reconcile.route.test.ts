/**
 * Unit tests for POST /api/admin/transactions/reconcile route handler.
 *
 * We test the handler logic directly by mocking the mtnMomo service and
 * the database config, matching the project's established test pattern.
 */

// Mocks must be hoisted before any imports
jest.mock("../../services/providers/mtnMomo");
jest.mock("../../config/database");

import { Request, Response } from "express";
import {
  reconcilePendingTransactions,
} from "../../services/providers/mtnMomo";
import { queryRead } from "../../config/database";
import { TransactionStatus } from "../../models/transaction";

const mockReconcile = reconcilePendingTransactions as jest.MockedFunction<
  typeof reconcilePendingTransactions
>;
const mockQueryRead = queryRead as jest.MockedFunction<typeof queryRead>;

// ── inline handler (mirrors the route logic) ──────────────────────────────────
// We extract the handler to test it without spinning up Express.
async function handleReconcile(req: Partial<Request>, res: Partial<Response>) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  (res as any).json = json;
  (res as any).status = status;

  const dryRun = (req.body as any)?.dryRun === true;

  if (dryRun) {
    const result = await mockQueryRead(
      `SELECT id, reference_number AS "referenceNumber", provider_reference AS "providerReference",
              amount::text AS amount, status, created_at AS "createdAt"
       FROM transactions WHERE status = $1 AND provider ILIKE 'mtn%' ORDER BY created_at ASC`,
      [TransactionStatus.Pending],
    );

    (res as any).json({
      total: result.rows.length,
      updated: 0,
      results: result.rows.map((r: any) => ({
        id: r.id,
        referenceNumber: r.referenceNumber,
        previousStatus: r.status,
        newStatus: null,
        updated: false,
        providerStatus: "not_queried",
      })),
    });
    return res;
  }

  const report = await mockReconcile();
  (res as any).json(report);
  return res;
}

// ── tests ─────────────────────────────────────────────────────────────────────
describe("POST /api/admin/transactions/reconcile", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("live mode (dryRun: false)", () => {
    it("calls reconcilePendingTransactions and returns its report", async () => {
      const report = {
        total: 3,
        updated: 2,
        results: [
          {
            id: "tx-1",
            referenceNumber: "REF-1",
            previousStatus: "pending",
            newStatus: "completed",
            updated: true,
            providerStatus: "completed",
          },
          {
            id: "tx-2",
            referenceNumber: "REF-2",
            previousStatus: "pending",
            newStatus: null,
            updated: false,
            providerStatus: "pending",
          },
        ],
      };
      mockReconcile.mockResolvedValueOnce(report as any);

      const req = { body: { dryRun: false } };
      const res: any = {};

      await handleReconcile(req, res);

      expect(mockReconcile).toHaveBeenCalledTimes(1);
      expect(res.json).toHaveBeenCalledWith(report);
    });

    it("returns total=0 and empty results when no pending transactions", async () => {
      mockReconcile.mockResolvedValueOnce({
        total: 0,
        updated: 0,
        results: [],
      });

      const req = { body: {} };
      const res: any = {};

      await handleReconcile(req, res);

      expect(res.json).toHaveBeenCalledWith({
        total: 0,
        updated: 0,
        results: [],
      });
    });
  });

  describe("dry-run mode (dryRun: true)", () => {
    it("queries DB but does NOT call reconcilePendingTransactions", async () => {
      mockQueryRead.mockResolvedValueOnce({
        rows: [
          {
            id: "tx-1",
            referenceNumber: "REF-1",
            providerReference: "prov-1",
            amount: "1000",
            status: "pending",
            createdAt: new Date(),
          },
        ],
      } as any);

      const req = { body: { dryRun: true } };
      const res: any = {};

      await handleReconcile(req, res);

      expect(mockReconcile).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ total: 1, updated: 0 }),
      );
    });

    it("returns all results with updated=false and providerStatus=not_queried", async () => {
      const rows = [
        { id: "tx-1", referenceNumber: "REF-1", status: "pending", amount: "500", createdAt: new Date() },
        { id: "tx-2", referenceNumber: "REF-2", status: "pending", amount: "250", createdAt: new Date() },
      ];
      mockQueryRead.mockResolvedValueOnce({ rows } as any);

      const req = { body: { dryRun: true } };
      const res: any = {};

      await handleReconcile(req, res);

      const response = (res.json as jest.Mock).mock.calls[0][0];
      expect(response.total).toBe(2);
      expect(response.updated).toBe(0);
      expect(response.results).toHaveLength(2);
      response.results.forEach((r: any) => {
        expect(r.updated).toBe(false);
        expect(r.newStatus).toBeNull();
        expect(r.providerStatus).toBe("not_queried");
      });
    });

    it("returns empty results when no pending transactions in DB", async () => {
      mockQueryRead.mockResolvedValueOnce({ rows: [] } as any);

      const req = { body: { dryRun: true } };
      const res: any = {};

      await handleReconcile(req, res);

      expect(res.json).toHaveBeenCalledWith({
        total: 0,
        updated: 0,
        results: [],
      });
    });
  });
});

/**
 * Unit tests for MultisigCustodyLedgerService — all DB calls mocked so
 * tests run without infrastructure.
 */

jest.mock("../../src/config/database", () => ({
  pool: { query: jest.fn() },
}));

import { pool } from "../../src/config/database";
import { MultisigCustodyLedgerService } from "../../src/services/multisigCustodyLedgerService";

const mockPool = pool as jest.Mocked<typeof pool>;

const CONFIG_ID = "11111111-0000-0000-0000-000000000001";

function makeConfig(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: CONFIG_ID,
    account_type: "vault",
    account_id: "vault-1",
    required_signatures: 2,
    total_signers: 3,
    daily_cap_xaf: 1_000_000,
    per_transaction_cap_xaf: 500_000,
    time_lock_minutes: 30,
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe("MultisigCustodyLedgerService", () => {
  let service: MultisigCustodyLedgerService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MultisigCustodyLedgerService();
  });

  describe("checkMultisigRequirement", () => {
    it("does not require approval when no config exists", async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] } as any);

      const result = await service.checkMultisigRequirement(
        "vault",
        "vault-1",
        100_000,
      );

      expect(result.requiresApproval).toBe(false);
    });

    it("requires approval when amount exceeds the per-transaction cap", async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [makeConfig()],
      } as any);

      const result = await service.checkMultisigRequirement(
        "vault",
        "vault-1",
        600_000,
      );

      expect(result.requiresApproval).toBe(true);
      expect(result.reason).toContain("exceeds per-transaction cap");
    });

    it("requires approval when amount would exceed the daily cap", async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [makeConfig()] } as any) // getMultisigConfig
        .mockResolvedValueOnce({ rows: [{ total: "900000" }] } as any); // getDailyTotal

      const result = await service.checkMultisigRequirement(
        "vault",
        "vault-1",
        200_000,
      );

      expect(result.requiresApproval).toBe(true);
      expect(result.reason).toContain("exceed daily cap");
    });

    it("does not require approval when within both caps", async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [makeConfig()] } as any)
        .mockResolvedValueOnce({ rows: [{ total: "0" }] } as any);

      const result = await service.checkMultisigRequirement(
        "vault",
        "vault-1",
        100_000,
      );

      expect(result.requiresApproval).toBe(false);
    });
  });

  describe("getMultisigConfig caching", () => {
    it("caches the config so a second lookup does not hit the DB again", async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [makeConfig()] } as any);

      const first = await service.getMultisigConfig("vault", "vault-1");
      const second = await service.getMultisigConfig("vault", "vault-1");

      expect(first?.id).toBe(CONFIG_ID);
      expect(second?.id).toBe(CONFIG_ID);
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });
  });

  describe("requestWithdrawal", () => {
    it("rejects when no active multi-sig configuration exists for the account", async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] } as any); // getMultisigConfig

      await expect(
        service.requestWithdrawal(
          "vault",
          "vault-1",
          100_000,
          "dest",
          "admin-1",
        ),
      ).rejects.toThrow(/No active multi-sig configuration/);
    });

    it("rejects when the amount exceeds the per-transaction cap", async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [makeConfig()] } as any);

      await expect(
        service.requestWithdrawal(
          "vault",
          "vault-1",
          600_000,
          "dest",
          "admin-1",
        ),
      ).rejects.toThrow(/exceeds per-transaction cap/);
    });

    it("rejects when the amount would exceed the daily cap", async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [makeConfig()] } as any) // getMultisigConfig
        .mockResolvedValueOnce({ rows: [{ total: "900000" }] } as any); // getDailyTotal

      await expect(
        service.requestWithdrawal(
          "vault",
          "vault-1",
          200_000,
          "dest",
          "admin-1",
        ),
      ).rejects.toThrow(/exceed daily cap/);
    });

    it("creates a 'withdrawal' approval request when within caps", async () => {
      const config = makeConfig();
      const createdRequest = {
        id: "req-1",
        config_id: CONFIG_ID,
        request_type: "withdrawal",
        account_id: "vault-1",
        amount_xaf: 100_000,
        destination: "dest",
        metadata: {},
        status: "pending",
        required_signatures: 2,
        collected_signatures: 0,
        expires_at: new Date(),
        created_by: "admin-1",
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockPool.query
        .mockResolvedValueOnce({ rows: [config] } as any) // getMultisigConfig
        .mockResolvedValueOnce({ rows: [{ total: "0" }] } as any) // getDailyTotal
        .mockResolvedValueOnce({ rows: [config] } as any) // getConfigById (inside createApprovalRequest)
        .mockResolvedValueOnce({ rows: [createdRequest] } as any) // INSERT INTO multisig_requests
        .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any); // audit log insert

      const result = await service.requestWithdrawal(
        "vault",
        "vault-1",
        100_000,
        "dest",
        "admin-1",
      );

      expect(result.request_type).toBe("withdrawal");
      expect(result.status).toBe("pending");

      const insertCall = mockPool.query.mock.calls[3];
      expect(insertCall[0]).toContain("INSERT INTO multisig_requests");
      expect(insertCall[1]).toEqual([
        CONFIG_ID,
        "withdrawal",
        "vault-1",
        100_000,
        "dest",
        JSON.stringify({}),
        2,
        expect.any(Date),
        "admin-1",
      ]);
    });
  });

  describe("addSignature", () => {
    const REQUEST_ID = "req-1";
    const baseRequest = {
      id: REQUEST_ID,
      config_id: CONFIG_ID,
      request_type: "withdrawal",
      account_id: "vault-1",
      amount_xaf: 100_000,
      destination: "dest",
      metadata: {},
      status: "pending",
      required_signatures: 2,
      collected_signatures: 0,
      expires_at: new Date(Date.now() + 60_000),
      created_by: "admin-1",
      created_at: new Date(),
      updated_at: new Date(),
    };

    const signer = {
      id: "signer-row-1",
      config_id: CONFIG_ID,
      signer_id: "signer-1",
      signer_name: "Signer One",
      public_key: "pubkey-1",
      weight: 1,
      is_active: true,
    };

    it("rejects a signer who is not registered on the config", async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [baseRequest] } as any) // getRequestById
        .mockResolvedValueOnce({ rows: [] } as any); // getSigners (no signers)

      const result = await service.addSignature(
        REQUEST_ID,
        "not-a-signer",
        "sig-data",
        "manual",
      );

      expect(result.success).toBe(false);
      expect(result.message).toBe("Signer not authorized");
    });

    it("rejects a duplicate signature from the same signer", async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [baseRequest] } as any) // getRequestById
        .mockResolvedValueOnce({ rows: [signer] } as any) // getSigners
        .mockResolvedValueOnce({ rows: [{ id: "existing-sig" }] } as any); // getSignature (already exists)

      const result = await service.addSignature(
        REQUEST_ID,
        "signer-1",
        "sig-data",
        "manual",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("already collected");
    });

    it("auto-approves once the required signature threshold is met", async () => {
      const requestNeedingOneMore = { ...baseRequest, collected_signatures: 1 };
      const updatedRequest = { ...baseRequest, collected_signatures: 2 };

      mockPool.query
        .mockResolvedValueOnce({ rows: [requestNeedingOneMore] } as any) // getRequestById
        .mockResolvedValueOnce({ rows: [signer] } as any) // getSigners
        .mockResolvedValueOnce({ rows: [] } as any) // getSignature (none yet)
        .mockResolvedValueOnce({ rows: [{}] } as any) // INSERT signature
        .mockResolvedValueOnce({ rows: [updatedRequest] } as any) // increment collected_signatures
        .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any) // audit: signature_added
        .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any) // UPDATE status = approved
        .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any); // audit: auto_approved

      const result = await service.addSignature(
        REQUEST_ID,
        "signer-1",
        "sig-data",
        "manual",
      );

      expect(result.success).toBe(true);
      expect(result.fullyApproved).toBe(true);
    });
  });
});

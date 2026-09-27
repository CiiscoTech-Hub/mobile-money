/**
 * UserProfileService — Unit Tests
 *
 * Covers:
 *  - getProfile: aggregates user base fields, preferences, and extended profile
 *  - updateProfile: name/avatar update with validation
 *  - Notification Preferences: fetching defaults, merging updates
 *  - Stellar address: linking and unlinking
 *  - Activity summary: calculating totals
 */

import { UserProfileService } from "../userProfileService";
import { pool } from "../../config/database";
import * as userService from "../userService";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("../../config/database", () => ({
  pool: {
    query: jest.fn(),
  },
}));

jest.mock("../userService", () => ({
  getUserById: jest.fn(),
  updateUserById: jest.fn(),
  exportUserData: jest.fn(),
}));

jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}));

const MockPool = pool as jest.Mocked<typeof pool>;
const mockGetUserById = userService.getUserById as jest.Mock;
const mockUpdateUserById = userService.updateUserById as jest.Mock;

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockUserRow(overrides: Partial<any> = {}) {
  return {
    id: "user-1",
    phone_number: "+1234567890",
    kyc_level: "verified",
    role_name: "user",
    display_name: "Alice",
    two_factor_enabled: false,
    created_at: new Date("2023-01-01"),
    updated_at: new Date("2023-01-01"),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("UserProfileService", () => {
  let svc: UserProfileService;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = new UserProfileService();
  });

  // ── getProfile ─────────────────────────────────────────────────────────────

  describe("getProfile", () => {
    it("returns full profile with defaults when no extended rows exist", async () => {
      mockGetUserById.mockResolvedValue(mockUserRow());
      MockPool.query.mockResolvedValue({ rows: [] } as any); // no preferences, no extended profile

      const profile = await svc.getProfile("user-1");

      expect(profile.id).toBe("user-1");
      expect(profile.displayName).toBe("Alice");
      expect(profile.avatarUrl).toBeNull();
      expect(profile.stellarAddress).toBeNull();

      // Check safe defaults for preferences
      expect(profile.notificationPreferences.emailEnabled).toBe(true);
      expect(profile.notificationPreferences.marketingEnabled).toBe(false);
    });

    it("returns full profile merged with extended rows", async () => {
      mockGetUserById.mockResolvedValue(mockUserRow());

      MockPool.query.mockImplementation(async (queryStr) => {
        if (
          typeof queryStr === "string" &&
          queryStr.includes("user_notification_preferences")
        ) {
          return {
            rows: [
              {
                email_enabled: false,
                sms_enabled: true,
                push_enabled: true,
                marketing_enabled: true,
                transaction_alerts_enabled: false,
              },
            ],
          };
        }
        if (
          typeof queryStr === "string" &&
          queryStr.includes("user_extended_profile")
        ) {
          return {
            rows: [
              {
                avatar_url: "https://example.com/avatar.png",
                stellar_address: "GBX...",
              },
            ],
          };
        }
        return { rows: [] };
      });

      const profile = await svc.getProfile("user-1");

      expect(profile.avatarUrl).toBe("https://example.com/avatar.png");
      expect(profile.stellarAddress).toBe("GBX...");
      expect(profile.notificationPreferences.emailEnabled).toBe(false);
      expect(profile.notificationPreferences.marketingEnabled).toBe(true);
    });

    it("throws if user does not exist", async () => {
      mockGetUserById.mockResolvedValue(null);
      await expect(svc.getProfile("missing")).rejects.toThrow("not found");
    });
  });

  // ── updateProfile ──────────────────────────────────────────────────────────

  describe("updateProfile", () => {
    it("updates display name via userService and avatar via extended profile", async () => {
      // Mock the initial fetch
      mockGetUserById.mockResolvedValue(mockUserRow());
      MockPool.query.mockResolvedValue({ rows: [] } as any);

      // We expect a recursive call to getProfile at the end, returning the updated state
      // (For this unit test, it just returns whatever we mock)
      mockUpdateUserById.mockResolvedValue(
        mockUserRow({ display_name: "Bob" }),
      );

      await svc.updateProfile("user-1", {
        displayName: "Bob ",
        avatarUrl: "https://cdn.example.com/me.jpg",
      });

      expect(mockUpdateUserById).toHaveBeenCalledWith("user-1", {
        display_name: "Bob",
      });

      expect(MockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO user_extended_profile"),
        ["user-1", "https://cdn.example.com/me.jpg"],
      );
    });

    it("throws on invalid display name length", async () => {
      await expect(
        svc.updateProfile("user-1", {
          displayName: "a".repeat(100),
        }),
      ).rejects.toThrow("at most 80 characters");
    });

    it("throws on non-HTTPS avatar URL", async () => {
      await expect(
        svc.updateProfile("user-1", {
          avatarUrl: "http://insecure.com/avatar.png",
        }),
      ).rejects.toThrow("HTTPS");
    });
  });

  // ── updateNotificationPreferences ──────────────────────────────────────────

  describe("updateNotificationPreferences", () => {
    it("merges partial updates with existing preferences and persists them", async () => {
      // Current state: all defaults
      MockPool.query.mockResolvedValueOnce({ rows: [] } as any); // get
      MockPool.query.mockResolvedValueOnce({ rows: [] } as any); // upsert

      const updated = await svc.updateNotificationPreferences("user-1", {
        emailEnabled: false,
      });

      expect(updated.emailEnabled).toBe(false);
      expect(updated.smsEnabled).toBe(true); // preserved from default

      expect(MockPool.query).toHaveBeenNthCalledWith(
        2, // second call
        expect.stringContaining("INSERT INTO user_notification_preferences"),
        ["user-1", false, true, true, false, true],
      );
    });
  });

  // ── Stellar address ────────────────────────────────────────────────────────

  describe("Stellar address linking", () => {
    it("links a valid stellar address", async () => {
      mockGetUserById.mockResolvedValue(mockUserRow());
      MockPool.query.mockResolvedValue({ rows: [] } as any);

      const validAddress =
        "GA6WZGQZ3Y5QXXA4S3EOWH6M44R27T6W7O5OXZ25G6V2W4S7Z4Z4M3Z5";
      await svc.linkStellarAddress("user-1", { stellarAddress: validAddress });

      expect(MockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO user_extended_profile"),
        ["user-1", validAddress],
      );
    });

    it("rejects an invalid stellar address format", async () => {
      await expect(
        svc.linkStellarAddress("user-1", { stellarAddress: "invalid-addr" }),
      ).rejects.toThrow("Invalid Stellar address format");
    });

    it("unlinks the stellar address", async () => {
      mockGetUserById.mockResolvedValue(mockUserRow());
      MockPool.query.mockResolvedValue({ rows: [] } as any);

      await svc.unlinkStellarAddress("user-1");

      expect(MockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE user_extended_profile"),
        ["user-1"],
      );
    });
  });

  // ── Account activity summary ───────────────────────────────────────────────

  describe("getActivitySummary", () => {
    it("returns parsed activity summary", async () => {
      mockGetUserById.mockResolvedValue(mockUserRow());
      MockPool.query.mockResolvedValue({
        rows: [
          {
            total_transactions: "15",
            total_deposited: "1000.50",
            total_withdrawn: "250.00",
            last_transaction_at: new Date("2023-05-01"),
          },
        ],
      } as any);

      const summary = await svc.getActivitySummary("user-1");

      expect(summary.totalTransactions).toBe(15);
      expect(summary.totalDeposited).toBe(1000.5);
      expect(summary.totalWithdrawn).toBe(250);
      expect(summary.lastTransactionAt).toBe(
        new Date("2023-05-01").toISOString(),
      );
    });

    it("handles no transactions gracefully", async () => {
      mockGetUserById.mockResolvedValue(mockUserRow());
      MockPool.query.mockResolvedValue({
        rows: [
          {
            total_transactions: "0",
            total_deposited: null,
            total_withdrawn: null,
            last_transaction_at: null,
          },
        ],
      } as any);

      const summary = await svc.getActivitySummary("user-1");

      expect(summary.totalTransactions).toBe(0);
      expect(summary.totalDeposited).toBe(0);
      expect(summary.totalWithdrawn).toBe(0);
      expect(summary.lastTransactionAt).toBeNull();
    });
  });
});

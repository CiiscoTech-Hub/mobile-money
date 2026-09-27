/**
 * UserProfileService — User profile management interface
 *
 * Provides a clean, validated facade for managing user profiles in the
 * Mobile Money ↔ Stellar Bridge. Extends the lower-level `userService.ts`
 * functions with:
 *
 *  - Structured profile read/write with input validation
 *  - Notification preference management (email, SMS, push)
 *  - Avatar/display-name management
 *  - Stellar address linking and unlinking
 *  - Account activity summary
 *  - GDPR-compliant data export delegation
 *
 * This service acts as the canonical boundary for any UI or API handler
 * that needs to read or mutate a user's profile data.
 */

import logger from "../utils/logger";
import { pool } from "../config/database";
import { encrypt, decrypt } from "../utils/encryption";
import {
  getUserById,
  updateUserById,
  exportUserData,
  User,
  GdprExportData,
} from "./userService";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NotificationPreferences {
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
  marketingEnabled: boolean;
  transactionAlertsEnabled: boolean;
}

export interface UserProfile {
  id: string;
  displayName: string | null;
  phoneNumber: string;
  kycLevel: string;
  roleName?: string;
  avatarUrl: string | null;
  stellarAddress: string | null;
  notificationPreferences: NotificationPreferences;
  twoFactorEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateProfileRequest {
  displayName?: string;
  avatarUrl?: string;
}

export interface LinkStellarAddressRequest {
  stellarAddress: string;
}

export interface AccountActivitySummary {
  userId: string;
  totalTransactions: number;
  totalDeposited: number;
  totalWithdrawn: number;
  lastTransactionAt: string | null;
  createdAt: Date;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;
const AVATAR_URL_MAX_LENGTH = 2048;
const DISPLAY_NAME_MAX_LENGTH = 80;

// ── Service ───────────────────────────────────────────────────────────────────

export class UserProfileService {
  // ── Profile retrieval ─────────────────────────────────────────────────────

  /**
   * Retrieve a user's full profile, including preferences and Stellar address.
   *
   * @param userId  UUID of the user.
   */
  async getProfile(userId: string): Promise<UserProfile> {
    const user = await getUserById(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    const [preferences, extendedFields] = await Promise.all([
      this.getNotificationPreferences(userId),
      this.getExtendedProfileFields(userId),
    ]);

    return this.mapToProfile(user, preferences, extendedFields);
  }

  // ── Profile update ────────────────────────────────────────────────────────

  /**
   * Update mutable profile fields (display name, avatar URL).
   *
   * @param userId   UUID of the user.
   * @param updates  Fields to update.
   */
  async updateProfile(
    userId: string,
    updates: UpdateProfileRequest,
  ): Promise<UserProfile> {
    this.validateProfileUpdates(updates);

    const fieldsToUpdate: Partial<User> = {};
    if (updates.displayName !== undefined) {
      fieldsToUpdate.display_name = updates.displayName.trim() || null;
    }

    if (Object.keys(fieldsToUpdate).length > 0) {
      await updateUserById(userId, fieldsToUpdate);
    }

    // Update avatar separately via extended profile store
    if (updates.avatarUrl !== undefined) {
      await this.setAvatarUrl(userId, updates.avatarUrl);
    }

    logger.info({ userId }, "[UserProfileService] Profile updated");
    return this.getProfile(userId);
  }

  // ── Notification preferences ──────────────────────────────────────────────

  /**
   * Retrieve notification preferences for a user.
   * Returns safe defaults when no preferences row exists.
   */
  async getNotificationPreferences(
    userId: string,
  ): Promise<NotificationPreferences> {
    const result = await pool.query<{
      email_enabled: boolean;
      sms_enabled: boolean;
      push_enabled: boolean;
      marketing_enabled: boolean;
      transaction_alerts_enabled: boolean;
    }>(
      `SELECT email_enabled, sms_enabled, push_enabled,
              marketing_enabled, transaction_alerts_enabled
       FROM user_notification_preferences
       WHERE user_id = $1`,
      [userId],
    );

    if (result.rows.length === 0) {
      // Return safe defaults — all alerts on, marketing off
      return {
        emailEnabled: true,
        smsEnabled: true,
        pushEnabled: true,
        marketingEnabled: false,
        transactionAlertsEnabled: true,
      };
    }

    const row = result.rows[0];
    return {
      emailEnabled: row.email_enabled,
      smsEnabled: row.sms_enabled,
      pushEnabled: row.push_enabled,
      marketingEnabled: row.marketing_enabled,
      transactionAlertsEnabled: row.transaction_alerts_enabled,
    };
  }

  /**
   * Upsert notification preferences for a user.
   *
   * @param userId       UUID of the user.
   * @param preferences  Full preferences object to persist.
   */
  async updateNotificationPreferences(
    userId: string,
    preferences: Partial<NotificationPreferences>,
  ): Promise<NotificationPreferences> {
    const current = await this.getNotificationPreferences(userId);
    const merged: NotificationPreferences = { ...current, ...preferences };

    await pool.query(
      `INSERT INTO user_notification_preferences
         (user_id, email_enabled, sms_enabled, push_enabled,
          marketing_enabled, transaction_alerts_enabled)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         email_enabled              = EXCLUDED.email_enabled,
         sms_enabled                = EXCLUDED.sms_enabled,
         push_enabled               = EXCLUDED.push_enabled,
         marketing_enabled          = EXCLUDED.marketing_enabled,
         transaction_alerts_enabled = EXCLUDED.transaction_alerts_enabled,
         updated_at                 = CURRENT_TIMESTAMP`,
      [
        userId,
        merged.emailEnabled,
        merged.smsEnabled,
        merged.pushEnabled,
        merged.marketingEnabled,
        merged.transactionAlertsEnabled,
      ],
    );

    logger.info(
      { userId, preferences: merged },
      "[UserProfileService] Notification preferences updated",
    );

    return merged;
  }

  // ── Stellar address ────────────────────────────────────────────────────────

  /**
   * Link a Stellar address to the user's profile.
   *
   * @param userId  UUID of the user.
   * @param req     Request containing the Stellar address to link.
   */
  async linkStellarAddress(
    userId: string,
    req: LinkStellarAddressRequest,
  ): Promise<UserProfile> {
    if (!STELLAR_ADDRESS_REGEX.test(req.stellarAddress)) {
      throw new Error(
        `Invalid Stellar address format. Expected a 56-character public key starting with 'G'.`,
      );
    }

    await pool.query(
      `INSERT INTO user_extended_profile (user_id, stellar_address)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET
         stellar_address = EXCLUDED.stellar_address,
         updated_at      = CURRENT_TIMESTAMP`,
      [userId, req.stellarAddress],
    );

    logger.info(
      { userId, stellarAddress: req.stellarAddress },
      "[UserProfileService] Stellar address linked",
    );

    return this.getProfile(userId);
  }

  /**
   * Unlink the Stellar address from the user's profile.
   *
   * @param userId  UUID of the user.
   */
  async unlinkStellarAddress(userId: string): Promise<UserProfile> {
    await pool.query(
      `UPDATE user_extended_profile
       SET stellar_address = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1`,
      [userId],
    );

    logger.info({ userId }, "[UserProfileService] Stellar address unlinked");

    return this.getProfile(userId);
  }

  // ── Account activity summary ───────────────────────────────────────────────

  /**
   * Retrieve a lightweight activity summary for a user's account.
   *
   * @param userId  UUID of the user.
   */
  async getActivitySummary(userId: string): Promise<AccountActivitySummary> {
    const user = await getUserById(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    const result = await pool.query<{
      total_transactions: string;
      total_deposited: string | null;
      total_withdrawn: string | null;
      last_transaction_at: Date | null;
    }>(
      `SELECT
         COUNT(*)                                         AS total_transactions,
         SUM(CASE WHEN type = 'deposit'  THEN amount::numeric ELSE 0 END)  AS total_deposited,
         SUM(CASE WHEN type = 'withdraw' THEN amount::numeric ELSE 0 END)  AS total_withdrawn,
         MAX(created_at)                                  AS last_transaction_at
       FROM transactions
       WHERE user_id = $1
         AND status = 'completed'`,
      [userId],
    );

    const row = result.rows[0];

    return {
      userId,
      totalTransactions: Number(row.total_transactions ?? 0),
      totalDeposited: Number(row.total_deposited ?? 0),
      totalWithdrawn: Number(row.total_withdrawn ?? 0),
      lastTransactionAt: row.last_transaction_at
        ? row.last_transaction_at.toISOString()
        : null,
      createdAt: user.created_at,
    };
  }

  // ── GDPR data export ───────────────────────────────────────────────────────

  /**
   * Generate a GDPR data export for the user.
   * Delegates to `exportUserData` from `userService.ts`.
   *
   * @param userId  UUID of the user.
   */
  async exportProfile(userId: string): Promise<GdprExportData> {
    return exportUserData(userId);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private validateProfileUpdates(updates: UpdateProfileRequest): void {
    if (
      updates.displayName !== undefined &&
      updates.displayName.length > DISPLAY_NAME_MAX_LENGTH
    ) {
      throw new Error(
        `Display name must be at most ${DISPLAY_NAME_MAX_LENGTH} characters`,
      );
    }

    if (
      updates.avatarUrl !== undefined &&
      updates.avatarUrl !== "" &&
      updates.avatarUrl.length > AVATAR_URL_MAX_LENGTH
    ) {
      throw new Error(
        `Avatar URL must be at most ${AVATAR_URL_MAX_LENGTH} characters`,
      );
    }

    if (
      updates.avatarUrl !== undefined &&
      updates.avatarUrl !== "" &&
      !updates.avatarUrl.startsWith("https://")
    ) {
      throw new Error("Avatar URL must use HTTPS");
    }
  }

  private async getExtendedProfileFields(
    userId: string,
  ): Promise<{ avatarUrl: string | null; stellarAddress: string | null }> {
    const result = await pool.query<{
      avatar_url: string | null;
      stellar_address: string | null;
    }>(
      `SELECT avatar_url, stellar_address
       FROM user_extended_profile
       WHERE user_id = $1`,
      [userId],
    );

    if (result.rows.length === 0) {
      return { avatarUrl: null, stellarAddress: null };
    }

    return {
      avatarUrl: result.rows[0].avatar_url,
      stellarAddress: result.rows[0].stellar_address,
    };
  }

  private async setAvatarUrl(userId: string, avatarUrl: string): Promise<void> {
    await pool.query(
      `INSERT INTO user_extended_profile (user_id, avatar_url)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET
         avatar_url = EXCLUDED.avatar_url,
         updated_at = CURRENT_TIMESTAMP`,
      [userId, avatarUrl || null],
    );
  }

  private mapToProfile(
    user: User,
    preferences: NotificationPreferences,
    extended: { avatarUrl: string | null; stellarAddress: string | null },
  ): UserProfile {
    return {
      id: user.id,
      displayName: user.display_name ?? null,
      phoneNumber: user.phone_number,
      kycLevel: user.kyc_level,
      roleName: user.role_name,
      avatarUrl: extended.avatarUrl,
      stellarAddress: extended.stellarAddress,
      notificationPreferences: preferences,
      twoFactorEnabled: user.two_factor_enabled ?? false,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    };
  }
}

// ── Singleton export ──────────────────────────────────────────────────────────

export const userProfileService = new UserProfileService();

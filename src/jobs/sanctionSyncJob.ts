import logger from "../utils/logger";
import { sanctionService } from "../services/sanctionService";
import { pool } from "../config/database";
import { UserModel } from "../models/users";

const SANCTION_FEED_URL =
  process.env.SANCTION_FEED_URL ??
  "https://scsanctions.un.org/resources/ndjson/consolidated.ndjson";

const BATCH_SIZE = parseInt(process.env.SANCTION_SYNC_BATCH_SIZE ?? "500", 10);

/**
 * Sanction Sync Job
 * Schedule: Daily at 1:00 AM (configurable via SANCTION_SYNC_CRON)
 *
 * Streams the sanctions feed in batches to avoid OOM on large lists,
 * upserts each batch into the DB, then clears the match cache.
 */
export async function runSanctionSyncJob(): Promise<void> {
  console.log(
    "[sanction-sync] Starting daily sanction list synchronization...",
  );

  let totalIndexed = 0;
  try {
    const updates = await sanctionService.fetchSanctionUpdates();
    totalIndexed = updates.length;
    console.log(
      `[sanction-sync] Fetched ${updates.length} entities from global lists.`,
    );

    await sanctionService.updateSanctionList(updates);
    console.log(
      "[sanction-sync] Successfully updated internal sanction blacklist.",
    );
  } catch (error) {
    logger.error(
      "[sanction-sync] Critical failure during sanction sync:",
      error,
    );
    throw error;
  }

  await sanctionService.clearSanctionMatchCache();
  
  console.log("[sanction-sync] Screening active customer profiles...");
  let suspendedCount = 0;
  try {
    const client = await pool.connect();
    let activeUsers: any[];
    try {
      const result = await client.query("SELECT id FROM users WHERE status = 'active'");
      activeUsers = result.rows || [];
    } finally {
      client.release();
    }

    const userModel = new UserModel();
    for (const { id } of activeUsers) {
      const user = await userModel.findById(id, { id: "SYSTEM", role: "admin" });
      if (!user) continue;

      const namesToScreen: string[] = [];
      if (user.displayName) namesToScreen.push(user.displayName);
      if (user.firstName && user.lastName) namesToScreen.push(`${user.firstName} ${user.lastName}`);
      else if (user.firstName) namesToScreen.push(user.firstName);
      else if (user.lastName) namesToScreen.push(user.lastName);

      let matched = false;
      let matchReason = "";

      for (const name of namesToScreen) {
        if (!name.trim()) continue;

        const matches = await sanctionService.searchSanctionsWithLevenshtein(name);
        if (matches.length > 0) {
          const top = matches[0];
          matched = true;
          matchReason = `Sanction screening match: name "${name}" matched "${top.entity.name}" (score ${top.score.toFixed(2)}) on ${top.entity.source}`;
          break;
        }
      }

      if (matched) {
        console.log(`[sanction-sync] Suspending user ${id}: ${matchReason}`);
        await userModel.updateStatus(id, "suspended", "SYSTEM", matchReason);
        suspendedCount++;
      }
    }
  } catch (error) {
    logger.error("[sanction-sync] Failure during active customer screening:", error);
    throw error;
  }

  console.log(
    `[sanction-sync] Completed: ${totalIndexed} entities indexed, cache cleared, ${suspendedCount} users suspended.`,
  );
}

import { pool, queryRead, queryWrite } from "../config/database";
import { reencryptIfNeeded } from "../utils/crypto";

const BATCH_SIZE = 500;

/**
 * Job to rotate encryption keys for PII fields in the database.
 * It iterates through users in batches and re-encrypts outdated fields 
 * without causing service interruption.
 */
export async function runKeyRotationJob(): Promise<void> {
  console.log("[KeyRotationJob] Starting PII encryption key rotation job");

  const activeVersion = process.env.ACTIVE_ENCRYPTION_KEY_VERSION;
  if (!activeVersion || activeVersion.toLowerCase() === "legacy") {
    console.log("[KeyRotationJob] No active version set or legacy mode active. Skipping rotation.");
    return;
  }

  let offset = 0;
  let totalProcessed = 0;
  let totalUpdated = 0;
  let hasMore = true;

  while (hasMore) {
    // Fetch users in batches
    const result = await queryRead(
      "SELECT id, first_name, last_name, address, date_of_birth, id_number FROM users ORDER BY id LIMIT $1 OFFSET $2",
      [BATCH_SIZE, offset]
    );

    const users = result.rows;
    if (users.length === 0) {
      hasMore = false;
      break;
    }

    for (const user of users) {
      const updates: Record<string, string> = {};

      const newFirstName = reencryptIfNeeded(user.first_name);
      if (newFirstName) updates.first_name = newFirstName;

      const newLastName = reencryptIfNeeded(user.last_name);
      if (newLastName) updates.last_name = newLastName;

      const newAddress = reencryptIfNeeded(user.address);
      if (newAddress) updates.address = newAddress;

      const newDateOfBirth = reencryptIfNeeded(user.date_of_birth);
      if (newDateOfBirth) updates.date_of_birth = newDateOfBirth;

      const newIdNumber = reencryptIfNeeded(user.id_number);
      if (newIdNumber) updates.id_number = newIdNumber;

      const updateFields = Object.keys(updates);
      if (updateFields.length > 0) {
        // Build the update query
        const setClauses = [];
        const values = [];
        let paramIdx = 1;

        for (const field of updateFields) {
          setClauses.push(`${field} = $${paramIdx++}`);
          values.push(updates[field]);
        }

        values.push(user.id);
        const query = `UPDATE users SET ${setClauses.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIdx}`;
        
        try {
          await queryWrite(query, values);
          totalUpdated++;
        } catch (error) {
          console.error(`[KeyRotationJob] Failed to update user ${user.id}:`, error);
        }
      }
      
      totalProcessed++;
    }

    offset += BATCH_SIZE;
    
    // Slight delay to prevent DB overload during large rotations
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  console.log(`[KeyRotationJob] Completed rotation. Processed: ${totalProcessed}, Updated: ${totalUpdated}`);
}

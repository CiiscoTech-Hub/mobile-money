#!/usr/bin/env tsx
/**
 * Seed: Verification Countries
 *
 * Populates the `verification_countries` table with the full expanded
 * ISO 3166-1 country list defined in src/utils/validators.ts.
 *
 * Safe to run multiple times — uses ON CONFLICT DO UPDATE (upsert).
 *
 * Usage:
 *   NODE_ENV=development tsx src/scripts/seedVerificationCountries.ts
 *   NODE_ENV=development npm run seed:countries
 */

import dotenv from "dotenv";
import { Pool } from "pg";
import { getVerificationCountries } from "../utils/validators";

dotenv.config();

const ALLOWED_ENVS = ["development", "staging", "test"];

async function seedVerificationCountries(): Promise<void> {
  const env = process.env.NODE_ENV ?? "development";

  if (!ALLOWED_ENVS.includes(env)) {
    console.error(
      `[seed:countries] Refusing to seed in "${env}" environment. ` +
        `Allowed: ${ALLOWED_ENVS.join(", ")}`,
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const countries = getVerificationCountries();
    console.log(
      `[seed:countries] Upserting ${countries.length} verification countries…`,
    );

    let inserted = 0;
    let updated  = 0;

    // Batch upsert in a single transaction for atomicity
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      for (const c of countries) {
        const result = await client.query<{ xmax: string }>(
          `INSERT INTO verification_countries
             (alpha2, alpha3, name, region, passport_verification_enabled, is_active)
           VALUES ($1, $2, $3, $4, $5, true)
           ON CONFLICT (alpha2) DO UPDATE SET
             alpha3                       = EXCLUDED.alpha3,
             name                         = EXCLUDED.name,
             region                       = EXCLUDED.region,
             passport_verification_enabled = EXCLUDED.passport_verification_enabled,
             is_active                    = true
           RETURNING xmax`,
          [
            c.alpha2,
            c.alpha3,
            c.name,
            c.region,
            c.passportVerificationEnabled,
          ],
        );

        // xmax = 0 means a fresh INSERT; non-zero means UPDATE
        if (result.rows[0]?.xmax === "0") {
          inserted++;
        } else {
          updated++;
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Summary
    const passportEnabled = countries.filter(
      (c) => c.passportVerificationEnabled,
    ).length;

    const byRegion = countries.reduce<Record<string, number>>((acc, c) => {
      acc[c.region] = (acc[c.region] ?? 0) + 1;
      return acc;
    }, {});

    console.log(`[seed:countries] Done — inserted=${inserted} updated=${updated}`);
    console.log(
      `[seed:countries] Passport verification enabled for ${passportEnabled}/${countries.length} countries`,
    );
    console.log("[seed:countries] Breakdown by region:");
    for (const [region, count] of Object.entries(byRegion).sort()) {
      console.log(`  ${region.padEnd(10)} ${count}`);
    }
  } finally {
    await pool.end();
  }
}

seedVerificationCountries().catch((err) => {
  console.error("[seed:countries] Fatal error:", err);
  process.exit(1);
});

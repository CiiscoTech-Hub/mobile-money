import { execSync } from "child_process";
import * as path from "path";

/**
 * Configure application bootstrap sequences to fetch environment variables
 * from HashiCorp Vault or AWS Secrets Manager.
 * 
 * Runs synchronously on application launch so process.env is fully populated
 * before other modules initialize.
 * 
 * If the secrets vault is offline or drops, fallback parameters (existing process.env) remain active.
 */
export function bootstrapSecrets(): void {
  const provider = (process.env.VAULT_PROVIDER || "").toLowerCase();
  if (!provider || provider === "none" || provider === "local" || provider === "off") {
    console.log("[Vault] No external secrets vault provider configured. Bootstrapping with local/env configurations.");
    return;
  }

  console.log(`[Vault] Bootstrapping secrets synchronously from provider: ${provider}`);

  try {
    const fetcherScript = path.resolve(__dirname, "vaultFetcher.ts");
    const output = execSync(`npx tsx "${fetcherScript}"`, {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"], // capture stdout and stderr
    });

    const secrets = JSON.parse(output.toString().trim());
    let loadedCount = 0;
    for (const [key, value] of Object.entries(secrets)) {
      if (value !== undefined && value !== null) {
        process.env[key] = String(value);
        loadedCount++;
      }
    }
    console.log(`[Vault] Successfully loaded ${loadedCount} secrets from ${provider}.`);
  } catch (error: any) {
    const errorMsg = error.stderr ? error.stderr.toString().trim() : (error.message || String(error));
    console.warn(`[Vault] Failed to load secrets from external vault. Activating fallback parameters. Error: ${errorMsg}`);
  }
}

// Automatically execute bootstrap on import
bootstrapSecrets();

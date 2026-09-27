import { exportUserData } from "../../src/services/userService";
import Logger from "../../src/utils/logger";

export async function runGdprExport(userId: string) {
  if (!userId) {
    Logger.error("Error: Please provide a valid --user <userId> argument.");
    process.exit(1);
  }

  try {
    Logger.info(`Exporting GDPR data for user ID: ${userId}...`);
    const exportData = await exportUserData(userId);

    const jsonOutput = JSON.stringify(exportData, null, 2);
    console.log("\n=== GDPR USER DATA EXPORT ===");
    console.log(jsonOutput);
    console.log("==============================\n");

    return exportData;
  } catch (error: any) {
    Logger.error(`GDPR Export failed: ${error.message}`);
    process.exit(1);
  }
}

// CLI Execution Entry Point
if (require.main === module) {
  const args = process.argv.slice(2);
  const userArgIndex = args.indexOf("--user");
  const userId = userArgIndex !== -1 ? args[userArgIndex + 1] : args[0];

  runGdprExport(userId);
}
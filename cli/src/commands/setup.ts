import { Command } from "commander";
import { runSetupWizard } from "../setupWizard";
import { printError, printWarn } from "../dashboard";
import { formatSuccess } from "../utils/cliFormatting";

export function registerSetupCommand(program: Command): void {
  program
    .command("setup")
    .description("Interactive setup wizard for cli/.momorc")
    .action(async () => {
      try {
        const config = await runSetupWizard();
        console.log(formatSuccess(`Saved cli/.momorc for ${config.apiUrl}`));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "Setup cancelled") {
          printWarn("Setup cancelled.");
          return;
        }

        printError(
          `Setup failed: ${msg}`,
          err instanceof Error ? err : undefined,
          "ERR_SETUP",
        );
        process.exit(1);
      }
    });
}

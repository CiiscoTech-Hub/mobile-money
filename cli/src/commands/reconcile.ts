import { Command } from "commander";
import chalk from "chalk";
import { printError } from "../dashboard";
import {
  formatSuccess,
  formatWarn,
  formatInfo,
} from "../utils/cliFormatting";
import { triggerReconcile } from "../api";

export function registerReconcileCommand(program: Command): void {
  program
    .command("reconcile")
    .description(
      "Scan pending MTN MoMo transactions and sync statuses from provider logs",
    )
    .option("--dry-run", "Show what would be updated without writing changes")
    .option("--verbose", "Print every transaction, not just updated ones")
    .action(async (opts: { dryRun?: boolean; verbose?: boolean }) => {
      try {
        console.log(
          formatInfo("Fetching pending transactions and querying provider…"),
        );

        const data = await triggerReconcile(opts.dryRun ?? false);
        const { total, updated, results } = data;

        console.log(
          `\n${chalk.bold("Reconciliation complete")}\n` +
            `  ${chalk.bold("Pending scanned:")} ${total}\n` +
            `  ${chalk.bold("Statuses updated:")} ${updated}\n`,
        );

        if (opts.dryRun) {
          console.log(
            formatWarn("Dry-run mode — no changes were persisted.\n"),
          );
        }

        const toShow = opts.verbose
          ? results
          : results.filter((r) => r.updated);

        if (toShow.length > 0) {
          console.log(
            chalk.bold(
              `${opts.verbose ? "All" : "Updated"} transactions:\n`,
            ),
          );

          for (const r of toShow) {
            const icon = r.updated ? chalk.green("✓") : chalk.gray("–");
            const statusLine = r.updated
              ? `${chalk.yellow(r.previousStatus)} → ${chalk.green(r.newStatus!)}`
              : chalk.gray(r.previousStatus);

            console.log(
              `  ${icon} ${chalk.cyan(r.referenceNumber)} (${r.id.slice(0, 8)}…)` +
                `  provider: ${chalk.magenta(r.providerStatus)}  local: ${statusLine}`,
            );
          }
          console.log();
        }

        if (updated > 0) {
          console.log(
            formatSuccess(
              `${updated} transaction${updated === 1 ? "" : "s"} updated.`,
            ),
          );
        } else {
          console.log(formatInfo("No status changes required."));
        }
      } catch (err) {
        printError(
          "Reconciliation failed",
          err instanceof Error ? err : undefined,
          "ERR_RECONCILE",
        );
        process.exit(1);
      }
    });
}

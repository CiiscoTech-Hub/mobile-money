import { Command } from "commander";
import chalk from "chalk";
import inquirer from "inquirer";
import { releaseEscrow } from "../api";
import { printError } from "../dashboard";
import { formatSuccess } from "../utils/cliFormatting";

export function registerEscrowCommand(program: Command): void {
  const escrow = program.command("escrow").description("Escrow management");

  escrow
    .command("release <escrowId>")
    .description("Release escrowed funds via multi-signature approval")
    .option(
      "-t, --threshold <number>",
      "number of approval signatures required",
      "2",
    )
    .action(async (escrowId: string, opts: { threshold: string }) => {
      const threshold = parseInt(opts.threshold, 10);
      if (isNaN(threshold) || threshold < 1) {
        printError(
          "--threshold must be a positive integer",
          undefined,
          "ERR_ESCROW",
        );
        process.exit(1);
      }

      console.log(chalk.cyan(`\nEscrow release: ${chalk.bold(escrowId)}`));
      console.log(
        chalk.yellow(`Requires ${threshold} approval signature(s).\n`),
      );

      const signatures: { signerIndex: number; key: string }[] = [];

      for (let i = 0; i < threshold; i++) {
        console.log(chalk.dim(`— Signer ${i + 1} of ${threshold} —`));

        const { key } = await inquirer.prompt<{ key: string }>([
          {
            type: "password",
            name: "key",
            message: `Signing key for signer ${i + 1}:`,
            mask: "*",
            validate: (v: string) =>
              v.trim().length > 0 ? true : "Signing key is required",
          },
        ]);

        signatures.push({ signerIndex: i, key: key.trim() });
      }

      const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
        {
          type: "confirm",
          name: "confirmed",
          message: chalk.red(
            `Release funds from escrow ${chalk.bold(escrowId)}? This cannot be undone.`,
          ),
          default: false,
        },
      ]);

      if (!confirmed) {
        console.log(chalk.yellow("Aborted."));
        process.exit(0);
      }

      try {
        const result = await releaseEscrow(escrowId, signatures);
        console.log(`\n${formatSuccess(result.message)}`);
        if (result.txHash) {
          console.log(`  Tx hash: ${chalk.cyan(result.txHash)}`);
        }
      } catch (err) {
        printError(
          `Release failed: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err : undefined,
          "ERR_ESCROW_RELEASE",
        );
        process.exit(1);
      }
    });
}

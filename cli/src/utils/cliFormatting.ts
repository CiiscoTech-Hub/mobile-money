import chalk from "chalk";

export function normalizeErrorCode(code?: string): string | undefined {
  if (!code) return undefined;

  const trimmed = code.trim();
  if (!trimmed) return undefined;

  const normalized = trimmed.toUpperCase();
  return normalized.startsWith("ERR_") ? normalized : `ERR_${normalized}`;
}

export function formatSuccess(message: string): string {
  return `${chalk.green("✓")} ${chalk.green(message)}`;
}

export function formatInfo(message: string): string {
  return `${chalk.cyan("ℹ")} ${chalk.cyan(message)}`;
}

export function formatWarn(message: string): string {
  return `${chalk.yellow("⚠")} ${chalk.yellow(message)}`;
}

export function formatError(message: string, code?: string): string {
  const normalizedCode = normalizeErrorCode(code);
  const codeLabel = normalizedCode
    ? ` ${chalk.red.bold(`[${normalizedCode}]`)}`
    : "";

  return `${chalk.red("✗")} ${chalk.red.bold("Error")}${codeLabel}: ${chalk.red(message)}`;
}

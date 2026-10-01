import logger from "../utils/logger";
import { emailService, type LowBalanceAlert } from "./email";
import { smsService } from "./sms";

export type { LowBalanceAlert };

function parseRecipientList(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function getAdminAlertEmails(): string[] {
  return parseRecipientList(process.env.ADMIN_ALERT_EMAILS);
}

function getAdminAlertPhoneNumbers(): string[] {
  return parseRecipientList(process.env.ADMIN_ALERT_PHONE_NUMBERS);
}

function buildBalanceAlertSmsBody(alerts: LowBalanceAlert[]): string {
  const summary = alerts
    .map(
      (alert) =>
        `${alert.provider.toUpperCase()} ${alert.availableBalance.toFixed(2)} ${alert.currency} (min ${alert.threshold.toFixed(2)})`,
    )
    .join("; ");
  return `Mobile Money Alert: Low settlement balance - ${summary}`;
}

/**
 * Notify configured administrators by email and SMS that one or more
 * provider settlement accounts have dropped below their configured minimum
 * threshold. Recipients come from the comma-separated ADMIN_ALERT_EMAILS and
 * ADMIN_ALERT_PHONE_NUMBERS env vars. Delivery failures are logged and never
 * thrown, so a notification outage never blocks the balance check job.
 */
export async function sendAdminBalanceAlert(
  alerts: LowBalanceAlert[],
): Promise<void> {
  if (alerts.length === 0) return;

  const emails = getAdminAlertEmails();
  const phoneNumbers = getAdminAlertPhoneNumbers();

  if (emails.length === 0 && phoneNumbers.length === 0) {
    logger.warn(
      "[notifications] Low balance alert triggered but no ADMIN_ALERT_EMAILS or ADMIN_ALERT_PHONE_NUMBERS are configured",
    );
    return;
  }

  const smsBody = buildBalanceAlertSmsBody(alerts);

  await Promise.all([
    ...emails.map((to) =>
      emailService.sendAdminBalanceAlert(to, alerts).catch((error) => {
        logger.error(
          `[notifications] Failed to send balance alert email to ${to}:`,
          error,
        );
      }),
    ),
    ...phoneNumbers.map((to) =>
      smsService.sendToPhone(to, smsBody).catch((error) => {
        logger.error(
          `[notifications] Failed to send balance alert SMS to ${to}:`,
          error,
        );
      }),
    ),
  ]);
}

import logger from "../../utils/logger";
import twilio from "twilio";
// @ts-ignore
import africastalking from "africastalking";
import {
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
import { resolveLocale, translate } from "../../utils/i18n";
import { getConfigValue } from "../../config/appConfig";

export type SmsEventKind = "transaction_completed" | "transaction_failed";

export interface TransactionSmsContext {
  referenceNumber: string;
  type: "deposit" | "withdraw";
  amount: string;
  provider: string;
  kind: SmsEventKind;
  errorMessage?: string;
  locale?: string;
}

export function formatPhoneE164(
  raw: string,
  defaultRegion: CountryCode =
    (process.env.SMS_DEFAULT_REGION as CountryCode) || "CM",
): string {
  const trimmed = raw.trim();
  const parsed = parsePhoneNumberFromString(trimmed, defaultRegion);
  if (!parsed || !parsed.isValid()) {
    throw new Error(`Invalid phone number for SMS: ${raw}`);
  }
  return parsed.number; // E.164
}

function templateCompleted(ctx: TransactionSmsContext): string {
  const locale = resolveLocale(ctx.locale);
  const action = translate(`sms.action.${ctx.type}`, locale);
  return translate("sms.transaction_completed", locale, {
    action,
    amount: ctx.amount,
    provider: ctx.provider.toUpperCase(),
    referenceNumber: ctx.referenceNumber,
  });
}

function templateFailed(ctx: TransactionSmsContext): string {
  const locale = resolveLocale(ctx.locale);
  const action = translate(`sms.action.${ctx.type}`, locale);
  const detail = ctx.errorMessage
    ? translate("sms.reason_detail", locale, {
        reason: ctx.errorMessage.slice(0, 120),
      })
    : "";

  return translate("sms.transaction_failed", locale, {
    action,
    referenceNumber: ctx.referenceNumber,
    detail,
  });
}

export function buildTransactionSmsBody(ctx: TransactionSmsContext): string {
  return ctx.kind === "transaction_completed"
    ? templateCompleted(ctx)
    : templateFailed(ctx);
}

interface RateBucket {
  count: number;
  windowStart: number;
}

export class SmsRateLimiter {
  private buckets = new Map<string, RateBucket>();

  constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs: number,
  ) {}

  tryConsume(key: string): boolean {
    const now = Date.now();
    const b = this.buckets.get(key);
    if (!b || now - b.windowStart >= this.windowMs) {
      this.buckets.set(key, { count: 1, windowStart: now });
      return true;
    }
    if (b.count >= this.maxPerWindow) return false;
    b.count += 1;
    return true;
  }
}

const globalLimiter = new SmsRateLimiter(
  parseInt(process.env.SMS_MAX_PER_PHONE_PER_HOUR || "10", 10),
  parseInt(process.env.SMS_RATE_LIMIT_WINDOW_MS || `${60 * 60 * 1000}`, 10),
);

export interface SmsSendResult {
  sent: boolean;
  skippedReason?: string;
  messageSid?: string;
  error?: string;
  providerUsed?: string;
}

export class SmsService {
  private twilioClient: ReturnType<typeof twilio> | null = null;
  private atClient: any = null;
  private primaryProvider: string;
  private secondaryProvider: string;
  private timeoutMs: number;

  constructor() {
    try {
      this.primaryProvider = (process.env.SMS_PROVIDER || getConfigValue("sms.primaryProvider") || "none").toLowerCase();
      this.secondaryProvider = (process.env.SMS_PROVIDER_SECONDARY || getConfigValue("sms.secondaryProvider") || "none").toLowerCase();
      this.timeoutMs = parseInt(process.env.SMS_TIMEOUT_MS || "", 10) || getConfigValue("sms.timeoutMs") || 5000;
    } catch {
      this.primaryProvider = (process.env.SMS_PROVIDER || "none").toLowerCase();
      this.secondaryProvider = (process.env.SMS_PROVIDER_SECONDARY || "none").toLowerCase();
      this.timeoutMs = parseInt(process.env.SMS_TIMEOUT_MS || "5000", 10);
    }

    this.initClients();
  }

  private initClients() {
    const providers = [this.primaryProvider, this.secondaryProvider];
    for (const provider of providers) {
      if (provider === "twilio" && !this.twilioClient) {
        const sid = process.env.TWILIO_ACCOUNT_SID;
        const token = process.env.TWILIO_AUTH_TOKEN;
        if (sid && token) this.twilioClient = twilio(sid, token);
      } else if (provider === "africastalking" && !this.atClient) {
        const apiKey = process.env.AFRICASTALKING_API_KEY;
        const username = process.env.AFRICASTALKING_USERNAME;
        if (apiKey && username) {
          this.atClient = africastalking({ apiKey, username });
        }
      }
    }
  }

  shouldSend(provider: string): boolean {
    if (process.env.NODE_ENV === "test" && !process.env.SMS_TEST_FORCE) return false;
    if (provider === "none" || provider === "off" || provider === "disabled")
      return false;
    return (provider === "twilio" && this.twilioClient !== null) || (provider === "africastalking" && this.atClient !== null) || provider === "infobip";
  }

  async sendWithProvider(provider: string, to: string, body: string): Promise<string> {
    if (provider === "twilio") {
      const from = process.env.TWILIO_PHONE_NUMBER;
      if (!from) {
        throw new Error("TWILIO_PHONE_NUMBER not set");
      }
      const message = await this.twilioClient!.messages.create({
        to,
        from,
        body,
      });
      return message.sid;
    } else if (provider === "africastalking") {
      const result = await this.atClient.SMS.send({
        to: [to],
        message: body,
        from: process.env.AFRICASTALKING_SENDER_ID
      });
      const msgData = result?.SMSMessageData?.Recipients?.[0];
      if (msgData?.status === "Success") {
        return msgData.messageId;
      } else {
        throw new Error(`AT sending failed with status: ${msgData?.status}`);
      }
    } else if (provider === "infobip") {
      logger.info(`[sms] simulating delivery via Infobip`, { to });
      return "infobip-stub-sid-" + Date.now();
    } else {
      throw new Error(`Unsupported/unconfigured provider: ${provider}`);
    }
  }

  async sendToPhone(toRaw: string, body: string): Promise<SmsSendResult> {
    let to: string;
    try {
      to = formatPhoneE164(toRaw);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[sms] invalid recipient", msg);
      return { sent: false, skippedReason: "invalid_phone", error: msg };
    }

    if (!globalLimiter.tryConsume(to)) {
      console.warn("[sms] rate limited", { to });
      return { sent: false, skippedReason: "rate_limited" };
    }

    const primary = this.primaryProvider;
    if (this.shouldSend(primary)) {
      try {
        const messageSid = await this.sendWithTimeout(primary, to, body, this.timeoutMs);
        console.log(`[sms] delivered via primary provider: ${primary}`, { to, sid: messageSid });
        return { sent: true, messageSid, providerUsed: primary };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[sms] primary provider ${primary} failed/timed out. Swapping to secondary provider. Error: ${msg}`);
        
        const secondary = this.secondaryProvider;
        if (this.shouldSend(secondary)) {
          try {
            const messageSid = await this.sendWithProvider(secondary, to, body);
            console.log(`[sms] delivered via secondary provider: ${secondary} after failover`, { to, sid: messageSid });
            return { sent: true, messageSid, providerUsed: secondary };
          } catch (secErr) {
            const secMsg = secErr instanceof Error ? secErr.message : String(secErr);
            logger.error(`[sms] secondary provider ${secondary} also failed. Failover exhausted.`, { to, error: secMsg });
            return { sent: false, error: `Primary and secondary failed. Sec error: ${secMsg}` };
          }
        } else {
          return { sent: false, error: `Primary failed: ${msg}. No secondary provider configured/available.` };
        }
      }
    } else {
      const secondary = this.secondaryProvider;
      if (this.shouldSend(secondary)) {
        try {
          const messageSid = await this.sendWithProvider(secondary, to, body);
          return { sent: true, messageSid, providerUsed: secondary };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { sent: false, error: msg };
        }
      }
    }

    console.log("[sms] skipped (no active provider or test environment)");
    return { sent: false, skippedReason: "disabled_or_test" };
  }

  private sendWithTimeout(provider: string, to: string, body: string, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`SMS request timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.sendWithProvider(provider, to, body)
        .then((sid) => {
          clearTimeout(timer);
          resolve(sid);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  async notifyTransactionEvent(
    phoneNumber: string,
    ctx: TransactionSmsContext,
  ): Promise<SmsSendResult> {
    const body = buildTransactionSmsBody(ctx);
    return this.sendToPhone(phoneNumber, body);
  }
}

export const smsService = new SmsService();

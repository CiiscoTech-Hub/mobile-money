import {
  parsePhoneNumberFromString,
  type CountryCode,
  type PhoneNumber,
} from "libphonenumber-js";

export type MobileProvider = "mtn" | "airtel" | "orange" | "vodacom" | "tigo";
export type PhoneOutputFormat =
  "e164" | "national" | "international" | "rfc3966";

export interface ProviderPhoneFormatConfig {
  defaultRegion: CountryCode;
  output: "e164" | "national";
}

export interface ParsedPhoneInfo {
  isValid: boolean;
  countryCallingCode?: string;
  country?: CountryCode;
  nationalNumber?: string;
  e164?: string;
  international?: string;
  national?: string;
  rfc3966?: string;
}

/**
 * Standard mapping of prefixes to Mobile Network Operators.
 * These are common prefixes for regions like Uganda/Rwanda/Cameroon/Ghana/Tanzania/Ivory Coast/Senegal.
 */
export const PROVIDER_PREFIXES: Record<MobileProvider, string[]> = {
  mtn: ["23767", "23768", "25677", "25678", "23324", "23354", "23355", "23359"],
  airtel: ["23766", "25670", "25675", "23326", "23356", "23357", "25473", "25475", "25478", "25410", "25411"],
  orange: ["23765", "23769", "22507", "22177"],
  vodacom: [
    "255740",
    "255762",
    "255763",
    "255764",
    "255765",
    "255766",
    "255767",
    "255768",
    "255769",
  ],
  tigo: [
    "255713",
    "255714",
    "255715",
    "255716",
    "255717",
    "255718",
    "255719",
    "255752",
    "255753",
    "255754",
    "255755",
  ],
};

export const PROVIDER_PHONE_FORMATS: Record<
  MobileProvider,
  ProviderPhoneFormatConfig
> = {
  mtn: {
    defaultRegion: "CM",
    output: "e164",
  },
  airtel: {
    defaultRegion: (process.env.AIRTEL_PHONE_REGION as CountryCode) || "CM",
    output: "national",
  },
  orange: {
    defaultRegion: "CM",
    output: "e164",
  },
  vodacom: {
    defaultRegion: "TZ",
    output: "e164",
  },
  tigo: {
    defaultRegion: "TZ",
    output: "e164",
  },
};

/**
 * Flexible phone number parser that gracefully accepts raw user inputs
 * including spaces, dashes, parentheses, missing '+' prefixes, and leading trunk '00'.
 */
export function parseFlexiblePhoneNumber(
  phoneNumber: string,
  defaultRegion: CountryCode = "CM",
): PhoneNumber | null {
  if (typeof phoneNumber !== "string" || !phoneNumber.trim()) {
    return null;
  }

  const trimmed = phoneNumber.trim();
  const digitsOnly = trimmed.replace(/\D/g, "");
  if (!digitsOnly) {
    return null;
  }

  const candidates: string[] = [trimmed];

  if (!trimmed.startsWith("+")) {
    candidates.push(`+${digitsOnly}`);
  }

  if (digitsOnly.startsWith("00")) {
    candidates.push(`+${digitsOnly.slice(2)}`);
  }

  for (const candidate of candidates) {
    try {
      const parsed = parsePhoneNumberFromString(candidate, defaultRegion);
      if (parsed?.isValid()) {
        return parsed;
      }
    } catch {
      // Ignore parsing errors for candidate
    }
  }

  // Fallback: try parsing trimmed candidate directly
  try {
    const fallback = parsePhoneNumberFromString(trimmed, defaultRegion);
    if (fallback) {
      return fallback;
    }
  } catch {
    // Ignore fallback errors
  }

  return null;
}

/**
 * Comprehensive phone number validation and metadata extraction.
 */
export function validatePhoneNumber(
  phoneNumber: string,
  defaultRegion: CountryCode = "CM",
): ParsedPhoneInfo {
  const parsed = parseFlexiblePhoneNumber(phoneNumber, defaultRegion);
  if (!parsed || !parsed.isValid()) {
    return { isValid: false };
  }

  return {
    isValid: true,
    countryCallingCode: parsed.countryCallingCode,
    country: parsed.country,
    nationalNumber: parsed.nationalNumber,
    e164: parsed.number,
    international: parsed.formatInternational(),
    national: parsed.formatNational(),
    rfc3966: parsed.getURI(),
  };
}

/**
 * Check whether a given phone number string is valid for a given or default region.
 */
export function isValidPhoneNumber(
  phoneNumber: string,
  defaultRegion: CountryCode = "CM",
): boolean {
  const parsed = parseFlexiblePhoneNumber(phoneNumber, defaultRegion);
  return Boolean(parsed?.isValid());
}

/**
 * Format a phone number into the requested format (E.164, national, international, RFC 3966).
 */
export function formatPhoneNumber(
  phoneNumber: string,
  format: PhoneOutputFormat = "e164",
  defaultRegion: CountryCode = "CM",
): string {
  const parsed = parseFlexiblePhoneNumber(phoneNumber, defaultRegion);
  if (!parsed || !parsed.isValid()) {
    throw new Error(`Invalid phone number: ${phoneNumber}`);
  }

  switch (format) {
    case "national":
      return parsed.formatNational();
    case "international":
      return parsed.formatInternational();
    case "rfc3966":
      return parsed.getURI();
    case "e164":
    default:
      return parsed.number;
  }
}

/**
 * Detect mobile operator based on phone number prefix matching.
 */
export function detectProvider(
  phoneNumber: string,
  countryOverride?: CountryCode,
): MobileProvider | null {
  if (typeof phoneNumber !== "string") return null;
  const sanitized = phoneNumber.replace(/\D/g, "");

  for (const [provider, prefixes] of Object.entries(PROVIDER_PREFIXES)) {
    if (prefixes.some((prefix) => sanitized.startsWith(prefix))) {
      return provider as MobileProvider;
    }
  }

  // If not matching directly, try resolving with countryOverride or default region
  if (countryOverride) {
    const parsed = parseFlexiblePhoneNumber(phoneNumber, countryOverride);
    if (parsed?.isValid()) {
      const fullDigits = parsed.number.replace(/^\+/, "");
      for (const [provider, prefixes] of Object.entries(PROVIDER_PREFIXES)) {
        if (prefixes.some((prefix) => fullDigits.startsWith(prefix))) {
          return provider as MobileProvider;
        }
      }
    }
  }

  return null;
}

/**
 * Validates if a phone number belongs to the specified provider.
 * @param phoneNumber E.164 or national formatted number
 * @param provider The provider selected in the request
 * @param countryOverride Optional country code override (e.g., 'UG', 'GH', 'TZ', 'CM', 'KE', 'CI', 'SN')
 */
export function validatePhoneProviderMatch(
  phoneNumber: string,
  provider: string,
  countryOverride?: CountryCode,
): { valid: boolean; error?: string } {
  if (typeof phoneNumber !== "string" || !phoneNumber.trim()) {
    return { valid: false, error: "Phone number is required" };
  }
  if (typeof provider !== "string" || !provider.trim()) {
    return { valid: false, error: `Unsupported provider: ${provider}` };
  }

  const sanitized = phoneNumber.replace(/^\+/, "").replace(/\D/g, "");
  const targetProvider = provider.toLowerCase().trim() as MobileProvider;

  const prefixes = PROVIDER_PREFIXES[targetProvider];
  if (!prefixes) {
    return { valid: false, error: `Unsupported provider: ${provider}` };
  }

  let isMatch = prefixes.some((prefix) => sanitized.startsWith(prefix));

  if (!isMatch) {
    const region =
      countryOverride ||
      PROVIDER_PHONE_FORMATS[targetProvider]?.defaultRegion ||
      "CM";
    const parsed = parseFlexiblePhoneNumber(phoneNumber, region);
    if (parsed?.isValid()) {
      const fullDigits = parsed.number.replace(/^\+/, "");
      isMatch = prefixes.some((prefix) => fullDigits.startsWith(prefix));
    }
  }

  if (!isMatch) {
    return {
      valid: false,
      error: `Phone number ${phoneNumber} does not belong to the ${provider.toUpperCase()} network.`,
    };
  }

  return { valid: true };
}

/**
 * Format a phone number according to provider-specific payload requirements.
 * Airtel payouts in particular may require a national-format MSISDN in some
 * regions, so we normalize user input before building the request payload.
 * Accepts an optional countryOverride to allow overriding the default provider region.
 */
export function formatPhoneForProvider(
  phoneNumber: string,
  provider: string,
  countryOverride?: CountryCode,
): string {
  if (typeof provider !== "string") {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const targetProvider = provider.toLowerCase().trim() as MobileProvider;
  const config = PROVIDER_PHONE_FORMATS[targetProvider];

  if (!config) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const region = countryOverride || config.defaultRegion;
  const parsed = parseFlexiblePhoneNumber(phoneNumber, region);
  if (!parsed || !parsed.isValid()) {
    throw new Error(`Invalid phone number for ${provider}: ${phoneNumber}`);
  }

  return config.output === "national" ? parsed.nationalNumber : parsed.number;
}

import crypto from "crypto";
import {
  encryptAES,
  decryptAES,
  encryptField,
  decryptField,
  getEncryptionKeys,
  deriveKey,
  deriveUserKey,
  serializePayload,
  deserializePayload,
  type EncryptedPayload,
} from "./encryption";
import { env } from "../config/env";

export {
  encryptAES,
  decryptAES,
  encryptField,
  decryptField,
  getEncryptionKeys,
  deriveKey,
  deriveUserKey,
  serializePayload,
  deserializePayload,
};
export type { EncryptedPayload };

const ALGORITHM = "aes-256-gcm" as const;
const IV_LENGTH = 12; // 96-bit IV recommended for AES-GCM
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

/**
 * Generates a secure random 12-byte (96-bit) Initialization Vector (IV) for AES-256-GCM.
 */
export function generateIV(): Buffer {
  return crypto.randomBytes(IV_LENGTH);
}

/**
 * Encrypts plaintext string using AES-256-GCM with secure IV generation.
 * Returns payload containing IV, authTag, ciphertext, and serialized string representation.
 */
export function encryptAES256GCM(
  plaintext: string,
  keyMaterial?: Buffer | string,
): {
  iv: string;
  authTag: string;
  ciphertext: string;
  encrypted: string;
} {
  const masterKey =
    typeof keyMaterial === "string"
      ? deriveKey(keyMaterial)
      : Buffer.isBuffer(keyMaterial)
        ? keyMaterial
        : deriveKey(process.env.DB_ENCRYPTION_KEY || env.DB_ENCRYPTION_KEY);

  const payload = encryptAES(plaintext, masterKey);
  return {
    ...payload,
    encrypted: serializePayload(payload),
  };
}

/**
 * Decrypts AES-256-GCM encrypted string or payload verifying authentication tag.
 * Throws error if tag verification fails or payload is invalid.
 */
export function decryptAES256GCM(
  raw: string | EncryptedPayload,
  keyMaterial?: Buffer | string,
): string {
  const masterKey =
    typeof keyMaterial === "string"
      ? deriveKey(keyMaterial)
      : Buffer.isBuffer(keyMaterial)
        ? keyMaterial
        : deriveKey(process.env.DB_ENCRYPTION_KEY || env.DB_ENCRYPTION_KEY);

  const payload = typeof raw === "string" ? deserializePayload(raw) : raw;
  return decryptAES(payload, masterKey);
}

/**
 * Encrypts PII field transparently using AES-256-GCM.
 */
export function encryptPii(
  value: string | null | undefined,
): string | null | undefined {
  return encryptField(value);
}

/**
 * Decrypts PII field transparently using AES-256-GCM.
 */
export function decryptPii(
  raw: string | null | undefined,
): string | null | undefined {
  return decryptField(raw);
}

/**
 * Checks if a given raw database payload needs re-encryption.
 * It needs re-encryption if it's not encrypted with the currently active key version.
 */
export function needsReencryption(
  rawPayload: string | null | undefined,
): boolean {
  if (!rawPayload) return false;

  const activeVersion = (
    process.env.ACTIVE_ENCRYPTION_KEY_VERSION || ""
  ).toLowerCase();

  // If no active version is set, or it's set to legacy, we cannot perform rotation
  if (!activeVersion || activeVersion === "legacy") {
    return false;
  }

  const parts = rawPayload.split(":");

  // Versioned payload format: version:iv:authTag:ciphertext
  if (parts.length >= 4) {
    const version = parts[0].toLowerCase();
    return version !== activeVersion;
  }

  // If it's legacy (3 parts) or invalid, it needs re-encryption (if valid)
  return true;
}

/**
 * Re-encrypts a raw payload if it's outdated, returning the new raw encrypted string.
 * Returns null if no re-encryption is needed or if input is empty.
 */
export function reencryptIfNeeded(
  rawPayload: string | null | undefined,
): string | null {
  if (!needsReencryption(rawPayload)) {
    return null;
  }

  // Decrypt using the current appropriate key
  const decrypted = decryptField(rawPayload);
  if (decrypted == null || decrypted === rawPayload) {
    // Decryption failed or returned as-is
    return null;
  }

  // Encrypt with the new active key
  const reencrypted = encryptField(decrypted);
  if (reencrypted === rawPayload || !reencrypted) {
    return null;
  }

  return reencrypted;
}

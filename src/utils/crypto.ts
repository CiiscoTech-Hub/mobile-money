import { encryptField, decryptField, getEncryptionKeys } from "./encryption";

/**
 * Checks if a given raw database payload needs re-encryption.
 * It needs re-encryption if it's not encrypted with the currently active key version.
 */
export function needsReencryption(rawPayload: string | null | undefined): boolean {
  if (!rawPayload) return false;

  const activeVersion = (process.env.ACTIVE_ENCRYPTION_KEY_VERSION || "").toLowerCase();
  
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
export function reencryptIfNeeded(rawPayload: string | null | undefined): string | null {
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

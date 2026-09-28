/**
 * src/crypto/aesGcm.ts
 *
 * Canonical AES-256-GCM primitives shared by every encryption-backed storage
 * path in the codebase:
 *
 *   - PII fields            → src/utils/encryption.ts (encryptAES/decryptAES)
 *   - fuzz/bench harness    → src/crypto/encryption.ts (encryptAesGcm/decryptAesGcm)
 *   - database backups      → src/services/backupService.ts (encryptBackup/decryptBackup)
 *   - SAR reports           → src/compliance/sar.ts (encryptBuffer)
 *   - compliance PDFs       → src/services/complianceReportService.ts (encryptBuffer)
 *
 * Previously each caller re-implemented the same cipher logic inline with its
 * own copy of the algorithm constants, IV/auth-tag handling and serialisation
 * format — duplicated crypto code that can silently drift apart. This module
 * is the single source of truth for the AES-256-GCM core.
 *
 * Two serialisation formats are provided:
 *   - Hex payload ({ iv, ciphertext, authTag }) — for PII field storage
 *   - Binary [IV][AuthTag][Ciphertext] layout   — for file/backup storage
 *
 * Callers keep their own key-derivation (HKDF/scrypt/PBKDF2 with domain
 * separation) so existing stored data remains decryptable.
 */

import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

export const AES_GCM_ALGORITHM = "aes-256-gcm" as const;
export const IV_LENGTH = 12; // 96-bit IV — recommended for GCM
export const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

/** Hex-encoded AES-256-GCM payload. */
export interface AesGcmPayload {
  iv: string; // hex
  ciphertext: string; // hex
  authTag: string; // hex
}

function assertKeyLength(key: Buffer): void {
  if (key.length !== 32) {
    throw new Error("key must be 32 bytes");
  }
}

/**
 * Encrypt a Buffer with AES-256-GCM.
 * A fresh random IV is generated for every call — IVs are NEVER reused.
 *
 * @param plaintext The data to encrypt
 * @param key       32-byte AES key (derive it with your domain's KDF)
 */
export function encryptAesGcm(plaintext: Buffer, key: Buffer): AesGcmPayload {
  assertKeyLength(key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(AES_GCM_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

/**
 * Decrypt a hex-encoded AES-256-GCM payload.
 * Throws on authentication failure (tampered data or wrong key).
 *
 * @param payload The AesGcmPayload produced by encryptAesGcm()
 * @param key     The same 32-byte AES key used during encryption
 */
export function decryptAesGcm(payload: AesGcmPayload, key: Buffer): Buffer {
  assertKeyLength(key);
  const iv = Buffer.from(payload.iv, "hex");
  const ciphertext = Buffer.from(payload.ciphertext, "hex");
  const authTag = Buffer.from(payload.authTag, "hex");
  const decipher = createDecipheriv(AES_GCM_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Encrypt a Buffer with AES-256-GCM into a self-contained binary layout:
 * [IV (12 bytes)][AuthTag (16 bytes)][Ciphertext].
 * Used for file/backup storage where a hex string payload is impractical.
 */
export function encryptAesGcmToBuffer(plaintext: Buffer, key: Buffer): Buffer {
  const payload = encryptAesGcm(plaintext, key);
  return Buffer.concat([
    Buffer.from(payload.iv, "hex"),
    Buffer.from(payload.authTag, "hex"),
    Buffer.from(payload.ciphertext, "hex"),
  ]);
}

/**
 * Decrypt a binary [IV][AuthTag][Ciphertext] buffer produced by
 * encryptAesGcmToBuffer(). Throws on authentication failure.
 */
export function decryptAesGcmFromBuffer(data: Buffer, key: Buffer): Buffer {
  assertKeyLength(key);
  if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Encrypted buffer too short");
  }
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(AES_GCM_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

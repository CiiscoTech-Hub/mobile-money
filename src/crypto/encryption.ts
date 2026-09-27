import { createHash } from "crypto";
import { encryptAesGcm, decryptAesGcm, type AesGcmPayload } from "./aesGcm";

/** Hex-encoded AES-256-GCM payload (alias of the canonical AesGcmPayload). */
export interface Encrypted extends AesGcmPayload {}

/**
 * Derive a 32-byte AES key from a password using a single SHA-256.
 * This is intentionally simple for tests/fuzzing. For production use a
 * proper KDF (PBKDF2/Argon2/ HKDF) with salt and iterations.
 */
export function deriveKey(password: string): Buffer {
  return createHash("sha256").update(password, "utf8").digest();
}

// AES-256-GCM primitives — canonical implementation lives in ./aesGcm.
export { encryptAesGcm, decryptAesGcm };
export type { AesGcmPayload };

export default {
  deriveKey,
  encryptAesGcm,
  decryptAesGcm,
};

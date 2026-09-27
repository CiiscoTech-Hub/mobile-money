/**
 * tests/crypto/aesGcm.test.ts
 *
 * Unit tests for the canonical AES-256-GCM primitives (src/crypto/aesGcm.ts)
 * that back the PII field encryption, database backups, SAR reports and
 * compliance PDF encryption paths.
 */

import crypto from "crypto";
import {
  AES_GCM_ALGORITHM,
  IV_LENGTH,
  AUTH_TAG_LENGTH,
  encryptAesGcm,
  decryptAesGcm,
  encryptAesGcmToBuffer,
  decryptAesGcmFromBuffer,
  type AesGcmPayload,
} from "../../src/crypto/aesGcm";

function makeKey(): Buffer {
  return crypto.randomBytes(32);
}

describe("AES-256-GCM hex payload primitives", () => {
  it("encrypts and decrypts a buffer round-trip", () => {
    const key = makeKey();
    const plaintext = Buffer.from("sensitive payload");

    const encrypted = encryptAesGcm(plaintext, key);
    expect(decryptAesGcm(encrypted, key)).toEqual(plaintext);
  });

  it("encrypted output is hex and does not leak plaintext", () => {
    const key = makeKey();
    const plaintext = Buffer.from("Alice Dupont");

    const payload = encryptAesGcm(plaintext, key);
    expect(payload.iv).toMatch(/^[0-9a-f]+$/);
    expect(payload.authTag).toMatch(/^[0-9a-f]+$/);
    expect(payload.ciphertext).toMatch(/^[0-9a-f]+$/);
    expect(payload.ciphertext).not.toContain(plaintext.toString("utf8"));
  });

  it("uses a unique IV and ciphertext for repeated encryptions", () => {
    const key = makeKey();
    const plaintext = Buffer.from("repeat me");

    const p1 = encryptAesGcm(plaintext, key);
    const p2 = encryptAesGcm(plaintext, key);
    expect(p1.iv).not.toBe(p2.iv);
    expect(p1.ciphertext).not.toBe(p2.ciphertext);
  });

  it("rejects keys that are not 32 bytes", () => {
    const shortKey = crypto.randomBytes(16);
    expect(() => encryptAesGcm(Buffer.from("x"), shortKey)).toThrow(/32 bytes/);
    const longKey = crypto.randomBytes(33);
    expect(() => encryptAesGcm(Buffer.from("x"), longKey)).toThrow(/32 bytes/);
  });

  it("throws on tampered ciphertext", () => {
    const key = makeKey();
    const payload = encryptAesGcm(Buffer.from("original"), key);
    const tampered: AesGcmPayload = {
      ...payload,
      ciphertext: "00" + payload.ciphertext.slice(2),
    };
    expect(() => decryptAesGcm(tampered, key)).toThrow();
  });

  it("throws on tampered auth tag", () => {
    const key = makeKey();
    const payload = encryptAesGcm(Buffer.from("original"), key);
    const tampered: AesGcmPayload = {
      ...payload,
      authTag: "00".repeat(AUTH_TAG_LENGTH),
    };
    expect(() => decryptAesGcm(tampered, key)).toThrow();
  });

  it("throws when decrypting with the wrong key", () => {
    const key = makeKey();
    const wrongKey = makeKey();
    const payload = encryptAesGcm(Buffer.from("secret"), key);
    expect(() => decryptAesGcm(payload, wrongKey)).toThrow();
  });
});

describe("AES-256-GCM binary [IV][AuthTag][Ciphertext] layout", () => {
  it("encrypts and decrypts a buffer round-trip", () => {
    const key = makeKey();
    const plaintext = Buffer.from("pg_dump output");

    const encrypted = encryptAesGcmToBuffer(plaintext, key);
    expect(decryptAesGcmFromBuffer(encrypted, key)).toEqual(plaintext);
  });

  it("prepends exactly IV + AuthTag to the ciphertext", () => {
    const key = makeKey();
    const plaintext = crypto.randomBytes(256);

    const encrypted = encryptAesGcmToBuffer(plaintext, key);
    expect(encrypted.length).toBe(IV_LENGTH + AUTH_TAG_LENGTH + 256);
  });

  it("produces different ciphertext for the same plaintext (fresh IV)", () => {
    const key = makeKey();
    const plaintext = Buffer.from("same backup");

    const e1 = encryptAesGcmToBuffer(plaintext, key);
    const e2 = encryptAesGcmToBuffer(plaintext, key);
    expect(e1.equals(e2)).toBe(false);
    expect(decryptAesGcmFromBuffer(e1, key)).toEqual(plaintext);
    expect(decryptAesGcmFromBuffer(e2, key)).toEqual(plaintext);
  });

  it("rejects keys that are not 32 bytes", () => {
    const shortKey = crypto.randomBytes(16);
    expect(() => encryptAesGcmToBuffer(Buffer.from("x"), shortKey)).toThrow(
      /32 bytes/,
    );
    expect(() =>
      decryptAesGcmFromBuffer(crypto.randomBytes(64), shortKey),
    ).toThrow(/32 bytes/);
  });

  it("throws on tampered ciphertext", () => {
    const key = makeKey();
    const plaintext = Buffer.from("database dump");
    const encrypted = encryptAesGcmToBuffer(plaintext, key);

    // Flip a byte inside the ciphertext section
    encrypted[IV_LENGTH + AUTH_TAG_LENGTH] ^= 0xff;
    expect(() => decryptAesGcmFromBuffer(encrypted, key)).toThrow();
  });

  it("throws on tampered auth tag", () => {
    const key = makeKey();
    const encrypted = encryptAesGcmToBuffer(Buffer.from("database dump"), key);
    encrypted[IV_LENGTH] ^= 0xff; // first auth-tag byte
    expect(() => decryptAesGcmFromBuffer(encrypted, key)).toThrow();
  });

  it("throws on an input buffer that is too short to hold IV + auth tag", () => {
    const key = makeKey();
    expect(() => decryptAesGcmFromBuffer(crypto.randomBytes(10), key)).toThrow(
      /too short/,
    );
  });
});

describe("shared constants", () => {
  it("uses AES-256-GCM with a 12-byte IV and 16-byte auth tag", () => {
    expect(AES_GCM_ALGORITHM).toBe("aes-256-gcm");
    expect(IV_LENGTH).toBe(12);
    expect(AUTH_TAG_LENGTH).toBe(16);
  });

  it("hex and binary layouts decrypt to the same plaintext", () => {
    const key = makeKey();
    const plaintext = Buffer.from("cross-format check");

    const hexPayload = encryptAesGcm(plaintext, key);
    const binary = encryptAesGcmToBuffer(plaintext, key);

    expect(decryptAesGcm(hexPayload, key).equals(plaintext)).toBe(true);
    expect(decryptAesGcmFromBuffer(binary, key).equals(plaintext)).toBe(true);
  });
});

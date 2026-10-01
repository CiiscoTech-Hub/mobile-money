import { generateKeyPairSync } from "crypto";
import { Keypair } from "stellar-sdk";
import {
  signWebhookPayloadEd25519,
  verifyWebhookPayloadEd25519,
  derivePublicSigningKey,
  signWebhookPayload,
} from "../../src/crypto/webhookSigning";

describe("webhookSigning", () => {
  const payload = JSON.stringify({ event: "transaction.completed", id: "1" });

  describe("Stellar keypair signing", () => {
    const kp = Keypair.random();

    it("signs and verifies a payload with a Stellar secret seed", () => {
      const header = signWebhookPayloadEd25519(payload, kp.secret());
      expect(header).toMatch(/^ed25519=[0-9a-f]{128}$/);

      const valid = verifyWebhookPayloadEd25519(
        payload,
        header,
        kp.publicKey(),
      );
      expect(valid).toBe(true);
    });

    it("fails verification when the payload is tampered with", () => {
      const header = signWebhookPayloadEd25519(payload, kp.secret());
      const tampered = payload + "x";

      expect(
        verifyWebhookPayloadEd25519(tampered, header, kp.publicKey()),
      ).toBe(false);
    });

    it("fails verification against the wrong public key", () => {
      const header = signWebhookPayloadEd25519(payload, kp.secret());
      const otherKp = Keypair.random();

      expect(
        verifyWebhookPayloadEd25519(payload, header, otherKp.publicKey()),
      ).toBe(false);
    });
  });

  describe("PEM keypair signing", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privatePem = privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    const publicPem = publicKey
      .export({ type: "spki", format: "pem" })
      .toString();

    it("signs and verifies a payload with a PEM Ed25519 key pair", () => {
      const header = signWebhookPayloadEd25519(payload, privatePem);
      expect(header.startsWith("ed25519=")).toBe(true);

      expect(verifyWebhookPayloadEd25519(payload, header, publicPem)).toBe(
        true,
      );
    });
  });

  describe("verifyWebhookPayloadEd25519 edge cases", () => {
    it("returns false for a non-ed25519 signature header", () => {
      expect(
        verifyWebhookPayloadEd25519(payload, "sha256=deadbeef", "G".repeat(56)),
      ).toBe(false);
    });

    it("returns false (not throw) for a malformed public key", () => {
      expect(
        verifyWebhookPayloadEd25519(
          payload,
          "ed25519=" + "00".repeat(64),
          "not-a-key",
        ),
      ).toBe(false);
    });
  });

  describe("derivePublicSigningKey", () => {
    it("derives the Stellar public key and a stable key ID from a secret seed", () => {
      const kp = Keypair.random();
      const { publicKey, keyId } = derivePublicSigningKey(kp.secret());

      expect(publicKey).toBe(kp.publicKey());
      expect(keyId).toMatch(/^[0-9a-f]{16}$/);

      // Deterministic: same key always yields the same keyId
      const again = derivePublicSigningKey(kp.secret());
      expect(again.keyId).toBe(keyId);
    });

    it("derives a PEM public key from a PEM private key", () => {
      const { privateKey } = generateKeyPairSync("ed25519");
      const privatePem = privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString();

      const { publicKey, keyId } = derivePublicSigningKey(privatePem);
      expect(publicKey).toContain("BEGIN PUBLIC KEY");
      expect(keyId).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  describe("signWebhookPayload", () => {
    const hmacSigner = (p: string) => `sha256=fake-hmac-of-${p.length}`;

    it("falls back to the HMAC signer when no Ed25519 key is configured", () => {
      const result = signWebhookPayload(payload, hmacSigner, undefined);
      expect(result.scheme).toBe("sha256");
      expect(result.signature).toBe(hmacSigner(payload));
      expect(result.keyId).toBeUndefined();
    });

    it("signs with Ed25519 and includes a keyId when a signing key is configured", () => {
      const kp = Keypair.random();
      const result = signWebhookPayload(payload, hmacSigner, kp.secret());

      expect(result.scheme).toBe("ed25519");
      expect(result.keyId).toMatch(/^[0-9a-f]{16}$/);
      expect(
        verifyWebhookPayloadEd25519(payload, result.signature, kp.publicKey()),
      ).toBe(true);
    });
  });
});

import { describe, it, expect } from "@jest/globals";
import { TOTPService, totpService, verifyTOTPToken } from "../totp";
import speakeasy from "speakeasy";

describe("TOTPService", () => {
  const secret = speakeasy.generateSecret({ length: 32 }).base32;

  describe("verifyTOTP", () => {
    it("should return true for a valid TOTP token", () => {
      const token = speakeasy.totp({ secret, encoding: "base32" });
      const isValid = totpService.verifyTOTP(secret, token);
      expect(isValid).toBe(true);
    });

    it("should return false for an invalid TOTP token", () => {
      const isValid = totpService.verifyTOTP(secret, "000000");
      expect(isValid).toBe(false);
    });

    it("should return false when secret or token is empty", () => {
      expect(totpService.verifyTOTP("", "123456")).toBe(false);
      expect(totpService.verifyTOTP(secret, "")).toBe(false);
    });

    it("should trim whitespace from token", () => {
      const token = speakeasy.totp({ secret, encoding: "base32" });
      const isValid = totpService.verifyTOTP(secret, `  ${token}  `);
      expect(isValid).toBe(true);
    });
  });

  describe("verifyTOTPToken", () => {
    it("should correctly verify token via standalone function", () => {
      const token = speakeasy.totp({ secret, encoding: "base32" });
      expect(verifyTOTPToken(secret, token)).toBe(true);
      expect(verifyTOTPToken(secret, "999999")).toBe(false);
    });
  });

  describe("generateSecret", () => {
    it("should generate a valid secret with label and issuer", () => {
      const generated = totpService.generateSecret("user@example.com", "TestApp");
      expect(generated).toHaveProperty("base32");
      expect(generated.otpauth_url).toContain("TestApp");
      expect(generated.otpauth_url).toContain("user%40example.com");
    });
  });

  describe("generateToken", () => {
    it("should generate a 6-digit TOTP token", () => {
      const token = totpService.generateToken(secret);
      expect(token).toMatch(/^\d{6}$/);
      expect(totpService.verifyTOTP(secret, token)).toBe(true);
    });
  });
});

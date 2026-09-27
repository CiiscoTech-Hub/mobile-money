import speakeasy from "speakeasy";

export interface TOTPVerifyOptions {
  secret: string;
  token: string;
  window?: number;
}

export class TOTPService {
  /**
   * Verifies a TOTP token against a secret using Speakeasy
   * @param secret Base32 encoded TOTP secret
   * @param token 6-digit TOTP code provided by the user
   * @param window Time window for token drift tolerance (default: 2)
   * @returns True if the token is valid, false otherwise
   */
  public verifyTOTP(secret: string, token: string, window: number = 2): boolean {
    if (!secret || !token) {
      return false;
    }
    try {
      return speakeasy.totp.verify({
        secret,
        encoding: "base32",
        token: token.trim(),
        window,
      });
    } catch {
      return false;
    }
  }

  /**
   * Generates a new TOTP secret
   * @param label Name or email for the TOTP key label
   * @param issuer Issuer name (default: "Mobile Money")
   */
  public generateSecret(label: string, issuer: string = "Mobile Money") {
    return speakeasy.generateSecret({
      name: `${issuer} (${label})`,
      issuer,
      length: 32,
    });
  }

  /**
   * Generates a current TOTP token for testing/verification
   * @param secret Base32 encoded secret
   */
  public generateToken(secret: string): string {
    return speakeasy.totp({
      secret,
      encoding: "base32",
    });
  }
}

export const totpService = new TOTPService();

/**
 * Convenience function to verify a TOTP token against a secret
 */
export function verifyTOTPToken(
  secret: string,
  token: string,
  window: number = 2,
): boolean {
  return totpService.verifyTOTP(secret, token, window);
}

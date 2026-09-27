/**
 * Tests for src/utils/validators.ts (issue #1579)
 *
 * Covers:
 *   1. validateCountryCode  — alpha-2, alpha-3, invalid, edge cases
 *   2. validatePassportNumber — per-country format, fallback, edge cases
 *   3. getVerificationCountries — list completeness, region distribution,
 *      passport-enabled subset, no duplicate alpha2/alpha3 codes
 */

import {
  validateCountryCode,
  validatePassportNumber,
  getVerificationCountries,
  ISO_ALPHA2_MAP,
  ISO_ALPHA3_TO_ALPHA2,
} from "../../src/utils/validators";

// ─────────────────────────────────────────────────────────────────────────────
// validateCountryCode
// ─────────────────────────────────────────────────────────────────────────────

describe("validateCountryCode", () => {
  describe("alpha-2 codes", () => {
    it.each([
      ["CM", "Cameroon"],
      ["NG", "Nigeria"],
      ["KE", "Kenya"],
      ["ZA", "South Africa"],
      ["GH", "Ghana"],
      ["US", "United States"],
      ["GB", "United Kingdom"],
      ["DE", "Germany"],
      ["IN", "India"],
      ["AU", "Australia"],
    ])("accepts valid alpha-2 %s → %s", (code, expectedName) => {
      const result = validateCountryCode(code);
      expect(result.valid).toBe(true);
      expect(result.alpha2).toBe(code);
      expect(result.countryName).toBe(expectedName);
    });

    it("is case-insensitive", () => {
      expect(validateCountryCode("ng").valid).toBe(true);
      expect(validateCountryCode("Ng").valid).toBe(true);
      expect(validateCountryCode("NG").valid).toBe(true);
    });

    it("rejects unknown alpha-2", () => {
      const r = validateCountryCode("XX");
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/alpha-2/i);
    });
  });

  describe("alpha-3 codes", () => {
    it.each([
      ["CMR", "CM", "Cameroon"],
      ["NGA", "NG", "Nigeria"],
      ["KEN", "KE", "Kenya"],
      ["USA", "US", "United States"],
      ["GBR", "GB", "United Kingdom"],
      ["DEU", "DE", "Germany"],
      ["IND", "IN", "India"],
      ["AUS", "AU", "Australia"],
      ["ZAF", "ZA", "South Africa"],
      ["TZA", "TZ", "Tanzania"],
    ])("resolves alpha-3 %s → alpha-2 %s (%s)", (a3, expectedA2, expectedName) => {
      const result = validateCountryCode(a3);
      expect(result.valid).toBe(true);
      expect(result.alpha2).toBe(expectedA2);
      expect(result.countryName).toBe(expectedName);
    });

    it("is case-insensitive for alpha-3", () => {
      expect(validateCountryCode("cmr").valid).toBe(true);
      expect(validateCountryCode("Cmr").valid).toBe(true);
    });

    it("rejects unknown alpha-3", () => {
      const r = validateCountryCode("ZZZ");
      expect(r.valid).toBe(false);
      expect(r.error).toMatch(/alpha-3/i);
    });
  });

  describe("edge cases", () => {
    it("rejects empty string", () => {
      expect(validateCountryCode("").valid).toBe(false);
    });

    it("rejects codes of wrong length", () => {
      expect(validateCountryCode("N").valid).toBe(false);
      expect(validateCountryCode("NGAA").valid).toBe(false);
    });

    // @ts-expect-error — intentional runtime check
    it("rejects non-string input", () => {
      expect(validateCountryCode(null as any).valid).toBe(false);
      expect(validateCountryCode(undefined as any).valid).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validatePassportNumber
// ─────────────────────────────────────────────────────────────────────────────

describe("validatePassportNumber", () => {
  describe("African countries", () => {
    it.each([
      ["CM", "AB1234567", true],   // Cameroon 2L+7D
      ["NG", "A12345678", true],   // Nigeria  1L+8D
      ["GH", "G1234567",  true],   // Ghana    G+7D
      ["KE", "A1234567",  true],   // Kenya    1L+7D
      ["ZA", "A12345678", true],   // South Africa 1L+8D
    ])("%s passport %s → valid=%s", (country, num, expected) => {
      expect(validatePassportNumber(country, num).valid).toBe(expected);
    });

    it("rejects wrong format for Cameroon", () => {
      const r = validatePassportNumber("CM", "A1234567"); // only 1 letter
      expect(r.valid).toBe(false);
      expect(r.error).toBeDefined();
    });
  });

  describe("Americas", () => {
    it.each([
      ["US", "AB1234567", true],   // 9 alphanumeric
      ["US", "123456789", true],   // 9 digits also valid
      ["CA", "AB123456",  true],   // Canada 2L+6D
      ["BR", "AB123456",  true],   // Brazil 2L+6D
    ])("%s passport %s → valid=%s", (country, num, expected) => {
      expect(validatePassportNumber(country, num).valid).toBe(expected);
    });
  });

  describe("Asia", () => {
    it.each([
      ["IN", "A1234567",  true],   // India  1L + non-zero + 7D
      ["PK", "AB1234567", true],   // Pakistan 2L+7D
      ["CN", "A12345678", true],   // China 1L+8D
      ["JP", "AB1234567", true],   // Japan 2L+7D
    ])("%s passport %s → valid=%s", (country, num, expected) => {
      expect(validatePassportNumber(country, num).valid).toBe(expected);
    });
  });

  describe("Europe", () => {
    it.each([
      ["GB", "123456789", true],   // UK  9 digits
      ["DE", "AB1234567", true],   // Germany 9 alphanumeric
      ["IT", "AB1234567", true],   // Italy 2L+7D
    ])("%s passport %s → valid=%s", (country, num, expected) => {
      expect(validatePassportNumber(country, num).valid).toBe(expected);
    });
  });

  describe("alpha-3 country codes", () => {
    it("accepts alpha-3 input (CMR = Cameroon)", () => {
      expect(validatePassportNumber("CMR", "AB1234567").valid).toBe(true);
    });

    it("resolves NGA to NG pattern", () => {
      expect(validatePassportNumber("NGA", "A12345678").valid).toBe(true);
    });
  });

  describe("fallback pattern for unlisted countries", () => {
    it("allows 6-12 alphanumeric for unknown country code", () => {
      // XK (Kosovo) has no specific pattern → uses generic fallback
      expect(validatePassportNumber("XK", "AB123456").valid).toBe(true);
    });
  });

  describe("normalisation", () => {
    it("uppercases and strips spaces before matching", () => {
      expect(validatePassportNumber("CM", "ab 1234567").valid).toBe(true);
    });

    it("strips hyphens before matching", () => {
      expect(validatePassportNumber("CM", "AB-1234567").valid).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("rejects empty passport number", () => {
      expect(validatePassportNumber("NG", "").valid).toBe(false);
    });

    it("rejects invalid country code", () => {
      const r = validatePassportNumber("ZZZ", "A12345678");
      expect(r.valid).toBe(false);
    });

    // @ts-expect-error — intentional runtime check
    it("rejects null passport number", () => {
      expect(validatePassportNumber("NG", null as any).valid).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getVerificationCountries
// ─────────────────────────────────────────────────────────────────────────────

describe("getVerificationCountries", () => {
  const countries = getVerificationCountries();

  it("returns more than 150 countries", () => {
    expect(countries.length).toBeGreaterThan(150);
  });

  it("covers all five regions", () => {
    const regions = new Set(countries.map((c) => c.region));
    expect(regions).toContain("Africa");
    expect(regions).toContain("Americas");
    expect(regions).toContain("Asia");
    expect(regions).toContain("Europe");
    expect(regions).toContain("Oceania");
  });

  it("includes key African mobile-money markets", () => {
    const alpha2s = new Set(countries.map((c) => c.alpha2));
    ["CM", "NG", "KE", "GH", "TZ", "UG", "RW", "ZA", "SN", "ET"].forEach(
      (code) => expect(alpha2s).toContain(code),
    );
  });

  it("has no duplicate alpha-2 codes", () => {
    const alpha2s = countries.map((c) => c.alpha2);
    const unique  = new Set(alpha2s);
    expect(alpha2s.length).toBe(unique.size);
  });

  it("has no duplicate alpha-3 codes", () => {
    const alpha3s = countries.map((c) => c.alpha3);
    const unique  = new Set(alpha3s);
    expect(alpha3s.length).toBe(unique.size);
  });

  it("every entry has a non-empty name", () => {
    countries.forEach((c) => {
      expect(c.name.length).toBeGreaterThan(0);
    });
  });

  it("every alpha2 in the list is valid per validateCountryCode", () => {
    countries.forEach((c) => {
      const r = validateCountryCode(c.alpha2);
      expect(r.valid).toBe(true);
    });
  });

  it("every alpha3 in the list is valid per validateCountryCode", () => {
    countries.forEach((c) => {
      const r = validateCountryCode(c.alpha3);
      expect(r.valid).toBe(true);
    });
  });

  it("passport-enabled countries have a recognisable ICAO format", () => {
    const enabled = countries.filter((c) => c.passportVerificationEnabled);
    expect(enabled.length).toBeGreaterThan(20);

    // Spot-check: these should all be passport-enabled
    const enabledSet = new Set(enabled.map((c) => c.alpha2));
    ["CM", "NG", "KE", "US", "GB", "IN", "AU"].forEach((code) => {
      expect(enabledSet).toContain(code);
    });
  });

  it("alpha3 correctly maps back to alpha2 via ISO_ALPHA3_TO_ALPHA2", () => {
    countries.forEach((c) => {
      expect(ISO_ALPHA3_TO_ALPHA2[c.alpha3]).toBe(c.alpha2);
    });
  });

  it("alpha2 appears in ISO_ALPHA2_MAP", () => {
    countries.forEach((c) => {
      expect(ISO_ALPHA2_MAP[c.alpha2]).toBeDefined();
    });
  });
});

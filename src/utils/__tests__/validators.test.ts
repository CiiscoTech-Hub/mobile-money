import {
  parseExpiryDate,
  isDocumentExpired,
  validateExpiryDate,
} from "../validators";

describe("Document Expiry Date Validators", () => {
  const referenceDate = new Date("2026-07-24T12:00:00Z");

  describe("parseExpiryDate", () => {
    it("should parse ISO date strings", () => {
      const parsed = parseExpiryDate("2028-12-31");
      expect(parsed).toBeInstanceOf(Date);
      expect(parsed?.getUTCFullYear()).toBe(2028);
      expect(parsed?.getUTCMonth()).toBe(11);
      expect(parsed?.getUTCDate()).toBe(31);
    });

    it("should parse date string with slashes", () => {
      const parsed = parseExpiryDate("2027/05/15");
      expect(parsed).toBeInstanceOf(Date);
      expect(parsed?.getUTCFullYear()).toBe(2027);
    });

    it("should parse Date instances", () => {
      const input = new Date("2029-01-01");
      const parsed = parseExpiryDate(input);
      expect(parsed).toEqual(input);
    });

    it("should parse numeric timestamps", () => {
      const timestamp = new Date("2027-01-01").getTime();
      const parsed = parseExpiryDate(timestamp);
      expect(parsed?.getUTCFullYear()).toBe(2027);
    });

    it("should return null for invalid date strings", () => {
      expect(parseExpiryDate("invalid-date")).toBeNull();
      expect(parseExpiryDate("2025-13-45")).toBeNull();
      expect(parseExpiryDate("2025-02-31")).toBeNull();
    });

    it("should return null for empty/null/undefined inputs", () => {
      expect(parseExpiryDate("")).toBeNull();
      expect(parseExpiryDate(null)).toBeNull();
      expect(parseExpiryDate(undefined)).toBeNull();
    });
  });

  describe("isDocumentExpired", () => {
    it("should return true for dates in the past", () => {
      expect(isDocumentExpired("2024-01-01", referenceDate)).toBe(true);
      expect(isDocumentExpired("2025-12-31", referenceDate)).toBe(true);
    });

    it("should return false for future dates", () => {
      expect(isDocumentExpired("2027-01-01", referenceDate)).toBe(false);
      expect(isDocumentExpired("2030-06-15", referenceDate)).toBe(false);
    });

    it("should return true for unparseable dates", () => {
      expect(isDocumentExpired("invalid", referenceDate)).toBe(true);
    });
  });

  describe("validateExpiryDate", () => {
    it("should return valid for future dates", () => {
      const result = validateExpiryDate("2028-10-20", { referenceDate });
      expect(result.isValid).toBe(true);
      expect(result.isExpired).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("should reject expired dates in the past", () => {
      const result = validateExpiryDate("2022-05-10", { referenceDate });
      expect(result.isValid).toBe(false);
      expect(result.isExpired).toBe(true);
      expect(result.error).toContain("expired");
    });

    it("should reject invalid date format strings", () => {
      const result = validateExpiryDate("not-a-date", { referenceDate });
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("Invalid expiry date format");
    });

    it("should handle optional empty input when not required", () => {
      const result = validateExpiryDate("", { required: false });
      expect(result.isValid).toBe(true);
    });

    it("should reject empty input when required", () => {
      const result = validateExpiryDate("", { required: true });
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("required");
    });
  });
});

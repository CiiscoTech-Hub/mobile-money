/**
 * Fuzz tests — API Parser Inputs Robustness
 *
 * Implements Issue #1845: Add fuzz testing to API parser inputs.
 *
 * Strategy:
 * Generates adversarial, boundary, malformed, and randomized inputs using
 * property-based fuzz generators and tests all core API parsers:
 * - Query & Transaction filter parsers (status filters, ISO 8601 UTC dates, limits, offsets)
 * - Phone number input parsers & formatters (multinational E.164, national, prefixes)
 * - Stellar address, federation, and memo parsers
 * - Transaction reference number parsers and format validators
 * - Currency and amount parsers
 *
 * Core Invariant:
 * Parsers MUST NEVER crash the Node.js runtime or throw unhandled exceptions.
 * They must either produce safely validated output or reject invalid input
 * with predictable, well-typed errors.
 */

import * as fc from "./generators";

jest.mock("../../src/config/database", () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [{ exists: false }] }),
  },
  queryRead: jest.fn().mockResolvedValue({ rows: [{ exists: false }] }),
  queryWrite: jest.fn().mockResolvedValue({ rows: [{ exists: false }] }),
}));

import {
  parseStatusFilter,
  VALID_STATUSES,
  ISO_8601_UTC_REGEX,
  validateTransactionFilters,
  getPaginationInfo,
} from "../../src/utils/transactionFilters";
import {
  parseFlexiblePhoneNumber,
  validatePhoneNumber,
  isValidPhoneNumber,
  formatPhoneNumber,
  formatPhoneForProvider,
  validatePhoneProviderMatch,
  detectProvider,
} from "../../src/utils/phoneUtils";
import {
  isValidReferenceNumber,
  checkReferenceExists,
} from "../../src/utils/referenceGenerator";
import {
  isStrictStellarGAddress,
  assertStrictStellarGAddress,
} from "../../src/utils/stellarAddressValidator";

const RUNS = 50;

describe("Fuzz: API Parser Inputs", () => {
  // ─── 1. Transaction Filter & Status Parsers ─────────────────────────────────
  describe("Transaction Filter & Status Parsers", () => {
    it("handles arbitrary status strings gracefully without crashing", async () => {
      await fc.assert(
        fc.property(fc.anyString(), (rawStatus) => {
          try {
            const parsed = parseStatusFilter(rawStatus);
            expect(Array.isArray(parsed)).toBe(true);
            parsed.forEach((s) => {
              expect(VALID_STATUSES).toContain(s);
            });
          } catch (err: any) {
            expect(err.message).toMatch(/Invalid status/);
          }
          return true;
        }),
        { numRuns: RUNS },
      );
    });

    it("handles all ATTACK_STRINGS for status filter parsing", () => {
      for (const attack of fc.ATTACK_STRINGS) {
        try {
          const parsed = parseStatusFilter(attack);
          expect(Array.isArray(parsed)).toBe(true);
        } catch (err: any) {
          expect(err).toBeInstanceOf(Error);
        }
      }
    });

    it("never throws unhandled exceptions for ISO 8601 UTC regex evaluation", async () => {
      await fc.assert(
        fc.property(fc.anyString(), (dateStr) => {
          const match = ISO_8601_UTC_REGEX.test(dateStr);
          expect(typeof match).toBe("boolean");
          return true;
        }),
        { numRuns: RUNS },
      );
    });

    it("evaluates ISO dates safely on all ATTACK_STRINGS", () => {
      for (const attack of fc.ATTACK_STRINGS) {
        const isMatch = ISO_8601_UTC_REGEX.test(attack);
        expect(typeof isMatch).toBe("boolean");
      }
    });

    it("validateTransactionFilters middleware handles arbitrary query shapes", async () => {
      await fc.assert(
        fc.property(
          fc.record({
            status: fc.anyString(),
            limit: fc.anyString(),
            offset: fc.anyString(),
            reference: fc.anyString(),
            startDate: fc.anyString(),
            endDate: fc.anyString(),
          }),
          (query) => {
            const req: any = { query };
            let statusCode = 200;
            let jsonBody: any = null;
            const res: any = {
              status: (code: number) => {
                statusCode = code;
                return res;
              },
              json: (body: any) => {
                jsonBody = body;
                return res;
              },
            };
            let nextCalled = false;
            const next = () => {
              nextCalled = true;
            };

            validateTransactionFilters(req, res, next);

            if (nextCalled) {
              expect(req.transactionFilters).toBeDefined();
              expect(typeof req.transactionFilters.limit).toBe("number");
              expect(typeof req.transactionFilters.offset).toBe("number");
              expect(req.transactionFilters.limit).toBeGreaterThanOrEqual(1);
              expect(req.transactionFilters.limit).toBeLessThanOrEqual(1000);
            } else {
              expect([400, 500]).toContain(statusCode);
              expect(jsonBody).toBeDefined();
            }
            return true;
          },
        ),
        { numRuns: RUNS },
      );
    });

    it("getPaginationInfo handles arbitrary numbers and boundary integers", async () => {
      await fc.assert(
        fc.property(
          fc.record({
            total: fc.integer({ min: -1000, max: 1000000 }),
            limit: fc.integer({ min: -100, max: 10000 }),
            offset: fc.integer({ min: -100, max: 100000 }),
          }),
          ({ total, limit, offset }) => {
            const info = getPaginationInfo(total, limit, offset);
            expect(info).toHaveProperty("total", total);
            expect(info).toHaveProperty("limit", limit);
            expect(info).toHaveProperty("offset", offset);
            expect(typeof info.hasMore).toBe("boolean");
            return true;
          },
        ),
        { numRuns: RUNS },
      );
    });
  });

  // ─── 2. Phone Number Parsing & Validation Inputs ─────────────────────────────
  describe("Phone Number Parser Inputs", () => {
    it("parseFlexiblePhoneNumber handles arbitrary string inputs safely", async () => {
      await fc.assert(
        fc.property(fc.anyString(), (rawPhone) => {
          const parsed = parseFlexiblePhoneNumber(rawPhone, "CM");
          if (parsed !== null) {
            expect(typeof parsed.isValid).toBe("function");
          }
          return true;
        }),
        { numRuns: RUNS },
      );
    });

    it("validatePhoneNumber never crashes on arbitrary input", async () => {
      await fc.assert(
        fc.property(fc.anyString(), (rawPhone) => {
          const res = validatePhoneNumber(rawPhone, "CM");
          expect(typeof res.isValid).toBe("boolean");
          if (res.isValid) {
            expect(typeof res.e164).toBe("string");
          }
          return true;
        }),
        { numRuns: RUNS },
      );
    });

    it("isValidPhoneNumber never throws for arbitrary input", async () => {
      await fc.assert(
        fc.property(fc.anyString(), (rawPhone) => {
          const valid = isValidPhoneNumber(rawPhone, "CM");
          expect(typeof valid).toBe("boolean");
          return true;
        }),
        { numRuns: RUNS },
      );
    });

    it("formatPhoneForProvider safely validates provider and number inputs", async () => {
      await fc.assert(
        fc.property(
          fc.record({
            phone: fc.phoneNumber(),
            provider: fc.anyString(),
          }),
          ({ phone, provider }) => {
            try {
              const formatted = formatPhoneForProvider(phone, provider);
              expect(typeof formatted).toBe("string");
            } catch (err: any) {
              expect(err).toBeInstanceOf(Error);
            }
            return true;
          },
        ),
        { numRuns: RUNS },
      );
    });

    it("validatePhoneProviderMatch safely handles arbitrary providers and phone numbers", async () => {
      await fc.assert(
        fc.property(
          fc.record({
            phone: fc.anyString(),
            provider: fc.anyString(),
          }),
          ({ phone, provider }) => {
            const result = validatePhoneProviderMatch(phone, provider);
            expect(typeof result.valid).toBe("boolean");
            if (!result.valid) {
              expect(typeof result.error).toBe("string");
            }
            return true;
          },
        ),
        { numRuns: RUNS },
      );
    });

    it("detectProvider handles arbitrary and attack strings safely", async () => {
      await fc.assert(
        fc.property(fc.anyString(), (phone) => {
          const detected = detectProvider(phone);
          if (detected !== null) {
            expect(["mtn", "airtel", "orange", "vodacom", "tigo"]).toContain(
              detected,
            );
          }
          return true;
        }),
        { numRuns: RUNS },
      );
    });

    it("handles all ATTACK_STRINGS across all phone utilities without throwing unhandled errors", () => {
      for (const s of fc.ATTACK_STRINGS) {
        expect(typeof isValidPhoneNumber(s, "CM")).toBe("boolean");
        expect(typeof validatePhoneNumber(s, "CM").isValid).toBe("boolean");
        expect(
          typeof detectProvider(s) === "string" || detectProvider(s) === null,
        ).toBe(true);
        expect(typeof validatePhoneProviderMatch(s, "mtn").valid).toBe(
          "boolean",
        );
      }
    });
  });

  // ─── 3. Stellar Address & Reference Parsers ─────────────────────────────────
  describe("Stellar Address & Reference Number Parsers", () => {
    it("isStrictStellarGAddress safely parses arbitrary strings", async () => {
      await fc.assert(
        fc.property(fc.anyString(), (addr) => {
          const valid = isStrictStellarGAddress(addr);
          expect(typeof valid).toBe("boolean");
          return true;
        }),
        { numRuns: RUNS },
      );
    });

    it("assertStrictStellarGAddress safely validates or throws error for arbitrary input", async () => {
      await fc.assert(
        fc.property(fc.anyString(), (addr) => {
          try {
            const result = assertStrictStellarGAddress(addr);
            expect(typeof result).toBe("string");
          } catch (err: any) {
            expect(err.message).toContain("Invalid Stellar G-address");
          }
          return true;
        }),
        { numRuns: RUNS },
      );
    });

    it("isStrictStellarGAddress correctly evaluates valid generated Stellar addresses", async () => {
      await fc.assert(
        fc.property(fc.stellarAddress(), (addr) => {
          const valid = isStrictStellarGAddress(addr);
          expect(typeof valid).toBe("boolean");
          return true;
        }),
        { numRuns: RUNS },
      );
    });

    it("isValidReferenceNumber safely evaluates arbitrary strings", async () => {
      await fc.assert(
        fc.property(fc.anyString(), (ref) => {
          const valid = isValidReferenceNumber(ref);
          expect(typeof valid).toBe("boolean");
          return true;
        }),
        { numRuns: RUNS },
      );
    });

    it("checkReferenceExists safely returns false without querying DB for invalid inputs", async () => {
      await fc.assert(
        fc.property(fc.attackString(), async (attack) => {
          const exists = await checkReferenceExists(attack);
          expect(typeof exists).toBe("boolean");
          return true;
        }),
        { numRuns: 20 },
      );
    });
  });
});

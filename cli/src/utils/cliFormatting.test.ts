import assert from "node:assert/strict";
import test from "node:test";
import {
  formatError,
  formatSuccess,
  formatWarn,
  normalizeErrorCode,
} from "./cliFormatting";

test("normalizeErrorCode adds the ERR_ prefix and uppercases codes", () => {
  assert.equal(normalizeErrorCode("auth"), "ERR_AUTH");
  assert.equal(normalizeErrorCode("ERR_ESCROW"), "ERR_ESCROW");
  assert.equal(normalizeErrorCode(undefined), undefined);
});

test("formatters produce consistent CLI message layout", () => {
  assert.match(formatSuccess("Saved profile"), /Saved profile/);
  assert.match(formatWarn("Setup cancelled"), /Setup cancelled/);
  assert.match(formatError("Auth failed", "auth"), /Auth failed/);
  assert.match(formatError("Auth failed", "auth"), /ERR_AUTH/);
});

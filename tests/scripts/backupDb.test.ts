import { describe, it, expect } from "@jest/globals";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

describe("scripts/backupDb.sh", () => {
  const absolutePath = path.resolve(__dirname, "../../scripts/backupDb.sh");
  const relativePath = "scripts/backupDb.sh";

  it("should exist and be a valid script file", () => {
    expect(fs.existsSync(absolutePath)).toBe(true);
    const content = fs.readFileSync(absolutePath, "utf-8");
    expect(content).toContain("#!/usr/bin/env bash");
    expect(content).toContain("pg_dump");
    expect(content).toContain("aws s3 cp");
    expect(content).toContain("RETENTION_DAYS");
  });

  it("should pass bash syntax validation", () => {
    try {
      execSync(`bash -n "${relativePath}"`, { encoding: "utf-8" });
    } catch (error: any) {
      throw new Error(`Syntax error in backupDb.sh: ${error.stderr || error.message}`);
    }
  });
});

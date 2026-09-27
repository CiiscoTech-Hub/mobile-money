import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const repoRoot = __dirname;

export default defineConfig({
  testDir: path.join(repoRoot, "tests", "e2e"),
  outputDir: path.join(repoRoot, "test-results", "e2e"),
  timeout: 30_000,
  expect: {
    timeout: 5000,
    toHaveScreenshot: {
      threshold: 0.2,
      maxDiffPixels: 100,
    },
  },
  fullyParallel: true,
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: path.join(repoRoot, "playwright-report"),
      },
    ],
  ],
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3000",
        headless: true,
        ignoreHTTPSErrors: true,
      },
    },
    {
      name: "chromium-landing",
      testDir: path.join(repoRoot, "src", "tests", "e2e"),
      testMatch: /landingPage\.spec\.ts/,
      timeout: 60_000,
      workers: 2,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3000",
        headless: true,
        ignoreHTTPSErrors: true,
      },
      webServer: {
        command: `node ${path.join(repoRoot, "src", "tests", "e2e", "landingPageServer.mjs")}`,
        port: 3000,
        reuseExistingServer: !process.env.CI,
        timeout: 15_000,
      },
    },
    {
      name: "chromium-visual",
      testDir: path.join(repoRoot, "src", "tests", "e2e"),
      testMatch: /sep24Visual\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3100",
        headless: true,
        ignoreHTTPSErrors: true,
      },
      outputDir: path.join(repoRoot, "test-results", "visual"),
      webServer: {
        command: `node ${path.join(repoRoot, "src", "tests", "e2e", "sep24VisualServer.mjs")}`,
        port: 3100,
        reuseExistingServer: !process.env.CI,
        timeout: 15_000,
      },
    },
  ],
  use: {
    actionTimeout: 0,
    trace: "retain-on-failure",
  },
});

import { test, expect } from "@playwright/test";

test.describe("Interactive SEP-24 Visual Regression", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("full page matches snapshot", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("sep24-interactive-full-page.png", {
      threshold: 0.2,
      maxDiffPixels: 100,
    });
  });

  test("hero section matches snapshot", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    const hero = page.locator(".hero-section");
    await expect(hero).toHaveScreenshot("sep24-hero-section.png", {
      threshold: 0.2,
      maxDiffPixels: 50,
    });
  });

  test("calculator widget matches snapshot", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    const calculator = page.locator(".calculator-section");
    await expect(calculator).toHaveScreenshot("sep24-calculator.png", {
      threshold: 0.2,
      maxDiffPixels: 50,
    });
  });

  test("API explorer tabs match snapshot", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    const apiSection = page.locator(".api-section");
    await expect(apiSection).toHaveScreenshot("sep24-api-explorer.png", {
      threshold: 0.2,
      maxDiffPixels: 50,
    });
  });

  test("integration steps timeline matches snapshot", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    const integration = page.locator(".integration-section");
    await expect(integration).toHaveScreenshot("sep24-integration-steps.png", {
      threshold: 0.2,
      maxDiffPixels: 50,
    });
  });

  test("calculator with deposit tab active matches snapshot", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    await page.locator("#tab-btn-deposit").click();
    const apiSection = page.locator(".api-section");
    await expect(apiSection).toHaveScreenshot("sep24-deposit-tab-active.png", {
      threshold: 0.2,
      maxDiffPixels: 50,
    });
  });

  test("calculator with withdrawal tab active matches snapshot", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    await page.locator("#tab-btn-withdraw").click();
    const apiSection = page.locator(".api-section");
    await expect(apiSection).toHaveScreenshot("sep24-withdraw-tab-active.png", {
      threshold: 0.2,
      maxDiffPixels: 50,
    });
  });

  test("features grid matches snapshot", async ({ page }) => {
    await page.waitForLoadState("networkidle");
    const features = page.locator(".features-section");
    await expect(features).toHaveScreenshot("sep24-features-grid.png", {
      threshold: 0.2,
      maxDiffPixels: 50,
    });
  });
});
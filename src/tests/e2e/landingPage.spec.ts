/**
 * Landing Page E2E – Conversion Calculator & Tab Navigation
 *
 * Verifies the public landing page calculator logic and API explorer
 * tab clicks on simulated desktop and mobile viewports.
 *
 *   npx playwright test src/tests/e2e/landingPage.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// RATES mirrors public/app.js after live rates are loaded.
// app.js computes: RATES[cur].USDC = 1 / rawRate, RATES[cur].XLM = 10 / rawRate
// where rawRate comes from the /api/live-rates fallback table.
// ---------------------------------------------------------------------------
const RAW_RATES: Record<string, number> = {
  NGN: 1550,
  XAF: 600,
  KES: 130,
  GHS: 15,
  TZS: 2600,
  ZMW: 27,
  RWF: 1320,
};

const RATES: Record<string, { USDC: number; XLM: number }> = {};
for (const [cur, raw] of Object.entries(RAW_RATES)) {
  RATES[cur] = { USDC: 1 / raw, XLM: 10 / raw };
}

const TABS = [
  { id: "deposit", snippet: "POST http://localhost:3000/api/transactions/deposit" },
  { id: "withdraw", snippet: "POST http://localhost:3000/api/transactions/withdraw" },
  { id: "paylink", snippet: "POST http://localhost:3000/api/payment-links" },
  { id: "toml", snippet: "GET http://localhost:3000/.well-known/stellar.toml" },
  { id: "kyc", snippet: "POST http://localhost:3000/api/kyc/upload" },
  { id: "stats", snippet: "GET http://localhost:3000/api/v1/stats" },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Calculate the expected receive value matching app.js logic. */
function expectedReceive(
  sendAmt: number,
  currency: string,
  asset: string,
): { receive: number; fee: number } {
  const rate = RATES[currency][asset as "USDC" | "XLM"];
  const fee = sendAmt * 0.015;
  const net = Math.max(0, sendAmt - fee);
  return { receive: net * rate, fee };
}

/** Wait for the calculator JS to hydrate (initial calculateConversion + loadLiveRates). */
async function waitForCalculator(page: Page) {
  await page.waitForFunction(() => {
    const el = document.getElementById("calc-receive-amount") as HTMLInputElement;
    return el && el.value !== "" && el.value !== "0";
  });
}

// ---------------------------------------------------------------------------
// Desktop tests
// ---------------------------------------------------------------------------

test.describe("Landing Page – Desktop", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForCalculator(page);
  });

  // ── Calculator: default state ─────────────────────────────────────────

  test("calculator renders with default NGN → USDC conversion", async ({ page }) => {
    const sendInput = page.locator("#calc-send-amount");
    const receiveInput = page.locator("#calc-receive-amount");
    const sendCurrency = page.locator("#calc-send-currency");
    const receiveAsset = page.locator("#calc-receive-asset");

    await expect(sendCurrency).toHaveValue("NGN");
    await expect(receiveAsset).toHaveValue("USDC");

    const sendAmt = parseFloat((await sendInput.inputValue()) || "0");
    const { receive } = expectedReceive(sendAmt, "NGN", "USDC");

    const receiveVal = parseFloat((await receiveInput.inputValue() || "0").replace(/,/g, ""));
    expect(receiveVal).toBeCloseTo(receive, 2);
  });

  // ── Calculator: changing send amount ──────────────────────────────────

  test("entering a new send amount updates the receive value", async ({ page }) => {
    const sendInput = page.locator("#calc-send-amount");
    const receiveInput = page.locator("#calc-receive-amount");

    await sendInput.fill("10000");
    await sendInput.dispatchEvent("input");

    const { receive } = expectedReceive(10000, "NGN", "USDC");
    const receiveVal = parseFloat((await receiveInput.inputValue() || "0").replace(/,/g, ""));
    expect(receiveVal).toBeCloseTo(receive, 2);
  });

  // ── Calculator: switching currency ────────────────────────────────────

  test("switching currency updates rate display and receive value", async ({ page }) => {
    const sendInput = page.locator("#calc-send-amount");
    const sendCurrency = page.locator("#calc-send-currency");
    const receiveInput = page.locator("#calc-receive-amount");
    const rateDisplay = page.locator("#rate-display");

    await sendInput.fill("10000");
    await sendInput.dispatchEvent("input");
    await sendCurrency.selectOption("XAF");
    await sendCurrency.dispatchEvent("change");

    const { receive } = expectedReceive(10000, "XAF", "USDC");
    const receiveVal = parseFloat((await receiveInput.inputValue() || "0").replace(/,/g, ""));
    expect(receiveVal).toBeCloseTo(receive, 2);

    const rateText = await rateDisplay.textContent();
    expect(rateText).toContain("XAF");
  });

  // ── Calculator: switching receive asset ───────────────────────────────

  test("switching receive asset recalculates with XLM rate", async ({ page }) => {
    const sendInput = page.locator("#calc-send-amount");
    const receiveAsset = page.locator("#calc-receive-asset");
    const receiveInput = page.locator("#calc-receive-amount");
    const finalDisplay = page.locator("#final-display");

    await sendInput.fill("5000");
    await sendInput.dispatchEvent("input");
    await receiveAsset.selectOption("XLM");
    await receiveAsset.dispatchEvent("change");

    const { receive } = expectedReceive(5000, "NGN", "XLM");
    const receiveVal = parseFloat((await receiveInput.inputValue() || "0").replace(/,/g, ""));
    expect(receiveVal).toBeCloseTo(receive, 2);

    const finalText = await finalDisplay.textContent();
    expect(finalText).toContain("XLM");
  });

  // ── Calculator: fee display ───────────────────────────────────────────

  test("operator fee is 1.5% of send amount", async ({ page }) => {
    const sendInput = page.locator("#calc-send-amount");
    const feeDisplay = page.locator("#fee-display");

    await sendInput.fill("10000");
    await sendInput.dispatchEvent("input");

    const feeText = await feeDisplay.textContent();
    expect(feeText).toContain("150");
    expect(feeText).toContain("NGN");
  });

  // ── Calculator: mobile money deposit flow simulation ──────────────────

  test("simulates a mobile money deposit: select XAF, enter amount, verify USDC received", async ({
    page,
  }) => {
    const sendCurrency = page.locator("#calc-send-currency");
    const sendInput = page.locator("#calc-send-amount");
    const receiveAsset = page.locator("#calc-receive-asset");
    const receiveInput = page.locator("#calc-receive-amount");
    const rateDisplay = page.locator("#rate-display");
    const feeDisplay = page.locator("#fee-display");
    const finalDisplay = page.locator("#final-display");

    // Cameroon user sends XAF via MTN MoMo
    await sendCurrency.selectOption("XAF");
    await sendCurrency.dispatchEvent("change");
    await sendInput.fill("25000");
    await sendInput.dispatchEvent("input");
    await receiveAsset.selectOption("USDC");
    await receiveAsset.dispatchEvent("change");

    const { receive, fee } = expectedReceive(25000, "XAF", "USDC");

    const receiveVal = parseFloat((await receiveInput.inputValue() || "0").replace(/,/g, ""));
    expect(receiveVal).toBeCloseTo(receive, 2);

    const feeText = await feeDisplay.textContent();
    expect(feeText).toContain(String(Math.round(fee)));

    const rateText = await rateDisplay.textContent();
    expect(rateText).toContain("XAF");
    expect(rateText).toContain("USDC");

    const finalText = await finalDisplay.textContent();
    expect(finalText).toContain("USDC");
  });

  // ── Calculator: every currency produces a positive result ─────────────

  test("all supported currencies calculate a non-zero receive amount", async ({ page }) => {
    const sendInput = page.locator("#calc-send-amount");
    const sendCurrency = page.locator("#calc-send-currency");
    const receiveInput = page.locator("#calc-receive-amount");

    const currencies = ["NGN", "XAF", "KES", "GHS", "TZS", "ZMW", "RWF"];

    for (const cur of currencies) {
      await sendCurrency.selectOption(cur);
      await sendCurrency.dispatchEvent("change");
      await sendInput.fill("5000");
      await sendInput.dispatchEvent("input");

      const val = parseFloat((await receiveInput.inputValue() || "0").replace(/,/g, ""));
      expect(val, `Expected positive receive for ${cur}`).toBeGreaterThan(0);
    }
  });

  // ── API Explorer tabs ─────────────────────────────────────────────────

  test("clicking each API tab updates the code snippet", async ({ page }) => {
    for (const tab of TABS) {
      await page.click(`#tab-btn-${tab.id}`);
      await expect(page.locator(`#tab-btn-${tab.id}`)).toHaveClass(/active/);
      const snippet = await page.locator("#code-snippet").textContent();
      expect(snippet, `Tab ${tab.id} should show its endpoint`).toContain(tab.snippet);
    }
  });

  test("previously active tab loses active class when another is selected", async ({
    page,
  }) => {
    await page.click("#tab-btn-deposit");
    await expect(page.locator("#tab-btn-deposit")).toHaveClass(/active/);

    await page.click("#tab-btn-withdraw");
    await expect(page.locator("#tab-btn-withdraw")).toHaveClass(/active/);
    await expect(page.locator("#tab-btn-deposit")).not.toHaveClass(/active/);
  });

  // ── Hero CTA links ───────────────────────────────────────────────────

  test("hero CTA buttons navigate to correct sections", async ({ page }) => {
    const calcBtn = page.locator("#btn-hero-get-started");
    await expect(calcBtn).toHaveAttribute("href", "#calculator");

    const apiBtn = page.locator("#btn-hero-view-api");
    await expect(apiBtn).toHaveAttribute("href", "#api");
  });

  // ── Theme switcher ───────────────────────────────────────────────────

  test("theme switcher toggles between themes", async ({ page }) => {
    const lightBtn = page.locator('.theme-switcher button[data-theme="light"]');
    await lightBtn.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    const darkBtn = page.locator('.theme-switcher button[data-theme="dark"]');
    await darkBtn.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});

// ---------------------------------------------------------------------------
// Mobile viewport tests
// ---------------------------------------------------------------------------

test.describe("Landing Page – Mobile", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForCalculator(page);
  });

  test("calculator is visible and functional on mobile", async ({ page }) => {
    const sendInput = page.locator("#calc-send-amount");
    const receiveInput = page.locator("#calc-receive-amount");

    await expect(sendInput).toBeVisible();
    await expect(receiveInput).toBeVisible();

    await sendInput.fill("3000");
    await sendInput.dispatchEvent("input");

    const { receive } = expectedReceive(3000, "NGN", "USDC");
    const receiveVal = parseFloat((await receiveInput.inputValue() || "0").replace(/,/g, ""));
    expect(receiveVal).toBeCloseTo(receive, 2);
  });

  test("mobile deposit simulation: XAF → USDC on small screen", async ({ page }) => {
    const sendCurrency = page.locator("#calc-send-currency");
    const sendInput = page.locator("#calc-send-amount");
    const receiveInput = page.locator("#calc-receive-amount");

    await sendCurrency.selectOption("XAF");
    await sendCurrency.dispatchEvent("change");
    await sendInput.fill("15000");
    await sendInput.dispatchEvent("input");

    const { receive } = expectedReceive(15000, "XAF", "USDC");
    const receiveVal = parseFloat((await receiveInput.inputValue() || "0").replace(/,/g, ""));
    expect(receiveVal).toBeCloseTo(receive, 2);
  });

  test("API tabs are clickable and update code on mobile", async ({ page }) => {
    for (const tab of TABS) {
      await page.click(`#tab-btn-${tab.id}`);
      await expect(page.locator(`#tab-btn-${tab.id}`)).toHaveClass(/active/);
      const snippet = await page.locator("#code-snippet").textContent();
      expect(snippet, `Tab ${tab.id} snippet on mobile`).toContain(tab.snippet);
    }
  });

  test("currency switch + asset switch recalculates on mobile", async ({ page }) => {
    const sendCurrency = page.locator("#calc-send-currency");
    const receiveAsset = page.locator("#calc-receive-asset");
    const receiveInput = page.locator("#calc-receive-amount");

    await sendCurrency.selectOption("KES");
    await sendCurrency.dispatchEvent("change");
    await receiveAsset.selectOption("XLM");
    await receiveAsset.dispatchEvent("change");

    const { receive } = expectedReceive(5000, "KES", "XLM");
    const receiveVal = parseFloat((await receiveInput.inputValue() || "0").replace(/,/g, ""));
    expect(receiveVal).toBeCloseTo(receive, 2);
  });
});

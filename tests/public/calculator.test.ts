import { describe, it, expect, beforeEach, jest } from "@jest/globals";

describe("Exchange Rate Calculator (public/app.js)", () => {
  let listeners: Record<string, Function[]> = {};

  const mockSendInput = {
    value: "5000",
    addEventListener: (event: string, fn: Function) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
  };

  const mockSendCurrency = { value: "XAF", addEventListener: jest.fn() };
  const mockReceiveAsset = { value: "USDC", addEventListener: jest.fn() };

  const mockRateDisplay = { textContent: "" };
  const mockFeeDisplay = { textContent: "" };
  const mockReceiveInput = { value: "" };
  const mockFinalDisplay = { textContent: "" };

  const mockBtn = {
    classList: { add: jest.fn(), remove: jest.fn() },
    addEventListener: jest.fn(),
  };

  beforeEach(() => {
    jest.resetModules();
    listeners = {};

    (global as any).document = {
      getElementById: (id: string) => {
        switch (id) {
          case "calc-send-amount":
            return mockSendInput;
          case "calc-send-currency":
            return mockSendCurrency;
          case "calc-receive-amount":
            return mockReceiveInput;
          case "calc-receive-asset":
            return mockReceiveAsset;
          case "rate-display":
            return mockRateDisplay;
          case "fee-display":
            return mockFeeDisplay;
          case "final-display":
            return mockFinalDisplay;
          default:
            return mockBtn;
        }
      },
    };

    (global as any).fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: false,
      }),
    );
  });

  it("should format outputs to 2 decimal places and update on keypress event", () => {
    require("../../public/app.js");

    // Initial calculation (5000 XAF @ 1.5% fee = 75.00 XAF, net 4925 * 0.001667 = 8.21 USDC)
    expect(mockFeeDisplay.textContent).toBe("75.00 XAF");
    expect(mockReceiveInput.value).toBe("8.21");
    expect(mockFinalDisplay.textContent).toBe("8.21 USDC");

    // Verify keypress listener registered on calc-send-amount
    expect(listeners["keypress"]).toBeDefined();
    expect(listeners["keypress"].length).toBeGreaterThan(0);

    // Simulate keypress event with 10000 XAF
    mockSendInput.value = "10000";
    listeners["keypress"][0]();

    // Re-evaluated (10000 XAF @ 1.5% fee = 150.00 XAF, net 9850 * 0.001667 = 16.42 USDC)
    expect(mockFeeDisplay.textContent).toBe("150.00 XAF");
    expect(mockReceiveInput.value).toBe("16.42");
    expect(mockFinalDisplay.textContent).toBe("16.42 USDC");
  });
});

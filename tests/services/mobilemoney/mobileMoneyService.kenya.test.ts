import {
  isValidKenyaPhoneNumber,
  MobileMoneyService,
} from "../../../src/services/mobilemoney/mobileMoneyService";

class FakeProvider {
  requestPayment = jest.fn(async () => ({
    success: true,
    data: { reference: "payment-ok" },
  }));

  sendPayout = jest.fn(async () => ({
    success: true,
    data: { reference: "payout-ok" },
  }));

  sendBatchPayout = jest.fn(async () => ({
    success: true,
    results: [],
  }));
}

describe("MobileMoneyService Kenya phone validation", () => {
  it("accepts Kenya phone numbers in +254 plus 9 digit format", async () => {
    const provider = new FakeProvider();
    const service = new MobileMoneyService(
      new Map([["airtel", provider]]) as any,
    );

    await expect(
      service.initiatePayment("airtel", "+254730123456", "1000"),
    ).resolves.toEqual({
      success: true,
      data: { reference: "payment-ok" },
      providerResponseTimeMs: undefined,
    });
    expect(provider.requestPayment).toHaveBeenCalledWith(
      "+254730123456",
      "1000",
    );
  });

  it("rejects Kenya phone numbers that do not start with +254", async () => {
    const provider = new FakeProvider();
    const service = new MobileMoneyService(
      new Map([["airtel", provider]]) as any,
    );

    await expect(
      service.initiatePayment("airtel", "254730123456", "1000"),
    ).rejects.toThrow(
      "Invalid Kenya phone number format. Use +254 followed by 9 digits.",
    );
    expect(provider.requestPayment).not.toHaveBeenCalled();
  });

  it("rejects Kenya phone numbers with invalid lengths", async () => {
    const provider = new FakeProvider();
    const service = new MobileMoneyService(
      new Map([["airtel", provider]]) as any,
    );

    await expect(
      service.sendPayout("airtel", "+25473012345", "1000"),
    ).rejects.toThrow(
      "Invalid Kenya phone number format. Use +254 followed by 9 digits.",
    );
    expect(provider.sendPayout).not.toHaveBeenCalled();
  });

  it("exposes the Kenya regex as a focused helper", () => {
    expect(isValidKenyaPhoneNumber("+254730123456")).toBe(true);
    expect(isValidKenyaPhoneNumber("254730123456")).toBe(false);
    expect(isValidKenyaPhoneNumber("+25473012345")).toBe(false);
  });
});

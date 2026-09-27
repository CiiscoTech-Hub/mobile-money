import {
  isWaveSenegalRoute,
  routeWaveSenegalPayment,
  routeWaveSenegalPayout,
  getWaveSenegalTransactionStatus,
  setWaveSenegalProvider,
  getWaveSenegalProvider,
  WAVE_SENEGAL_PROVIDER_KEY,
} from "../waveSenegalRouting";
import { WaveSenegalProvider } from "../providers/waveSenegal";

const SN_PHONE = "+221770000000";

type FakeProvider = Pick<
  WaveSenegalProvider,
  "requestPayment" | "sendPayout" | "getTransactionStatus"
>;

function fakeProvider(overrides: Partial<FakeProvider> = {}): FakeProvider {
  return {
    requestPayment: jest
      .fn<Promise<{ success: boolean; data?: unknown }>, [string, string]>()
      .mockResolvedValue({ success: true, data: { id: "sess-1" } }),
    sendPayout: jest
      .fn<Promise<{ success: boolean; data?: unknown }>, [string, string]>()
      .mockResolvedValue({ success: true, data: { id: "out-1" } }),
    getTransactionStatus: jest
      .fn<Promise<{ status: string }>, [string]>()
      .mockResolvedValue({ status: "completed" }),
    ...overrides,
  };
}

afterEach(() => {
  setWaveSenegalProvider(null);
  jest.clearAllMocks();
});

describe("isWaveSenegalRoute", () => {
  it("routes when the wave_senegal provider key is explicitly chosen", () => {
    expect(isWaveSenegalRoute({ provider: WAVE_SENEGAL_PROVIDER_KEY })).toBe(
      true,
    );
    expect(isWaveSenegalRoute({ provider: "WAVE_SENEGAL" })).toBe(true);
  });

  it("does not route when another provider is explicitly chosen", () => {
    expect(isWaveSenegalRoute({ provider: "mtn", phoneNumber: SN_PHONE })).toBe(
      false,
    );
  });

  it("routes an unqualified request by Senegalese MSISDN", () => {
    expect(isWaveSenegalRoute({ phoneNumber: SN_PHONE })).toBe(true);
    expect(isWaveSenegalRoute({ phoneNumber: "+237670000000" })).toBe(false);
    expect(isWaveSenegalRoute({})).toBe(false);
  });
});

describe("getWaveSenegalProvider", () => {
  it("returns a singleton WaveSenegalProvider by default", () => {
    const a = getWaveSenegalProvider();
    const b = getWaveSenegalProvider();
    expect(a).toBeInstanceOf(WaveSenegalProvider);
    expect(a).toBe(b);
  });
});

describe("routeWaveSenegalPayment", () => {
  it("delegates to the provider for a valid request", async () => {
    const provider = fakeProvider();
    setWaveSenegalProvider(provider as unknown as WaveSenegalProvider);

    const result = await routeWaveSenegalPayment(SN_PHONE, "5000");

    expect(result.success).toBe(true);
    expect(provider.requestPayment).toHaveBeenCalledWith(SN_PHONE, "5000");
  });

  it("rejects a non-Senegalese phone number without calling the provider", async () => {
    const provider = fakeProvider();
    setWaveSenegalProvider(provider as unknown as WaveSenegalProvider);

    const result = await routeWaveSenegalPayment("+237670000000", "5000");

    expect(result.success).toBe(false);
    expect(provider.requestPayment).not.toHaveBeenCalled();
  });

  it("rejects an amount above the configured maximum", async () => {
    const provider = fakeProvider();
    setWaveSenegalProvider(provider as unknown as WaveSenegalProvider);

    const result = await routeWaveSenegalPayment(SN_PHONE, "9999999999");

    expect(result.success).toBe(false);
    expect((result.error as Error).message).toMatch(/maximum/i);
    expect(provider.requestPayment).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric amount", async () => {
    const provider = fakeProvider();
    setWaveSenegalProvider(provider as unknown as WaveSenegalProvider);

    const result = await routeWaveSenegalPayment(SN_PHONE, "abc");

    expect(result.success).toBe(false);
    expect(provider.requestPayment).not.toHaveBeenCalled();
  });
});

describe("routeWaveSenegalPayout", () => {
  it("delegates payouts to the provider", async () => {
    const provider = fakeProvider();
    setWaveSenegalProvider(provider as unknown as WaveSenegalProvider);

    const result = await routeWaveSenegalPayout(SN_PHONE, 7500);

    expect(result.success).toBe(true);
    expect(provider.sendPayout).toHaveBeenCalledWith(SN_PHONE, "7500");
  });
});

describe("getWaveSenegalTransactionStatus", () => {
  it("proxies to the provider status lookup", async () => {
    const provider = fakeProvider({
      getTransactionStatus: jest
        .fn<Promise<{ status: string }>, [string]>()
        .mockResolvedValue({ status: "pending" }),
    });
    setWaveSenegalProvider(provider as unknown as WaveSenegalProvider);

    const status = await getWaveSenegalTransactionStatus("tx-123");

    expect(status).toEqual({ status: "pending" });
    expect(provider.getTransactionStatus).toHaveBeenCalledWith("tx-123");
  });
});

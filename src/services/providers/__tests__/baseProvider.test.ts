import {
  BaseProvider,
  DEFAULT_TOKEN_TTL_SECONDS,
  ProviderAuthConfig,
} from "../baseProvider";

/**
 * Minimal concrete provider used to exercise the shared authorization
 * module (token cache + proactive renewal scheduler).
 */
class TestProvider extends BaseProvider {
  public tokenExchanges = 0;

  constructor(config?: Partial<ProviderAuthConfig>) {
    super({
      apiKey: "key",
      apiSecret: "secret",
      baseUrl: "https://provider.test",
      tokenExpiryLeewaySeconds: 30,
      ...config,
    });
  }

  // Test seams onto the protected surface.
  public callCacheToken(token: string, expiresIn: unknown): void {
    this.cacheToken(token, expiresIn);
  }

  public callIsTokenValid(): boolean {
    return this.isTokenValid();
  }

  public callScheduleRenewal(expiresIn: unknown): void {
    this.scheduleTokenRenewal(expiresIn, () => this.exchange());
  }

  public get expiresAt(): number {
    return this.tokenExpiresAt;
  }

  async getAccessToken(): Promise<string> {
    if (this.isTokenValid()) return this.cachedToken as string;
    return this.exchange();
  }

  private async exchange(): Promise<string> {
    this.tokenExchanges += 1;
    const token = `token-${this.tokenExchanges}`;
    this.cacheToken(token, 3600);
    return token;
  }
}

describe("BaseProvider — token cache", () => {
  it("treats a fresh token with a valid lifetime as valid", () => {
    const provider = new TestProvider();
    provider.callCacheToken("t", 3600);
    expect(provider.callIsTokenValid()).toBe(true);
  });

  it("does not poison the cache when expires_in is missing", () => {
    const provider = new TestProvider();
    provider.callCacheToken("t", undefined);

    expect(Number.isFinite(provider.expiresAt)).toBe(true);
    expect(provider.callIsTokenValid()).toBe(true);
    expect(provider.expiresAt).toBeGreaterThan(
      Date.now() + (DEFAULT_TOKEN_TTL_SECONDS - 60) * 1000,
    );
  });

  it("falls back to the default TTL for non-numeric or non-positive values", () => {
    for (const bad of ["not-a-number", NaN, 0, -100, null]) {
      const provider = new TestProvider();
      provider.callCacheToken("t", bad);
      expect(provider.callIsTokenValid()).toBe(true);
    }
  });

  it("accepts a numeric string expires_in", () => {
    const provider = new TestProvider();
    provider.callCacheToken("t", "120");
    const expected = Date.now() + 120 * 1000;
    expect(Math.abs(provider.expiresAt - expected)).toBeLessThan(1000);
  });

  it("reports an expired token as invalid", () => {
    const provider = new TestProvider();
    provider.callCacheToken("t", 10); // 10s < 30s leeway → already stale
    expect(provider.callIsTokenValid()).toBe(false);
  });
});

describe("BaseProvider — proactive renewal scheduler", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("renews the token shortly before it expires", async () => {
    const provider = new TestProvider();
    await provider.getAccessToken();
    expect(provider.tokenExchanges).toBe(1);

    provider.callScheduleRenewal(3600);

    // Just before (leeway) the renewal window — nothing yet.
    await jest.advanceTimersByTimeAsync((3600 - 30) * 1000 - 5);
    expect(provider.tokenExchanges).toBe(1);

    await jest.advanceTimersByTimeAsync(10);
    expect(provider.tokenExchanges).toBe(2);
  });

  it("clamps very short lifetimes to a minimum delay", async () => {
    const provider = new TestProvider();
    provider.callScheduleRenewal(1); // ttl - leeway would be negative
    expect(provider.tokenExchanges).toBe(0);

    await jest.advanceTimersByTimeAsync(1000);
    expect(provider.tokenExchanges).toBe(1);
  });

  it("replaces a previously scheduled renewal instead of stacking timers", async () => {
    const provider = new TestProvider();
    provider.callScheduleRenewal(3600);
    provider.callScheduleRenewal(3600);

    await jest.advanceTimersByTimeAsync(3600 * 1000);

    expect(provider.tokenExchanges).toBe(1);
  });

  it("stops renewing after destroy()", async () => {
    const provider = new TestProvider();
    provider.callScheduleRenewal(3600);
    provider.destroy();

    await jest.advanceTimersByTimeAsync(3600 * 1000);

    expect(provider.tokenExchanges).toBe(0);
  });

  it("retries once after a failed renewal", async () => {
    const provider = new TestProvider();
    const renew = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce("ok");

    // Schedule directly against the failing fn.
    (
      provider as unknown as {
        scheduleTokenRenewal: (e: unknown, r: () => Promise<unknown>) => void;
      }
    ).scheduleTokenRenewal(3600, renew);

    // First renewal fires at (ttl - leeway) = 3600s - 30s.
    await jest.advanceTimersByTimeAsync((3600 - 30) * 1000);
    expect(renew).toHaveBeenCalledTimes(1);

    // Retry fires RENEWAL_RETRY_DELAY_MS later.
    await jest.advanceTimersByTimeAsync(5000);
    expect(renew).toHaveBeenCalledTimes(2);
  });
});

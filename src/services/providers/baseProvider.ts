/**
 * BaseProvider — core authentication configuration class
 *
 * Centralises the credential/auth-header logic that was previously
 * duplicated across every provider (MTN, Airtel, Orange).
 *
 * All provider classes extend this class to inherit:
 *   - A unified credentials signature (`ProviderCredentials`)
 *   - `buildBasicAuthHeader(key, secret)` — constructs the RFC 7617
 *     Base64-encoded Basic auth string used for OAuth2 token requests
 *   - `buildBearerAuthHeader(token)` — constructs Bearer auth strings
 *     for API calls made after token exchange
 *   - `buildOAuth2TokenRequestHeaders()` — returns the complete header
 *     object required by every provider's token endpoint
 *   - `getAccessToken()` — abstract hook for subclasses to implement
 *     their own token-fetch / refresh logic
 *   - Simple in-memory token cache (`cachedToken` / `tokenExpiresAt`)
 *     with a configurable leeway to avoid using tokens right at expiry
 */

export interface ProviderCredentials {
  /** OAuth2 client ID / API key */
  apiKey: string;
  /** OAuth2 client secret / API secret */
  apiSecret: string;
}

export interface ProviderAuthConfig extends ProviderCredentials {
  /** Base URL for this provider's API */
  baseUrl: string;
  /** HTTP timeout in milliseconds (default: 10 000) */
  timeoutMs?: number;
  /**
   * Seconds before token expiry at which the token is considered stale
   * and will be refreshed proactively (default: 30)
   */
  tokenExpiryLeewaySeconds?: number;
}

/**
 * Fallback lifetime (seconds) applied when a token endpoint omits or returns
 * a non-numeric `expires_in`. Without this guard the cached expiry becomes
 * `NaN`, `isTokenValid()` is permanently `false`, and every API call triggers
 * a fresh token exchange (an auth storm against the provider).
 */
export const DEFAULT_TOKEN_TTL_SECONDS = 3600;

/** Never schedule a proactive renewal sooner than this many ms from now. */
const MIN_RENEWAL_DELAY_MS = 1_000;

/** Delay before retrying a renewal that threw. */
const RENEWAL_RETRY_DELAY_MS = 5_000;

export abstract class BaseProvider {
  protected readonly apiKey: string;
  protected readonly apiSecret: string;
  protected readonly baseUrl: string;
  protected readonly timeoutMs: number;
  /** Epoch-ms timestamp after which the cached token must be refreshed. */
  protected tokenExpiresAt: number = 0;
  /** In-memory cached access token. */
  protected cachedToken: string | null = null;

  private readonly tokenExpiryLeewayMs: number;

  /**
   * Pending proactive-renewal timer, or `null` when none is scheduled.
   * Declared as an ECMAScript private field so it never collides with a
   * soft-`private` member of the same name in a subclass.
   */
  #renewalTimer: ReturnType<typeof setTimeout> | null = null;

  /** Set by `destroy()` — suppresses any further renewal work. */
  #destroyed = false;

  constructor(config: ProviderAuthConfig) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.baseUrl = config.baseUrl;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.tokenExpiryLeewayMs = (config.tokenExpiryLeewaySeconds ?? 30) * 1_000;
  }

  // ─── Credential / header helpers ─────────────────────────────────────────

  /**
   * Build an RFC 7617 Basic authorization header value from an API key
   * and secret pair.
   *
   * Result: `"Basic <base64(key:secret)>"`
   *
   * @param key    API key / client ID
   * @param secret API secret / client secret
   */
  protected buildBasicAuthHeader(key: string, secret: string): string {
    const credentials = Buffer.from(`${key}:${secret}`).toString("base64");
    return `Basic ${credentials}`;
  }

  /**
   * Build a Bearer authorization header value from an access token.
   *
   * Result: `"Bearer <token>"`
   *
   * @param token OAuth2 access token
   */
  protected buildBearerAuthHeader(token: string): string {
    return `Bearer ${token}`;
  }

  /**
   * Returns a ready-to-use header object for posting to an OAuth2 token
   * endpoint that expects Basic authentication.
   *
   * Uses the instance's own `apiKey` / `apiSecret` credentials.
   */
  protected buildOAuth2TokenRequestHeaders(): Record<string, string> {
    return {
      Authorization: this.buildBasicAuthHeader(this.apiKey, this.apiSecret),
      "Content-Type": "application/json",
    };
  }

  // ─── Token cache helpers ──────────────────────────────────────────────────

  /**
   * Returns `true` when the cached token is present and not yet stale
   * (accounting for the configured leeway).
   */
  protected isTokenValid(): boolean {
    return (
      this.cachedToken !== null &&
      Number.isFinite(this.tokenExpiresAt) &&
      Date.now() < this.tokenExpiresAt - this.tokenExpiryLeewayMs
    );
  }

  /**
   * Coerce a provider-supplied `expires_in` into a usable lifetime in
   * seconds. Token endpoints occasionally return the value as a string,
   * omit it entirely, or send `0` — all of which previously produced a
   * `NaN`/immediately-stale expiry. Anything not a finite positive number
   * falls back to {@link DEFAULT_TOKEN_TTL_SECONDS}.
   */
  protected normalizeExpiresInSeconds(expiresIn: unknown): number {
    const seconds = Number(expiresIn);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return DEFAULT_TOKEN_TTL_SECONDS;
    }
    return seconds;
  }

  /**
   * Stores a new access token and sets its expiry from the provider's
   * `expires_in` value (in seconds). The lifetime is normalised so a
   * missing or malformed value can never poison the cache.
   *
   * @param token     Access token string
   * @param expiresIn Lifetime in seconds as reported by the token endpoint
   */
  protected cacheToken(token: string, expiresIn: unknown): void {
    this.cachedToken = token;
    this.tokenExpiresAt =
      Date.now() + this.normalizeExpiresInSeconds(expiresIn) * 1_000;
  }

  /** Evicts the cached token, forcing the next call to re-authenticate. */
  protected invalidateToken(): void {
    this.cachedToken = null;
    this.tokenExpiresAt = 0;
  }

  // ─── Proactive renewal scheduler ─────────────────────────────────────────

  /**
   * Schedule a proactive token renewal so callers never pay the token-exchange
   * latency on the first request after expiry.
   *
   * The timer fires `tokenExpiryLeewaySeconds` before the token lapses (never
   * sooner than {@link MIN_RENEWAL_DELAY_MS}), is `unref()`ed so it does not
   * keep the event loop alive, replaces any previously scheduled renewal, and
   * is a no-op once {@link destroy} has been called. If `renew` rejects, a
   * single short-delay retry is scheduled.
   *
   * Subclasses opt in by calling this from their `getAccessToken()` once a
   * fresh token has been cached, passing a bound refresh function.
   *
   * @param expiresInSeconds Lifetime of the token just cached.
   * @param renew            Performs a fresh token exchange + `cacheToken`.
   */
  protected scheduleTokenRenewal(
    expiresInSeconds: unknown,
    renew: () => Promise<unknown>,
  ): void {
    this.cancelTokenRenewal();
    if (this.#destroyed) return;

    const ttlMs = this.normalizeExpiresInSeconds(expiresInSeconds) * 1_000;
    const delay = Math.max(
      MIN_RENEWAL_DELAY_MS,
      ttlMs - this.tokenExpiryLeewayMs,
    );

    this.#renewalTimer = setTimeout(() => {
      this.#renewalTimer = null;
      if (this.#destroyed) return;
      Promise.resolve()
        .then(renew)
        .catch(() => {
          if (this.#destroyed) return;
          this.#renewalTimer = setTimeout(() => {
            this.#renewalTimer = null;
            if (this.#destroyed) return;
            void Promise.resolve()
              .then(renew)
              .catch(() => undefined);
          }, RENEWAL_RETRY_DELAY_MS);
          this.#renewalTimer.unref?.();
        });
    }, delay);

    this.#renewalTimer.unref?.();
  }

  /** Cancel any pending proactive renewal timer. */
  protected cancelTokenRenewal(): void {
    if (this.#renewalTimer) {
      clearTimeout(this.#renewalTimer);
      this.#renewalTimer = null;
    }
  }

  /**
   * Release scheduler resources. After this call no further proactive
   * renewals run. Safe to call multiple times.
   */
  destroy(): void {
    this.#destroyed = true;
    this.cancelTokenRenewal();
  }

  // ─── Abstract hook ────────────────────────────────────────────────────────

  /**
   * Obtain a valid access token for the provider — either from cache or
   * by performing a fresh token exchange.
   *
   * Subclasses must implement this method.
   */
  abstract getAccessToken(): Promise<string>;
}

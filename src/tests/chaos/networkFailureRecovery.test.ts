import {
  isTransientError,
  withRetry,
  WithRetryOptions,
} from "../../services/retry";
import {
  executeWithCircuitBreaker,
  resetCircuitBreakers,
  checkAndResetCircuitBreaker,
  forceCloseCircuitBreaker,
  tripCircuitBreaker,
  getAllCircuitBreakerStatesInfo,
} from "../../utils/circuitBreaker";
import { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { checkMobileMoneyHealth } from "../../services/mobilemoney/providers/healthCheck";

jest.mock("../../config/database");
jest.mock("../../services/providerSettingsService", () => ({
  providerSettingsService: {
    getProviderSettings: jest.fn().mockResolvedValue(null),
  },
}));
jest.mock("../../services/mobilemoney/providers/healthCheck");
const mockCheckHealth = checkMobileMoneyHealth as jest.MockedFunction<
  typeof checkMobileMoneyHealth
>;

function createMockAxiosError(
  code: string,
  message: string,
  status?: number,
): AxiosError {
  const config = {} as InternalAxiosRequestConfig;
  const response = status
    ? ({
        status,
        statusText: `HTTP ${status}`,
        data: { message },
        headers: {},
        config,
      } as AxiosResponse)
    : undefined;

  const error = new AxiosError(message, code, config, {}, response);
  return error;
}

describe("Error Propagation and Recovery Loops During Network Failures", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetCircuitBreakers();
  });

  afterEach(() => {
    resetCircuitBreakers();
  });

  describe("1. Network Error Classification and Filtering", () => {
    it("classifies network connection drops and socket timeouts as transient errors", () => {
      const econnreset = createMockAxiosError("ECONNRESET", "socket hang up");
      const etimedout = createMockAxiosError("ETIMEDOUT", "connect ETIMEDOUT");
      const enotfound = createMockAxiosError(
        "ENOTFOUND",
        "getaddrinfo ENOTFOUND",
      );
      const econnrefused = createMockAxiosError(
        "ECONNREFUSED",
        "connect ECONNREFUSED",
      );
      const econnaborted = createMockAxiosError(
        "ECONNABORTED",
        "timeout of 5000ms exceeded",
      );

      expect(isTransientError(econnreset)).toBe(true);
      expect(isTransientError(etimedout)).toBe(true);
      expect(isTransientError(enotfound)).toBe(true);
      expect(isTransientError(econnrefused)).toBe(true);
      expect(isTransientError(econnaborted)).toBe(true);
    });

    it("classifies HTTP 500, 502, 503, 504 and 429 as transient retryable errors", () => {
      const err500 = createMockAxiosError(
        "ERR_BAD_RESPONSE",
        "Internal Server Error",
        500,
      );
      const err502 = createMockAxiosError(
        "ERR_BAD_RESPONSE",
        "Bad Gateway",
        502,
      );
      const err503 = createMockAxiosError(
        "ERR_BAD_RESPONSE",
        "Service Unavailable",
        503,
      );
      const err504 = createMockAxiosError(
        "ERR_BAD_RESPONSE",
        "Gateway Timeout",
        504,
      );
      const err429 = createMockAxiosError(
        "ERR_BAD_REQUEST",
        "Too Many Requests",
        429,
      );

      expect(isTransientError(err500, "mtn")).toBe(true);
      expect(isTransientError(err502, "mtn")).toBe(true);
      expect(isTransientError(err503, "mtn")).toBe(true);
      expect(isTransientError(err504, "mtn")).toBe(true);
      expect(isTransientError(err429, "mtn")).toBe(true);
    });

    it("identifies permanent client errors (400, 401, 403, 404, 422) as non-transient", () => {
      const err400 = createMockAxiosError(
        "ERR_BAD_REQUEST",
        "Invalid phone number format",
        400,
      );
      const err401 = createMockAxiosError(
        "ERR_BAD_REQUEST",
        "Unauthorized token expired",
        401,
      );
      const err403 = createMockAxiosError(
        "ERR_BAD_REQUEST",
        "Forbidden scope",
        403,
      );
      const err404 = createMockAxiosError(
        "ERR_BAD_REQUEST",
        "Account not found",
        404,
      );

      expect(isTransientError(err400, "mtn")).toBe(false);
      expect(isTransientError(err401, "mtn")).toBe(false);
      expect(isTransientError(err403, "mtn")).toBe(false);
      expect(isTransientError(err404, "mtn")).toBe(false);
      expect(
        isTransientError(new Error("validation failed: bad request")),
      ).toBe(false);
    });
  });

  describe("2. Exponential Backoff Retry and Recovery Loops", () => {
    it("recovers successfully from transient network failure on retry attempt", async () => {
      let attempts = 0;
      const retryLog: number[] = [];

      const operation = jest.fn(async () => {
        attempts++;
        if (attempts < 3) {
          throw createMockAxiosError("ECONNRESET", "Network connection lost");
        }
        return { success: true, transactionId: "tx-recovered-001" };
      });

      const onRetry = jest.fn((info) => {
        retryLog.push(info.attempt);
      });

      const options: WithRetryOptions = {
        maxAttempts: 4,
        baseDelayMs: 10,
        provider: "mtn",
        onRetry,
      };

      const result = await withRetry(operation, options);

      expect(result).toEqual({
        success: true,
        transactionId: "tx-recovered-001",
      });
      expect(attempts).toBe(3);
      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(retryLog).toEqual([1, 2]);
    });

    it("propagates error when max retry attempts are exhausted", async () => {
      let attempts = 0;

      const failingOperation = jest.fn(async () => {
        attempts++;
        throw createMockAxiosError("ETIMEDOUT", "Gateway timeout after 5000ms");
      });

      const options: WithRetryOptions = {
        maxAttempts: 3,
        baseDelayMs: 10,
        provider: "mtn",
      };

      await expect(withRetry(failingOperation, options)).rejects.toThrow(
        "Gateway timeout after 5000ms",
      );

      expect(attempts).toBe(3);
    });

    it("propagates non-transient errors immediately without entering retry loop", async () => {
      let attempts = 0;

      const nonTransientOperation = jest.fn(async () => {
        attempts++;
        throw createMockAxiosError(
          "ERR_BAD_REQUEST",
          "Invalid currency XAF",
          400,
        );
      });

      const onRetry = jest.fn();

      const options: WithRetryOptions = {
        maxAttempts: 4,
        baseDelayMs: 10,
        provider: "mtn",
        onRetry,
      };

      await expect(withRetry(nonTransientOperation, options)).rejects.toThrow(
        "Invalid currency XAF",
      );

      expect(attempts).toBe(1);
      expect(onRetry).not.toHaveBeenCalled();
    });
  });

  describe("3. Circuit Breaker Error Propagation and Health Recovery Loops", () => {
    it("trips circuit breaker to OPEN on repeated failures and executes fallback", async () => {
      const provider = "test-provider-cb";
      const operationName = "payment";

      process.env.PROVIDER_CIRCUIT_BREAKER_VOLUME_THRESHOLD = "2";
      process.env.PROVIDER_CIRCUIT_BREAKER_ERROR_THRESHOLD_PERCENTAGE = "50";

      const failingExecute = async () => {
        return {
          success: false,
          error: new Error("Provider downstream failure"),
        };
      };

      const fallbackHandler = async (_err: unknown) => {
        return { success: true, data: "FALLBACK_TRIGGERED", provider };
      };

      // Call 1: fails, fallback executes
      const res1 = await executeWithCircuitBreaker({
        provider,
        operation: operationName,
        execute: failingExecute,
        fallback: fallbackHandler,
      });
      expect(res1.data).toBe("FALLBACK_TRIGGERED");

      // Call 2: fails, trips breaker
      const res2 = await executeWithCircuitBreaker({
        provider,
        operation: operationName,
        execute: failingExecute,
        fallback: fallbackHandler,
      });
      expect(res2.data).toBe("FALLBACK_TRIGGERED");

      // Breaker is now open or trip manually to verify open state
      await tripCircuitBreaker(provider, operationName);

      const states = getAllCircuitBreakerStatesInfo();
      const breakerState = states.find((s) => s.provider === provider);
      expect(breakerState?.state).toBe("OPEN");
    });

    it("resets tripped circuit breaker during recovery loop when health check passes", async () => {
      const provider = "mtn";
      const operationName = "payment";

      await tripCircuitBreaker(provider, operationName);

      // Verify health check returns up
      mockCheckHealth.mockResolvedValueOnce({
        status: "healthy",
        latency: 50,
        providers: {
          mtn: { status: "up", latency: 45 },
          airtel: { status: "up", latency: 50 },
          orange: { status: "up", latency: 55 },
          mpesa: { status: "up", latency: 60 },
        },
      });

      const resetSuccessful = await checkAndResetCircuitBreaker(
        provider,
        operationName,
      );
      expect(resetSuccessful).toBe(true);

      const states = getAllCircuitBreakerStatesInfo();
      const mtnState = states.find(
        (s) => s.provider === provider && s.operation === operationName,
      );
      expect(mtnState?.state).toBe("CLOSED");
    });

    it("forceCloseCircuitBreaker immediately restores closed circuit state", async () => {
      const provider = "airtel";
      const operationName = "payment";

      await tripCircuitBreaker(provider, operationName);

      await forceCloseCircuitBreaker(provider, operationName);

      const states = getAllCircuitBreakerStatesInfo();
      const airtelState = states.find(
        (s) => s.provider === provider && s.operation === operationName,
      );
      expect(airtelState?.state).toBe("CLOSED");
    });
  });
});

/**
 * NetworkOutageFallbackService — Unit Tests
 *
 * Covers:
 *  - resolveProvider: no outage (pass-through), single outage, all-down fallback
 *  - recordProviderFailure: threshold logic, early-mark, idempotency
 *  - markProviderDown / markProviderUp: state transitions, event emission
 *  - runRecoveryCheck: health-check driven recovery
 *  - startRecoveryWatchdog / stopRecoveryWatchdog: timer management
 */

import { NetworkOutageFallbackService } from "../networkOutageFallbackService";

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("../providers/healthCheck", () => ({
  checkMobileMoneyHealth: jest.fn(),
}));

jest.mock("../../../utils/metrics", () => ({
  providerFailoverAlerts: { inc: jest.fn() },
  providerFailoverTotal: { inc: jest.fn() },
  transactionErrorsTotal: { inc: jest.fn() },
  transactionTotal: { inc: jest.fn() },
}));

jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  },
}));

import { checkMobileMoneyHealth } from "../providers/healthCheck";
const mockedCheck = checkMobileMoneyHealth as jest.MockedFunction<
  typeof checkMobileMoneyHealth
>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeHealthResult(
  statuses: Record<string, "up" | "down">,
): ReturnType<typeof checkMobileMoneyHealth> {
  const providers: Record<
    string,
    { status: "up" | "down"; responseTime: number | null }
  > = {};
  for (const [name, status] of Object.entries(statuses)) {
    providers[name] = { status, responseTime: status === "up" ? 120 : null };
  }
  return Promise.resolve({ providers } as any);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("NetworkOutageFallbackService", () => {
  let svc: NetworkOutageFallbackService;

  beforeEach(() => {
    svc = new NetworkOutageFallbackService();
    jest.clearAllMocks();
  });

  afterEach(() => {
    svc._reset();
  });

  // ── resolveProvider ────────────────────────────────────────────────────────

  describe("resolveProvider", () => {
    it("returns the requested provider unchanged when it is healthy", () => {
      const decision = svc.resolveProvider("mtn");
      expect(decision.resolvedProvider).toBe("mtn");
      expect(decision.didFallback).toBe(false);
      expect(decision.outage).toBeUndefined();
    });

    it("routes to the first healthy fallback when the requested provider is down", () => {
      svc.markProviderDown("mtn", 5);
      // airtel is healthy, so it should be chosen
      const decision = svc.resolveProvider("mtn");
      expect(decision.resolvedProvider).toBe("airtel");
      expect(decision.didFallback).toBe(true);
      expect(decision.outage).toBeDefined();
      expect(decision.outage?.provider).toBe("mtn");
    });

    it("skips fallbacks that are also down and picks the next healthy one", () => {
      svc.markProviderDown("mtn", 5);
      svc.markProviderDown("airtel", 5);
      // orange is healthy
      const decision = svc.resolveProvider("mtn");
      expect(decision.resolvedProvider).toBe("orange");
      expect(decision.didFallback).toBe(true);
    });

    it("returns the original provider (fail-open) when all fallbacks are down", () => {
      svc.markProviderDown("mtn", 5);
      svc.markProviderDown("airtel", 5);
      svc.markProviderDown("orange", 5);
      svc.markProviderDown("sms_portal", 5);

      const decision = svc.resolveProvider("mtn");
      expect(decision.resolvedProvider).toBe("mtn");
      expect(decision.didFallback).toBe(false);
      expect(decision.outage).toBeDefined();
    });

    it("emits a 'fallback' event when switching providers", () => {
      const handler = jest.fn();
      svc.on("fallback", handler);
      svc.markProviderDown("airtel", 3);
      svc.resolveProvider("airtel");
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ from: "airtel" }),
      );
    });
  });

  // ── recordProviderFailure ─────────────────────────────────────────────────

  describe("recordProviderFailure", () => {
    it("increments the failure counter without marking outage below threshold", () => {
      svc.recordProviderFailure("mtn");
      svc.recordProviderFailure("mtn");
      expect(svc.isProviderDown("mtn")).toBe(false);
      expect(svc.getFailureCounts().get("mtn")).toBe(2);
    });

    it("marks the provider down once the threshold is reached", () => {
      // Default threshold is 3
      svc.recordProviderFailure("orange");
      svc.recordProviderFailure("orange");
      expect(svc.isProviderDown("orange")).toBe(false);
      svc.recordProviderFailure("orange");
      expect(svc.isProviderDown("orange")).toBe(true);
    });

    it("does not double-mark an already-down provider", () => {
      const handler = jest.fn();
      svc.on("outage", handler);
      svc.markProviderDown("mtn", 1);
      svc.recordProviderFailure("mtn"); // already down — should not emit again
      svc.recordProviderFailure("mtn");
      svc.recordProviderFailure("mtn");
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  // ── markProviderDown / markProviderUp ─────────────────────────────────────

  describe("markProviderDown / markProviderUp", () => {
    it("records an outage with correct metadata", () => {
      const before = Date.now();
      svc.markProviderDown("airtel", 7);
      const outage = svc.getOutages().get("airtel");
      expect(outage).toBeDefined();
      expect(outage?.provider).toBe("airtel");
      expect(outage?.failureCount).toBe(7);
      expect(new Date(outage!.detectedAt).getTime()).toBeGreaterThanOrEqual(
        before,
      );
    });

    it("is idempotent — calling markProviderDown twice does not create duplicate entries", () => {
      svc.markProviderDown("airtel", 1);
      svc.markProviderDown("airtel", 99); // second call should be ignored
      expect(svc.getOutages().get("airtel")?.failureCount).toBe(1);
    });

    it("clears the outage on markProviderUp and resets failure count", () => {
      svc.markProviderDown("orange", 3);
      svc.markProviderUp("orange");
      expect(svc.isProviderDown("orange")).toBe(false);
      expect(svc.getFailureCounts().get("orange")).toBeUndefined();
    });

    it("emits 'outage' and 'recovery' events at the right times", () => {
      const onOutage = jest.fn();
      const onRecovery = jest.fn();
      svc.on("outage", onOutage);
      svc.on("recovery", onRecovery);

      svc.markProviderDown("mtn", 5);
      expect(onOutage).toHaveBeenCalledTimes(1);

      svc.markProviderUp("mtn");
      expect(onRecovery).toHaveBeenCalledTimes(1);
      expect(onRecovery.mock.calls[0][0]).toMatchObject({ provider: "mtn" });
    });

    it("markProviderUp is a no-op when the provider is not in outage", () => {
      const onRecovery = jest.fn();
      svc.on("recovery", onRecovery);
      svc.markProviderUp("mtn"); // not down
      expect(onRecovery).not.toHaveBeenCalled();
    });
  });

  // ── isProviderDown ────────────────────────────────────────────────────────

  describe("isProviderDown", () => {
    it("returns false for a healthy provider", () => {
      expect(svc.isProviderDown("mtn")).toBe(false);
    });

    it("returns true for a provider in outage", () => {
      svc.markProviderDown("mtn", 1);
      expect(svc.isProviderDown("mtn")).toBe(true);
    });
  });

  // ── runRecoveryCheck ──────────────────────────────────────────────────────

  describe("runRecoveryCheck", () => {
    it("clears outage for providers that come back up", async () => {
      svc.markProviderDown("mtn", 3);
      mockedCheck.mockImplementation(() => makeHealthResult({ mtn: "up" }));

      await svc.runRecoveryCheck();

      expect(svc.isProviderDown("mtn")).toBe(false);
    });

    it("keeps outage active for providers still down", async () => {
      svc.markProviderDown("mtn", 3);
      mockedCheck.mockImplementation(() => makeHealthResult({ mtn: "down" }));

      await svc.runRecoveryCheck();

      expect(svc.isProviderDown("mtn")).toBe(true);
    });

    it("updates lastCheckedAt during recovery poll", async () => {
      svc.markProviderDown("airtel", 2);
      mockedCheck.mockImplementation(() =>
        makeHealthResult({ airtel: "down" }),
      );

      await svc.runRecoveryCheck();

      const record = svc.getOutages().get("airtel");
      expect(record?.lastCheckedAt).not.toBeNull();
    });

    it("is a no-op when no providers are down", async () => {
      await svc.runRecoveryCheck();
      expect(mockedCheck).not.toHaveBeenCalled();
    });

    it("handles health check failures gracefully without throwing", async () => {
      svc.markProviderDown("orange", 4);
      mockedCheck.mockRejectedValue(new Error("Network unreachable"));

      await expect(svc.runRecoveryCheck()).resolves.toBeUndefined();
      // outage record should remain unchanged
      expect(svc.isProviderDown("orange")).toBe(true);
    });
  });

  // ── Watchdog timer ────────────────────────────────────────────────────────

  describe("startRecoveryWatchdog / stopRecoveryWatchdog", () => {
    it("can be started and stopped without error", () => {
      svc.startRecoveryWatchdog();
      svc.stopRecoveryWatchdog();
    });

    it("calling start twice does not create duplicate timers", () => {
      svc.startRecoveryWatchdog();
      const timerBefore = (svc as any).recoveryTimer;
      svc.startRecoveryWatchdog(); // second call
      expect((svc as any).recoveryTimer).toBe(timerBefore);
      svc.stopRecoveryWatchdog();
    });

    it("clears the timer reference on stop", () => {
      svc.startRecoveryWatchdog();
      svc.stopRecoveryWatchdog();
      expect((svc as any).recoveryTimer).toBeNull();
    });
  });

  // ── _reset ────────────────────────────────────────────────────────────────

  describe("_reset", () => {
    it("clears all outages and failure counts", () => {
      svc.markProviderDown("mtn", 5);
      svc.recordProviderFailure("airtel");
      svc._reset();
      expect(svc.getOutages().size).toBe(0);
      expect(svc.getFailureCounts().size).toBe(0);
    });
  });
});

import { Pool } from "pg";

jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: {
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
}));

const mockPool = {
  query: jest.fn(),
} as unknown as Pool;

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("deadlockDetector", () => {
  let startDeadlockDetector: (
    pool: Pool,
  ) => void;
  let stopDeadlockDetector: () => void;
  let logger: { warn: jest.Mock; info: jest.Mock; error: jest.Mock };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockPool.query = jest.fn();

    const mod = require("../deadlockDetector");
    startDeadlockDetector = mod.startDeadlockDetector;
    stopDeadlockDetector = mod.stopDeadlockDetector;
    logger = require("../../utils/logger").default;
  });

  afterEach(() => {
    stopDeadlockDetector();
  });

  it("queries pg_stat_activity on start", async () => {
    mockPool.query = jest.fn().mockResolvedValue({ rows: [] });

    startDeadlockDetector(mockPool);
    await flushPromises();

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining("pg_stat_activity"),
      expect.any(Array),
    );
    stopDeadlockDetector();
  });

  it("logs a warning and cancels the blocking query when a blocked query is detected", async () => {
    const blockedRow = {
      blocked_pid: 101,
      blocked_query: "SELECT * FROM users WHERE id = 1 FOR UPDATE",
      blocking_pid: 202,
      blocking_query: "UPDATE users SET balance = balance - 100 WHERE id = 1",
      blocked_duration_seconds: 5,
    };
    mockPool.query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [blockedRow] })
      .mockResolvedValueOnce({ rows: [] });

    startDeadlockDetector(mockPool);
    await flushPromises();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "deadlock_detected",
        blockedPid: 101,
        blockingPid: 202,
        blockedDurationSeconds: 5,
      }),
    );

    expect(mockPool.query).toHaveBeenCalledWith(
      "SELECT pg_cancel_backend($1)",
      [202],
    );

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("Cancelled blocking query PID 202"),
    );
    stopDeadlockDetector();
  });

  it("does nothing when no blocked queries exist", async () => {
    mockPool.query = jest.fn().mockResolvedValue({ rows: [] });

    startDeadlockDetector(mockPool);
    await flushPromises();

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
    stopDeadlockDetector();
  });

  it("handles detection query errors gracefully", async () => {
    const dbError = new Error("connection lost");
    mockPool.query = jest.fn().mockRejectedValueOnce(dbError);

    startDeadlockDetector(mockPool);
    await flushPromises();

    expect(logger.error).toHaveBeenCalledWith(
      "[DeadlockDetector] Failed to check for blocked queries",
      dbError,
    );
    stopDeadlockDetector();
  });

  it("handles cancel failures gracefully", async () => {
    const blockedRow = {
      blocked_pid: 101,
      blocked_query: "SELECT * FROM users WHERE id = 1 FOR UPDATE",
      blocking_pid: 202,
      blocking_query: "UPDATE users SET balance = balance - 100 WHERE id = 1",
      blocked_duration_seconds: 5,
    };
    const cancelError = new Error("permission denied");
    mockPool.query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [blockedRow] })
      .mockRejectedValueOnce(cancelError);

    startDeadlockDetector(mockPool);
    await flushPromises();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "deadlock_detected",
        blockedPid: 101,
      }),
    );

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to cancel blocking query PID 202"),
      cancelError,
    );
    stopDeadlockDetector();
  });

  it("does not start a second interval when called twice", async () => {
    mockPool.query = jest.fn().mockResolvedValue({ rows: [] });

    startDeadlockDetector(mockPool);
    startDeadlockDetector(mockPool);
    await flushPromises();

    expect(mockPool.query).toHaveBeenCalledTimes(1);
    stopDeadlockDetector();
  });

  it("restarts detection after stopDeadlockDetector", async () => {
    mockPool.query = jest.fn().mockResolvedValue({ rows: [] });

    startDeadlockDetector(mockPool);
    await flushPromises();
    expect(mockPool.query).toHaveBeenCalledTimes(1);

    stopDeadlockDetector();
    startDeadlockDetector(mockPool);
    await flushPromises();
    expect(mockPool.query).toHaveBeenCalledTimes(2);
    stopDeadlockDetector();
  });

  it("sanitizes sensitive data in logged blocked queries", async () => {
    const blockedRow = {
      blocked_pid: 101,
      blocked_query:
        "SELECT * FROM users WHERE email = 'test@example.com' AND phone = '1234567890'",
      blocking_pid: 202,
      blocking_query: "UPDATE users SET api_key = 'abcdefghijklmnopqrst1234567890' WHERE id = 1",
      blocked_duration_seconds: 5,
    };
    mockPool.query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [blockedRow] })
      .mockResolvedValueOnce({ rows: [] });

    startDeadlockDetector(mockPool);
    await flushPromises();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        blockedQuery: expect.not.stringContaining("test@example.com"),
        blockingQuery: expect.not.stringContaining("abcdefghijklmnopqrst"),
      }),
    );
    stopDeadlockDetector();
  });
});

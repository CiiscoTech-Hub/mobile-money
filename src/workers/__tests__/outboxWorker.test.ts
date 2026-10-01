import { OutboxWorker, runOutboxWorkerJob } from "../outboxWorker";

describe("Outbox Worker (#1984)", () => {
  describe("OutboxWorker processing cycle", () => {
    let mockPool: any;
    let worker: OutboxWorker;

    beforeEach(() => {
      mockPool = {
        query: jest.fn(),
      };
      worker = new OutboxWorker({
        pool: mockPool,
        pollIntervalMs: 100,
        batchSize: 10,
        maxAttempts: 3,
        retryDelayMs: 1000,
        pruneAfterHours: 24,
      });
    });

    it("should fetch and process pending events successfully", async () => {
      const mockEvents = [
        {
          id: "event-1",
          event_type: "transaction.completed",
          aggregate_type: "transaction",
          aggregate_id: "tx-123",
          payload: { amount: 100 },
          status: "pending",
          attempts: 0,
          max_attempts: 5,
          last_attempt_at: null,
          next_attempt_at: new Date(),
          error_message: null,
          published_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      mockPool.query
        .mockResolvedValueOnce({ rows: mockEvents }) // fetchPendingEvents
        .mockResolvedValueOnce({}) // markAsProcessing
        .mockResolvedValueOnce({}) // markAsPublished
        .mockResolvedValueOnce({ rowCount: 0 }); // pruneOldEvents

      const result = await worker.process();

      expect(result.processed).toBe(1);
      expect(result.published).toBe(1);
      expect(result.failed).toBe(0);
      expect(mockPool.query).toHaveBeenCalledTimes(4);
    });

    it("should handle publishing failures and schedule retries", async () => {
      const mockEvents = [
        {
          id: "event-1",
          event_type: "transaction.completed",
          aggregate_type: "transaction",
          aggregate_id: "tx-123",
          payload: { amount: 100 },
          status: "pending",
          attempts: 0,
          max_attempts: 5,
          last_attempt_at: null,
          next_attempt_at: new Date(),
          error_message: null,
          published_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      mockPool.query
        .mockResolvedValueOnce({ rows: mockEvents }) // fetchPendingEvents
        .mockResolvedValueOnce({}) // markAsProcessing
        .mockResolvedValueOnce({ rows: [{ attempts: 1, max_attempts: 5 }] }) // check attempts
        .mockResolvedValueOnce({}) // markAsFailed
        .mockResolvedValueOnce({ rowCount: 0 }); // pruneOldEvents

      // Mock publishEvent to fail
      jest.spyOn(worker as any, "publishEvent").mockResolvedValueOnce({
        success: false,
        error: "Connection failed",
      });

      const result = await worker.process();

      expect(result.processed).toBe(1);
      expect(result.published).toBe(0);
      expect(result.failed).toBe(1);
    });

    it("should mark events as permanently failed after max attempts", async () => {
      const mockEvents = [
        {
          id: "event-1",
          event_type: "transaction.completed",
          aggregate_type: "transaction",
          aggregate_id: "tx-123",
          payload: { amount: 100 },
          status: "failed",
          attempts: 3,
          max_attempts: 3,
          last_attempt_at: new Date(),
          next_attempt_at: new Date(),
          error_message: "Previous error",
          published_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      mockPool.query
        .mockResolvedValueOnce({ rows: mockEvents }) // fetchPendingEvents
        .mockResolvedValueOnce({}) // markAsProcessing
        .mockResolvedValueOnce({ rows: [{ attempts: 3, max_attempts: 3 }] }) // check attempts
        .mockResolvedValueOnce({}) // markAsFailed (permanent)
        .mockResolvedValueOnce({ rowCount: 0 }); // pruneOldEvents

      jest.spyOn(worker as any, "publishEvent").mockResolvedValueOnce({
        success: false,
        error: "Connection failed",
      });

      const result = await worker.process();

      expect(result.processed).toBe(1);
      expect(result.failed).toBe(1);
    });

    it("should prune old published events", async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] }) // fetchPendingEvents
        .mockResolvedValueOnce({ rowCount: 5 }); // pruneOldEvents

      const result = await worker.process();

      expect(result.pruned).toBe(5);
    });

    it("should skip processing if already running", async () => {
      // Set isRunning to true manually
      (worker as any).isRunning = true;

      const result = await worker.process();

      expect(result.processed).toBe(0);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it("should handle database errors gracefully", async () => {
      mockPool.query.mockRejectedValueOnce(
        new Error("Database connection failed"),
      );

      await expect(worker.process()).rejects.toThrow(
        "Database connection failed",
      );
    });
  });

  describe("runOutboxWorkerJob", () => {
    it("should call process on the default worker instance", async () => {
      const mockProcess = jest.fn().mockResolvedValue({
        processed: 0,
        published: 0,
        failed: 0,
        pruned: 0,
        durationMs: 0,
      });

      jest
        .spyOn(require("../outboxWorker").outboxWorker, "process")
        .mockImplementation(mockProcess);

      await runOutboxWorkerJob();

      expect(mockProcess).toHaveBeenCalled();
    });
  });
});

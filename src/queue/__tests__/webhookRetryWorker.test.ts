import { Job } from "bullmq";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

type Handler = (...args: any[]) => void;

/** Captures the processor function and event handlers passed to `new Worker(...)`. */
class FakeWorker {
  public static instances: FakeWorker[] = [];
  public processor: (job: any) => Promise<unknown>;
  public handlers: Record<string, Handler> = {};

  constructor(_name: string, processor: (job: any) => Promise<unknown>) {
    this.processor = processor;
    FakeWorker.instances.push(this);
  }

  on(event: string, handler: Handler): this {
    this.handlers[event] = handler;
    return this;
  }

  async close(): Promise<void> {}
}

jest.mock("bullmq", () => ({
  Worker: FakeWorker,
  Job: class {},
}));

jest.mock("../webhookRetryQueue", () => ({
  webhookRetryQueue: {},
}));

jest.mock("../config", () => ({
  queueOptions: {},
  getWebhookRetryWorkerConcurrency: () => 10,
}));

const capturePersistentFailureMock = jest.fn().mockResolvedValue(undefined);
jest.mock("../dlq", () => ({
  capturePersistentFailure: (...args: any[]) =>
    capturePersistentFailureMock(...args),
}));

const findByIdMock = jest.fn();
jest.mock("../../models/transaction", () => ({
  TransactionModel: jest.fn().mockImplementation(() => ({
    findById: findByIdMock,
  })),
}));

const sendTransactionEventMock = jest.fn();
const sendFlatTransactionEventMock = jest.fn();
jest.mock("../../services/webhook", () => ({
  WebhookService: jest.fn().mockImplementation(() => ({
    sendTransactionEvent: sendTransactionEventMock,
    sendFlatTransactionEvent: sendFlatTransactionEventMock,
  })),
}));

jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { startWebhookRetryWorker, closeWebhookRetryWorker } from "../webhookRetryWorker";

describe("webhookRetryWorker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    FakeWorker.instances = [];
  });

  afterEach(async () => {
    await closeWebhookRetryWorker();
  });

  function getWorker(): FakeWorker {
    startWebhookRetryWorker();
    return FakeWorker.instances[0];
  }

  describe("processor", () => {
    it("delivers the webhook and logs the status code on success", async () => {
      findByIdMock.mockResolvedValue({ id: "tx-1" });
      sendTransactionEventMock.mockResolvedValue({
        status: "delivered",
        statusCode: 200,
      });

      const worker = getWorker();
      await worker.processor({
        data: {
          webhookId: "tx-1",
          userId: "user-1",
          url: "https://example.com/hook",
          secret: "s3cr3t",
          eventType: "transaction.completed",
          payload: {},
        },
        attemptsMade: 0,
      } as unknown as Job);

      expect(sendTransactionEventMock).toHaveBeenCalled();
    });

    it("throws (so BullMQ retries) when the delivery fails", async () => {
      findByIdMock.mockResolvedValue({ id: "tx-1" });
      sendTransactionEventMock.mockResolvedValue({
        status: "failed",
        statusCode: 503,
        lastError: "upstream unavailable",
      });

      const worker = getWorker();

      await expect(
        worker.processor({
          data: {
            webhookId: "tx-1",
            userId: "user-1",
            url: "https://example.com/hook",
            secret: "s3cr3t",
            eventType: "transaction.completed",
            payload: {},
          },
          attemptsMade: 4,
        } as unknown as Job),
      ).rejects.toThrow("upstream unavailable");
    });

    it("skips processing when the transaction can't be found", async () => {
      findByIdMock.mockResolvedValue(null);

      const worker = getWorker();
      await worker.processor({
        data: {
          webhookId: "missing-tx",
          userId: "user-1",
          url: "https://example.com/hook",
          secret: "s3cr3t",
          eventType: "transaction.completed",
          payload: {},
        },
        attemptsMade: 0,
      } as unknown as Job);

      expect(sendTransactionEventMock).not.toHaveBeenCalled();
    });
  });

  describe("'failed' event — DLQ integration (#1549)", () => {
    it("captures the job to the DLQ when the worker emits 'failed'", () => {
      const worker = getWorker();
      const fakeJob = { id: "job-1", attemptsMade: 5, opts: { attempts: 5 } };

      worker.handlers["failed"](fakeJob, new Error("exhausted"));

      expect(capturePersistentFailureMock).toHaveBeenCalledWith(fakeJob);
    });

    it("does not throw when no job is provided to the 'failed' handler", () => {
      const worker = getWorker();

      expect(() =>
        worker.handlers["failed"](undefined, new Error("no job")),
      ).not.toThrow();
      expect(capturePersistentFailureMock).not.toHaveBeenCalled();
    });
  });
});

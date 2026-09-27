export {};

let mockQueueCtor: jest.Mock;

function setupMocks() {
  mockQueueCtor = jest.fn(() => ({
    add: jest.fn().mockResolvedValue({ id: "mock-job-id" }),
    getJob: jest.fn(),
    getWaitingCount: jest.fn().mockResolvedValue(0),
    getActiveCount: jest.fn().mockResolvedValue(0),
    getCompletedCount: jest.fn().mockResolvedValue(0),
    getFailedCount: jest.fn().mockResolvedValue(0),
    isPaused: jest.fn().mockResolvedValue(false),
    close: jest.fn().mockResolvedValue(undefined),
  }));

  jest.mock("bullmq", () => ({
    Queue: mockQueueCtor,
  }));

  jest.mock("../../queue/config", () => ({
    queueOptions: {},
  }));
}

describe("syncQueue — job retention configuration", () => {
  beforeEach(() => {
    jest.resetModules();
    setupMocks();
  });

  it("configures removeOnComplete with count 1000 and age 24 hours", async () => {
    await import("../../queue/syncQueue");

    expect(mockQueueCtor).toHaveBeenCalledWith(
      "accounting-sync",
      expect.objectContaining({
        defaultJobOptions: expect.objectContaining({
          removeOnComplete: {
            count: 1000,
            age: 24 * 3600,
          },
        }),
      }),
    );
  });

  it("configures removeOnFail with count 500 and age 7 days", async () => {
    await import("../../queue/syncQueue");

    expect(mockQueueCtor).toHaveBeenCalledWith(
      "accounting-sync",
      expect.objectContaining({
        defaultJobOptions: expect.objectContaining({
          removeOnFail: {
            count: 500,
            age: 7 * 24 * 3600,
          },
        }),
      }),
    );
  });

  it("preserves existing retry and backoff configuration", async () => {
    await import("../../queue/syncQueue");

    expect(mockQueueCtor).toHaveBeenCalledWith(
      "accounting-sync",
      expect.objectContaining({
        defaultJobOptions: expect.objectContaining({
          attempts: 5,
          backoff: {
            type: "exponential",
            delay: 3000,
          },
        }),
      }),
    );
  });
});

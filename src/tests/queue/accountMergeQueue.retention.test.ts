export {};

let mockQueueCtor: jest.Mock;
let mockAdd: jest.Mock;

function setupMocks() {
  mockAdd = jest.fn().mockResolvedValue({ id: "mock-job-id" });
  mockQueueCtor = jest.fn(() => ({
    add: mockAdd,
    close: jest.fn(),
    getJob: jest.fn(),
    getWaitingCount: jest.fn().mockResolvedValue(0),
    getActiveCount: jest.fn().mockResolvedValue(0),
    getCompletedCount: jest.fn().mockResolvedValue(0),
    getFailedCount: jest.fn().mockResolvedValue(0),
    isPaused: jest.fn().mockResolvedValue(false),
    pause: jest.fn(),
    resume: jest.fn(),
    drain: jest.fn(),
  }));

  jest.mock("bullmq", () => ({
    Queue: mockQueueCtor,
  }));

  jest.mock("../../queue/config", () => ({
    queueOptions: {},
  }));
}

describe("accountMergeQueue — job retention configuration", () => {
  beforeEach(() => {
    jest.resetModules();
    setupMocks();
  });

  it("configures removeOnComplete with count 100 and age 7 days", async () => {
    await import("../../queue/accountMergeQueue");

    expect(mockQueueCtor).toHaveBeenCalledWith(
      "account-merge",
      expect.objectContaining({
        defaultJobOptions: expect.objectContaining({
          removeOnComplete: {
            count: 100,
            age: 7 * 24 * 3600,
          },
        }),
      }),
    );
  });

  it("configures removeOnFail with count 200 and age 30 days", async () => {
    await import("../../queue/accountMergeQueue");

    expect(mockQueueCtor).toHaveBeenCalledWith(
      "account-merge",
      expect.objectContaining({
        defaultJobOptions: expect.objectContaining({
          removeOnFail: {
            count: 200,
            age: 30 * 24 * 3600,
          },
        }),
      }),
    );
  });

  it("retention options are applied to batch jobs via defaultJobOptions", async () => {
    const { addBatchAccountMergeJobs } = await import("../../queue/accountMergeQueue");

    const jobs = [
      {
        sourceSecret: "S_SECRET1",
        destinationPublicKey: "GDEST1",
        inactivityDays: 90,
        dryRun: false,
      },
      {
        sourceSecret: "S_SECRET2",
        destinationPublicKey: "GDEST2",
        inactivityDays: 90,
        dryRun: false,
      },
    ];

    await addBatchAccountMergeJobs(jobs);

    expect(mockAdd).toHaveBeenCalledTimes(2);
  });
});

import request from "supertest";
import { Pool } from "pg";
import express from "express";
process.env.KYC_AUTHORITY_PRIVATE_KEY = "1".repeat(64);
process.env.KYC_AUTHORITY_PUBLIC_KEY =
  "0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8";
process.env.DB_ENCRYPTION_KEY = "development-encryption-key-32-chars-long";
process.env.KYC_ADDRESS_PROOF_PEPPER = "test-address-proof-pepper";

jest.mock("redis", () => ({
  createClient: jest.fn(() => ({
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    quit: jest.fn().mockResolvedValue(undefined),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    keys: jest.fn().mockResolvedValue([]),
    ping: jest.fn().mockResolvedValue("PONG"),
  })),
}));

jest.mock("connect-redis", () => ({
  RedisStore: jest.fn(() => ({
    get: jest.fn(),
    set: jest.fn(),
    destroy: jest.fn(),
  })),
}));

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock("../../src/config/s3", () => ({
  getS3Client: jest.fn(() => ({ send: jest.fn() })),
  s3Config: { bucket: "test-bucket", region: "us-east-1" },
  getS3ObjectUrl: jest.fn((key) => `https://example.com/${key}`),
  getSignedObjectUrl: jest.fn(
    async (key) => `https://example.com/${key}?signed=1`,
  ),
}));

import { createKYCRoutes } from "../../src/routes/kycRoutes";
import KYCService from "../../src/services/kyc";
import ZkProofService from "../../src/services/compliance/zkProofService";
import { errorHandler } from "../../src/middleware/errorHandler";

jest.mock("../../src/services/kyc");
jest.mock("../../src/services/compliance/zkProofService");

jest.mock("../../src/middleware/auth", () => ({
  authenticateToken: (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    req.jwtUser = { userId: "test-user-id", role: "user" } as any;
    req.user = { id: "test-user-id", email: "test@example.com", role: "user" };
    next();
  },
}));

describe("ZK KYC Routes", () => {
  let app: express.Application;
  let mockPool: any;
  let mockZkProofService: {
    issueAddressProof: jest.Mock;
    verifyAddressProof: jest.Mock;
  };

  beforeEach(() => {
    (KYCService as jest.MockedClass<typeof KYCService>).mockImplementation(
      () =>
        ({
          createApplicant: jest.fn(),
          getApplicant: jest.fn(),
          uploadDocument: jest.fn(),
          createWorkflowRun: jest.fn(),
          generateSDKToken: jest.fn(),
          getVerificationStatus: jest.fn(),
          handleWebhook: jest.fn(),
          updateUserKYCLevel: jest.fn(),
          getTransactionLimits: jest.fn().mockReturnValue({
            dailyLimit: 1000,
            perTransactionLimit: { min: 1, max: 500 },
          }),
        }) as any,
    );

    mockZkProofService = {
      issueAddressProof: jest.fn(),
      verifyAddressProof: jest.fn(),
    };
    (
      ZkProofService as jest.MockedClass<typeof ZkProofService>
    ).mockImplementation(() => mockZkProofService as any);

    mockPool = {
      query: jest.fn(),
    } as unknown as jest.Mocked<Pool>;

    app = express();
    app.use(express.json({ limit: "2mb" }));
    app.use("/api/kyc", createKYCRoutes(mockPool));
    app.use(errorHandler);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("issues an address-validity proof without storing a raw utility bill reference", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ user_id: "test-user-id" }],
    } as any);
    mockZkProofService.issueAddressProof.mockResolvedValue({
      proofId: "proof-id",
      vaultId: "vault-id",
      applicantId: "applicant-1",
      proofType: "address_validity",
      proofVersion: "1.0",
      status: "issued",
      complianceScore: 100,
      complianceChecks: [],
      providerReference: "utility-bill:applicant-1",
      issuedAt: new Date().toISOString(),
      verifiedAt: null,
    });

    const response = await request(app)
      .post("/api/kyc/zk/issue-credential")
      .send({
        applicant_id: "applicant-1",
        filename: "utility-bill.pdf",
        mime_type: "application/pdf",
        utility_bill_data: Buffer.from("utility bill bytes").toString("base64"),
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.proofType).toBe("address_validity");
    expect(response.body.data.vaultId).toBe("vault-id");
    expect(response.body.data.complianceScore).toBe(100);
    expect(mockZkProofService.issueAddressProof).toHaveBeenCalledWith(
      "test-user-id",
      expect.objectContaining({ applicant_id: "applicant-1" }),
    );
    expect(
      mockPool.query.mock.calls.some((call: any[]) =>
        String(call[0]).includes("INSERT INTO kyc_documents"),
      ),
    ).toBe(false);
  });

  it("verifies a stored address proof and returns compliance status data", async () => {
    const issuedAt = new Date().toISOString();
    const verifiedAt = new Date().toISOString();

    mockPool.query.mockResolvedValueOnce({
      rows: [{ user_id: "test-user-id" }],
    } as any);
    mockZkProofService.verifyAddressProof.mockResolvedValue({
      proofId: "proof-id",
      vaultId: "vault-id",
      applicantId: "applicant-1",
      proofType: "address_validity",
      proofVersion: "1.0",
      status: "verified",
      complianceScore: 100,
      complianceChecks: [
        {
          name: "authority_signature_valid",
          passed: true,
          weight: 35,
          score: 35,
        },
      ],
      providerReference: "utility-bill:applicant-1",
      issuedAt,
      verifiedAt,
    });

    const response = await request(app)
      .post("/api/kyc/zk/verify-proof")
      .send({ applicant_id: "applicant-1" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.proofId).toBe("proof-id");
    expect(response.body.data.status).toBe("verified");
    expect(response.body.data.complianceScore).toBe(100);
    expect(mockZkProofService.verifyAddressProof).toHaveBeenCalledWith(
      "test-user-id",
      { applicant_id: "applicant-1" },
    );
  });
});

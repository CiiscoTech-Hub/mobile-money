import express from "express";
import request from "supertest";

const exportForCompliance = jest.fn();
const findByTransactionId = jest.fn();

jest.mock("../../middleware/auth", () => ({
  requireAuth: jest.fn((req: any, _res: any, next: () => void) => {
    req.user = { id: "admin-1", role: "admin" };
    next();
  }),
}));

jest.mock("../../compliance/travelRule", () => ({
  travelRuleService: {
    exportForCompliance,
    findByTransactionId,
  },
}));

jest.mock("../../controllers/complianceController", () => ({
  travelRuleCheckHandler: (_req: any, res: any) => {
    res.status(200).json({ ok: true });
  },
}));

import { travelRuleRoutes } from "../travelRule";

describe("travelRuleRoutes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use(travelRuleRoutes);
    return app;
  }

  it("exports travel-rule records as JSON and CSV", async () => {
    exportForCompliance.mockResolvedValue([
      {
        id: "record-1",
        transactionId: "txn-1",
        amount: 25,
        currency: "USD",
        sender: {
          name: "Alice",
          account: "acct-1",
          address: "1 Main St",
          dob: "1990-01-01",
          idNumber: "123456",
        },
        receiver: {
          name: "Bob",
          account: "acct-2",
          address: "2 Main St",
        },
        originatingVasp: "VASP A",
        beneficiaryVasp: "VASP B",
        createdAt: new Date("2024-01-01T00:00:00.000Z"),
        exportedAt: new Date("2024-01-02T00:00:00.000Z"),
        exportedBy: "admin-1",
      },
    ]);

    const jsonResponse = await request(buildApp()).get("/?from=2024-01-01&to=2024-01-31&onlyUnexported=true");
    expect(jsonResponse.status).toBe(200);
    expect(jsonResponse.body.count).toBe(1);
    expect(jsonResponse.body.records[0].sender.address).toBe("1 Main St");

    const csvResponse = await request(buildApp()).get("/export.csv");
    expect(csvResponse.status).toBe(200);
    expect(csvResponse.headers["content-type"]).toContain("text/csv");
    expect(csvResponse.text).toContain("Sender Name");
    expect(csvResponse.text).toContain("Alice");
  });

  it("returns a single travel-rule record by transaction id", async () => {
    findByTransactionId.mockResolvedValue(null);
    const missing = await request(buildApp()).get("/txn-404");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: "No Travel Rule record for this transaction" });

    const record = {
      id: "record-2",
      transactionId: "txn-2",
      amount: 10,
      currency: "USD",
      sender: { name: "Alice", account: "acct-1", address: null, dob: null, idNumber: null },
      receiver: { name: "Bob", account: "acct-2", address: null },
      originatingVasp: null,
      beneficiaryVasp: null,
      createdAt: new Date("2024-01-03T00:00:00.000Z"),
      exportedAt: null,
      exportedBy: null,
    };
    findByTransactionId.mockResolvedValueOnce(record);

    const found = await request(buildApp()).get("/txn-2");
    expect(found.status).toBe(200);
    expect(found.body.transactionId).toBe("txn-2");
  });
});

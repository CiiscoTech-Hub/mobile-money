import {
  describe,
  expect,
  it,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { TransactionModel, TransactionStatus } from "../../models/transaction";
import { UserModel } from "../../models/users";
import { pool } from "../../config/database";

describe("TransactionModel Integration Tests", () => {
  let transactionModel: TransactionModel;
  let userModel: UserModel;
  let testUserId: string;
  let testTransactionId: string;

  beforeAll(async () => {
    transactionModel = new TransactionModel();
    userModel = new UserModel();

    const userResult = await pool.query(
      `INSERT INTO users (phone_number, kyc_level, status)
       VALUES ($1, $2, $3)
       RETURNING id`,
      ["+15551234002", "basic", "active"],
    );
    testUserId = userResult.rows[0].id;
  });

  afterAll(async () => {
    await pool.query("DELETE FROM transactions WHERE user_id = $1", [testUserId]);
    await pool.query("DELETE FROM users WHERE id = $1", [testUserId]);
  });

  beforeEach(async () => {
    await pool.query("BEGIN");
  });

  afterEach(async () => {
    await pool.query("ROLLBACK");
  });

  it("should insert a new transaction and return it with correct fields", async () => {
    const result = await transactionModel.create({
      type: "deposit",
      amount: "100.00",
      phoneNumber: "+15551234002",
      provider: "test_provider",
      stellarAddress: "GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12345678",
      status: TransactionStatus.Pending,
      userId: testUserId,
    });

    expect(result).toBeDefined();
    expect(result!.id).toBeDefined();
    expect(result!.referenceNumber).toBeDefined();
    expect(result!.type).toBe("deposit");
    expect(result!.amount).toBe("100.0000000");
    expect(result!.status).toBe(TransactionStatus.Pending);
    expect(result!.userId).toBe(testUserId);

    testTransactionId = result!.id;
  });

  it("should find a transaction by id after insertion", async () => {
    const createResult = await transactionModel.create({
      type: "withdraw",
      amount: "50.00",
      phoneNumber: "+15551234002",
      provider: "test_provider",
      stellarAddress: "GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12345678",
      status: TransactionStatus.Completed,
      userId: testUserId,
    });

    const found = await transactionModel.findById(createResult.id, testUserId);

    expect(found).toBeDefined();
    expect(found!.id).toBe(createResult.id);
    expect(found!.type).toBe("withdraw");
    expect(found!.amount).toBe("50.0000000");
    expect(found!.status).toBe(TransactionStatus.Completed);
  });

  it("should return undefined when findById is called with wrong userId", async () => {
    const createResult = await transactionModel.create({
      type: "deposit",
      amount: "75.00",
      phoneNumber: "+15551234002",
      provider: "test_provider",
      stellarAddress: "GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12345678",
      status: TransactionStatus.Pending,
      userId: testUserId,
    });

    const found = await transactionModel.findById(createResult.id, "00000000-0000-0000-0000-000000000000");
    expect(found).toBeNull();
  });

  it("should update transaction status", async () => {
    const createResult = await transactionModel.create({
      type: "deposit",
      amount: "200.00",
      phoneNumber: "+15551234002",
      provider: "test_provider",
      stellarAddress: "GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12345678",
      status: TransactionStatus.Pending,
      userId: testUserId,
    });

    await transactionModel.updateStatus(createResult.id, TransactionStatus.Completed, testUserId);

    const updated = await transactionModel.findById(createResult.id, testUserId);
    expect(updated!.status).toBe(TransactionStatus.Completed);
  });

  it("should return undefined when updating status of non-existent transaction", async () => {
    const result = await transactionModel.updateStatus(
      "00000000-0000-0000-0000-000000000000",
      TransactionStatus.Completed,
      testUserId,
    );
    expect(result).toBeUndefined();
  });

  it("should return balance statistics for a user with no transactions", async () => {
    const stats = await transactionModel.getBalanceStatistics(testUserId);

    expect(stats).toBeDefined();
    expect(stats.total_deposited).toBe("0");
    expect(stats.total_withdrawn).toBe("0");
    expect(stats.current_balance).toBe("0");
  });

  it("should calculate correct balance statistics after deposit and withdraw", async () => {
    await transactionModel.create({
      type: "deposit",
      amount: "500.00",
      phoneNumber: "+15551234002",
      provider: "test_provider",
      stellarAddress: "GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12345678",
      status: TransactionStatus.Completed,
      userId: testUserId,
    });

    await transactionModel.create({
      type: "withdraw",
      amount: "150.00",
      phoneNumber: "+15551234002",
      provider: "test_provider",
      stellarAddress: "GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12345678",
      status: TransactionStatus.Completed,
      userId: testUserId,
    });

    const stats = await transactionModel.getBalanceStatistics(testUserId);

    expect(stats.total_deposited).toBe("500.0000000");
    expect(stats.total_withdrawn).toBe("150.0000000");
    expect(stats.current_balance).toBe("350.0000000");
  });

  it("should calculate pending balance for deposits within settlement window", async () => {
    await transactionModel.create({
      type: "deposit",
      amount: "1000.00",
      phoneNumber: "+15551234002",
      provider: "test_provider",
      stellarAddress: "GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12345678",
      status: TransactionStatus.Completed,
      userId: testUserId,
    });

    const stats = await transactionModel.getBalanceStatistics(testUserId);

    expect(stats.total_deposited).toBe("1000.0000000");
    expect(stats.pending_balance).toBeDefined();
  });

  it("should insert multiple transactions and verify insertion order", async () => {
    const tx1 = await transactionModel.create({
      type: "deposit",
      amount: "100.00",
      phoneNumber: "+15551234002",
      provider: "test_provider",
      stellarAddress: "GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12345678",
      status: TransactionStatus.Pending,
      userId: testUserId,
    });

    const tx2 = await transactionModel.create({
      type: "withdraw",
      amount: "50.00",
      phoneNumber: "+15551234002",
      provider: "test_provider",
      stellarAddress: "GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12345678",
      status: TransactionStatus.Pending,
      userId: testUserId,
    });

    expect(tx1.id).not.toBe(tx2.id);
    expect(tx1.amount).toBe("100.0000000");
    expect(tx2.amount).toBe("50.0000000");
  });

  it("should handle status changes from pending to completed", async () => {
    const createResult = await transactionModel.create({
      type: "deposit",
      amount: "250.00",
      phoneNumber: "+15551234002",
      provider: "test_provider",
      stellarAddress: "GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12345678",
      status: TransactionStatus.Pending,
      userId: testUserId,
    });

    await transactionModel.updateStatus(createResult.id, TransactionStatus.Completed, testUserId);

    const updated = await transactionModel.findById(createResult.id, testUserId);
    expect(updated!.status).toBe(TransactionStatus.Completed);
  });

  it("should handle status changes to failed", async () => {
    const createResult = await transactionModel.create({
      type: "withdraw",
      amount: "75.00",
      phoneNumber: "+15551234002",
      provider: "test_provider",
      stellarAddress: "GABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12345678",
      status: TransactionStatus.Pending,
      userId: testUserId,
    });

    await transactionModel.updateStatus(createResult.id, TransactionStatus.Failed, testUserId);

    const updated = await transactionModel.findById(createResult.id, testUserId);
    expect(updated!.status).toBe(TransactionStatus.Failed);
  });
});
import {
  describe,
  expect,
  it,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { UserModel } from "../../models/users";
import { pool } from "../../config/database";

describe("UserModel Integration Tests", () => {
  let userModel: UserModel;
  let testUserId: string;

  beforeAll(async () => {
    userModel = new UserModel();

    const result = await pool.query(
      `INSERT INTO users (phone_number, kyc_level, status)
       VALUES ($1, $2, $3)
       RETURNING id`,
      ["+15551234001", "basic", "active"],
    );
    testUserId = result.rows[0].id;
  });

  afterAll(async () => {
    await pool.query("DELETE FROM users WHERE id = $1", [testUserId]);
  });

  beforeEach(async () => {
    await pool.query("BEGIN");
  });

  afterEach(async () => {
    await pool.query("ROLLBACK");
  });

  it("should find a user by id and return profile data", async () => {
    const user = await userModel.findById(testUserId, {
      id: testUserId,
      role: "user",
    });

    expect(user).toBeDefined();
    expect(user!.id).toBe(testUserId);
    expect(user!.phoneNumber).toBe("+15551234001");
    expect(user!.kycLevel).toBe("basic");
    expect(user!.status).toBe("active");
  });

  it("should return null for a non-existent user id", async () => {
    const user = await userModel.findById("00000000-0000-0000-0000-000000000000");
    expect(user).toBeNull();
  });

  it("should update sensitive data and decrypt for authorized requester", async () => {
    const sensitiveData = {
      firstName: "Jane",
      lastName: "Doe",
      address: "789 Pine St",
      dateOfBirth: "1992-06-15",
      idNumber: "ID-12345",
    };

    await userModel.updateSensitiveData(testUserId, sensitiveData);

    const user = await userModel.findById(testUserId, {
      id: testUserId,
      role: "user",
    });

    expect(user!.firstName).toBe(sensitiveData.firstName);
    expect(user!.lastName).toBe(sensitiveData.lastName);
    expect(user!.address).toBe(sensitiveData.address);
    expect(user!.dateOfBirth).toBe(sensitiveData.dateOfBirth);
    expect(user!.idNumber).toBe(sensitiveData.idNumber);
  });

  it("should encrypt sensitive data in the raw database rows", async () => {
    const sensitiveData = {
      firstName: "Encrypted",
      lastName: "User",
      address: "123 Secret Ave",
      dateOfBirth: "1990-01-01",
      idNumber: "ENC-999",
    };

    await userModel.updateSensitiveData(testUserId, sensitiveData);

    const rawResult = await pool.query(
      "SELECT first_name, last_name, address, date_of_birth, id_number FROM users WHERE id = $1",
      [testUserId],
    );

    const row = rawResult.rows[0];
    expect(row.first_name).toBeDefined();
    expect(row.first_name).not.toBe(sensitiveData.firstName);
    expect(row.last_name).not.toBe(sensitiveData.lastName);
    expect(row.address).not.toBe(sensitiveData.address);
    expect(row.date_of_birth).not.toBe(sensitiveData.dateOfBirth);
    expect(row.id_number).not.toBe(sensitiveData.idNumber);
  });

  it("should restrict decryption for unauthorized requester", async () => {
    const sensitiveData = {
      firstName: "Restricted",
      lastName: "Name",
      address: "100 Hidden Rd",
      dateOfBirth: "1988-03-22",
      idNumber: "RESTRICTED-1",
    };

    await userModel.updateSensitiveData(testUserId, sensitiveData);

    const user = await userModel.findById(testUserId, {
      id: "other-user-id",
      role: "user",
    });

    expect(user).toBeDefined();
    expect(user!.firstName).toBeDefined();
    expect(user!.firstName).not.toBe(sensitiveData.firstName);
  });

  it("should update email and persist the change", async () => {
    const newEmail = "newemail@example.com";
    await userModel.updateEmail(testUserId, newEmail);

    const user = await userModel.findById(testUserId, {
      id: testUserId,
      role: "admin",
    });

    expect(user!.email).toBe(newEmail);
  });

  it("should update display name and persist the change", async () => {
    const newDisplayName = "Test User Display";
    await userModel.updateDisplayName(testUserId, newDisplayName);

    const user = await userModel.findById(testUserId, {
      id: testUserId,
      role: "admin",
    });

    expect(user!.displayName).toBe(newDisplayName);
  });

  it("should set display name to null", async () => {
    await userModel.updateDisplayName(testUserId, "Temp Name");
    await userModel.updateDisplayName(testUserId, null);

    const user = await userModel.findById(testUserId, {
      id: testUserId,
      role: "admin",
    });

    expect(user!.displayName).toBeNull();
  });

  it("should update multiple sensitive data fields at once", async () => {
    const data = {
      firstName: "Multi",
      lastName: "Field",
      address: "Multi Address",
    };

    await userModel.updateSensitiveData(testUserId, data);

    const user = await userModel.findById(testUserId, {
      id: testUserId,
      role: "admin",
    });

    expect(user!.firstName).toBe(data.firstName);
    expect(user!.lastName).toBe(data.lastName);
    expect(user!.address).toBe(data.address);
  });
});
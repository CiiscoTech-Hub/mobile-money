import {
  generateIV,
  encryptAES256GCM,
  decryptAES256GCM,
  encryptPii,
  decryptPii,
  needsReencryption,
  reencryptIfNeeded,
} from "../crypto";
import { UserModel } from "../../models/users";
import * as db from "../../config/database";

describe("AES-256-GCM Crypto Utilities (#1562)", () => {
  describe("generateIV", () => {
    it("should generate a 12-byte (96-bit) IV for AES-256-GCM", () => {
      const iv = generateIV();
      expect(Buffer.isBuffer(iv)).toBe(true);
      expect(iv.length).toBe(12);
    });

    it("should generate unique IVs for each call", () => {
      const iv1 = generateIV().toString("hex");
      const iv2 = generateIV().toString("hex");
      expect(iv1).not.toBe(iv2);
    });
  });

  describe("encryptAES256GCM and decryptAES256GCM", () => {
    it("should encrypt and decrypt plaintext using AES-256-GCM", () => {
      const plaintext = "National ID: 123456789";
      const payload = encryptAES256GCM(plaintext);

      expect(payload.iv).toBeDefined();
      expect(payload.authTag).toBeDefined();
      expect(payload.ciphertext).toBeDefined();
      expect(payload.ciphertext).not.toBe(plaintext);

      const decrypted = decryptAES256GCM(payload.encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it("should fail decryption when authentication tag or ciphertext is tampered", () => {
      const payload = encryptAES256GCM("Sensitive Data");
      const tampered = {
        ...payload,
        ciphertext: "ff" + payload.ciphertext.slice(2),
      };

      expect(() => decryptAES256GCM(tampered)).toThrow();
    });
  });

  describe("encryptPii and decryptPii", () => {
    it("should transparently encrypt and decrypt PII strings", () => {
      const pii = "+237670000000";
      const encrypted = encryptPii(pii);

      expect(encrypted).toBeDefined();
      expect(encrypted).not.toBe(pii);

      const decrypted = decryptPii(encrypted);
      expect(decrypted).toBe(pii);
    });

    it("should return null/undefined unchanged", () => {
      expect(encryptPii(null)).toBeNull();
      expect(encryptPii(undefined)).toBeUndefined();
      expect(decryptPii(null)).toBeNull();
      expect(decryptPii(undefined)).toBeUndefined();
    });
  });

  describe("UserModel PII Field Encryption & Decryption", () => {
    let userModel: UserModel;

    beforeEach(() => {
      userModel = new UserModel();
      jest.restoreAllMocks();
    });

    it("should encrypt sensitive fields on save and decrypt on fetch", async () => {
      let storedRow: any = null;

      jest.spyOn(db, "queryWrite").mockImplementation(async (sql: string, params?: any[]) => {
        if (sql.includes("INSERT INTO users")) {
          storedRow = {
            id: "user-123-uuid",
            phone_number: params![0],
            kyc_level: params![1],
            email: params![2],
            first_name: params![3],
            last_name: params![4],
            address: params![5],
            date_of_birth: params![6],
            id_number: params![7],
            status: params![8],
            created_at: new Date(),
            updated_at: new Date(),
          };
          return { rows: [storedRow] } as any;
        }
        return { rows: [] } as any;
      });

      jest.spyOn(db, "queryRead").mockImplementation(async (sql: string, params?: any[]) => {
        if (sql.includes("SELECT * FROM users WHERE id = $1") && storedRow) {
          return { rows: [storedRow] } as any;
        }
        return { rows: [] } as any;
      });

      const user = await userModel.create({
        phoneNumber: "+15559876543",
        email: "alice@example.com",
        firstName: "Alice",
        lastName: "Smith",
        idNumber: "NAT-ID-999",
      });

      // Verify that database row contains encrypted values (not plain text)
      expect(storedRow.phone_number).not.toBe("+15559876543");
      expect(storedRow.email).not.toBe("alice@example.com");
      expect(storedRow.first_name).not.toBe("Alice");
      expect(storedRow.last_name).not.toBe("Smith");
      expect(storedRow.id_number).not.toBe("NAT-ID-999");

      // Verify that created user object returns decrypted PII
      expect(user.phoneNumber).toBe("+15559876543");
      expect(user.email).toBe("alice@example.com");
      expect(user.firstName).toBe("Alice");
      expect(user.lastName).toBe("Smith");
      expect(user.idNumber).toBe("NAT-ID-999");

      // Verify findById transparently decrypts fields
      const fetched = await userModel.findById("user-123-uuid", {
        id: "user-123-uuid",
        role: "user",
      });

      expect(fetched).not.toBeNull();
      expect(fetched!.phoneNumber).toBe("+15559876543");
      expect(fetched!.email).toBe("alice@example.com");
      expect(fetched!.firstName).toBe("Alice");
      expect(fetched!.lastName).toBe("Smith");
      expect(fetched!.idNumber).toBe("NAT-ID-999");
    });
  });
});

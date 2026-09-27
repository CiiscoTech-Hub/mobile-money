import {
  generateFlaggedTransactionComplianceReport,
  generateHighValueTransactionComplianceReport,
} from "../complianceReportService";
import * as s3Upload from "../s3Upload";
import { AMLAlert, AMLHighValueAssessment } from "../aml";
import { Transaction } from "../../models/transaction";
import crypto from "crypto";
import zlib from "zlib";
import { DB_ENCRYPTION_KEY } from "../../config/env";

jest.mock("../s3Upload", () => ({
  uploadToS3: jest.fn(),
}));

describe("Compliance Report Service", () => {
  const mockTransaction: Transaction = {
    id: "tx-123",
    referenceNumber: "REF-123",
    type: "deposit",
    amount: "1500000",
    originalAmount: 1500000,
    convertedAmount: 12050.75,
    currency: "XAF",
    phoneNumber: "+237670000000",
    provider: "mtn",
    status: "pending",
    userId: "user-123",
    createdAt: new Date("2026-01-01T12:00:00.000Z"),
    updatedAt: new Date("2026-01-01T12:00:00.000Z"),
  } as Transaction;

  const mockAlert: AMLAlert = {
    id: "alert-123",
    transactionId: "tx-123",
    userId: "user-123",
    severity: "high",
    status: "pending_review",
    ruleHits: [
      {
        rule: "single_transaction_threshold",
        message: "Transaction exceeded single transfer threshold",
        observed: 1500000,
        threshold: 1000000,
      },
    ],
    reasons: ["amount above threshold"],
    createdAt: new Date("2026-01-01T12:05:00.000Z").toISOString(),
    updatedAt: new Date("2026-01-01T12:05:00.000Z").toISOString(),
  };

  const highValueAssessment: AMLHighValueAssessment = {
    qualifies: true,
    thresholdUsd: 10000,
    usdEquivalent: 12050.75,
    originalCurrency: "XAF",
    sourceAmount: 1500000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (s3Upload.uploadToS3 as jest.Mock).mockResolvedValue({
      success: true,
      fileUrl: "https://s3.amazonaws.com/bucket/compliance-tx-123.pdf.enc",
      key: "admin/compliance-reports/2026/01/user-123/file.pdf.enc",
    });
  });

  it("generates, encrypts, and stores a compliance PDF for flagged transactions", async () => {
    const result = await generateFlaggedTransactionComplianceReport(
      mockTransaction,
      mockAlert,
    );

    expect(result.pdfUrl).toBe(
      "https://s3.amazonaws.com/bucket/compliance-tx-123.pdf.enc",
    );
    expect(result.template).toBe("flagged_transaction");
    expect(s3Upload.uploadToS3).toHaveBeenCalledTimes(1);

    const uploadCall = (s3Upload.uploadToS3 as jest.Mock).mock.calls[0][0];
    expect(uploadCall.file.originalname).toMatch(
      /COMPLIANCE_TX_tx-123_alert-123_\d+\.pdf\.enc$/,
    );
    expect(uploadCall.file.mimetype).toBe("application/octet-stream");
    expect(uploadCall.folder).toBe("compliance");

    const encryptedBuffer: Buffer = uploadCall.file.buffer;
    expect(encryptedBuffer.length).toBeGreaterThan(0);

    const decryptedPdf = decryptBuffer(encryptedBuffer);
    expect(decryptedPdf.toString("utf8", 0, 4)).toBe("%PDF");
    const pdfText = extractPdfText(decryptedPdf);
    expect(pdfText).toContain("Flagged Transaction Compliance Report");
    expect(pdfText).toContain("Alert ID: alert-123");
  });

  it("generates a dedicated high-value compliance template with threshold metadata", async () => {
    const result = await generateHighValueTransactionComplianceReport(
      mockTransaction,
      mockAlert,
      highValueAssessment,
    );

    expect(result.template).toBe("high_value_transaction");
    expect(result.source).toBe("aml_high_value_transaction");
    expect(result.storageKey).toContain("admin/compliance-reports");

    const uploadCall = (s3Upload.uploadToS3 as jest.Mock).mock.calls[0][0];
    expect(uploadCall.file.originalname).toMatch(
      /HIGH_VALUE_TX_tx-123_alert-123_\d+\.pdf\.enc$/,
    );
    expect(uploadCall.metadata.reportType).toBe("high_value_transaction");
    expect(uploadCall.metadata.source).toBe("aml_high_value_transaction");
    expect(uploadCall.metadata.templateVersion).toBe("1.0");

    const decryptedPdf = decryptBuffer(uploadCall.file.buffer);
    const pdfText = extractPdfText(decryptedPdf);
    expect(pdfText).toContain("High-Value Transaction Compliance Report");
    expect(pdfText).toContain("High-Value Threshold Assessment");
    expect(pdfText).toContain("USD Equivalent: 12050.75 USD");
  });

  it("throws when storage fails", async () => {
    (s3Upload.uploadToS3 as jest.Mock).mockResolvedValue({
      success: false,
      error: "S3 upload error",
    });

    await expect(
      generateFlaggedTransactionComplianceReport(mockTransaction, mockAlert),
    ).rejects.toThrow("Failed to store compliance report PDF");
  });
});

function decryptBuffer(encryptedBuffer: Buffer): Buffer {
  const iv = encryptedBuffer.slice(0, 12);
  const authTag = encryptedBuffer.slice(12, 12 + 16);
  const encryptedData = encryptedBuffer.slice(12 + 16);
  const secretKey = crypto.scryptSync(
    DB_ENCRYPTION_KEY,
    "compliance-report-salt",
    32,
  );
  const decipher = crypto.createDecipheriv("aes-256-gcm", secretKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
}

function extractPdfText(pdfBuffer: Buffer): string {
  const binary = pdfBuffer.toString("latin1");
  const texts: string[] = [];
  const streamPattern = /stream\r?\n([\s\S]*?)endstream/g;

  for (const match of binary.matchAll(streamPattern)) {
    const streamData = Buffer.from(match[1], "latin1");
    const decodedStream = (() => {
      try {
        return zlib.inflateSync(streamData).toString("latin1");
      } catch {
        return streamData.toString("latin1");
      }
    })();

    const hexFragments = Array.from(
      decodedStream.matchAll(/<([0-9A-Fa-f]+)>/g),
      (hexMatch) => Buffer.from(hexMatch[1], "hex").toString("utf8"),
    );

    texts.push(hexFragments.join(""));
  }

  return texts.join("\n");
}

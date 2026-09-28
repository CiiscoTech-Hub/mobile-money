import crypto from "crypto";
import PDFDocument from "pdfkit";
import { uploadToS3 } from "./s3Upload";
import { Transaction } from "../models/transaction";
import { AMLAlert, AMLHighValueAssessment } from "./aml";
import { AES_GCM_ALGORITHM, encryptAesGcmToBuffer } from "../crypto/aesGcm";
import { DB_ENCRYPTION_KEY } from "../config/env";

const TEMPLATE_VERSION = "1.0";

type ComplianceReportTemplate =
  "flagged_transaction" | "high_value_transaction";

export interface ComplianceReportResult {
  pdfUrl: string;
  storageKey?: string;
  template: ComplianceReportTemplate;
  source: string;
  templateVersion: string;
}

interface GenerateComplianceReportOptions {
  template?: ComplianceReportTemplate;
  highValueAssessment?: AMLHighValueAssessment;
}

export async function generateFlaggedTransactionComplianceReport(
  transaction: Transaction,
  alert: AMLAlert,
): Promise<ComplianceReportResult> {
  return generateComplianceReport(transaction, alert, {
    template: "flagged_transaction",
  });
}

export async function generateHighValueTransactionComplianceReport(
  transaction: Transaction,
  alert: AMLAlert,
  highValueAssessment: AMLHighValueAssessment,
): Promise<ComplianceReportResult> {
  return generateComplianceReport(transaction, alert, {
    template: "high_value_transaction",
    highValueAssessment,
  });
}

async function generateComplianceReport(
  transaction: Transaction,
  alert: AMLAlert,
  options: GenerateComplianceReportOptions = {},
): Promise<ComplianceReportResult> {
  if (!transaction.userId) {
    throw new Error(
      "Transaction is missing userId for compliance report generation",
    );
  }

  const template = options.template ?? "flagged_transaction";
  const pdfBuffer = await generatePDFBuffer(
    transaction,
    alert,
    template,
    options.highValueAssessment,
  );
  const encryptedBuffer = encryptBuffer(pdfBuffer);
  const stored = await storeCompliancePdf(
    encryptedBuffer,
    transaction.userId,
    transaction.id,
    alert.id,
    template,
  );

  return {
    pdfUrl: stored.pdfUrl,
    storageKey: stored.storageKey,
    template,
    source:
      template === "high_value_transaction"
        ? "aml_high_value_transaction"
        : "flagged_transaction",
    templateVersion: TEMPLATE_VERSION,
  };
}

function buildReportTitle(template: ComplianceReportTemplate): string {
  return template === "high_value_transaction"
    ? "High-Value Transaction Compliance Report"
    : "Flagged Transaction Compliance Report";
}

function buildNarrative(
  template: ComplianceReportTemplate,
  highValueAssessment?: AMLHighValueAssessment,
): string {
  if (template === "high_value_transaction" && highValueAssessment) {
    return `A transaction exceeded the USD-equivalent high-value reporting threshold of ${highValueAssessment.thresholdUsd.toFixed(2)} USD. The system generated this report to capture the transaction details, AML alert metadata, threshold assessment, and compliance context for downstream review and audit.`;
  }

  return "A transaction was flagged for AML review. The system generated this report to capture the flagged transaction details, alert metadata, and any related compliance context for downstream review and audit.";
}

function formatTransactionAmount(transaction: Transaction): string {
  const currency =
    typeof transaction.currency === "string"
      ? transaction.currency.toUpperCase()
      : "USD";
  const originalAmount = Number(
    transaction.originalAmount ?? transaction.amount,
  );

  if (Number.isFinite(originalAmount)) {
    return `${originalAmount} ${currency}`;
  }

  return `${transaction.amount} ${currency}`;
}

async function generatePDFBuffer(
  transaction: Transaction,
  alert: AMLAlert,
  template: ComplianceReportTemplate,
  highValueAssessment?: AMLHighValueAssessment,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (err) => reject(err));

    doc.fillColor("#2c3e50").fontSize(18).text("Mobile Money", {
      align: "center",
    });
    doc.moveDown(0.25);
    doc.fontSize(12).fillColor("#7f8c8d").text(buildReportTitle(template), {
      align: "center",
    });
    doc.moveDown(1);

    doc
      .fillColor("#34495e")
      .fontSize(12)
      .text("Report Details", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#000");
    doc.text(`Transaction ID: ${transaction.id}`);
    doc.text(`Reference Number: ${transaction.referenceNumber}`);
    doc.text(`User ID: ${transaction.userId}`);
    doc.text(`Provider: ${transaction.provider}`);
    doc.text(`Transaction Type: ${transaction.type}`);
    doc.text(`Amount: ${formatTransactionAmount(transaction)}`);
    doc.text(`Status: ${transaction.status}`);
    doc.text(`Created At: ${new Date(transaction.createdAt).toLocaleString()}`);
    if (transaction.phoneNumber) {
      doc.text(`Phone Number: ${transaction.phoneNumber}`);
    }
    if (transaction.stellarAddress) {
      doc.text(`Stellar Address: ${transaction.stellarAddress}`);
    }

    if (transaction.notes) {
      doc.moveDown(0.5);
      doc
        .fillColor("#2c3e50")
        .fontSize(12)
        .text("Transaction Notes", { underline: true });
      doc.moveDown(0.25);
      doc.fontSize(10).fillColor("#000").text(transaction.notes, {
        width: 500,
        align: "left",
      });
    }

    if (template === "high_value_transaction" && highValueAssessment) {
      doc.moveDown(1);
      doc
        .fillColor("#34495e")
        .fontSize(12)
        .text("High-Value Threshold Assessment", { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor("#000");
      doc.text(
        `USD Equivalent: ${highValueAssessment.usdEquivalent.toFixed(2)} USD`,
      );
      doc.text(`Threshold: ${highValueAssessment.thresholdUsd.toFixed(2)} USD`);
      doc.text(
        `Source Amount: ${highValueAssessment.sourceAmount} ${highValueAssessment.originalCurrency}`,
      );
    }

    doc.moveDown(1);
    doc
      .fillColor("#34495e")
      .fontSize(12)
      .text("AML Alert Summary", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#000");
    doc.text(`Alert ID: ${alert.id}`);
    doc.text(`Severity: ${alert.severity}`);
    doc.text(`Status: ${alert.status}`);
    doc.text(`Created At: ${new Date(alert.createdAt).toLocaleString()}`);
    doc.text(`Reasons: ${alert.reasons.join(", ")}`);
    doc.moveDown(0.25);

    if (alert.ruleHits && alert.ruleHits.length > 0) {
      doc.fillColor("#000").fontSize(10).text("Rule Hits:");
      alert.ruleHits.forEach((hit) => {
        const details = [`• ${hit.rule.replace(/_/g, " ").toUpperCase()}`];
        if (hit.message) {
          details.push(`: ${hit.message}`);
        }
        if (typeof hit.observed === "number") {
          details.push(`(observed ${hit.observed})`);
        }
        if (typeof hit.threshold === "number") {
          details.push(`threshold ${hit.threshold}`);
        }
        doc.text(details.join(" "), { indent: 10 });
      });
    }

    doc.moveDown(1);
    doc
      .fillColor("#34495e")
      .fontSize(12)
      .text("Compliance Narrative", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#000");
    doc.text(buildNarrative(template, highValueAssessment), {
      align: "justify",
      width: 500,
    });

    doc.moveDown(2);
    doc
      .fillColor("#999")
      .fontSize(9)
      .text(
        `Generated at ${new Date().toLocaleString()} | Template ${TEMPLATE_VERSION}`,
        { align: "center" },
      );

    const pageRange = doc.bufferedPageRange();
    for (let i = pageRange.start; i < pageRange.start + pageRange.count; i++) {
      doc.switchToPage(i);
      doc
        .fontSize(8)
        .fillColor("#bdc3c7")
        .text(
          `CONFIDENTIAL - COMPLIANCE INTERNAL USE ONLY - Page ${i + 1} of ${pageRange.count}`,
          50,
          doc.page.height - 50,
          { align: "center" },
        );
    }

    doc.end();
  });
}

function encryptBuffer(buffer: Buffer): Buffer {
  // Canonical binary layout [IV][AuthTag][EncryptedData] from src/crypto/aesGcm.ts.
  // Key is scrypt-derived with the domain salt "compliance-report-salt" so
  // previously stored reports remain decryptable.
  const secretKey = crypto.scryptSync(
    DB_ENCRYPTION_KEY,
    "compliance-report-salt",
    32,
  );
  return encryptAesGcmToBuffer(buffer, secretKey);
}

async function storeCompliancePdf(
  encryptedBuffer: Buffer,
  userId: string,
  transactionId: string,
  alertId: string,
  template: ComplianceReportTemplate,
): Promise<{ pdfUrl: string; storageKey?: string }> {
  const filenamePrefix =
    template === "high_value_transaction" ? "HIGH_VALUE_TX" : "COMPLIANCE_TX";
  const file = {
    buffer: encryptedBuffer,
    originalname: `${filenamePrefix}_${transactionId}_${alertId}_${Date.now()}.pdf.enc`,
    mimetype: "application/octet-stream",
    size: encryptedBuffer.length,
    fieldname: "file",
    encoding: "7bit",
  } as Express.Multer.File;

  const result = await uploadToS3({
    userId,
    file,
    folder: "compliance",
    metadata: {
      reportType:
        template === "high_value_transaction"
          ? "high_value_transaction"
          : "compliance",
      source:
        template === "high_value_transaction"
          ? "aml_high_value_transaction"
          : "flagged_transaction",
      transactionId,
      alertId,
      encrypted: "true",
      algorithm: AES_GCM_ALGORITHM,
      templateVersion: TEMPLATE_VERSION,
    },
  });

  if (!result.success || !result.fileUrl) {
    throw new Error(
      `Failed to store compliance report PDF: ${result.error ?? "Unknown error"}`,
    );
  }

  return { pdfUrl: result.fileUrl, storageKey: result.key };
}

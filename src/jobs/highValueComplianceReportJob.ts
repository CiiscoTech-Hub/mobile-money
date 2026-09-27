import logger from "../utils/logger";
import { queryRead, queryWrite } from "../config/database";
import { AMLAlertModel } from "../models/amlAlert";
import { mapTransactionRow, Transaction } from "../models/transaction";
import { amlService } from "../services/aml";
import { generateHighValueTransactionComplianceReport } from "../services/complianceReportService";

interface PendingHighValueReportRow {
  id: string;
  referenceNumber: string;
  providerReference: string | null;
  type: string;
  amount: string;
  phoneNumber: string;
  provider: string;
  stellarAddress: string;
  status: string;
  tags: string[];
  notes: string | null;
  adminNotes: string | null;
  metadata: Record<string, unknown> | null;
  locationMetadata: Record<string, unknown> | null;
  userId: string;
  currency: string | null;
  originalAmount: string | null;
  convertedAmount: string | null;
  idempotencyKey: string | null;
  idempotencyExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const amlAlertModel = new AMLAlertModel();

async function findPendingHighValueTransactions(): Promise<Transaction[]> {
  const result = await queryRead<PendingHighValueReportRow>(
    `SELECT
      id,
      reference_number AS "referenceNumber",
      provider_reference AS "providerReference",
      type,
      amount::text AS amount,
      phone_number AS "phoneNumber",
      provider,
      stellar_address AS "stellarAddress",
      status,
      COALESCE(tags, '{}') AS tags,
      notes,
      admin_notes AS "adminNotes",
      COALESCE(metadata, '{}'::jsonb) AS metadata,
      location_metadata AS "locationMetadata",
      user_id AS "userId",
      currency,
      original_amount::text AS "originalAmount",
      converted_amount::text AS "convertedAmount",
      idempotency_key AS "idempotencyKey",
      idempotency_expires_at AS "idempotencyExpiresAt",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM transactions
    WHERE user_id IS NOT NULL
      AND COALESCE(metadata->'complianceReport'->>'template', '') <> 'high_value_transaction'
    ORDER BY created_at ASC`,
  );

  return result.rows.map((row) => mapTransactionRow(row) as Transaction);
}

export async function runHighValueComplianceReportJob(): Promise<void> {
  logger.info(
    "[high-value-compliance-report] Starting high-value compliance backfill job",
  );

  const transactions = await findPendingHighValueTransactions();
  if (transactions.length === 0) {
    logger.info(
      "[high-value-compliance-report] No transactions missing compliance reports",
    );
    return;
  }

  let generatedCount = 0;

  for (const transaction of transactions) {
    try {
      const alerts = await amlAlertModel.getAlertsByTransaction(transaction.id);
      const alert = alerts[0];
      if (!alert) {
        continue;
      }

      const assessment = amlService.isHighValueAlert(
        {
          id: transaction.id,
          userId: transaction.userId,
          type: transaction.type as import("../services/aml").AMLTransactionType,
          amount: Number(transaction.amount),
          createdAt:
            transaction.createdAt instanceof Date
              ? transaction.createdAt
              : new Date(transaction.createdAt),
          status: transaction.status,
          currency: transaction.currency,
          originalAmount:
            transaction.originalAmount !== undefined &&
            transaction.originalAmount !== null
              ? Number(transaction.originalAmount)
              : Number(transaction.amount),
          convertedAmount:
            transaction.convertedAmount !== undefined &&
            transaction.convertedAmount !== null
              ? Number(transaction.convertedAmount)
              : null,
          locationMetadata: transaction.locationMetadata ?? null,
        },
        alert,
      );

      if (!assessment) {
        continue;
      }

      const report = await generateHighValueTransactionComplianceReport(
        transaction,
        alert,
        assessment,
      );

      const metadata = {
        ...(transaction.metadata ?? {}),
        complianceReport: {
          pdfUrl: report.pdfUrl,
          storageKey: report.storageKey ?? null,
          template: report.template,
          source: report.source,
          templateVersion: report.templateVersion,
          generatedAt: new Date().toISOString(),
          thresholdUsd: assessment.thresholdUsd,
          usdEquivalent: assessment.usdEquivalent,
        },
      };

      await queryWrite(
        `UPDATE transactions
         SET metadata = $1::jsonb,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [JSON.stringify(metadata), transaction.id],
      );

      generatedCount++;
    } catch (error) {
      logger.error(
        `[high-value-compliance-report] Failed to backfill transaction ${transaction.id}:`,
        error,
      );
    }
  }

  logger.info(
    "[high-value-compliance-report] Completed high-value compliance backfill job",
    {
      scanned: transactions.length,
      generatedCount,
    },
  );
}

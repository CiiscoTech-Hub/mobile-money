/**
 * SEP-08 Regulated Asset Compliance Check Service
 * Verifies approval statuses for regulated assets before ledger submission
 * per SEP-08 specification: https://stellar.org/protocol/sep-08
 */

import logger from "../../utils/logger";
import { Transaction } from "../../models/transaction";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SEP08VerificationRequest {
  transactionId: string;
  stellarAddress: string;
  amount: number;
  assetCode: string;
  operation: "deposit" | "withdraw";
  kycLevel?: string;
}

export interface SEP08VerificationResponse {
  status: "success" | "pending" | "failed";
  message?: string;
  approvalServer?: string;
  verifiedAt: Date;
}

export interface SEP08ApprovalStatus {
  approved: boolean;
  pending: boolean;
  rejected: boolean;
  rejectionReason?: string;
  requiredFields?: string[];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SEP08Service {
  private approvalServerUrl: string;
  private timeout: number;

  constructor() {
    this.approvalServerUrl =
      process.env.SEP08_APPROVAL_SERVER_URL || "";
    this.timeout = Number(process.env.SEP08_TIMEOUT_MS) || 10000;
  }

  /**
   * Check if SEP-08 compliance verification is enabled
   */
  isEnabled(): boolean {
    return !!this.approvalServerUrl;
  }

  /**
   * Verify transaction approval status via SEP-08 approval server
   * @param request - Verification request details
   * @returns Verification response with status
   */
  async verifyApproval(
    request: SEP08VerificationRequest,
  ): Promise<SEP08VerificationResponse> {
    if (!this.isEnabled()) {
      logger.warn("[sep08] Approval server URL not configured, skipping verification");
      return {
        status: "success",
        message: "SEP-08 verification not configured, allowing transaction",
        verifiedAt: new Date(),
      };
    }

    try {
      logger.info("[sep08] Initiating approval verification", {
        transactionId: request.transactionId,
        stellarAddress: request.stellarAddress,
        amount: request.amount,
        assetCode: request.assetCode,
      });

      const approvalStatus = await this.fetchApprovalStatus(request);

      if (approvalStatus.rejected) {
        logger.warn("[sep08] Transaction approval rejected", {
          transactionId: request.transactionId,
          reason: approvalStatus.rejectionReason,
        });

        return {
          status: "failed",
          message: approvalStatus.rejectionReason || "Transaction approval rejected",
          approvalServer: this.approvalServerUrl,
          verifiedAt: new Date(),
        };
      }

      if (approvalStatus.pending) {
        logger.info("[sep08] Transaction approval pending", {
          transactionId: request.transactionId,
          requiredFields: approvalStatus.requiredFields,
        });

        return {
          status: "pending",
          message: "Transaction approval pending additional information",
          approvalServer: this.approvalServerUrl,
          verifiedAt: new Date(),
        };
      }

      if (!approvalStatus.approved) {
        logger.warn("[sep08] Transaction not approved", {
          transactionId: request.transactionId,
        });

        return {
          status: "failed",
          message: "Transaction approval status not confirmed",
          approvalServer: this.approvalServerUrl,
          verifiedAt: new Date(),
        };
      }

      logger.info("[sep08] Transaction approval verified", {
        transactionId: request.transactionId,
      });

      return {
        status: "success",
        message: "Transaction approval verified",
        approvalServer: this.approvalServerUrl,
        verifiedAt: new Date(),
      };
    } catch (error) {
      logger.error("[sep08] Approval verification failed", {
        transactionId: request.transactionId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Fail closed - if verification fails, reject the transaction
      return {
        status: "failed",
        message: "Approval verification service unavailable",
        approvalServer: this.approvalServerUrl,
        verifiedAt: new Date(),
      };
    }
  }

  /**
   * Fetch approval status from SEP-08 approval server
   * @param request - Verification request details
   * @returns Approval status from server
   */
  private async fetchApprovalStatus(
    request: SEP08VerificationRequest,
  ): Promise<SEP08ApprovalStatus> {
    const url = `${this.approvalServerUrl}/approval`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          transaction_id: request.transactionId,
          stellar_address: request.stellarAddress,
          amount: request.amount,
          asset_code: request.assetCode,
          operation: request.operation,
          kyc_level: request.kycLevel,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Approval server returned ${response.status}`);
      }

      const data = await response.json();

      return {
        approved: data.approved === true,
        pending: data.pending === true,
        rejected: data.rejected === true,
        rejectionReason: data.rejection_reason,
        requiredFields: data.required_fields,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Approval server request timeout");
      }

      throw error;
    }
  }

  /**
   * Verify deposit transaction before ledger submission
   * @param transaction - Transaction to verify
   * @param assetCode - Asset code for the transaction
   * @returns Verification result
   */
  async verifyDepositApproval(
    transaction: Transaction,
    assetCode: string,
  ): Promise<SEP08VerificationResponse> {
    const request: SEP08VerificationRequest = {
      transactionId: transaction.id,
      stellarAddress: transaction.stellarAddress,
      amount: Number(transaction.amount),
      assetCode,
      operation: "deposit",
      kycLevel: transaction.metadata?.kycLevel as string | undefined,
    };

    return this.verifyApproval(request);
  }

  /**
   * Verify withdrawal transaction before ledger submission
   * @param transaction - Transaction to verify
   * @param assetCode - Asset code for the transaction
   * @returns Verification result
   */
  async verifyWithdrawalApproval(
    transaction: Transaction,
    assetCode: string,
  ): Promise<SEP08VerificationResponse> {
    const request: SEP08VerificationRequest = {
      transactionId: transaction.id,
      stellarAddress: transaction.stellarAddress,
      amount: Number(transaction.amount),
      assetCode,
      operation: "withdraw",
      kycLevel: transaction.metadata?.kycLevel as string | undefined,
    };

    return this.verifyApproval(request);
  }
}

export const sep08Service = new SEP08Service();

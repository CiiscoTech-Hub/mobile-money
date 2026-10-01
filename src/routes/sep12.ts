/**
 * SEP-12 customer deletion route (GDPR / NDPR right to erasure).
 *
 * DELETE /sep12/customer/:account anonymizes the customer's personal data
 * while keeping their financial audit trail — see
 * {@link CustomerDataMaskingService}. Mounted by the SEP-12 router in
 * `src/stellar/sep12.ts`.
 */

import { NextFunction, Request, RequestHandler, Response } from "express";
import { StrKey } from "@stellar/stellar-sdk";
import { ERROR_CODES } from "../constants/errorCodes";
import { createError } from "../middleware/errorHandler";
import { CustomerDataMaskingService } from "../services/customerDataMaskingService";
import logger from "../utils/logger";

type Anonymizer = Pick<CustomerDataMaskingService, "anonymizeByStellarAccount">;

export function createDeleteCustomerHandler(
  maskingService: Anonymizer,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { account } = req.params;

    if (!account || !StrKey.isValidEd25519PublicKey(account)) {
      return next(
        createError(ERROR_CODES.INVALID_INPUT, "Invalid Stellar account", {
          error: "account must be a valid Stellar public key",
        }),
      );
    }

    try {
      const result = await maskingService.anonymizeByStellarAccount(account);

      if (!result) {
        return next(
          createError(ERROR_CODES.NOT_FOUND, "Customer not found", {
            error: "Customer not found",
          }),
        );
      }

      res.status(200).json({
        status: "anonymized",
        account,
        anonymized_at: result.anonymizedAt,
        already_anonymized: result.alreadyAnonymized,
        retained_transactions: result.retainedTransactions,
      });
    } catch (error) {
      logger.error({ err: error }, "[SEP-12] Error anonymizing customer");
      next(
        createError(
          ERROR_CODES.INTERNAL_ERROR,
          "Failed to delete customer information",
          { error: "Failed to delete customer information" },
        ),
      );
    }
  };
}

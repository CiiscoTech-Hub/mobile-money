import { Request, Response } from "express";
import { TransactionModel } from "../models/transaction";
import { idempotency } from "../middleware/idempotency";
import logger from "../utils/logger";

const transactionModel = new TransactionModel();

/**
 * Controller to handle telecom payment transactions
 * Uses idempotency middleware to guarantee transactions never execute twice.
 */
export const processPayment = [
  idempotency,
  async (req: Request, res: Response) => {
    try {
      const { amount, phoneNumber, provider, externalTransactionId } = req.body;

      if (!amount || !phoneNumber || !provider || !externalTransactionId) {
        return res.status(400).json({ error: "Missing required payment fields" });
      }

      // Simulate a telecom transaction logic
      const transactionData = {
        type: "payment",
        amount,
        phoneNumber,
        provider,
        status: "completed",
        idempotencyKey: String(req.headers["idempotency-key"] ?? ""),
        providerReference: externalTransactionId,
      };

      // Create transaction in DB
      const result = await transactionModel.create(transactionData);

      logger.info(`Telecom transaction executed successfully: ${result.id}`);

      return res.status(200).json({
        message: "Payment processed successfully",
        transaction: result,
      });
    } catch (error: any) {
      logger.error("Failed to process payment:", error);
      return res.status(500).json({ error: "Failed to process payment" });
    }
  }
];

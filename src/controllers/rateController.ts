/**
 * Rate Controller – Issue #1631
 * Stellar XLM price fluctuation rate buffer locks are managed here.
 */

import { Request, Response } from "express";
import { z } from "zod";
import {
  currencyService,
  SupportedCurrency,
} from "../services/currency";
import logger from "../utils/logger";

const QuoteRequestSchema = z.object({
  amount: z.number().positive("amount must be positive"),
  from: z.string().min(3).max(3).toUpperCase(),
  to: z.string().min(3).max(3).toUpperCase(),
  provider: z.string().min(1, "provider is required"),
  direction: z.enum(["sell", "buy"]).optional().default("sell"),
});

export class RateController {
  getDynamicRateQuote = async (req: Request, res: Response): Promise<void> => {
    const parsed = QuoteRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: "Validation error",
        details: parsed.error.issues,
      });
      return;
    }

    const { amount, from, to, provider, direction } = parsed.data;

    try {
      const result = await currencyService.convertWithDynamicSpread(
        amount,
        from as SupportedCurrency,
        to as SupportedCurrency,
        provider,
        direction,
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      logger.error("Rate quote failed:", error.message);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  };
}

export const rateController = new RateController();

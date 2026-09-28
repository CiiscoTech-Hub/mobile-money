/**
 * Safaricom M-Pesa STK push callback route (#1969).
 *
 * Safaricom POSTs the result of a Lipa Na M-Pesa Online (STK push) request
 * here. When a callback arrives the STK query polling fallback armed by
 * {@link MpesaStkQueryWorker.onStkPushInitiated} is cancelled so the poller
 * never races the callback.
 *
 * The transaction-status update itself is owned by the deposit pipeline that
 * initiated the push; this route only acknowledges and un-arms the poller.
 */
import { Router, Request, Response } from "express";
import { ingestRateLimiter } from "../middleware/ingestRateLimit";
import logger from "../utils/logger";
import { MPESA_CALLBACK_ACK, MpesaStkCallbackBody } from "../services/providers/mpesaService";
import { MpesaProvider } from "../services/providers/mpesaService";
import { mpesaStkQueryWorker } from "../workers/mpesaStkQueryWorker";

const router = Router();
const mpesaProvider = new MpesaProvider();

router.use(ingestRateLimiter);

router.post("/stk/callback", (req: Request, res: Response) => {
  try {
    const result = MpesaProvider.processStkCallback(
      req.body as MpesaStkCallbackBody,
    );

    logger.info(
      {
        event: "mpesa.stk.callback.received",
        checkoutRequestId: result.checkoutRequestId,
        resultCode: result.resultCode,
        success: result.success,
      },
      "M-Pesa STK push callback received",
    );

    // The callback won the race — cancel the 30s query fallback.
    if (result.checkoutRequestId) {
      mpesaStkQueryWorker.onStkCallback(result.checkoutRequestId);
    }

    // Safaricom requires this exact acknowledgement body.
    return res.status(200).json(MPESA_CALLBACK_ACK);
  } catch (error: any) {
    logger.error(
      { event: "mpesa.stk.callback.error", error: error.message },
      "M-Pesa STK callback processing failed",
    );
    return res.status(200).json(MPESA_CALLBACK_ACK);
  }
});

export default router;

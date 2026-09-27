import logger from "../utils/logger";
/**
 * Admin Withdrawal Requests — multi-signature gated
 *
 * Every admin-initiated withdrawal from a custodial account (escrow,
 * issuance, or vault) must go through M-of-N signature collection before
 * it can execute — there is no path that lets a single admin move funds
 * unilaterally. Backed by MultisigCustodyLedgerService, which already
 * implemented the config/signer/request/signature/audit primitives but
 * had no caller besides the inbound webhook callback route
 * (src/routes/multisigCallbacks.ts).
 *
 * Routes:
 *   POST   /api/admin/withdrawals                — Request a withdrawal (admin)
 *   GET    /api/admin/withdrawals/pending/mine    — Pending requests awaiting my signature (admin)
 *   GET    /api/admin/withdrawals/:id             — Get withdrawal request status (admin)
 *   POST   /api/admin/withdrawals/:id/sign        — Add my signature (admin, must be a registered signer)
 *   POST   /api/admin/withdrawals/:id/execute     — Execute once fully approved (admin)
 *   POST   /api/admin/withdrawals/:id/cancel      — Cancel after the time-lock expires (admin)
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { multisigCustodyLedgerService } from "../services/multisigCustodyLedgerService";
import { authenticateToken } from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { ERROR_CODES } from "../constants/errorCodes";
import { createError } from "../middleware/errorHandler";

const router = Router();

router.use(authenticateToken, requirePermission("admin:system"));

// ─────────────────────────────────────────────────────────────────────────────
// Validation schemas
// ─────────────────────────────────────────────────────────────────────────────

const createWithdrawalSchema = z.object({
  accountType: z.enum(["escrow", "issuance", "vault"]),
  accountId: z.string().min(1),
  amountXaf: z.number().positive(),
  destination: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const signWithdrawalSchema = z.object({
  signature: z.string().min(1),
});

const cancelWithdrawalSchema = z.object({
  reason: z.string().min(1).max(500),
});

/**
 * Canonical message a signer signs to approve a withdrawal request. Kept
 * deterministic and derived entirely from server-held request fields so a
 * signer's offline tool can reconstruct it without trusting client input.
 */
function signingPayloadFor(request: {
  id?: string;
  amount_xaf: number;
  destination: string;
}): string {
  return `${request.id}:${request.amount_xaf}:${request.destination}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/withdrawals
 * Request a withdrawal. Always creates a pending multi-sig approval
 * request — rejected outright if no active multi-sig configuration exists
 * for the account, rather than allowing an unprotected withdrawal.
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const data = createWithdrawalSchema.parse(req.body);

    const withdrawalRequest =
      await multisigCustodyLedgerService.requestWithdrawal(
        data.accountType,
        data.accountId,
        data.amountXaf,
        data.destination,
        req.jwtUser!.userId,
        data.metadata,
      );

    res.status(201).json({
      success: true,
      data: {
        ...withdrawalRequest,
        signingPayload: signingPayloadFor(withdrawalRequest),
      },
    });
  } catch (error: any) {
    if (error.name === "ZodError") {
      throw createError(ERROR_CODES.INVALID_INPUT, "Validation error", {
        details: error.errors,
      });
    }
    logger.error("[AdminWithdrawals] create error:", error);
    throw createError(ERROR_CODES.INVALID_INPUT, error.message);
  }
});

/**
 * GET /api/admin/withdrawals/pending/mine
 * Withdrawal requests awaiting the caller's signature.
 */
router.get("/pending/mine", async (req: Request, res: Response) => {
  try {
    const pending =
      await multisigCustodyLedgerService.getPendingRequestsForSigner(
        req.jwtUser!.userId,
      );
    res.json({ success: true, data: pending });
  } catch (error: any) {
    logger.error("[AdminWithdrawals] pending list error:", error);
    throw createError(
      ERROR_CODES.INTERNAL_ERROR,
      "Failed to fetch pending withdrawal requests",
    );
  }
});

/**
 * GET /api/admin/withdrawals/:id
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const withdrawalRequest = await multisigCustodyLedgerService.getRequestById(
      req.params.id,
    );
    if (!withdrawalRequest) {
      throw createError(ERROR_CODES.NOT_FOUND, "Withdrawal request not found");
    }
    res.json({ success: true, data: withdrawalRequest });
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error("[AdminWithdrawals] get error:", error);
    throw createError(
      ERROR_CODES.INTERNAL_ERROR,
      "Failed to fetch withdrawal request",
    );
  }
});

/**
 * POST /api/admin/withdrawals/:id/sign
 * Add the caller's signature. The caller must be an active signer
 * registered on the request's multi-sig configuration, and the signature
 * must verify against *that signer's registered public key* — never a
 * client-supplied one (see src/routes/multisigCallbacks.ts for the same
 * principle applied to the webhook-driven signing path).
 */
router.post("/:id/sign", async (req: Request, res: Response) => {
  try {
    const { signature } = signWithdrawalSchema.parse(req.body);
    const signerId = req.jwtUser!.userId;

    const withdrawalRequest = await multisigCustodyLedgerService.getRequestById(
      req.params.id,
    );
    if (!withdrawalRequest) {
      throw createError(ERROR_CODES.NOT_FOUND, "Withdrawal request not found");
    }

    const signers = await multisigCustodyLedgerService.getSigners(
      withdrawalRequest.config_id,
    );
    const signer = signers.find((s) => s.signer_id === signerId && s.is_active);
    if (!signer) {
      throw createError(
        ERROR_CODES.FORBIDDEN,
        "You are not a registered signer for this withdrawal's account",
      );
    }

    const isValid = multisigCustodyLedgerService.verifyWebhookSignature(
      signingPayloadFor(withdrawalRequest),
      signature,
      signer.public_key,
    );
    if (!isValid) {
      throw createError(ERROR_CODES.INVALID_INPUT, "Invalid signature");
    }

    const result = await multisigCustodyLedgerService.addSignature(
      req.params.id,
      signerId,
      signature,
      "api",
      req.ip,
      req.get("User-Agent"),
    );

    if (!result.success) {
      throw createError(ERROR_CODES.INVALID_INPUT, result.message);
    }

    res.json({
      success: true,
      fullyApproved: result.fullyApproved,
      message: result.message,
    });
  } catch (error: any) {
    if (error.name === "ZodError") {
      throw createError(ERROR_CODES.INVALID_INPUT, "Validation error", {
        details: error.errors,
      });
    }
    if (error.statusCode) throw error;
    logger.error("[AdminWithdrawals] sign error:", error);
    throw createError(ERROR_CODES.INTERNAL_ERROR, "Failed to add signature");
  }
});

/**
 * POST /api/admin/withdrawals/:id/execute
 * Execute a fully-approved withdrawal request.
 */
router.post("/:id/execute", async (req: Request, res: Response) => {
  try {
    const result = await multisigCustodyLedgerService.executeApprovedRequest(
      req.params.id,
      req.jwtUser!.userId,
    );
    if (!result.success) {
      throw createError(ERROR_CODES.INVALID_INPUT, result.message);
    }
    res.json({ success: true, message: result.message });
  } catch (error: any) {
    if (error.statusCode) throw error;
    logger.error("[AdminWithdrawals] execute error:", error);
    throw createError(
      ERROR_CODES.INTERNAL_ERROR,
      "Failed to execute withdrawal request",
    );
  }
});

/**
 * POST /api/admin/withdrawals/:id/cancel
 * Cancel a pending withdrawal request once its time-lock has expired.
 */
router.post("/:id/cancel", async (req: Request, res: Response) => {
  try {
    const { reason } = cancelWithdrawalSchema.parse(req.body);
    const result = await multisigCustodyLedgerService.cancelRequest(
      req.params.id,
      req.jwtUser!.userId,
      reason,
    );
    if (!result.success) {
      throw createError(ERROR_CODES.INVALID_INPUT, result.message);
    }
    res.json({ success: true, message: result.message });
  } catch (error: any) {
    if (error.name === "ZodError") {
      throw createError(ERROR_CODES.INVALID_INPUT, "Validation error", {
        details: error.errors,
      });
    }
    if (error.statusCode) throw error;
    logger.error("[AdminWithdrawals] cancel error:", error);
    throw createError(
      ERROR_CODES.INTERNAL_ERROR,
      "Failed to cancel withdrawal request",
    );
  }
});

export default router;

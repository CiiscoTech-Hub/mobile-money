import { Router, Request, Response } from "express";
import { sep38RateLimiter } from "../middleware/rateLimiter";
import { authenticateToken } from "../middleware/auth";
import { rateProvider } from "../services/sep38/rateProvider";
import {
  createQuote,
  cancelQuote,
  getQuote,
} from "../services/sep38/quoteService";

/**
 * SEP-38 — Quotes and Price Streams
 *
 * Endpoints:
 *   GET    /prices        — indicative price for a sell/buy asset pair
 *   POST   /quote         — create a firm (locked) quote; persists state and reserves liquidity
 *   DELETE /quote/:id     — cancel a firm quote before expiry; releases reserved liquidity
 *
 * GET /prices and POST /quote are protected by the sep38RateLimiter (60 req/min
 * per authenticated client / IP) to prevent high-frequency scraping.
 * DELETE /quote/:id requires a valid JWT and verifies quote ownership.
 *
 * Spec reference: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0038.md
 */

const router = Router();

// ---------------------------------------------------------------------------
// GET /prices
// ---------------------------------------------------------------------------

/**
 * Returns an indicative (non-binding) exchange rate for the requested pair.
 *
 * Query parameters:
 *   sell_asset  {string} — SEP-38 asset identifier, e.g. "iso4217:XAF"
 *   buy_asset   {string} — SEP-38 asset identifier, e.g. "stellar:USDC:<issuer>"
 *
 * Response 200:
 *   { price, fee_percent, fee_fixed, sell_asset, buy_asset, type: "indicative" }
 */
router.get(
  "/prices",
  sep38RateLimiter,
  async (req: Request, res: Response) => {
    const { sell_asset, buy_asset } = req.query as {
      sell_asset?: string;
      buy_asset?: string;
    };

    if (!sell_asset || !buy_asset) {
      return res.status(400).json({
        error: "Bad Request",
        message: "sell_asset and buy_asset query parameters are required",
      });
    }

    const result = await rateProvider.getIndicativePrice(sell_asset, buy_asset);

    if (!result) {
      return res.status(422).json({
        error: "Unprocessable Entity",
        message: `No rate available for the pair ${sell_asset} / ${buy_asset}`,
      });
    }

    return res.status(200).json({
      sell_asset,
      buy_asset,
      price: result.price,
      fee_percent: result.fee_percent,
      fee_fixed: result.fee_fixed,
      type: "indicative",
    });
  },
);

// ---------------------------------------------------------------------------
// POST /quote
// ---------------------------------------------------------------------------

/**
 * Creates a firm (binding) quote, persists it in Postgres, and reserves the
 * corresponding sell-side liquidity in the pool.
 *
 * Body (JSON):
 *   sell_asset       {string}  — SEP-38 asset identifier
 *   buy_asset        {string}  — SEP-38 asset identifier
 *   sell_amount?     {string}  — optional sell-side units to reserve
 *
 * Response 200:
 *   { id, price, fee_percent, fee_fixed, sell_asset, buy_asset,
 *     reserved_amount, expires_at, type: "firm" }
 */
router.post(
  "/quote",
  sep38RateLimiter,
  authenticateToken,
  async (req: Request, res: Response) => {
    const { sell_asset, buy_asset, sell_amount } = req.body as {
      sell_asset?: string;
      buy_asset?: string;
      sell_amount?: string;
    };

    if (!sell_asset || !buy_asset) {
      return res.status(400).json({
        error: "Bad Request",
        message: "sell_asset and buy_asset are required in the request body",
      });
    }

    const ownerId = req.jwtUser!.userId;

    const rate = await rateProvider.getFirmPrice(sell_asset, buy_asset);

    if (!rate) {
      return res.status(422).json({
        error: "Unprocessable Entity",
        message: `No rate available for the pair ${sell_asset} / ${buy_asset}`,
      });
    }

    const quote = await createQuote({
      ownerId,
      sellAsset: sell_asset,
      buyAsset: buy_asset,
      price: rate.price,
      feePercent: rate.fee_percent,
      feeFixed: rate.fee_fixed,
      reservedAmount: sell_amount ?? "0",
    });

    return res.status(200).json({
      id: quote.id,
      sell_asset: quote.sellAsset,
      buy_asset: quote.buyAsset,
      price: quote.price,
      fee_percent: quote.feePercent,
      fee_fixed: quote.feeFixed,
      reserved_amount: quote.reservedAmount,
      expires_at: quote.expiresAt.toISOString(),
      type: "firm",
    });
  },
);

// ---------------------------------------------------------------------------
// DELETE /quote/:id
// ---------------------------------------------------------------------------

/**
 * Cancels a firm quote before its expiry, releasing the reserved liquidity.
 *
 * Authentication: Bearer JWT required.
 * Authorization: only the original quote owner may cancel.
 *
 * Path parameter:
 *   id  {UUID} — quote ID returned by POST /quote
 *
 * Response 200:
 *   { id, status: "cancelled", released_amount, message }
 *
 * Error responses:
 *   401 — missing / invalid JWT
 *   403 — caller is not the quote owner
 *   404 — quote not found
 *   409 — quote is already cancelled or expired
 */
router.delete(
  "/quote/:id",
  authenticateToken,
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const requestingUserId = req.jwtUser!.userId;

    // Basic UUID format guard — avoids pointless DB round-trips
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(id)) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Invalid quote ID format",
      });
    }

    try {
      const cancelled = await cancelQuote(id, requestingUserId);

      return res.status(200).json({
        id: cancelled.id,
        status: "cancelled",
        released_amount: cancelled.reservedAmount,
        sell_asset: cancelled.sellAsset,
        buy_asset: cancelled.buyAsset,
        message: "Quote cancelled successfully. Reserved liquidity has been released.",
      });
    } catch (err: any) {
      const code: number = err.statusCode ?? 500;

      if (code === 404) {
        return res.status(404).json({ error: "Not Found", message: err.message });
      }
      if (code === 403) {
        return res.status(403).json({ error: "Forbidden", message: err.message });
      }
      if (code === 409) {
        return res.status(409).json({ error: "Conflict", message: err.message });
      }

      // Unexpected error — log and return 500
      console.error("[SEP38] DELETE /quote/:id unexpected error", err);
      return res.status(500).json({
        error: "Internal Server Error",
        message: "An unexpected error occurred",
      });
    }
  },
);

export default router;

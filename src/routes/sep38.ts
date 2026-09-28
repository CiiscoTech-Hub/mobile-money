import { Router, Request, Response } from "express";
import { sep38RateLimiter } from "../middleware/rateLimiter";
import { rateProvider } from "../services/sep38/rateProvider";

/**
 * SEP-38 — Quotes and Price Streams
 *
 * Endpoints:
 *   GET  /prices   — indicative price for a sell/buy asset pair
 *   POST /quote    — firm (locked) price for a sell/buy asset pair
 *
 * Both endpoints are protected by the sep38RateLimiter (60 req/min per
 * authenticated client / IP) to prevent high-frequency scraping.
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
 *   {
 *     price:       string   // buy_asset units per 1 sell_asset unit
 *     fee_percent: string   // percentage fee (e.g. "0.50")
 *     fee_fixed:   string   // fixed fee in sell_asset units
 *     sell_asset:  string
 *     buy_asset:   string
 *     type:        "indicative"
 *   }
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
 * Returns a firm (binding) exchange rate that is locked for the quote window.
 *
 * Body (JSON):
 *   sell_asset  {string} — SEP-38 asset identifier
 *   buy_asset   {string} — SEP-38 asset identifier
 *
 * Response 200:
 *   {
 *     price:       string   // buy_asset units per 1 sell_asset unit
 *     fee_percent: string
 *     fee_fixed:   string
 *     sell_asset:  string
 *     buy_asset:   string
 *     type:        "firm"
 *   }
 */
router.post(
  "/quote",
  sep38RateLimiter,
  async (req: Request, res: Response) => {
    const { sell_asset, buy_asset } = req.body as {
      sell_asset?: string;
      buy_asset?: string;
    };

    if (!sell_asset || !buy_asset) {
      return res.status(400).json({
        error: "Bad Request",
        message: "sell_asset and buy_asset are required in the request body",
      });
    }

    const result = await rateProvider.getFirmPrice(sell_asset, buy_asset);

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
      type: "firm",
    });
  },
);

export default router;

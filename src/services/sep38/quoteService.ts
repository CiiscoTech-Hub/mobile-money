/**
 * SEP-38 Quote Service
 *
 * Manages the lifecycle of firm quotes:
 *   - createQuote  — persist a new active quote and reserve liquidity
 *   - cancelQuote  — verify ownership, transition to 'cancelled', release liquidity
 *   - expireQuotes — sweep expired active quotes (called by the scheduler)
 *
 * Liquidity reservation is tracked in the `reserved_amount` column so the
 * pool can reject new quotes when insufficient depth is available.
 * The actual liquidity pool is modelled as a lightweight Redis counter
 * (key: `sep38:pool:reserved`) backed by the DB for durability.
 */

import { v4 as uuidv4 } from "uuid";
import { queryRead, queryWrite } from "../../config/database";
import { redisClient } from "../../config/redis";
import { layeredCache } from "../layeredCache";
import logger from "../../utils/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QuoteStatus = "active" | "cancelled" | "expired";

export interface Sep38Quote {
  id: string;
  ownerId: string;
  sellAsset: string;
  buyAsset: string;
  price: string;
  feePercent: string;
  feeFixed: string;
  reservedAmount: string;
  status: QuoteStatus;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateQuoteParams {
  ownerId: string;
  sellAsset: string;
  buyAsset: string;
  price: string;
  feePercent: string;
  feeFixed: string;
  /** Sell-side units to reserve in the liquidity pool. Defaults to 0. */
  reservedAmount?: string;
  /** Quote TTL in seconds. Defaults to SEP38_QUOTE_TTL_SECONDS env var or 300. */
  ttlSeconds?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default quote lifetime — 5 minutes, overrideable via env */
const DEFAULT_QUOTE_TTL_SECONDS = parseInt(
  process.env.SEP38_QUOTE_TTL_SECONDS || "300",
);

/** Redis key for the global reserved-liquidity counter (sell-side, decimal string) */
const POOL_RESERVED_KEY = "sep38:pool:reserved";

/** Cache key prefix for individual quotes */
const QUOTE_CACHE_PREFIX = "sep38:quote:";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cacheKey(id: string): string {
  return `${QUOTE_CACHE_PREFIX}${id}`;
}

function rowToQuote(row: Record<string, any>): Sep38Quote {
  return {
    id: row.id,
    ownerId: row.owner_id,
    sellAsset: row.sell_asset,
    buyAsset: row.buy_asset,
    price: String(row.price),
    feePercent: String(row.fee_percent),
    feeFixed: String(row.fee_fixed),
    reservedAmount: String(row.reserved_amount),
    status: row.status as QuoteStatus,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Liquidity pool helpers
// ---------------------------------------------------------------------------

/**
 * Atomically increment the global reserved-liquidity counter by `amount`.
 * Uses Redis INCRBYFLOAT; falls back to a no-op if Redis is unavailable.
 */
async function reserveLiquidity(amount: string): Promise<void> {
  if (!redisClient.isOpen) return;
  try {
    await redisClient.incrbyfloat(POOL_RESERVED_KEY, parseFloat(amount));
  } catch (err) {
    logger.warn({ err }, "[SEP38] Redis unavailable — liquidity reservation skipped");
  }
}

/**
 * Atomically decrement the global reserved-liquidity counter by `amount`.
 * Clamps the result at 0 to guard against counter drift.
 */
async function releaseLiquidity(amount: string): Promise<void> {
  if (!redisClient.isOpen) return;
  try {
    const next = parseFloat(String(await redisClient.incrbyfloat(
      POOL_RESERVED_KEY,
      -parseFloat(amount),
    )));
    // Clamp at zero — counter drift can produce tiny negatives
    if (next < 0) {
      await redisClient.set(POOL_RESERVED_KEY, "0");
    }
  } catch (err) {
    logger.warn({ err }, "[SEP38] Redis unavailable — liquidity release skipped");
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Persist a new firm quote and reserve the corresponding liquidity.
 */
export async function createQuote(params: CreateQuoteParams): Promise<Sep38Quote> {
  const {
    ownerId,
    sellAsset,
    buyAsset,
    price,
    feePercent,
    feeFixed,
    reservedAmount = "0",
    ttlSeconds = DEFAULT_QUOTE_TTL_SECONDS,
  } = params;

  const id = uuidv4();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const result = await queryWrite<Record<string, any>>(
    `INSERT INTO sep38_quotes
       (id, owner_id, sell_asset, buy_asset, price, fee_percent, fee_fixed,
        reserved_amount, status, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9)
     RETURNING *`,
    [
      id,
      ownerId,
      sellAsset,
      buyAsset,
      price,
      feePercent,
      feeFixed,
      reservedAmount,
      expiresAt,
    ],
  );

  const quote = rowToQuote(result.rows[0]);

  // Reserve liquidity in the pool counter
  await reserveLiquidity(reservedAmount);

  // Cache the quote for fast reads
  await layeredCache.set(cacheKey(id), quote, ttlSeconds);

  logger.info(
    { quoteId: id, ownerId, sellAsset, buyAsset, reservedAmount },
    "[SEP38] Firm quote created",
  );

  return quote;
}

/**
 * Look up a quote by ID, trying the cache first.
 */
export async function getQuote(id: string): Promise<Sep38Quote | null> {
  // 1. Cache hit
  const cached = await layeredCache.get<Sep38Quote>(cacheKey(id));
  if (cached) return cached;

  // 2. DB read
  const result = await queryRead<Record<string, any>>(
    `SELECT * FROM sep38_quotes WHERE id = $1`,
    [id],
  );
  if (result.rows.length === 0) return null;

  const quote = rowToQuote(result.rows[0]);

  // Repopulate cache (short TTL — just for repeated reads within the window)
  const remainingMs = quote.expiresAt.getTime() - Date.now();
  if (remainingMs > 0 && quote.status === "active") {
    await layeredCache.set(cacheKey(id), quote, Math.ceil(remainingMs / 1000));
  }

  return quote;
}

/**
 * Cancel an active firm quote, releasing its reserved liquidity.
 *
 * Throws with a descriptive message on:
 *   - quote not found (404)
 *   - caller is not the owner (403)
 *   - quote is not active (409)
 */
export async function cancelQuote(
  id: string,
  requestingUserId: string,
): Promise<Sep38Quote> {
  // 1. Fetch the current state (cache-aware)
  const quote = await getQuote(id);

  if (!quote) {
    const err = new Error("Quote not found") as Error & { statusCode: number };
    err.statusCode = 404;
    throw err;
  }

  // 2. Ownership check
  if (quote.ownerId !== requestingUserId) {
    const err = new Error("Forbidden — you are not the owner of this quote") as Error & { statusCode: number };
    err.statusCode = 403;
    throw err;
  }

  // 3. Status guard — only active quotes can be cancelled
  if (quote.status !== "active") {
    const err = new Error(
      `Quote cannot be cancelled: current status is '${quote.status}'`,
    ) as Error & { statusCode: number };
    err.statusCode = 409;
    throw err;
  }

  // 4. Transition to 'cancelled' in Postgres
  const result = await queryWrite<Record<string, any>>(
    `UPDATE sep38_quotes
     SET status = 'cancelled'
     WHERE id = $1 AND status = 'active'
     RETURNING *`,
    [id],
  );

  // Guard against a race where another request cancelled it concurrently
  if (result.rows.length === 0) {
    const err = new Error(
      "Quote cannot be cancelled: it was already cancelled or expired",
    ) as Error & { statusCode: number };
    err.statusCode = 409;
    throw err;
  }

  const cancelled = rowToQuote(result.rows[0]);

  // 5. Release liquidity
  await releaseLiquidity(cancelled.reservedAmount);

  // 6. Invalidate the cache so subsequent reads reflect the new status
  await layeredCache.del(cacheKey(id));

  logger.info(
    { quoteId: id, ownerId: requestingUserId, releasedAmount: cancelled.reservedAmount },
    "[SEP38] Firm quote cancelled — liquidity released",
  );

  return cancelled;
}

/**
 * Sweep quotes whose expiry has passed.
 * Called by the scheduler; not exposed via HTTP.
 *
 * Returns the number of quotes expired.
 */
export async function expireStaleQuotes(): Promise<number> {
  const result = await queryWrite<Record<string, any>>(
    `UPDATE sep38_quotes
     SET status = 'expired'
     WHERE status = 'active' AND expires_at < CURRENT_TIMESTAMP
     RETURNING id, reserved_amount`,
    [],
  );

  const rows = result.rows;
  if (rows.length === 0) return 0;

  // Release liquidity for all swept quotes
  for (const row of rows) {
    await releaseLiquidity(String(row.reserved_amount));
    await layeredCache.del(cacheKey(row.id));
  }

  logger.info({ count: rows.length }, "[SEP38] Expired stale quotes — liquidity released");
  return rows.length;
}

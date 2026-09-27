import { pool } from "../config/database";

export interface PaymentLink {
  id: string;
  merchantId: string;
  amount: string;
  currency: string;
  description?: string;
  token: string;
  isOneTime: boolean;
  isUsed: boolean;
  stellarAddress: string;
  redirectSuccessUrl?: string;
  redirectFailUrl?: string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentLinkRow {
  id: string;
  merchantId: string;
  amount: string;
  currency: string;
  description?: string | null;
  token: string;
  isOneTime: boolean;
  isUsed: boolean;
  stellarAddress: string;
  redirectSuccessUrl?: string | null;
  redirectFailUrl?: string | null;
  expiresAt?: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export class PaymentLinkModel {
  async create(
    link: Omit<PaymentLink, "id" | "isUsed" | "createdAt" | "updatedAt">,
  ): Promise<PaymentLink> {
    const result = await pool.query<PaymentLinkRow>(
      `INSERT INTO payment_links (
        merchant_id, amount, currency, description, token, is_one_time, stellar_address, redirect_success_url, redirect_fail_url, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING 
        id, merchant_id as "merchantId", amount, currency, description, token, 
        is_one_time as "isOneTime", is_used as "isUsed", stellar_address as "stellarAddress", 
        redirect_success_url as "redirectSuccessUrl", redirect_fail_url as "redirectFailUrl", 
        expires_at as "expiresAt", created_at as "createdAt", updated_at as "updatedAt"`,
      [
        link.merchantId,
        link.amount,
        link.currency,
        link.description ?? null,
        link.token,
        link.isOneTime,
        link.stellarAddress,
        link.redirectSuccessUrl ?? null,
        link.redirectFailUrl ?? null,
        link.expiresAt ?? null,
      ],
    );
    return result.rows.length > 0 ? mapPaymentLinkRow(result.rows[0]) : null;
  }

  async findByToken(token: string): Promise<PaymentLink | null> {
    const result = await pool.query<PaymentLinkRow>(
      `SELECT 
        id, merchant_id as "merchantId", amount, currency, description, token, 
        is_one_time as "isOneTime", is_used as "isUsed", stellar_address as "stellarAddress", 
        redirect_success_url as "redirectSuccessUrl", redirect_fail_url as "redirectFailUrl", 
        expires_at as "expiresAt", created_at as "createdAt", updated_at as "updatedAt"
      FROM payment_links
      WHERE token = $1`,
      [token],
    );
    return result.rows.length > 0 ? mapPaymentLinkRow(result.rows[0]) : null;
  }

  async markAsUsed(id: string): Promise<void> {
    await pool.query(
      `UPDATE payment_links 
       SET is_used = true 
       WHERE id = $1`,
      [id],
    );
  }
}

function mapPaymentLinkRow(row: PaymentLinkRow): PaymentLink {
  return {
    id: row.id,
    merchantId: row.merchantId,
    amount: row.amount,
    currency: row.currency,
    description: row.description ?? undefined,
    token: row.token,
    isOneTime: row.isOneTime,
    isUsed: row.isUsed,
    stellarAddress: row.stellarAddress,
    redirectSuccessUrl: row.redirectSuccessUrl ?? undefined,
    redirectFailUrl: row.redirectFailUrl ?? undefined,
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : undefined,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

import { pool, queryRead, queryWrite } from "../config/database";
import { v4 as uuidv4 } from "uuid";

export interface Referral {
  id: string;
  user_id: string;
  referral_code: string;
  referred_by?: string;
  reward_granted: boolean;
  created_at: Date;
}

export interface ReferralRow {
  id: string;
  user_id: string;
  referral_code: string;
  referred_by?: string | null;
  reward_granted: boolean;
  created_at: Date | string;
}

export class ReferralModel {
  async createReferral(
    user_id: string,
    referred_by?: string,
  ): Promise<Referral> {
    const referral_code = uuidv4().replace(/-/g, "").slice(0, 10);
    const result = await queryWrite<ReferralRow>(
      `INSERT INTO referrals (user_id, referral_code, referred_by) VALUES ($1, $2, $3) RETURNING *`,
      [user_id, referral_code, referred_by || null],
    );
    return mapReferralRow(result.rows[0]);
  }

  async findByCode(referral_code: string): Promise<Referral | null> {
    const result = await queryRead<ReferralRow>(
      `SELECT * FROM referrals WHERE referral_code = $1`,
      [referral_code],
    );
    return result.rows.length > 0 ? mapReferralRow(result.rows[0]) : null;
  }

  async markRewardGranted(id: string) {
    await queryWrite(
      `UPDATE referrals SET reward_granted = TRUE WHERE id = $1`,
      [id],
    );
  }

  async hasUsedReferral(user_id: string): Promise<boolean> {
    const result = await queryRead<ReferralRow>(
      `SELECT * FROM referrals WHERE user_id = $1 AND referred_by IS NOT NULL`,
      [user_id],
    );
    return result.rows.length > 0;
  }
}

function mapReferralRow(row: ReferralRow): Referral {
  return {
    id: row.id,
    user_id: row.user_id,
    referral_code: row.referral_code,
    referred_by: row.referred_by ?? undefined,
    reward_granted: row.reward_granted,
    created_at: new Date(row.created_at),
  };
}

import logger from "../utils/logger";
import { pool, queryRead, queryWrite } from "../config/database";

export interface RefreshTokenFamily {
  id: string;
  user_id: string;
  family_id: string;
  token: string;
  parent_token?: string;
  is_revoked: boolean;
  created_at: Date;
  revoked_at?: Date;
}

export interface RefreshTokenFamilyRow {
  id: string;
  user_id: string;
  family_id: string;
  token: string;
  parent_token?: string | null;
  is_revoked: boolean;
  created_at: Date | string;
  revoked_at?: Date | string | null;
}

export class RefreshTokenFamilyModel {
  async create({
    user_id,
    family_id,
    token,
    parent_token,
  }: {
    user_id: string;
    family_id: string;
    token: string;
    parent_token?: string;
  }): Promise<RefreshTokenFamily> {
    const result = await queryWrite<RefreshTokenFamilyRow>(
      `INSERT INTO refresh_token_families (user_id, family_id, token, parent_token) VALUES ($1, $2, $3, $4) RETURNING *`,
      [user_id, family_id, token, parent_token || null],
    );
    return mapRefreshTokenFamilyRow(result.rows[0]);
  }

  async findAllActive(
    userId: string,
    familyId: string,
  ): Promise<RefreshTokenFamily[]> {
    const result = await pool.query<RefreshTokenFamilyRow>(
      `SELECT * FROM refresh_token_families
       WHERE user_id = $1 AND family_id = $2 AND is_revoked = FALSE
       ORDER BY created_at DESC`,
      [userId, familyId],
    );

    return result.rows.map(mapRefreshTokenFamilyRow);
  }

  async findByToken(token: string): Promise<RefreshTokenFamily | null> {
    const result = await queryRead<RefreshTokenFamilyRow>(
      `SELECT * FROM refresh_token_families WHERE token = $1`,
      [token],
    );
    return result.rows.length > 0
      ? mapRefreshTokenFamilyRow(result.rows[0])
      : null;
  }

  async revokeFamily(familyId: string, userId: string, tokenId: string) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `SELECT family_id FROM refresh_token_families
               WHERE id = $1 AND user_id = $2 AND family_id=$3`,
        [tokenId, userId, familyId],
      );

      if (result.rows.length === 0) {
        throw new Error("Token not found");
      }

      const { family_id } = result.rows[0];

      // Delete
      const deleteResult = await client.query(
        `DELETE FROM refresh_token_families
         WHERE id=$1 AND family_id=$2 AND user_id=$3`,
        [tokenId, familyId, userId],
      );

      await client.query("COMMIT");

      return {
        data: {
          familyId: family_id,
          deleteResult: deleteResult.rowCount,
        },
      };
    } catch (err: any) {
      await client.query("ROLLBACK");
      logger.error(err);

      throw err;
    } finally {
      client.release();
    }
  }

  async purgeExpired() {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Get all expired tokens
      const expiredTokenResult = await client.query(
        `SELECT family_id FROM refresh_token_families
        WHERE revoked_at < NOW() - INTERVAL '30 days'`,
      );

      // Delete all expired tokens
      const deleteResult = await client.query(
        `DELETE FROM refresh_token_families
            WHERE revoked_at < NOW() - INTERVAL '30 days'`,
      );

      await client.query("COMMIT");

      return {
        data: {
          expiredTokenResult,
          purgedCount: deleteResult.rowCount,
        },
      };
    } catch (err: any) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async revokeAll(userId: string, familyId: string) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Update DB
      const tokenResult = await pool.query(
        `DELETE FROM refresh_token_families 
        WHERE user_id = $1 AND family_id = $2`,
        [userId, familyId],
      );

      await client.query("COMMIT");

      return {
        data: {
          success: true,
          tokenResult,
        },
      };
    } catch (err: any) {
      await client.query("ROLLBACK");
      logger.error("Error revoking all tokens:", err);

      throw err.message;
    } finally {
      client.release();
    }
  }

  async isRevoked(token: string): Promise<boolean> {
    const result = await queryRead<{ is_revoked: boolean }>(
      `SELECT is_revoked FROM refresh_token_families WHERE token = $1`,
      [token],
    );
    return result.rows[0]?.is_revoked || false;
  }
}

function mapRefreshTokenFamilyRow(
  row: RefreshTokenFamilyRow,
): RefreshTokenFamily {
  return {
    id: row.id,
    user_id: row.user_id,
    family_id: row.family_id,
    token: row.token,
    parent_token: row.parent_token ?? undefined,
    is_revoked: row.is_revoked,
    created_at: new Date(row.created_at),
    revoked_at: row.revoked_at ? new Date(row.revoked_at) : undefined,
  };
}

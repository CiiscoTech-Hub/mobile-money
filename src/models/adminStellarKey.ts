import { pool, queryRead, queryWrite } from "../config/database";

export interface AdminStellarKey {
  id: string;
  publicKey: string;
  description?: string;
  isActive: boolean;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
  deactivatedAt?: Date;
}

export interface AdminStellarKeyCreateInput {
  publicKey: string;
  description?: string;
  createdBy?: string;
}

export interface AdminStellarKeyUpdateInput {
  description?: string;
  isActive?: boolean;
}

export interface AdminStellarKeyRow {
  id: string;
  public_key: string;
  description?: string | null;
  is_active: boolean;
  created_by?: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  deactivated_at?: Date | string | null;
}

export class AdminStellarKeyModel {
  /**
   * Check if a Stellar public key is authorized for admin access
   */
  async isAdminKey(publicKey: string): Promise<boolean> {
    const result = await queryRead<{ id: string }>(
      "SELECT id FROM admin_stellar_keys WHERE public_key = $1 AND is_active = true",
      [publicKey],
    );
    return result.rows.length > 0;
  }

  /**
   * Get all active admin Stellar keys
   */
  async findAllActive(): Promise<AdminStellarKey[]> {
    const result = await queryRead<AdminStellarKeyRow>(
      "SELECT * FROM admin_stellar_keys WHERE is_active = true ORDER BY created_at DESC",
    );

    return result.rows.map(mapAdminStellarKeyRow);
  }

  /**
   * Get admin Stellar key by public key
   */
  async findByPublicKey(publicKey: string): Promise<AdminStellarKey | null> {
    const result = await queryRead<AdminStellarKeyRow>(
      "SELECT * FROM admin_stellar_keys WHERE public_key = $1",
      [publicKey],
    );

    if (result.rows.length === 0) return null;

    return mapAdminStellarKeyRow(result.rows[0]);
  }

  /**
   * Create a new admin Stellar key
   */
  async create(input: AdminStellarKeyCreateInput): Promise<AdminStellarKey> {
    const result = await queryWrite<AdminStellarKeyRow>(
      `INSERT INTO admin_stellar_keys (public_key, description, created_by)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [input.publicKey, input.description, input.createdBy],
    );

    return mapAdminStellarKeyRow(result.rows[0]);
  }

  /**
   * Update an admin Stellar key
   */
  async update(
    publicKey: string,
    input: AdminStellarKeyUpdateInput,
  ): Promise<AdminStellarKey | null> {
    const updates: string[] = [];
    const values: (string | boolean | null)[] = [];
    let paramIndex = 1;

    if (input.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(input.description);
    }

    if (input.isActive !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(input.isActive);
      if (!input.isActive) {
        updates.push(`deactivated_at = CURRENT_TIMESTAMP`);
      } else {
        updates.push(`deactivated_at = NULL`);
      }
    }

    if (updates.length === 0) return null;

    values.push(publicKey);

    const result = await queryWrite<AdminStellarKeyRow>(
      `UPDATE admin_stellar_keys
       SET ${updates.join(", ")}
       WHERE public_key = $${paramIndex}
       RETURNING *`,
      values,
    );

    if (result.rows.length === 0) return null;

    return mapAdminStellarKeyRow(result.rows[0]);
  }

  /**
   * Deactivate an admin Stellar key
   */
  async deactivate(publicKey: string): Promise<boolean> {
    const result = await queryWrite(
      `UPDATE admin_stellar_keys
       SET is_active = false, deactivated_at = CURRENT_TIMESTAMP
       WHERE public_key = $1 AND is_active = true`,
      [publicKey],
    );
    return result.rowCount > 0;
  }

  /**
   * Delete an admin Stellar key
   */
  async delete(publicKey: string): Promise<boolean> {
    const result = await queryWrite(
      "DELETE FROM admin_stellar_keys WHERE public_key = $1",
      [publicKey],
    );
    return result.rowCount > 0;
  }
}

function mapAdminStellarKeyRow(row: AdminStellarKeyRow): AdminStellarKey {
  return {
    id: row.id,
    publicKey: row.public_key,
    description: row.description ?? undefined,
    isActive: row.is_active,
    createdBy: row.created_by ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deactivatedAt: row.deactivated_at
      ? new Date(row.deactivated_at)
      : undefined,
  };
}

export const adminStellarKeyModel = new AdminStellarKeyModel();

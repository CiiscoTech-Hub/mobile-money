import { queryRead, queryWrite } from "../config/database";

export interface DailySnapshot {
  snapshotDate: string; // ISO Date YYYY-MM-DD
  totalMainBalance: string;
  totalVaultBalance: string;
  totalBalance: string;
  dailyVolume: string;
  transactionCount: number;
  createdAt?: Date;
}

export interface DailySnapshotInput {
  snapshotDate: string;
  totalMainBalance: string;
  totalVaultBalance: string;
  totalBalance: string;
  dailyVolume: string;
  transactionCount: number;
}

export interface DailySnapshotRow {
  snapshotDate: string;
  totalMainBalance: string;
  totalVaultBalance: string;
  totalBalance: string;
  dailyVolume: string;
  transactionCount: number;
  createdAt?: Date;
}

export class SnapshotModel {
  async create(data: DailySnapshotInput): Promise<DailySnapshot> {
    const result = await queryWrite<DailySnapshotRow>(
      `INSERT INTO daily_snapshots (
         snapshot_date, total_main_balance, total_vault_balance, 
         total_balance, daily_volume, transaction_count
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (snapshot_date) DO UPDATE SET
         total_main_balance = EXCLUDED.total_main_balance,
         total_vault_balance = EXCLUDED.total_vault_balance,
         total_balance = EXCLUDED.total_balance,
         daily_volume = EXCLUDED.daily_volume,
         transaction_count = EXCLUDED.transaction_count,
         created_at = CURRENT_TIMESTAMP
       RETURNING 
         snapshot_date AS "snapshotDate",
         total_main_balance::text AS "totalMainBalance",
         total_vault_balance::text AS "totalVaultBalance",
         total_balance::text AS "totalBalance",
         daily_volume::text AS "dailyVolume",
         transaction_count AS "transactionCount",
         created_at AS "createdAt"`,
      [
        data.snapshotDate,
        data.totalMainBalance,
        data.totalVaultBalance,
        data.totalBalance,
        data.dailyVolume,
        data.transactionCount,
      ],
    );

    return result.rows[0];
  }

  async getByDate(date: string): Promise<DailySnapshot | null> {
    const result = await queryRead<DailySnapshotRow>(
      `SELECT 
         snapshot_date AS "snapshotDate",
         total_main_balance::text AS "totalMainBalance",
         total_vault_balance::text AS "totalVaultBalance",
         total_balance::text AS "totalBalance",
         daily_volume::text AS "dailyVolume",
         transaction_count AS "transactionCount",
         created_at AS "createdAt"
       FROM daily_snapshots
       WHERE snapshot_date = $1`,
      [date],
    );

    return result.rows[0] || null;
  }

  async getLatest(limit = 7): Promise<DailySnapshot[]> {
    const result = await queryRead<DailySnapshotRow>(
      `SELECT 
         snapshot_date AS "snapshotDate",
         total_main_balance::text AS "totalMainBalance",
         total_vault_balance::text AS "totalVaultBalance",
         total_balance::text AS "totalBalance",
         daily_volume::text AS "dailyVolume",
         transaction_count AS "transactionCount",
         created_at AS "createdAt"
       FROM daily_snapshots
       ORDER BY snapshot_date DESC
       LIMIT $1`,
      [limit],
    );

    return result.rows;
  }
}

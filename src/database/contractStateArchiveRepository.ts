import { pool } from "../config/database";
import { QueryResult } from "pg";

export interface ContractStateArchiveRecord {
  id?: number;
  contractId: string;
  txHash: string;
  ledger: number;
  eventType: string;
  eventName?: string | null;
  eventDetails?: Record<string, any> | null;
  snapshotData?: Record<string, any> | null;
  createdAt?: Date;
}

export interface ContractStateArchiveRow {
  id: number;
  contract_id: string;
  tx_hash: string;
  ledger: number;
  event_type: string;
  event_name: string | null;
  event_details: Record<string, any> | null;
  snapshot_data: Record<string, any> | null;
  created_at: Date;
}

export async function insertContractStateArchive(
  archive: ContractStateArchiveRecord,
): Promise<QueryResult<any>> {
  const query = `
    INSERT INTO contract_state_archives (
      contract_id,
      tx_hash,
      ledger,
      event_type,
      event_name,
      event_details,
      snapshot_data,
      created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT DO NOTHING;
  `;

  const values = [
    archive.contractId,
    archive.txHash,
    archive.ledger,
    archive.eventType,
    archive.eventName ?? null,
    JSON.stringify(archive.eventDetails ?? {}),
    JSON.stringify(archive.snapshotData ?? {}),
    archive.createdAt ?? new Date(),
  ];

  return pool.query(query, values);
}

export async function getContractStateArchiveHistory(
  contractId: string,
  limit: number = 20,
): Promise<ContractStateArchiveRecord[]> {
  const result = await pool.query<ContractStateArchiveRow>(
    `
      SELECT id, contract_id, tx_hash, ledger, event_type, event_name, event_details, snapshot_data, created_at
      FROM contract_state_archives
      WHERE contract_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2;
    `,
    [contractId, limit],
  );

  return (result.rows || []).map((row) => ({
    id: row.id,
    contractId: row.contract_id,
    txHash: row.tx_hash,
    ledger: row.ledger,
    eventType: row.event_type,
    eventName: row.event_name,
    eventDetails: row.event_details ?? undefined,
    snapshotData: row.snapshot_data ?? undefined,
    createdAt: row.created_at,
  }));
}

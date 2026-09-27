import { pool } from "../config/database";
import { layeredCache } from "./layeredCache";
import logger from "../utils/logger";

export interface SystemConfigEntry {
  key: string;
  value: string;
  category: string;
  description: string | null;
  value_type: "string" | "number" | "boolean" | "json";
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface UpdateSystemConfigInput {
  key: string;
  value: string;
  category?: string;
  description?: string;
  value_type?: "string" | "number" | "boolean" | "json";
  updated_by?: string;
}

const CACHE_TTL = 60;

export class SystemConfigService {
  private cacheKey(category?: string): string {
    return category ? `system_config:${category}` : "system_config:all";
  }

  async getAll(category?: string): Promise<SystemConfigEntry[]> {
    const cacheKey = this.cacheKey(category);
    const cached = await layeredCache.get<SystemConfigEntry[]>(cacheKey);
    if (cached !== null) return cached;

    let query: string;
    let params: unknown[];
    if (category) {
      query = "SELECT * FROM system_config WHERE category = $1 ORDER BY category, key";
      params = [category];
    } else {
      query = "SELECT * FROM system_config ORDER BY category, key";
      params = [];
    }
    const result = await pool.query(query, params);
    await layeredCache.set(cacheKey, result.rows, CACHE_TTL);
    return result.rows;
  }

  async get(key: string): Promise<SystemConfigEntry | null> {
    const result = await pool.query(
      "SELECT * FROM system_config WHERE key = $1",
      [key],
    );
    return result.rows[0] ?? null;
  }

  async upsert(input: UpdateSystemConfigInput): Promise<SystemConfigEntry> {
    const query = `
      INSERT INTO system_config (key, value, category, description, value_type, updated_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (key)
      DO UPDATE SET
        value = EXCLUDED.value,
        category = COALESCE(EXCLUDED.category, system_config.category),
        description = COALESCE(EXCLUDED.description, system_config.description),
        value_type = COALESCE(EXCLUDED.value_type, system_config.value_type),
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      RETURNING *;
    `;
    const result = await pool.query(query, [
      input.key,
      input.value,
      input.category ?? "general",
      input.description ?? null,
      input.value_type ?? "string",
      input.updated_by ?? null,
    ]);

    await this.invalidateCache(input.category);
    logger.info({ key: input.key, category: input.category }, "[SystemConfigService] Config upserted");
    return result.rows[0];
  }

  async delete(key: string): Promise<boolean> {
    const result = await pool.query(
      "DELETE FROM system_config WHERE key = $1 RETURNING key",
      [key],
    );
    if (result.rowCount && result.rowCount > 0) {
      await this.invalidateAll();
      logger.info({ key }, "[SystemConfigService] Config deleted");
      return true;
    }
    return false;
  }

  async bulkUpsert(inputs: UpdateSystemConfigInput[]): Promise<SystemConfigEntry[]> {
    const results: SystemConfigEntry[] = [];
    for (const input of inputs) {
      results.push(await this.upsert(input));
    }
    return results;
  }

  getValueAs<T>(entry: SystemConfigEntry | null, fallback: T): T {
    if (!entry) return fallback;
    switch (entry.value_type) {
      case "number":
        return Number(entry.value) as T;
      case "boolean":
        return (entry.value === "true" || entry.value === "1") as T;
      case "json":
        try {
          return JSON.parse(entry.value) as T;
        } catch {
          return fallback;
        }
      default:
        return entry.value as T;
    }
  }

  private async invalidateCache(category?: string): Promise<void> {
    await Promise.all([
      layeredCache.del(this.cacheKey(category)),
      layeredCache.del(this.cacheKey()),
    ]);
  }

  private async invalidateAll(): Promise<void> {
    await layeredCache.delPattern("system_config:*");
  }
}

export const systemConfigService = new SystemConfigService();

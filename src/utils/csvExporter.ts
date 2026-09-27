import { Transform } from "stream";

export const DEFAULT_ALLOWED_HEADERS = [
  "id",
  "user_id",
  "amount",
  "currency",
  "type",
  "status",
  "created_at",
  "description",
];

export const EXTENDED_ALLOWED_HEADERS = [
  "id",
  "reference_number",
  "type",
  "amount",
  "currency",
  "phone_number",
  "provider",
  "status",
  "stellar_address",
  "tags",
  "notes",
  "admin_notes",
  "user_id",
  "description",
  "created_at",
  "updated_at",
];

export const DISPLAY_HEADER_MAP: Record<string, string> = {
  id: "ID",
  reference_number: "Reference Number",
  type: "Type",
  amount: "Amount",
  currency: "Currency",
  phone_number: "Phone Number",
  provider: "Provider",
  status: "Status",
  stellar_address: "Stellar Address",
  tags: "Tags",
  notes: "Notes",
  admin_notes: "Admin Notes",
  user_id: "User ID",
  description: "Description",
  created_at: "Created At",
  updated_at: "Updated At",
};

export const REVERSE_HEADER_MAP: Record<string, string> = {
  id: "id",
  "reference number": "reference_number",
  referencenumber: "reference_number",
  reference_number: "reference_number",
  type: "type",
  amount: "amount",
  currency: "currency",
  "phone number": "phone_number",
  phonenumber: "phone_number",
  phone_number: "phone_number",
  provider: "provider",
  status: "status",
  "stellar address": "stellar_address",
  stellaraddress: "stellar_address",
  stellar_address: "stellar_address",
  tags: "tags",
  notes: "notes",
  "admin notes": "admin_notes",
  adminnotes: "admin_notes",
  admin_notes: "admin_notes",
  "user id": "user_id",
  userid: "user_id",
  user_id: "user_id",
  description: "description",
  "created at": "created_at",
  createdat: "created_at",
  created_at: "created_at",
  "updated at": "updated_at",
  updatedat: "updated_at",
  updated_at: "updated_at",
};

export interface TransactionExportFilters {
  startDate?: string | Date;
  endDate?: string | Date;
  from?: string | Date;
  to?: string | Date;
  status?: string;
  type?: string;
  userId?: string;
  user_id?: string;
  provider?: string;
  phoneNumber?: string;
  phone_number?: string;
  stellarAddress?: string;
  stellar_address?: string;
  referenceNumber?: string;
  reference_number?: string;
  tags?: string[] | string;
  fields?: string[];
}

export interface RawExportQuery {
  startDate?: string | Date;
  endDate?: string | Date;
  from?: string | Date;
  to?: string | Date;
  status?: string;
  type?: string;
  userId?: string;
  user_id?: string;
  provider?: string;
  phoneNumber?: string;
  phone_number?: string;
  stellarAddress?: string;
  stellar_address?: string;
  referenceNumber?: string;
  reference_number?: string;
  tags?: string[] | string;
  fields?: string[] | string;
  [key: string]: unknown;
}

export function parseTransactionExportFilters(
  query: RawExportQuery,
): TransactionExportFilters {
  const fields = query.fields
    ? Array.isArray(query.fields)
      ? query.fields.map(String)
      : String(query.fields)
          .split(",")
          .map((f) => f.trim())
    : undefined;

  let tags: string[] | undefined;
  if (Array.isArray(query.tags)) {
    tags = query.tags.map(String);
  } else if (typeof query.tags === "string" && query.tags.trim().length > 0) {
    tags = query.tags.split(",").map((t) => t.trim());
  }

  const raw = (query || {}) as Record<string, unknown>;
  const getParam = (key: string): string | undefined => {
    const val = raw[key];
    return val !== undefined && val !== null ? String(val) : undefined;
  };

  return {
    startDate: query.startDate,
    endDate: query.endDate,
    from: query.from,
    to: query.to,
    status: getParam("status"),
    type: getParam("type"),
    userId: getParam("userId") || getParam("user_id"),
    provider: getParam("provider"),
    phoneNumber: getParam("phoneNumber") || getParam("phone_number"),
    stellarAddress: getParam("stellarAddress") || getParam("stellar_address"),
    referenceNumber:
      getParam("referenceNumber") || getParam("reference_number"),
    tags,
    fields,
  };
}

export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    const formatted = value.map((item) => String(item)).join("|");
    if (
      formatted.includes(",") ||
      formatted.includes('"') ||
      formatted.includes("\n") ||
      formatted.includes("\r")
    ) {
      return `"${formatted.replace(/"/g, '""')}"`;
    }
    return formatted;
  }

  const stringValue = String(value);
  if (
    stringValue.includes(",") ||
    stringValue.includes('"') ||
    stringValue.includes("\n") ||
    stringValue.includes("\r")
  ) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

export function normalizeHeaderKey(header: string): string {
  const clean = header.trim().toLowerCase();
  return REVERSE_HEADER_MAP[clean] || clean;
}

export function getRowValue(
  row: Record<string, unknown>,
  header: string,
): unknown {
  if (header in row && row[header] !== undefined) {
    return row[header];
  }

  const normalized = normalizeHeaderKey(header);
  if (normalized in row && row[normalized] !== undefined) {
    return row[normalized];
  }

  // CamelCase fallback
  const camelKey = normalized.replace(/_([a-z])/g, (_, g) => g.toUpperCase());
  if (camelKey in row && row[camelKey] !== undefined) {
    return row[camelKey];
  }

  return undefined;
}

export function transactionRowToCsv(
  row: Record<string, unknown>,
  headers: string[],
): string {
  const values = headers.map((header) => {
    const value = getRowValue(row, header);
    return escapeCsvField(value);
  });
  return values.join(",") + "\n";
}

export function buildTransactionExportQuery(
  filters: TransactionExportFilters,
  exportHeaders?: string[],
): { text: string; values: unknown[] } {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramCount = 1;

  if (filters.status) {
    conditions.push(`status = $${paramCount++}`);
    values.push(filters.status);
  }

  if (filters.provider) {
    conditions.push(`provider = $${paramCount++}`);
    values.push(filters.provider);
  }

  if (filters.type) {
    conditions.push(`type = $${paramCount++}`);
    values.push(filters.type);
  }

  const phoneNumber = filters.phoneNumber || filters.phone_number;
  if (phoneNumber) {
    conditions.push(`phone_number = $${paramCount++}`);
    values.push(phoneNumber);
  }

  const stellarAddress = filters.stellarAddress || filters.stellar_address;
  if (stellarAddress) {
    conditions.push(`stellar_address = $${paramCount++}`);
    values.push(stellarAddress);
  }

  const referenceNumber = filters.referenceNumber || filters.reference_number;
  if (referenceNumber) {
    conditions.push(`reference_number = $${paramCount++}`);
    values.push(referenceNumber);
  }

  const userId = filters.userId || filters.user_id;
  if (userId) {
    conditions.push(`user_id = $${paramCount++}`);
    values.push(userId);
  }

  const startDate = filters.startDate || filters.from;
  if (startDate) {
    conditions.push(`created_at >= $${paramCount++}`);
    values.push(startDate);
  }

  const endDate = filters.endDate || filters.to;
  if (endDate) {
    conditions.push(`created_at <= $${paramCount++}`);
    values.push(endDate);
  }

  if (filters.tags) {
    conditions.push(`tags @> $${paramCount++}::text[]`);
    values.push(
      Array.isArray(filters.tags)
        ? filters.tags
        : String(filters.tags)
            .split(",")
            .map((t) => t.trim()),
    );
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  let selectClause = "*";
  if (exportHeaders && exportHeaders.length > 0) {
    selectClause = exportHeaders
      .map((h) => {
        const normalized = normalizeHeaderKey(h);
        return normalized;
      })
      .join(", ");
  }

  const text = `SELECT ${selectClause} FROM transactions ${whereClause} ORDER BY created_at DESC`;
  return { text, values };
}

export function createTransactionCsvStream(headers: string[]): Transform {
  return new Transform({
    objectMode: true,
    transform(chunk: Record<string, unknown>, _encoding, callback) {
      try {
        const csvLine = transactionRowToCsv(chunk, headers);
        callback(null, csvLine);
      } catch (err) {
        callback(err instanceof Error ? err : new Error(String(err)));
      }
    },
  });
}

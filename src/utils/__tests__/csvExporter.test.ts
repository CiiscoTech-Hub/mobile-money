import { PassThrough } from "stream";
import {
  escapeCsvField,
  normalizeHeaderKey,
  getRowValue,
  transactionRowToCsv,
  parseTransactionExportFilters,
  buildTransactionExportQuery,
  createTransactionCsvStream,
  DEFAULT_ALLOWED_HEADERS,
  EXTENDED_ALLOWED_HEADERS,
  DISPLAY_HEADER_MAP,
} from "../csvExporter";

describe("csvExporter utility", () => {
  describe("escapeCsvField", () => {
    it("returns empty string for null and undefined", () => {
      expect(escapeCsvField(null)).toBe("");
      expect(escapeCsvField(undefined)).toBe("");
    });

    it("returns plain string for simple values", () => {
      expect(escapeCsvField("hello")).toBe("hello");
      expect(escapeCsvField(12345)).toBe("12345");
      expect(escapeCsvField(true)).toBe("true");
    });

    it("formats Date objects as ISO strings", () => {
      const date = new Date("2026-03-22T10:30:00.000Z");
      expect(escapeCsvField(date)).toBe("2026-03-22T10:30:00.000Z");
    });

    it("formats and joins arrays with pipe separator", () => {
      expect(escapeCsvField(["priority", "vip"])).toBe("priority|vip");
      expect(escapeCsvField(["tag1", 'tag"2', "tag,3"])).toBe(
        '"tag1|tag""2|tag,3"',
      );
    });

    it("escapes fields containing commas", () => {
      expect(escapeCsvField("Hello, world")).toBe('"Hello, world"');
    });

    it("escapes fields containing double quotes", () => {
      expect(escapeCsvField('Hello "world"')).toBe('"Hello ""world"""');
    });

    it("escapes fields containing newlines (LF and CRLF)", () => {
      expect(escapeCsvField("Line 1\nLine 2")).toBe('"Line 1\nLine 2"');
      expect(escapeCsvField("Line 1\r\nLine 2")).toBe('"Line 1\r\nLine 2"');
    });

    it("handles complex combinations of quotes, commas, and newlines", () => {
      const input = 'Needs, review "today"\nnext';
      expect(escapeCsvField(input)).toBe('"Needs, review ""today""\nnext"');
    });
  });

  describe("normalizeHeaderKey and getRowValue", () => {
    it("normalizes headers to standard snake_case keys", () => {
      expect(normalizeHeaderKey("ID")).toBe("id");
      expect(normalizeHeaderKey("Reference Number")).toBe("reference_number");
      expect(normalizeHeaderKey("phone_number")).toBe("phone_number");
      expect(normalizeHeaderKey("Phone Number")).toBe("phone_number");
      expect(normalizeHeaderKey("User ID")).toBe("user_id");
      expect(normalizeHeaderKey("Created At")).toBe("created_at");
    });

    it("retrieves row value by direct key, snake_case, camelCase, or display name", () => {
      const row = {
        id: "tx-1",
        reference_number: "REF-001",
        phoneNumber: "+237600000001",
        userId: "user-123",
        created_at: new Date("2026-01-01T00:00:00Z"),
      };

      expect(getRowValue(row, "id")).toBe("tx-1");
      expect(getRowValue(row, "ID")).toBe("tx-1");
      expect(getRowValue(row, "Reference Number")).toBe("REF-001");
      expect(getRowValue(row, "reference_number")).toBe("REF-001");
      expect(getRowValue(row, "Phone Number")).toBe("+237600000001");
      expect(getRowValue(row, "User ID")).toBe("user-123");
      expect(getRowValue(row, "Created At")).toEqual(
        new Date("2026-01-01T00:00:00Z"),
      );
      expect(getRowValue(row, "non_existent")).toBeUndefined();
    });
  });

  describe("transactionRowToCsv", () => {
    it("converts a transaction row to a comma-separated CSV line with trailing newline", () => {
      const row = {
        id: "1",
        user_id: "user-1",
        amount: 100,
        currency: "USD",
        type: "deposit",
        status: "completed",
        created_at: "2024-01-02T03:04:05.000Z",
        description: "Standard deposit",
      };

      const csv = transactionRowToCsv(row, DEFAULT_ALLOWED_HEADERS);
      expect(csv).toBe(
        "1,user-1,100,USD,deposit,completed,2024-01-02T03:04:05.000Z,Standard deposit\n",
      );
    });

    it("properly handles missing fields as empty values", () => {
      const row = {
        id: "2",
        amount: 50,
      };

      const csv = transactionRowToCsv(row, [
        "id",
        "user_id",
        "amount",
        "status",
      ]);
      expect(csv).toBe("2,,50,\n");
    });

    it("escapes fields with special characters in row conversion", () => {
      const row = {
        id: "3",
        notes: 'Needs, review "today"',
        tags: ["priority", "vip"],
      };

      const csv = transactionRowToCsv(row, ["id", "notes", "tags"]);
      expect(csv).toBe('3,"Needs, review ""today""",priority|vip\n');
    });
  });

  describe("parseTransactionExportFilters", () => {
    it("parses query parameters correctly", () => {
      const query = {
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        status: "completed",
        type: "withdrawal",
        userId: "user-1",
        provider: "MTN",
        phoneNumber: "+237600000001",
        stellarAddress: "GB123",
        referenceNumber: "REF-123",
        tags: "vip, priority",
        fields: "id, amount, status",
      };

      const filters = parseTransactionExportFilters(query);
      expect(filters).toEqual({
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        from: undefined,
        to: undefined,
        status: "completed",
        type: "withdrawal",
        userId: "user-1",
        provider: "MTN",
        phoneNumber: "+237600000001",
        stellarAddress: "GB123",
        referenceNumber: "REF-123",
        tags: ["vip", "priority"],
        fields: ["id", "amount", "status"],
      });
    });

    it("handles alternative query parameter names (from/to, user_id, phone_number)", () => {
      const query = {
        from: "2026-02-01",
        to: "2026-02-28",
        user_id: "user-2",
        phone_number: "+237600000002",
        stellar_address: "GA456",
        reference_number: "REF-456",
        tags: ["tagA", "tagB"],
      };

      const filters = parseTransactionExportFilters(query);
      expect(filters.from).toBe("2026-02-01");
      expect(filters.to).toBe("2026-02-28");
      expect(filters.userId).toBe("user-2");
      expect(filters.phoneNumber).toBe("+237600000002");
      expect(filters.stellarAddress).toBe("GA456");
      expect(filters.referenceNumber).toBe("REF-456");
      expect(filters.tags).toEqual(["tagA", "tagB"]);
    });
  });

  describe("buildTransactionExportQuery", () => {
    it("builds an unconstrained query when no filters are supplied", () => {
      const result = buildTransactionExportQuery({});
      expect(result.text).toBe(
        "SELECT * FROM transactions  ORDER BY created_at DESC",
      );
      expect(result.values).toEqual([]);
    });

    it("builds query with custom select fields", () => {
      const result = buildTransactionExportQuery({}, [
        "id",
        "amount",
        "status",
      ]);
      expect(result.text).toBe(
        "SELECT id, amount, status FROM transactions  ORDER BY created_at DESC",
      );
    });

    it("maps display header names to SQL column names in select clause", () => {
      const result = buildTransactionExportQuery({}, [
        "ID",
        "Reference Number",
        "Phone Number",
      ]);
      expect(result.text).toBe(
        "SELECT id, reference_number, phone_number FROM transactions  ORDER BY created_at DESC",
      );
    });

    it("builds query with multiple parameterized WHERE conditions", () => {
      const fromDate = new Date("2026-03-01T00:00:00Z");
      const toDate = new Date("2026-03-31T23:59:59Z");

      const result = buildTransactionExportQuery({
        status: "completed",
        provider: "MTN",
        type: "deposit",
        phoneNumber: "+237600000000",
        stellarAddress: "GB123",
        referenceNumber: "REF-123",
        from: fromDate,
        to: toDate,
        tags: ["vip", "priority"],
      });

      expect(result.text).toContain("status = $1");
      expect(result.text).toContain("provider = $2");
      expect(result.text).toContain("type = $3");
      expect(result.text).toContain("phone_number = $4");
      expect(result.text).toContain("stellar_address = $5");
      expect(result.text).toContain("reference_number = $6");
      expect(result.text).toContain("created_at >= $7");
      expect(result.text).toContain("created_at <= $8");
      expect(result.text).toContain("tags @> $9::text[]");
      expect(result.values).toHaveLength(9);
      expect(result.values[0]).toBe("completed");
      expect(result.values[1]).toBe("MTN");
      expect(result.values[2]).toBe("deposit");
      expect(result.values[3]).toBe("+237600000000");
      expect(result.values[4]).toBe("GB123");
      expect(result.values[5]).toBe("REF-123");
      expect(result.values[6]).toBe(fromDate);
      expect(result.values[7]).toBe(toDate);
      expect(result.values[8]).toEqual(["vip", "priority"]);
    });

    it("includes user_id condition when userId is provided", () => {
      const result = buildTransactionExportQuery({ userId: "usr-999" });
      expect(result.text).toContain("user_id = $1");
      expect(result.values).toEqual(["usr-999"]);
    });
  });

  describe("createTransactionCsvStream", () => {
    it("transforms an object stream into CSV text chunks", async () => {
      const transform = createTransactionCsvStream(["id", "amount", "status"]);
      const passThrough = new PassThrough({ objectMode: true });

      const outputChunks: string[] = [];
      transform.on("data", (chunk) => outputChunks.push(chunk.toString()));

      passThrough.pipe(transform);

      passThrough.write({ id: "1", amount: 100, status: "completed" });
      passThrough.write({ id: "2", amount: 250, status: "pending" });
      passThrough.end();

      await new Promise((resolve) => transform.on("end", resolve));

      expect(outputChunks).toEqual(["1,100,completed\n", "2,250,pending\n"]);
    });
  });

  describe("constants and header mappings", () => {
    it("provides valid header arrays and mapping dictionaries", () => {
      expect(DEFAULT_ALLOWED_HEADERS).toContain("id");
      expect(DEFAULT_ALLOWED_HEADERS).toContain("amount");
      expect(EXTENDED_ALLOWED_HEADERS).toContain("reference_number");
      expect(EXTENDED_ALLOWED_HEADERS).toContain("stellar_address");
      expect(DISPLAY_HEADER_MAP["reference_number"]).toBe("Reference Number");
    });
  });
});

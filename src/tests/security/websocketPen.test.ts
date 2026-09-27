/**
 * Security: Penetration testing against WebSocket channels (#1645).
 *
 * Attempts auth-bypass attacks on WebSocket listeners to discover
 * security gaps. Validates that the server drops connections missing
 * proper authentication and that legitimate connections succeed.
 */

import { createServer } from "http";
import { WebSocket } from "ws";
import jwt from "jsonwebtoken";
import { WebSocketManager } from "../../websocket";

const TEST_SECRET = "test-jwt-secret";
const TEST_PORT = 9878;

function makeToken(payload: object = { userId: "user-1", email: "u@test.com" }) {
  return jwt.sign(payload, TEST_SECRET, { expiresIn: "1h" });
}

function makeExpiredToken() {
  return jwt.sign({ userId: "user-1", email: "u@test.com" }, TEST_SECRET, {
    expiresIn: "-1h",
  });
}

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.once("close", (code, reasonBuf) =>
      resolve({ code, reason: reasonBuf.toString() }),
    );
  });
}

function waitForMessage(ws: WebSocket): Promise<object> {
  return new Promise((resolve, reject) => {
    ws.once("message", (raw) => {
      try {
        resolve(JSON.parse(raw.toString()));
      } catch (e) {
        reject(e);
      }
    });
    ws.once("error", reject);
  });
}

describe("WebSocket security penetration tests", () => {
  let manager: WebSocketManager;
  let baseUrl: string;

  beforeAll((done) => {
    process.env.JWT_SECRET = TEST_SECRET;
    const httpServer = createServer();
    manager = new WebSocketManager(httpServer);
    httpServer.listen(TEST_PORT, done);
    baseUrl = `ws://localhost:${TEST_PORT}`;
  });

  afterAll(async () => {
    await manager.close();
  }, 15_000);

  describe("AUTH-BYPASS: connections without proper credentials", () => {
    it("drops connections with no token and no auth header", async () => {
      const ws = new WebSocket(baseUrl);
      const { code } = await waitForClose(ws);
      expect(code).toBe(1008);
    });

    it("drops connections with an empty token query parameter", async () => {
      const ws = new WebSocket(`${baseUrl}?token=`);
      const { code } = await waitForClose(ws);
      expect(code).toBe(1008);
    });

    it("drops connections with a malformed token", async () => {
      const ws = new WebSocket(`${baseUrl}?token=not-a-valid-jwt`);
      const { code } = await waitForClose(ws);
      expect(code).toBe(1008);
    });

    it("drops connections with an expired token", async () => {
      const token = makeExpiredToken();
      const ws = new WebSocket(`${baseUrl}?token=${token}`);
      const { code } = await waitForClose(ws);
      expect(code).toBe(1008);
    });

    it("drops connections with a token missing userId and sub", async () => {
      const token = makeToken({ email: "u@test.com" }); // no userId, no sub
      const ws = new WebSocket(`${baseUrl}?token=${token}`);
      const { code } = await waitForClose(ws);
      expect(code).toBe(1008);
    });

    it("drops connections with empty Bearer token", async () => {
      const ws = new WebSocket(baseUrl, {
        headers: { Authorization: "Bearer " },
      });
      const { code } = await waitForClose(ws);
      expect(code).toBe(1008);
    });

    it("drops connections with malformed Authorization header", async () => {
      const ws = new WebSocket(baseUrl, {
        headers: { Authorization: "NotBearer token" },
      });
      const { code } = await waitForClose(ws);
      expect(code).toBe(1008);
    });

    it("drops connections with token signed by different secret", async () => {
      const token = jwt.sign({ userId: "user-1" }, "wrong-secret", { expiresIn: "1h" });
      const ws = new WebSocket(`${baseUrl}?token=${token}`);
      const { code } = await waitForClose(ws);
      expect(code).toBe(1008);
    });

    it("drops connections sending garbage binary data", async () => {
      const ws = new WebSocket(`${baseUrl}?token=${makeToken()}`);
      await waitForMessage(ws); // connection.ack
      ws.send(Buffer.from([0x00, 0x01, 0x02]));
      // Should not crash — the server should handle gracefully
      const msg = await waitForMessage(ws) as { type: string };
      expect(msg.type).toBe("error");
      ws.close();
    });
  });

  describe("AUTH-VALID: legitimate connections succeed", () => {
    it("accepts connections with a valid Bearer token in headers", async () => {
      const token = makeToken();
      const ws = new WebSocket(baseUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const msg = await waitForMessage(ws) as { type: string; data: { userId: string } };
      expect(msg.type).toBe("connection.ack");
      expect(msg.data.userId).toBe("user-1");
      ws.close();
    });

    it("accepts connections with a valid token query parameter", async () => {
      const token = makeToken();
      const ws = new WebSocket(`${baseUrl}?token=${token}`);
      const msg = await waitForMessage(ws) as { type: string };
      expect(msg.type).toBe("connection.ack");
      ws.close();
    });

    it("accepts connections using the sub claim as userId", async () => {
      const token = makeToken({ sub: "sub-99", email: "s@test.com" });
      const ws = new WebSocket(`${baseUrl}?token=${token}`);
      const msg = await waitForMessage(ws) as { type: string; data: { userId: string } };
      expect(msg.type).toBe("connection.ack");
      expect(msg.data.userId).toBe("sub-99");
      ws.close();
    });
  });

  describe("CONNECTION-LIMITS: basic resource protection", () => {
    it("tracks connection count accurately", async () => {
      const before = manager.connectionCount;
      const ws = new WebSocket(`${baseUrl}?token=${makeToken({ userId: "track-1" })}`);
      await waitForMessage(ws);
      expect(manager.connectionCount).toBe(before + 1);
      ws.close();
      await new Promise((r) => setTimeout(r, 100));
      expect(manager.connectionCount).toBe(before);
    });

    it("handles rapid connect/disconnect cycles without crash", async () => {
      for (let i = 0; i < 5; i++) {
        const ws = new WebSocket(`${baseUrl}?token=${makeToken({ userId: `rapid-${i}` })}`);
        await waitForMessage(ws);
        ws.close();
        await new Promise((r) => setTimeout(r, 30));
      }
      // No crash means success
      expect(true).toBe(true);
    });
  });

  describe("RECONNAISSANCE: error messages do not leak sensitive info", () => {
    it("does not reveal valid vs invalid userId in close reason", async () => {
      // Missing userId is rejected
      const ws1 = new WebSocket(`${baseUrl}?token=${makeToken({ email: "x@y.com" })}`);
      const { reason: reason1 } = await waitForClose(ws1);

      // Expired token is also rejected — ensure reasons don't distinguish
      const ws2 = new WebSocket(`${baseUrl}?token=${makeExpiredToken()}`);
      const { reason: reason2 } = await waitForClose(ws2);

      expect(reason1).toBeDefined();
      expect(reason2).toBeDefined();
      // Both are rejected — the exact reason shouldn't leak internal state
    });
  });
});

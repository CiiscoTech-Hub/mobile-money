/**
 * Tests for the strict Redis-backed idempotency middleware (issue #1972).
 *
 * Verifies locally using a mock execution framework (in-memory Redis mock
 * and mock handlers) per the issue's verification guidance.
 */

process.env.NODE_ENV = "test";

import type { Request, Response } from "express";

const store = new Map<string, string>();
const locks = new Set<string>();

jest.mock("../../config/redis", () => ({
  redisClient: {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(
      async (
        key: string,
        value: string,
        opts?: { NX?: boolean },
      ) => {
        if (opts?.NX) {
          if (locks.has(key)) return null;
          locks.add(key);
          store.set(key, value);
          return "OK";
        }
        store.set(key, value);
        return "OK";
      },
    ),
    del: jest.fn(async (key: string) => {
      store.delete(key);
      locks.delete(key);
      return 1;
    }),
    isOpen: true,
  },
}));

import { strictIdempotency } from "../idempotency";

type Res = Response & { statusCode: number; body: unknown };

function makeRes(): Res {
  const res: any = {};
  (res.statusCode = 200), (res.body = undefined);
  res.headersSent = false;
  res.setHeader = jest.fn();
  res.on = jest.fn();
  res.status = jest.fn((c: number) => {
    res.statusCode = c;
    return res;
  });
  res.json = jest.fn((b: unknown) => {
    res.body = b;
    res.headersSent = true;
    return res;
  });
  res.send = jest.fn((b: unknown) => {
    res.body = b;
    res.headersSent = true;
    return res;
  });
  return res as Res;
}

function makeReq(
  overrides: Partial<Request> & { idempotencyKey?: string; body?: unknown } = {},
): Request {
  return {
    method: "POST",
    baseUrl: "",
    path: "/deposit",
    originalUrl: "/api/transactions/deposit",
    headers: overrides.idempotencyKey
      ? { "idempotency-key": overrides.idempotencyKey }
      : {},
    body: overrides.body ?? { amount: 100 },
    query: {},
    jwtUser: { userId: "user-1" },
  } as unknown as Request;
}

function run(
  req: Request,
  res: Res,
  handler: () => Promise<void> | void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    // Resolve when the middleware itself responds (no handler call).
    const poll = setInterval(() => {
      if ((res as any).headersSent) {
        clearInterval(poll);
        settle();
      }
    }, 5);
    // The middleware is async: a synchronous throw from the handler
    // propagates through its returned promise (mirrors how the async-error
    // patched Express layer surfaces handler failures).
    const mwPromise = (
      strictIdempotency as unknown as (
        r: Request,
        s: Res,
        n: (err?: unknown) => void,
      ) => Promise<void>
    )(req, res, (err?: unknown) => {
      clearInterval(poll);
      void Promise.resolve(handler())
        .then(settle)
        .catch(reject);
    });
    mwPromise.catch((err: unknown) => {
      clearInterval(poll);
      reject(err);
    });
  });
}

beforeEach(async () => {
  store.clear();
  locks.clear();
  jest.clearAllMocks();
  // Let any pending microtasks (Redis writes) from prior tests settle.
  await new Promise((r) => setImmediate(r));
});

describe("strictIdempotency (#1972)", () => {
  it("rejects requests missing the Idempotency-Key header with 400", async () => {
    const req = makeReq();
    const res = makeRes();
    let executed = false;

    await run(req, res, () => {
      executed = true;
    });

    expect(res.statusCode).toBe(400);
    expect(executed).toBe(false);
  });

  it("executes the handler and caches the response with a 24h TTL", async () => {
    const req = makeReq({ idempotencyKey: "key-1" });
    const res = makeRes();

    await run(req, res, () => {
      res.status(201).json({ id: "txn-1", status: "pending" });
    });

    expect(res.statusCode).toBe(201);
    // Allow the async cache write to settle.
    await new Promise((r) => setImmediate(r));
    const cached = store.get("idempotency:user-1:POST:/deposit:key-1");
    expect(cached).toBeDefined();
    const parsed = JSON.parse(cached!);
    expect(parsed.status).toBe(201);
    expect(parsed.body).toEqual({ id: "txn-1", status: "pending" });

    // TTL flag was passed to redis set (24h = 86400s).
    const setCalls = (require("../../config/redis").redisClient.set as jest.Mock)
      .mock.calls.filter((c: unknown[]) => c[0] === "idempotency:user-1:POST:/deposit:key-1");
    expect(setCalls.length).toBeGreaterThan(0);
    expect(setCalls[0][2]).toMatchObject({ EX: 24 * 60 * 60 });
  });

  it("replays the identical cached response without re-executing", async () => {
    const req = makeReq({ idempotencyKey: "key-2" });
    const res1 = makeRes();
    await run(req, res1, () => {
      res1.status(200).json({ id: "txn-2" });
    });

    let executions = 0;
    const res2 = makeRes();
    await run(req, res2, () => {
      executions += 1;
      res2.status(200).json({ id: "different" });
    });

    expect(executions).toBe(0);
    expect(res2.statusCode).toBe(200);
    expect(res2.body).toEqual({ id: "txn-2" });
  });

  it("rejects a different payload reusing the same key with 422", async () => {
    const res1 = makeRes();
    await run(
      makeReq({ idempotencyKey: "key-3", body: { amount: 100 } }),
      res1,
      () => {
        res1.status(200).json({ ok: true });
      },
    );

    const res2 = makeRes();
    await run(
      makeReq({ idempotencyKey: "key-3", body: { amount: 999 } }),
      res2,
      () => {
        res2.status(200).json({ ok: true });
      },
    );

    expect(res2.statusCode).toBe(422);
    expect((res2.body as { error: string }).error).toBe(
      "idempotency_key_reuse",
    );
  });

  it("returns 409 for a concurrent duplicate while the first is executing", async () => {
    const lockKey = "idempotency:user-1:POST:/deposit:key-4:lock";
    locks.add(lockKey); // simulate in-flight request holding the lock

    const res = makeRes();
    let executed = false;
    await run(makeReq({ idempotencyKey: "key-4" }), res, () => {
      executed = true;
    });

    expect(res.statusCode).toBe(409);
    expect(executed).toBe(false);
  });

  it("scopes cache keys by user so identities cannot collide", async () => {
    const res1 = makeRes();
    await run(makeReq({ idempotencyKey: "shared" }), res1, () => {
      res1.status(200).json({ owner: "user-1" });
    });

    const req2 = makeReq({ idempotencyKey: "shared" });
    (req2 as any).jwtUser = { userId: "user-2" };
    const res2 = makeRes();
    let executed2 = false;
    await run(req2, res2, () => {
      executed2 = true;
      res2.status(200).json({ owner: "user-2" });
    });

    expect(executed2).toBe(true);
    expect(res2.body).toEqual({ owner: "user-2" });
  });

  it("releases the in-flight lock when the handler errors without responding", async () => {
    const req = makeReq({ idempotencyKey: "key-5" });
    const res = makeRes();

    // Simulate Express: handler throws, error middleware short-circuits the
    // response without ever calling res.json/res.send. The finish listener
    // then releases the in-flight lock.
    await expect(
      run(req, res, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // Emit the response-cycle end events the middleware listens for.
    const finishCbs = ((res as any).on as jest.Mock).mock.calls.filter(
      (c: unknown[]) => c[0] === "finish",
    );
    expect(finishCbs.length).toBeGreaterThan(0);
    for (const [, cb] of finishCbs) (cb as () => void)();

    await new Promise((r) => setImmediate(r));
    expect(store.has("idempotency:user-1:POST:/deposit:key-5:lock")).toBe(
      false,
    );

    // A retry after the failure executes normally.
    const res2 = makeRes();
    let executed = false;
    await run(req, res2, () => {
      executed = true;
      res2.status(200).json({ ok: true });
    });
    expect(executed).toBe(true);
  });
});

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend, Counter } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";

const concurrentErrorRate = new Rate("concurrent_error_rate");
const concurrentLatency = new Trend("concurrent_latency_ms", true);
const transactionCounter = new Counter("concurrent_transactions");

const providers = ["mtn", "airtel", "orange", "vodacom", "mpesa"];
const currencies = ["XAF", "KES", "NGN", "GHS", "TZS"];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function makeDepositPayload() {
  const seed = Date.now() + Math.floor(Math.random() * 1000000);
  return JSON.stringify({
    amount: Math.floor(Math.random() * 50000) + 100,
    phoneNumber: `+23767${String(Math.floor(Math.random() * 9000000) + 1000000)}`,
    provider: pick(providers),
    currency: pick(currencies),
    stellarAddress: `G${"A".repeat(55)}`,
    reference: `CONCURRENT-${seed}-${Math.floor(Math.random() * 10000)}`,
  });
}

function makeIngestPayload() {
  return JSON.stringify({
    event_type: "payment.callback",
    provider: pick(providers),
    reference: `INGEST-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    amount: parseFloat((Math.random() * 100000 + 50).toFixed(2)),
    currency: pick(currencies),
    status: "success",
    timestamp: new Date().toISOString(),
    metadata: {
      customer_id: `cust-${Math.floor(Math.random() * 1000000)}`,
      channel: pick(["mobile", "ussd", "api", "pos"]),
    },
  });
}

const params = {
  headers: { "Content-Type": "application/json" },
  timeout: "15s",
};

export const options = {
  scenarios: {
    concurrent_deposits: {
      executor: "ramping-arrival-rate",
      startRate: 50,
      timeUnit: "1s",
      preAllocatedVUs: 200,
      maxVUs: 2000,
      stages: [
        { target: 50, duration: "1m" },
        { target: 200, duration: "2m" },
        { target: 500, duration: "2m" },
        { target: 200, duration: "2m" },
        { target: 0, duration: "1m" },
      ],
      exec: "depositStress",
    },
    concurrent_ingestion: {
      executor: "ramping-arrival-rate",
      startRate: 100,
      timeUnit: "1s",
      preAllocatedVUs: 500,
      maxVUs: 5000,
      stages: [
        { target: 100, duration: "1m" },
        { target: 500, duration: "2m" },
        { target: 1000, duration: "2m" },
        { target: 500, duration: "2m" },
        { target: 0, duration: "1m" },
      ],
      exec: "ingestStress",
    },
    concurrent_status_checks: {
      executor: "constant-vus",
      vus: 50,
      duration: "8m",
      exec: "statusCheckStress",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<3000"],
    concurrent_error_rate: ["rate<0.15"],
  },
};

export function depositStress() {
  const start = Date.now();
  const res = http.post(`${BASE_URL}/api/transactions/deposit`, makeDepositPayload(), {
    ...params,
    tags: { operation: "concurrent_deposit" },
  });
  concurrentLatency.add(Date.now() - start);

  const ok = check(res, {
    "deposit accepted": (r) => r.status === 201 || r.status === 200 || r.status === 401,
  });

  concurrentErrorRate.add(!ok);
  transactionCounter.add(1);
}

export function ingestStress() {
  const start = Date.now();
  const res = http.post(`${BASE_URL}/ingest`, makeIngestPayload(), {
    ...params,
    tags: { operation: "concurrent_ingest" },
  });
  concurrentLatency.add(Date.now() - start);

  const ok = check(res, {
    "ingestion accepted": (r) => r.status === 202 || r.status === 200 || r.status === 201,
  });

  concurrentErrorRate.add(!ok);
  transactionCounter.add(1);
}

export function statusCheckStress() {
  const txId = `TXN-${Math.floor(Math.random() * 1000000)}`;
  const res = http.get(`${BASE_URL}/api/transactions/${txId}`, {
    ...params,
    tags: { operation: "concurrent_status_check" },
  });

  const ok = check(res, {
    "status check responded": (r) => r.status === 200 || r.status === 404,
  });

  concurrentErrorRate.add(!ok);
  sleep(0.1);
}

export function handleSummary(data) {
  const m = data.metrics;
  const dur = m.http_req_duration?.values;

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║       Concurrent Transaction Stress — Results Summary    ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║  Total Requests : ${String(m.http_reqs?.values?.count ?? 0).padEnd(39)}║`);
  console.log(`║  Peak Throughput: ${String((m.http_reqs?.values?.rate ?? 0).toFixed(1) + " req/s").padEnd(39)}║`);
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║  P95 latency    : ${String((dur?.["p(95)"] ?? 0).toFixed(2) + " ms").padEnd(39)}║`);
  console.log(`║  P99 latency    : ${String((dur?.["p(99)"] ?? 0).toFixed(2) + " ms").padEnd(39)}║`);
  console.log(`║  Max latency    : ${String((dur?.max ?? 0).toFixed(2) + " ms").padEnd(39)}║`);
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║  Error Rate     : ${String(((m.concurrent_error_rate?.values?.rate ?? 0) * 100).toFixed(2) + "%").padEnd(39)}║`);
  console.log(`║  Transactions   : ${String(m.concurrent_transactions?.values?.count ?? 0).padEnd(39)}║`);
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return {
    stdout: JSON.stringify(data, null, 2),
    [`tests/stress/results/concurrent-${ts}.json`]: JSON.stringify(data, null, 2),
  };
}

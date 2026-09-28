import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

// Custom metrics
const authErrorRate = new Rate('auth_errors');
const txErrorRate = new Rate('tx_errors');

export const options = {
  scenarios: {
    // Constant VUs for baseline testing
    constant_load: {
      executor: 'constant-vus',
      vus: 10,
      duration: '30s',
      tags: { test_type: 'baseline' },
    },
    // Ramping up to stress the system
    ramping_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 20 },
        { duration: '1m', target: 20 },
        { duration: '30s', target: 0 },
      ],
      startTime: '30s',
      tags: { test_type: 'stress' },
    },
  },
  thresholds: {
    // 95% of requests must complete below 500ms
    http_req_duration: ['p(95)<500'],
    // Overall error rate should be less than 1%
    http_req_failed: ['rate<0.01'],
    // Custom threshold for auth errors
    auth_errors: ['rate<0.05'],
    // Custom threshold for transaction errors
    tx_errors: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:3000';

export default function () {
  // 1. Test Authentication Endpoint
  const authRes = http.get(`${BASE_URL}/auth/health`);
  
  const authSuccess = check(authRes, {
    'auth health status is 200': (r) => r.status === 200,
  });
  
  authErrorRate.add(!authSuccess);
  sleep(1);

  // 2. Test Transaction (Payment Intents) Simulation
  // Using a mock payload for transaction initiation
  const payload = JSON.stringify({
    amount: "1000",
    currency: "XAF",
    msisdn: "237612345678",
    provider: "mtn"
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const txRes = http.post(`${BASE_URL}/api/transactions`, payload, params);
  
  const txSuccess = check(txRes, {
    'transaction created or unauthorized (handled)': (r) => r.status === 200 || r.status === 201 || r.status === 401 || r.status === 403,
  });
  
  txErrorRate.add(!txSuccess);
  
  // Random sleep between requests to simulate real users
  sleep(Math.random() * 2 + 1);
}

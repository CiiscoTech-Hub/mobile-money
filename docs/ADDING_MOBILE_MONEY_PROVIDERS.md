# Adding a Mobile Money Provider

This guide is for developers adding a mobile-money integration to the backend. Provider APIs, currencies, phone formats, callback contracts, and settlement behavior are provider-specific. Verify those details against the provider's current documentation and label any sandbox or mock behavior in tests and operational docs.

## Architecture Entry Points

The common transaction contract is `MobileMoneyProvider` in [`src/services/mobilemoney/mobileMoneyService.ts`](../src/services/mobilemoney/mobileMoneyService.ts). An adapter must support:

- `requestPayment(phoneNumber, amount, requestId?)`
- `sendPayout(phoneNumber, amount, requestId?)`
- `getTransactionStatus(referenceId)`
- optional `sendBatchPayout(items)`

The runtime provider factory is the lazy `loadProvider` function in [`src/services/mobilemoney/mobileMoneyService_impl.js`](../src/services/mobilemoney/mobileMoneyService_impl.js). The TypeScript wrapper adds shared phone-format checks and scheduled-maintenance routing through `providerSettingsService`.

Existing implementations provide two useful patterns:

- [`src/services/providers/baseProvider.ts`](../src/services/providers/baseProvider.ts) centralizes OAuth2 credentials, Basic/Bearer headers, token caching, expiry leeway, and timeouts for adapters such as MTN and Airtel.
- [`src/services/mobilemoney/providers/orangeMadagascar.ts`](../src/services/mobilemoney/providers/orangeMadagascar.ts) shows a provider with explicit endpoint paths, currency, retries, batch payouts, callback signing configuration, and response normalization.

Keep provider-specific HTTP and response mapping inside the adapter. Return the shared success/data/error shape and normalized statuses (`completed`, `failed`, `pending`, or `unknown`) to the service layer.

## Implementation Steps

1. Add the provider enum/key in [`src/config/providers.ts`](../src/config/providers.ts) if it needs centralized limits.
2. Add an adapter under `src/services/mobilemoney/providers/` or `src/services/providers/`, matching the closest existing architecture.
3. Implement authentication, token/session caching, timeout behavior, idempotent request/reference handling, collection, payout, status lookup, and optional batch behavior.
4. Add the adapter case to `loadProvider` in the compiled service artifact. Keep the key stable and use lazy loading so unused integrations are not initialized.
5. Add provider limits and environment-backed settings to [`src/config/appConfig.ts`](../src/config/appConfig.ts), plus any environment-specific config only when the setting is not secret. Add credentials to the secret manager/deployment environment, never to source control.
6. Add phone-number and currency validation at the correct boundary. Do not copy a country's format or currency from another provider without evidence.
7. Normalize provider responses and errors. Preserve provider references for reconciliation and avoid logging unmasked phone numbers or credentials.

## Configuration and Environment

Use the existing naming style, for example `MTN_API_KEY`, `MTN_API_SECRET`, `MTN_BASE_URL`, `MTN_SUBSCRIPTION_KEY`, and `MTN_TARGET_ENVIRONMENT`. Provider limits use Convict schema entries such as `minAmount`, `maxAmount`, and callback signature settings. `src/config/providers.ts` reads the effective limits through Convict on access and validates positive min/max ranges.

Document every new variable with its default, environment, unit/currency, and whether it is secret. Include sandbox URLs and mock credentials only as clearly marked development/test values. If configuration is read directly from `process.env`, document initialization/restart requirements; do not imply that an already-created provider instance will reload values.

## Webhooks and Callbacks

If the provider sends callbacks, add a dedicated route under `src/routes/`, mount it in [`src/index.ts`](../src/index.ts), and add a signature-verification middleware. Apply the ingest rate limiter, validate the payload with Zod, acknowledge only after validation/signature checks, and make processing idempotent using the provider reference or transaction ID.

Existing country-specific routes include `/api/mtn/callback`, `/api/orange-madagascar/callback`, `/api/orange-madagascar/callback/batch`, and corresponding Orange Guinea routes. These current callback handlers acknowledge and log validated payloads; do not assume that acknowledgement alone completes ledger or transaction reconciliation. Implement the state update explicitly and add a replay test.

For outgoing merchant webhooks, use the existing webhook service/schema and retry/outbox patterns rather than creating a second delivery protocol. See [`src/services/webhook.ts`](../src/services/webhook.ts) and [`src/services/webhookSchema.ts`](../src/services/webhookSchema.ts).

## Validation and Tests

Add focused tests beside the adapter, following existing provider tests under `src/services/mobilemoney/providers/__tests__/` and `src/services/providers/__tests__/`. Cover:

- auth success, expiry, refresh, missing credentials, and timeout;
- collection, payout, batch limits, status mapping, malformed responses, and provider errors;
- phone/currency/amount boundaries and unsupported keys;
- request IDs, duplicate callbacks, signature failures, invalid payloads, and replay behavior;
- circuit-breaker/fallback and scheduled-maintenance outcomes;
- masked logs and preservation of provider references.

Use the mock provider server or provider-specific fixtures where available. Pact tests are appropriate for external response contracts; see [`docs/PACT_CONTRACT_TESTING.md`](./PACT_CONTRACT_TESTING.md). Run the narrow adapter tests first, then type-check, lint, and the relevant integration/contract tests.

## Rollout

Deploy the adapter disabled or pointed at the provider sandbox first. Validate credentials, callback reachability, signature verification, currency/phone behavior, status polling, reconciliation, alerting, and provider health metrics with test transactions. Enable production traffic behind the existing routing/settings controls, start with a small cohort or capped amounts, and watch success rate, latency, pending age, duplicate/retry counts, ledger reconciliation, and balances.

Have a rollback path that stops new routing without deleting provider references or reconciliation records. A provider-specific maintenance entry may cause the wrapper to fallback or abort; verify the configured behavior before enabling traffic.

## Completion Checklist

- [ ] Stable provider key, enum entry, factory registration, and route mount are present.
- [ ] Adapter implements the shared operations and normalizes statuses/errors.
- [ ] Credentials, URLs, limits, currencies, timeouts, and callback settings are documented and environment-backed.
- [ ] Phone and amount validation is tested for the provider's actual market.
- [ ] Callback signatures, schemas, idempotency, acknowledgement, and state updates are covered.
- [ ] Provider references flow into transactions, webhooks, and reconciliation.
- [ ] Unit, integration, Pact/mock, type-check, lint, and relevant end-to-end checks pass.
- [ ] Sandbox rollout and production rollback procedures are recorded.
- [ ] Monitoring, alert thresholds, ownership, and operational runbook links are ready.

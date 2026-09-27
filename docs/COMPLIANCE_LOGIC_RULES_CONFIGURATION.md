# Compliance Logic Rules Configuration

This guide describes where the platform's compliance and risk rules are defined, how values are selected, and how an operator can change policy safely. It documents the current implementation; it is not a substitute for legal or regulatory advice.

## Rule Locations

The platform does not have one admin-managed rules file. Rules are split across code and configuration:

| Area                       | Implementation surface                                                                                                                                        | What it controls                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AML transaction monitoring | [`src/services/aml.ts`](../src/services/aml.ts)                                                                                                               | Single-transaction and daily totals, rapid structuring, profile/velocity scoring, geographic hops, sanctions results, and high-value reporting assessment |
| Fraud scoring              | [`src/services/fraud.ts`](../src/services/fraud.ts)                                                                                                           | Velocity, amount, geographic, and failed-attempt pattern scoring                                                                                          |
| Travel Rule                | [`src/compliance/travelRule.ts`](../src/compliance/travelRule.ts) and [`src/controllers/complianceController.ts`](../src/controllers/complianceController.ts) | Whether qualifying transfers require originator/beneficiary data and the check endpoint threshold                                                         |
| KYC levels and limits      | [`src/config/limits.ts`](../src/config/limits.ts)                                                                                                             | Transaction limits by KYC level and global amount bounds                                                                                                  |
| Provider amount limits     | [`src/config/appConfig.ts`](../src/config/appConfig.ts) and [`src/config/providers.ts`](../src/config/providers.ts)                                           | Minimum and maximum amounts for configured provider/country entries                                                                                       |
| Sanctions                  | [`src/services/sanctionService.ts`](../src/services/sanctionService.ts)                                                                                       | Sanctions screening integration and match handling                                                                                                        |
| Policy knowledge           | [`src/models/complianceDocument.ts`](../src/models/complianceDocument.ts) and [`src/routes/admin.ts`](../src/routes/admin.ts)                                 | Admin-maintained guidance, sources, country/provider scope, tags, and publication status                                                                  |

## Precedence and Defaults

Use the following precedence when diagnosing an effective value:

1. A constructor-injected service configuration, when a test or caller supplies one. `AMLService` merges a supplied partial config over its defaults.
2. The environment variable read by the implementation, when that variable is supported.
3. The code default in the owning module.
4. For Convict-managed settings, the schema default, followed by the environment-specific JSON and optional local configuration loaded by [`src/config/appConfig.ts`](../src/config/appConfig.ts). Environment variables are the documented override mechanism.

The last two layers are not interchangeable. AML settings are read directly from `process.env` when the module creates its default configuration. Provider and transaction limits are read through Convict. Confirm the owning implementation before changing a value.

The Travel Rule has two code-defined thresholds today: `TRAVEL_RULE_THRESHOLD_USD` controls `travelRuleCheckHandler`, while `COMPLIANCE_THRESHOLD_USD` controls `ComplianceController.validateComplianceStatus`. Treat them as separate rules until the implementation unifies them.

## AML Settings

The supported AML environment variables and code defaults are:

| Variable                                                         |     Default | Meaning                                           |
| ---------------------------------------------------------------- | ----------: | ------------------------------------------------- |
| `AML_SINGLE_TRANSACTION_THRESHOLD_XAF`                           |   `1000000` | Single transaction threshold                      |
| `AML_DAILY_TOTAL_THRESHOLD_XAF`                                  |   `5000000` | Rolling daily total threshold                     |
| `AML_ROLLING_WINDOW_HOURS`                                       |        `24` | Lookback window                                   |
| `AML_RAPID_WINDOW_MINUTES`                                       |        `15` | Rapid activity window                             |
| `AML_RAPID_TRANSACTION_COUNT`                                    |         `3` | Rapid activity count                              |
| `AML_STRUCTURING_FLOOR_XAF`                                      |    `100000` | Minimum amount considered for structuring         |
| `AML_STRUCTURING_THRESHOLD_RATIO`                                |       `0.8` | Ratio used by structuring logic                   |
| `AML_STRUCTURING_FREQUENCY_LIMIT`                                |         `3` | Structuring frequency limit                       |
| `AML_PROFILE_SCORE_THRESHOLD`                                    |        `50` | Risk-profile score at which review is recommended |
| `AML_VELOCITY_HOURLY_CAP` / `AML_VELOCITY_DAILY_CAP`             |  `5` / `15` | Hourly and daily velocity caps                    |
| `AML_MOVING_AVERAGE_WINDOW_DAYS`                                 |        `30` | Historical amount window                          |
| `AML_AMOUNT_MULTIPLIER_LIMIT` / `AML_FREQUENCY_SPIKE_MULTIPLIER` |   `3` / `3` | Profile anomaly multipliers                       |
| `AML_GEO_HOP_MAX_KM` / `AML_GEO_HOP_MAX_HOURS`                   | `250` / `6` | Geographic-hop limits                             |
| `AML_HIGH_VALUE_REPORT_THRESHOLD_USD`                            |     `10000` | High-value report assessment threshold            |

AML results expose rule hits, observed values, thresholds, risk score, recommended action, and reasons. Alerts use `pending_review`, `reviewed`, or `dismissed` states and `medium` or `high` severity.

## Configuration Change Procedure

1. Identify the owning module and the unit/integration tests for that rule.
2. Record the reason, effective environment, old value, new value, approver, and expected operational effect.
3. Change the environment or Convict configuration through the deployment configuration process. Do not put credentials or secrets in this document or in source control.
4. Run the relevant tests, deploy to staging, and exercise a below-threshold, threshold, and above-threshold case where possible.
5. Restart or reload the application as required. Direct `process.env` defaults are established when the service instance/module is initialized; do not assume an existing process will pick up a changed value.
6. Monitor AML alert volume, rejected transactions, provider error rates, and compliance notifications after rollout.

There is no inspected endpoint for editing AML or fraud thresholds from the admin knowledge base. Knowledge-base edits document policy and sources; they do not change executable rules.

## Knowledge Base and Auditability

The admin knowledge base is served at `GET /api/admin/compliance/knowledge-base`. Documents are stored in `compliance_documents` and support `draft`, `published`, and `archived` states, optional two-letter country code, provider, tags, summary, body, and source URL. Listing defaults to excluding archived documents and supports search, country, provider, tag, status, pagination, and facets.

The API endpoints are:

- `GET /api/admin/compliance/docs` and `/facets`
- `GET /api/admin/compliance/docs/:id`
- `POST /api/admin/compliance/docs`
- `PATCH /api/admin/compliance/docs/:id`
- `DELETE /api/admin/compliance/docs/:id` (archive)

All are behind admin authentication. The Casbin policy declares `read` and `write` permissions for `compliance_knowledge_base`, but the inspected knowledge-base handlers enforce the admin role directly; confirm the deployed authorization middleware before relying on per-action permission enforcement. Admin routes also use the audit interceptor, and create/update/archive operations log admin actions. AML review and SAR actions use the `aml_alerts` permission object in the audit router.

Keep source URLs, jurisdiction/provider scope, review notes, and publication status current. A published document is operational guidance, not proof that a runtime rule changed.

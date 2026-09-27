# Operator Dashboard User Manual

This manual covers the administrative HTTP surfaces currently implemented by the service. The repository contains self-contained HTML for the financial dashboard and compliance knowledge base; other areas are API endpoints intended for an internal dashboard or operational tooling.

## Authentication

Administrative routes are mounted under `/api/admin` with `requireAuth` in [`src/index.ts`](../src/index.ts). The middleware accepts:

- `X-API-Key`: first checks an active, unexpired database key and its permission bitmask, then falls back to `ADMIN_API_KEY` for the system admin key.
- `Authorization: Bearer <token>`: accepts a valid OAuth access token or an admin SEP-10 token.

Do not paste keys into URLs, tickets, or browser history. Use HTTPS, keep sessions short, rotate credentials through the normal secrets process, and verify that a key has only the permissions needed for the operator's role. Invalid, inactive, or expired credentials return `401`; insufficient authorization returns `403`.

## Dashboard Areas

| Area                      | Entry point                            | Primary use                                                                                                                                                                                                        |
| ------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Financial dashboard       | `GET /api/admin/financial/dashboard`   | Self-contained HTML view of financial data; it refreshes data from the P&L and transaction endpoints                                                                                                               |
| Transactions              | `/api/admin/transactions`              | Search, inspect, annotate, update, refund, and perform supported bulk actions                                                                                                                                      |
| Users                     | `/api/admin/users`                     | Inspect accounts, status history, freeze/unfreeze, unlock, and manage supported user settings                                                                                                                      |
| Provider health           | `GET /api/admin/providers/status`      | Green/yellow/red health based on the last 100 recorded API calls: at least 95% is green, at least 80% is yellow, otherwise red or no data                                                                          |
| Queues                    | `/admin/queues`                        | Bull Board queue operations and dead-letter inspection where enabled                                                                                                                                               |
| Reconciliation            | `/api/admin/reconciliation/*`          | Runs, alerts, provider report configuration, and manual reconciliation                                                                                                                                             |
| Compliance knowledge base | `/api/admin/compliance/knowledge-base` | Search and maintain policy documents                                                                                                                                                                               |
| AML audit                 | `src/routes/audit.ts`                  | Defines authenticated alert, statistics, transaction-context, review, rejection, and SAR handlers; the inspected `src/index.ts` does not mount this router, so confirm the deployment's mount path before using it |
| KYC upgrades              | `/api/admin/kyc-upgrades`              | Review, approve, reject, and bulk-process tier upgrade requests                                                                                                                                                    |

The exact page layout for a separate dashboard client is not defined in this repository. Treat the route list as the source of truth for available server capabilities.

## Compliance Knowledge Base Workflow

1. Open the knowledge-base page with an authenticated admin request.
2. Use search or the country, provider, tag, and status filters. Archived documents are excluded from the default list.
3. Select **New**, enter a non-empty title and body, and add summary, source URL, two-letter country code, provider, and normalized comma-separated tags when applicable.
4. Save as `draft` while reviewing. Use `published` only after the source, jurisdiction, and owner have been checked.
5. Update the document with `PATCH` or the page editor. Archive obsolete guidance rather than deleting its history.
6. Record the external source and the reason for material changes in the document body or the change record used by the operating team.

The knowledge base does not edit AML thresholds, KYC limits, or provider routing. Those remain configuration/code changes.

## AML and KYC Operations

### AML alerts

Use the authenticated audit router to list alerts, filter/search them, inspect transaction context, and read dashboard statistics. The router defines a review `PATCH /aml/alerts/:alertId/review` with a terminal review status (`reviewed` or `dismissed`), reviewer identity, and optional notes, plus SAR handling at `POST /aml/alerts/:alertId/sar`; the external mount prefix is deployment-specific in the inspected source.

Before closing an alert, record the rationale, check the rule hits and observed threshold values, and follow the applicable escalation policy. Do not treat the `recommendedAction` field as a final legal decision.

### KYC tier upgrades

Use `GET /api/admin/kyc-upgrades?status=<status>` to find requests. Approval is `POST /api/admin/kyc-upgrades/:id/approve` with optional `notes`. Rejection is `POST /api/admin/kyc-upgrades/:id/reject` and requires both `rejection_reason` from the configured list and optional notes. Bulk approval is capped at 100 IDs. Confirm the request is not already in a terminal state before retrying.

KYC documents and their raw file URLs are access-controlled; compliance officers receive different file visibility from other roles. Handle downloaded identity documents as sensitive data.

## Common Actions and Troubleshooting

| Symptom                         | Check                                                                                                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401 Unauthorized`              | Send exactly one supported API key or bearer token; check expiry, activity, and the `ADMIN_API_KEY` value in the running environment                            |
| `403 Forbidden`                 | Confirm the authenticated role and Casbin object/action permission, such as `aml_alerts:write` or `compliance_knowledge_base:write`                             |
| No provider status              | The status service reports red/no data when fewer than the required recent calls are available; inspect provider logs and health rather than assuming an outage |
| Knowledge-base save fails       | Title/body must be non-empty; country must be two uppercase letters; status must be `draft`, `published`, or `archived`; tags must be strings                   |
| KYC rejection fails             | Supply a valid configured `rejection_reason`; do not substitute free-form text                                                                                  |
| Provider transaction is pending | Check provider status, transaction status, queue/DLQ state, and reconciliation before retrying to avoid duplicate payout/collection                             |

For provider outages, scheduled maintenance may route to a configured fallback or abort the operation. Check the returned maintenance metadata and the provider status endpoint before manually replaying work.

## Security Rules for Operators

- Use least-privilege API keys and separate read from write duties.
- Require the platform's configured 2FA/step-up controls for sensitive actions, especially withdrawals.
- Never expose API keys, bearer tokens, KYC documents, Travel Rule payloads, or SAR data in screenshots or chat.
- Verify transaction IDs and provider references before refund, retry, freeze, or approval actions.
- Prefer archive/review states over destructive edits, and retain notes needed for audit review.
- Treat admin impersonation as read-only when the token says so; mutation requests are rejected by middleware.
- Escalate suspected credential misuse, unexpected permission changes, or unexplained alert-volume changes immediately.

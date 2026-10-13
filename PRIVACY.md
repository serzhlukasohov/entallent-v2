# Privacy

## Data Categories

| Category | Examples | Sensitivity |
|----------|---------|-------------|
| Profile | Name, timezone, Slack ID | Low |
| Conversations | Message text (inbound + outbound) | High — retained under the tenant message-retention setting |
| Memory items | Extracted facts, goals, concerns | High — derived from conversations |
| Survey assessments | Engagement scores, wellbeing dimensions | High — only shown in aggregate |
| Risk signals | Detected distress indicators | Critical — HR-restricted |
| Audit logs | Who accessed what, when | Medium — compliance record |
| LLM call metadata | Token counts, latency, model version | Low |

## Access Model

| Role | What they can see |
|------|------------------|
| Employee (self) | Their own Slack conversation; a verified self-service export, deletion, and review channel is not mounted in the API |
| Manager | Aggregate survey metrics (cohort ≥ 5), aggregate engagement trends — NO individual conversation data |
| Admin (`X-Api-Key`) | Mounted aggregate and operational admin routes; no original conversations, temporary question insights, or individual employee analytics |
| Employee-facing runtime | Tenant- and employee-scoped conversation history needed for continuity |

## Manager Visibility Boundaries

Managers explicitly **cannot** see:
- Individual conversation text
- Individual memory items or goals
- Individual risk signal details
- Single-person cohort analytics (any metric with < 5 users is suppressed)

The `GET /admin/analytics` and `GET /admin/survey/coverage` endpoints enforce cohort minimums server-side. The frontend should not rely on client-side filtering for this constraint.

## Retention

The current domain defaults (configurable per tenant via `tenants.retention_policy`) are below. The retention cleanup code and script apply these settings when run; this table does not assert a production schedule or a separately approved legal retention policy.

Earlier versions of this document stated 90 days for messages, 365 days for memory, and 730 days for audit logs. Those values conflict with the code defaults below. The intended policy needs explicit privacy/product reconciliation before these defaults are represented as a customer retention commitment.

| Data | Default retention | After expiry |
|------|-----------------|-------------|
| Message text and linked survey evidence | 365 days | Message text and metadata redacted; evidence summaries and assessment detail cleared |
| Memory items and V2 analytical insights | 730 days | Memory content and temporary Bundle text cleared; final V2 insight rows deleted, with a content-free withdrawal audit entry when applicable |
| Audit logs | 2555 days | Deleted by the retention cleanup |
| Risk signals | 90 days | Expired and recommended action cleared; source evidence UUIDs remain under the database source guard |

The cleanup is available through `pnpm retention:cleanup`; its production schedule has not been verified. The V2 cycle-close processor may clear temporary analytical text earlier, after timely replies have been processed.

## Employee Export, Deletion, and Review

The legacy `GET /users/:userId/data-export` and `POST /users/:userId/data-deletion` controllers are not mounted in the active API. They accept an arbitrary user ID under a shared key, assume `DEFAULT_TENANT_ID`, and do not cover V2 analytical data, so they must not be presented as employee-rights endpoints. The legacy preferences route is also unmounted.

IA-043 preserves employee export, deletion, and future self-review rights under a separate privacy and retention contract. A verified employee identity boundary, tenant-scoped request workflow, V2 data coverage, audit trail, and deletion/retention rules are still required before these functions can be made available through the product. The V2 insight specification does not define that contract.

## Consent

User preferences tracked in `users.consent_state` (JSONB):
- `surveyEnabled` — opt-in/out of survey probing
- `proactiveMessagingEnabled` — bool column (not consent_state)

The legacy `PATCH /users/:userId/preferences` route is not mounted. Consent changes in the active runtime need a separately verified boundary and audit review.

## Encryption at Rest

- Slack OAuth credentials: AES-256-GCM (`workspace_connections.encrypted_credentials`)
- Database-level encryption: configured at the infrastructure layer (PostgreSQL TDE or managed cloud encryption)
- Application-layer encryption: via `EncryptionPort` → `LocalEncryptionAdapter` (AES) or KMS adapter

## Encryption in Transit

- All external endpoints: HTTPS/TLS 1.2+
- Internal service communication: network-level encryption (VPC / private networking in production)
- Redis: TLS (configured via `REDIS_URL` with `rediss://`)
- PostgreSQL: TLS (configured via `DATABASE_URL`)

## ADR References

- ADR-008: Privacy boundaries for manager analytics — cohort minimum enforcement
- ADR-009: Audit log design — append-only, no FK constraints for GDPR compliance

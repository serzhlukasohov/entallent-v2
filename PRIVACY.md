# Privacy

## Data Categories

| Category | Examples | Sensitivity |
|----------|---------|-------------|
| Profile | Name, timezone, Slack ID | Low |
| Conversations | Message text (inbound + outbound) | High — processed in transit, retained 90d |
| Memory items | Extracted facts, goals, concerns | High — derived from conversations |
| Survey assessments | Engagement scores, wellbeing dimensions | High — only shown in aggregate |
| Risk signals | Detected distress indicators | Critical — HR-restricted |
| Audit logs | Who accessed what, when | Medium — compliance record |
| LLM call metadata | Token counts, latency, model version | Low |

## Access Model

| Role | What they can see |
|------|------------------|
| Employee (self) | Own conversation history (via Slack), memory items, goals, preferences |
| Manager | Aggregate survey metrics (cohort ≥ 5), aggregate engagement trends — NO individual conversation data |
| Admin (`X-Api-Key`) | Everything in the admin panel, including user debug view (audit-logged) |
| AI system | Full conversation context during processing; no retention beyond the job |

## Manager Visibility Boundaries

Managers explicitly **cannot** see:
- Individual conversation text
- Individual memory items or goals
- Individual risk signal details
- Single-person cohort analytics (any metric with < 5 users is suppressed)

The `GET /admin/analytics` and `GET /admin/survey/coverage` endpoints enforce cohort minimums server-side. The frontend should not rely on client-side filtering for this constraint.

## Retention

Default retention periods (configurable per tenant via `tenants.retention_policy`):

| Data | Default retention | After expiry |
|------|-----------------|-------------|
| Message text | 90 days | `text` set to `[deleted]`, `deleted_at` set |
| Memory items | 365 days | `status` set to `deleted`, `content` cleared |
| Audit logs | 730 days | Not deleted — compliance requirement |
| LLM run records | 90 days | Deleted |
| Risk signals | See severity expiry | `status` set to `resolved` |

## Data Deletion (GDPR Right to Erasure)

`POST /users/:userId/data-deletion` (202 Accepted):
1. Anonymise all message text → `[deleted]`
2. Mark all memory items as deleted, clear content
3. Cancel all pending scheduled actions
4. Resolve all active risk signals
5. Soft-delete user record (`status = deleted`, `deleted_at = now()`)
6. Write audit log entry `user.data_deletion_requested`

The user row is soft-deleted (not hard-deleted) to preserve referential integrity with audit logs. Hard deletion can be scheduled after the audit log retention period.

## Data Export (GDPR Right to Portability)

`GET /users/:userId/data-export` returns JSON containing:
- User profile (no credentials)
- Last 500 messages (non-deleted)
- All active memory items
- All goals
- All scheduled actions

The response is intentionally limited to avoid exfiltration of system metadata. Sensitive fields like `encrypted_credentials` are never included.

## Consent

User preferences tracked in `users.consent_state` (JSONB):
- `surveyEnabled` — opt-in/out of survey probing
- `proactiveMessagingEnabled` — bool column (not consent_state)

All consent changes are audit-logged via `PATCH /users/:userId/preferences`.

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

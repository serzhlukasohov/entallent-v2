# Data Model

## Entities

### tenants
Root entity. Every other entity has `tenant_id NOT NULL` to enforce isolation.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | text | Display name |
| status | text | active \| suspended \| offboarded |
| timezone | text | Default IANA timezone |
| retention_policy | jsonb | `{ messageDays, memoryDays, auditLogDays }` |
| safety_policy | jsonb | Tenant-specific risk thresholds and escalation config |
| proactive_messaging_policy | jsonb | Quiet hours, frequency limits |
| survey_configuration | jsonb | Override global survey settings |

### users
One row per employee per tenant.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| tenant_id | uuid FK → tenants | |
| preferred_name | text | Extracted from Slack display name |
| status | text | active \| deleted |
| timezone | text | User-local timezone (overrides tenant) |
| proactive_messaging_enabled | bool | Consent for outbound messages |
| quiet_hours | jsonb | `{ enabled, startHour, endHour }` |
| onboarding_status | text | pending \| completed \| skipped |
| consent_state | jsonb | Arbitrary consent flags including `surveyEnabled` |
| deleted_at | timestamp | Soft-delete (GDPR erasure) |

### workspace_connections
Slack workspace OAuth credentials per tenant.

| Column | Type | Notes |
|--------|------|-------|
| encrypted_credentials | text | AES-256-GCM encrypted JSON `{ botToken, signingSecret }` |
| external_workspace_id | text | Slack workspace ID |

### channel_accounts
Links a user to their Slack identity in a workspace.

| Column | Type | Notes |
|--------|------|-------|
| external_user_id | text | Slack member ID |
| external_workspace_id | text | |
| channel_type | text | slack (extensible to teams, etc.) |

### conversations
One conversation per user per Slack DM thread.

| Column | Type | Notes |
|--------|------|-------|
| external_conversation_id | text | Slack channel/DM ID |
| channel_type | text | |
| status | text | active \| archived |
| user_display_name | text | Cached from Slack for AI context |

### messages
Immutable log of all conversation turns.

| Column | Type | Notes |
|--------|------|-------|
| direction | text | inbound \| outbound |
| text | text | Message content |
| normalized_text | text | Lowercase, trimmed (for dedup) |
| message_type | text | text \| system \| follow_up |
| occurred_at | timestamp | Event time (not insert time) |
| deleted_at | timestamp | GDPR anonymization — text set to `[deleted]` |
| trace_id | text | Links all DB ops for one request |

### memory_items
Extracted facts about the user. Long-lived, user-controlled.

| Column | Type | Notes |
|--------|------|-------|
| category | text | goal \| preference \| concern \| achievement \| context |
| content | text | Human-readable extracted fact |
| importance | numeric(3,2) | 0–1 relevance score |
| status | text | active \| superseded \| deleted \| conflicted |
| source_message_ids | uuid[] | Which messages generated this item |
| conflict_with | uuid[] | IDs of items this supersedes |

### user_goals
Structured goal tracking extracted from memory.

| Column | Type | Notes |
|--------|------|-------|
| title | text | |
| description | text | |
| status | text | active \| completed \| abandoned |
| target_date | date | |

### scheduled_actions
Planned proactive outreach.

| Column | Type | Notes |
|--------|------|-------|
| type | text | follow_up \| check_in \| nudge \| milestone |
| intent | text | AI-generated instruction for what to say |
| due_at | timestamp | When to send |
| status | text | pending \| sent \| cancelled \| failed |

### risk_signals
Detected emotional or psychological risk events.

| Column | Type | Notes |
|--------|------|-------|
| type | text | burnout \| crisis \| harassment \| disengagement |
| severity | text | low \| medium \| high \| critical |
| confidence | numeric(3,2) | AI confidence score |
| status | text | active \| resolved |
| expires_at | timestamp | Auto-expiry (7d low, 30d medium, 90d high/critical) |
| policy_version | text | Which safety policy version detected this |

### survey_definitions / survey_questions
Survey structure. One global definition + optional per-tenant overrides.

### survey_windows
Per-user, per-quarter survey collection window. Auto-created on first conversation of the quarter.

### survey_assessments
Current scoring state per user per question per window. Status lifecycle: `unknown → insufficient_evidence → partially_covered → scored`.

### survey_evidence
Raw extracted evidence snippets linking message turns to question assessments.

### llm_runs
Observability log for every LLM call.

| Column | Type | Notes |
|--------|------|-------|
| task_type | text | conversation \| memory_extraction \| survey_evidence \| etc. |
| model | text | gpt-4o \| gpt-4o-mini \| etc. |
| prompt_version | text | Semver of the prompt used |
| input_token_count | int | |
| output_token_count | int | |
| latency_ms | int | Wall-clock time |
| estimated_cost | numeric(10,6) | USD |
| status | text | success \| error |
| trace_id | text | Links to conversation trace |

### audit_logs
Append-only compliance log. No FK constraints — entries survive entity deletion.

| Column | Type | Notes |
|--------|------|-------|
| actor_type | text | user \| agent \| system \| admin |
| actor_id | text | No FK — use text to survive deletion |
| action | text | Dot-notation: `user.data_deleted`, `admin.user_debug_viewed` |
| resource_type | text | user \| memory \| conversation \| etc. |
| resource_id | text | |
| metadata | jsonb | Arbitrary context |
| trace_id | text | |

### feature_flags
Tenant-aware feature gating. `tenant_id = NULL` means global default; tenant row overrides global.

| Column | Type | Notes |
|--------|------|-------|
| key | text | See `FEATURE_FLAGS` constants |
| tenant_id | uuid FK nullable | NULL = global |
| enabled | bool | |
| rollout_percentage | int | 0–100; uses MD5(userId) % 100 for consistent bucketing |
| metadata | jsonb | Model version, prompt version overrides |

## Relationships

```
tenants ──< workspace_connections
tenants ──< users ──< channel_accounts
users ──< conversations ──< messages
users ──< memory_items
users ──< user_goals
users ──< scheduled_actions
users ──< risk_signals
tenants ──< survey_definitions ──< survey_questions
users ──< survey_windows ──< survey_assessments
               survey_windows ──< survey_evidence
tenants ──< llm_runs
(no FK) audit_logs
tenants? ──< feature_flags (tenant_id nullable)
```

## Indexes

All tables have indexes on `tenant_id` + `user_id` (where applicable). Key additional indexes:

- `messages(occurred_at)` — for recency queries
- `messages(conversation_id, occurred_at DESC)` — conversation history
- `memory_items(user_id, tenant_id, status)` — active memory lookup
- `scheduled_actions(due_at, status)` — follow-up scheduling scan
- `risk_signals(user_id, tenant_id, status)` — active risk check
- `llm_runs(tenant_id, task_type)`, `llm_runs(trace_id)` — observability
- `audit_logs(created_at)`, `audit_logs(actor_id)`, `audit_logs(resource_type, resource_id)` — compliance queries

## Tenant Isolation

Every tenant-owned table has `tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`. All queries filter by `tenant_id` in the WHERE clause. There are no cross-tenant joins in the application code.

For enterprise deployments, add a PostgreSQL row-level security (RLS) policy:
```sql
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON messages
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

## Encryption

Field-level encryption (AES-256-GCM) applied to:
- `workspace_connections.encrypted_credentials` — Slack OAuth tokens

Key material stored in `FIELD_ENCRYPTION_KEY` env var (64-char hex = 32 bytes). For enterprise, replace `LocalEncryptionAdapter` with a KMS adapter implementing `EncryptionPort` — zero application code changes required.

## Retention

Default retention policy (configurable per tenant):
- Messages: 90 days
- Memory items: 365 days
- Audit logs: 730 days (2 years, compliance requirement)
- LLM runs: 90 days
- Risk signals: expire per severity (7d/30d/90d), then soft-retained for audit

GDPR deletion (`POST /users/:id/data-deletion`): anonymizes message text, marks memory items deleted, cancels scheduled actions, resolves risk signals, soft-deletes user. Audit log entries are retained (they survive entity deletion by design).

# MAF Runtime Rollback And Ownership Transfer Runbook

This runbook governs MAF shadow, canary, and primary operations. TypeScript remains
the runtime host for policy decisions and side-effect execution while Python/MAF
supplies proposals and reply text when routing enables it.

## Immediate Rollback Order

Use this order when MAF behavior is unsafe, privacy evidence is incomplete, canary diagnostics regress, or operators need to return all processing to TypeScript.

1. Enable `maf_runtime_disabled` for the affected scope or globally. This global kill switch has highest runtime precedence and forces TypeScript-only processing.
2. Add affected users to `maf_runtime_user_denylist` when rollback is scoped to a user or cohort. Denylist precedence wins over shadow and canary.
3. For all-MAF rollback, disable `maf_runtime_shadow` so new jobs stop recording MAF candidate attempts.
4. For canary-only rollback, disable or narrow `maf_runtime_canary` by turning off the tenant row, removing canary allowlists, or reducing `rolloutPercentage` to `0`. If shadow remains enabled, expect new `maf_shadow` attempts to continue as diagnostics-only evidence.
5. Confirm new jobs resolve to `maf_disabled` or `typescript` for all-MAF rollback, or to `maf_shadow`/`typescript` for canary-only rollback. Verify no new `maf_canary` attempts are recorded for the rolled-back scope.
6. Preserve privacy-safe evidence: runtime decision source, trace IDs, diagnostic IDs, stable reason codes, gate status, rollout flag key, tenant/user/workspace scope, and timestamps.

Emergency rollback evidence must not include raw Slack/user text, prompts, bearer tokens, service secrets, full request or response payloads, risk evidence, memory content, action payloads, provider errors, or stack traces. Use IDs, digests, stable reason codes, and aggregate counts.

## Runtime Mode Precedence

Runtime selection is evaluated for every conversation job by the TypeScript runtime router:

`global kill switch -> tenant/user denylist -> shadow flag -> primary flag -> canary flag -> TypeScript default`

Flag evaluation failures fail closed to TypeScript-only processing. Operators must treat
any runtime-control repository error, malformed rollout metadata, duplicate rollout
metadata rows, missing user/workspace identifier, or invalid gate evidence as non-enabling.
`maf_primary` is the primary user-facing MAF reply mode under explicit rollout policy.

## Controlled `maf_runtime_primary` Rollout (Staging/Prod-Like)

Use this section when enabling primary in non-local environments after readiness and smoke checks pass.

Before every rollout step:

- keep `maf_runtime_disabled` and `maf_runtime_user_denylist` operational paths available;
- keep `DEFAULT_TENANT_ID` and `ADMIN_API_KEY` set (for feature-flag reads/writes);
- ensure feature flags are explicitly snapshotted before mutation (`GET /admin/feature-flags`).

### Rollout Strategy

Default is **tenant-by-tenant**:

1. Keep `maf_runtime_shadow` disabled for that scope, otherwise shadow wins over primary.
2. Set `maf_runtime_primary` on the tenant row:

```sh
curl -X PUT \
  "$API_BASE/admin/feature-flags/maf_runtime_primary?tenantId=$TENANT_ID" \
  -H "X-Api-Key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"enabled":true,"rolloutPercentage":100}'
```

3. Run staging/prod-like evidence checks (smoke + reads below).
4. Add the next tenant only after successful checks for the current one.

Use **all-at-once** only after multiple tenants pass tenant-by-tenant checks:

```sh
curl -X PUT "$API_BASE/admin/feature-flags/maf_runtime_primary" \
  -H "X-Api-Key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"enabled":true,"rolloutPercentage":100}'
```

Use **rollback-barrier-first** when you want staged exposure with guaranteed emergency backout:

1. Apply/verify the intended rollout rows while `maf_runtime_disabled` remains enabled.
2. Confirm `maf_runtime_disabled` and denylist paths still force TypeScript for a test message.
3. Remove `maf_runtime_disabled` only after controlled verification passes.

### Per-Step Evidence

For each rollout step, confirm at least these points for the same `traceId`:

- Decision source and mode should resolve to primary:
  - in logs, `mode: "maf_primary"` and `decisionSource: "primary_flag"` in `Agent runtime decision resolved`;
- Runtime attempt exists and is committed:
  - `runtime_attempts.runtime_mode = 'maf_primary'` and `phase IN ('reply_committed','actions_committed')`;
- Feature-flag restore/backout is available:
  - recorded prior flag state is recoverable and can be re-applied quickly.

Example DB checks (replace IDs):

```sh
psql "$DATABASE_URL" -c \
  "SELECT runtime_mode, phase, failure_reason FROM runtime_attempts WHERE tenant_id = '$TENANT_ID' AND trace_id = '$TRACE_ID' ORDER BY created_at DESC LIMIT 5;"
psql "$DATABASE_URL" -c \
  "SELECT metadata FROM messages WHERE id = '$OUTBOUND_MESSAGE_ID' LIMIT 1;"
```

Feature-flag backout examples:

```sh
# immediate hard rollback scope
curl -X PUT "$API_BASE/admin/feature-flags/maf_runtime_disabled" \
  -H "X-Api-Key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"enabled":true}'

# remove tenant-level rollout
curl -X DELETE "$API_BASE/admin/feature-flags/maf_runtime_primary?tenantId=$TENANT_ID" \
  -H "X-Api-Key: $ADMIN_API_KEY"

# emergency scoped rollback for one user
curl -X PUT "$API_BASE/admin/feature-flags/maf_runtime_user_denylist?tenantId=$TENANT_ID" \
  -H "X-Api-Key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"enabled":true,"metadata":{"userIds":["U123456"]}}'
```

### Operator Test-and-Verify Checklist

Use this exact sequence for each rollout increment (`tenant` or cohort):

1. Take an immutable flag snapshot:

```sh
curl -sS "$API_BASE/admin/feature-flags?tenantId=$TENANT_ID" \
  -H "X-Api-Key: $ADMIN_API_KEY" \
  | jq '{flags:[.flags[]|{key,tenantId,enabled,rolloutPercentage,metadata}], knownKeys:.knownKeys}'
```

2. Enable `maf_runtime_primary` for the scope you are testing.
3. Send one staging smoke message using the same `DEFAULT_TENANT_ID`, with a deterministic user id for reuse:

```sh
curl -sS -X POST "$API_BASE/dev/simulate-message" \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"'$TENANT_ID'","userId":"smoke-primary-verify","userName":"Smoke Primary Verifier","text":"Smoke check: one concise sentence."}'
```

4. Capture `traceId`, `conversationId`, `messageId`, and `userId` from the response.
5. Confirm runtime decision traceability:

```sh
curl -sS "$API_BASE/dev/conversation/$CONVERSATION_ID/messages?after=$INBOUND_MESSAGE_ID" \
  -H "X-Tenant-Id: $TENANT_ID" \
  | jq '.[] | select(.direction=="outbound") | {id,traceId,direction,runtimeMode:(.metadata.runtimeMode//"-"),phase:(.metadata.phase//"-")}'
```

6. Confirm outbox/side-effect phase in DB and queue:

```sh
psql "$DATABASE_URL" -c \
  "SELECT runtime_mode, phase, failure_reason FROM runtime_attempts WHERE tenant_id = '$TENANT_ID' AND trace_id = '$TRACE_ID' ORDER BY created_at DESC LIMIT 5;"
psql "$DATABASE_URL" -c \
  "SELECT id, metadata->>'runtimeMode' AS metadata_runtime_mode FROM messages WHERE id = '$OUTBOUND_MESSAGE_ID';"
```

Optional queue visibility check:

```sh
curl -sS "$API_BASE/admin/queues" \
  -H "X-Api-Key: $ADMIN_API_KEY" \
  | jq '.queues[] | select(.name=="message-send") | .counts'
```

7. Validate rollout outcome:

- `runtime_mode = 'maf_primary'` in `runtime_attempts`;
- `phase` includes committed (`reply_committed`/`actions_committed`);
- outbound message metadata contains expected runtime fields;
- no unexpected fallback in the same run.

8. If any hard blocker appears, stop rollout and apply rollback path (`maf_runtime_disabled=true` or tenant denylist).

### Rollout Guardrails

- Do not roll out primary into tenants that still need canary-readiness evidence.
- Do not enable both tenant-level `maf_runtime_primary` and tenant-level `maf_runtime_shadow=true` for the same scope.
- Treat missing queue/DB checks in non-critical smoke as informational only if the step is explicitly allowed by the release lead.
- Treat evidence gaps around decision source or phase as rollout blockers until re-checked in logs and DB.

### One-Screen Triage

Run in order, stop immediately on the first **FAIL** item.

For local environments, the script auto-loads `.env` and uses these defaults:

- `API_BASE` defaults to `http://127.0.0.1:${API_PORT:-3000}/api/v1`;
- `TENANT_ID` defaults to `DEFAULT_TENANT_ID`;
- `ADMIN_API_KEY` is optional when `NODE_ENV` is not `production` (admin endpoints are development-unsafe in this mode);
- `DATABASE_URL`, `API_BASE`, and `TENANT_ID` are still required.

For explicit local smoke, these values come from:

- `API_BASE` — API host/port that you are testing (`API_PORT`/`API_BASE` in `.env` or CLI override).
- `TENANT_ID` — `DEFAULT_TENANT_ID` in `.env`, or tenant id you choose for test message scope.
- `ADMIN_API_KEY` — shared dev/admin API key (if set; local fallback is explicitly unsafe in dev and logs a warning).
- `DATABASE_URL` — your local Postgres DSN used by API/worker.
- `AGENT_SERVICE_INTERNAL_API_URL` — API base for context-tool calls, typically `http://127.0.0.1:${API_PORT}/api/v1` while running locally.
- `INTERNAL_SERVICE_AUTH_SECRET` / `AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET` — same shared secret; local default can be `agent-service-internal-secret-000000000000`.
- `FIELD_ENCRYPTION_KEY` — 64 hex chars (`32-byte` key) for envelope/token decrypt/encrypt.

Pre-conditions:

- `API_BASE` points to staging/prod API base (`/api/v1`) unless running local default
- `TENANT_ID`, `DATABASE_URL` are set (and `ADMIN_API_KEY` is recommended for non-local endpoints)
- `curl`, `jq`, and `psql` are available

```sh
# local default usage
bash scripts/maf-primary-rollout-triage.sh

# if context tool is enabled in API/agent-service, keep secrets aligned:
export INTERNAL_SERVICE_AUTH_SECRET=agent-service-internal-secret-000000000000
export AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET=$INTERNAL_SERVICE_AUTH_SECRET

# remote staging/prod mode (if ADMIN_API_KEY is required by that API)
export API_BASE TENANT_ID ADMIN_API_KEY DATABASE_URL
bash scripts/maf-primary-rollout-triage.sh
```

Interpretation:

- `ROLLBACK_READY=1` means proceed to next scope after collecting full queue/metadata checks.
- `ROLLBACK_READY=0` means stop rollout and apply rollback route.

## Shadow And Canary Gate Interpretation

Shadow diagnostics are the TypeScript-owned evidence source for canary readiness. A canary gate decision is usable only when it is based on current, redacted, tenant-scoped diagnostics with required migration baseline coverage, and the gate evidence matches the rollout tenant, user/workspace/cohort scope, runtime flag key, and gate configuration version being reviewed.

`canaryEnabled: true` means all of the following are true:

- the shadow readiness report status is `ready`;
- baseline gate evidence is present and valid;
- required migration cases are covered;
- no hard blockers are present;
- latency and estimated cost are within configured thresholds;
- diagnostics are fresh;
- sensitive memory false positives are absent;
- safety, privacy, and consent policy regression reason codes are absent.

These gate states are non-enabling:

- `blocked` - hard blocker present, including validation failure, comparison failure, redaction rejection, malformed diagnostic payload, baseline gate failure, critical risk false negative, duplicate action proposal, sensitive memory false positive, stale diagnostics, latency or cost threshold failure, risk suppression regression, escalation trigger regression, manager privacy regression, cohort minimum regression, survey consent regression, proactive consent regression, or GDPR deletion/export regression.
- `manual_review_required` - sensitive baseline scenarios or gate output require human review before rollout.
- `insufficient_data` - baseline gate summary, required migration coverage, metric evidence, or fresh diagnostics are missing.
- missing, unknown, unrecognized, or contradictory gate states are non-enabling and must be treated as `insufficient_data` or `blocked` until corrected.

Gate evidence must stay machine-readable and privacy-safe. Store stable reason codes, trace IDs, diagnostic IDs, sanitized scenario IDs, known migration case IDs, aggregate metrics, and counts. Do not store raw Slack/user text, prompts, tokens, secrets, full payloads, risk evidence, memory content, action payloads, provider errors, or stack traces.

## Fallback Barrier Behavior

Fallback is allowed only while the runtime-attempt barrier is open. The barrier is open before side effects, including phases `started`, `candidate_received`, and `actions_validated`. A `failed` phase is open only when no action commit marker and no reply commit marker exists for the attempt.

Runtime fallback is forbidden after `actions_committed` or `reply_committed`. At that point, retrying TypeScript as a fallback can duplicate actions, duplicate replies, or create inconsistent ledgers. If the barrier state is missing, malformed, or not a MAF runtime attempt, treat the barrier as `unknown` and block fallback until an operator or repair job resolves the ledger evidence.

## Ownership Transfer Rule

No Python writer may be added until an explicit ownership-transfer AD exists for the aggregate being moved. Until that AD exists, Python/MAF may return only proposals or commands, and TypeScript must validate, authorize, persist, and execute every side effect.

Protected aggregates and side-effect surfaces include:

- messages;
- risk signals;
- memory;
- goals;
- follow-ups;
- survey evidence;
- scheduled actions;
- runtime ledgers and action ledgers;
- runtime-control flags;
- shadow diagnostics;
- canary gate reports;
- migration baseline evidence;
- Slack sends.

An ownership-transfer AD must define:

- the aggregate source of truth before, during, and after transfer;
- the exact writer boundary and whether TypeScript, Python, or a shared service owns writes;
- idempotency keys and duplicate-prevention behavior;
- tenant authorization and workspace/user scope validation;
- audit trail fields and trace propagation;
- privacy, safety, consent, and cohort-minimum gates;
- fallback barrier behavior after partial success;
- cutover drain for in-flight jobs before the writer changes;
- writer lock or equivalent guard that prevents concurrent TypeScript and Python writes;
- reader compatibility across old and new records during rollout;
- explicit dual-write prevention checks;
- data migration or backfill steps;
- emergency rollback and backout plan;
- verification evidence required before enabling the new writer.

Stories that add Python writes without this AD must be rejected or rewritten as proposal-only stories. Proposal-only Python output remains allowed when TypeScript owns deterministic policy, validates the proposal, writes the aggregate, records the ledger, and sends any Slack message.

## Operator Checklist

- Confirm `maf_runtime_disabled` and `maf_runtime_user_denylist` are available before canary exposure.
- Confirm `maf_runtime_canary` targeting is scoped to the intended tenant, user, workspace, or percentage cohort.
- Confirm latest canary gate status is `ready` and `canaryEnabled: true`.
- Confirm no unresolved `blocked`, `manual_review_required`, or `insufficient_data` gate state exists for the canary scope.
- Confirm fallback remains forbidden after `actions_committed` or `reply_committed`.
- Confirm no Python writer exists for protected aggregates unless an explicit ownership-transfer AD has been accepted.
- Confirm rollback evidence can be shared without raw sensitive text.

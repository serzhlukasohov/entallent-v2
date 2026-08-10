# MAF Runtime Client

Story 5.1 introduced `MafAgentRuntimeClient` as a disabled TypeScript-side client surface for the future Python `agent-service` runtime. Story 5.5 opens the shadow-candidate path: `AgentRuntimeRouter` still returns the TypeScript runtime result as the user-facing reply, and invokes MAF only through `MafAgentRuntimeClient.processCandidate` when the resolved mode is exactly `maf_shadow`.

Story 9.1 enables user-facing `maf_canary` through the same primary execution path as `maf_primary`; side effects remain TypeScript-owned while rollout remains controlled by feature flags and gates.

## Python MAF Core Workflow

Story 7.1 replaces the hand-rolled Python workflow runner with Microsoft Agent
Framework core inside `agent-service`. The FastAPI route and OpenAPI contract
remain unchanged: TypeScript still calls `/runtime/process-message`, and Python
returns a contract-valid candidate `RuntimeResult`.

By default, the MAF core workflow remains deterministic for local and shadow
verification. It uses `agent-framework-core` graph workflow primitives to
execute the existing ordered conversation steps. Provider credentials, prompts,
and model calls are available only through the explicit opt-in path below; the
workflow still does not add streaming, `agent-framework-hosting`, or Python writes.

## Opt-In Python Model Execution

Story 7.2 adds a fast-track, opt-in model-provider path inside the Python
candidate runtime. When `AGENT_SERVICE_MODEL_PROVIDER` is unset or `disabled`,
the endpoint remains deterministic and returns `modelCalls: 0`. When configured
as `openai` or `azure_openai`, the response-generation step calls a Microsoft
Agent Framework `Agent` backed by an OpenAI-compatible chat client and returns a
contract-valid candidate result with `modelCalls: 1`.

This does not change TypeScript routing semantics. `maf_shadow` may record the
Python model candidate through `MafAgentRuntimeClient.processCandidate`, but the
worker still returns the TypeScript result to Slack in shadow mode. `maf_canary`
is now routed through the primary path and can be user-facing where rollout flags
allow it.

Python model-provider configuration is local to `agent-service`:

- `AGENT_SERVICE_MODEL_PROVIDER`: `disabled`, `openai`, or `azure_openai`.
- `AGENT_SERVICE_MODEL_NAME`: OpenAI model name or Azure deployment name.
- `AGENT_SERVICE_OPENAI_API_KEY` and optional `AGENT_SERVICE_OPENAI_ORG_ID`.
- `AGENT_SERVICE_AZURE_OPENAI_ENDPOINT`,
  `AGENT_SERVICE_AZURE_OPENAI_API_KEY`, and
  `AGENT_SERVICE_AZURE_OPENAI_API_VERSION`.
- `AGENT_SERVICE_MODEL_TIMEOUT_MS`: optional provider timeout.

For local convenience, the service also accepts existing unprefixed OpenAI and
Azure environment names. Deployment should prefer the `AGENT_SERVICE_*` names so
ownership is explicit.

Provider failures are fail-closed and redacted. Runtime error responses must not
include raw Slack/user text, prompts, bearer tokens, service secrets, full
payloads, provider error bodies, stack traces, memory content, risk evidence, or
action payloads.

`maf_shadow` may call this Python candidate path through
`MafAgentRuntimeClient.processCandidate`. `maf_canary` now uses the primary
execution path (`maf_primary`-style) and is user-facing when `maf_runtime_canary`
allows it, with the same fallback and side-effect ownership constraints.

## Local Live Model Validation

Story 8.1 adds a repeatable local smoke command for the Story 7.2 provider path:

```bash
cd agent-service
AGENT_SERVICE_MODEL_PROVIDER=openai \
AGENT_SERVICE_MODEL_NAME=gpt-4o \
AGENT_SERVICE_OPENAI_API_KEY=sk-... \
python scripts/live_model_smoke.py
```

Azure OpenAI uses the same command with:

- `AGENT_SERVICE_MODEL_PROVIDER=azure_openai`
- `AGENT_SERVICE_MODEL_NAME=<deployment-name>`
- `AGENT_SERVICE_AZURE_OPENAI_ENDPOINT`
- `AGENT_SERVICE_AZURE_OPENAI_API_KEY`
- `AGENT_SERVICE_AZURE_OPENAI_API_VERSION`

The smoke harness uses the existing Python app and `/runtime/process-message`
route. It validates the canonical runtime response and expects a live provider
success to report `diagnostics.modelCalls: 1`. Its output is redacted evidence
only: runtime version, trace ID, model/tool/retry counts, risk severity, action
count, memory candidate count, validation status, and reply digest/length.

This is a local or staging validation signal, not a routing change. It does not
record TypeScript-owned shadow diagnostics, send Slack replies, execute proposed
actions, persist memory/goals/follow-ups/risk, or alter production rollout flags.

## Local Shadow Path Validation

Story 8.2 adds a deterministic TypeScript-side validation helper for the
shadow path:

```typescript
await runMafShadowLocalValidation({
  request,
  currentRuntime: typeScriptRuntime,
  mafRuntime: new MafAgentRuntimeClient({
    serviceUrl: 'http://127.0.0.1:8001',
  }),
});
```

The helper forces `maf_shadow` inside `AgentRuntimeRouter`, returns the
TypeScript runtime result as the user-facing path, and records only redacted
candidate evidence. Tests inject `MafAgentRuntimeClient` with a local fetch mock,
so they prove the same canonical request/response validation without live
credentials or network access.

Valid evidence includes only allowlisted fields such as validation status, trace
ID, user-facing mode/intent/risk severity, candidate runtime version,
model/tool/retry counts, action count, memory candidate count, and stable
diagnostic reason codes/paths. It excludes raw request text, current reply text,
candidate reply text, prompts, secrets, provider bodies, memory content, risk
evidence, action payloads, and stack traces.

This is still candidate-only. It does not change worker routing semantics, deploy
agent-service, or replace the manual live-provider smoke command above.

## Live TypeScript-To-Python Shadow Smoke

Story 8.3 adds a one-command live shadow smoke:

```bash
pnpm maf:shadow:smoke
```

The command loads root `.env`, starts local `agent-service` on an ephemeral
loopback port, waits for `/health/live`, then runs the TypeScript shadow helper
through `MafAgentRuntimeClient` over HTTP. It proves this live boundary:

```text
TypeScript shadow validation -> MafAgentRuntimeClient -> HTTP
  -> Python agent-service -> Microsoft Agent Framework Agent -> model candidate
```

For local smoke convenience only, the command can infer:

- `AGENT_SERVICE_MODEL_PROVIDER=azure_openai` from existing `AZURE_OPENAI_*`
  environment variables.
- `AGENT_SERVICE_MODEL_PROVIDER=openai` from `OPENAI_API_KEY`.
- `AGENT_SERVICE_MODEL_NAME` from `OPENAI_MODEL_BALANCED`,
  `OPENAI_MODEL_GENERATION`, or `OPENAI_MODEL` when the canonical name is
  absent.

The command prints redacted evidence only. A valid live run must report
`status: "valid"`, `validationStatus: "contract_valid"`, and
`shadow.modelCalls: 1`. Any service startup failure, HTTP failure, invalid
contract result, or unexpected model-call count exits non-zero with stable
diagnostic evidence.

This remains candidate-only: the TypeScript result is still the user-facing path,
and the command does not mutate feature flags, send Slack messages, persist
Python-owned data, or deploy anything.

## Local Primary MAF Smoke

Story 9.1 adds an explicit `maf_primary` runtime mode for the fast cutover path.
Unlike `maf_shadow`, primary mode can make the Python MAF reply user-facing, but
TypeScript still owns durable side effects: the outbound message row is saved by
TypeScript, and the message-send, memory extraction, style analysis, and survey
evidence jobs are queued by TypeScript.

The local primary smoke command is:

```bash
pnpm maf:primary:smoke
```

It loads root `.env`, starts local `agent-service`, calls Python over HTTP
through `MafAgentRuntimeClient`, then passes the contract-valid Python result
through `MafPrimaryAgentRuntime`. The evidence is redacted and only reports
stable fields such as runtime version, model/tool/retry counts, risk severity,
and whether TypeScript saved/queued the expected side effects.

A valid run must report:

- `status: "valid"`
- `validationStatus: "contract_valid"`
- `primary.mode: "maf_primary"`
- `primary.modelCalls: 1`
- `primary.outboundMessageSaved: true`
- `primary.messageSendQueued: true`

This command uses in-memory TypeScript ports for local validation. It does not
write to the real database, send Slack messages, mutate feature flags, deploy
`agent-service`, execute Python-owned writes, or transfer aggregate ownership.

## App-Level Primary Runtime Smoke

Story 9.2 adds an end-to-end command that validates the full TypeScript/worker/API
runtime orchestration with a real database and queue:

```bash
pnpm maf:primary:app:smoke
```

It runs the real local flow:

- start `agent-service` locally (on a free loopback port) with provider/model config,
- start `@entalent/api` and `@entalent/worker` with `AGENT_SERVICE_INTERNAL_URL` set,
- toggle `maf_runtime_primary` on for the baseline tenant and ensure `maf_runtime_disabled` is off,
- post `/api/v1/dev/simulate-message`,
- wait for the outbound reply to appear in `/api/v1/dev/conversation/:conversationId/messages`,
- validate `messages.metadata.runtimeMode === "maf_primary"` and model/tool/retry counters,
- verify `runtime_attempts` contains a `maf_primary` attempt at phase `reply_committed` or `actions_committed`,
- verify `message-send` queue contains a non-failed job for the outbound message id.

The command prints redacted evidence and exits non-zero on precondition failures,
unexpected HTTP errors, queue gaps, missing DB evidence, or queue failures.

Current behavior: the shared `RuntimeResult` contract now includes a required
`classification` field, and Python runtime results should provide it directly. In
`maf_primary`, TypeScript treats that field as source-of-truth for
`ProcessMessageResult.classification` and does not inject a synthetic default.

### Staging/Prod-Like Remote Smoke

After local verification, use the same script against a non-local API by switching
it to remote mode:

```bash
MAF_PRIMARY_APP_SMOKE_REMOTE=1 \
MAF_RUNTIME_API_BASE=https://<host>[:port] \
pnpm maf:primary:app:smoke:remote
```

Environment requirements for remote mode:

- `DEFAULT_TENANT_ID` (required) must be present.
- `MAF_RUNTIME_API_BASE` should point at a reachable API base, e.g.:
  `https://staging.example.com/api/v1`.
- `ADMIN_API_KEY` for `/admin/...` endpoints and queue fallback.
- Optional: `MAF_PRIMARY_APP_SMOKE_CHECK_DB` (`1`/`0`) and
  `MAF_PRIMARY_APP_SMOKE_CHECK_QUEUE` (`1`/`0`) to force DB/queue checks when
  remote infra is partially available.
- Optional for queue checks without Redis: `REDIS_URL` (for direct BullMQ lookup)
  or `ADMIN_API_KEY` (for `/admin/queues` fallback).
- `MAF_PRIMARY_APP_SMOKE_REMOTE=1` disables local service startup and expects API,
  worker, DB, and queue to already exist.

Remote checks adapt to available env:

- If `MAF_PRIMARY_APP_SMOKE_CHECK_DB` is unset, DB checks are automatically
  enabled only when `DATABASE_URL` is present.
- If `MAF_PRIMARY_APP_SMOKE_CHECK_QUEUE` is unset, queue checks are automatically
  enabled when `REDIS_URL` or `ADMIN_API_KEY` is present.
- In remote mode, missing optional infra checks do not fail the smoke by default;
  they only mark evidence as `"not_checked"`/`null` and keep a valid run valid when
  requested checks succeed.
- If a check is explicitly requested and cannot be performed, the script fails with
  the corresponding reason (`redis_url_missing`, `admin_queue_check_failed`,
  `queue_lookup_failed`, etc.).

Output fields to expect in remote mode:

- `runtimeMetadataChecked` and `runtimeAttemptChecked` can be `false` when DB check
  is disabled.
- `messageSendQueueChecked` can be `false` when queue check is disabled.
- `messageSendQueueSource` is `redis`, `admin`, or `not_checked`.
- `messageSendJobFound` can be `null` when queue evidence is not requested.

## Configuration

The worker can construct the client without agent-service URL configuration. Missing configuration is evaluated when the runtime router selects a MAF candidate mode.

Optional environment variables:

- `AGENT_SERVICE_INTERNAL_URL` - preferred future worker-to-agent-service URL.
- `AGENT_SERVICE_URL` - compatibility alias used only when `AGENT_SERVICE_INTERNAL_URL` is not set.
- `AGENT_SERVICE_TIMEOUT_MS` - optional positive integer timeout.
- `INTERNAL_SERVICE_AUTH_SECRET` - future scoped service-auth secret; construction records only whether it is configured.

`AGENT_SERVICE_INTERNAL_URL` takes precedence over `AGENT_SERVICE_URL`. The client validates the selected URL as absolute `http:` or `https:` before any request.

## Primary Runtime Behavior

`maf_primary` is selected only by the dedicated runtime-control flag
`maf_runtime_primary`; it is not enabled by default. Existing precedence remains
fail-closed:

1. `maf_runtime_disabled`
2. tenant/user denylist
3. `maf_runtime_shadow`
4. `maf_runtime_primary`
5. `maf_runtime_canary`
6. TypeScript default

When `maf_primary` is selected, `AgentRuntimeRouter` invokes
`MafPrimaryAgentRuntime` before the TypeScript runtime. If Python MAF fails with
a safe pre-commit diagnostic such as missing config, invalid URL, HTTP failure,
invalid runtime response, or fetch failure, the router falls back through the
existing TypeScript fallback barrier.

If the primary adapter has already started TypeScript-owned durable work, errors
are not treated as safe fallback. This preserves the side-effect barrier and
avoids duplicate outbound replies.

## Shadow Candidate Behavior

For Story 5.5, `AgentRuntimeRouter` records the runtime decision, runs `TypeScriptAgentRuntime`, then invokes `MafAgentRuntimeClient.processCandidate` only for `maf_shadow`. The TypeScript result is returned unchanged even if MAF configuration, HTTP, response validation, or diagnostics persistence fails.

This story keeps shadow candidate execution on the inbound worker job path (in-process, awaited) to keep evidence capture aligned with the inbound reply cycle for this migration stage. The decision is explicit: candidate diagnostics are recorded before the job resolves, and the user-facing reply remains TypeScript-owned.

The worker enriches the runtime request with bounded canonical fields from TypeScript-owned data:

- message text and timestamp from the current tenant-scoped message row
- optional user display name, timezone, and locale from the user row
- Slack conversation identity, thread/session key, and trace identifiers
- bounded recent turns, with memory items and goals left empty in this story

The client validates the outgoing `RuntimeProcessMessageRequest` and the incoming `RuntimeResult` using the canonical OpenAPI schema from `@entalent/contracts`.

Candidate success and failure are recorded through `ShadowDiagnosticsRepository.recordShadowDiagnostics`. Candidate failures use `validationStatus: "invalid"` and safe reason codes/paths, which keeps canary readiness blocked while preserving the user-facing TypeScript reply.

Stable fail-closed reason codes:

- `maf_runtime_configuration_missing`
- `maf_runtime_configuration_invalid`
- `maf_runtime_url_invalid`
- `maf_runtime_boundary_request_invalid`
- `maf_runtime_response_invalid`
- `maf_runtime_http_failed`
- `maf_runtime_fetch_failed`

Diagnostics intentionally avoid service URLs, secrets, raw Slack/user text, HTTP response bodies, stack traces, and full request payloads. Raw current/candidate result objects are passed only to `ShadowDiagnosticsRepository`, which redacts sensitive fields before persistence.

## Canary Gate Evaluation

Story 6.1 adds canary gate evaluation on top of the existing TypeScript-owned shadow readiness report. The gate is a read-only decision helper: it does not mutate feature flags, enable staged rollout cohorts, or deploy `agent-service`.

The canary gate keeps `canaryEnabled: false` unless the shadow readiness report is `ready` and gate-specific thresholds pass. These states are non-enabled:

- `blocked` - hard blockers such as validation failure, comparison failure, redaction rejection, malformed diagnostic payloads, critical risk false negatives, duplicate action proposals, sensitive memory false positives, latency threshold failures, or cost threshold failures.
- `manual_review_required` - sensitive baseline scenarios or baseline gate output still require human review.
- `insufficient_data` - required baseline gate summary or required migration case coverage is missing.

Default local thresholds are deterministic: `maxLatencyMs: 5000`, `maxEstimatedCost: 0.05`, and `maxDiagnosticAgeMs: 86400000` (24 hours). Latency and cost gates use the metric `max` value so a single unsafe outlier cannot pass behind aggregate p95 behavior. Missing, invalid, negative, or stale metric evidence is fail-closed with `diagnostic_payload_malformed`, `insufficient_shadow_data`, or `stale_shadow_diagnostics`.

Gate inputs stay privacy-safe. The decision serializes report status, stable reason codes, IDs, counts, aggregate metrics, and threshold config only. It must not include raw response text, prompts, bearer tokens, service secrets, full current/candidate payloads, risk evidence snippets, memory content, action payloads, provider errors, or stack traces.

`maf_canary` is evaluated through the primary path and can return user-facing
results under controlled rollout; the gate still blocks readiness when required
safety/privacy/consent or stability criteria fail.

## Safety, Privacy, And Consent Canary Blockers

Story 6.3 extends the canary gate with deterministic policy-regression reason codes carried through `validationDetails.reasonCodes`. These codes are treated as hard blockers:

- `risk_suppression_regression` - MAF weakens survey/proactive suppression when risk is present.
- `escalation_trigger_regression` - MAF misses or weakens critical/immediate escalation behavior.
- `manager_privacy_regression` - MAF exposes or proposes exposing individual conversation content to manager analytics.
- `cohort_minimum_regression` - MAF weakens server-enforced manager analytics cohort minimum behavior.
- `survey_consent_regression` - MAF weakens survey opt-in/opt-out behavior.
- `proactive_consent_regression` - MAF weakens proactive messaging opt-in/opt-out behavior.
- `gdpr_deletion_export_regression` - MAF weakens TypeScript ownership of deletion/export behavior.

Policy blocker evidence is limited to allowlisted stable reason codes plus diagnostic ID, trace ID, sanitized scenario ID, and known migration case IDs. Gate reports and decisions must still exclude raw Slack/user text, prompts, bearer tokens, service secrets, full payloads, risk evidence, memory content, action payloads, provider errors, and stack traces. Unrecognized, unstable, or token-like reason codes remain `redaction_rejected` blockers rather than report evidence. Invalid scenario or migration case evidence is omitted and fails closed.

## Staged Canary Rollout Controls

Story 6.2 adds deterministic canary targeting to the existing runtime-control feature flags. It now controls where the user-facing primary-style `maf_canary` path is active, while rollback and hard-deny controls remain immediate.

`maf_runtime_canary` uses the existing `feature_flags` row shape:

- `enabled` must be `true`.
- Tenant-specific rows override global rows. A disabled tenant row disables that tenant even if a global row is enabled.
- `metadata.internalUserIds`, `metadata.canaryUserIds`, or `metadata.userIds` target explicit internal/canary users.
- `metadata.externalWorkspaceIds`, `metadata.workspaceIds`, or `metadata.canaryWorkspaceIds` target explicit Slack/workspace IDs.
- If no user/workspace allowlist metadata is present, `rolloutPercentage` selects a stable user bucket.

Malformed canary metadata fails closed. The global kill switch `maf_runtime_disabled` and user denylist `maf_runtime_user_denylist` keep precedence over shadow and canary targeting, so rollback remains immediate.

## Rollback And Ownership Transfer

Story 6.4 adds the operator runbook for rollback and future aggregate ownership changes: [docs/maf-runtime-rollout-runbook.md](./maf-runtime-rollout-runbook.md). It documents kill switch order, runtime precedence, fallback barrier interpretation, shadow/canary gate states, emergency rollback evidence, and the rule that Python writers require an explicit ownership-transfer AD before any protected aggregate moves out of TypeScript ownership.

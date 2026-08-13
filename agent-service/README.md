# agent-service

Python/FastAPI service foundation for the future MAF runtime.

Current scope includes local scaffold, health/readiness, canonical runtime
contract validation, `POST /runtime/process-message`, a Microsoft Agent
Framework core workflow, an opt-in MAF Agent model-provider path for local or
staging candidate testing, scoped internal service auth primitives, a read-only
TypeScript context tool client, and runtime state primitives for future MAF
session and checkpoint data.

Out of scope for the current migration slice:

- Python-to-TypeScript command tools or write APIs
- Redis/Postgres-backed session or checkpoint storage
- TypeScript-owned user-facing MAF reply writes
- changing TypeScript routing semantics for side-effect ownership
- actual Railway deployment or production service mutation
- shadow/canary execution and dashboard/admin UI

## Local Setup

Use Python 3.13.x.

```bash
cd agent-service
python3.13 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

## Run

```bash
python -m uvicorn agent_service.main:create_app --factory --host 127.0.0.1 --port 8001
```

## End-to-End Migration Smoke (local)

After API + worker are configured to use `agent-service` as the primary runtime,
run the full shell smoke from repository root:

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5434/entalent
export REDIS_URL=redis://127.0.0.1:6380
export TENANT_ID=7d1e0163-6d53-4713-bd24-254690cc5090
export FIELD_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
export INTERNAL_SERVICE_AUTH_SECRET=agent-service-internal-secret-000000000000
export AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET=$INTERNAL_SERVICE_AUTH_SECRET
export AGENT_SERVICE_INTERNAL_API_URL=http://127.0.0.1:3000/api/v1
export AGENT_SERVICE_MODEL_PROVIDER=azure_openai # or openai
export AGENT_SERVICE_MODEL_NAME=gpt-5.4-mini

pnpm run maf:live:bootstrap
```

Useful local skip modes:

- `SKIP_SERVICES=1` — do not try to start Docker containers.
- `SKIP_MIGRATE=1` — skip DB schema migration.
- `SKIP_BUILD=1` — skip rebuilding all dependent TS packages before smoke.
- `SKIP_INFRA_CHECKS=1` — skip Postgres/Redis readiness and migration step.
- `SKIP_SMOKE=1` — skip the final e2e API/API+worker+agent-service smoke run.

If Postgres/Redis are remote or on non-default ports, set `DATABASE_URL` and
`REDIS_URL` explicitly; bootstrap now reads host/port from those values.

Liveness:

```bash
curl http://127.0.0.1:8001/health/live
```

Readiness:

```bash
curl http://127.0.0.1:8001/health/ready
```

Readiness validates service settings and the selected runtime state backend.
It can fail with HTTP 503 while `/health/live` still returns healthy.

## Local Slack End-to-End Verification (legacy flow)

When you want the pre-2026 path with Slack + ngrok:

1. Keep local runtime values from the block above, plus Slack credentials:
   - `SLACK_TEST_TEAM_ID` (Slack workspace/team ID)
   - `SLACK_SIGNING_SECRET`
   - `SLACK_BOT_TOKEN`
   - `SLACK_TEST_CHANNEL_ID` (channel that should receive the bot reply)
   - `SLACK_TEST_USER_ID` (Slack user id that sends the test message)
2. Start the local stack and push one signed Slack event:

```bash
export SLACK_TEST_TEAM_ID=T12345678
export SLACK_SIGNING_SECRET=...
export SLACK_BOT_TOKEN=xoxb-...
export SLACK_TEST_CHANNEL_ID=...
export SLACK_TEST_USER_ID=...
export SLACK_TEST_TEXT="Smoke check: one concise sentence."
export SLACK_PUBLIC_URL=http://127.0.0.1:${API_PORT:-3000}   # or your ngrok URL

pnpm run maf:live:slack:smoke
```

If you are using ngrok, point the Slack app event subscription URL to:

```text
https://<your-ngrok-host>/api/v1/channel/slack/events
```

The script does:
- optional bootstrap prep (`maf:live:bootstrap` with `SKIP_SMOKE=1`)
- upserts workspace credentials (`scripts/setup-slack-workspace.mjs`)
- starts local `agent-service`, `api`, and `worker` in-process
- posts a signed `event_callback` payload
- validates inbound/outbound message persistence and runtime attempt evidence:
  - inbound message record
  - outbound message with matching `traceId`
  - `runtime_attempts` record and failure reason

Useful flags:

- `BOOTSTRAP_PREP=0` — do not run bootstrap preflight
- `SKIP_EVENT_SEND=1` — only validate stack boot + workspace config
- `SLACK_PUBLIC_URL` — local or ngrok public base URL used for event URL
- `POLL_SECONDS` — how long to wait for worker runtime evidence (default `40`)

Set `API_BASE` if you need the script to query dashboard/dev routes manually
against a non-default host.

Runtime MAF core workflow:

```bash
curl -X POST http://127.0.0.1:8001/runtime/process-message \
  -H 'content-type: application/json' \
  --data @../packages/contracts/runtime/fixtures/valid/process-message-request.json
```

The runtime endpoint validates requests against
`packages/contracts/runtime/openapi.json` and runs a Microsoft Agent Framework
core workflow with these steps:

1. load context
2. classify intent
3. detect risk
4. extract memory
5. apply deterministic policy
6. generate response
7. plan follow-up
8. validate actions
9. prepare result

By default the workflow returns a contract-valid `RuntimeResult` with a
deterministic candidate reply, `riskAssessment`, bounded `memoryCandidates`,
proposal-only memory/goal/follow-up action envelopes, zero model calls, and
coherent retry diagnostics. Proposed actions use the canonical envelope and stay
uncommitted: `executionStatus` is `not_started` or `blocked`, and `commitMarker`
is `null`. Python does not persist memory, goals, follow-ups, ledgers, Slack
replies, or other domain side effects.

Deterministic policy is applied before the result is returned. Risk signals that
require survey blocking or proactive-message pause are represented through
`riskAssessment` flags and blocked follow-up proposals with stable
`validationResult.reasonCodes`; the runtime diagnostics object remains limited
to the OpenAPI-defined fields.

Invalid requests return the canonical
`RuntimeErrorResponse` shape with `validation_error`, `retryable: false`, and
`fallbackAllowed: false`. Workflow failures return a redacted canonical error
without raw request payloads, stack traces, prompts, bearer tokens, or secrets.

## Opt-In MAF Agent Model Path

Story 7.2 adds an opt-in model-provider path for local or staging tests. It uses
Microsoft Agent Framework `Agent` primitives around an OpenAI-compatible chat
client. The default remains deterministic and requires no model credentials.

Direct OpenAI:

```bash
export AGENT_SERVICE_MODEL_PROVIDER=openai
export AGENT_SERVICE_MODEL_NAME=gpt-4o
export AGENT_SERVICE_OPENAI_API_KEY=sk-...
```

Azure OpenAI:

```bash
export AGENT_SERVICE_MODEL_PROVIDER=azure_openai
export AGENT_SERVICE_MODEL_NAME=<deployment-name>
export AGENT_SERVICE_AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com
export AGENT_SERVICE_AZURE_OPENAI_API_KEY=...
export AGENT_SERVICE_AZURE_OPENAI_API_VERSION=2024-10-21
```

Optional:

- `AGENT_SERVICE_MODEL_TIMEOUT_MS`: provider HTTP timeout, default `10000`.
- `AGENT_SERVICE_OPENAI_ORG_ID`: direct OpenAI organization header.
- `AGENT_SERVICE_LLM_SAFETY_MODE`: `disabled`, `inspect_only`, or `block`;
  default `disabled`.
- `AGENT_SERVICE_LLM_SAFETY_PROVIDER`: `local` or `azure_prompt_shields`;
  default `local`.
- `AGENT_SERVICE_LLM_SAFETY_TIMEOUT_MS`: gateway provider timeout, default
  `2500`.

Azure AI Content Safety Prompt Shields can be enabled as the first managed
gateway provider:

```bash
export AGENT_SERVICE_LLM_SAFETY_MODE=inspect_only
export AGENT_SERVICE_LLM_SAFETY_PROVIDER=azure_prompt_shields
export AGENT_SERVICE_AZURE_CONTENT_SAFETY_ENDPOINT=https://<resource>.cognitiveservices.azure.com
export AGENT_SERVICE_AZURE_CONTENT_SAFETY_KEY=...
export AGENT_SERVICE_AZURE_CONTENT_SAFETY_API_VERSION=2024-09-01
```

The safety gateway inspects the candidate prompt before the MAF Agent call and
the normalized candidate reply before it is returned. `inspect_only` records
redacted verdict metadata and lets the model path continue. `block` skips the
model call or rejects the candidate reply when safety checks block content. If
Azure Prompt Shields is unavailable in `inspect_only`, the model path fails open
with a redacted provider-unavailable verdict. In `block`, missing Azure safety
configuration or provider failure maps to the existing safe dependency failure
path.

The service also accepts the existing unprefixed `OPENAI_API_KEY`,
`OPENAI_ORG_ID`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, and
`AZURE_OPENAI_API_VERSION` environment names for local convenience. Prefixed
`AGENT_SERVICE_*` variables are preferred for deployment.
For Content Safety, the service also accepts `AZURE_CONTENT_SAFETY_ENDPOINT`,
`AZURE_CONTENT_SAFETY_KEY`, and `AZURE_CONTENT_SAFETY_API_VERSION`.

When enabled, the response generation step calls the MAF Agent path and returns
`modelCalls: 1`. Provider configuration, HTTP, empty-output, and unsafe-output
failures map to safe canonical runtime errors. Error responses still exclude raw
Slack/user text, prompts, bearer tokens, service secrets, provider details,
stack traces, full payloads, risk evidence, memory content, and action payloads.
Safety gateway findings follow the same redaction rule: only reason/provider/
blocked metadata is retained for diagnostics.

This model path is still contract-only proposal output. TypeScript remains the
side-effect owner, and user-facing MAF replies are enabled only when TypeScript
routing flags explicitly select `maf_primary`/`maf_canary`.

## Local Live Model Smoke

Story 8.1 adds a local smoke command for the opt-in MAF Agent model path. It
uses the existing FastAPI app and `/runtime/process-message` route in-process,
so `uvicorn` does not need to be running. The command makes an outbound provider
call only after required model env vars are present.

Direct OpenAI:

```bash
cd agent-service
export AGENT_SERVICE_MODEL_PROVIDER=openai
export AGENT_SERVICE_MODEL_NAME=gpt-4o
export AGENT_SERVICE_OPENAI_API_KEY=sk-...
python scripts/live_model_smoke.py
```

Azure OpenAI:

```bash
cd agent-service
export AGENT_SERVICE_MODEL_PROVIDER=azure_openai
export AGENT_SERVICE_MODEL_NAME=<deployment-name>
export AGENT_SERVICE_AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com
export AGENT_SERVICE_AZURE_OPENAI_API_KEY=...
export AGENT_SERVICE_AZURE_OPENAI_API_VERSION=2024-10-21
python scripts/live_model_smoke.py
```

With missing config, the command exits without a provider call and prints only
the missing config key names. With valid config, it prints redacted JSON evidence
including runtime version, trace ID, model/tool/retry counts, risk severity,
action count, memory candidate count, validation status, and reply digest/length.
It does not print raw request text, raw candidate text, prompts, secrets,
provider bodies, stack traces, memory content, risk evidence, or action payloads.

The smoke result remains contract-candidate output. It does not send Slack
messages, persist domain data, or record shadow diagnostics. It also does not
change TypeScript routing flags.

## Internal Service Auth

Future Python-to-TypeScript tool calls use a short-lived scoped service token:

```text
v1.<base64url-json-claims>.<base64url-hmac-sha256-signature>
```

The Python helper signs claims with
`AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET` and service identity
`AGENT_SERVICE_INTERNAL_SERVICE_IDENTITY`. Claims include service identity,
tenant ID, workspace ID, read/command permissions, endpoint allowlist, `iat`,
`exp`, and optional trace ID.

Story 4.3 only adds token creation and TypeScript validation/audit primitives.
It does not call TypeScript APIs from `/runtime/process-message` and does not
add MAF tools.

## Read-Only Context Tool

Story 5.3 adds one TypeScript-owned internal endpoint for bounded MAF context
reads:

```text
POST /internal/maf/context/read
```

The endpoint is mounted in `apps/api`, guarded by
`RequireInternalServiceAuth({ permission: 'read' })`, and enforces tenant and
workspace scope from signed internal service claims. The request body carries
only IDs and bounded limits: `tenantId`, `workspaceId`, `userId`,
`conversationId`, optional `sessionKey`, and optional context limits. The
response contains bounded JSON-compatible context: user/style profile, active
memory, active goals, recent turn metadata with truncated previews, active
survey state, active risk signals, and safe diagnostics counts.

The Python tool client is configured with:

- `AGENT_SERVICE_INTERNAL_API_URL`: TypeScript API internal base URL
- `AGENT_SERVICE_CONTEXT_TOOL_TIMEOUT_MS`: explicit HTTP timeout in ms
- `AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET`: shared signing secret
- `AGENT_SERVICE_INTERNAL_SERVICE_IDENTITY`: service identity, default
  `agent-service`

`AGENT_SERVICE_INTERNAL_API_URL` must point to the API internal route root, for
example `http://api.railway.internal:3000/api/v1` on Railway production.

Missing URL or auth config does not break app construction, liveness, or the
default local MAF core workflow. It fails closed only when the context tool is
invoked. Authorization, validation, timeout, network, and malformed-response
failures map to fixed safe `ConversationWorkflowError` categories without raw
request payloads, bearer tokens, service secrets, stack traces, prompts, or full
tool responses.

This read-only tool does not enable TypeScript worker routing to MAF, successful
`MafAgentRuntimeClient` HTTP execution, command tools, shadow/canary execution,
deployment mutation, model calls, or candidate proposal persistence.

## Runtime State

Runtime session/checkpoint state is selected with:

- `AGENT_SERVICE_RUNTIME_STATE_BACKEND`: `memory` or `sqlite`
- `AGENT_SERVICE_RUNTIME_STATE_SQLITE_PATH`: SQLite file path for durable state
- `AGENT_SERVICE_NON_LOCAL_SHADOW_ENABLED`: rejects `memory` when true

`memory` is process-local and allowed only while non-local shadow is disabled.
`sqlite` persists JSON session/checkpoint objects across service restarts and is
the current durable backend for this foundation slice.

Story 4.4 only added state primitives. The current runtime MAF core workflow
still does not instantiate MAF sessions, checkpoints, provider tools, or durable
state.

## Deployment Envelope

The deployable service envelope is defined by:

- `agent-service/Dockerfile`
- `agent-service/.dockerignore`
- `agent-service/deployment.md`
- `agent-service/deployment/railway-service.toml`

The production start command is:

```bash
python -m uvicorn agent_service.main:create_app --factory --host 0.0.0.0 --port ${AGENT_SERVICE_PORT:-8001}
```

This metadata defines the intended Railway `agent-service` registration and the two
runtime URLs used by the next phase:

- `AGENT_SERVICE_INTERNAL_URL`: worker-to-agent-service runtime URL
- `AGENT_SERVICE_INTERNAL_API_URL`: agent-service-to-API context tool URL

It does not deploy the service, add `MafAgentRuntimeClient`, or enable
shadow/canary routing.

## Checks

```bash
python -m pytest
python -m ruff check .
python -m mypy src tests
cd ../packages/contracts && python3 runtime/validate_fixtures.py
```

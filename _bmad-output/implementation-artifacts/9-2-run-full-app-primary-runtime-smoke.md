---
baseline_commit: dce563c5366311a340b0b7f5c30ddddb34d81ad2
---

# Story 9.2: Run Full App-Level Primary Runtime Smoke

Status: done
Epic: 9 - Fast MAF Primary Cutover
Story ID: 9.2

## Story

As a migration owner,
I want a real application-level end-to-end primary-runtime smoke test,
so that we can prove a real `/dev/simulate-message` conversation flows through TypeScript-owned persistence/queueing while the reply text is sourced from Python MAF.

## Acceptance Criteria

1. Given `DEFAULT_TENANT_ID` exists in `.env`, `maf_runtime_primary` can be enabled and a conversation is enqueued through `/dev/simulate-message`, when the local app stack is running (`agent-service`, API, worker), then a real outbound message row is persisted in the database and appears in `/dev/conversation/:conversationId/messages`.
2. Given primary mode is enabled, when the smoke completes, then the outbound message metadata indicates TypeScript-owned primary metadata (`runtimeMode = "maf_primary"`) and includes runtime version/model/tool/retry counters.
3. Given worker enqueues `message-send`, when the smoke verifies the path end-to-end, then at least one message-send queue job exists for the outbound message id and the job state is not failed.
4. Given DB-backed ledgering is enabled, then the primary runtime attempt for the inbound trace is recorded with `runtimeMode = "maf_primary"` and at least `phase = 'reply_committed'`.
5. Given any precondition failure, unexpected HTTP failure, DB queue/path gap, or path timeout, then the smoke exits non-zero and returns redacted evidence.
6. Given a successful run, the output includes redacted, high-signal evidence for local verification without leaking secrets or raw conversation content.

## Tasks / Subtasks

- [x] Add an app-level primary smoke script and command.
  - [x] Start local `agent-service` with provider/model inference from root `.env`.
  - [x] Start API (`@entalent/api`) and Worker (`@entalent/worker`) with `AGENT_SERVICE_INTERNAL_URL` pointed at the local service.
  - [x] Enable `maf_runtime_primary` via admin feature-flag endpoint and record previous state for restore.
  - [x] Send a synthetic conversation through `/api/v1/dev/simulate-message`.
  - [x] Poll `/api/v1/dev/conversation/:conversationId/messages` for the outbound reply.
  - [x] Validate persisted outbound metadata from DB (`messages.metadata`).
  - [x] Validate runtime attempt state from DB (`runtime_attempts`).
  - [x] Validate message-send queue job presence for outbound message.
- [x] Add a command in root `package.json` for one-command execution.
- [x] Add docs describing sequence and interpretation of evidence in `docs/maf-runtime-client.md`.
- [x] Add/adjust migration checks so `runtime_attempts.runtime_mode` accepts `maf_primary` before long-running DB-backed primary runs.
- [x] Update story and tracking state after completion.

## Out Of Scope

- Any UI/dashboard feature flag management flow (admin API usage is sufficient for test scripts).
- Production deployment/rollback orchestration.
- Additional ownership transfer of aggregates from TypeScript to Python.
- Any canary/staged rollout change beyond local, explicit primary smoke.

## Testing Requirements

- Live smoke should be run after a successful `pnpm maf:shadow:smoke`.
- The new script must run in the local developer environment with a running PostgreSQL and Redis from existing `.env` URLs.
- The script should not print secrets, raw message text, provider bodies, or stack traces.

### Current Verification Command

- `pnpm maf:primary:app:smoke`

## Latest Verification Evidence

- `./scripts/maf-live-bootstrap.sh` run on `2026-08-07` completed successfully with `SMOKE_OK`.
- Runtime evidence captured:
  - `runtime_attempts: maf_primary,reply_committed,...`
  - `runtimeVersion: "agent-service-maf-core/1.13.0"`
  - `recent_context_auth` includes `internal_tool_call.authorized` for `/api/v1/internal/maf/context/read`.
- `./scripts/maf-live-bootstrap.sh` run on `2026-08-08` completed successfully with `SMOKE_OK`.
  - `traceId: 8967ee76-ab4b-47fd-8e5f-11172cc9edef`
  - `runtime_attempts: maf_primary,reply_committed,...`
  - `toolCalls: 1`, `modelCalls: 1`, `retryCount: 0`
  - `runtimeVersion: "agent-service-maf-core/1.13.0"`
  - `recent_context_auth: authorized` for `/api/v1/internal/maf/context/read` with `workspaceId="dev-workspace"`.
- `./scripts/maf-live-bootstrap.sh` run on `2026-08-08` completed successfully with `SMOKE_OK`.
  - `traceId: 9ff21765-4b33-4edc-a9e6-669d92434e7b`
  - `runtime_attempts: maf_primary,reply_committed,...`
  - `toolCalls: 1`, `modelCalls: 1`, `retryCount: 0`
  - `runtimeVersion: "agent-service-maf-core/1.13.0"`
  - `recent_context_auth: internal_tool_call.authorized` for `/api/v1/internal/maf/context/read`, `workspaceId="dev-workspace"`, `serviceIdentity="agent-service"`.

## Dev Notes

- `Conversation orchestration remains TypeScript-owned`; this command validates runtime routing, persistence, and queue enqueue evidence through the real API/worker boundary.
- Keep timeouts bounded and cleanup robust: terminate API/worker/agent-service processes even on failures.
- Restore feature-flag state even if script fails mid-run.

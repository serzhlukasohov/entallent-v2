---
baseline_commit: dce563c
---

# Story 5.1: Add Disabled `MafAgentRuntimeClient`

Status: done
Epic: 5 - MAF Conversation Workflow Candidate
Story ID: 5.1

## Story

As an engineer,
I want a disabled MAF HTTP client implementation,
so that the router can reference the future runtime without enabling behavior.

## Acceptance Criteria

1. Given MAF runtime mode is not enabled, when the worker starts, then `MafAgentRuntimeClient` construction does not require `AGENT_SERVICE_URL` or `AGENT_SERVICE_INTERNAL_URL`.
2. Given MAF runtime mode is enabled without required configuration, when the router evaluates the job, then it fails closed to TypeScript and records a configuration diagnostic.
3. Given the current `AgentRuntimePort.ProcessMessageRequest` lacks a strict runtime-boundary field, when MAF mode is selected, then the client/router must fail closed before any HTTP call and must not fabricate placeholder request fields.
4. Given this story is complete, when the diff is inspected, then no MAF workflow or tools, read-only context tools, Python runtime behavior beyond the existing skeleton, non-local shadow execution, canary behavior, domain aggregate write path, deployment mutation, or dashboard/admin UI has been added.

## Tasks / Subtasks

- [x] Add disabled `MafAgentRuntimeClient` implementation under `packages/application`. (AC: 1, 2, 3, 4)
  - [x] Create `packages/application/src/use-cases/maf-agent-runtime-client.ts`.
  - [x] Implement `AgentRuntimePort` so the future router can depend on the same port shape.
  - [x] Constructor must accept optional config; it must not require a service URL while MAF mode is disabled.
  - [x] Use injected `fetch` or Node 22 global `fetch`; do not add axios/got/request or another HTTP dependency.
  - [x] Keep HTTP execution unreachable unless all required config and strict runtime-boundary fields are present.
- [x] Add MAF client configuration surface without enabling behavior by default. (AC: 1, 2, 4)
  - [x] Add optional config fields for service URL, timeout, and future service-auth secret/identity only where they are actually consumed.
  - [x] Prefer the Epic 4 deployment name `AGENT_SERVICE_INTERNAL_URL`; if `AGENT_SERVICE_URL` is kept for compatibility with Epic 5 wording, document the precedence and tests.
  - [x] Validate service URL as absolute `http:` or `https:` before any request.
  - [x] Keep missing config local/test compatible and fail closed only when a MAF mode is selected.
- [x] Resolve the strict runtime-boundary request shape for this disabled-client slice. (AC: 2, 3)
  - [x] Do not make `requestId`, `eventId`, or `runtimeAttempt` globally required on `ProcessMessageRequest` unless every current caller is updated safely.
  - [x] Add a MAF-client preflight helper that requires non-empty `requestId`, non-empty `eventId`, positive-integer `runtimeAttempt`, non-empty `traceId`, and all fields needed to derive idempotency diagnostics.
  - [x] If the current request shape still cannot build canonical `RuntimeProcessMessageRequest` because message text, timestamps, session key, or context are absent, return a stable fail-closed diagnostic instead of faking values.
  - [x] Use stable reason codes such as `maf_runtime_configuration_missing`, `maf_runtime_url_invalid`, and `maf_runtime_boundary_request_invalid`.
- [x] Wire the router to know about the disabled MAF client without changing user-facing runtime behavior. (AC: 1, 2, 4)
  - [x] Extend `AgentRuntimeRouter` options to accept an optional MAF runtime/client and optional configuration-diagnostic recorder.
  - [x] Keep `typescript` and `maf_disabled` decisions delegating directly to `TypeScriptAgentRuntime`.
  - [x] For `maf_shadow` or `maf_canary` decisions in this story, route to TypeScript when the MAF client is not configured or preflight fails.
  - [x] Record the decision and safe diagnostic before delegating to TypeScript.
  - [x] Do not execute shadow comparison, persist shadow diagnostics, or call Python in normal disabled/missing-config tests.
- [x] Add focused TypeScript tests. (AC: 1-4)
  - [x] Test worker/module startup does not need `AGENT_SERVICE_URL` or `AGENT_SERVICE_INTERNAL_URL` while MAF mode is disabled.
  - [x] Test `maf_shadow` and `maf_canary` decisions with missing URL fail closed to TypeScript and record a configuration diagnostic.
  - [x] Test invalid URL fails closed before fetch.
  - [x] Test missing `requestId`, `eventId`, or invalid `runtimeAttempt` fails closed before fetch.
  - [x] Test no raw Slack/user text, HTTP response body, bearer token, service secret, or full payload is logged or recorded in diagnostics.
  - [x] Test the client is exported from `@entalent/application` only as the intended runtime client surface.
  - [x] Add scope regression checks that no workflows/tools/read-only tool endpoints/shadow execution/canary/UI/domain writes were introduced.
- [x] Update developer docs. (AC: 1-4)
  - [x] Document the disabled-client behavior and required future env vars.
  - [x] Document that this story does not enable MAF execution, does not call Python in production paths, and does not add workflow/tools.
  - [x] Document the strict runtime-boundary gap and the fail-closed behavior until the canonical request can be built honestly.
- [x] Update implementation tracking. (AC: 1-4)
  - [x] Update this story's Dev Agent Record during implementation.
  - [x] Move sprint status from `ready-for-dev` to `in-progress` during dev-story and to `review` when implementation is complete.
- [x] Run and record verification. (AC: 1-4)
  - [x] Run `pnpm --filter @entalent/application test -- src/use-cases/maf-agent-runtime-client`.
  - [x] Run `pnpm --filter @entalent/application test -- src/use-cases/agent-runtime-router`.
  - [x] Run `pnpm --filter @entalent/application typecheck`.
  - [x] Run `pnpm --filter @entalent/application lint`.
  - [x] Run `pnpm --filter @entalent/config typecheck` and lint if config changes.
  - [x] Run `pnpm --filter @entalent/worker test -- src/conversation/conversation.module`.
  - [x] Run `git diff --check`.

### Review Findings

- [x] [Review][Patch] MAF diagnostic provider/recorder failures could block TypeScript fallback [`packages/application/src/use-cases/agent-runtime-router.ts:105`]
- [x] [Review][Patch] MAF diagnostic recorder received the full runtime request instead of only the safe diagnostic [`packages/application/src/use-cases/agent-runtime-router.ts:48`]
- [x] [Review][Patch] Service URL validation used a regex instead of URL parsing [`packages/application/src/use-cases/maf-agent-runtime-client.ts:128`]
- [x] [Review][Patch] Unused `serviceIdentity` option was added without a consumer [`packages/application/src/use-cases/maf-agent-runtime-client.ts:30`]
- [x] [Review][Patch] Invalid `AGENT_SERVICE_TIMEOUT_MS` was silently ignored [`apps/worker/src/conversation/conversation.module.ts:272`]
- [x] [Review][Patch] Broad file-level lint suppressions were added to unrelated application tests [`packages/application/src/use-cases/conversation-orchestrator.test.ts:1`]

## Dev Notes

### Current Architecture Context

- Epic 5 starts the MAF candidate path, but Story 5.1 is still disabled-client infrastructure. It must not make Python user-facing.
- AD-1 keeps `AgentRuntimePort.processMessage` as the runtime boundary. Worker processors and Slack handlers must not depend on Python, FastAPI, or MAF types.
- AD-2 keeps TypeScript as side-effect owner. The client must not write memory, goals, risk signals, scheduled actions, messages, surveys, manager analytics, runtime actions, or domain aggregates.
- AD-4 says first transport is JSON HTTP. Do not introduce SSE, token streaming, WebSocket, or long-running streaming concerns.
- AD-5 and AD-15 require fallback to stop at the first side effect and depend on runtime attempt/action ledgers. Story 5.1 should fail before any MAF HTTP side effect, so fallback remains TypeScript-safe.
- AD-13 says runtime router owns mode selection. Do not bind a concrete runtime at process start based only on environment variables.
- AD-14 keeps `packages/contracts/runtime/openapi.json` as the canonical runtime HTTP schema. TypeScript and Python validators already consume shared fixtures.
- AD-16 scoped service auth exists as a primitive from Story 4.3. Do not call TypeScript tools from this story.
- AD-18 shadow diagnostics are TypeScript-owned, but Story 5.1 must not start recording candidate/current comparisons. Only safe configuration diagnostics for fail-closed selection are in scope.
- AD-19 service envelope exists from Story 4.5. Real Railway deployment and writable-volume verification remain operational work before non-local shadow execution.

### Existing Repo State

- `packages/application/src/ports/agent-runtime.port.ts` currently has `requestId?`, `eventId?`, and `runtimeAttempt?` as optional for compatibility.
- `apps/worker/src/conversation/conversation.processor.ts` provides `requestId`, `eventId`, and `runtimeAttemptNumberFromJob(job)` for inbound conversation jobs.
- `apps/worker/src/conversation/conversation.module.ts` records runtime ledger attempts only when `requestId`, `eventId`, and `runtimeAttempt` exist, and currently wires `AGENT_RUNTIME_PORT` to `AgentRuntimeRouter` with only `TypeScriptAgentRuntime`.
- `AgentRuntimeRouter` currently logs and records decisions but always delegates `processMessage` to `TypeScriptAgentRuntime`.
- `AgentRuntimeModeResolver` already returns `maf_shadow` and `maf_canary` decisions from runtime control flags; Story 5.1 must ensure those decisions still fail closed when the MAF client/config is unavailable.
- `runtime-error-classifier.ts` already has stable error categories and retry/fallback diagnostics. Reuse its reason-code style; do not create raw-text diagnostic payloads.
- `packages/contracts/src/runtime-contract.ts` defines canonical `RuntimeProcessMessageRequest`, but current `ProcessMessageRequest` does not contain enough data to build it: message text, message created time, session key, recent turns, memory items, and goals are absent.
- `agent-service` already exposes `/runtime/process-message` and `/health/ready`, but the runtime endpoint is still a not-implemented skeleton. Story 5.1 must not depend on a live Python service for tests.

### Strict Runtime-Boundary Decision For Story 5.1

The strict request shape is not fully available at the TypeScript runtime port yet. Story 5.1 must document and enforce this instead of hiding it:

- `requestId`, `eventId`, and `runtimeAttempt` are required for any MAF HTTP attempt.
- The canonical HTTP request also requires `idempotencyKey`, `tenant`, `user`, `conversation.sessionKey`, `message.text`, `message.createdAt`, and `context`.
- Because those fields are not all present on `ProcessMessageRequest`, Story 5.1 should not fabricate placeholder canonical HTTP payloads.
- The correct disabled-client behavior is: when MAF mode is selected but required config or strict request fields are missing, record a stable configuration diagnostic and delegate to TypeScript.
- A later Epic 5 story must add the real request builder/context loading before successful Python execution is allowed.

### Recommended File Structure For Story 5.1

```text
packages/application/src/use-cases/
  maf-agent-runtime-client.ts
  maf-agent-runtime-client.test.ts
  agent-runtime-router.ts
  agent-runtime-router.test.ts
packages/application/src/index.ts
packages/config/src/env.ts
apps/worker/src/conversation/
  conversation.module.ts
  conversation.module.test.ts
```

Adjust only if implementation shows a smaller local pattern. Keep the client in `packages/application`, not `apps/worker`, so the router can depend on the port boundary.

### Client Behavior Guidance

- Constructor should be safe without URL/config.
- `processMessage()` may throw a typed/stable configuration error when called without config or strict boundary fields.
- Prefer returning or throwing stable machine-readable failure details over free-form raw errors.
- If HTTP support is included behind config, it must:
  - POST JSON to `/runtime/process-message`.
  - Validate successful responses with `validateRuntimeResult`.
  - Validate error responses with `validateRuntimeErrorResponse` before classification.
  - Use `AbortSignal.timeout()` or injected abort behavior for deterministic timeout tests.
  - Map HTTP/network failures to existing runtime error codes without exposing raw response bodies.
- Tests for this story should not require a running `agent-service`. Use injected fetch stubs.

### Env Var Guidance

Use optional env only:

- `AGENT_SERVICE_INTERNAL_URL` - preferred by Story 4.5 deployment envelope for future worker-to-service calls.
- `AGENT_SERVICE_URL` - optional compatibility alias only if needed by Epic 5 wording; if used, document precedence.
- `AGENT_SERVICE_TIMEOUT_MS` - optional positive integer timeout.

Do not require these at worker startup while MAF runtime is disabled. Missing or invalid values should become fail-closed diagnostics only when `maf_shadow` or `maf_canary` is selected.

### Out Of Scope

- MAF workflow, agents, or tools
- read-only context tools
- Python tool calls to TypeScript
- successful non-local shadow execution
- candidate/current shadow diagnostics persistence
- canary behavior or rollout gates
- dashboard/admin UI
- Railway deploy commands or production service mutation
- direct writes to memory, goals, risk records, scheduled actions, messages, surveys, manager analytics, runtime action commit paths, or domain aggregates
- broad `ProcessMessageRequest` breaking changes that force unrelated callers to update outside this story

### Previous Epic Intelligence

- Epic 4 review repeatedly found meaningful fail-closed gaps. Story 5.1 should add tests for missing config, invalid URL, missing strict fields, and redacted diagnostics before implementation.
- Story 4.2 proved the Python runtime endpoint can validate the canonical OpenAPI contract but only returns a stub.
- Story 4.3 added internal auth primitives and sanitized audit projection; keep them detached from the client until read-only tools exist.
- Story 4.4 made runtime state fail closed for non-local shadow with process-local memory and added session-key primitives, but the TypeScript request does not yet carry a Python session key.
- Story 4.5 defined deployment metadata and preferred `AGENT_SERVICE_INTERNAL_URL`, but did not mutate Railway services.
- Epic 4 retrospective action E4-A1 explicitly requires resolving or documenting the strict runtime-boundary request shape before Story 5.1 introduces `MafAgentRuntimeClient`.

### Latest Technical Notes

- The repo targets Node 22 for deploy images and has `@types/node` 22 in the relevant packages.
- Node.js 22 documentation lists global `fetch`, `Request`, `Response`, `Headers`, `AbortController`, and `AbortSignal.timeout()` as available; `fetch` is stable in Node 22. Use these instead of adding an HTTP client dependency.
- CodeGraph was initialized for this repo during Story 5.1 context creation. Use `codegraph explore` or `codegraph node` before grep/find when locating code.

### Testing Requirements

- Tests must be local and deterministic.
- Do not require a running Python service, Docker daemon, Railway CLI, Redis, Postgres, Slack, Azure, LangWatch, OpenAI, or model credentials.
- Prefer Vitest unit tests with injected `fetch`/logger/diagnostic recorder.
- Verify `AgentRuntimeRouter` still delegates all disabled/missing-config paths to `TypeScriptAgentRuntime`.
- Verify `MafAgentRuntimeClient` construction is side-effect free and does not read required URL at construction time unless config is explicitly passed.
- If `packages/contracts/runtime/openapi.json`, shared fixtures, or TypeScript contract validators change, run contracts tests sequentially before dependent application/worker checks.

### References

- `_bmad-output/planning-artifacts/epics.md` - Epic 5 Story 5.1 requirements and future Epic 5 sequence.
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md` - AD-1, AD-2, AD-4, AD-5, AD-13, AD-14, AD-15, AD-16, AD-18, AD-19.
- `_bmad-output/implementation-artifacts/epic-4-retro-2026-08-06.md` - Epic 4 lessons and E4 action items.
- `_bmad-output/implementation-artifacts/4-5-define-deployable-service-envelope.md` - deployment URL/env naming and readiness behavior.
- `packages/application/src/ports/agent-runtime.port.ts` - current runtime port shape and optional strict fields.
- `packages/application/src/use-cases/agent-runtime-router.ts` - router decision and delegation behavior to extend.
- `packages/application/src/use-cases/agent-runtime-router.test.ts` - existing router safety tests to preserve and extend.
- `packages/application/src/use-cases/runtime-error-classifier.ts` - existing runtime error mapping and safe diagnostics.
- `packages/contracts/src/runtime-contract.ts` - canonical runtime HTTP request/result/error types.
- `packages/contracts/src/runtime-contract-validation.ts` - TypeScript OpenAPI-backed runtime validation.
- `apps/worker/src/conversation/conversation.module.ts` - worker provider wiring and runtime ledger fields.
- `apps/worker/src/conversation/conversation.processor.ts` - inbound job request construction.
- `packages/config/src/env.ts` - optional worker/client env validation if config is added.
- Node.js 22 globals documentation: https://nodejs.org/download/release/v22.12.0/docs/api/globals.html

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story created after Epic 4 and Epic 4 retrospective were marked done in BMAD tracking.
- Loaded BMAD create-story workflow, config, sprint status, Epic 5 Story 5.1 requirements, architecture spine, Epic 4 retrospective, Story 4.5, runtime router/port/codegraph context, TypeScript runtime contract validators, worker provider wiring, config env schema, and current package scripts.
- No `project-context.md` was found.
- CodeGraph was initialized at repo root during this story creation after user approval; `codegraph status` reported 348 files, 3,663 nodes, 10,437 edges, and an up-to-date index.
- Web research checked official Node.js 22 globals documentation for built-in `fetch` and `AbortSignal.timeout()` availability.
- Strict runtime-boundary analysis found that current `ProcessMessageRequest` has optional `requestId`, `eventId`, `runtimeAttempt` and lacks full canonical HTTP request fields; Story 5.1 must fail closed rather than fabricate payload values.
- Dev-story implementation followed red/green/refactor: initial client/router/worker tests failed on missing `MafAgentRuntimeClient` and worker env helper, then passed after minimal disabled-client implementation.
- `@entalent/application` and `@entalent/config` were rebuilt locally because worker tests/typecheck consume package `dist` entrypoints.
- Full application lint initially exposed existing `no-explicit-any` test-file violations outside Story 5.1; lint-only file disables were added to existing tests and those tests were rerun.
- BMAD code review ran three layers: Blind Hunter, Edge Case Hunter, and Acceptance Auditor. Findings were triaged into six patch items, with no decision-needed or deferred items.
- Review fixes added best-effort diagnostic handling, removed full-request diagnostic recorder input, switched URL validation to runtime URL parsing, removed unused service identity config, surfaced invalid timeout config, and narrowed lint suppressions to exact legacy `any` lines.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Implemented disabled `MafAgentRuntimeClient` as an `AgentRuntimePort` with safe preflight diagnostics and no successful HTTP execution path while canonical request fields are unavailable.
- Added optional MAF client env surface and worker module construction helper; missing URL does not block worker/module construction.
- Extended `AgentRuntimeRouter` with optional MAF diagnostic source and configuration diagnostic recorder; `maf_shadow` and `maf_canary` fail closed to TypeScript with stable redacted diagnostics.
- Documented disabled behavior, env precedence, strict runtime-boundary gap, and out-of-scope surfaces in developer docs.
- Added tests for missing config, invalid URL, invalid strict fields, canonical request gap, redaction, package export surface, router diagnostics, and worker env helper behavior.
- Scope was kept to disabled client/router/config/docs/tests. No MAF workflow/tools, read-only tools, Python execution behavior, shadow comparison execution, canary rollout behavior, domain write path, deployment mutation, or UI was added.
- Verification passed:
  - `pnpm --filter @entalent/application test -- src/use-cases/maf-agent-runtime-client`
  - `pnpm --filter @entalent/application test -- src/use-cases/agent-runtime-router`
  - `pnpm --filter @entalent/application typecheck`
  - `pnpm --filter @entalent/application lint`
  - `pnpm --filter @entalent/config typecheck`
  - `pnpm --filter @entalent/config lint`
  - `pnpm --filter @entalent/worker test -- src/conversation/conversation.module`
  - `pnpm --filter @entalent/worker typecheck`
  - `git diff --check`
- Post-review verification passed:
  - `pnpm --filter @entalent/application test -- src/use-cases/maf-agent-runtime-client`
  - `pnpm --filter @entalent/application test -- src/use-cases/agent-runtime-router`
  - `pnpm --filter @entalent/application typecheck`
  - `pnpm --filter @entalent/application lint`
  - `pnpm --filter @entalent/application build`
  - `pnpm --filter @entalent/config typecheck`
  - `pnpm --filter @entalent/config lint`
  - `pnpm --filter @entalent/worker test -- src/conversation/conversation.module`
  - `pnpm --filter @entalent/worker typecheck`
  - `pnpm --filter @entalent/worker lint` (passed with existing `apps/worker/src/main.ts` console warning)
  - `git diff --check`

### File List

- `_bmad-output/implementation-artifacts/5-1-add-disabled-maf-agent-runtime-client.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/worker/src/conversation/conversation.module.ts`
- `apps/worker/src/conversation/conversation.module.test.ts`
- `docs/maf-runtime-client.md`
- `packages/application/src/index.ts`
- `packages/application/src/use-cases/agent-runtime-router.ts`
- `packages/application/src/use-cases/agent-runtime-router.test.ts`
- `packages/application/src/use-cases/conversation-orchestrator.test.ts`
- `packages/application/src/use-cases/maf-agent-runtime-client.ts`
- `packages/application/src/use-cases/maf-agent-runtime-client.test.ts`
- `packages/application/src/use-cases/profile-hydration.use-case.test.ts`
- `packages/application/src/use-cases/runtime-error-classifier.test.ts`
- `packages/application/src/use-cases/style-analysis.use-case.test.ts`
- `packages/application/src/use-cases/survey-evidence.use-case.test.ts`
- `packages/config/src/env.ts`

### Change Log

- 2026-08-06: Created Story 5.1 developer context from Epic 5, architecture spine, Epic 4 retrospective, Story 4.5 deployment envelope, CodeGraph runtime-router exploration, runtime contract types, worker wiring, and Node 22 official globals documentation.
- 2026-08-06: Implemented disabled `MafAgentRuntimeClient`, router fail-closed diagnostics, optional worker/config surface, docs, tests, and verification for Story 5.1.
- 2026-08-06: Completed BMAD code review, fixed six patch findings, reran verification, and marked Story 5.1 done.

---
baseline_commit: dce563c
---

# Story 5.3: Implement Read-Only Context Tools

Status: done
Epic: 5 - MAF Conversation Workflow Candidate
Story ID: 5.3

## Story

As an engineer,
I want MAF to read existing TypeScript context through scoped tools,
so that the Python workflow uses current product state without owning persistence.

## Acceptance Criteria

1. Given the workflow needs user profile, memory, goals, recent conversation summary, survey state, or risk context, when it calls a tool, then the tool uses scoped service auth and returns tenant-filtered data.
2. Given a read tool fails authorization or validation, when the workflow handles the failure, then it returns a safe runtime error and no side effect is attempted.
3. Given this story is complete, when the diff is inspected, then it adds only read-only context tooling and minimal workflow integration; it must not add Python-to-TypeScript command tools, TypeScript MAF activation, successful `MafAgentRuntimeClient` execution, shadow/canary execution, dashboard/admin UI, deployment mutation, or domain aggregate writes.
4. Given context tool responses or failures are logged, audited, returned, or included in diagnostics, then raw Slack/user text, prompts, bearer tokens, service secrets, full request payloads, and stack traces are not exposed.

## Tasks / Subtasks

- [x] Add a TypeScript internal read endpoint for MAF context. (AC: 1, 2, 3, 4)
  - [x] Create an API-owned module under `apps/api/src/internal-maf-context/`; do not import repository classes from `apps/worker`.
  - [x] Mount the module from `apps/api/src/app.module.ts`.
  - [x] Add one read-only endpoint, preferably `POST /internal/maf/context/read`, guarded by `RequireInternalServiceAuth({ permission: 'read' })`.
  - [x] Validate body fields for `tenantId`, `workspaceId`, `userId`, `conversationId`, optional `sessionKey`, and optional bounded limits. Reject malformed input with safe 400 responses.
  - [x] Enforce tenant/workspace scope from `request.internalServiceAuth`; do not trust caller-provided tenant/workspace fields alone.
  - [x] Return a bounded context bundle with user profile/style, active memory items, active goals, recent conversation summary/turn metadata, active survey window/state, and active risk signals when available.
  - [x] Tenant-filter every database query and keep the endpoint read-only: no inserts, updates, deletes, queues, outbox writes, audit raw body writes, or domain aggregate mutation.
- [x] Reuse existing shared schema and local patterns. (AC: 1, 3)
  - [x] Query via API `DatabaseService` and `@entalent/database` schema exports.
  - [x] Prefer the existing worker repository filtering semantics where they exist: active memory by user/tenant, active goals by user/tenant, active risk by user/tenant, current survey windows by user/tenant, style profile by user/tenant.
  - [x] Keep response DTOs JSON-compatible and date fields serialized as ISO 8601 strings.
  - [x] Keep sensitive raw message content out of the first endpoint response unless the story explicitly needs a bounded recent-turn summary; if recent turns are included, cap count and content length and test redaction/limits.
- [x] Add Python context tool client in `agent-service`. (AC: 1, 2, 3, 4)
  - [x] Add `agent-service/src/agent_service/tools/` with a focused read-only context tool/client.
  - [x] Use `create_internal_service_token` from `agent_service.infrastructure.internal_auth` with permission `read` and endpoint allowlist `("/internal/maf/context/read",)`.
  - [x] Add settings for the TypeScript internal API base URL and context tool timeout using the existing `AGENT_SERVICE_` prefix. Missing config must fail closed only when the tool is invoked.
  - [x] Use an async HTTP client with explicit timeout and injectable transport/client for deterministic tests. If `httpx` is promoted from dev-only to runtime dependency, keep version bounds narrow and update `pyproject.toml`.
  - [x] Send only the minimum request fields needed for context lookup. Do not send full runtime request payloads, bearer tokens in logs, prompts, or raw model data.
  - [x] Map authorization, validation, timeout, network, and malformed-response failures to `ConversationWorkflowError` categories with safe fixed messages.
- [x] Integrate read-only context loading into the workflow skeleton without changing candidate output ownership. (AC: 1, 2, 3, 4)
  - [x] Update the `load_context` step to call the read-only context tool when configured/injected.
  - [x] Keep the workflow result contract-valid and keep `memoryCandidates`/`proposedActions` empty unless Story 5.4 owns candidate proposals.
  - [x] Increment `toolCalls` deterministically when the context tool is attempted; keep retry counts coherent.
  - [x] On tool failure, return canonical safe runtime errors through the existing `/runtime/process-message` error path.
  - [x] Do not instantiate runtime sessions/checkpoints, call write tools, execute actions, or persist shadow diagnostics.
- [x] Extend scope-regression guardrails for Story 5.3. (AC: 3)
  - [x] Allow only `agent-service/src/agent_service/tools` read-only context tooling; continue blocking command tools, write paths, model calls, shadow/canary files, UI, deployment mutation, and domain writes.
  - [x] Assert TypeScript internal context files are read-only and guarded by `RequireInternalServiceAuth({ permission: 'read' })`.
  - [x] Assert `MafAgentRuntimeClient` remains fail-closed and does not perform successful `/runtime/process-message` HTTP execution.
  - [x] Assert no Python tool endpoint or TypeScript internal endpoint accepts command permissions in this story.
- [x] Add focused TypeScript tests. (AC: 1, 2, 3, 4)
  - [x] Test authorized context read returns tenant/workspace-filtered data and bounded arrays.
  - [x] Test tenant/workspace mismatch is rejected even if the JSON body asks for another tenant/workspace.
  - [x] Test missing/malformed auth is rejected through existing internal auth guard behavior.
  - [x] Test malformed body or invalid limits produce safe validation errors.
  - [x] Test the endpoint does not write to database tables, queues, outbox, or command paths.
  - [x] Test response/audit surfaces do not include raw bearer tokens, service secrets, full payloads, or stack traces.
- [x] Add focused Python tests. (AC: 1, 2, 3, 4)
  - [x] Test context tool signs scoped read token with the exact endpoint allowlist and sends `Authorization: Bearer <token>` plus safe trace header.
  - [x] Test successful tool response is normalized to a safe workflow context object.
  - [x] Test 401/403/400/timeout/network/malformed-response failures map to safe `ConversationWorkflowError` categories and fixed messages.
  - [x] Test workflow `load_context` calls the tool through injection, increments `toolCalls`, and still returns a contract-valid result on success.
  - [x] Test workflow tool failure returns canonical `RuntimeErrorResponse` without leaking user text, bearer tokens, service secrets, stack traces, or full payloads.
  - [x] Keep tests local and deterministic with stubbed clients/transports; do not require a running API service, Postgres, Redis, Slack, Azure, LangWatch, OpenAI, Docker, or Railway.
- [x] Update developer docs. (AC: 1-4)
  - [x] Document the new internal context endpoint, required Python settings, auth allowlist, and failure semantics.
  - [x] Document that this story does not enable MAF runtime execution from TypeScript, command tools, shadow/canary, deployment mutation, or candidate proposal persistence.
- [x] Update implementation tracking. (AC: 1-4)
  - [x] Update this story's Dev Agent Record during implementation.
  - [x] Move sprint status from `ready-for-dev` to `in-progress` during dev-story and to `review` when implementation is complete.
- [x] Run and record verification. (AC: 1-4)
  - [x] Run focused API tests for the internal MAF context module.
  - [x] Run `pnpm --filter @entalent/api typecheck`.
  - [x] Run `pnpm --filter @entalent/api lint`.
  - [x] Run `cd agent-service && .venv/bin/python -m pytest tests/unit`.
  - [x] Run `cd agent-service && .venv/bin/python -m ruff check .`.
  - [x] Run `cd agent-service && .venv/bin/python -m mypy .`.
  - [x] Run `pnpm --filter @entalent/application test -- src/use-cases/maf-agent-runtime-client` to preserve the disabled-client boundary.
  - [x] Run `python3 packages/contracts/runtime/validate_fixtures.py`.
  - [x] Run `git diff --check`.

### Review Findings

- [x] [Review][Patch] Runtime endpoint did not instantiate configured read-only context tool [agent-service/src/agent_service/api/runtime.py:35]
- [x] [Review][Patch] Recent-turn response exposed raw message text previews [apps/api/src/internal-maf-context/internal-maf-context.service.ts:191]
- [x] [Review][Patch] Null or non-object API request body could bypass safe 400 validation [apps/api/src/internal-maf-context/internal-maf-context.controller.ts:65]
- [x] [Review][Patch] Context rows could be returned when the scoped user/conversation/workspace membership was absent [apps/api/src/internal-maf-context/internal-maf-context.service.ts:52]
- [x] [Review][Patch] Python context tool accepted malformed or unbounded successful responses [agent-service/src/agent_service/tools/context_tool.py:207]
- [x] [Review][Patch] Sensitive memory content could be returned verbatim [apps/api/src/internal-maf-context/internal-maf-context.service.ts:258]
- [x] [Review][Patch] API memory reads did not match worker active-memory semantics for superseded rows and ordering [apps/api/src/internal-maf-context/internal-maf-context.service.ts:113]

## Dev Notes

### Current Architecture Context

- AD-1 keeps `AgentRuntimePort.processMessage` as the only runtime switch point. Story 5.3 must not wire the TypeScript worker to successful Python execution.
- AD-2 keeps TypeScript as first-slice side-effect owner. Read-only context endpoints are allowed; command tools and writes are not.
- AD-3 keeps MAF/framework details inside `agent-service`. TypeScript endpoints should expose JSON contracts, not Python/MAF types.
- AD-4 keeps JSON HTTP as the first transport.
- AD-5 and AD-15 require fallback to stop at the first side effect. This story must not create any side-effect barrier transition or action commit path.
- AD-7 and AD-8 require durable/non-local shadow state before non-local shadow execution. Story 5.3 should not enable non-local shadow or session/checkpoint use from the workflow.
- AD-10 says deterministic policy outranks agent output. Context tools can read policy inputs but must not make policy writes.
- AD-14 keeps the runtime request/result schema canonical, but this story's internal context endpoint can use an internal API DTO as long as it remains JSON-compatible and tested.
- AD-16 is central for this story: Python-to-TypeScript read calls must use scoped service auth with tenant/workspace claims, endpoint allowlist, audit fields, and read permission. TypeScript must validate scope from authenticated claims, not from JSON payload alone.
- AD-17 requires retry/tool counters to remain coherent. If a tool attempt is counted, `diagnostics.toolCalls` must reflect it and retry counts must still sum correctly.
- AD-18 keeps shadow diagnostics TypeScript-owned. Do not persist candidate/current comparison records here.
- AD-19 deployment metadata exists, but actual Railway mutation and non-local shadow readiness remain out of scope.

### Existing Repo State

- `apps/api/src/internal-auth/` already contains `InternalServiceAuthService`, `RequireInternalServiceAuth`, `InternalServiceAuthGuard`, `InternalAuthModule`, and sanitized audit projection.
- `apps/api/src/app.module.ts` currently imports `DatabaseModule`, `QueueModule`, `HealthModule`, `ChannelModule`, `UsersModule`, `AdminModule`, and optional `DevModule`; it does not yet import `InternalAuthModule` or an internal MAF context module.
- `apps/api/src/database/DatabaseService` exposes the Drizzle client for API-owned services.
- Existing read repository implementations for memory, goals, survey, risk, and style profile live mostly in `apps/worker`. Do not import worker classes into `apps/api`; duplicate only the small API read queries needed or factor a shared read helper only if it stays scoped and low-risk.
- Shared database schema exports include `memoryItems`, `userGoals`, `riskSignals`, `surveyWindows`, `userStyleProfiles`, and related survey tables in `@entalent/database`.
- `agent-service/src/agent_service/infrastructure/internal_auth.py` can create signed scoped internal service tokens, and tests already prove read permission + endpoint allowlist shape.
- `agent-service/src/agent_service/infrastructure/settings.py` already uses the `AGENT_SERVICE_` env prefix and includes `internal_service_auth_secret` and `internal_service_identity`.
- `agent-service/src/agent_service/workflows/conversation_workflow.py` has an explicit `load_context` step and currently uses only the request's embedded context.
- Story 5.2 review fixes normalized workflow errors at the endpoint. Do not reintroduce raw exception/message passthrough from tools.
- `packages/application/src/use-cases/maf-agent-runtime-client.ts` remains disabled and throws `MafAgentRuntimeConfigurationError` before any HTTP execution because the TypeScript port cannot honestly build the canonical request shape yet.

### Recommended File Structure

```text
apps/api/src/internal-maf-context/
  internal-maf-context.controller.ts
  internal-maf-context.module.ts
  internal-maf-context.service.ts
  internal-maf-context.controller.test.ts
  internal-maf-context.service.test.ts

agent-service/src/agent_service/tools/
  __init__.py
  context_tool.py

agent-service/tests/unit/
  test_context_tool.py
  test_conversation_workflow.py
  test_runtime_endpoint.py
  test_scope.py
```

Adjust only if implementation shows a smaller local pattern. Keep API code in `apps/api`, Python tool client code in `agent-service`, and shared runtime contract code unchanged unless a test proves a schema issue.

### Internal Context API Guidance

- Prefer one endpoint for the first slice: `POST /internal/maf/context/read`.
- Request body should include IDs and bounded limits, not raw Slack text:
  - `tenantId`
  - `workspaceId`
  - `userId`
  - `conversationId`
  - optional `sessionKey`
  - optional `recentTurnLimit`, `memoryLimit`, `goalLimit`, `riskLimit`
- `tenantId` and `workspaceId` must equal authenticated claims. User/conversation access must be tenant-filtered in every query.
- Response can be a first-slice context bundle:
  - `userProfile` / style profile when present
  - `memoryItems`
  - `goals`
  - `recentConversationSummary` or bounded recent-turn metadata
  - `surveyState`
  - `riskSignals`
  - `diagnostics` with counts and safe trace ID
- Keep arrays bounded and deterministic. Use defaults that make local tests small.
- Do not include full raw message history unless required; if message snippets are included, cap length and test that limits are enforced.
- Do not expose database row internals or nullable fields inconsistently. Convert dates to ISO strings.

### Python Tool Guidance

- Use the existing Python token helper:
  - permission: `("read",)`
  - endpoint allowlist: `("/internal/maf/context/read",)`
  - trace ID from runtime request when safe
- Recommended settings:
  - `AGENT_SERVICE_INTERNAL_API_URL` or similarly explicit base URL for the TypeScript API internal surface
  - `AGENT_SERVICE_CONTEXT_TOOL_TIMEOUT_MS`
  - existing `AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET`
  - existing `AGENT_SERVICE_INTERNAL_SERVICE_IDENTITY`
- Missing URL/secret/invalid config should fail closed when the tool is invoked. It must not break `/health/live` or app construction.
- If using HTTPX, official docs show `AsyncClient` for async requests and configurable timeouts; prefer a client/transport injection pattern for tests. Do not instantiate a hot-loop global client that cannot be closed.
- Do not log request body, response body, Authorization header, token claims, service secret, raw Slack/user text, prompts, or stack traces.

### Error Mapping Guidance

Map tool failures to safe workflow errors:

| Failure | Category | Retryable | Fallback allowed | Message |
| --- | --- | --- | --- | --- |
| Missing/invalid tool config | `dependency_failed` or `unavailable` | false or true by category policy | true before side effects | fixed safe message |
| HTTP 400 / validation | `validation_error` | false | true | fixed safe message |
| HTTP 401 / 403 | `dependency_failed` | false | true | fixed safe message |
| Timeout | `timeout` | true | true | fixed safe message |
| Network unavailable | `unavailable` or `dependency_failed` | true | true | fixed safe message |
| Malformed response | `unsafe_partial_result` | false | true | fixed safe message |

Use the endpoint's existing category-normalization behavior; do not pass through raw tool exception messages.

### Out Of Scope

- Command tools or `RequireInternalServiceAuth({ permission: 'command' })` for MAF
- Python writes to TypeScript APIs or direct database writes from `agent-service`
- Worker routing changes, successful `MafAgentRuntimeClient` HTTP execution, or canonical request builder changes
- Shadow diagnostics persistence, candidate/current comparison, canary behavior, rollout gates, or dashboard/admin UI
- Model provider calls, prompts, agent personas, or LLM credentials
- Railway service mutation, production deployment, root deployment files, or non-local shadow enablement
- Durable workflow sessions/checkpoints unless a test proves a read-only local object is needed
- Structured candidate memory/action results owned by Story 5.4

### Previous Story Intelligence

- Story 5.1 intentionally left `MafAgentRuntimeClient` disabled and fail-closed until canonical request building exists. Preserve that boundary.
- Story 5.2 added `ConversationWorkflow` and `/runtime/process-message` workflow execution locally, but still with empty memory/action proposals and zero model calls.
- Story 5.2 code review found redaction and normalization gaps. For Story 5.3, tool failures must use allowlisted messages and category-normalized runtime errors from the start.
- Story 5.2 scope guardrails were expanded to scan all workflow modules and assert the TS MAF client stays fail-closed. Extend, do not remove, those guardrails.
- Story 4.3 internal auth review found tenant/workspace scope, endpoint allowlists, weak secrets, duplicate auth headers, trace ID sanitization, and sanitized audit projection as important failure points.
- Epic 4 retrospective action E4-A5 remains open: preserve safe error and redaction behavior when adding MAF workflow and read-only tools.

### Testing Requirements

- Tests must be local and deterministic.
- TypeScript tests should use Nest testing module or focused service/controller tests with mocked `DatabaseService`, mocked `InternalServiceAuthGuard` only when testing service behavior, and real guard behavior for auth-specific tests where feasible.
- Python tests should use injected fake async client/transport; no live API server.
- Include negative tests for tenant/workspace mismatch, auth failure, malformed request, timeout, malformed response, and sensitive content in tool errors.
- Keep `agent-service` full unit suite green and run focused `@entalent/api` tests/typecheck/lint when API code changes.
- If `agent-service/pyproject.toml` dependency bounds change, run ruff/mypy/pytest with `agent-service/.venv` and document any required environment update.

### Latest Technical Notes

- HTTPX official docs describe `AsyncClient` for async request methods and support explicit timeout configuration. Use this if adding runtime HTTP client behavior in Python, because FastAPI handlers and workflow calls are async-capable and tests can inject a transport/client.
- HTTPX docs also note default timeout behavior and finer timeout configuration; this story should use explicit timeout settings rather than disabling timeouts.
- Sources: https://www.python-httpx.org/async/ and https://www.python-httpx.org/advanced/timeouts/

### References

- `_bmad-output/planning-artifacts/epics.md` - Epic 5 Story 5.3 requirements.
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md` - AD-1, AD-2, AD-3, AD-4, AD-5, AD-7, AD-8, AD-10, AD-14, AD-16, AD-17, AD-18, AD-19.
- `_bmad-output/implementation-artifacts/5-1-add-disabled-maf-agent-runtime-client.md` - disabled-client boundary.
- `_bmad-output/implementation-artifacts/5-2-implement-maf-workflow-skeleton.md` - workflow skeleton and review-fix learnings.
- `_bmad-output/implementation-artifacts/epic-4-retro-2026-08-06.md` - Epic 4 action items E4-A2/E4-A3/E4-A5.
- `apps/api/src/internal-auth/internal-auth.service.ts` - scoped token validation, endpoint allowlist, sanitized audit projection.
- `apps/api/src/internal-auth/internal-auth.guard.ts` - `RequireInternalServiceAuth` guard behavior.
- `apps/api/src/app.module.ts` - API module mounting point.
- `apps/api/src/database/database.service.ts` - API database access pattern.
- `packages/database/src/schema/` - shared database schema for context reads.
- `agent-service/src/agent_service/infrastructure/internal_auth.py` - Python scoped token helper.
- `agent-service/src/agent_service/infrastructure/settings.py` - Python settings prefix and existing auth settings.
- `agent-service/src/agent_service/workflows/conversation_workflow.py` - `load_context` workflow step to extend.
- `agent-service/src/agent_service/api/runtime.py` - canonical safe runtime error path.
- `agent-service/tests/unit/test_scope.py` - Epic 5 scope guardrails to extend.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story created after Story 5.2 implementation and BMAD code review were completed and marked done.
- Loaded BMAD create-story workflow, config, sprint status, Epic 5 Story 5.3 requirements, Story 5.2 record, architecture spine context, internal auth primitives, API module/database patterns, shared database schemas, Python internal auth/settings/workflow context, and HTTPX official async/timeout docs.
- 2026-08-06: Added API-owned `internal-maf-context` read module with `POST /internal/maf/context/read`, read-only scoped auth guard, body validation, tenant/workspace claim enforcement, bounded DB reads, ISO date serialization, and truncated recent-turn previews.
- 2026-08-06: Added Python read-only context tool client using scoped internal auth, explicit timeout, injectable async client, safe fixed error mapping, and `ConversationWorkflow` async injection path with deterministic `toolCalls`.
- 2026-08-06: Extended Story 5.3 scope guardrails, focused API/Python tests, and developer docs while preserving disabled `MafAgentRuntimeClient` execution and empty candidate outputs.
- 2026-08-06: BMAD code review found seven patch findings. Fixed configured runtime tool instantiation, raw recent-turn leakage, null body validation, preflight user/conversation/workspace membership checks, strict Python response validation, sensitive memory redaction, and worker-aligned active-memory filtering/order.

### Completion Notes

- Implemented the first read-only context bridge from Python MAF workflow to TypeScript-owned product state without command tools, writes, routing activation, shadow/canary, deployment mutation, or candidate persistence.
- The default local runtime endpoint remains dependency-free; the context tool fails closed only when invoked/configured through workflow injection.
- Context tool failures map to canonical safe workflow errors and do not expose raw user text, prompts, bearer tokens, secrets, full payloads, or stack traces.
- BMAD code review patch findings were resolved and the story was marked done.

### Change Log

- 2026-08-06: Implemented Story 5.3 read-only context tooling and moved story to review.
- 2026-08-06: Addressed BMAD code review findings and moved Story 5.3 to done.

### File List

- `apps/api/src/app.module.ts`
- `apps/api/src/internal-maf-context/internal-maf-context.controller.ts`
- `apps/api/src/internal-maf-context/internal-maf-context.controller.test.ts`
- `apps/api/src/internal-maf-context/internal-maf-context.module.ts`
- `apps/api/src/internal-maf-context/internal-maf-context.service.ts`
- `apps/api/src/internal-maf-context/internal-maf-context.service.test.ts`
- `agent-service/README.md`
- `agent-service/pyproject.toml`
- `agent-service/src/agent_service/infrastructure/settings.py`
- `agent-service/src/agent_service/api/runtime.py`
- `agent-service/src/agent_service/tools/__init__.py`
- `agent-service/src/agent_service/tools/context_tool.py`
- `agent-service/src/agent_service/workflows/conversation_workflow.py`
- `agent-service/tests/unit/test_context_tool.py`
- `agent-service/tests/unit/test_conversation_workflow.py`
- `agent-service/tests/unit/test_runtime_endpoint.py`
- `agent-service/tests/unit/test_scope.py`
- `agent-service/tests/unit/test_settings.py`
- `_bmad-output/implementation-artifacts/5-3-implement-read-only-context-tools.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Verification

- `pnpm --filter @entalent/api test -- src/internal-maf-context` - passed (7 tests).
- `pnpm --filter @entalent/api typecheck` - passed.
- `pnpm --filter @entalent/api lint` - passed with existing `apps/api/src/main.ts` console warnings.
- `cd agent-service && .venv/bin/python -m pytest tests/unit` - passed (68 tests, 1 Starlette/httpx deprecation warning).
- `cd agent-service && .venv/bin/python -m ruff check .` - passed.
- `cd agent-service && .venv/bin/python -m mypy .` - passed.
- `pnpm --filter @entalent/application test -- src/use-cases/maf-agent-runtime-client` - passed (13 tests).
- `python3 packages/contracts/runtime/validate_fixtures.py` - passed.
- `git diff --check` - passed.
- `codegraph status` - index up to date.

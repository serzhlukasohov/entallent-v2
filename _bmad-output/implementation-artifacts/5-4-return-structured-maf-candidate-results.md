---
baseline_commit: dce563c
---

# Story 5.4: Return Structured MAF Candidate Results

Status: done
Epic: 5 - MAF Conversation Workflow Candidate
Story ID: 5.4

## Story

As a product reviewer,
I want MAF candidate output to include structured reply, risk, memory, actions, and diagnostics,
so that shadow comparison can evaluate behavior before canary.

## Acceptance Criteria

1. Given the MAF workflow completes, when the Python service returns a result, then the result validates against the canonical process-message result contract and proposed memory, goal, and follow-up changes remain proposals only.
2. Given deterministic policy blocks a survey or proactive action, when MAF proposes output, then the blocked action is omitted or marked rejected and diagnostics identify the policy decision.
3. Given this story is complete, when the diff is inspected, then it adds only structured candidate result production in `agent-service`; it must not activate TypeScript routing, successful `MafAgentRuntimeClient` execution, shadow/canary execution, command tools, model provider calls, dashboard/admin UI, deployment mutation, or domain aggregate writes.
4. Given candidate results, validation failures, or diagnostics are returned, logged, or tested, then raw Slack/user text, prompts, bearer tokens, service secrets, full request payloads, stack traces, and sensitive memory content are not exposed.

## Tasks / Subtasks

- [x] Produce a contract-valid structured candidate result from the Python workflow. (AC: 1, 3, 4)
  - [x] Keep the endpoint response validated by `validate_runtime_result`, which currently validates OpenAPI schema `RuntimeResult`; the epic wording `ProcessMessageResult` maps to this canonical schema in code.
  - [x] Include `reply`, `riskAssessment`, `memoryCandidates`, `proposedActions`, and `diagnostics` when available under the existing OpenAPI shapes.
  - [x] Keep `diagnostics.traceId`, `diagnostics.runtimeAttempt`, model/tool/retry counters, latency, and runtime version coherent and deterministic.
  - [x] Keep `modelCalls` at `0` and do not add model provider clients, prompts, `agent_framework_hosting`, or external LLM credentials in this story.
  - [x] Do not echo raw request message text, recent-turn content, bearer tokens, secrets, prompts, full payloads, or stack traces in result fields.
- [x] Add proposal-only memory candidate generation. (AC: 1, 3, 4)
  - [x] Derive only deterministic, bounded candidate data from the current runtime request/context or read-only context tool output.
  - [x] Emit `RuntimeMemoryCandidate` objects with stable `actionId`, `type`, `content`, `confidence`, `sourceMessageIds`, and optional `sensitivity`.
  - [x] Add matching `save_memory` action envelopes only as proposals with `executionStatus: "not_started"` or `"blocked"` and `commitMarker: null`.
  - [x] Do not write memory directly from Python and do not call TypeScript command endpoints.
- [x] Add proposal-only goal and follow-up action planning. (AC: 1, 2, 3, 4)
  - [x] Emit `update_goal` action envelopes only when an existing goal/context signal supports a deterministic candidate update.
  - [x] Emit `schedule_follow_up` action envelopes only when policy allows proactive follow-up.
  - [x] Use canonical action envelope fields: `actionId`, `aggregateType`, `actionType`, `idempotencyKey`, `payload`, `validationResult`, `executionStatus`, and `commitMarker`.
  - [x] Keep action IDs and idempotency keys deterministic for the same runtime request.
  - [x] Do not enqueue follow-ups, send messages, persist goals, persist actions, or mutate ledgers from Python.
- [x] Apply deterministic policy before returning actions. (AC: 2, 3, 4)
  - [x] Convert risk/context signals into a `RuntimeRiskAssessment` using the canonical schema.
  - [x] If risk requires survey blocking or proactive pause, omit affected survey/proactive actions or include them as rejected/blocked proposals.
  - [x] Mark rejected proposals with `validationResult.status: "invalid"`, stable `reasonCodes`, `executionStatus: "blocked"`, and `commitMarker: null`.
  - [x] Identify policy decisions through safe diagnostics/reason codes without adding non-contract diagnostic fields to `RuntimeDiagnostics`.
- [x] Update Story 5.4 scope guardrails. (AC: 3)
  - [x] Allow candidate proposal construction in `agent-service/src/agent_service/workflows`.
  - [x] Continue blocking Python write tools, direct DB repositories, command permissions, model clients, `agent_framework_hosting`, runtime state/session/checkpoint execution from this path, shadow/canary files, dashboard/admin UI, deployment mutation, and successful TypeScript MAF HTTP execution.
  - [x] Assert all returned action envelopes are uncommitted unless a fixture-only contract test explicitly uses committed examples outside workflow production.
- [x] Add focused Python tests. (AC: 1-4)
  - [x] Test the default workflow returns a result that validates with `validate_runtime_result` and includes structured reply, risk, memory candidate, action proposals, and diagnostics.
  - [x] Test memory, goal, and follow-up actions remain proposal-only with `commitMarker: null` and no committed execution status.
  - [x] Test deterministic policy blocks proactive follow-up when risk or context requires survey/proactive pause and returns stable rejection reason codes.
  - [x] Test sensitive raw input and sensitive context/memory values are not echoed in result fields or safe errors.
  - [x] Test context-tool success still increments `toolCalls` and preserves coherent retry counters.
  - [x] Keep tests local and deterministic; do not require a running API service, Postgres, Redis, Slack, Azure, LangWatch, OpenAI, Docker, or Railway.
- [x] Update developer docs and implementation tracking. (AC: 1-4)
  - [x] Document structured candidate result semantics in `agent-service/README.md`, including proposal-only ownership and policy rejection behavior.
  - [x] Update this story's Dev Agent Record during implementation.
  - [x] Move sprint status from `ready-for-dev` to `in-progress` during dev-story and to `review` when implementation is complete.
- [x] Run and record verification. (AC: 1-4)
  - [x] Run `cd agent-service && .venv/bin/python -m pytest tests/unit`.
  - [x] Run `cd agent-service && .venv/bin/python -m ruff check .`.
  - [x] Run `cd agent-service && .venv/bin/python -m mypy .`.
  - [x] Run `pnpm --filter @entalent/application test -- src/use-cases/maf-agent-runtime-client` to preserve the disabled-client boundary.
  - [x] Run `python3 packages/contracts/runtime/validate_fixtures.py`.
  - [x] Run `git diff --check`.

### Review Findings

- [x] [Review][Patch] Risk signal type/evidence could echo sensitive context strings. [agent-service/src/agent_service/workflows/conversation_workflow.py:221]
- [x] [Review][Patch] Proactive follow-up ignored deterministic context policy gates such as disabled proactivity. [agent-service/src/agent_service/workflows/conversation_workflow.py:283]
- [x] [Review][Patch] Invalid message timestamps could make follow-up `executeAt` wall-clock dependent. [agent-service/src/agent_service/workflows/conversation_workflow.py:489]
- [x] [Review][Patch] Sensitive/token-like messages still produced memory candidates. [agent-service/src/agent_service/workflows/conversation_workflow.py:259]
- [x] [Review][Patch] Goal update proposals could be unsupported no-ops without a deterministic change signal. [agent-service/src/agent_service/workflows/conversation_workflow.py:425]

## Dev Notes

### Current Architecture Context

- AD-1 keeps `AgentRuntimePort.processMessage` as the only runtime switch point. Story 5.4 must not wire the TypeScript worker/router to successful Python execution.
- AD-2 keeps TypeScript as first-slice side-effect owner. Python may return memory, goal, and follow-up proposals only; TypeScript validates and executes later.
- AD-3 keeps MAF/framework details inside `agent-service`; no MAF types may leak into TypeScript packages or shared contracts.
- AD-4 keeps JSON HTTP as the first transport and the current OpenAPI schemas as the boundary.
- AD-5 and AD-15 require side-effect barriers before user-facing MAF execution. This story must not create committed action workflow output or mutate attempt/action ledgers.
- AD-10 says deterministic policy outranks agent output. Risk, survey blocking, proactive pause, consent, quiet hours, cooldowns, and duplicate prevention must be represented as deterministic validation decisions.
- AD-14 makes `packages/contracts/runtime/openapi.json` canonical. In Python, `validate_runtime_result` validates schema `RuntimeResult`; use that name in tests even though the epic says `ProcessMessageResult`.
- AD-17 requires coherent counters: `retryCount` must equal `modelRetryCount + toolRetryCount + httpRetryCount`; `toolCalls` must reflect context tool attempts.
- AD-18 keeps shadow diagnostics TypeScript-owned. Story 5.4 may return candidate diagnostics but must not persist shadow comparison records.
- AD-19 deployment metadata already exists, but deployment mutation and non-local shadow enablement remain out of scope.

### Existing Repo State

- `agent-service/src/agent_service/workflows/conversation_workflow.py` already executes these steps: `load_context`, `classify_intent`, `detect_risk`, `extract_memory`, `apply_deterministic_policy`, `generate_response`, `plan_follow_up`, `validate_actions`, `prepare_result`.
- The workflow currently returns a contract-valid skeleton with empty `memoryCandidates` and `proposedActions`; Story 5.4 owns filling those structured candidate fields.
- `agent-service/src/agent_service/api/runtime.py` already validates incoming requests and outgoing results and maps workflow exceptions to canonical safe runtime errors.
- `agent-service/src/agent_service/tools/context_tool.py` provides read-only context when `AGENT_SERVICE_INTERNAL_API_URL` is configured; default local workflow remains dependency-free.
- Story 5.3 removed raw recent-turn text from the internal context response and strictly validates Python tool responses. Preserve those redaction and validation properties.
- `packages/contracts/runtime/openapi.json` defines `RuntimeResult`, `RuntimeReply`, `RuntimeRiskAssessment`, `RuntimeMemoryCandidate`, and action envelopes for `save_memory`, `schedule_follow_up`, and `update_goal`.
- Valid fixture `packages/contracts/runtime/fixtures/valid/runtime-result.json` demonstrates all three proposal types. Valid fixture `runtime-result-validation-failed-action.json` demonstrates a blocked follow-up proposal.
- `agent-service/tests/unit/test_scope.py` still contains Story 5.3-era guardrails that forbid `memoryCandidates.append` and `proposedActions.append`; update them so Story 5.4 can produce proposals while still blocking writes, model clients, command tools, and activation.
- `packages/application/src/use-cases/maf-agent-runtime-client.ts` remains disabled/fail-closed. Do not make it perform successful `/runtime/process-message` HTTP execution in this story.

### Implementation Guidance

- Prefer small deterministic helper methods inside `ConversationWorkflow` over new service layers unless code growth proves otherwise.
- Use stable IDs derived from request IDs/message IDs/action categories, not randomness or wall-clock time.
- For schedule-follow-up test data, use the request `message.createdAt` plus a deterministic offset or a fixture-provided date; keep ISO 8601 output contract-valid.
- Since `RuntimeDiagnostics` disallows additional properties, policy decisions should be visible through action `validationResult.reasonCodes` and, where useful, safe reply/risk fields rather than new diagnostics keys.
- If representing a blocked action, use `validationResult.status: "invalid"`, `executionStatus: "blocked"`, and `commitMarker: null`.
- If omitting blocked actions, still test that the policy decision is discoverable in contract-valid output, preferably through `riskAssessment.surveyMustBeBlocked` / `proactiveMessagesMustBePaused` and stable action rejection tests for at least one blocked proposal path.
- Keep `riskAssessment.evidence` short and reason-code-like. Do not include raw user or context text.
- Keep memory candidate content sanitized and bounded. Do not emit sensitive memory candidates from sensitive context or token-like input.

### Out Of Scope

- TypeScript routing activation or successful `MafAgentRuntimeClient` HTTP execution.
- Story 5.5 shadow-mode integration or shadow diagnostics persistence.
- Canary, rollout gates, dashboard/admin UI, or deployment mutation.
- Python command tools, TypeScript command endpoints, direct Python DB writes, queues, outbox, Slack sends, memory/goal/follow-up persistence, or ledger mutation.
- Model provider calls, prompt templates, personas, agent credentials, streaming, or `agent_framework_hosting`.
- Durable session/checkpoint execution from the runtime path.
- Changing the canonical OpenAPI contract unless a failing contract fixture proves the existing schema cannot express Story 5.4. Prefer using the existing schema.

### Previous Story Intelligence

- Story 5.1 intentionally left `MafAgentRuntimeClient` disabled and fail-closed until canonical request building and activation are owned by later stories.
- Story 5.2 added the workflow skeleton and safe endpoint error mapping; do not reintroduce raw exception passthrough.
- Story 5.3 added read-only context tools and review fixes for raw text leakage, null body validation, scoped membership checks, strict Python context response validation, sensitive memory redaction, and active-memory filtering semantics.
- Epic 4/5 action items remain relevant: preserve safe error and redaction behavior, carry scope-regression guardrails forward, and keep fail-closed runtime behavior until explicit activation stories.

### Testing Requirements

- Python tests should be unit-level and deterministic, using contract fixtures and injected fake context tools where needed.
- Test both default embedded-context workflow and context-tool-backed workflow.
- Contract validation should call `validate_runtime_result(result)` and assert `{"ok": True}`.
- Scope tests should scan source for forbidden surfaces and for proposal-only action lifecycle invariants.
- No test should require external services, network access, Docker, Railway, OpenAI, Slack, Postgres, Redis, Azure, or LangWatch.

### References

- `_bmad-output/planning-artifacts/epics.md` - Epic 5 Story 5.4 requirements.
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md` - AD-1, AD-2, AD-3, AD-4, AD-5, AD-10, AD-14, AD-15, AD-17, AD-18, AD-19.
- `_bmad-output/implementation-artifacts/5-1-add-disabled-maf-agent-runtime-client.md` - disabled-client boundary.
- `_bmad-output/implementation-artifacts/5-2-implement-maf-workflow-skeleton.md` - workflow skeleton and safe error mapping.
- `_bmad-output/implementation-artifacts/5-3-implement-read-only-context-tools.md` - read-only context tool integration and review-fix learnings.
- `packages/contracts/runtime/openapi.json` - canonical runtime contract source.
- `packages/contracts/runtime/fixtures/valid/runtime-result.json` - structured candidate result example.
- `packages/contracts/runtime/fixtures/valid/runtime-result-validation-failed-action.json` - blocked action example.
- `agent-service/src/agent_service/workflows/conversation_workflow.py` - workflow implementation target.
- `agent-service/src/agent_service/api/runtime.py` - runtime endpoint validation and safe error path.
- `agent-service/tests/unit/test_conversation_workflow.py` - workflow tests to extend.
- `agent-service/tests/unit/test_scope.py` - Epic 5 scope guardrails to update.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story created after Story 5.3 implementation, BMAD review fixes, verification, and done status.
- Loaded BMAD create-story and dev-story instructions, sprint status, Epic 5 Story 5.4 requirements, architecture spine, Story 5.3 record, runtime OpenAPI schemas, valid runtime fixtures, current workflow, endpoint, validator, and scope tests.
- 2026-08-06: Added failing tests for structured candidate reply/risk/memory/action output and risk-policy blocked follow-up behavior.
- 2026-08-06: Implemented deterministic candidate result construction in `ConversationWorkflow` with proposal-only memory, goal, and follow-up action envelopes.
- 2026-08-06: Updated runtime endpoint expectations, Story 5.4 scope guardrails, and README documentation for proposal-only structured results.
- 2026-08-06: BMAD code review found five patch findings. Fixed risk evidence allowlisting, disabled-proactivity blocking, deterministic invalid timestamp handling, sensitive-message memory suppression, and supported-signal gating for goal updates.

### Completion Notes

- Implemented contract-valid structured candidate results from the Python workflow while keeping `modelCalls` at `0` and avoiding model/provider integration.
- Added deterministic memory candidates plus `save_memory`, `update_goal`, and `schedule_follow_up` proposals that remain uncommitted with `commitMarker: null`.
- Added risk-signal policy handling that marks proactive follow-up proposals blocked with stable reason codes when survey/proactive messaging must pause.
- Preserved the disabled TypeScript MAF client boundary, no command tools, no shadow/canary execution, no deployment mutation, and no Python-owned domain writes.
- Resolved BMAD review findings and kept all candidate actions proposal-only.

### Change Log

- 2026-08-06: Created Story 5.4 as ready for development.
- 2026-08-06: Started Story 5.4 implementation.
- 2026-08-06: Implemented structured candidate results and moved Story 5.4 to review.
- 2026-08-06: Addressed BMAD code review findings.
- 2026-08-06: Completed BMAD code review and moved Story 5.4 to done.

### File List

- `agent-service/README.md`
- `agent-service/src/agent_service/workflows/conversation_workflow.py`
- `agent-service/tests/unit/test_conversation_workflow.py`
- `agent-service/tests/unit/test_runtime_endpoint.py`
- `agent-service/tests/unit/test_scope.py`
- `_bmad-output/implementation-artifacts/5-4-return-structured-maf-candidate-results.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Verification

- `cd agent-service && .venv/bin/python -m pytest tests/unit` - passed (75 tests, 1 Starlette/httpx deprecation warning).
- `cd agent-service && .venv/bin/python -m ruff check .` - passed.
- `cd agent-service && .venv/bin/python -m mypy .` - passed.
- `pnpm --filter @entalent/application test -- src/use-cases/maf-agent-runtime-client` - passed (13 tests).
- `python3 packages/contracts/runtime/validate_fixtures.py` - passed.
- `git diff --check` - passed.
- `codegraph status` - index up to date.

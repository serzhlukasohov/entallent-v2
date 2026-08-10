---
baseline_commit: dce563c
---

# Story 5.2: Implement MAF Workflow Skeleton

Status: done
Epic: 5 - MAF Conversation Workflow Candidate
Story ID: 5.2

## Story

As an engineer,
I want a MAF workflow skeleton for one inbound turn,
so that agent orchestration can be developed behind the runtime contract.

## Acceptance Criteria

1. Given a valid runtime request reaches Python, when the workflow runs, then it executes load context, classify intent, risk detection, memory extraction, deterministic policy application, response generation, follow-up planning, action validation, and result preparation steps.
2. Given a workflow step fails, when the service returns an error, then the error uses the canonical error shape with retryability and fallback eligibility.
3. Given this story is complete, when the diff is inspected, then it adds only the Python workflow skeleton and minimal endpoint wiring needed to execute it; it must not add read-only context tools, Python-to-TypeScript tool calls, TypeScript MAF activation, shadow/canary execution, dashboard/admin UI, deployment mutation, or domain aggregate writes.
4. Given workflow output or workflow errors are produced, when logs, diagnostics, or API errors are inspected, then they do not expose raw Slack/user text, prompts, bearer tokens, service secrets, stack traces, or full request payloads.

## Tasks / Subtasks

- [x] Add the Python workflow skeleton under `agent-service`. (AC: 1, 3)
  - [x] Create `agent-service/src/agent_service/workflows/` with a focused conversation workflow module.
  - [x] Represent the required steps explicitly in execution order: load context, classify intent, risk detection, memory extraction, deterministic policy application, response generation, follow-up planning, action validation, and result preparation.
  - [x] Keep step implementations deterministic and local-only; do not require model credentials, network calls, Redis, Postgres, Docker, Railway, Slack, Azure, LangWatch, OpenAI, or tool endpoints.
  - [x] If `agent-framework` is available locally and compatible with Python 3.13, use it only inside `agent-service`; if adding the dependency is required, keep imports contained and tests deterministic. Do not introduce hosting helpers.
- [x] Wire `/runtime/process-message` to the skeleton without enabling real MAF behavior. (AC: 1, 2, 3, 4)
  - [x] Keep request validation through `validate_runtime_process_message_request` before workflow execution.
  - [x] Replace the not-implemented endpoint result with the workflow skeleton result only after a valid request passes canonical contract validation.
  - [x] Validate successful responses with `validate_runtime_result` before returning 200.
  - [x] Convert workflow failures into `RuntimeErrorResponse` JSON and validate it with `validate_runtime_error_response` before returning.
  - [x] Preserve stable safe fields: `traceId`, `errorCategory`, `retryable`, `fallbackAllowed`, and a non-sensitive message.
- [x] Keep the skeleton inside the current side-effect boundary. (AC: 1, 3)
  - [x] Return empty proposal lists unless this story needs deterministic placeholder proposals to satisfy the existing schema; do not write memory, goals, risk signals, scheduled actions, messages, surveys, manager analytics, runtime action commit paths, or domain aggregates.
  - [x] Keep `modelCalls`, `toolCalls`, and retry counters at zero unless a deterministic in-process step intentionally increments a workflow diagnostic.
  - [x] Do not call `RuntimeStateStore`, `SqliteRuntimeStateStore`, internal auth credentials, TypeScript APIs, or future read-only tools from the endpoint.
- [x] Add safe workflow error handling. (AC: 2, 4)
  - [x] Add a typed workflow error or failure result with stable reason categories.
  - [x] Map validation-like workflow failures to non-retryable errors and dependency/runtime failures to the intended retry/fallback flags.
  - [x] Ensure malformed JSON and canonical request validation failures continue returning the existing safe validation error behavior.
  - [x] Ensure unexpected workflow exceptions return a redacted canonical error without stack traces or raw exception text.
- [x] Update Epic 5 scope-regression tests. (AC: 3)
  - [x] Replace or extend old Story 4.x guardrails that forbid `agent-service/src/agent_service/workflows`.
  - [x] Add a Story 5.2 guardrail that allows the workflow skeleton but still forbids `agent-service/src/agent_service/tools`, Python-to-TypeScript tool clients, new TypeScript runtime routing activation, shadow/canary execution, dashboard/admin UI, deployment mutation, and domain aggregate write paths.
  - [x] Keep the Story 5.1 disabled-client guardrail: `MafAgentRuntimeClient` must remain fail-closed until the strict runtime request builder/context loading exists.
- [x] Add focused Python tests. (AC: 1, 2, 4)
  - [x] Test the workflow executes the exact ordered step list for a valid fixture request.
  - [x] Test the endpoint returns a contract-valid workflow skeleton result for `fixtures/valid/process-message-request.json`.
  - [x] Test a forced workflow step failure returns a contract-valid `RuntimeErrorResponse` with expected retryability and fallback eligibility.
  - [x] Test unexpected workflow exceptions are redacted and do not leak raw Slack/user text, prompts, bearer tokens, secrets, stack traces, or full payloads.
  - [x] Test the endpoint still rejects invalid canonical requests and malformed JSON before workflow execution.
  - [x] Test the workflow does not require external dependencies or model credentials.
- [x] Update developer docs if behavior changes. (AC: 1, 2, 3)
  - [x] Update `agent-service/README.md` or a focused runtime doc to describe the skeleton endpoint behavior and non-goals.
  - [x] Document that Story 5.2 does not add read-only tools, real context loading, model calls, MAF client activation, shadow execution, canary, or deployment mutation.
- [x] Update implementation tracking. (AC: 1-4)
  - [x] Update this story's Dev Agent Record during implementation.
  - [x] Move sprint status from `ready-for-dev` to `in-progress` during dev-story and to `review` when implementation is complete.
- [x] Run and record verification. (AC: 1-4)
  - [x] Run `cd agent-service && python3 -m pytest tests/unit/test_runtime_endpoint.py tests/unit/test_scope.py`.
  - [x] Run `cd agent-service && python3 -m pytest tests/unit`.
  - [x] Run `cd agent-service && python3 -m ruff check .`.
  - [x] Run `cd agent-service && python3 -m mypy .`.
  - [x] Run `git diff --check`.

### Review Findings

- [x] [Review][Patch] Workflow error message is returned without endpoint redaction [/Users/serzh/Documents/enTalentNew/agent-service/src/agent_service/api/runtime.py:85]
- [x] [Review][Patch] Workflow retry and fallback flags are trusted from raised errors instead of normalized by category [/Users/serzh/Documents/enTalentNew/agent-service/src/agent_service/api/runtime.py:80]
- [x] [Review][Patch] Scope guard scans only workflow and runtime endpoint files for forbidden external clients [/Users/serzh/Documents/enTalentNew/agent-service/tests/unit/test_scope.py:125]
- [x] [Review][Patch] Scope guard does not assert the Story 5.1 MAF client remains fail-closed [/Users/serzh/Documents/enTalentNew/agent-service/tests/unit/test_scope.py:19]

## Dev Notes

### Current Architecture Context

- Epic 5 introduces the MAF candidate workflow, but TypeScript remains the user-facing runtime until shadow/canary stories and rollout gates explicitly enable it.
- AD-1 keeps `AgentRuntimePort.processMessage` as the only runtime switch point. Story 5.2 must not change worker routing or make Python a production execution path.
- AD-2 keeps TypeScript as first-slice side-effect owner. Python may prepare response/action/memory candidates, but this story should keep those candidates inert and should not execute writes.
- AD-3 allows `agent-framework` imports only inside `agent-service`; shared TypeScript packages must stay framework-neutral.
- AD-4 keeps the first transport as JSON HTTP through the existing `/runtime/process-message` route.
- AD-5 and AD-15 require fallback to stop at the first side effect. Story 5.2 must not add any side-effect commit path, so failure remains fallback-eligible where the canonical error semantics allow it.
- AD-7 and AD-8 added runtime state/session primitives in Story 4.4, but Story 5.2 should not use durable sessions/checkpoints yet unless explicitly needed for deterministic local skeleton state. Non-local shadow still requires durable state and deployment evidence later.
- AD-10 says deterministic policy outranks agent output. In this story, the deterministic policy application step can be a stubbed deterministic step, but it must be explicit in the workflow order.
- AD-11 says FastAPI-owned routes are preferred and `agent-framework-hosting` helpers remain deferred.
- AD-12 targets Python 3.13.x for the new runtime service.
- AD-14 keeps `packages/contracts/runtime/openapi.json` as the canonical runtime schema and requires Python responses/errors to validate against it.
- AD-16 scoped internal tool auth exists as a primitive, but read-only context tools are Story 5.3. Do not call TypeScript APIs or auth-protected tools in Story 5.2.
- AD-17 requires retry counts to stay coherent. If the skeleton reports retries, `retryCount` must equal model, tool, and HTTP retry components.
- AD-18 makes shadow diagnostics TypeScript-owned. Story 5.2 should not write candidate/current comparison records.
- AD-19 deployment metadata already exists. Do not mutate Railway services, add root deployment files, or require Docker verification in this story.

### Existing Repo State

- `agent-service/src/agent_service/api/runtime.py` currently validates the request and returns a contract-valid not-implemented stub with zero model/tool/retry counts.
- `agent-service/src/agent_service/contracts/runtime_contract.py` already exposes `validate_runtime_process_message_request`, `validate_runtime_result`, and `validate_runtime_error_response`.
- `agent-service/tests/unit/test_runtime_endpoint.py` already covers valid requests, invalid canonical requests, malformed JSON, non-object JSON, and no external dependencies for the endpoint skeleton.
- `agent-service/tests/unit/test_scope.py` contains Story 4.x scope tests that intentionally forbid future surfaces. Story 5.2 must update these tests narrowly so the new workflow skeleton is allowed while later surfaces remain blocked.
- `agent-service/pyproject.toml` currently depends on FastAPI, Pydantic, Pydantic Settings, and Uvicorn; dev dependencies are httpx, mypy, pytest, and ruff.
- `packages/application/src/use-cases/maf-agent-runtime-client.ts` remains disabled by design because the TypeScript port still cannot honestly build the canonical request shape.
- `docs/maf-runtime-client.md` documents the strict runtime-boundary gap and disabled-client behavior from Story 5.1.

### Workflow Shape Guidance

Keep the first skeleton small and inspectable. A good local shape is:

```text
agent-service/src/agent_service/workflows/
  __init__.py
  conversation_workflow.py
```

Recommended public surface:

- `ConversationWorkflow`
- `ConversationWorkflowStep`
- `ConversationWorkflowStepName`
- `ConversationWorkflowError`
- `run(request: dict[str, Any]) -> dict[str, Any]`

The workflow may use deterministic dataclasses or typed dictionaries. Prefer explicit, testable step execution over a large framework abstraction if `agent-framework` is not already available locally. If the Microsoft Agent Framework dependency is introduced, keep it confined to this package and ensure tests still run without model credentials.

### Error Guidance

Canonical error response fields:

- `traceId`: copied from the validated request when available; otherwise `unknown-trace`
- `errorCategory`: stable category, not a raw exception class
- `retryable`: boolean
- `fallbackAllowed`: boolean
- `message`: safe user/developer-facing summary

Do not include raw exception messages, stack traces, prompt text, Slack/user text, request payloads, auth headers, bearer tokens, service auth secrets, or environment values.

### Out Of Scope

- Read-only context tools or any `agent-service/src/agent_service/tools` package
- Python-to-TypeScript tool clients or internal API calls
- Real context loading from TypeScript, Postgres, Redis, Slack, or external services
- Model provider calls, prompts, agent personas, or LLM credentials
- Successful TypeScript `MafAgentRuntimeClient` HTTP execution
- Shadow diagnostics persistence or candidate/current comparison
- Canary behavior, rollout gates, routing changes, or dashboard/admin UI
- Railway service mutation, production deployment, root deployment files, or non-local shadow enablement
- Direct writes to memory, goals, risk records, scheduled actions, messages, surveys, manager analytics, runtime action commit paths, or domain aggregates

### Previous Story Intelligence

- Story 5.1 intentionally left `MafAgentRuntimeClient` disabled and fail-closed because `ProcessMessageRequest` still lacks canonical fields: `idempotencyKey`, `tenant`, `user`, `conversation.sessionKey`, `message.text`, `message.createdAt`, and `context`.
- Story 5.1 review found that diagnostic providers/recorders must never block TypeScript fallback and must receive only safe diagnostic payloads.
- Epic 4 review repeatedly found fail-closed and redaction gaps at service boundaries. Build tests for redaction and canonical error shape before broadening runtime behavior.
- Story 4.2 proved Python can validate the OpenAPI contract and return contract-valid JSON, but no workflow existed.
- Story 4.3 added scoped internal auth primitives; keep them detached until Story 5.3 owns read-only tools.
- Story 4.4 added runtime state primitives; keep them detached from `/runtime/process-message` until a later story explicitly owns sessions/checkpoints in workflow execution.
- Story 4.5 defined deployment metadata; do not perform operational deployment work here.

### Testing Requirements

- Tests must be local, deterministic, and free of live network/service dependencies.
- Use shared runtime fixtures from `packages/contracts/runtime/fixtures` for endpoint contract tests.
- Validate both success results and error responses against Python contract validators.
- Verify ordered step execution exactly; missing, skipped, duplicated, or reordered steps should fail a unit test.
- Verify redaction by forcing a step failure with sensitive-looking request text or exception content and asserting the API response remains safe.
- Keep scope-regression tests focused on the Epic 5 boundary. Allow only the new workflow skeleton and continue blocking future tools, shadow/canary execution, UI, deployment mutation, and aggregate writes.

### References

- `_bmad-output/planning-artifacts/epics.md` - Epic 5 Story 5.2 requirements.
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md` - AD-1 through AD-19 and MAF service structure.
- `_bmad-output/implementation-artifacts/epic-4-retro-2026-08-06.md` - Epic 4 lessons and E4 action items.
- `_bmad-output/implementation-artifacts/5-1-add-disabled-maf-agent-runtime-client.md` - disabled-client behavior and strict runtime-boundary gap.
- `agent-service/src/agent_service/api/runtime.py` - current runtime endpoint skeleton.
- `agent-service/src/agent_service/contracts/runtime_contract.py` - Python OpenAPI-backed runtime validators.
- `agent-service/tests/unit/test_runtime_endpoint.py` - existing endpoint tests to extend.
- `agent-service/tests/unit/test_scope.py` - scope-regression tests to update carefully.
- `agent-service/pyproject.toml` - Python package dependencies and static analysis configuration.
- `packages/application/src/use-cases/maf-agent-runtime-client.ts` - disabled TypeScript client that must remain fail-closed in this story.
- `docs/maf-runtime-client.md` - current MAF client non-enablement documentation.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story created after Story 5.1 was implemented, reviewed, fixed, and marked done.
- Loaded BMAD create-story workflow, config, sprint status, Epic 5 Story 5.2 requirements, architecture spine, Epic 4 retrospective, Story 5.1 record, current Python runtime endpoint, Python runtime contract validators, Python scope tests, Python service dependencies, disabled TypeScript MAF client, and runtime router context.
- Dev-story run used the existing `agent-service/.venv` Python 3.13.13 environment because the system `python3` points to Python 3.14 without pytest installed.
- Red phase confirmed new workflow tests failed on missing `agent_service.workflows`.
- Implemented deterministic workflow skeleton without adding `agent-framework` or any new dependency.

### Completion Notes

- Added `ConversationWorkflow` with explicit ordered steps for load context, classify intent, risk detection, memory extraction, deterministic policy application, response generation, follow-up planning, action validation, and result preparation.
- Wired `/runtime/process-message` to execute the skeleton after canonical request validation and to validate successful `RuntimeResult` payloads before returning.
- Added typed safe workflow errors and redacted unexpected exception handling through canonical `RuntimeErrorResponse`.
- Kept the skeleton side-effect free: no model calls, tool calls, runtime state access, internal auth usage, external clients, shadow/canary execution, or domain writes.
- Updated Epic 5 scope guardrails and agent-service README for the new workflow skeleton boundary.
- Review fixes normalized workflow error response status/retry/fallback/message by canonical category and stopped returning `ConversationWorkflowError.safe_message` verbatim.
- Review fixes expanded scope guardrails across all workflow modules and asserted the Story 5.1 TypeScript MAF client remains fail-closed without `/runtime/process-message` execution.

### File List

- `_bmad-output/implementation-artifacts/5-2-implement-maf-workflow-skeleton.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `agent-service/README.md`
- `agent-service/src/agent_service/api/runtime.py`
- `agent-service/src/agent_service/workflows/__init__.py`
- `agent-service/src/agent_service/workflows/conversation_workflow.py`
- `agent-service/tests/unit/test_conversation_workflow.py`
- `agent-service/tests/unit/test_runtime_endpoint.py`
- `agent-service/tests/unit/test_scope.py`

### Verification

- `cd agent-service && .venv/bin/python -m pytest tests/unit/test_conversation_workflow.py tests/unit/test_runtime_endpoint.py tests/unit/test_scope.py` - 18 passed, 1 existing Starlette/httpx deprecation warning.
- `cd agent-service && .venv/bin/python -m pytest tests/unit/test_conversation_workflow.py tests/unit/test_runtime_endpoint.py tests/unit/test_scope.py` - 19 passed, 1 existing Starlette/httpx deprecation warning after review fixes.
- `cd agent-service && .venv/bin/python -m pytest tests/unit/test_runtime_endpoint.py tests/unit/test_scope.py` - 15 passed, 1 existing Starlette/httpx deprecation warning.
- `cd agent-service && .venv/bin/python -m pytest tests/unit` - 54 passed, 1 existing Starlette/httpx deprecation warning after review fixes.
- `cd agent-service && .venv/bin/python -m ruff check .` - passed.
- `cd agent-service && .venv/bin/python -m mypy .` - passed.
- `pnpm --filter @entalent/application test -- src/use-cases/maf-agent-runtime-client` - 13 passed, 1 Vite CJS deprecation warning.
- `python3 packages/contracts/runtime/validate_fixtures.py` - runtime contract fixtures ok.
- `git diff --check` - passed.
- `ruby -e "require 'yaml'; YAML.load_file('_bmad-output/implementation-artifacts/sprint-status.yaml'); puts 'yaml ok'"` - passed.
- `codegraph status` - index up to date.
- `codegraph sync` - already up to date.

## Change Log

- 2026-08-06: Implemented deterministic Python workflow skeleton, endpoint wiring, safe canonical workflow errors, scope guardrails, tests, and docs for Story 5.2.
- 2026-08-06: Addressed BMAD code review findings for workflow error redaction, category-normalized error semantics, broader scope scanning, and fail-closed MAF client guardrails.

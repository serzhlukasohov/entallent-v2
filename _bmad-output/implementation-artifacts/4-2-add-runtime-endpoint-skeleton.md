---
baseline_commit: dce563c
---

# Story 4.2: Add Runtime Endpoint Skeleton

Status: done
Epic: 4 - Deployable Python Agent Service Foundation
Story ID: 4.2

## Story

As an engineer,
I want `POST /runtime/process-message` to validate the runtime contract,
so that TypeScript can integrate before full MAF orchestration exists.

## Acceptance Criteria

1. Given a valid `RuntimeProcessMessageRequest`, when it is posted to `/runtime/process-message`, then the service validates the request and returns a contract-valid stub or not-implemented `RuntimeResult`.
2. Given an invalid request, when it is posted to `/runtime/process-message`, then the service returns the canonical `RuntimeErrorResponse` shape.
3. Given validation fails before any side effect can happen, when the canonical error is returned, then `errorCategory` is `validation_error`, `retryable` is `false`, and `fallbackAllowed` is `false` according to the Story 2.6 error mapping.
4. Given this story is complete, when the diff is inspected, then no `MafAgentRuntimeClient`, MAF workflow or tools, scoped internal service auth, durable session/checkpoint backend, readiness endpoint, Docker/deployment envelope, non-local shadow or canary behavior, worker routing change, domain aggregate write path, or dashboard/admin UI has been added.

## Tasks / Subtasks

- [x] Add reusable Python runtime contract validation for the service boundary. (AC: 1, 2)
  - [x] Keep `packages/contracts/runtime/openapi.json` as the canonical schema source; do not create a second canonical schema in Python.
  - [x] Reuse or extract the existing validation behavior from `packages/contracts/runtime/validate_fixtures.py` where practical, preserving stable error categories such as `IDEMPOTENCY_KEY_INVALID`, `SESSION_IDENTITY_INVALID`, `ACTION_PROPOSAL_INVALID`, `CONTRACT_SCHEMA_INVALID`, and `RUNTIME_ERROR_CATEGORY_INVALID`.
  - [x] Validate `RuntimeProcessMessageRequest`, `RuntimeResult`, and `RuntimeErrorResponse` in Python tests against the shared fixture manifest.
  - [x] Keep Python validation local and deterministic; do not require model credentials, Redis, Postgres, Azure, LangWatch, Slack, or TypeScript service credentials.
- [x] Add `POST /runtime/process-message` skeleton under `agent-service`. (AC: 1, 4)
  - [x] Add a FastAPI route in `agent-service/src/agent_service/api/runtime.py` or an equivalent `runtime*` module and include it from `create_app()`.
  - [x] Validate the raw JSON request body against `RuntimeProcessMessageRequest` before returning a result.
  - [x] Return a contract-valid stub `RuntimeResult` with non-empty reply text, empty `memoryCandidates`, empty `proposedActions`, and diagnostics copied from the request (`traceId`, `runtimeAttempt`) with zero model/tool/retry counts.
  - [x] Do not import `agent-framework`, create workflows, call tools, call TypeScript APIs, write domain aggregates, persist sessions/checkpoints, or route worker traffic.
- [x] Add canonical validation error handling for invalid requests. (AC: 2, 3)
  - [x] Return HTTP 400 with `RuntimeErrorResponse` for malformed or schema-invalid request bodies.
  - [x] Use request `traceId` when it is present and non-empty; otherwise use a stable placeholder such as `unknown-trace`.
  - [x] Set `errorCategory: "validation_error"`, `retryable: false`, and `fallbackAllowed: false`.
  - [x] Include a safe diagnostic message that does not echo raw user message text or sensitive payload fields.
- [x] Update Story 4.1 scope regression tests for the new allowed endpoint. (AC: 4)
  - [x] Replace assertions that `agent-service/src/agent_service/api/runtime*` must not exist and `POST /runtime/process-message` must return 404 with checks that the endpoint exists but no out-of-scope MAF/auth/durable/client/router/UI/deploy files were introduced.
  - [x] Keep `/health/ready`, docs/OpenAPI route exposure, workflows, tools, Dockerfile/deployment envelope, `MafAgentRuntimeClient`, worker routing, shadow/canary, dashboard/admin UI, and aggregate write paths out of scope.
- [x] Add focused endpoint tests. (AC: 1-4)
  - [x] Test that the shared valid request fixture returns HTTP 200 and a response that validates as `RuntimeResult`.
  - [x] Test at least one invalid shared request fixture returns HTTP 400 and a response that validates as `RuntimeErrorResponse`.
  - [x] Test malformed JSON/non-object input is handled as the canonical validation error shape.
  - [x] Test the endpoint does not require external dependencies or configured secrets.
  - [x] Test the stub response has no proposed actions and no committed side effects.
- [x] Update developer docs. (AC: 1-4)
  - [x] Update `agent-service/README.md` with the runtime endpoint skeleton and local `curl` examples.
  - [x] Document that Story 4.2 remains skeleton-only and intentionally excludes MAF workflow, tools, internal auth, durable state, deployment envelope, TypeScript client, worker routing, shadow/canary, and UI.
- [x] Update implementation tracking. (AC: 1-4)
  - [x] Update this story's Dev Agent Record during implementation.
  - [x] Move sprint status from `ready-for-dev` to `in-progress` during dev-story and to `review` when implementation is complete.
- [x] Run and record verification. (AC: 1-4)
  - [x] Run Python unit tests for `agent-service`.
  - [x] Run the Python runtime fixture validation command for `packages/contracts/runtime`.
  - [x] Run ruff.
  - [x] Run mypy.
  - [x] Run a local liveness and runtime endpoint smoke check if the dev server can start in the sandbox.
  - [x] Run `git diff --check`.
  - [x] Run TypeScript contracts tests only if the canonical OpenAPI, shared fixtures, or TypeScript contract package behavior is changed; otherwise record why they were not needed.

### Review Findings

- [x] [Review][Patch] Manifest-driven contract tests are incomplete [`agent-service/tests/unit/test_runtime_contract.py:19`]
- [x] [Review][Patch] Scope regression tests do not cover all explicit AC4 exclusions [`agent-service/tests/unit/test_scope.py:7`]

## Dev Notes

### Current Architecture Context

- Story 4.2 is the first story where `POST /runtime/process-message` is in scope. It must stay an HTTP contract skeleton, not a MAF execution slice.
- AD-14 requires `packages/contracts/runtime/openapi.json` to remain the neutral OpenAPI 3.1 canonical runtime HTTP schema source. Python boundary validation must consume or align to that source and prove parity with shared fixtures.
- The existing Python validator at `packages/contracts/runtime/validate_fixtures.py` already validates the shared fixture manifest against OpenAPI and includes schema traversal, `$ref`, `oneOf`, object, array, string, number, integer, UUID, date-time, and action lifecycle checks. Prefer extracting/reusing this behavior over creating a divergent validator.
- `packages/contracts/src/runtime-contract-validation.ts` is the TypeScript counterpart and must remain framework-neutral. Do not import Python, FastAPI, or MAF types into TypeScript contracts.
- AD-3 keeps MAF imports inside `agent-service`; Story 4.2 should not import `agent-framework` at all unless doing so is strictly needed for the endpoint skeleton, which it is not.
- AD-16 scoped service auth starts in Story 4.3. Do not add credentials, internal service claims, endpoint allowlists, audit fields, or TypeScript internal API calls here.
- AD-19 deployment envelope starts in Story 4.5. Do not add Dockerfile, Railway service registration, readiness endpoint, internal URL, secret ownership matrix, or production start command in this story.
- Story 2.6 error mapping says malformed runtime request/result is `validation_error`, HTTP 400/422, `retryable: false`, and `fallbackAllowed: false`. This endpoint should return HTTP 400 and the canonical `RuntimeErrorResponse` shape for validation errors.

### Existing Repo State

- `agent-service/` exists from Story 4.1 with FastAPI app factory, `/health/live`, Pydantic settings, pytest, ruff, and mypy configuration.
- Story 4.1 review disabled FastAPI `/docs`, `/redoc`, and `/openapi.json`; keep those disabled unless a later story explicitly reopens docs.
- Story 4.1 scope tests currently forbid `api/runtime*` and `POST /runtime/process-message`. Story 4.2 must update those tests because the runtime endpoint is now allowed.
- Shared runtime fixtures live under `packages/contracts/runtime/fixtures/`; valid fixtures include `valid/process-message-request.json`, `valid/runtime-result.json`, and `valid/runtime-error-response.json`.
- The OpenAPI schema defines `RuntimeErrorResponse.errorCategory` values as lowercase contract categories: `unavailable`, `validation_error`, `timeout`, `duplicate_request`, `dependency_failed`, and `unsafe_partial_result`.

### Recommended File Structure For Story 4.2

```text
agent-service/
  src/agent_service/
    api/runtime.py
    contracts/
      __init__.py
      runtime_contract.py
  tests/unit/
    test_runtime_contract.py
    test_runtime_endpoint.py
```

Adjust if extraction from `packages/contracts/runtime/validate_fixtures.py` produces a better local shape, but keep service code under `agent-service/src/agent_service`.

### Runtime Skeleton Response

For a valid request, return a minimal contract-valid `RuntimeResult`:

```json
{
  "reply": {
    "text": "MAF runtime endpoint skeleton is not implemented yet.",
    "mode": "not_implemented"
  },
  "memoryCandidates": [],
  "proposedActions": [],
  "diagnostics": {
    "traceId": "<request.traceId>",
    "runtimeVersion": "agent-service-skeleton/0.1.0",
    "runtimeAttempt": <request.runtimeAttempt>,
    "modelCalls": 0,
    "toolCalls": 0,
    "latencyMs": 0,
    "retryCount": 0,
    "modelRetryCount": 0,
    "toolRetryCount": 0,
    "httpRetryCount": 0
  }
}
```

Validate this response against `RuntimeResult` before returning it, at least in tests. The stub must not propose or commit actions.

### Canonical Validation Error Response

For invalid JSON, non-object request bodies, or schema validation failures, return HTTP 400:

```json
{
  "traceId": "<request.traceId when safely present, else unknown-trace>",
  "errorCategory": "validation_error",
  "retryable": false,
  "fallbackAllowed": false,
  "message": "Runtime request failed contract validation."
}
```

The response itself must validate against `RuntimeErrorResponse`. Do not include raw Slack message text, memory content, goal titles, or full JSON payloads in the message.

### Out Of Scope

- `MafAgentRuntimeClient`
- TypeScript worker routing changes or non-local shadow execution
- canary behavior
- MAF workflow, agents, or tools
- read/write context tools
- scoped internal service auth or TypeScript internal API calls
- durable session/checkpoint backend
- readiness endpoint
- Dockerfile, Railway service registration, production start command, internal URL, env var matrix, or secret ownership matrix
- dashboard/admin UI
- direct writes to memory, goals, risk records, scheduled actions, messages, surveys, or manager analytics

### Previous Story Intelligence

- Story 4.1 established the Python package namespace `agent_service`, FastAPI app factory in `agent-service/src/agent_service/main.py`, health router pattern under `agent_service.api`, and dependency-light Pydantic settings.
- Story 4.1 review found and fixed two relevant guardrails: route surface must stay minimal, and scope regression tests must evolve as each planned story intentionally allows a new surface.
- The local Python toolchain used for Story 4.1 was Python 3.13.13, while `.python-version` is set to `3.13.13`. Keep checks under Python 3.13.x.
- Existing `agent-service/.venv` has FastAPI `0.141.1`, Pydantic `2.13.4`, pydantic-settings `2.14.2`, pytest `8.4.2`, ruff `0.12.12`, mypy `1.20.2`, and uvicorn `0.35.0` installed from Story 4.1.
- Worktree note: Story 4.1 review fixes are currently uncommitted on top of `dce563c`. Do not revert them; build Story 4.2 on the current working tree unless the user asks for a different git hygiene step.

### Testing Requirements

- Tests must be local and deterministic.
- Endpoint tests must use FastAPI `TestClient` or an equivalent ASGI client; no network, model, Redis, Postgres, Slack, Azure, LangWatch, or TypeScript service credentials.
- Run the shared Python fixture validation command from `packages/contracts`: `python3 runtime/validate_fixtures.py`, or an equivalent Python 3.13 invocation.
- If modifying `packages/contracts/runtime/openapi.json`, shared fixtures, or TypeScript contracts, run the relevant contracts package tests sequentially; do not race builds that clean shared `dist` directories.
- Keep Story 4.2 scope regression tests failing if any of these appear: `packages/application/src/use-cases/maf-agent-runtime-client.ts`, `agent-service/src/agent_service/workflows/`, `agent-service/src/agent_service/tools/`, `agent-service/Dockerfile`, `apps/dashboard/src/*shadow*`, worker routing to the Python service, `/health/ready`, scoped auth modules, durable session/checkpoint modules, or aggregate write paths.

### References

- `_bmad-output/planning-artifacts/epics.md` - Epic 4 Story 4.2 requirements and FR7/FR8 mapping.
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md` - AD-3, AD-14, AD-16, AD-19, stack, and structure conventions.
- `_bmad-output/specs/spec-maf-runtime-migration/SPEC.md` - CAP-2 constraints, non-goals, and success signal.
- `_bmad-output/specs/spec-maf-runtime-migration/runtime-contract.md` - target HTTP runtime request/result/error contract.
- `_bmad-output/implementation-artifacts/2-6-define-runtime-retry-budget-and-error-mapping.md` - validation error category and fallback eligibility mapping.
- `_bmad-output/implementation-artifacts/4-1-scaffold-agent-service.md` - previous story patterns and review fixes.
- `_bmad-output/implementation-artifacts/epic-3-retro-2026-08-06.md` - Epic 4 preparation notes.
- `packages/contracts/runtime/openapi.json` - canonical runtime HTTP schema source.
- `packages/contracts/runtime/fixtures/manifest.json` - shared cross-language fixture baseline.
- `packages/contracts/runtime/validate_fixtures.py` - existing Python OpenAPI fixture validator.
- `packages/contracts/src/runtime-contract-validation.ts` - TypeScript OpenAPI validation counterpart for parity.
- `agent-service/src/agent_service/main.py` - FastAPI app factory to include the runtime router.
- `agent-service/src/agent_service/api/health.py` - existing route module pattern.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story created after Story 4.1 was marked done in BMAD tracking.
- Loaded BMAD create-story workflow, config, sprint status, Epic 4 Story 4.2 requirements, architecture spine, SPEC, runtime-contract companion, Story 2.6 error mapping references, Epic 3 retrospective, Story 4.1, OpenAPI schema, fixture manifest, TypeScript validator, Python fixture validator, and recent git history.
- No `project-context.md` was found.
- No new external package research was required for story creation because Story 4.2 can use the existing Python 3.13/FastAPI/Pydantic toolchain and repo-owned OpenAPI validator behavior without adding new dependencies.
- Started dev-story implementation from baseline `dce563c` on a dirty worktree containing uncommitted Story 4.1 review fixes.
- RED verification: `.venv/bin/python -m pytest` failed during collection because `agent_service.contracts` did not exist yet.
- Implemented `agent_service.contracts.runtime_contract` as an OpenAPI-backed Python validator aligned to the existing `packages/contracts/runtime/validate_fixtures.py` behavior.
- Implemented `agent_service.api.runtime` with raw JSON validation, contract-valid stub response, and canonical validation error response.
- Verification: `.venv/bin/python -m pytest` passed with 16 tests; FastAPI emitted the existing non-blocking Starlette `httpx` deprecation warning.
- Verification: `.venv/bin/python -m ruff check .` passed.
- Verification: `.venv/bin/python -m mypy src tests` passed.
- Verification: `python3 runtime/validate_fixtures.py` passed from `packages/contracts`.
- Verification: local `uvicorn` smoke required sandbox escalation for local port binding; `/health/live` returned healthy, valid `POST /runtime/process-message` returned the not-implemented stub, invalid request returned the canonical validation error, and `/openapi.json` returned 404.
- Verification: `git diff --check` passed.
- TypeScript contracts tests were not run because Story 4.2 did not modify `packages/contracts/runtime/openapi.json`, shared fixtures, TypeScript contract source, or package metadata.
- BMAD code review found two scoped patch items: incomplete manifest-driven contract test coverage and incomplete AC4 scope regression guard coverage.
- Review verification: `.venv/bin/python -m pytest` passed with 18 tests; FastAPI emitted the existing non-blocking Starlette `httpx` deprecation warning.
- Review verification: `.venv/bin/python -m ruff check .` passed.
- Review verification: `.venv/bin/python -m mypy src tests` passed.
- Review verification: `python3 runtime/validate_fixtures.py` passed from `packages/contracts`.
- Review verification: `git diff --check` passed.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Story 4.2 is ready for dev-story implementation.
- Scope explicitly permits `POST /runtime/process-message` and contract validation only, while forbidding client wiring, MAF workflow/tools, auth, durable state, deployment envelope, readiness, shadow/canary, router, UI, and aggregate writes.
- Added the FastAPI runtime endpoint skeleton and OpenAPI-backed Python runtime contract validator.
- Added endpoint and contract tests for valid fixtures, invalid fixtures, malformed JSON, non-object JSON, external-dependency independence, and no proposed side effects.
- Updated Story 4.1 scope guards to allow the planned runtime endpoint while preserving out-of-scope protections.
- Updated README with runtime endpoint skeleton usage and exclusions.
- Review patches expanded service contract tests to iterate the shared fixture manifest and strengthened AC4 scope guards for auth, durable state, deployment, readiness, aggregate writes, and new shadow/canary surfaces.

### File List

- `_bmad-output/implementation-artifacts/4-2-add-runtime-endpoint-skeleton.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `agent-service/README.md`
- `agent-service/src/agent_service/api/__init__.py`
- `agent-service/src/agent_service/api/runtime.py`
- `agent-service/src/agent_service/contracts/__init__.py`
- `agent-service/src/agent_service/contracts/runtime_contract.py`
- `agent-service/src/agent_service/main.py`
- `agent-service/tests/unit/test_health.py`
- `agent-service/tests/unit/test_runtime_contract.py`
- `agent-service/tests/unit/test_runtime_endpoint.py`
- `agent-service/tests/unit/test_scope.py`

### Change Log

- 2026-08-06: Created Story 4.2 developer context from Epic 4, architecture spine, SPEC/runtime-contract, Story 2.6 error mapping, Epic 3 retrospective, Story 4.1 learnings, and current runtime contract fixtures.
- 2026-08-06: Implemented runtime endpoint skeleton, OpenAPI-backed validation, canonical validation error responses, tests, docs, and verification for Story 4.2.
- 2026-08-06: Addressed BMAD code review findings and marked Story 4.2 done.

---
baseline_commit: dce563c5366311a340b0b7f5c30ddddb34d81ad2
---

# Story 8.1: Run Local Live MAF Model Validation

Status: done
Epic: 8 - Fast-Track Live MAF Validation
Story ID: 8.1

## Story

As a migration owner,
I want a repeatable local live validation harness for the opt-in Microsoft Agent Framework model path,
so that we can prove real MAF-generated candidate replies before deciding whether any user-facing routing change is warranted.

## Acceptance Criteria

1. Given `agent-service` has no live provider env vars, when the live validation harness is run, then it exits without external network calls and reports the exact missing configuration keys without printing secrets, request payloads, prompts, or raw user text.
2. Given valid OpenAI or Azure OpenAI env vars are present, when the harness runs, then it exercises the existing `/runtime/process-message` candidate path through Microsoft Agent Framework `Agent` model execution and verifies a contract-valid `RuntimeResult` with `diagnostics.modelCalls: 1`.
3. Given the live validation receives a runtime response, when it records output, then the evidence is redacted and limited to stable fields: runtime version, trace ID, model/tool/retry counts, risk severity, action count, memory candidate count, validation status, and a reply digest or length only.
4. Given the live provider fails, times out, returns empty text, or returns unsafe output, when the harness handles the response, then it reports a safe failure classification without provider response bodies, stack traces, bearer tokens, service secrets, raw Slack/user text, memory content, risk evidence, or action payloads.
5. Given this story is complete, when the diff is inspected, then it must not enable user-facing `maf_canary`, alter TypeScript runtime routing semantics, add Python-owned writes, add command tools, add `agent-framework-hosting`, mutate deployment/Railway config, or add dashboard/admin UI.
6. Given a developer reads the docs, when they want to test the MAF model path, then they can run one documented local command for OpenAI or Azure OpenAI and understand that the result remains candidate-only and non-user-facing.

## Tasks / Subtasks

- [x] Add a live validation harness under `agent-service`. (AC: 1, 2, 3, 4, 5)
  - [x] Add a script or test entrypoint that reuses the existing FastAPI app/runtime endpoint path rather than duplicating workflow logic.
  - [x] Detect `AGENT_SERVICE_MODEL_PROVIDER`, `AGENT_SERVICE_MODEL_NAME`, and provider-specific credentials before making any outbound call.
  - [x] Support `openai` and `azure_openai` using the same settings aliases Story 7.2 introduced.
  - [x] Use the canonical valid fixture from `packages/contracts/runtime/fixtures/valid/process-message-request.json` or a narrowly redacted local fixture derived from it.
  - [x] Ensure missing config returns a clear non-secret diagnostic and does not instantiate a live provider client.
- [x] Validate and redact live smoke output. (AC: 2, 3, 4)
  - [x] Validate successful responses with the existing Python runtime contract validator.
  - [x] Assert `diagnostics.modelCalls == 1` for provider-enabled success.
  - [x] Assert proposed actions remain uncommitted: `executionStatus` is `not_started` or `blocked`, and `commitMarker` is `null`.
  - [x] Emit only stable redacted evidence fields and a reply digest or length, never raw candidate text.
  - [x] Map `RuntimeErrorResponse` outcomes to safe local smoke failures without leaking provider details.
- [x] Add automated coverage for the harness behavior without live credentials. (AC: 1, 3, 4, 5)
  - [x] Add tests for missing OpenAI config and missing Azure config.
  - [x] Add tests proving output redaction excludes raw message text, prompts, secrets, provider bodies, stack traces, and action payloads.
  - [x] Add tests using a fake app/client response to prove success evidence includes `modelCalls: 1` and excludes raw reply text.
  - [x] Extend scope tests if needed to keep this story free of canary routing changes, Python writes, command tools, hosting helpers, deployment mutation, and UI.
- [x] Update docs and tracking. (AC: 1-6)
  - [x] Update `agent-service/README.md` with the live validation command and env examples for OpenAI and Azure OpenAI.
  - [x] Update `docs/maf-runtime-client.md` to clarify that Story 8.1 proves local/staging live candidate behavior only.
  - [x] Update this story's Dev Agent Record during implementation.
  - [x] Move sprint status to `in-progress` during implementation and `review` when complete.
- [x] Run and record verification. (AC: 1-6)
  - [x] Run focused Python tests for the live validation harness.
  - [x] Run focused Python scope tests.
  - [x] Run full `agent-service` pytest.
  - [x] Run `python -m ruff check .` in `agent-service`.
  - [x] Run `python -m mypy src tests` in `agent-service`.
  - [x] Run `pnpm --filter @entalent/application test -- src/use-cases/agent-runtime-router.test.ts` to prove router semantics remain unchanged.
  - [x] Run `git diff --check`.
  - [x] Parse sprint status YAML.

### Review Findings

- [x] [Review][Patch] HTTP error responses with RuntimeResult-shaped JSON could pass live smoke validation [agent-service/src/agent_service/smoke/live_model.py:100]
- [x] [Review][Patch] Proposed actions with `executionStatus: "failed"` were not treated as side-effect boundary failures [agent-service/src/agent_service/smoke/live_model.py:204]
- [x] [Review][Patch] Unsafe trace IDs could be emitted in redacted smoke evidence [agent-service/src/agent_service/smoke/live_model.py:218]
- [x] [Review][Patch] Settings validation errors could escape the CLI instead of returning safe configuration evidence [agent-service/src/agent_service/smoke/live_model.py:60]
- [x] [Review][Patch] Success evidence reported `runtimeVersion: "unknown"` because runtime version lives under diagnostics [agent-service/src/agent_service/smoke/live_model.py:185]
- [x] [Review][Patch] Missing-config default-provider no-call behavior and in-process endpoint path lacked focused coverage [agent-service/tests/unit/test_live_model_smoke.py:17]

## Dev Notes

### Current Architecture Context

- Epic 7 completed the planned Microsoft Agent Framework adoption: Story 7.1 uses MAF core workflow primitives; Story 7.2 uses a MAF `Agent` path when a provider is explicitly enabled.
- The product lead has accepted a fast-track validation path because there are no real users yet. This permits quicker local/staging evidence collection, but does not permit Python writes, ownership transfer, or accidental user-facing `maf_canary`.
- AD-2 keeps TypeScript as first-slice side-effect owner.
- AD-3 confines `agent-framework` imports to `agent-service`.
- AD-4 keeps the first transport JSON HTTP.
- AD-10 keeps deterministic policy above agent output.
- AD-11 keeps `agent-framework-hosting` out of the first service slice.
- AD-13 keeps runtime mode selection in the TypeScript router.
- AD-18 keeps shadow diagnostics TypeScript-owned.
- AD-19 still requires deployment readiness before non-local shadow or canary exposure.

### Existing Code To Reuse

- `agent-service/src/agent_service/main.py` creates the FastAPI app.
- `agent-service/src/agent_service/api/runtime.py` owns `/runtime/process-message` and model-client construction through settings.
- `agent-service/src/agent_service/infrastructure/settings.py` owns provider env parsing and aliases.
- `agent-service/src/agent_service/workflows/model_provider.py` owns the MAF `Agent` provider adapter and unsafe-output protections.
- `agent-service/src/agent_service/workflows/conversation_workflow.py` owns runtime result generation and diagnostics.
- `agent-service/tests/unit/test_runtime_endpoint.py` already exercises the endpoint through FastAPI `TestClient`.
- `agent-service/tests/unit/test_model_provider.py` covers model output parsing and unsafe output.
- `agent-service/tests/unit/test_scope.py` contains migration boundary guardrails.
- `packages/contracts/runtime/fixtures/valid/process-message-request.json` is the canonical valid request fixture.
- `docs/maf-runtime-client.md` and `agent-service/README.md` are the user-facing local validation docs.

### Implementation Guidance

Prefer a small `agent-service` script with an injectable HTTP/app runner over a new service route. The harness should call the existing runtime endpoint shape, validate the response, and print redacted evidence. Do not add a separate model invocation path that bypasses `runtime.py` or `ConversationWorkflow`.

Recommended shape:

```text
agent-service/scripts/live_model_smoke.py
  -> load AgentServiceSettings
  -> verify provider env completeness
  -> call existing FastAPI app or configured local URL /runtime/process-message
  -> validate RuntimeResult or RuntimeErrorResponse
  -> print redacted JSON evidence
```

Use tests with fake responses or monkeypatched client calls. Do not require live credentials in CI. A real live run should be manual and opt-in through env vars.

If using the in-process FastAPI app path, keep the script isolated from pytest fixtures so it can be run directly by a developer. If using HTTP, default to `http://127.0.0.1:8001` and document that the developer must start `uvicorn` first.

### Out Of Scope

- User-facing MAF replies or changing `maf_canary` router behavior.
- Python-owned persistence or writes to messages, risk, memory, goals, follow-ups, survey evidence, ledgers, runtime-control flags, diagnostics, baseline evidence, or Slack.
- Command tools, write APIs, provider tools that can mutate external systems, streaming, dashboard/admin UI, deployment mutation, Railway mutation, or ownership transfer.
- `agent-framework-hosting`.
- Hard-coding real provider credentials or test prompts into the repository.

### Testing Requirements

- Tests must pass with no live credentials and no network access.
- Missing-config tests must prove no external provider call is attempted.
- Redaction tests must prove raw request text, raw candidate text, prompts, secrets, tokens, provider bodies, stack traces, memory content, risk evidence, and action payloads are not printed.
- Success tests may use fake responses, but they must assert the same evidence fields that the real live smoke command will print.
- Contract validation must use the existing Python runtime contract helpers, not a new ad hoc schema.

### Previous Story Intelligence

- Story 7.2 review found that live model paths need a timeout around MAF Agent execution, whitespace config normalization, direct user-text echo rejection, and OpenAI-compatible `content_filter` rejection. Preserve those protections and cover smoke evidence around them.
- Story 7.2 deliberately dismissed retry/fallback flags from raised workflow errors because endpoint error responses are normalized by canonical error category. Do not undo Story 5.2 hardening.
- Story 7.2 restored `OTEL_SERVICE_NAME` compatibility; avoid unrelated settings regressions.
- Story 7.1 review fixed active-event-loop behavior and concurrent workflow execution state. Do not introduce a smoke harness that calls sync workflow methods from an already running event loop.

### Git Intelligence

- Recent commits in this branch created and implemented the `agent-service` scaffold, while later uncommitted migration work added the runtime endpoint, internal auth, state, MAF client, shadow integration, canary gates, MAF core workflow, and opt-in model provider.
- The current worktree is intentionally noisy. Keep Story 8.1 changes scoped to the new live validation harness, tests, docs, story file, and sprint status.

### Latest Technical Notes

- Local package inspection in Story 7.2 found `agent-framework-core==1.13.0` with `Agent`, `BaseChatClient`, and `Message` available.
- `agent-framework-openai` provider package compatibility should not be assumed or hard-pinned in this story. Continue using the existing OpenAI-compatible chat client unless local dependency reality changes in a reviewed story.
- Microsoft Agent Framework remains confined to Python `agent-service`; do not add MAF imports to TypeScript packages.

### References

- `_bmad-output/implementation-artifacts/epic-7-retro-2026-08-07.md`
- `_bmad-output/implementation-artifacts/7-2-add-opt-in-maf-agent-model-provider-path-for-local-testing.md`
- `_bmad-output/implementation-artifacts/7-1-replace-deterministic-python-workflow-skeleton-with-microsoft-agent-framework-core-workflow.md`
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md`
- `_bmad-output/planning-artifacts/epics.md`
- `agent-service/src/agent_service/api/runtime.py`
- `agent-service/src/agent_service/infrastructure/settings.py`
- `agent-service/src/agent_service/workflows/model_provider.py`
- `agent-service/src/agent_service/workflows/conversation_workflow.py`
- `agent-service/tests/unit/test_runtime_endpoint.py`
- `agent-service/tests/unit/test_model_provider.py`
- `agent-service/tests/unit/test_scope.py`
- `agent-service/README.md`
- `docs/maf-runtime-client.md`
- `packages/contracts/runtime/fixtures/valid/process-message-request.json`

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-08-07: Story created after Epic 7 retrospective identified local live MAF model validation as the next fast-track migration slice.
- 2026-08-07: Started dev-story implementation; status moved to in-progress.
- 2026-08-07: RED focused smoke tests failed because `agent_service.smoke.live_model` did not exist.
- 2026-08-07: Implemented in-process FastAPI smoke harness with config preflight, runtime contract validation, redacted evidence, safe runtime-error evidence, and side-effect boundary detection.
- 2026-08-07: Verification completed; story moved to review.
- 2026-08-07: BMAD code review found HTTP error false-positive, action lifecycle, unsafe trace ID, settings validation, runtime version, and focused coverage findings; patches applied and verified.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Added `agent_service.smoke.live_model` and `scripts/live_model_smoke.py` for local live provider validation through the existing `/runtime/process-message` route.
- Missing model config now reports stable missing key names and exits before provider/network calls.
- Successful smoke responses validate `RuntimeResult`, require `diagnostics.modelCalls: 1`, reject committed proposed actions, and emit only redacted evidence with reply digest/length.
- Runtime error responses are reported as safe classifications without canonical error messages, raw text, provider bodies, stack traces, secrets, memory content, risk evidence, or action payloads.
- Updated docs for OpenAI/Azure smoke commands and candidate-only semantics.
- Review fixes now reject all HTTP status failures before success validation, reject every proposed action state except `not_started` or `blocked`, sanitize trace IDs/reason codes in evidence, catch settings validation failures, report `diagnostics.runtimeVersion`, and cover the in-process endpoint path.

### Change Log

- 2026-08-07: Created Story 8.1 as ready for development.
- 2026-08-07: Started Story 8.1 implementation.
- 2026-08-07: Implemented local live MAF model validation harness and moved Story 8.1 to review.
- 2026-08-07: Addressed BMAD code review findings and moved Story 8.1 to done.

### File List

- `_bmad-output/implementation-artifacts/8-1-run-local-live-maf-model-validation.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `agent-service/scripts/live_model_smoke.py`
- `agent-service/src/agent_service/smoke/__init__.py`
- `agent-service/src/agent_service/smoke/live_model.py`
- `agent-service/tests/unit/test_live_model_smoke.py`
- `agent-service/tests/unit/test_scope.py`
- `agent-service/README.md`
- `docs/maf-runtime-client.md`

### Verification

- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python -m pytest tests/unit/test_live_model_smoke.py` - RED failed as expected before implementation, then passed (6 tests).
- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python -m pytest tests/unit/test_live_model_smoke.py tests/unit/test_scope.py::test_story_8_1_live_smoke_harness_stays_candidate_only` - passed (7 tests).
- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python -m pytest` - passed (100 tests, existing Starlette/httpx TestClient deprecation warning).
- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python -m ruff check .` - passed.
- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python -m mypy src tests` - passed.
- `pnpm --filter @entalent/application test -- src/use-cases/agent-runtime-router.test.ts` - passed (37 tests, existing Vite CJS deprecation warning).
- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python scripts/live_model_smoke.py` - exited with code 2 and redacted `configuration_missing` evidence as expected without provider env vars.
- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python -m pytest tests/unit/test_live_model_smoke.py` - passed after review fixes (13 tests).
- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python -m pytest tests/unit/test_live_model_smoke.py tests/unit/test_scope.py::test_story_8_1_live_smoke_harness_stays_candidate_only` - passed after review fixes (14 tests).
- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python -m pytest` - passed after review fixes (107 tests, existing Starlette/httpx TestClient deprecation warning).
- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python -m ruff check .` - passed after review fixes.
- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python -m mypy src tests` - passed after review fixes.
- `pnpm --filter @entalent/application test -- src/use-cases/agent-runtime-router.test.ts` - passed after review fixes (37 tests, existing Vite CJS deprecation warning).

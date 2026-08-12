---
baseline_commit: dce563c
---

# Story 7.1: Replace Deterministic Python Workflow Skeleton With Microsoft Agent Framework Core Workflow

Status: done
Epic: 7 - Microsoft Agent Framework Runtime Adoption
Story ID: 7.1

## Story

As a migration owner,
I want the Python conversation workflow to run through Microsoft Agent Framework core primitives,
so that the migration target is the planned MAF runtime rather than a hand-rolled deterministic workflow runner.

## Acceptance Criteria

1. Given `agent-service` starts locally, when dependencies are installed, then Microsoft Agent Framework core is an explicit runtime dependency confined to `agent-service`.
2. Given `/runtime/process-message` receives a valid runtime request, when the Python workflow runs, then it executes through a Microsoft Agent Framework core workflow adapter while preserving the existing OpenAPI request/result contract.
3. Given the framework workflow completes, when the result is returned, then existing candidate reply, risk assessment, memory candidates, proposal-only actions, and diagnostics remain contract-valid and deterministic in tests.
4. Given this story is complete, when the diff is inspected, then it must not enable user-facing `maf_canary`, Python-owned writes, command tools, model provider calls, `agent-framework-hosting`, dashboard/admin UI, deployment mutation, or ownership transfer.
5. Given framework or step execution fails, when an error is returned, then the response remains a safe canonical `RuntimeErrorResponse` without raw Slack/user text, prompts, bearer tokens, service secrets, full payloads, stack traces, provider errors, risk evidence, memory content, or action payloads.

## Tasks / Subtasks

- [x] Add Microsoft Agent Framework core dependency inside `agent-service` only. (AC: 1, 4)
  - [x] Add a narrow `agent-framework-core` dependency compatible with the Python 3.13 service target.
  - [x] Do not add `agent-framework-hosting`, provider extras, model SDKs, credentials, or shared TypeScript dependencies.
  - [x] Add a focused dependency/scope test proving `agent_framework` imports are used only under `agent-service`.
- [x] Introduce a framework workflow adapter around the existing deterministic steps. (AC: 2, 3, 5)
  - [x] Keep `ConversationWorkflow.run` and `run_async` public behavior stable for `api/runtime.py` and tests.
  - [x] Build the default step execution through an `agent_framework` core workflow abstraction or adapter class.
  - [x] Preserve injected `ContextTool` behavior and `toolCalls` accounting.
  - [x] Preserve safe error mapping for framework and step failures.
- [x] Preserve migration boundaries. (AC: 3, 4, 5)
  - [x] Keep `modelCalls` at `0` in deterministic tests and do not add provider credentials or live model calls.
  - [x] Keep all proposed actions uncommitted with `executionStatus` of `not_started` or `blocked`.
  - [x] Keep TypeScript as the side-effect owner and do not add Python repositories, domain aggregate writes, Slack sends, or action commits.
  - [x] Keep `maf_canary` TypeScript-only; do not change runtime routing or staged rollout enablement.
- [x] Update docs and tracking. (AC: 1-5)
  - [x] Update `agent-service/README.md` to say the workflow now uses Microsoft Agent Framework core with deterministic local steps.
  - [x] Update `docs/maf-runtime-client.md` to clarify that MAF core is active only in the Python shadow candidate path.
  - [x] Update this story's Dev Agent Record during implementation.
  - [x] Move sprint status to `in-progress` during implementation and `review` when complete.
- [x] Run and record verification. (AC: 1-5)
  - [x] Run focused Python workflow tests.
  - [x] Run focused Python scope tests.
  - [x] Run full `agent-service` pytest.
  - [x] Run `python -m ruff check .` in `agent-service`.
  - [x] Run `python -m mypy src tests` in `agent-service`.
  - [x] Run `pnpm --filter @entalent/application test -- src/use-cases/agent-runtime-router.test.ts` to prove `maf_canary` remains TypeScript-only.
  - [x] Run `git diff --check`.
  - [x] Parse sprint status YAML.

### Review Findings

- [x] [Review][Patch] Unsafe trace IDs could be echoed in runtime error responses [agent-service/src/agent_service/api/runtime.py:101]
- [x] [Review][Patch] `ConversationWorkflow.run` raised raw `RuntimeError` when called inside an active event loop [agent-service/src/agent_service/workflows/conversation_workflow.py:106]
- [x] [Review][Patch] Concurrent `run_async` calls on one workflow instance could interleave executed-step state [agent-service/src/agent_service/workflows/conversation_workflow.py:610]
- [x] [Review][Patch] Direct workflow callers could receive a contract-invalid runtime result [agent-service/src/agent_service/workflows/conversation_workflow.py:561]
- [x] [Review][Dismissed] Workflow error retry/fallback flags are normalized by canonical error category rather than trusted from raised errors; this preserves the Story 5.2 review hardening.
- [x] [Review][Dismissed] Custom `load_context` steps are bypassed when a context tool is injected; this is pre-existing Story 5.3 behavior and outside Story 7.1 MAF core adoption.

## Dev Notes

### Current Architecture Context

- AD-3 allows `agent-framework` imports only inside `agent-service`; shared TypeScript packages must remain framework-neutral.
- AD-11 requires FastAPI-owned routes over stable core `agent-framework`; `agent-framework-hosting` helpers remain deferred.
- AD-13 keeps runtime mode selection in the TypeScript router. This story must not enable user-facing `maf_canary`.
- AD-15 keeps fallback forbidden after committed side effects. This story must not add committed side effects.
- AD-18 keeps shadow diagnostics TypeScript-owned. Python returns candidates only.
- AD-19 deployment evidence remains required before non-local shadow/canary exposure. This story must not mutate deployment.

### Existing Code To Reuse

- `agent-service/src/agent_service/workflows/conversation_workflow.py` owns the current deterministic workflow and is the primary implementation target.
- `agent-service/src/agent_service/api/runtime.py` builds `ConversationWorkflow` and must keep the `/runtime/process-message` contract stable.
- `agent-service/tests/unit/test_conversation_workflow.py` already validates deterministic result shape, safe privacy behavior, tool context behavior, and proposal-only actions.
- `agent-service/tests/unit/test_scope.py` contains migration guardrails and should gain the MAF core confinement checks.
- `agent-service/pyproject.toml` owns Python dependencies.
- `docs/maf-runtime-client.md` and `agent-service/README.md` describe runtime behavior.

### Implementation Guidance

Prefer an adapter that keeps the current public workflow stable:

```text
ConversationWorkflow
  -> MicrosoftAgentFrameworkWorkflowRunner
     -> existing ConversationWorkflowStep list
```

The purpose of this story is to put Microsoft Agent Framework core in the execution path without changing product behavior. Keep the deterministic step handlers as the testable business logic until a later provider/model story exists.

If the installed framework API is lower-level than expected, create a narrow adapter module that imports `agent_framework`, records the framework package/version in diagnostics, and runs the existing ordered steps through that adapter. Do not fake the dependency by leaving imports unused.

### Out Of Scope

- `agent-framework-hosting`.
- OpenAI/Azure/model provider calls, prompts, personas, streaming, or live credentials.
- User-facing MAF replies or enabling `maf_canary` output.
- Python-owned persistence or writes to messages, risk, memory, goals, follow-ups, survey evidence, ledgers, runtime-control flags, diagnostics, baseline evidence, or Slack.
- Dashboard/admin UI, new feature-flag APIs, rollout mutation, Docker/Railway deployment mutation, or ownership transfer.

### Testing Requirements

- Tests must run locally with Python 3.13 and no live credentials.
- Add a RED test that fails while `agent_framework` is not installed or not used in the workflow execution path.
- Existing runtime-result fixtures and contract validators must keep passing.
- Serialization tests must continue proving raw text, secrets, tokens, stack traces, and full payloads are absent.

### References

- `_bmad-output/implementation-artifacts/epic-6-retro-2026-08-07.md` - action item E6-A3 and next-step framing.
- `_bmad-output/implementation-artifacts/5-2-implement-maf-workflow-skeleton.md` - prior deterministic skeleton and optional MAF dependency decision.
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md` - AD-3, AD-11, AD-13, AD-15, AD-18, AD-19.
- `agent-service/src/agent_service/workflows/conversation_workflow.py` - primary implementation target.
- `agent-service/tests/unit/test_conversation_workflow.py` - primary workflow tests.
- `agent-service/tests/unit/test_scope.py` - migration boundary guardrails.
- `agent-service/README.md` - service behavior documentation.
- `docs/maf-runtime-client.md` - TypeScript/Python runtime boundary documentation.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story created after Epic 6 retrospective identified the real Microsoft Agent Framework core workflow as the next migration step.
- 2026-08-07: Started dev-story implementation; status moved to in-progress.
- 2026-08-07: RED focused tests failed because `ConversationWorkflow` had no `framework_name`, `agent-framework-core` was not declared, and no MAF core runner existed.
- 2026-08-07: Installed `agent-framework-core==1.13.0` into the local Python 3.13 venv and inspected `WorkflowBuilder`, `Executor`, `WorkflowContext`, and `handler` APIs.
- 2026-08-07: Implemented `MicrosoftAgentFrameworkWorkflowRunner` and `MicrosoftAgentFrameworkConversationExecutor` using MAF core graph workflow primitives.
- 2026-08-07: Verification completed; story moved to review.
- 2026-08-07: BMAD code review found event-loop, concurrent run state, direct output validation, and unsafe trace ID findings; patches applied and verified. Retry/fallback flag and injected context-step findings were dismissed because they are intentional or pre-existing behavior outside Story 7.1.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Added `agent-framework-core>=1.13,<1.14` as an `agent-service` runtime dependency.
- Replaced direct hand-rolled default step execution with a Microsoft Agent Framework core `WorkflowBuilder` runner and executor.
- Preserved the existing `/runtime/process-message` OpenAPI contract, deterministic candidate behavior, injected read-only context tool behavior, proposal-only actions, and zero model calls.
- Updated safe runtime error wording and docs from workflow skeleton to MAF core workflow.
- Preserved migration boundaries: no `agent-framework-hosting`, no provider/model credentials, no Python writes, no runtime routing changes, and `maf_canary` remains TypeScript-only.
- Review fixes now reject sync `run()` inside active event loops with a safe `ConversationWorkflowError`, serialize concurrent `run_async` calls on one workflow instance, validate direct workflow `RuntimeResult` output, and sanitize unsafe trace IDs to `unknown-trace` in runtime error responses.

### File List

- `_bmad-output/implementation-artifacts/7-1-replace-deterministic-python-workflow-skeleton-with-microsoft-agent-framework-core-workflow.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `agent-service/pyproject.toml`
- `agent-service/src/agent_service/workflows/conversation_workflow.py`
- `agent-service/src/agent_service/api/runtime.py`
- `agent-service/tests/unit/test_conversation_workflow.py`
- `agent-service/tests/unit/test_runtime_endpoint.py`
- `agent-service/tests/unit/test_scope.py`
- `agent-service/README.md`
- `docs/maf-runtime-client.md`

### Verification

- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python -m pytest tests/unit/test_conversation_workflow.py::test_workflow_executes_required_steps_in_order tests/unit/test_scope.py::test_story_7_1_uses_agent_framework_core_without_hosting_or_model_providers` - RED failed as expected before implementation, then passed.
- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python -m pytest tests/unit/test_conversation_workflow.py tests/unit/test_scope.py` - passed (21 tests).
- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python -m pytest` - passed before review fixes (76 tests, existing Starlette/httpx TestClient deprecation warning); passed after review fixes (80 tests, same warning).
- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python -m ruff check .` - passed.
- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python -m mypy src tests` - passed.
- `pnpm --filter @entalent/application test -- src/use-cases/agent-runtime-router.test.ts` - passed (37 tests, existing Vite CJS deprecation warning).
- `git diff --check` - passed.
- `ruby -e "require 'yaml'; YAML.load_file('/Users/serzh/Documents/enTalentNew/_bmad-output/implementation-artifacts/sprint-status.yaml'); puts 'yaml ok'"` - passed.
- `codegraph sync` - passed.
- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python -m pytest tests/unit/test_conversation_workflow.py::test_workflow_run_inside_running_event_loop_raises_safe_error tests/unit/test_conversation_workflow.py::test_workflow_serializes_concurrent_runs_on_one_instance tests/unit/test_conversation_workflow.py::test_workflow_rejects_framework_output_with_invalid_runtime_result tests/unit/test_runtime_endpoint.py::test_runtime_endpoint_redacts_unsafe_trace_id_from_error_response` - RED failed as expected before review fixes, then passed.
- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python -m pytest tests/unit/test_conversation_workflow.py tests/unit/test_runtime_endpoint.py tests/unit/test_scope.py` - passed after review fixes (35 tests, existing Starlette/httpx TestClient deprecation warning).

### Change Log

- 2026-08-07: Created Story 7.1 as ready for development.
- 2026-08-07: Started Story 7.1 implementation.
- 2026-08-07: Implemented MAF core workflow runner and moved Story 7.1 to review.
- 2026-08-07: Addressed BMAD code review findings and moved Story 7.1 to done.

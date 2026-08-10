---
baseline_commit: dce563c5366311a340b0b7f5c30ddddb34d81ad2
---

# Story 7.2: Add Opt-In MAF Agent Model Provider Path For Local Testing

Status: done
Epic: 7 - Microsoft Agent Framework Runtime Adoption
Story ID: 7.2

## Story

As a migration owner,
I want the Python MAF workflow to optionally call a Microsoft Agent Framework agent-backed model provider,
so that we can test real MAF-generated candidate replies in local or staging environments without waiting for full production canary ceremony.

## Acceptance Criteria

1. Given `agent-service` starts without model configuration, when `/runtime/process-message` receives a valid request, then the deterministic candidate path still works with `modelCalls: 0` and no external credentials required.
2. Given an agent-backed model client is injected or configured, when the workflow reaches response generation, then it calls through Microsoft Agent Framework `Agent` primitives and returns a contract-valid candidate reply with `modelCalls: 1`.
3. Given the model provider fails, returns empty text, or produces unsafe text, when the endpoint handles the failure, then the response remains a safe canonical `RuntimeErrorResponse` without raw Slack/user text, prompts, bearer tokens, provider errors, stack traces, full payloads, memory content, risk evidence, or action payloads.
4. Given this story is complete, when the diff is inspected, then it must not enable user-facing `maf_canary`, Python-owned writes, command tools, `agent-framework-hosting`, dashboard/admin UI, deployment mutation, Railway mutation, or ownership transfer.
5. Given local/staging testing is desired, when docs are read, then they describe the opt-in model path, required environment variables, safe fallback expectations, and the fact that TypeScript remains the side-effect owner.

## Tasks / Subtasks

- [x] Add a narrow MAF agent model abstraction inside `agent-service`. (AC: 1, 2, 3, 4)
  - [x] Add a `ConversationModelClient` protocol and MAF `Agent`-backed adapter under `agent-service`.
  - [x] Keep provider/model types confined to `agent-service`; do not leak MAF types into shared TypeScript packages.
  - [x] Support injected fake chat clients in tests without live credentials.
- [x] Wire the optional model step into `ConversationWorkflow`. (AC: 1, 2, 3, 4)
  - [x] Keep default workflow behavior deterministic when no model client is configured.
  - [x] Use the model client only during response generation.
  - [x] Increment only `modelCalls` and `modelRetryCount` diagnostics relevant to the provider path.
  - [x] Preserve risk, memory, action proposal, tool-call, retry, and contract validation behavior.
- [x] Add runtime settings and FastAPI wiring for opt-in local/staging use. (AC: 1, 2, 3, 5)
  - [x] Add explicit settings for model provider mode, model name/deployment, Azure/OpenAI credentials, and timeout.
  - [x] Do not require model settings at app construction, liveness, readiness, or deterministic runtime execution.
  - [x] Fail closed with safe errors only when the model path is explicitly enabled and misconfigured or unavailable.
- [x] Preserve fast-track migration boundaries. (AC: 3, 4)
  - [x] Keep `maf_canary` TypeScript-only and do not change runtime routing semantics in this story.
  - [x] Keep proposed actions uncommitted and TypeScript-owned.
  - [x] Do not add command tools, Python repositories, Slack sends, DB writes, deployment mutation, or admin UI.
- [x] Update docs and tracking. (AC: 1-5)
  - [x] Update `agent-service/README.md` with opt-in model path configuration and local test command.
  - [x] Update `docs/maf-runtime-client.md` to clarify that real model execution is available only in the Python candidate path and remains non-user-facing unless routing is separately enabled.
  - [x] Update this story's Dev Agent Record during implementation.
  - [x] Move sprint status to `in-progress` during implementation and `review` when complete.
- [x] Run and record verification. (AC: 1-5)
  - [x] Run focused Python model-provider workflow tests.
  - [x] Run focused Python runtime endpoint tests.
  - [x] Run focused Python scope tests.
  - [x] Run full `agent-service` pytest.
  - [x] Run `python -m ruff check .` in `agent-service`.
  - [x] Run `python -m mypy src tests` in `agent-service`.
  - [x] Run `pnpm --filter @entalent/application test -- src/use-cases/agent-runtime-router.test.ts` to prove `maf_canary` remains TypeScript-only.
  - [x] Run `git diff --check`.
  - [x] Parse sprint status YAML.

### Review Findings

- [x] [Review][Patch] MAF Agent model execution could hang without a workflow-level timeout [agent-service/src/agent_service/workflows/model_provider.py:75]
- [x] [Review][Patch] Whitespace-only model configuration could pass validation and trigger outbound provider calls [agent-service/src/agent_service/api/runtime.py:80]
- [x] [Review][Patch] Model replies that echo raw user text without secret markers were not rejected [agent-service/src/agent_service/workflows/model_provider.py:167]
- [x] [Review][Patch] OpenAI-compatible `content_filter` finish reasons were not treated as unsafe output [agent-service/src/agent_service/workflows/model_provider.py:192]
- [x] [Review][Patch] Story 7.2 scope guard checked Python writes only in workflow sources, not API/tool runtime sources [agent-service/tests/unit/test_scope.py:235]
- [x] [Review][Patch] Story 7.2 settings change dropped prior `OTEL_SERVICE_NAME` compatibility outside the model-provider scope [agent-service/src/agent_service/infrastructure/settings.py:21]
- [x] [Review][Patch] README contradicted the TypeScript shadow candidate path by saying MAF HTTP execution was out of scope [agent-service/README.md:17]
- [x] [Review][Dismissed] Model misconfiguration retry/fallback flags are normalized by canonical endpoint error category rather than trusted from raised workflow errors; this preserves the Story 5.2 review hardening.

## Dev Notes

### Current Architecture Context

- Story 7.1 put Microsoft Agent Framework core in the workflow execution path with `WorkflowBuilder` and an `Executor`.
- The product owner has explicitly accepted a fast-track approach because there are no real users yet. This reduces rollout ceremony, but it does not remove contract validation, safe errors, kill-switch boundaries, or TypeScript side-effect ownership.
- AD-3 still confines MAF framework types to `agent-service`.
- AD-11 still forbids `agent-framework-hosting`; FastAPI-owned routes remain the service boundary.
- AD-13 keeps runtime mode selection in the TypeScript router. Do not make `maf_canary` user-facing in this story.
- AD-15 and AD-18 keep Python proposal-only and TypeScript-owned for messages, risk persistence, memory, goals, follow-ups, ledgers, diagnostics, runtime-control flags, baseline evidence, and Slack sends.

### Existing Code To Reuse

- `agent-service/src/agent_service/workflows/conversation_workflow.py` owns default workflow steps and diagnostics.
- `agent-service/src/agent_service/api/runtime.py` constructs `ConversationWorkflow`; add opt-in model client construction here or in a small helper without changing the HTTP contract.
- `agent-service/src/agent_service/infrastructure/settings.py` owns Python service env settings.
- `agent-service/tests/unit/test_conversation_workflow.py` already validates deterministic output, safe privacy behavior, proposal-only actions, context tool behavior, event-loop safety, concurrent runs, and contract validation.
- `agent-service/tests/unit/test_runtime_endpoint.py` already validates endpoint error redaction and deterministic default behavior.
- `agent-service/tests/unit/test_scope.py` contains migration boundary guardrails; update Story 7.1-era provider forbiddance to allow this story's confined provider path while still blocking hosting, writes, command tools, routing changes, and UI.

### Implementation Guidance

Use this shape:

```text
ConversationWorkflow
  -> MicrosoftAgentFrameworkWorkflowRunner
     -> existing deterministic steps
     -> generate_response step calls optional ConversationModelClient
        -> AgentFrameworkConversationModelClient
           -> agent_framework.Agent(chat_client=...)
```

The default constructor must remain deterministic. Tests should inject a fake MAF-compatible chat client or model client so no live API key is required. Runtime settings may support Azure/OpenAI environment variables, but missing credentials must not break local scaffold or deterministic endpoint calls.

Provider package reality as of local inspection: `agent-framework-core==1.13.0` exposes `Agent`, `BaseChatClient`, `Message`, and provider namespaces. `agent-framework-openai` is split into a separate optional package and currently may lag the core package on PyPI. Do not hard-pin an incompatible provider package. Use dynamic imports and safe configuration errors for optional provider construction.

### Out Of Scope

- Full production canary ceremony, staged rollout mutation, or changing `maf_canary` router behavior.
- Python-owned persistence or writes to messages, risk, memory, goals, follow-ups, survey evidence, ledgers, runtime-control flags, diagnostics, baseline evidence, or Slack.
- Command tools, Python-to-TypeScript write APIs, provider tools that can mutate external systems, streaming, dashboard/admin UI, deployment mutation, Railway mutation, or ownership transfer.
- `agent-framework-hosting`.

### Testing Requirements

- Add RED tests proving default runtime remains deterministic with `modelCalls: 0`.
- Add RED tests proving injected model execution uses MAF `Agent`/chat-client primitives and returns `modelCalls: 1`.
- Add RED tests for model failure, empty output, and unsafe provider output mapping to safe errors.
- Existing runtime result contract fixtures and validators must keep passing.
- Serialization tests must continue proving raw user text, prompts, secrets, tokens, stack traces, full payloads, risk evidence, memory content, action payloads, and provider errors are absent from error responses.

### References

- `_bmad-output/implementation-artifacts/7-1-replace-deterministic-python-workflow-skeleton-with-microsoft-agent-framework-core-workflow.md`
- `_bmad-output/implementation-artifacts/epic-6-retro-2026-08-07.md`
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md`
- `agent-service/src/agent_service/workflows/conversation_workflow.py`
- `agent-service/src/agent_service/api/runtime.py`
- `agent-service/src/agent_service/infrastructure/settings.py`
- `agent-service/tests/unit/test_conversation_workflow.py`
- `agent-service/tests/unit/test_runtime_endpoint.py`
- `agent-service/tests/unit/test_scope.py`
- `agent-service/README.md`
- `docs/maf-runtime-client.md`

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story created after the product owner accepted a fast-track path because there are no real users yet.
- 2026-08-07: Started dev-story implementation; status moved to in-progress with baseline `dce563c5366311a340b0b7f5c30ddddb34d81ad2`.
- 2026-08-07: RED focused tests failed because `agent_service.workflows.model_provider` did not exist.
- 2026-08-07: Implemented `AgentFrameworkConversationModelClient`, `OpenAICompatibleChatClient`, opt-in model settings, workflow model response step, and FastAPI model-client factory.
- 2026-08-07: Verification completed; story moved to review.
- 2026-08-07: BMAD code review found timeout, whitespace config, raw-text echo, content-filter, scope guard, OTEL alias, and docs findings; patches applied and verified. Retry/fallback flag finding was dismissed because category normalization is intentional prior review hardening.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Added a confined `ConversationModelClient` protocol and MAF `Agent`-backed model adapter under `agent-service`.
- Added an OpenAI-compatible async chat client for opt-in direct OpenAI or Azure OpenAI local/staging testing without adding `agent-framework-hosting`.
- Wired optional model execution only into the `generate_response` workflow step; default runtime remains deterministic with `modelCalls: 0`.
- Model-enabled candidate results return `modelCalls: 1` and preserve contract-valid risk, memory candidates, proposal-only actions, and retry diagnostics.
- Provider configuration, HTTP, empty-output, and unsafe-output failures map to safe canonical runtime errors without raw user text, prompts, secrets, provider details, stack traces, or payloads.
- Review fixes add MAF Agent timeout enforcement, whitespace config normalization, direct user-text echo rejection, OpenAI-compatible `content_filter` rejection, wider Python write scope guardrails, restored unprefixed `OTEL_SERVICE_NAME` compatibility, and clearer docs for TypeScript shadow candidate reachability.
- Updated docs for opt-in provider env vars and candidate-only runtime semantics.
- Preserved migration boundaries: no user-facing `maf_canary`, no TypeScript routing semantic change, no Python writes, no command tools, no deployment mutation, and no UI.

### File List

- `_bmad-output/implementation-artifacts/7-2-add-opt-in-maf-agent-model-provider-path-for-local-testing.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `agent-service/src/agent_service/workflows/model_provider.py`
- `agent-service/src/agent_service/workflows/conversation_workflow.py`
- `agent-service/src/agent_service/api/runtime.py`
- `agent-service/src/agent_service/infrastructure/settings.py`
- `agent-service/tests/unit/test_conversation_workflow.py`
- `agent-service/tests/unit/test_model_provider.py`
- `agent-service/tests/unit/test_runtime_endpoint.py`
- `agent-service/tests/unit/test_settings.py`
- `agent-service/tests/unit/test_scope.py`
- `agent-service/README.md`
- `docs/maf-runtime-client.md`

### Verification

- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python -m pytest tests/unit/test_conversation_workflow.py::test_workflow_uses_injected_maf_agent_model_client_for_reply tests/unit/test_conversation_workflow.py::test_workflow_model_failure_raises_safe_error_without_provider_detail tests/unit/test_conversation_workflow.py::test_workflow_rejects_empty_model_reply tests/unit/test_conversation_workflow.py::test_workflow_rejects_unsafe_model_reply tests/unit/test_runtime_endpoint.py::test_runtime_endpoint_uses_configured_model_client tests/unit/test_settings.py::test_settings_use_prefixed_model_provider_environment tests/unit/test_scope.py::test_story_7_2_uses_agent_framework_model_provider_without_hosting_or_writes` - RED failed as expected before implementation, then passed.
- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python -m pytest tests/unit/test_conversation_workflow.py::test_workflow_executes_required_steps_in_order tests/unit/test_conversation_workflow.py::test_workflow_uses_injected_maf_agent_model_client_for_reply tests/unit/test_conversation_workflow.py::test_workflow_model_failure_raises_safe_error_without_provider_detail tests/unit/test_conversation_workflow.py::test_workflow_rejects_empty_model_reply tests/unit/test_conversation_workflow.py::test_workflow_rejects_unsafe_model_reply tests/unit/test_runtime_endpoint.py::test_runtime_endpoint_returns_contract_valid_candidate_result_for_valid_request tests/unit/test_runtime_endpoint.py::test_runtime_endpoint_uses_configured_model_client tests/unit/test_runtime_endpoint.py::test_runtime_endpoint_returns_safe_error_for_misconfigured_model_provider tests/unit/test_settings.py::test_settings_use_prefixed_model_provider_environment tests/unit/test_scope.py::test_story_7_2_uses_agent_framework_model_provider_without_hosting_or_writes` - passed (10 tests).
- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python -m pytest tests/unit/test_runtime_endpoint.py` - passed (13 tests, existing Starlette/httpx TestClient deprecation warning).
- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python -m pytest` - passed (87 tests, existing Starlette/httpx TestClient deprecation warning).
- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python -m ruff check .` - passed.
- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python -m mypy src tests` - passed.
- `pnpm --filter @entalent/application test -- src/use-cases/agent-runtime-router.test.ts` - passed (37 tests, existing Vite CJS deprecation warning).
- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python -m pytest tests/unit/test_conversation_workflow.py::test_workflow_rejects_model_reply_that_echoes_user_text tests/unit/test_conversation_workflow.py::test_workflow_times_out_hung_maf_agent_model_client tests/unit/test_runtime_endpoint.py::test_runtime_endpoint_rejects_whitespace_model_provider_config tests/unit/test_settings.py::test_settings_keep_unprefixed_opentelemetry_service_name_compatibility tests/unit/test_model_provider.py tests/unit/test_scope.py::test_story_7_2_uses_agent_framework_model_provider_without_hosting_or_writes` - RED failed as expected before review fixes, then passed (7 tests, existing Starlette/httpx TestClient deprecation warning).
- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python -m pytest tests/unit/test_settings.py` - passed after alias compatibility fix (7 tests).
- `/Users/serzh/Documents/enTalentNew/agent-service/.venv/bin/python -m pytest` - passed after review fixes (93 tests, existing Starlette/httpx TestClient deprecation warning).

### Change Log

- 2026-08-07: Created Story 7.2 as ready for development.
- 2026-08-07: Implemented opt-in MAF Agent model provider path and moved Story 7.2 to review.
- 2026-08-07: Addressed BMAD code review findings and moved Story 7.2 to done.

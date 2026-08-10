---
baseline_commit: dce563c
---

# Story 4.4: Add Durable Session And Checkpoint Store

Status: done
Epic: 4 - Deployable Python Agent Service Foundation
Story ID: 4.4

## Story

As an operator,
I want non-local MAF session/checkpoint state to be durable,
so that shadow execution can survive restarts and avoid stale process-local state.

## Acceptance Criteria

1. Given non-local shadow mode is enabled, when MAF needs session or checkpoint state, then the service uses the selected durable backend.
2. Given non-local shadow mode is enabled, when process-local storage is selected, then configuration validation rejects startup before any runtime work can happen.
3. Given a session key is created, when it is inspected, then it includes workspace, user, external conversation, and thread-or-DM scope.
4. Given this story is complete, when the diff is inspected, then no `MafAgentRuntimeClient`, MAF workflow or tools, readiness endpoint, Docker/deployment envelope, worker routing change, domain aggregate write path, non-local shadow/canary execution, or dashboard/admin UI has been added.

## Tasks / Subtasks

- [x] Add runtime state configuration to `agent-service`. (AC: 1, 2, 4)
  - [x] Add `AGENT_SERVICE_RUNTIME_STATE_BACKEND` with supported values `memory` and `sqlite`.
  - [x] Add `AGENT_SERVICE_RUNTIME_STATE_SQLITE_PATH` for the durable local backend path.
  - [x] Add `AGENT_SERVICE_NON_LOCAL_SHADOW_ENABLED` as the guard that rejects process-local storage when non-local shadow is planned.
  - [x] Keep defaults local/test friendly: memory backend allowed only while non-local shadow is disabled.
- [x] Add session identity and session key generation. (AC: 3)
  - [x] Require workspace ID, user ID, external conversation ID, and exactly one thread-or-DM scope value.
  - [x] Make generated session keys deterministic and inspectable.
  - [x] Reject missing, blank, or ambiguous thread/DM scope before producing a key.
- [x] Add durable session/checkpoint store primitives. (AC: 1, 2, 4)
  - [x] Add a small runtime state store interface for session and checkpoint JSON payloads.
  - [x] Add process-local memory implementation for local-only tests/development.
  - [x] Add SQLite implementation using Python standard library `sqlite3` for durable session and checkpoint data.
  - [x] Add a factory that selects backend from settings and rejects memory when non-local shadow is enabled.
  - [x] Keep the store detached from `/runtime/process-message`; do not instantiate MAF sessions or workflows.
- [x] Add focused tests. (AC: 1-4)
  - [x] Test settings reject `non_local_shadow_enabled=true` with memory backend.
  - [x] Test settings allow `non_local_shadow_enabled=true` with SQLite backend.
  - [x] Test session key includes workspace, user, external conversation, and thread-or-DM scope.
  - [x] Test missing/ambiguous thread/DM scope is rejected.
  - [x] Test SQLite session/checkpoint data survives creating a new store instance against the same path.
  - [x] Test memory backend is process-local and only selected when non-local shadow is disabled.
  - [x] Update scope regression tests for the now-allowed durable state primitives while preserving out-of-scope protections.
- [x] Update developer docs. (AC: 1-4)
  - [x] Document runtime state backend settings and the non-local shadow fail-closed rule.
  - [x] Document that Story 4.4 only adds state primitives and does not add MAF workflow, worker routing, deployment, readiness, or shadow execution.
- [x] Update implementation tracking. (AC: 1-4)
  - [x] Update this story's Dev Agent Record during implementation.
  - [x] Move sprint status from `ready-for-dev` to `in-progress` during dev-story and to `review` when implementation is complete.
- [x] Run and record verification. (AC: 1-4)
  - [x] Run Python unit tests for `agent-service`.
  - [x] Run ruff and mypy for `agent-service`.
  - [x] Run `git diff --check`.

### Review Findings

- [x] [Review][Patch] App startup bypasses non-local shadow/process-local state validation [`agent-service/src/agent_service/main.py`]
- [x] [Review][Patch] SQLite `:memory:` backend is accepted as durable [`agent-service/src/agent_service/infrastructure/settings.py`]
- [x] [Review][Patch] SQLite path can be relative, blank, or a directory [`agent-service/src/agent_service/infrastructure/settings.py`]
- [x] [Review][Patch] SQLite state file is created with default permissions [`agent-service/src/agent_service/infrastructure/runtime_state.py`]
- [x] [Review][Patch] Blank session/checkpoint keys can overwrite shared state [`agent-service/src/agent_service/infrastructure/runtime_state.py`]
- [x] [Review][Patch] Runtime state stores accept non-standard JSON values [`agent-service/src/agent_service/infrastructure/runtime_state.py`]
- [x] [Review][Patch] Corrupt SQLite payload errors are not normalized [`agent-service/src/agent_service/infrastructure/runtime_state.py`]
- [x] [Review][Patch] Session identity tests miss blank required fields [`agent-service/tests/unit/test_runtime_state.py`]
- [x] [Review][Patch] SQLite factory test does not exercise read/write behavior [`agent-service/tests/unit/test_runtime_state.py`]
- [x] [Review][Patch] Scope guard misses TypeScript aggregate/runtime wiring paths [`agent-service/tests/unit/test_scope.py`]

## Dev Notes

### Current Architecture Context

- Story 4.4 is the first Epic 4 story where durable Python-side session/checkpoint state is in scope.
- SPEC constraints say production MAF hosting must not rely on process-local sessions or in-memory conversation history.
- AD-19 still owns full deployment metadata in Story 4.5. This story may add the setting names needed by the state primitive, but must not add Dockerfile, Railway registration, readiness endpoint, production start command, internal URL wiring, or full secret ownership matrix.
- AD-18 says shadow diagnostics are TypeScript-owned; do not add non-local shadow execution or diagnostics writes here.
- TypeScript remains side-effect owner. This story must not write memory, goals, risk records, scheduled actions, messages, surveys, manager analytics, or runtime aggregates.

### Existing Repo State

- `agent-service` currently has FastAPI scaffold, `/health/live`, `/runtime/process-message` contract skeleton, OpenAPI-backed validation, scoped internal auth signer, settings, pytest, ruff, and mypy.
- Story 4.3 added `AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET` and `AGENT_SERVICE_INTERNAL_SERVICE_IDENTITY`; keep runtime state settings under the same `AGENT_SERVICE_` prefix.
- `agent-service/pyproject.toml` currently has no durable-store dependency. Prefer Python standard library `sqlite3` for this story to avoid network/dependency churn.
- Current scope tests intentionally forbid sessions/checkpoints. Story 4.4 must update those tests to allow the new `runtime_state` primitive while still forbidding MAF workflows/tools, deployed endpoints, router changes, aggregate writes, and UI.

### Recommended File Structure For Story 4.4

```text
agent-service/src/agent_service/infrastructure/
  runtime_state.py
agent-service/tests/unit/
  test_runtime_state.py
```

Keep code under `agent_service.infrastructure`; avoid `agent_service.sessions` or `agent_service.checkpoints` packages unless a later MAF integration story needs them.

### Runtime State Guidance

- Supported backend values:
  - `memory`: process-local, development/test only, rejected when `non_local_shadow_enabled` is true.
  - `sqlite`: durable local file backend for session/checkpoint JSON payloads, enough to prove restart survival without adding Redis/Postgres dependencies.
- Suggested API:

```python
@dataclass(frozen=True)
class SessionIdentity:
    workspace_id: str
    user_id: str
    external_conversation_id: str
    thread_id: str | None = None
    dm_user_id: str | None = None

def create_session_key(identity: SessionIdentity) -> str: ...
```

- The session key should be inspectable, for example:

```text
workspace=<workspace>|user=<user>|conversation=<externalConversation>|thread=<thread>
workspace=<workspace>|user=<user>|conversation=<externalConversation>|dm=<dmUser>
```

- Store values should be JSON-compatible dictionaries. Do not store raw Slack message text in tests or examples.

### Out Of Scope

- `MafAgentRuntimeClient`
- TypeScript worker routing changes
- non-local shadow execution or canary behavior
- MAF workflow, agents, or tools
- read/write context tool endpoints
- readiness endpoint
- Dockerfile, Railway service registration, production start command, internal URL wiring, or full secret ownership matrix
- dashboard/admin UI
- direct writes to memory, goals, risk records, scheduled actions, messages, surveys, manager analytics, runtime attempts/actions, or domain aggregates

### Previous Story Intelligence

- Story 4.1 disabled FastAPI docs/OpenAPI exposure and established dependency-light Python service settings.
- Story 4.2 added `/runtime/process-message` skeleton only; do not make the endpoint use the state store in this story.
- Story 4.3 added scoped internal auth primitives and hardened guard-level audit recording, but did not add actual internal tool endpoints.
- Worktree note: Stories 4.1-4.3 changes are currently uncommitted on top of `dce563c`. Do not revert them; build Story 4.4 on the current working tree unless the user asks for a different git hygiene step.

### Testing Requirements

- Tests must be local and deterministic.
- Do not require Redis, Postgres, Slack, Azure, LangWatch, OpenAI, TypeScript service process, or network.
- Run `agent-service/.venv/bin/python -m pytest agent-service/tests/unit`.
- Run `agent-service/.venv/bin/python -m ruff check agent-service`.
- Run `cd agent-service && .venv/bin/python -m mypy src tests`.
- Run `git diff --check`.

### References

- `_bmad-output/planning-artifacts/epics.md` - Epic 4 Story 4.4 requirements and FR23/FR24 mapping.
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md` - AD-18, AD-19, and consistency conventions.
- `_bmad-output/specs/spec-maf-runtime-migration/SPEC.md` - production/process-local state constraint.
- `_bmad-output/implementation-artifacts/4-3-add-scoped-internal-service-auth.md` - previous story context and scope exclusions.
- `agent-service/src/agent_service/infrastructure/settings.py` - settings pattern.
- `agent-service/tests/unit/test_scope.py` - scope regression tests to update.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story created after Story 4.3 was marked done in BMAD tracking.
- Loaded Epic 4 Story 4.4 requirements, architecture AD-18/AD-19, SPEC process-local state constraint, current sprint status, Story 4.3 previous-story context, Python settings, scope tests, and pyproject dependency surface.
- No `project-context.md` was found.
- No new external package research was required because Story 4.4 can use Python standard library `sqlite3`.
- Started dev-story implementation from baseline `dce563c` on a dirty worktree containing uncommitted Story 4.1, Story 4.2, and Story 4.3 changes.
- RED verification: `agent-service/.venv/bin/python -m pytest agent-service/tests/unit/test_runtime_state.py agent-service/tests/unit/test_settings.py` failed because `agent_service.infrastructure.runtime_state` did not exist yet.
- Implemented `runtime_state.py` with `SessionIdentity`, deterministic inspectable session keys, process-local memory store, durable SQLite store, and settings-backed factory.
- Added runtime state settings for backend selection, SQLite path, and non-local shadow fail-closed validation.
- Verification: `agent-service/.venv/bin/python -m pytest agent-service/tests/unit` passed with 34 tests and the existing Starlette `httpx` deprecation warning.
- Verification: `agent-service/.venv/bin/python -m ruff check agent-service` passed.
- Verification: `cd agent-service && .venv/bin/python -m mypy src tests` passed.
- Verification: `git diff --check` passed.
- BMAD code review ran Blind Hunter, Edge Case Hunter, and Acceptance Auditor. Accepted and fixed findings for startup validation, durable SQLite path validation, private SQLite file permissions, blank store keys, strict JSON payloads, corrupt payload normalization, session identity edge cases, factory read/write coverage, and broader scope guards.
- Review dismissal: the OTel alias comment was treated as a prior Story 4.1 review decision, not a Story 4.4 durable-state regression; current settings tests intentionally assert `AGENT_SERVICE_OTEL_SERVICE_NAME`.
- Review verification: `agent-service/.venv/bin/python -m pytest agent-service/tests/unit` passed with 41 tests and the existing Starlette `httpx` deprecation warning.
- Review verification: `agent-service/.venv/bin/python -m ruff check agent-service` passed.
- Review verification: `cd agent-service && .venv/bin/python -m mypy src tests` passed.
- Review verification: `git diff --check` passed.

### Completion Notes List

- Story 4.4 is ready for dev-story implementation.
- Scope is explicitly limited to runtime state configuration, session key generation, and local durable SQLite session/checkpoint store primitives.
- Story 4.4 implementation is complete and ready for BMAD code review.
- Added local-only memory backend and durable SQLite backend without wiring either into `/runtime/process-message`.
- Added session key validation requiring workspace, user, external conversation, and exactly one thread-or-DM scope.
- Review fixes made app creation fail closed for invalid runtime state config, reject non-durable SQLite paths, create private SQLite files, reject blank state keys and non-standard JSON, wrap corrupt SQLite payloads, and strengthen scope regression coverage.

### File List

- `_bmad-output/implementation-artifacts/4-4-add-durable-session-and-checkpoint-store.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `agent-service/README.md`
- `agent-service/src/agent_service/infrastructure/runtime_state.py`
- `agent-service/src/agent_service/infrastructure/settings.py`
- `agent-service/tests/unit/test_runtime_state.py`
- `agent-service/tests/unit/test_scope.py`
- `agent-service/tests/unit/test_settings.py`

### Change Log

- 2026-08-06: Created Story 4.4 developer context from Epic 4, architecture, SPEC constraints, Story 4.3 learnings, and current Python service patterns.
- 2026-08-06: Started Story 4.4 dev-story implementation.
- 2026-08-06: Implemented runtime state settings, session key generation, memory/SQLite stores, docs, tests, and verification.
- 2026-08-06: Addressed BMAD code review findings and marked Story 4.4 done.

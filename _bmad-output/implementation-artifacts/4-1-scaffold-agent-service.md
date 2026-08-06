---
baseline_commit: 53c12f2
---

# Story 4.1: Scaffold `agent-service`

Status: ready-for-dev
Epic: 4 - Deployable Python Agent Service Foundation
Story ID: 4.1

## Story

As an engineer,
I want a Python/FastAPI service scaffold in the monorepo,
so that MAF runtime work has a deployable home.

## Acceptance Criteria

1. Given `agent-service/` is added, when local checks run, then it uses Python 3.13.x, FastAPI, Pydantic, pytest, ruff, mypy or pyright, and OpenTelemetry-ready settings.
2. Given the service starts locally, when `/health/live` is called, then it returns healthy without requiring model, Redis, or Postgres dependencies.
3. Given this story is complete, when the diff is inspected, then no runtime process-message endpoint, scoped internal auth implementation, durable session/checkpoint backend, MAF workflow, TypeScript `MafAgentRuntimeClient`, worker runtime routing change, non-local shadow execution, canary behavior, domain aggregate write path, Docker/deployment envelope, or dashboard/admin UI has been added.

## Tasks / Subtasks

- [ ] Create the minimal Python service project under `agent-service/`. (AC: 1, 3)
  - [ ] Add `agent-service/pyproject.toml` using Python `>=3.13,<3.14`.
  - [ ] Add a Python version marker such as `agent-service/.python-version` set to `3.13.14` if the selected local toolchain supports it.
  - [ ] Add package namespace `agent_service` under `agent-service/src/agent_service/`.
  - [ ] Use FastAPI-owned routes over stable core MAF service structure; do not add `agent-framework-hosting` helpers.
  - [ ] Include dev tooling scripts or documented commands for pytest, ruff, and mypy or pyright.
- [ ] Add application settings that are OpenTelemetry-ready but dependency-light. (AC: 1, 2)
  - [ ] Add Pydantic settings for service name, environment, log level, optional OTLP endpoint, and optional tracing enablement.
  - [ ] Ensure settings can load with no model, Redis, Postgres, Azure, LangWatch, or TypeScript internal-service credentials.
  - [ ] Keep secrets out of committed defaults; use environment variables only for optional settings.
- [ ] Add liveness health route only. (AC: 2, 3)
  - [ ] Add a FastAPI app factory or app module that mounts `/health/live`.
  - [ ] Return a stable JSON body with at least `status`, `service`, and `version`.
  - [ ] Do not add `/health/ready`; readiness belongs to Story 4.5.
  - [ ] Do not add `POST /runtime/process-message`; runtime endpoint skeleton belongs to Story 4.2.
- [ ] Add focused Python tests. (AC: 1, 2, 3)
  - [ ] Add unit tests for settings defaults and `/health/live`.
  - [ ] Prove `/health/live` does not require external dependencies or configured secrets.
  - [ ] Add scope regression checks that runtime endpoint/auth/session/workflow/client/routing/UI files were not introduced.
- [ ] Add minimal developer docs. (AC: 1, 2)
  - [ ] Add `agent-service/README.md` with local setup, run, and check commands.
  - [ ] Document that Story 4.1 is scaffold/liveness only and intentionally excludes runtime endpoint, auth, durable state, deployment envelope, and MAF workflow behavior.
- [ ] Update implementation tracking. (AC: 1-3)
  - [ ] Update this story's Dev Agent Record during implementation.
  - [ ] Move sprint status from `ready-for-dev` to `in-progress` during dev-story and to `review` when implementation is complete.
- [ ] Run and record verification. (AC: 1-3)
  - [ ] Run Python unit tests for `agent-service`.
  - [ ] Run ruff.
  - [ ] Run mypy or pyright.
  - [ ] Run a local liveness check against `/health/live` if the dev server can start in the sandbox.
  - [ ] Run `git diff --check`.
  - [ ] Run `pnpm test` only if TypeScript package metadata or root workspace behavior is changed; otherwise record why it was not needed.

## Dev Notes

### Current Architecture Context

- Epic 4 introduces `agent-service/` for the first time. The user confirmed the plan to proceed after Epic 3 retrospective, so creating the service folder is now allowed for Story 4.1.
- AD-3 keeps MAF imports inside `agent-service`; TypeScript shared packages must not import Python, FastAPI, or MAF types.
- AD-11 says the first service uses FastAPI-owned routes over stable core `agent-framework`; `agent-framework-hosting` helpers are deferred because hosting helpers are prerelease.
- AD-12 targets Python 3.13.x for the new service. The architecture stack names Python `3.13.14`.
- AD-14 keeps `packages/contracts/runtime/openapi.json` as the canonical runtime HTTP schema source. Story 4.1 must not add runtime request/result schemas beyond health response models; Story 4.2 owns runtime contract validation.
- AD-16 scoped service auth is Story 4.3. Do not add credentials, internal TypeScript client auth, endpoint allowlists, or audit fields here.
- AD-19 says the Python service must define deployable unit metadata before non-local shadow mode, but the full Docker/start/readiness/internal URL/secret ownership envelope is Story 4.5. Story 4.1 should avoid pretending deployment is complete.

### Existing Repo State

- `agent-service/` does not exist yet.
- No root Python `pyproject.toml`, `ruff.toml`, `mypy.ini`, `pyrightconfig.json`, `uv.lock`, or Python workspace tooling exists.
- Existing Dockerfiles are TypeScript service Dockerfiles under `apps/api`, `apps/worker`, and `apps/dashboard`; do not copy them into Story 4.1 unless Story 4.5 explicitly requires deployment metadata later.
- Existing OpenTelemetry helper is TypeScript-only at `packages/observability/src/tracing.ts`. Do not import or alter it for the Python scaffold.
- Existing Python code is limited to contract fixture validation at `packages/contracts/runtime/validate_fixtures.py`. Do not move this into `agent-service`.

### Recommended File Structure For Story 4.1

```text
agent-service/
  .python-version
  README.md
  pyproject.toml
  src/
    agent_service/
      __init__.py
      main.py
      api/
        __init__.py
        health.py
      infrastructure/
        __init__.py
        settings.py
  tests/
    unit/
      test_health.py
      test_settings.py
      test_scope.py
```

Keep the scaffold smaller if possible, but do not place Python service code outside `agent-service/src/agent_service`.

### Dependency And Tooling Guidance

- Use Python `>=3.13,<3.14`.
- Use FastAPI and Pydantic for the scaffold. Prefer `pydantic-settings` for environment-backed settings if available.
- Choose one static type checker for this story. `mypy` is acceptable and keeps the Python scaffold independent from Node-managed pyright.
- Use `ruff` for linting. It supports Python 3.13 according to Ruff documentation.
- Use `pytest` plus FastAPI's test client or an ASGI test client for `/health/live`.
- Do not pin unavailable versions. Architecture notes say FastAPI `0.141.1` and Agent Framework core `1.13.0` were verified on 2026-08-05, but a fresh PyPI search on 2026-08-06 surfaced FastAPI `0.139.2` as the latest indexed result. During implementation, verify package availability before committing exact pins. If the chosen pin differs from the architecture stack, document the reason in the Dev Agent Record and avoid changing architecture documents in this story.
- Microsoft Agent Framework 1.0 is documented as production-ready, and PyPI metadata for `agent-framework` shows Python 3.13 support. Story 4.1 does not need to import `agent-framework` unless the scaffold can do so without adding workflow behavior.

### Liveness Contract

The `/health/live` endpoint should be intentionally shallow:

```json
{
  "status": "healthy",
  "service": "agent-service",
  "version": "<package version>"
}
```

It must not check model credentials, Redis, Postgres, TypeScript internal APIs, MAF durable state, or runtime contract availability. Those are readiness/dependency concerns for later stories.

### Out Of Scope

- `POST /runtime/process-message`
- runtime request/result Pydantic models from `packages/contracts/runtime/openapi.json`
- `MafAgentRuntimeClient`
- TypeScript worker routing changes
- production or non-local shadow execution
- canary routing
- MAF workflow or agent implementation
- read/write context tools
- scoped internal service auth
- durable session/checkpoint backend
- Dockerfile, Railway service registration, start command, readiness endpoint, internal URL, or secret ownership matrix
- dashboard/admin UI
- direct writes to memory, goals, risk records, scheduled actions, messages, surveys, or manager analytics

### Previous Epic Intelligence

Epic 3 retrospective produced these relevant action items:

- Keep required and sensitive migration baseline case IDs sourced from `@entalent/contracts` for every future consumer.
- Carry fail-closed redaction and stable reason-code allowlists into Python service validation, tool-call audit records, and future shadow candidate diagnostics.
- Keep Story 4.1 limited to scaffold and liveness; defer endpoint/auth/session/workflow/client/shadow/canary/UI work.
- Run upstream package builds sequentially before dependent checks when builds clean shared `dist` directories.
- Resolve or document the strict runtime-boundary request shape before Epic 5 introduces `MafAgentRuntimeClient`.

Story 4.1 should add Python project-local checks without weakening any TypeScript runtime behavior.

### Testing Requirements

- Tests must be local and deterministic.
- Do not require Slack, Redis, BullMQ, Postgres, model credentials, Azure, LangWatch, or TypeScript internal service credentials.
- Include a scope regression test that fails if Story 4.1 accidentally adds:
  - `packages/application/src/use-cases/maf-agent-runtime-client.ts`
  - `agent-service/src/agent_service/api/runtime*`
  - `agent-service/src/agent_service/workflows/`
  - `agent-service/src/agent_service/tools/`
  - `apps/dashboard/src/*shadow*`
  - TypeScript runtime router production/canary wiring changes
- If local Python dependency installation is unavailable because of sandbox/network restrictions, record the exact command and failure reason in the Dev Agent Record.

### Latest Technical Notes

- Python.org lists Python 3.13.14 as a maintained Python 3.13 release, while Python 3.14 is the latest feature series. The architecture deliberately targets 3.13.x for conservative dependency compatibility.
- FastAPI PyPI metadata requires Python `>=3.10` and exposed `0.139.x` releases in the 2026-08-06 search result. Verify exact availability before pinning.
- Pydantic current documentation shows v2.13.x and supports Python 3.13.
- Microsoft Agent Framework documentation says Agent Framework reached version 1.0 for Python and .NET, and PyPI metadata for `agent-framework` includes Python 3.13 support.

### References

- `_bmad-output/planning-artifacts/epics.md` - Epic 4 Story 4.1 requirements and FR21/FR22 mapping.
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md` - AD-3, AD-11, AD-12, AD-14, AD-16, AD-19, stack, and structural seed.
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/reviews/review-resolution.md` - FastAPI/MAF/Python version reality notes and non-blocking open questions.
- `_bmad-output/specs/spec-maf-runtime-migration/SPEC.md` - CAP-2 constraints, non-goals, and success signal.
- `_bmad-output/specs/spec-maf-runtime-migration/runtime-contract.md` - canonical runtime contract source and boundary; Story 4.1 must not implement the runtime endpoint.
- `_bmad-output/implementation-artifacts/epic-3-retro-2026-08-06.md` - Epic 3 lessons and Epic 4 preparation actions.
- `packages/contracts/runtime/openapi.json` - canonical runtime HTTP schema source for later Story 4.2.
- `packages/contracts/runtime/validate_fixtures.py` - existing Python validation style that must remain outside `agent-service`.
- `packages/observability/src/tracing.ts` - TypeScript OpenTelemetry helper for context only; do not modify for this story.
- Python 3.13.14 release: https://www.python.org/downloads/release/python-31314/
- FastAPI PyPI: https://pypi.org/project/fastapi/
- Pydantic docs: https://pydantic.dev/
- Microsoft Agent Framework docs: https://learn.microsoft.com/agent-framework/
- Agent Framework PyPI: https://pypi.org/project/agent-framework/

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story created after Epic 3 was marked done and Epic 3 retrospective was committed at baseline `53c12f2`.
- Loaded BMAD create-story workflow, config, sprint status, Epic 4 Story 4.1 requirements, architecture spine, SPEC, runtime-contract companion, Epic 3 retrospective, recent git history, and repo Python-tooling inventory.
- No `project-context.md` was found.
- Web research checked Python 3.13.14, FastAPI, Pydantic, Microsoft Agent Framework, and Agent Framework PyPI surfaces for current version/support context.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Story 4.1 is ready for BMAD story validation and dev-story implementation.
- Scope explicitly permits creating `agent-service/` and explicitly forbids runtime endpoint/client/workflow/auth/session/deployment/canary/UI work in this story.

### File List

- `_bmad-output/implementation-artifacts/4-1-scaffold-agent-service.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Change Log

- 2026-08-06: Created Story 4.1 developer context from Epic 4, architecture spine, SPEC, runtime-contract companion, Epic 3 retrospective, repo state, and current Python/FastAPI/MAF version research.

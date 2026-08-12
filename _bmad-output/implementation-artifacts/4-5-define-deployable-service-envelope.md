---
baseline_commit: dce563c
---

# Story 4.5: Define Deployable Service Envelope

Status: done
Epic: 4 - Deployable Python Agent Service Foundation
Story ID: 4.5

## Story

As an operator,
I want `agent-service` deployment metadata defined,
so that worker integration cannot merge before the Python service can run in the fleet.

## Acceptance Criteria

1. Given non-local shadow mode is planned, when deployment configuration is inspected, then the service defines Docker build strategy, production start command, health endpoint, readiness endpoint, internal URL consumed by the future worker client, environment variables, secret ownership, and Railway or equivalent service registration.
2. Given `/health/ready` is called, when required dependencies are unavailable, then readiness fails while liveness can still pass.
3. Given this story is complete, when the diff is inspected, then no `MafAgentRuntimeClient`, MAF workflow or tools, TypeScript worker routing change, non-local shadow/canary execution, domain aggregate write path, or dashboard/admin UI has been added.

## Tasks / Subtasks

- [x] Add readiness endpoint to `agent-service`. (AC: 1, 2, 3)
  - [x] Add `GET /health/ready` without re-enabling FastAPI `/docs`, `/redoc`, or `/openapi.json`.
  - [x] Make readiness instantiate and validate settings.
  - [x] Make readiness check the selected runtime state backend dependency.
  - [x] Return HTTP 503 with a safe dependency status when readiness fails.
  - [x] Keep `/health/live` independent of dependency readiness.
- [x] Add deployment envelope files. (AC: 1, 3)
  - [x] Add `agent-service/Dockerfile` using Python 3.13 and the existing package install path.
  - [x] Add `.dockerignore` for Python cache, venv, test/cache output, and local state files.
  - [x] Define production start command with `uvicorn agent_service.main:create_app --factory`.
  - [x] Expose the production port through `AGENT_SERVICE_PORT`, defaulting to `8001`.
  - [x] Do not add MAF workflow, tool packages, worker client code, or deployment execution scripts.
- [x] Add service registration metadata/documentation. (AC: 1, 3)
  - [x] Document Railway service name, root directory, Dockerfile path, health/readiness paths, start command, and internal URL variable expected by the future worker client.
  - [x] Document required and optional env vars, with owners and whether they are secrets.
  - [x] Keep registration metadata inert; do not run `railway up` or modify existing `api`, `worker`, or `dashboard` service deployments.
- [x] Add focused tests. (AC: 1-3)
  - [x] Test `/health/ready` returns healthy when local memory backend is valid.
  - [x] Test `/health/ready` returns 503 while `/health/live` still returns 200 when runtime state backend dependency fails.
  - [x] Test deployment envelope files contain the production start command, health/readiness paths, env vars, secret ownership, internal URL, and Railway service registration.
  - [x] Update scope regression tests to allow Dockerfile/readiness/deployment metadata while preserving out-of-scope protections.
- [x] Update developer docs. (AC: 1-3)
  - [x] Update `agent-service/README.md` with readiness and deployment envelope guidance.
  - [x] Document that Story 4.5 does not deploy the service and does not add worker routing or MAF execution.
- [x] Update implementation tracking. (AC: 1-3)
  - [x] Update this story's Dev Agent Record during implementation.
  - [x] Move sprint status from `ready-for-dev` to `in-progress` during dev-story and to `review` when implementation is complete.
- [x] Run and record verification. (AC: 1-3)
  - [x] Run Python unit tests for `agent-service`.
  - [x] Run ruff and mypy for `agent-service`.
  - [x] Run `git diff --check`.

### Review Findings

- [x] [Review][Patch] `/health/ready` returned raw 500 for real SQLite dependency failures instead of safe 503. [agent-service/src/agent_service/api/health.py:48]
- [x] [Review][Patch] Railway template pointed SQLite state at `/data/agent-service/runtime-state.sqlite3` without the Docker image creating a writable path for the non-root service user. [agent-service/Dockerfile:18]
- [x] [Review][Patch] README still listed the Story 4.5 deployment envelope, Dockerfile, readiness endpoint, internal URL, and service registration as out of scope. [agent-service/README.md:10]
- [x] [Review][Patch] Deployment doc marked env vars as deploy/tool-call required while the Railway template omitted them. [agent-service/deployment/railway-service.toml:12]
- [x] [Review][Patch] Scope regression did not guard against future worker-facing `AGENT_SERVICE_INTERNAL_URL` config consumption outside worker/router files. [agent-service/tests/unit/test_scope.py:39]

## Dev Notes

### Current Architecture Context

- AD-19 is the direct architecture rule for this story: `agent-service` must define Docker build strategy, start command, health endpoint, readiness endpoint, internal URL consumed by worker, environment variables, secret ownership, and Railway or equivalent service registration before non-local shadow mode.
- Story 4.5 may add `/health/ready`, Dockerfile, `.dockerignore`, and inert service registration documentation/template. It must not actually deploy the service.
- Railway memory note says the existing project `reasonable-adaptation` production auto-deploy is verified for `api`, `worker`, and `dashboard` from `main`. Do not assume auto-deploy is broken and do not run manual deploy commands in this story.
- Epic 5 owns `MafAgentRuntimeClient`; do not add worker client code, worker env consumption, router changes, or shadow execution here.

### Existing Repo State

- `agent-service` already has `/health/live`, `/runtime/process-message` skeleton, scoped internal auth primitives, runtime state settings/store, pytest, ruff, and mypy.
- `create_app()` currently instantiates settings so invalid runtime state config fails during app creation.
- Existing Node services have Dockerfiles under `apps/api`, `apps/worker`, and `apps/dashboard`. `agent-service` currently has no Dockerfile or deployment metadata.
- Story 4.4 added runtime state checks. Readiness can use `create_runtime_state_store(settings)` and a no-op/read-missing dependency check, but must not wire state into runtime processing.

### Deployment Envelope Guidance

Recommended files:

```text
agent-service/
  Dockerfile
  .dockerignore
  deployment.md
  deployment/
    railway-service.toml
```

`deployment/railway-service.toml` should be an inert service registration template, not an active root Railway config. Include:

- service name: `agent-service`
- root directory: `agent-service`
- Dockerfile path: `agent-service/Dockerfile`
- health check path: `/health/ready`
- internal URL variable for future worker client: `AGENT_SERVICE_INTERNAL_URL`
- production start command: `python -m uvicorn agent_service.main:create_app --factory --host 0.0.0.0 --port ${AGENT_SERVICE_PORT:-8001}`

### Readiness Guidance

- `/health/live` remains process liveness and should not check dependencies.
- `/health/ready` should report dependency readiness and return HTTP 503 on dependency/config failure.
- Minimum dependency check for this story: selected runtime state backend can be instantiated and read a missing sentinel key without error.
- Response must not include raw secrets, request payloads, Slack text, or stack traces.

### Env Var / Secret Ownership Guidance

Document at least:

- `AGENT_SERVICE_PORT` - platform/runtime owner, non-secret
- `AGENT_SERVICE_ENVIRONMENT` - platform/runtime owner, non-secret
- `AGENT_SERVICE_LOG_LEVEL` - platform/runtime owner, non-secret
- `AGENT_SERVICE_OTLP_ENDPOINT` - observability owner, non-secret
- `AGENT_SERVICE_TRACING_ENABLED` - observability owner, non-secret
- `AGENT_SERVICE_RUNTIME_STATE_BACKEND` - platform/runtime owner, non-secret
- `AGENT_SERVICE_RUNTIME_STATE_SQLITE_PATH` - platform/runtime owner, non-secret
- `AGENT_SERVICE_NON_LOCAL_SHADOW_ENABLED` - platform/runtime owner, non-secret
- `AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET` - platform/security owner, secret
- `AGENT_SERVICE_INTERNAL_SERVICE_IDENTITY` - platform/security owner, non-secret
- `AGENT_SERVICE_INTERNAL_URL` - future worker client env, platform/runtime owner, non-secret

### Out Of Scope

- Actual Railway deployment, `railway up`, or production service mutation
- `MafAgentRuntimeClient`
- TypeScript worker routing changes
- non-local shadow execution or canary behavior
- MAF workflow, agents, or tools
- read/write context tool endpoints
- dashboard/admin UI
- direct writes to memory, goals, risk records, scheduled actions, messages, surveys, manager analytics, runtime attempts/actions, or domain aggregates

### Previous Story Intelligence

- Story 4.1 disabled FastAPI docs/OpenAPI exposure and established dependency-light Python service settings.
- Story 4.2 added `/runtime/process-message` skeleton only.
- Story 4.3 added scoped internal auth primitives and guard-level audit recording.
- Story 4.4 added runtime state settings and memory/SQLite store primitives, and made app creation fail closed for invalid state config.
- Worktree note: Stories 4.1-4.4 changes are currently uncommitted on top of `dce563c`. Do not revert them; build Story 4.5 on the current working tree unless the user asks for a different git hygiene step.

### Testing Requirements

- Tests must be local and deterministic.
- Do not require Redis, Postgres, Slack, Azure, LangWatch, OpenAI, TypeScript service process, Docker daemon, Railway CLI, or network.
- Run `agent-service/.venv/bin/python -m pytest agent-service/tests/unit`.
- Run `agent-service/.venv/bin/python -m ruff check agent-service`.
- Run `cd agent-service && .venv/bin/python -m mypy src tests`.
- Run `git diff --check`.

### References

- `_bmad-output/planning-artifacts/epics.md` - Epic 4 Story 4.5 requirements and FR22 mapping.
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md` - AD-19 and consistency conventions.
- `docs/superpowers/railway-deploy.md` - Railway deployment memory; existing auto-deploy applies to `api`, `worker`, and `dashboard`.
- `_bmad-output/implementation-artifacts/4-4-add-durable-session-and-checkpoint-store.md` - previous story context and runtime state checks.
- `agent-service/src/agent_service/api/health.py` - health router pattern.
- `agent-service/src/agent_service/infrastructure/runtime_state.py` - readiness dependency primitive.
- `agent-service/tests/unit/test_scope.py` - scope regression tests to update.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story created after Story 4.4 was marked done in BMAD tracking.
- Loaded BMAD create-story and dev-story workflows, config, Epic 4 Story 4.5 requirements, architecture AD-19, Railway deployment memory, existing Dockerfile patterns, health router, Story 4.4 previous-story context, and current sprint status.
- No `project-context.md` was found.
- No external package research or dependency installation was required for story creation.
- Started dev-story implementation from baseline `dce563c` on a dirty worktree containing uncommitted Story 4.1 through Story 4.4 changes.
- RED verification: `agent-service/.venv/bin/python -m pytest agent-service/tests/unit/test_health.py agent-service/tests/unit/test_deployment_envelope.py agent-service/tests/unit/test_scope.py` failed because `/health/ready`, `agent-service/Dockerfile`, and deployment metadata did not exist yet.
- Implemented `/health/ready` with settings/runtime-state dependency checks and safe HTTP 503 failure response.
- Added `AGENT_SERVICE_PORT` setting and deployable Dockerfile with Python 3.13, production uvicorn start command, exposed port, and container healthcheck.
- Added `.dockerignore`, `deployment.md`, and inert `deployment/railway-service.toml` service registration template.
- Verification: `agent-service/.venv/bin/python -m pytest agent-service/tests/unit` passed with 45 tests and the existing Starlette `httpx` deprecation warning.
- Verification: `agent-service/.venv/bin/python -m ruff check agent-service` passed.
- Verification: `cd agent-service && .venv/bin/python -m mypy src tests` passed.
- Verification: `git diff --check` passed.
- BMAD code review found five patch findings: safe readiness error handling, writable runtime-state data path, README scope contradiction, env template mismatch, and worker URL scope guard coverage.
- Review fixes applied within Story 4.5 scope; no worker client, MAF workflow/tools, routing, shadow/canary execution, domain write path, dashboard/admin UI, or Railway deployment was added.
- Re-verification after review fixes: `agent-service/.venv/bin/python -m pytest agent-service/tests/unit` passed with 46 tests and the existing Starlette `httpx` deprecation warning.
- Re-verification after review fixes: `agent-service/.venv/bin/python -m ruff check agent-service` passed.
- Re-verification after review fixes: `cd agent-service && .venv/bin/python -m mypy src tests` passed.
- Re-verification after review fixes: `git diff --check` passed.

### Completion Notes List

- Story 4.5 is ready for dev-story implementation.
- Scope is explicitly limited to readiness and deployable service envelope metadata; no deployment execution or worker runtime integration.
- Story 4.5 implementation is complete and ready for BMAD code review.
- Added deployable service envelope metadata without mutating Railway services or adding worker routing.
- Added readiness endpoint that can fail independently from liveness.
- BMAD code review findings were fixed and Story 4.5 is done.

### File List

- `_bmad-output/implementation-artifacts/4-5-define-deployable-service-envelope.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `agent-service/.dockerignore`
- `agent-service/Dockerfile`
- `agent-service/README.md`
- `agent-service/deployment.md`
- `agent-service/deployment/railway-service.toml`
- `agent-service/src/agent_service/api/health.py`
- `agent-service/src/agent_service/infrastructure/settings.py`
- `agent-service/tests/unit/test_deployment_envelope.py`
- `agent-service/tests/unit/test_health.py`
- `agent-service/tests/unit/test_scope.py`

### Change Log

- 2026-08-06: Created Story 4.5 developer context from Epic 4, architecture AD-19, Railway deployment memory, Story 4.4 learnings, and current deployment/health patterns.
- 2026-08-06: Started Story 4.5 dev-story implementation.
- 2026-08-06: Implemented readiness endpoint, Dockerfile, deployment metadata, docs, tests, and verification.
- 2026-08-06: Fixed BMAD code review findings, re-ran verification, and marked Story 4.5 done.

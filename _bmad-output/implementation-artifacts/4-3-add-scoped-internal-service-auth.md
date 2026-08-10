---
baseline_commit: dce563c
---

# Story 4.3: Add Scoped Internal Service Auth

Status: done
Epic: 4 - Deployable Python Agent Service Foundation
Story ID: 4.3

## Story

As a security reviewer,
I want Python-to-TypeScript calls to use scoped service authentication,
so that MAF tools cannot reuse admin credentials or trust caller-supplied tenant IDs.

## Acceptance Criteria

1. Given Python calls a TypeScript internal read endpoint, when TypeScript receives the request, then it validates a service credential with tenant/workspace claims.
2. Given Python calls a TypeScript internal endpoint outside the service credential allowlist, when TypeScript receives the request, then it rejects the request before any handler or storage access can occur.
3. Given a TypeScript internal endpoint requires read versus command permission, when the service credential has only the wrong permission, then TypeScript rejects the request.
4. Given a tool call is authorized or rejected, when audit fields are recorded, then trace ID, service identity, tenant/workspace scope, endpoint, permission, and decision are captured without raw message text or full request payloads.
5. Given this story is complete, when the diff is inspected, then no `MafAgentRuntimeClient`, MAF workflow or tools, durable session/checkpoint backend, readiness endpoint, Docker/deployment envelope, non-local shadow or canary behavior, worker routing change, domain aggregate write path, or dashboard/admin UI has been added.

## Tasks / Subtasks

- [x] Add a shared internal service credential shape for Python-to-TypeScript calls. (AC: 1, 3)
  - [x] Use a deterministic signed-token format built on standard library/runtime primitives; do not add a new auth dependency unless unavoidable.
  - [x] Include authenticated claims for service identity, tenant ID, workspace ID, read/command permissions, endpoint allowlist, issued-at, and expiry.
  - [x] Keep secrets optional at app startup but fail closed when internal auth validation or token creation is attempted without a configured secret.
  - [x] Do not reuse `ADMIN_API_KEY` or any dashboard/admin auth path.
- [x] Add TypeScript scoped internal auth validation under `apps/api`. (AC: 1, 2, 3, 5)
  - [x] Add an `internal-auth` module/service/guard or equivalent NestJS primitive that validates bearer service credentials.
  - [x] Validate signature, expiry, tenant/workspace claim shape, requested endpoint membership in the credential allowlist, and required permission.
  - [x] Expose a decorator or small policy API future internal read endpoints can use without trusting tenant/workspace IDs from request JSON.
  - [x] Keep this story to auth primitives; do not add a new tool endpoint unless a no-op test fixture route is strictly necessary and not shipped in `AppModule`.
- [x] Add sanitized audit projection for internal tool-call auth decisions. (AC: 4)
  - [x] Build audit parameters compatible with the existing audit log port/repository.
  - [x] Capture trace ID, service identity, tenant ID, workspace ID, endpoint, permission, decision, and stable rejection reason.
  - [x] Ensure audit metadata does not include `message`, `text`, `prompt`, raw body, raw authorization token, or full request payload fields.
- [x] Add Python agent-service token creation support for future tool calls. (AC: 1, 5)
  - [x] Add settings for the shared internal service secret and service identity using the existing `AGENT_SERVICE_` prefix.
  - [x] Add a small signer/helper that emits the same credential format TypeScript validates.
  - [x] Keep it detached from `/runtime/process-message`; do not call TypeScript APIs in this story.
- [x] Add focused tests. (AC: 1-5)
  - [x] Add TypeScript unit tests for valid credential authorization, wrong secret, expiry, malformed token, wrong permission, endpoint outside allowlist, and sanitized audit fields.
  - [x] Add Python unit tests for token creation, missing-secret fail closed, and settings environment names.
  - [x] Add scope regression tests that keep runtime client, MAF workflow/tools, durable state, deployment envelope, readiness, shadow/canary, routing changes, aggregate writes, and admin/dashboard UI out of Story 4.3.
- [x] Update developer docs. (AC: 1-5)
  - [x] Update `agent-service/README.md` or API-adjacent docs with the credential format and clear exclusions.
  - [x] Document that Story 4.3 only provides scoped auth primitives and does not make runtime/tool calls.
- [x] Update implementation tracking. (AC: 1-5)
  - [x] Update this story's Dev Agent Record during implementation.
  - [x] Move sprint status from `ready-for-dev` to `in-progress` during dev-story and to `review` when implementation is complete.
- [x] Run and record verification. (AC: 1-5)
  - [x] Run relevant TypeScript API tests and typecheck.
  - [x] Run Python unit tests for `agent-service`.
  - [x] Run ruff and mypy for `agent-service`.
  - [x] Run `git diff --check`.

### Review Findings

- [x] [Review][Patch] Auth decisions are not recorded at the guard/enforcement point [`apps/api/src/internal-auth/internal-auth.guard.ts`]
- [x] [Review][Patch] Claim-less rejection paths cannot build required audit entries [`apps/api/src/internal-auth/internal-auth.service.ts`]
- [x] [Review][Patch] Whitespace-only or weak shared secrets can be treated as configured [`apps/api/src/internal-auth/internal-auth.service.ts`]
- [x] [Review][Patch] Signed tokens can carry excessive lifetimes [`apps/api/src/internal-auth/internal-auth.service.ts`]
- [x] [Review][Patch] Duplicate authorization headers are accepted ambiguously [`apps/api/src/internal-auth/internal-auth.service.ts`]
- [x] [Review][Patch] Python signer can emit claims TypeScript will reject [`agent-service/src/agent_service/infrastructure/internal_auth.py`]
- [x] [Review][Patch] Trace IDs can carry raw text into audit metadata [`apps/api/src/internal-auth/internal-auth.service.ts`]
- [x] [Review][Patch] Wrong-permission test does not isolate permission denial [`apps/api/src/internal-auth/internal-auth.service.test.ts`]
- [x] [Review][Patch] Invalid claim shapes are not covered by tests [`apps/api/src/internal-auth/internal-auth.service.test.ts`]

## Dev Notes

### Current Architecture Context

- AD-16 is the direct architecture rule for this story: Python-to-TypeScript tool calls must use an internal service credential with tenant/workspace scope, endpoint allowlist, audit fields, and separate read versus command permissions.
- TypeScript must validate tenant scope from authenticated service claims. Do not trust `tenantId` or `workspaceId` supplied in future request JSON.
- CAP-2 still keeps TypeScript as the side-effect owner. Python may call approved internal TypeScript surfaces later, but this story should only create the auth primitive and Python token signer.
- AD-14 keeps runtime HTTP schemas in `packages/contracts/runtime/openapi.json`; Story 4.3 should not change the runtime request/result contract.
- AD-19 deployment envelope is still Story 4.5. Do not add Dockerfile, Railway service registration, readiness endpoint, production start command, internal URL wiring, or secret ownership matrix beyond local setting names needed for the auth primitive.

### Existing Repo State

- `apps/api` is a NestJS app using `@nestjs/common`, `@nestjs/config`, and Fastify. Existing admin/sensitive endpoints use `apps/api/src/auth/api-key.guard.ts`, which validates `X-Api-Key` against `ADMIN_API_KEY`.
- `ADMIN_API_KEY` is admin-only and must not be reused for Python tool auth.
- Environment validation lives in `packages/config/src/env.ts`. Add any new internal auth env only if required by the TypeScript service and keep startup compatible with local/test environments.
- Existing audit persistence uses `AuditLogRepository` in `apps/api/src/audit/audit-log.repository.ts` and `AuditLogPort` in `packages/application/src/ports/audit-log.port.ts`. The current actor types are `user`, `agent`, `system`, and `admin`; use `system` with service identity metadata unless a broader schema change is explicitly needed.
- `agent-service` settings use the `AGENT_SERVICE_` env prefix in `agent-service/src/agent_service/infrastructure/settings.py`.

### Recommended File Structure For Story 4.3

```text
apps/api/src/internal-auth/
  internal-auth.audit.ts
  internal-auth.guard.ts
  internal-auth.module.ts
  internal-auth.service.ts
  internal-auth.types.ts
  internal-auth.service.test.ts
agent-service/src/agent_service/infrastructure/
  internal_auth.py
agent-service/tests/unit/
  test_internal_auth.py
```

Adjust file names to local conventions if implementation shows a better NestJS shape, but keep the code close to `apps/api/src/internal-auth` and `agent-service/src/agent_service/infrastructure`.

### Credential Format Guidance

- Prefer a compact signed token that can be generated and validated without new dependencies:

```text
v1.<base64url-json-claims>.<base64url-hmac-sha256-signature>
```

- Claims should include:
  - `serviceIdentity`
  - `tenantId`
  - `workspaceId`
  - `permissions`: array containing `read` and/or `command`
  - `endpointAllowlist`: exact endpoint paths, such as `/internal/maf/context/read`
  - `iat`
  - `exp`
  - optional `traceId`

- Sign the exact `v1.<base64url-json-claims>` bytes with `INTERNAL_SERVICE_AUTH_SECRET` on TypeScript and `AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET` on Python.
- Keep the token short lived. Tests can use deterministic timestamps.

### Audit Field Guidance

Use a stable audit projection compatible with the existing audit log port:

```ts
{
  tenantId: claims.tenantId,
  actorType: 'system',
  actorId: claims.serviceIdentity,
  action: 'internal_tool_call.authorized' | 'internal_tool_call.rejected',
  resourceType: 'internal_endpoint',
  resourceId: endpoint,
  reason: rejectionReason,
  metadata: {
    serviceIdentity,
    workspaceId,
    endpoint,
    permission,
    decision,
    traceId
  },
  traceId
}
```

Never include raw Slack message text, prompts, raw JSON bodies, memory content, auth headers, bearer tokens, or full payloads in audit metadata.

### Out Of Scope

- `MafAgentRuntimeClient`
- Runtime worker routing changes or non-local shadow execution
- canary behavior
- MAF workflow, agents, or tools
- actual read/write context tool endpoints
- durable session/checkpoint backend
- readiness endpoint
- Dockerfile, Railway service registration, production start command, internal URL wiring, or full secret ownership matrix
- dashboard/admin UI
- direct writes to memory, goals, risk records, scheduled actions, messages, surveys, manager analytics, or runtime aggregate ownership changes

### Previous Story Intelligence

- Story 4.1 established the Python `agent_service` scaffold, FastAPI app factory, `/health/live`, Pydantic settings, pytest, ruff, and mypy.
- Story 4.2 added `POST /runtime/process-message` as a contract-valid skeleton. Keep the new auth helper detached from that endpoint.
- Story 4.2 also strengthened scope regression tests. Extend those tests for Story 4.3 instead of weakening them.
- Worktree note: Story 4.1 and Story 4.2 changes are currently uncommitted on top of `dce563c`. Do not revert them; build Story 4.3 on the current working tree unless the user asks for a different git hygiene step.

### Testing Requirements

- Tests must be local and deterministic.
- TypeScript tests should instantiate the auth service/guard directly; no Postgres, Redis, Slack, Azure, LangWatch, OpenAI, or Python service process.
- Python tests should instantiate settings and signer directly; no HTTP calls or TypeScript service process.
- Run `pnpm --filter @entalent/api test -- src/internal-auth` or the closest available scoped command after TypeScript implementation.
- Run `pnpm --filter @entalent/api typecheck` if TypeScript source is changed.
- Run `agent-service/.venv/bin/python -m pytest`, `agent-service/.venv/bin/python -m ruff check .`, and `agent-service/.venv/bin/python -m mypy src tests`.
- Run `git diff --check`.

### References

- `_bmad-output/planning-artifacts/epics.md` - Epic 4 Story 4.3 requirements and FR19/FR20 mapping.
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md` - AD-16 and consistency conventions.
- `_bmad-output/specs/spec-maf-runtime-migration/SPEC.md` - CAP-2 constraints and non-goals.
- `_bmad-output/implementation-artifacts/4-2-add-runtime-endpoint-skeleton.md` - previous story patterns, exclusions, and dirty worktree note.
- `apps/api/src/auth/api-key.guard.ts` - existing admin API-key guard that must not be reused for service auth.
- `apps/api/src/audit/audit-log.repository.ts` - audit persistence adapter.
- `packages/application/src/ports/audit-log.port.ts` - audit port shape.
- `packages/config/src/env.ts` - TypeScript env validation.
- `agent-service/src/agent_service/infrastructure/settings.py` - Python settings pattern.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story created after Story 4.2 was marked done in BMAD tracking.
- Loaded BMAD create-story and dev-story workflows, config, sprint status, Epic 4 Story 4.3 requirements, architecture AD-16, SPEC CAP-2 constraints, Story 4.2 previous-story context, existing NestJS admin auth guard, audit port/repository, TypeScript env validation, and Python settings.
- No `project-context.md` was found.
- No new external package research was required for story creation because the story can use Node `crypto` and Python standard-library HMAC/base64 primitives.
- Started dev-story implementation from baseline `dce563c` on a dirty worktree containing uncommitted Story 4.1 and Story 4.2 changes.
- RED verification: `pnpm --filter @entalent/api test -- src/internal-auth` failed because `internal-auth` modules did not exist yet.
- RED verification: `agent-service/.venv/bin/python -m pytest agent-service/tests/unit/test_internal_auth.py` failed because `agent_service.infrastructure.internal_auth` did not exist yet.
- Implemented signed `v1.<base64url-json-claims>.<base64url-hmac-sha256-signature>` service credentials in TypeScript and Python using Node/Python standard library crypto.
- Implemented TypeScript authorization decisions for missing secret/header, malformed token, invalid signature, invalid claims, expiry, permission denial, and endpoint allowlist denial.
- Implemented NestJS `RequireInternalServiceAuth` decorator, guard, module, and sanitized audit projection compatible with `AuditLogPort`.
- Implemented Python `create_internal_service_token` and `AGENT_SERVICE_INTERNAL_SERVICE_AUTH_SECRET` / `AGENT_SERVICE_INTERNAL_SERVICE_IDENTITY` settings.
- Verification: `pnpm --filter @entalent/api test -- src/internal-auth` passed with 13 tests.
- Verification: `pnpm --filter @entalent/api typecheck` passed.
- Verification: `pnpm --filter @entalent/api lint` passed with 7 pre-existing `apps/api/src/main.ts` no-console warnings and no errors.
- Verification: `pnpm --filter @entalent/config typecheck` passed.
- Verification: `pnpm --filter @entalent/config lint` passed.
- Verification: `agent-service/.venv/bin/python -m pytest agent-service/tests/unit` passed with 22 tests and the existing Starlette `httpx` deprecation warning.
- Verification: `agent-service/.venv/bin/python -m ruff check agent-service` passed.
- Verification: `cd agent-service && .venv/bin/python -m mypy src tests` passed.
- Verification: `git diff --check` passed.
- BMAD code review ran Blind Hunter, Edge Case Hunter, and Acceptance Auditor. Accepted and fixed findings for guard-level audit recording, claim-less rejection audit, weak/blank secrets, maximum token lifetime, duplicate authorization headers, Python signer prevalidation, trace ID sanitization, isolated permission testing, and invalid claim-shape coverage.
- Review dismissal: the OTel alias comment was treated as a prior Story 4.1 review decision, not a Story 4.3 scoped auth regression; current tests intentionally assert `AGENT_SERVICE_OTEL_SERVICE_NAME`.
- Review verification: `pnpm --filter @entalent/api test -- src/internal-auth` passed with 20 tests.
- Review verification: `pnpm --filter @entalent/api typecheck` passed.
- Review verification: `pnpm --filter @entalent/api lint` passed with 7 pre-existing `apps/api/src/main.ts` no-console warnings and no errors.
- Review verification: `pnpm --filter @entalent/config typecheck` passed.
- Review verification: `pnpm --filter @entalent/config lint` passed.
- Review verification: `agent-service/.venv/bin/python -m pytest agent-service/tests/unit` passed with 24 tests and the existing Starlette `httpx` deprecation warning.
- Review verification: `agent-service/.venv/bin/python -m ruff check agent-service` passed.
- Review verification: `cd agent-service && .venv/bin/python -m mypy src tests` passed.
- Review verification: `git diff --check` passed.

### Completion Notes List

- Story 4.3 is ready for dev-story implementation.
- Scope is explicitly limited to scoped internal auth primitives, sanitized audit projection, and Python token signing support.
- Story 4.3 implementation is complete and ready for BMAD code review.
- Added TypeScript scoped internal service auth primitives without adding shipped internal tool endpoints or worker runtime routing.
- Added Python token signing support without wiring it into `/runtime/process-message`.
- Sanitized audit projection captures required service/tenant/workspace/endpoint/permission/decision fields and ignores raw request text/token material.
- Review fixes made guard enforcement record authorized and rejected decisions through `AuditLogRepository`, added redacted unknown-scope audit rows for claim-less rejections, and hardened tokens with trimmed secrets, max five-minute lifetime, duplicate-header rejection, Python claim prevalidation, and trace ID sanitization.

### File List

- `_bmad-output/implementation-artifacts/4-3-add-scoped-internal-service-auth.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/src/internal-auth/index.ts`
- `apps/api/src/internal-auth/internal-auth.guard.test.ts`
- `apps/api/src/internal-auth/internal-auth.guard.ts`
- `apps/api/src/internal-auth/internal-auth.module.ts`
- `apps/api/src/internal-auth/internal-auth.service.test.ts`
- `apps/api/src/internal-auth/internal-auth.service.ts`
- `packages/config/src/env.ts`
- `agent-service/README.md`
- `agent-service/src/agent_service/infrastructure/internal_auth.py`
- `agent-service/src/agent_service/infrastructure/settings.py`
- `agent-service/tests/unit/test_internal_auth.py`
- `agent-service/tests/unit/test_scope.py`

### Change Log

- 2026-08-06: Created Story 4.3 developer context from Epic 4, architecture AD-16, SPEC CAP-2 constraints, Story 4.2 learnings, and existing TypeScript/Python auth/settings/audit patterns.
- 2026-08-06: Started Story 4.3 dev-story implementation.
- 2026-08-06: Implemented scoped internal service auth primitives, Python token signer, sanitized audit projection, docs, tests, and verification.
- 2026-08-06: Addressed BMAD code review findings and marked Story 4.3 done.

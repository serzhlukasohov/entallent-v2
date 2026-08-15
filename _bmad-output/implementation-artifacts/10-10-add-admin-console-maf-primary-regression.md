---
baseline_commit: b5eed099a56c92643d77d20d31937a5aa5eaf910
---

# Story 10.10: Add Admin Console MAF-Primary Regression

Status: done
Epic: 10 - MAF-First Feature Regression Framework
Story ID: 10.10

## Story

As an operator,
I want the admin console control surfaces to have explicit MAF-primary regression coverage,
so that MAF runtime operations remain inspectable, retryable, auditable, feature-flagged, and sanitized.

## Acceptance Criteria

1. Given MAF-related jobs exist in queues, then the admin queue endpoint exposes queue counts and failed job metadata.
2. Given a failed job is retried, then retry remains unambiguous and queue-scoped where needed.
3. Given runtime feature flags are configured, then the admin feature flag endpoint exposes known MAF runtime controls.
4. Given MAF runtime or LLM run records exist, then admin list endpoints expose filtered run/audit envelopes and totals.
5. Given an admin opens user debug, then access is audited and private risk reasoning/raw message text is not returned.
6. Given this story adds product-level confidence, then it reuses existing API/controller tests and does not create a new regression framework.

## Tasks / Subtasks

- [x] Identify the smallest existing test homes for Admin console coverage. (AC: 1-6)
  - [x] Use `apps/api/src/admin/queues.controller.test.ts` for queue list/retry coverage.
  - [x] Use one API controller test file for feature flags, audit logs, LLM runs, and user debug coverage.
  - [x] Do not create a new runner, framework, fixture package, sim, or eval.
- [x] Prove queue inspection and retry controls. (AC: 1-2)
  - [x] Assert queue counts are exposed.
  - [x] Assert failed job metadata is exposed.
  - [x] Preserve existing ambiguous retry and named-queue retry coverage.
- [x] Prove admin runtime visibility controls. (AC: 3-4)
  - [x] Assert known MAF runtime feature flags are exposed.
  - [x] Assert audit log list returns rows and total.
  - [x] Assert LLM/runtime run list returns rows and total.
- [x] Prove sanitized user debug access. (AC: 5)
  - [x] Assert admin debug access appends an audit log.
  - [x] Assert message text is truncated to preview.
  - [x] Assert risk reasoning/private evidence is not returned.
- [x] Run the smallest matching verification gate. (AC: 1-6)
  - [x] Run targeted API admin console controller tests.
  - [x] Run `pnpm typecheck`.

## Dev Notes

- This story implements the tenth row of the MAF-first feature regression matrix: Admin console. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/feature-regression-matrix.md#Feature-Regression-Matrix]
- Product-level regressions must use MAF primary; legacy `ConversationOrchestrator` coverage is fallback or rollback only. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md#Constraints]
- Queue inspection and retry live in `QueuesController`; existing tests already cover ambiguous retry and named-queue retry. [Source: apps/api/src/admin/queues.controller.ts; apps/api/src/admin/queues.controller.test.ts]
- Runtime controls are listed by `FeatureFlagsController` through `FEATURE_FLAGS`, including MAF disabled/shadow/canary/primary/denylist keys. [Source: apps/api/src/admin/feature-flags.controller.ts; packages/application/src/ports/feature-flag.port.ts]
- Runtime/LLM and audit visibility are represented by `LlmRunsController` and `AuditLogsController`. [Source: apps/api/src/admin/llm-runs.controller.ts; apps/api/src/admin/audit-logs.controller.ts]
- User debug is a sensitive admin surface; it must audit access, truncate message text, and expose safe risk fields only. [Source: apps/api/src/admin/user-debug.controller.ts]

## Out Of Scope

- New admin UI.
- New queue backend or retry semantics.
- New feature flag system.
- New audit schema.
- New regression framework, sim, or eval.
- Legacy `ConversationOrchestrator` expansion.

## References

- [SPEC: MAF-First Feature Regression Framework](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md)
- [Feature Regression Matrix](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/feature-regression-matrix.md)
- [Story 10.9: Add Manager Trends MAF-Primary Regression](/Users/serzh/Documents/enTalentNew/_bmad-output/implementation-artifacts/10-9-add-manager-trends-maf-primary-regression.md)

## Dev Agent Record

### Agent Model Used

Codex GPT-5

### Debug Log References

- `pnpm --filter @entalent/api test -- queues.controller.test.ts admin-console.controllers.test.ts`
- `pnpm typecheck`

### Completion Notes List

- Added queue list/dead-letter coverage while preserving existing retry ambiguity and queue-scoped retry tests.
- Queue inspection now uses the Redis DB from `REDIS_URL` and rejects invalid DB paths.
- Added admin console controller coverage for MAF runtime feature flags, audit log listing, LLM/runtime run listing, and user debug sanitization.
- Verified user debug access writes an audit event, truncates message previews, and omits private risk reasoning/evidence from the response.
- Verified targeted API coverage and workspace typecheck.

### File List

- `apps/api/src/admin/admin-console.controllers.test.ts`
- `apps/api/src/admin/queues.controller.ts`
- `apps/api/src/admin/queues.controller.test.ts`
- `_bmad-output/implementation-artifacts/10-10-add-admin-console-maf-primary-regression.md`

## Change Log

- 2026-08-15: Created Admin console MAF-primary regression story.
- 2026-08-15: Implemented and verified Admin console MAF-primary regression story.

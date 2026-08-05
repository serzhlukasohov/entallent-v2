---
baseline_commit: ad89c16f9e468a6699925d4722106da881e954c2
---

# Story 1.3: Add MAF Runtime Control Flags

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator,
I want explicit MAF runtime control flags and kill-switch semantics,
so that MAF can be disabled globally or scoped by tenant/user before rollout.

## Acceptance Criteria

1. Given the global MAF kill switch is enabled, when any conversation job is processed, then runtime mode resolves to `maf_disabled` and the router invokes only `TypeScriptAgentRuntime`.
2. Given tenant/user denylist rules match a job, when shadow or canary mode would otherwise apply, then denylist precedence wins and the job uses TypeScript-only processing.

## Tasks / Subtasks

- [ ] Define runtime control flag contract in `packages/application` (AC: 1, 2)
  - [ ] Add explicit runtime flag keys for global disable, shadow mode, canary mode, and user denylist.
  - [ ] Keep key names aligned with architecture mode names: `maf_runtime_disabled`, `maf_runtime_shadow`, `maf_runtime_canary`, and `maf_runtime_user_denylist`.
  - [ ] Add a framework-neutral port or reader type for runtime control evaluation; do not import NestJS, Drizzle, worker modules, or database schema into `packages/application`.
- [ ] Add a runtime mode resolver/evaluator in `packages/application` (AC: 1, 2)
  - [ ] Evaluate mode per `ProcessMessageRequest`, never at process start.
  - [ ] Apply precedence exactly: global kill switch, tenant/user denylist, shadow mode, canary mode, TypeScript default.
  - [ ] Return `maf_disabled` for global kill-switch matches.
  - [ ] Return a TypeScript-only mode for tenant/user denylist matches before considering shadow or canary.
  - [ ] Treat any flag/read failure as fail-closed TypeScript-only by throwing to the router or by returning a documented TypeScript fallback that preserves the existing warning path.
- [ ] Rewire `AgentRuntimeRouter` to consume the resolver while preserving current behavior (AC: 1, 2)
  - [ ] Keep `TypeScriptAgentRuntime` as the only invoked runtime in this story.
  - [ ] Ensure `typescript`, `maf_disabled`, shadow, and canary decisions cannot call a missing MAF client.
  - [ ] Preserve the Story 1.2 warning behavior when evaluation fails, including `traceId` and no message text.
- [ ] Add worker adapter wiring for runtime controls (AC: 1, 2)
  - [ ] Reuse the existing `feature_flags` table and `FeatureFlagModule` patterns.
  - [ ] Inject the existing `FeatureFlagRepository` where boolean flag checks are enough.
  - [ ] Add a small worker-side adapter only if user-denylist metadata requires reading `feature_flags.metadata`.
  - [ ] Do not add a migration unless the existing `feature_flags.metadata` JSONB field cannot represent user denylist rules.
- [ ] Expose runtime flag keys to admin surfaces (AC: 1, 2)
  - [ ] Extend `FEATURE_FLAGS` so `apps/api/src/admin/feature-flags.controller.ts` returns runtime keys in `knownKeys`.
  - [ ] Do not seed MAF runtime flags as enabled by default; MAF must remain disabled unless an operator explicitly enables a runtime control row.
- [ ] Add focused tests (AC: 1, 2)
  - [ ] Unit-test resolver precedence: kill switch beats everything, denylist beats shadow/canary, shadow beats canary, canary beats default, unknown/disabled flags default to TypeScript.
  - [ ] Unit-test router fallback remains TypeScript-only for `maf_disabled`.
  - [ ] Add worker adapter tests if metadata-based user denylist parsing is implemented.
- [ ] Run verification commands (AC: 1, 2)
  - [ ] `pnpm --filter @entalent/application test -- agent-runtime`
  - [ ] `pnpm --filter @entalent/application typecheck`
  - [ ] `pnpm --filter @entalent/worker typecheck`
  - [ ] `pnpm --filter @entalent/api typecheck` if `FEATURE_FLAGS` changes affect admin API compilation.

## Dev Notes

### Current State

- Story 1.2 is done. `AGENT_RUNTIME_PORT` now resolves to `AgentRuntimeRouter`, and the router delegates to a separate `TypeScriptAgentRuntime` provider in `apps/worker/src/conversation/conversation.module.ts`.
- `AgentRuntimeRouter` already accepts an injected `evaluateMode` strategy and catches evaluation errors before delegating to TypeScript. Preserve this seam rather than moving flag logic into `ConversationProcessor`.
- `AgentRuntimeMode` already includes `typescript`, `maf_shadow`, `maf_canary`, and `maf_disabled`. This story gives those names operator control semantics but still invokes only the TypeScript runtime.
- `FeatureFlagPort` already exists in `packages/application/src/ports/feature-flag.port.ts` with `isEnabled(key, { tenantId, userId })`.
- `FeatureFlagRepository` in `apps/worker/src/feature-flags/feature-flag.repository.ts` already reads global and tenant-specific rows, treats unknown flags as disabled, and supports percentage rollout using a stable user bucket.
- The `feature_flags` schema already has `metadata: jsonb` and `tenant_id`, so a user denylist can likely be represented without a database migration.

### Architecture Compliance

- Follow AD-1: inbound conversation processing must still enter through `AgentRuntimePort.processMessage`; do not add concrete runtime dependencies to worker processors.
- Follow AD-13: runtime selection belongs inside `AgentRuntimeRouter`; it is evaluated per job and follows precedence: global kill switch, tenant/user denylist, shadow mode, canary mode, TypeScript default.
- Follow AD-5: user-facing MAF execution is not allowed until side-effect barriers and ledgers exist. In this story, every resolved mode still delegates to TypeScript.
- Runtime mode names must remain `typescript`, `maf_shadow`, `maf_canary`, and `maf_disabled`.
- Runtime mode evaluation failure must fail closed to TypeScript-only and must not block conversation processing.

### Implementation Guardrails

- Do not add `MafAgentRuntimeClient`, `agent-service`, Python/FastAPI calls, shadow diagnostics storage, canary rollout execution, or side-effect ledger logic in this story.
- Keep `packages/application` framework-neutral. Any Drizzle/NestJS/database access belongs in `apps/worker`.
- Do not make runtime flags startup-only. Operators must be able to change flag rows and affect later jobs without restarting the worker.
- Do not read `process.env` inside `packages/application`. If an environment-backed emergency flag is introduced, define it in `packages/config/src/env.ts` and read it through worker/Nest configuration before passing a framework-neutral value or adapter into the application layer.
- Do not log message text or user content from runtime flag evaluation.
- Avoid overloading the existing conversational feature flags. Runtime control keys should be clearly MAF-specific and exported from the shared application package.
- If user denylist metadata is implemented, validate/parsing should be conservative: malformed metadata must not enable MAF; it should fail closed to TypeScript-only.

### Previous Story Intelligence

- Commit `60f32de` added `AgentRuntimeRouter`, its tests, application exports, and worker provider wiring.
- Commit `1880470` fixed the fallback path so logger failures cannot prevent TypeScript fallback.
- Commit `ad89c16` marked Story 1.2 done after repeat code review.
- Story 1.2 review dismissed the never-settling async evaluator risk as future flag scope. Story 1.3 should now make async flag behavior explicit and test that failures fail closed.
- Full `@entalent/application lint` currently has pre-existing `no-explicit-any` issues in older tests. Prefer touched-file lint plus package test/typecheck unless the unrelated lint debt is addressed separately.

### Testing Requirements

- Add focused Vitest tests in `packages/application/src/use-cases` or a nearby application test location. Reuse the style from `agent-runtime-router.test.ts`.
- Use stubbed flag readers/ports for resolver precedence tests; no database is required for application-layer tests.
- If a worker metadata adapter is added, keep its tests isolated from live Postgres unless an existing worker repository test pattern exists.
- Worker verification can be typecheck-only unless runtime control wiring becomes complex enough to warrant a Nest provider test.

### Project Structure Notes

- Likely application files:
  - `packages/application/src/ports/feature-flag.port.ts`
  - `packages/application/src/use-cases/agent-runtime-router.ts`
  - `packages/application/src/use-cases/agent-runtime-mode-resolver.ts`
  - `packages/application/src/use-cases/agent-runtime-mode-resolver.test.ts`
  - `packages/application/src/index.ts`
- Likely worker files:
  - `apps/worker/src/conversation/conversation.module.ts`
  - `apps/worker/src/feature-flags/feature-flag.repository.ts` or a new adjacent runtime-control adapter if metadata parsing is needed.
- Likely API/admin surface:
  - `apps/api/src/admin/feature-flags.controller.ts` consumes `FEATURE_FLAGS`; updating exported keys should update `knownKeys`.
- Database schema changes are not expected for this story because `feature_flags.metadata` already exists.

### Latest Technical Information

- No new external library or API is required for this story. Use the stack versions already verified in the architecture spine: TypeScript 5.9.3, NestJS 10.4.22, Drizzle ORM 0.35.3, BullMQ 5.80.5, and pnpm 9.12.0.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.3]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md#AD-1]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md#AD-5]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md#AD-13]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md#Consistency-Conventions]
- [Source: packages/application/src/ports/agent-runtime.port.ts]
- [Source: packages/application/src/ports/feature-flag.port.ts]
- [Source: packages/application/src/use-cases/agent-runtime-router.ts]
- [Source: packages/application/src/use-cases/agent-runtime-router.test.ts]
- [Source: apps/worker/src/conversation/conversation.module.ts]
- [Source: apps/worker/src/feature-flags/feature-flag.repository.ts]
- [Source: packages/database/src/schema/feature-flags.ts]
- [Source: apps/api/src/admin/feature-flags.controller.ts]

## Dev Agent Record

### Agent Model Used

Codex GPT-5

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.

### File List

- `_bmad-output/implementation-artifacts/1-3-add-maf-runtime-control-flags.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

## Change Log

- 2026-08-05: Created Story 1.3 and marked ready for dev.

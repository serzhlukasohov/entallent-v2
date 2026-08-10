---
baseline_commit: dce563c
---

# Story 6.2: Add Staged Rollout Controls

Status: done
Epic: 6 - Canary Readiness And Rollout Gates
Story ID: 6.2

## Story

As an operator,
I want staged rollout controls for internal users, workspace, and percentage cohorts,
so that MAF exposure can increase gradually and rollback immediately.

## Acceptance Criteria

1. Given canary readiness is passed, when runtime flags are configured, then canary can target internal users, one workspace, or a stable percentage bucket.
2. Given the global kill switch is enabled during canary, when a job is routed, then it uses TypeScript-only processing regardless of canary settings.
3. Given runtime flag evaluation fails, when a job is routed, then it fails closed to TypeScript-only processing with the existing evaluation-failure decision source.
4. Given this story is complete, when the diff is inspected, then it adds only staged rollout targeting and tests; it must not enable user-facing MAF replies, Python-owned writes, command tools, dashboard/admin UI, deployment mutation, or rollback/ownership-transfer runbooks.
5. Given rollout decisions are logged or serialized, then raw Slack/user text, prompts, bearer tokens, service secrets, full request payloads, risk evidence, memory content, action payloads, provider errors, and stack traces are not exposed.

## Tasks / Subtasks

- [x] Extend runtime flag context for staged canary targeting. (AC: 1, 2, 3, 5)
  - [x] Extend `FeatureFlagContext` with optional workspace/runtime-safe rollout fields needed by runtime control; prefer `externalWorkspaceId` from `ProcessMessageRequest`.
  - [x] Preserve backward compatibility for existing feature flag consumers that provide only `tenantId` and optional `userId`.
  - [x] Keep runtime mode precedence exactly: global kill switch, tenant/user denylist, shadow, canary, TypeScript default.
  - [x] Do not add new database tables or migrations unless the existing `feature_flags` shape cannot express the targets.
- [x] Add canary-specific staged rollout evaluation. (AC: 1, 2, 3, 5)
  - [x] Reuse `feature_flags.enabled`, `feature_flags.rollout_percentage`, tenant scoping, and JSON metadata instead of inventing a second rollout store.
  - [x] Support internal user targeting through stable metadata allowlist keys such as `internalUserIds`, `userIds`, or `canaryUserIds`.
  - [x] Support workspace targeting through stable metadata allowlist keys such as `externalWorkspaceIds`, `workspaceIds`, or `canaryWorkspaceIds`.
  - [x] Support stable percentage cohorts using deterministic hashing; use stable non-sensitive identifiers and keep malformed rollout metadata fail-closed.
  - [x] Ensure tenant-scoped flag rows override global rows for canary targeting in the same way normal feature flags do.
- [x] Preserve kill switch and denylist rollback controls. (AC: 2, 3)
  - [x] Add or update tests proving `MAF_RUNTIME_DISABLED` wins over shadow and canary targeting.
  - [x] Add or update tests proving user denylist wins over shadow and canary targeting.
  - [x] Ensure runtime control repository helper failures or malformed metadata cannot accidentally enable canary.
- [x] Keep `maf_canary` non-user-facing in this story. (AC: 4)
  - [x] Do not make `AgentRuntimeRouter` call `MafAgentRuntimeClient.processCandidate` or `processMessage` for `maf_canary`.
  - [x] Do not return MAF output to users.
  - [x] Do not mutate feature flags from canary gate evaluation; operators configure flags externally through the existing feature flag store/API.
  - [x] Do not add dashboard/admin UI, Railway/deployment changes, Python command tools, Python domain writes, or rollback runbooks.
- [x] Add focused tests. (AC: 1-5)
  - [x] Unit-test `AgentRuntimeModeResolver` canary targeting for internal user, workspace, percentage bucket match, and non-match.
  - [x] Unit-test precedence: kill switch and denylist override all canary targeting.
  - [x] Unit-test flag evaluation failures still fail closed at the router.
  - [x] Unit-test worker runtime-control helper behavior for canary metadata, tenant/global precedence, malformed metadata, missing user/workspace identifiers, and stable percentage bucketing.
  - [x] Unit-test `AgentRuntimeRouter` still does not invoke MAF for `maf_canary`.
  - [x] Unit-test scope guardrails for no dashboard/admin UI, deployment mutation, Python command tools, Python writes, or user-facing MAF replies.
- [x] Update docs and tracking. (AC: 1-5)
  - [x] Document canary rollout metadata shape, precedence, rollback via kill switch/denylist, and non-user-facing boundary in `docs/maf-runtime-client.md`.
  - [x] Update this story's Dev Agent Record during implementation.
  - [x] Move sprint status from `ready-for-dev` to `in-progress` during dev-story and to `review` when implementation is complete.
- [x] Run and record verification. (AC: 1-5)
  - [x] Run focused application tests for `agent-runtime-mode-resolver` and `agent-runtime-router`.
  - [x] Run focused worker tests for `runtime-control-flag.repository`.
  - [x] Run `pnpm --filter @entalent/application typecheck`.
  - [x] Run `pnpm --filter @entalent/application lint`.
  - [x] Run `pnpm --filter @entalent/worker typecheck`.
  - [x] Run `pnpm --filter @entalent/worker lint`.
  - [x] Run `pnpm --filter @entalent/application test`.
  - [x] Run `pnpm --filter @entalent/worker test`.
  - [x] Run `git diff --check`.

### Review Findings

- [x] [Review][Patch] 100% canary percentage rollout can match requests with no `userId` [apps/worker/src/feature-flags/runtime-control-flag.repository.ts:172]
- [x] [Review][Patch] Blank canary allowlist identifiers are accepted as valid matches [apps/worker/src/feature-flags/runtime-control-flag.repository.ts:159]
- [x] [Review][Patch] Duplicate tenant or global canary rows make rollout outcome depend on database row order [apps/worker/src/feature-flags/runtime-control-flag.repository.ts:140]

## Dev Notes

### Current Architecture Context

- AD-9 says evaluation gates block rollout. Story 6.2 assumes canary readiness can be evaluated, but it must not create a bypass around the Story 6.1 gate decision.
- AD-10 says deterministic policy outranks agent output. Rollout targeting must be deterministic and must not inspect generated model text, memory content, risk evidence, or action payloads.
- AD-13 says runtime router owns mode selection and precedence is global kill switch, tenant/user denylist, shadow, canary, then TypeScript default. Preserve that exact order.
- AD-18 keeps shadow diagnostics TypeScript-owned. Story 6.2 should not write diagnostics or add a second rollout-evidence store.
- AD-19 requires deployment evidence before non-local exposure. Story 6.2 must not mutate Railway or deployment envelopes.

### Existing Code To Reuse

- `packages/application/src/use-cases/agent-runtime-mode-resolver.ts` owns per-job runtime mode decisions. Extend this layer only as needed to route `maf_canary` when staged targeting says the request is in cohort.
- `packages/application/src/ports/feature-flag.port.ts` defines `FeatureFlagContext` and runtime flag constants.
- `packages/application/src/use-cases/agent-runtime-mode-resolver.test.ts` already tests precedence and canary selection through a mocked runtime-control port.
- `packages/application/src/use-cases/agent-runtime-router.ts` still returns TypeScript output for `maf_canary`; keep that guardrail until later Epic 6 stories explicitly enable user-facing MAF.
- `packages/application/src/use-cases/agent-runtime-router.test.ts` already asserts `maf_canary` does not invoke MAF candidates.
- `apps/worker/src/feature-flags/runtime-control-flag.repository.ts` wraps `FeatureFlagRepository` for runtime-control-specific kill switch and denylist behavior. Add canary targeting helpers here rather than spreading metadata parsing into the application layer.
- `apps/worker/src/feature-flags/feature-flag.repository.ts` already supports tenant/global flag rows and stable percentage rollout. Reuse or mirror its deterministic hashing behavior carefully; tenant rows must override global rows for canary targeting.
- `packages/database/src/schema/feature-flags.ts` already has `enabled`, `rolloutPercentage`, `tenantId`, and `metadata`; this should be enough for Story 6.2.
- `apps/api/src/admin/feature-flags.controller.ts` already upserts feature flag metadata and rollout percentage. Do not add dashboard/admin UI in this story.

### Recommended Implementation Shape

Prefer a compatibility-preserving extension:

```ts
export interface FeatureFlagContext {
  tenantId: string;
  userId?: string;
  externalWorkspaceId?: string;
}

export interface RuntimeControlFlagPort {
  isEnabled(key: RuntimeControlFlagKey, context: FeatureFlagContext): Promise<boolean>;
  isUserDenylisted(context: FeatureFlagContext): Promise<boolean>;
}
```

Keep `AgentRuntimeModeResolver` public shape stable if possible. If a new runtime-control method is needed, make it optional only if that avoids breaking existing tests and consumers; otherwise update mocks deliberately.

Suggested canary metadata keys:

- Internal users: `internalUserIds`, `canaryUserIds`, `userIds`.
- Workspaces: `externalWorkspaceIds`, `workspaceIds`, `canaryWorkspaceIds`.
- Percentage: existing `rolloutPercentage`.

Suggested semantics:

1. A canary row must be `enabled: true`.
2. Tenant-specific row overrides the global row. A disabled tenant row disables that tenant even if a global canary row is enabled.
3. If allowlist metadata is present, the request must match at least one configured internal user or workspace.
4. If no allowlist metadata is present, `rolloutPercentage` controls the cohort.
5. `rolloutPercentage <= 0` disables canary, `>= 100` enables all otherwise-eligible requests, and `1..99` uses a deterministic stable bucket.
6. Malformed allowlist metadata fails closed for that row; it must not be treated as "no allowlist, use 100%".
7. Missing `userId` cannot match user allowlists or percentage cohorts; missing `externalWorkspaceId` cannot match workspace allowlists.

### Previous Story Intelligence

- Story 6.1 added `buildCanaryGateDecision` as a pure worker helper and hardened canary readiness against malformed metrics, stale diagnostics, invalid baseline gate summaries, token-like reason codes, and sensitive memory false positives.
- Story 6.1 intentionally did not wire gate evaluation into runtime routing and did not enable staged rollout controls. Story 6.2 owns rollout targeting, not gate persistence or UI.
- Story 5.5 opened only `maf_shadow` candidate execution and explicitly kept `maf_canary` TypeScript-only. Preserve that until safety/privacy/consent checks and rollback rules are implemented and reviewed.
- Epic 5 retro action E5-A2 remains open: MAF candidate execution must remain shadow-only until canary gates, staged rollout controls, privacy/consent checks, and rollback rules are implemented and verified.

### Out Of Scope

- User-facing MAF replies or MAF candidate execution for `maf_canary`.
- Python-owned writes, command tools, action execution, memory/goal/follow-up writes, ledger commits, Slack sends, or TypeScript side-effect validation changes.
- Dashboard/admin UI or new admin screens.
- Deployment mutation, Railway service changes, Docker changes, or readiness/deployment evidence changes.
- Rollback runbook and ownership-transfer documentation; Story 6.4 owns that.
- Safety/privacy/consent regression gate expansion; Story 6.3 owns that.
- New model provider calls, LLM-as-judge calls, or live simulation runs.

### Testing Requirements

- Tests must be local and deterministic with mocked repositories or pure helper inputs.
- Prefer pure helper tests for canary metadata parsing and bucket decisions.
- Application tests should keep resolver precedence explicit and should verify router fail-closed behavior on evaluation failures.
- Worker tests should cover tenant/global precedence, disabled tenant override, internal-user allowlist, workspace allowlist, percentage match/non-match, malformed metadata, missing identifiers, and kill switch behavior.
- Scope tests should assert that Story 6.2 does not add dashboard UI, deployment mutation, Python command tools, Python writes, or canary MAF execution.
- Run upstream package builds/tests sequentially if a command cleans shared `dist` output.

### References

- `_bmad-output/planning-artifacts/epics.md` - Epic 6 Story 6.2 requirements.
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md` - AD-9, AD-10, AD-13, AD-18, AD-19.
- `_bmad-output/implementation-artifacts/6-1-add-canary-gate-evaluation.md` - canary gate decision and review hardening.
- `_bmad-output/implementation-artifacts/5-5-integrate-maf-candidate-into-shadow-mode.md` - shadow-only candidate execution and canary non-execution guardrails.
- `_bmad-output/implementation-artifacts/epic-5-retro-2026-08-06.md` - Epic 6 preparation items and open action E5-A2.
- `packages/application/src/ports/feature-flag.port.ts` - feature flag context and runtime flag constants.
- `packages/application/src/use-cases/agent-runtime-mode-resolver.ts` - runtime mode precedence.
- `packages/application/src/use-cases/agent-runtime-mode-resolver.test.ts` - resolver tests.
- `packages/application/src/use-cases/agent-runtime-router.ts` - canary must remain non-user-facing.
- `packages/application/src/use-cases/agent-runtime-router.test.ts` - canary non-execution guardrail.
- `apps/worker/src/feature-flags/runtime-control-flag.repository.ts` - runtime-specific flag helpers.
- `apps/worker/src/feature-flags/runtime-control-flag.repository.test.ts` - runtime-control helper tests.
- `apps/worker/src/feature-flags/feature-flag.repository.ts` - existing feature flag percentage semantics.
- `packages/database/src/schema/feature-flags.ts` - existing flag row shape.
- `docs/maf-runtime-client.md` - MAF runtime and canary documentation.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story created after Story 6.1 BMAD code review was completed and marked done.
- Loaded BMAD create-story/dev-story workflows, BMM config, sprint status, Epic 6 Story 6.2 requirements, architecture spine, Story 6.1, Story 5.5, Epic 5 retrospective, runtime mode resolver, runtime router, feature flag ports/repositories, feature flag schema, and current tests.
- No `project-context.md` or UX artifact was found; this story is backend/runtime rollout-control work.
- CodeGraph index was used for current source inspection.
- 2026-08-06: Started dev-story implementation; status moved to in-progress.
- 2026-08-06: RED focused tests failed for missing workspace context and missing canary rollout helper.
- 2026-08-06: GREEN implementation added staged canary targeting to runtime-control repository and propagated workspace context through runtime mode resolver.
- 2026-08-06: Verification completed; story moved to review.
- 2026-08-07: BMAD code review found percentage/allowlist/duplicate-row fail-open edges; patches applied and verified.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Story 6.2 is intentionally limited to staged rollout targeting. It does not enable user-facing MAF replies or MAF candidate execution for `maf_canary`.
- Extended `FeatureFlagContext` with optional `externalWorkspaceId` and propagated it from `ProcessMessageRequest`.
- Added canary rollout evaluation over existing `feature_flags` rows, supporting internal-user allowlists, workspace allowlists, deterministic percentage buckets, tenant-specific override, and fail-closed malformed metadata.
- Preserved global kill switch and user denylist precedence over canary targeting.
- Documented canary rollout metadata and rollback controls in `docs/maf-runtime-client.md`.
- Review fixes require a stable `userId` for percentage cohorts including 100%, reject blank allowlist IDs, and fail closed on duplicate tenant/global canary rows.

### File List

- `_bmad-output/implementation-artifacts/6-2-add-staged-rollout-controls.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `docs/maf-runtime-client.md`
- `packages/application/src/ports/feature-flag.port.ts`
- `packages/application/src/use-cases/agent-runtime-mode-resolver.ts`
- `packages/application/src/use-cases/agent-runtime-mode-resolver.test.ts`
- `apps/worker/src/feature-flags/runtime-control-flag.repository.ts`
- `apps/worker/src/feature-flags/runtime-control-flag.repository.test.ts`

### Verification

- Story context created and checked against BMAD create-story quality expectations.
- `pnpm --filter @entalent/application test -- src/use-cases/agent-runtime-mode-resolver.test.ts src/use-cases/agent-runtime-router.test.ts` - passed (45 tests, existing Vite CJS deprecation warning).
- `pnpm --filter @entalent/worker test -- src/feature-flags/runtime-control-flag.repository.test.ts` - passed (17 tests).
- `pnpm --filter @entalent/application build` - passed.
- `pnpm --filter @entalent/application typecheck` - passed.
- `pnpm --filter @entalent/application lint` - passed.
- `pnpm --filter @entalent/worker typecheck` - passed after rebuilding `@entalent/application`.
- `pnpm --filter @entalent/worker lint` - passed with existing `apps/worker/src/main.ts:27` no-console warning.
- `pnpm --filter @entalent/application test` - passed (217 tests, existing Vite CJS deprecation warning).
- `pnpm --filter @entalent/worker test` - passed (107 tests, transient MaxListenersExceededWarning from existing test process listeners).
- `git diff --check` - passed.
- `ruby -e "require 'yaml'; YAML.load_file('_bmad-output/implementation-artifacts/sprint-status.yaml'); puts 'yaml ok'"` - passed.
- `codegraph status` - passed; index is up to date.

### Change Log

- 2026-08-06: Created Story 6.2 as ready for development.
- 2026-08-06: Started Story 6.2 implementation.
- 2026-08-06: Implemented staged rollout controls and moved story to review.
- 2026-08-07: Applied BMAD code review fixes, re-ran verification, and moved story to done.

---
baseline_commit: b5eed099a56c92643d77d20d31937a5aa5eaf910
---

# Story 10.7: Add Profile Hydration MAF-Primary Regression

Status: done
Epic: 10 - MAF-First Feature Regression Framework
Story ID: 10.7

## Story

As a product engineering owner,
I want profile hydration to have explicit MAF-primary regression coverage,
so that Slack display name and timezone data affect MAF/proactive behavior without making profile lookup failures block replies.

## Acceptance Criteria

1. Given a profile has a hydrated timezone, then MAF-primary follow-up side effects use that timezone.
2. Given profile data is fresh, then MAF primary does not enqueue another profile hydration job.
3. Given profile data is missing or stale, then MAF primary enqueues profile hydration through the existing outbox.
4. Given profile hydration enqueue fails, then the MAF primary reply still commits and sends.
5. Given Slack profile hydration succeeds, then display name and timezone persistence remains covered by the existing hydration use-case tests.
6. Given proactive eligibility is checked, then quiet hours continue to use the candidate timezone.
7. Given this story adds product-level confidence, then it reuses existing Vitest coverage and does not create a new regression framework.

## Tasks / Subtasks

- [x] Identify the smallest existing test home for profile hydration MAF-primary coverage. (AC: 1-7)
  - [x] Use `packages/application/src/use-cases/maf-primary-agent-runtime.test.ts`.
  - [x] Reuse `packages/application/src/use-cases/profile-hydration.use-case.test.ts` for Slack profile persistence.
  - [x] Reuse `packages/application/src/use-cases/proactive-scheduler.test.ts` for timezone quiet-hours behavior.
  - [x] Do not create a new runner, framework, fixture package, sim, or eval.
- [x] Prove hydrated timezone reaches MAF-primary side effects. (AC: 1, 2)
  - [x] Make the regression searchable with `Profile hydration` and `maf_primary`.
  - [x] Assert a fresh hydrated profile does not enqueue profile hydration.
  - [x] Assert follow-up scheduling uses hydrated timezone.
- [x] Prove profile hydration lookup failure is non-fatal. (AC: 3, 4)
  - [x] Simulate missing timezone.
  - [x] Simulate profile hydration enqueue failure.
  - [x] Assert MAF reply persistence/send still proceeds.
- [x] Preserve existing deterministic coverage. (AC: 5, 6)
  - [x] Keep Slack profile persistence in the existing hydration use-case tests.
  - [x] Keep quiet-hours timezone behavior in the existing proactive scheduler tests.
- [x] Run the smallest matching verification gate. (AC: 1-7)
  - [x] Run targeted MAF primary application test.
  - [x] Run targeted profile hydration use-case test.
  - [x] Run targeted proactive scheduler test.
  - [x] Run `pnpm typecheck`.

## Dev Notes

- This story implements the seventh row of the MAF-first feature regression matrix: Profile hydration. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/feature-regression-matrix.md#Feature-Regression-Matrix]
- Product-level regressions must use MAF primary; legacy `ConversationOrchestrator` coverage is fallback or rollback only. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md#Constraints]
- `MafPrimaryAgentRuntime.enqueueProfileHydrationIfNeeded` enqueues profile hydration when display name/timezone are missing or timezone is stale, and catches enqueue failures so replies are not blocked. [Source: packages/application/src/use-cases/maf-primary-agent-runtime.ts]
- `ProfileHydrationUseCase` persists Slack display name and timezone through the existing user profile repository port. [Source: packages/application/src/use-cases/profile-hydration.use-case.ts]
- `ProactiveSchedulerUseCase` applies quiet-hours using each candidate timezone before enqueueing check-ins. [Source: packages/application/src/use-cases/proactive-scheduler.use-case.ts]

## Out Of Scope

- New Slack profile adapter behavior.
- New quiet-hours algorithm.
- Dashboard/admin hydration UI changes.
- New regression framework, sim, or eval.
- Legacy `ConversationOrchestrator` expansion.

## References

- [SPEC: MAF-First Feature Regression Framework](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md)
- [Feature Regression Matrix](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/feature-regression-matrix.md)
- [Story 10.6: Add Style Adaptation MAF-Primary Regression](/Users/serzh/Documents/enTalentNew/_bmad-output/implementation-artifacts/10-6-add-style-adaptation-maf-primary-regression.md)

## Dev Agent Record

### Agent Model Used

Codex GPT-5

### Debug Log References

- 2026-08-15: `pnpm --filter @entalent/application test -- maf-primary-agent-runtime.test.ts` passed.
- 2026-08-15: `pnpm --filter @entalent/application test -- profile-hydration.use-case.test.ts` passed.
- 2026-08-15: `pnpm --filter @entalent/application test -- proactive-scheduler.test.ts` passed.
- 2026-08-15: `pnpm typecheck` passed.

### Completion Notes List

- Added a searchable `Profile hydration maf_primary` regression around `MafPrimaryAgentRuntime`.
- Proved fresh hydrated timezone is used for follow-up scheduling and does not trigger redundant hydration.
- Proved profile hydration enqueue failure is non-fatal after MAF primary reply generation.

### File List

- `packages/application/src/use-cases/maf-primary-agent-runtime.test.ts`
- `_bmad-output/implementation-artifacts/10-7-add-profile-hydration-maf-primary-regression.md`

## Change Log

- 2026-08-15: Created, implemented, verified, and marked Profile hydration MAF-primary regression story done.

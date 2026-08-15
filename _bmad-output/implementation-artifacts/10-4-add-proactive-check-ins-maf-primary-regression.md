---
baseline_commit: b5eed099a56c92643d77d20d31937a5aa5eaf910
---

# Story 10.4: Add Proactive Check-Ins MAF-Primary Regression

Status: done
Epic: 10 - MAF-First Feature Regression Framework
Story ID: 10.4

## Story

As a product engineering owner,
I want proactive check-ins to have explicit MAF-primary regression coverage,
so that cadence-based mentor outreach keeps using MAF with bounded probe metadata and safe rollback behavior.

## Acceptance Criteria

1. Given a proactive check-in job is eligible for MAF primary, then the worker calls the injected MAF runtime with `requestPurpose='proactive_check_in'`.
2. Given Conversational Survey is enabled and a pulse probe is selected, then the worker passes the selected probe through `proactiveContext.probeQuestion`.
3. Given MAF confirms the selected probe was used, then `recordProbeSent` is called with the selected window/question IDs.
4. Given no probe is selected or probe lookup fails, then the MAF proactive request still runs without probe metadata and does not record a sent probe.
5. Given MAF primary is disabled or the user is denied, then the legacy proactive path remains fallback/rollback behavior only.
6. Given MAF primary fails before commit for proactive requests, then the runtime router fails closed and does not fall back to TypeScript-generated proactive messaging.
7. Given this story adds product-level confidence, then it reuses existing Vitest coverage and does not create a new regression framework.

## Tasks / Subtasks

- [x] Identify the smallest existing test home for proactive MAF-primary coverage. (AC: 1-7)
  - [x] Use `apps/worker/src/conversation/conversation.processor.test.ts` for worker request construction and probe recording.
  - [x] Use existing `packages/application/src/use-cases/agent-runtime-router.test.ts` for proactive fail-closed runtime routing.
  - [x] Do not create a new runner, framework, fixture package, sim, or eval.
- [x] Make product-level coverage searchable. (AC: 1-3, 7)
  - [x] Rename the existing worker regression to include `Proactive check-ins` and `maf_primary`.
- [x] Preserve existing deterministic checks. (AC: 1-6)
  - [x] MAF proactive request includes selected probe metadata.
  - [x] Probe sent is recorded only when MAF confirms the selected probe.
  - [x] Probe lookup failure continues without probe metadata.
  - [x] MAF disabled keeps the legacy proactive path.
  - [x] Proactive MAF primary router failures fail closed.
- [x] Run the smallest matching verification gate. (AC: 1-7)
  - [x] Run targeted worker conversation processor test.
  - [x] Run `pnpm typecheck`.

## Dev Notes

- This story implements the fourth row of the MAF-first feature regression matrix: Proactive check-ins. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/feature-regression-matrix.md#Feature-Regression-Matrix]
- Product-level regressions must use MAF primary; legacy `ConversationOrchestrator` coverage is fallback or rollback only. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md#Constraints]
- `ConversationProcessor.processMafCheckIn` builds `requestPurpose='proactive_check_in'`, persists a synthetic hidden inbound request, passes `proactiveContext.probeQuestion`, and records probe sent only when MAF confirms the selected probe. [Source: apps/worker/src/conversation/conversation.processor.ts]
- `AgentRuntimeRouter` already fails proactive MAF-primary requests closed on primary failure or mode-evaluation failure. [Source: packages/application/src/use-cases/agent-runtime-router.test.ts]
- Existing proactive use-case tests remain legacy/fallback coverage; this story does not expand them. [Source: packages/application/src/use-cases/proactive-check-in.use-case.test.ts]

## Out Of Scope

- New test framework, dependency, regression runner, sim, or eval.
- New proactive scheduling or quiet-hours logic.
- New pulse backlog algorithm.
- Production smoke changes.

## References

- [SPEC: MAF-First Feature Regression Framework](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md)
- [Feature Regression Matrix](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/feature-regression-matrix.md)
- [Story 10.3: Add Conversational Pulse MAF-Primary Regression](/Users/serzh/Documents/enTalentNew/_bmad-output/implementation-artifacts/10-3-add-conversational-pulse-maf-primary-regression.md)

## Dev Agent Record

### Agent Model Used

Codex GPT-5

### Debug Log References

- 2026-08-15: `pnpm --filter @entalent/worker test -- conversation.processor.test.ts` passed.
- 2026-08-15: `pnpm typecheck` passed.

### Completion Notes List

- Reused existing proactive MAF-primary worker coverage and made it searchable by matrix row.
- Reused existing runtime-router fail-closed proactive coverage.
- Product code was already correct for this row; only test naming and story tracking were added.

### File List

- `apps/worker/src/conversation/conversation.processor.test.ts`
- `_bmad-output/implementation-artifacts/10-4-add-proactive-check-ins-maf-primary-regression.md`

## Change Log

- 2026-08-15: Created, verified, and marked proactive check-ins MAF-primary regression story done.

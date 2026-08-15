---
baseline_commit: b5eed099a56c92643d77d20d31937a5aa5eaf910
---

# Story 10.11: Add GDPR Privacy MAF-Primary Regression

Status: done
Epic: 10 - MAF-First Feature Regression Framework
Story ID: 10.11

## Story

As a privacy owner,
I want GDPR export/delete behavior to have explicit MAF-primary regression coverage,
so that deleted user data cannot re-enter MAF runtime context.

## Acceptance Criteria

1. Given a user exports data, then the export response uses an explicit allowlist for user, message, memory, goal, and scheduled action fields.
2. Given a user requests deletion, then messages are anonymized, memory/goals are marked deleted or cancelled, scheduled actions are cancelled, active risks are resolved, and the user is soft-deleted with personal profile fields cleared.
3. Given deleted or inactive data exists after deletion, then internal MAF context returns no stale memory, turns, goals, survey, or risk state.
4. Given privacy actions run, then export/deletion access is audited.
5. Given this story adds product-level confidence, then it reuses existing API/service tests and does not create a new regression framework.

## Tasks / Subtasks

- [x] Identify the smallest existing test homes for GDPR privacy coverage. (AC: 1-5)
  - [x] Use `apps/api/src/users/user-data.controller.test.ts` for export/delete behavior.
  - [x] Reuse `apps/api/src/internal-maf-context/internal-maf-context.service.test.ts` for MAF context barrier coverage.
  - [x] Do not create a new runner, framework, fixture package, sim, or eval.
- [x] Prove export/delete privacy behavior. (AC: 1-2, 4)
  - [x] Assert export returns only the intended top-level data groups.
  - [x] Assert export writes an audit event.
  - [x] Assert deletion anonymizes messages.
  - [x] Assert deletion deletes memory, cancels actions, resolves risks, and soft-deletes the user.
  - [x] Assert deletion writes an audit event.
- [x] Prove deleted data does not re-enter MAF context. (AC: 3)
  - [x] Assert empty post-deletion context contains no memory, goals, turns, survey, or risk state.
  - [x] Assert diagnostics counts remain zero.
- [x] Run the smallest matching verification gate. (AC: 1-5)
  - [x] Run targeted API user-data and internal MAF context tests.
  - [x] Run `pnpm typecheck`.

## Dev Notes

- This story implements the eleventh row of the MAF-first feature regression matrix: GDPR / privacy. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/feature-regression-matrix.md#Feature-Regression-Matrix]
- Product-level regressions must use MAF primary; legacy `ConversationOrchestrator` coverage is fallback or rollback only. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md#Constraints]
- GDPR export/delete behavior lives in `UserDataController`; deletion anonymizes messages, deletes memory, cancels goals/actions, resolves risks, and clears personal profile fields on soft-deleted users. [Source: apps/api/src/users/user-data.controller.ts]
- MAF runtime context is read through `InternalMafContextService`; it already filters deleted users/messages and active-only memory/goals/risk/survey state. [Source: apps/api/src/internal-maf-context/internal-maf-context.service.ts]

## Out Of Scope

- New privacy UI.
- Permanent hard-delete jobs.
- New export file format.
- New MAF context tool implementation.
- New regression framework, sim, or eval.
- Legacy `ConversationOrchestrator` expansion.

## References

- [SPEC: MAF-First Feature Regression Framework](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md)
- [Feature Regression Matrix](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/feature-regression-matrix.md)
- [Story 10.10: Add Admin Console MAF-Primary Regression](/Users/serzh/Documents/enTalentNew/_bmad-output/implementation-artifacts/10-10-add-admin-console-maf-primary-regression.md)

## Dev Agent Record

### Agent Model Used

Codex GPT-5

### Debug Log References

- `pnpm --filter @entalent/api test -- user-data.controller.test.ts internal-maf-context.service.test.ts`
- `pnpm typecheck`

### Completion Notes List

- Added GDPR export/delete controller coverage using existing API/Vitest patterns.
- Verified export/deletion audit events and deletion updates for messages, memory, goals, scheduled actions, risk signals, and users.
- Added internal MAF context regression proving deleted/expired data filters leave no stale memory, goals, turns, survey, or risk context.
- Verified targeted API coverage and workspace typecheck.

### File List

- `apps/api/src/internal-maf-context/internal-maf-context.service.ts`
- `apps/api/src/internal-maf-context/internal-maf-context.service.test.ts`
- `apps/api/src/users/user-data.controller.ts`
- `apps/api/src/users/user-data.controller.test.ts`
- `_bmad-output/implementation-artifacts/10-11-add-gdpr-privacy-maf-primary-regression.md`

## Change Log

- 2026-08-15: Created GDPR privacy MAF-primary regression story.
- 2026-08-15: Implemented and verified GDPR privacy MAF-primary regression story.

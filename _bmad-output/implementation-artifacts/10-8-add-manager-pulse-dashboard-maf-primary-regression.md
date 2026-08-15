---
baseline_commit: b5eed099a56c92643d77d20d31937a5aa5eaf910
---

# Story 10.8: Add Manager Pulse Dashboard MAF-Primary Regression

Status: done
Epic: 10 - MAF-First Feature Regression Framework
Story ID: 10.8

## Story

As a product engineering owner,
I want the Manager Pulse dashboard read model to have explicit MAF-primary regression coverage,
so that MAF-created survey state appears for managers without leaking raw employee text, memory, or risk reasoning.

## Acceptance Criteria

1. Given MAF-created survey assessments exist, then the admin pulse overview exposes question assessment status in the dashboard contract.
2. Given MAF-created survey group state exists, then the admin pulse overview exposes group status, score, and confirmation timestamp.
3. Given only pulse backlog state exists for an employee, then that employee still appears in the pulse overview so managers can see pending pulse work.
4. Given the read model includes survey evidence/group source rows, then raw evidence summaries, AI summaries, memory, and risk reasoning are not returned.
5. Given this story adds product-level confidence, then it reuses existing API/controller and contract tests and does not create a new regression framework.

## Tasks / Subtasks

- [x] Identify the smallest existing test home for Manager Pulse dashboard coverage. (AC: 1-5)
  - [x] Use `apps/api/src/admin/pulse-overview.controller.test.ts`.
  - [x] Reuse `packages/contracts/src/admin-pulse-overview.test.ts` for response contract stability.
  - [x] Do not create a new runner, framework, fixture package, sim, or eval.
- [x] Prove MAF-created pulse state reaches the read model. (AC: 1-3)
  - [x] Assert assessment status is exposed.
  - [x] Assert group status, score, and confirmation timestamp are exposed.
  - [x] Assert backlog-only employees are included.
- [x] Prove privacy-safe dashboard shape. (AC: 4)
  - [x] Assert raw evidence summary is not serialized.
  - [x] Assert private group AI summary is not serialized.
- [x] Run the smallest matching verification gate. (AC: 1-5)
  - [x] Run targeted API pulse overview test.
  - [x] Run targeted admin pulse overview contract test.
  - [x] Run `pnpm typecheck`.

## Dev Notes

- This story implements the eighth row of the MAF-first feature regression matrix: Manager Pulse dashboard. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/feature-regression-matrix.md#Feature-Regression-Matrix]
- Product-level regressions must use MAF primary; legacy `ConversationOrchestrator` coverage is fallback or rollback only. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md#Constraints]
- `PulseOverviewController` is the API read model consumed by the Next dashboard `fetchAdminPulseOverview`. [Source: apps/api/src/admin/pulse-overview.controller.ts; apps/dashboard/src/app/lib.ts]
- The dashboard contract intentionally exposes statuses, scores, questions, and backlog summary only; raw evidence, memory, and risk reasoning remain out of the response. [Source: packages/contracts/src/admin-pulse-overview.ts]

## Out Of Scope

- New dashboard UI.
- New survey scoring or evidence extraction logic.
- Cohort aggregation redesign.
- New regression framework, sim, or eval.
- Legacy `ConversationOrchestrator` expansion.

## References

- [SPEC: MAF-First Feature Regression Framework](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md)
- [Feature Regression Matrix](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/feature-regression-matrix.md)
- [Story 10.7: Add Profile Hydration MAF-Primary Regression](/Users/serzh/Documents/enTalentNew/_bmad-output/implementation-artifacts/10-7-add-profile-hydration-maf-primary-regression.md)

## Dev Agent Record

### Agent Model Used

Codex GPT-5

### Debug Log References

- `pnpm --filter @entalent/api test -- pulse-overview.controller.test.ts`
- `pnpm --filter @entalent/contracts test -- admin-pulse-overview.test.ts`
- `pnpm typecheck`

### Completion Notes List

- Added a searchable `Manager Pulse dashboard maf_primary` API read-model regression around `PulseOverviewController`.
- Included backlog-only employees in the pulse overview so pending MAF-created pulse work is visible.
- Proved raw survey evidence/group summaries are not returned in the manager pulse response.
- Provenance is covered at the MAF producer layer; this story covers the dashboard read model for those source rows.
- Verified targeted API coverage, admin pulse contract stability, and workspace typecheck.

### File List

- `apps/api/src/admin/pulse-overview.controller.ts`
- `apps/api/src/admin/pulse-overview.controller.test.ts`
- `_bmad-output/implementation-artifacts/10-8-add-manager-pulse-dashboard-maf-primary-regression.md`

## Change Log

- 2026-08-15: Created and implemented Manager Pulse dashboard MAF-primary regression story.
- 2026-08-15: Verified targeted API/contract gates and typecheck, then marked story done.

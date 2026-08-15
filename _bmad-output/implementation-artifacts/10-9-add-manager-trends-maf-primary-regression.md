---
baseline_commit: b5eed099a56c92643d77d20d31937a5aa5eaf910
---

# Story 10.9: Add Manager Trends MAF-Primary Regression

Status: done
Epic: 10 - MAF-First Feature Regression Framework
Story ID: 10.9

## Story

As a product engineering owner,
I want Manager Trends to have explicit MAF-primary regression coverage,
so that MAF-created messages and survey evidence continue to feed aggregate manager charts.

## Acceptance Criteria

1. Given MAF-created inbound messages exist, then Manager Trends exposes continuous daily engagement buckets.
2. Given MAF-created survey evidence exists, then Manager Trends exposes daily polarity counts and totals.
3. Given MAF-created survey assessments exist, then Manager Trends exposes the coverage funnel.
4. Given MAF-created question evidence exists, then Manager Trends exposes per-question sentiment with net score ordering.
5. Given tenant and days inputs are supplied, then Manager Trends preserves tenant validation and day bounds through existing input handling.
6. Given this story adds product-level confidence, then it reuses existing API/read-model and contract tests and does not create a new regression framework.

## Tasks / Subtasks

- [x] Identify the smallest existing test home for Manager Trends coverage. (AC: 1-6)
  - [x] Use `apps/api/src/admin/manager-dashboard.read-model.test.ts`.
  - [x] Reuse `packages/contracts/src/admin-manager-trends.test.ts` for response contract stability.
  - [x] Do not create a new runner, framework, fixture package, sim, or eval.
- [x] Prove MAF-created trend source rows reach the read model. (AC: 1-4)
  - [x] Assert engagement daily buckets are filled.
  - [x] Assert signal capture polarity counts are aggregated.
  - [x] Assert coverage funnel statuses are exposed.
  - [x] Assert question sentiment totals and net ordering are exposed.
- [x] Preserve existing input boundaries. (AC: 5)
  - [x] Keep existing tenant validation coverage.
  - [x] Keep existing day defaulting/clamping coverage.
- [x] Run the smallest matching verification gate. (AC: 1-6)
  - [x] Run targeted API manager dashboard read-model test.
  - [x] Run targeted admin manager trends contract test.
  - [x] Run `pnpm typecheck`.

## Dev Notes

- This story implements the ninth row of the MAF-first feature regression matrix: Manager Trends. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/feature-regression-matrix.md#Feature-Regression-Matrix]
- Product-level regressions must use MAF primary; legacy `ConversationOrchestrator` coverage is fallback or rollback only. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md#Constraints]
- `ManagerDashboardReadModel.getTrends` queries message, survey evidence, assessment funnel, and question sentiment rows before passing them to `buildTrends`. [Source: apps/api/src/admin/manager-dashboard.read-model.ts]
- `buildTrends` fills continuous date buckets, aggregates polarity counts, completes the coverage funnel, and sorts per-question sentiment by net score. [Source: apps/api/src/admin/manager-trends.aggregate.ts]
- The dashboard contract is `AdminManagerTrendsResponse`; keep raw text, memory, and evidence summaries out of the response shape. [Source: packages/contracts/src/admin-manager-trends.ts]

## Out Of Scope

- New dashboard UI.
- New charting implementation.
- New survey scoring or evidence extraction logic.
- Cohort aggregation redesign.
- New regression framework, sim, or eval.
- Legacy `ConversationOrchestrator` expansion.

## References

- [SPEC: MAF-First Feature Regression Framework](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md)
- [Feature Regression Matrix](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/feature-regression-matrix.md)
- [Story 10.8: Add Manager Pulse Dashboard MAF-Primary Regression](/Users/serzh/Documents/enTalentNew/_bmad-output/implementation-artifacts/10-8-add-manager-pulse-dashboard-maf-primary-regression.md)

## Dev Agent Record

### Agent Model Used

Codex GPT-5

### Debug Log References

- `pnpm --filter @entalent/api test -- manager-dashboard.read-model.test.ts`
- `pnpm --filter @entalent/contracts test -- admin-manager-trends.test.ts`
- `pnpm typecheck`

### Completion Notes List

- Added a searchable `Manager Trends maf_primary` read-model regression in the existing manager dashboard read-model test file.
- Proved MAF-produced message/evidence/assessment source rows aggregate into engagement, signal capture, coverage funnel, and question sentiment outputs.
- Provenance is covered at the MAF producer layer; this story covers manager trend aggregation for those source rows.
- Kept existing tenant validation and day bounds coverage in place.
- Verified targeted API coverage, admin manager trends contract stability, and workspace typecheck.

### File List

- `apps/api/src/admin/manager-dashboard.read-model.test.ts`
- `_bmad-output/implementation-artifacts/10-9-add-manager-trends-maf-primary-regression.md`

## Change Log

- 2026-08-15: Created Manager Trends MAF-primary regression story.
- 2026-08-15: Implemented and verified Manager Trends MAF-primary regression story.

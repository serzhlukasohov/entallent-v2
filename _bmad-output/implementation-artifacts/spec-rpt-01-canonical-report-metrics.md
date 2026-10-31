---
title: 'RPT-01: Canonical Pulse report metrics and eligibility'
type: 'feature'
created: '2026-10-22'
status: 'done'
baseline_commit: '237d7075ff08f262ccf3cbe2bf7c36cb390d204e'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/pulse-check-reports/FUNCTIONAL-REQUIREMENTS.md'
  - '{project-root}/_bmad-output/planning-artifacts/pulse-check-reports/IMPLEMENTATION-PLAN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Reports require raw equal-person means and integer Engagement 1–10; legacy Engagement accepts 0–10 decimals and rounds means.

**Approach:** Add a pure arithmetic/eligibility kernel for later input/assembly stories. This foundation does not deliver reports.

## Boundaries & Constraints

**Always:** Three distinct questions per person; integer rubric 0–100 or Engagement 1–10. Preserve raw means; display one decimal; count once. Caller owns frozen scope, provenance, cutoff and permissions. Internal values are not payloads.

**Ask First:** Formula/scale changes; schema, collection, reader, scheduling or delivery implementation; model/Slack egress or production activation.

**Never:** Infer ratings, reuse rounded means as raw answers, zero-fill, average team means, alter pilot/history, or access private content/MAF.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Complete metric | Index 60/80/70; Engagement 6/8/10 | Raw means 70; 8 | No eNPS transform |
| Incomplete | Missing/null/nonfinite/fractional/out-of-range value | No person contribution | Never zero-fill |
| Contradiction | Duplicate person/question; unexpected key; invalid key set | Invalid input, no metric | No winner selection |
| Aggregation | Complete people from unequal teams | Equal-person raw mean | No early rounding |
| Thresholds | Intermediate N=5/6/10; final/team M=4/5 | Required 5/5/8; final/team floor 5 | Distinguish invalid from ineligible |
| Category/direction | 39.999/40/69.999/70; rounded equality; no baseline | Critical/Attention/Attention/Healthy; raw direction; baseline established | Reject invalid metric |

</frozen-after-approval>

## Code Map

- `packages/application/src/use-cases/build-v2-index-report.ts` — raw Index reference; unchanged.
- `packages/application/src/use-cases/select-v2-cohort-report-inputs.use-case.ts` — scoped selector; unchanged.
- `packages/application/src/utils/group-scoring.ts` — rounded legacy Engagement; unchanged.

## Tasks & Acceptance

**Execution:**
- [x] `packages/application/src/use-cases/calculate-pulse-report-metrics.ts` — export `calculatePulseIndexMetric`/`calculatePulseEngagementMetric`: participant ID plus question-key/value records and three expected keys. Return `invalid_input` or `calculated` with raw mean/null and complete count. Incomplete people contribute nothing; duplicates invalidate scope. Empty sets return null. Raw internal metrics remain available below publication floors.
- [x] Same file — `evaluatePulseMetricEligibility`: typed intermediate overall/team require Index; final overall/team require Engagement; final diagnostic requires Index. Intermediate overall requires `max(5, ceil(.8*N))`; others five. Validate integer counts `0 <= M <= N`; caller supplies withdrawal-adjusted N. Return invalid, eligible or insufficient independently of raw calculation.
- [x] Same file — `classifyPulseIndex` (`critical`, `needs_attention`, `healthy`), `comparePulseMetric` (`improving`, `stable`, `declining`, `baseline_established`) and `formatPulseMetric`. Compare raw current with a prevalidated comparable previous-final value or null; RPT-05 owns baseline selection/compatibility.
- [x] `packages/application/src/use-cases/calculate-pulse-report-metrics.test.ts` — matrix, order independence, precision, invalid baselines/mode-kind pairs. Withdrawal-adjusted N=8 requires 7; unchanged N=10 requires 8.
- [x] `packages/application/src/index.ts` — export API; no processor wiring.
- [x] `docs/agent-task-log.md`, `docs/agent-failures.md` — record actual checks/failures, preserving entries.

**Acceptance Criteria:**
- Given teams of five at 60 and 80 plus TLs at 90 and 30, when aggregating authorized overall input, then mean is `820/12`; separate employee-only teams yield 60 and 80.
- Given final/team scope, when five of 100 complete people qualify, then eligibility passes; four fail.
- Given this kernel, when pilot tests run, then gates/snapshots/imports remain unchanged; integration remains outstanding.

## Spec Change Log

## Design Notes

Coverage: FR-009–011, thresholds in FR-014/019/020, direction in FR-013. RPT-02/03/05/06 own authorization, withdrawal, source proof and rendering.

## Verification

- `pnpm --filter './packages/*' build` — fresh-worktree prerequisite.
- `pnpm --filter @entalent/application exec vitest run src/use-cases/calculate-pulse-report-metrics.test.ts` — matrix passes; also run existing builder/selector tests named in Code Map.
- `pnpm --filter @entalent/application typecheck` and `pnpm --filter @entalent/application lint` — pass.
- `pnpm harness:check -- --base 237d7075ff08f262ccf3cbe2bf7c36cb390d204e` — structured receipt; actual results below.

## Results

- Approved for implementation by the user on 2026-10-22. Frozen intent remained unchanged.
- Meaningful RED: 64 assertion failures in 116 collected cases; no package-resolution failure.
- Final focused GREEN: 133/133 (127 new kernel cases, 3 existing builder, 3 selector). Application typecheck, lint, build and built-package exports passed.
- BMad Blind Hunter and Edge Case Hunter independently returned no actionable findings. Final test-only cleanup replaced formatter expectations derived from implementation with literal expected strings; focused tests remained 133/133.
- Harness receipt `runs/harness/receipt-1792668289042-ecf5ec4b.json`: passed active-TypeScript diff/typecheck/lint/test checks. Final documentation/test cleanup receives an additional receipt at handoff. Model evaluation was skipped; this arithmetic-only change performs no model call.
- No existing report builder/selector/processor, pilot snapshot, collection scale, database schema or delivery path changed. RPT-01 alone is complete; the remaining report stories still require specification and acceptance.

## Suggested Review Order

**Entry point**

- Separate Index and Engagement inputs while preserving shared raw arithmetic.
  [calculate-pulse-report-metrics.ts:125](../../packages/application/src/use-cases/calculate-pulse-report-metrics.ts#L125)

**Calculation safety**

- Reject structural ambiguity and exclude incomplete participants without zero filling.
  [calculate-pulse-report-metrics.ts:78](../../packages/application/src/use-cases/calculate-pulse-report-metrics.ts#L78)

**Publication policy**

- Keep metric kinds distinct and apply audience-specific participation floors.
  [calculate-pulse-report-metrics.ts:133](../../packages/application/src/use-cases/calculate-pulse-report-metrics.ts#L133)

**Interpretation**

- Classify and compare raw values; round only the numeric display.
  [calculate-pulse-report-metrics.ts:147](../../packages/application/src/use-cases/calculate-pulse-report-metrics.ts#L147)

**Supporting contracts and tests**

- Expose the library without wiring current report delivery.
  [index.ts:154](../../packages/application/src/index.ts#L154)

- Check unequal team weights, invalid inputs, boundaries and independent display expectations.
  [calculate-pulse-report-metrics.test.ts:1](../../packages/application/src/use-cases/calculate-pulse-report-metrics.test.ts#L1)

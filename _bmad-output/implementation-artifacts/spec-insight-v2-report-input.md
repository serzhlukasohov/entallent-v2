---
title: 'Select frozen-cohort V2 report inputs'
type: 'feature'
created: '2026-10-04'
status: 'complete'
baseline_commit: 'fdd018f98c9a76a9a636f099c2e9116606d72a1a'
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/insight-analysis-v2/REPORTING-DECISION-PACKET.md'
  - 'docs/collected-product-requirements.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The V2 question selector is scoped to one employee, while manager reporting requires a closed set of current, privacy-safe inputs from a frozen team roster. The V1 report reader uses group states and is deliberately quarantined from V2.

**Approach:** Add a V2-only report input reader and pure eligibility gate. It returns closed-provenance question insight IDs and scores for a tenant/cohort/Index, with no manager payload or Slack effect. This is the first implementation slice of the requested V2 report consumer; the report formula and delivery follow after Product decisions.

## Boundaries & Constraints

**Always:** Scope every read to tenant, frozen cohort, definition, period, team, bound V2 policy, and windows owned by roster members. Use only current, confirmed, non-withdrawn permanent insights inside the half-open cycle interval. Reject duplicate or mixed-policy records. Intermediate inputs require three scored questions per contributor and `max(5, ceil(0.8 * frozenRosterSize))` distinct eligible contributors. Final inputs retain partial confirmed questions but expose no employee Index score; manager-visible aggregation still needs at least five distinct contributors. Return only IDs and de-identified content, never private working content or source messages.

**Ask First:** The three-question Index formula, final partial aggregation, calibration threshold, and any production scoring activation or manager Slack send.

**Never:** Route V2 through V1 group states or V1 snapshots; shrink the frozen denominator after opt-out/deletion/transfer; count a person twice; treat absent or `insufficient_evidence` scores as zero; emit a manager report from this slice.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Complete intermediate | Frozen roster, five or more eligible 3/3 contributors | Sorted closed V2 inputs and eligible contributor IDs | No send |
| Partial final | 1/3 or 2/3 confirmed after cutoff | Available finalized questions only, no synthetic Index | No send |
| Unsafe scope | Wrong tenant/window/policy, duplicate/current conflict, withdrawal | No reportable input | Fail closed |
| Below threshold | Fewer than required distinct contributors | Explicit ineligible result | No send |

</frozen-after-approval>

## Code Map

- `packages/application/src/use-cases/select-question-insight-inputs.use-case.ts` -- existing per-person V2 eligibility rules.
- `apps/worker/src/survey/repositories/question-insight.repository.ts` -- existing finalized insight and policy-bound window reads.
- `packages/database/src/schema/survey-insight-v2.ts` -- permanent insights and cycle/window policy bindings.
- `packages/database/src/schema/survey.ts` -- immutable cohort roster and windows.

## Tasks & Acceptance

**Execution:**
- [x] Add a V2-only cohort input reader beside existing worker survey repositories, with explicit tenant/cohort/window/definition/policy joins.
- [x] Add a pure application eligibility gate for intermediate/final selection and invariant validation.
- [x] Add one migrated PostgreSQL integration fixture covering the positive and fail-closed cases.

**Acceptance Criteria:**
- Given five scoped complete employees, when selecting intermediate V2 inputs, then one eligible frozen-cohort input set is returned with each contributor counted once.
- Given a partial employee after cutoff, when selecting final V2 inputs, then only finalized questions appear without an employee Index.
- Given mixed policy, wrong-window, withdrawn, or below-threshold inputs, when selecting report inputs, then no manager-eligible result is returned.

## Spec Change Log

## Verification

**Commands:**
- Application eligibility and report calculation tests: 6/6 passed.
- Migrated PostgreSQL V2 reader and snapshot tests: 1/1 each passed.
- Worker consumer tests: 4/4 passed; disabled send, snapshot before send, target recheck, and ambiguous delivery covered.
- Root `pnpm typecheck` and isolated PostgreSQL/Redis `pnpm harness:check -- --base fdd018f` passed; receipt: `runs/harness/receipt-1791113281513-73a55aa5.json`.

The follow-on numeric report calculation, V2 snapshot/consumer, and enqueue CLI are implemented behind disabled send settings. Their Product formula, calibration, qualitative content, deployment, and live Slack acceptance remain open and are outside this input-slice completion status.

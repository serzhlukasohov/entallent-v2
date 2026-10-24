# Sprint Change Proposal B: Readiness Fixes for the Atomic-Test Case Model

- Date: 2026-10-24
- Author: Illia (Correct Course workflow, second pass)
- Status: Approved by Illia on 2026-10-24 (all recommendations in `implementation-readiness.md` accepted); applied to spine, epics, case-mapping and SPEC
- Trigger: readiness gate FAIL after `sprint-change-proposal-2026-10-24.md` (3 blockers, 7 concerns, 4 nits; see `implementation-readiness.md`)
- Scope classification: Moderate (document changes within Epics 12-14; no code exists)

## 1. Issue Summary

The first proposal made atomic tests the primary unit, but did not record the case-model decisions that follow from it. These gaps were found: where the full criteria list of a source case lives; how invariant state criteria interact with the already-satisfied guard; how mid-flow pulse state is seeded; how recording proxies reach ports the harness builds itself; who authors seeded coach replies; L0 scope for meaning-only criteria; double counting of criteria in journeys. There were also leftovers of the old model and a forward dependency of Story 12.1 on Story 13.4.

## 2. Impact Analysis

- Epics 12-14 keep their scope and order; Stories 12.1, 12.2, 12.3, 12.4, 12.7, 13.4, 13.5, 14.2 change.
- Spine: AD-1, AD-3, AD-4, AD-6, AD-7, AD-9, AD-10, AD-11, AD-14 and the Structural Seed change. AD-12 is unchanged; the harness change is inside `conversation-sim`.
- SPEC: CAP-2 and CAP-12 wording. case-mapping: section 5 rules.

## 3. Recommended Approach

Direct Adjustment. Effort Low-Medium, risk Low.

## 4. Change Proposals (applied)

1. **Source manifest (B1, C10).** `cases/<suite>/sources.ts` exports `SourceCase[] = { id, requirement, kind: 'conversation' | 'observation', expectedBehavior, criteria: SourceCriterion[] }`. `SourceCriterion = { id: '<sourceCase>.C<n>', layer, passCondition (suite text verbatim), notTestableReason?, stateEffect?: { port, method, expected } }`. Test criteria reference a manifest id and add `evaluatedAt`, `checks`, `levels?`, `stateQuery?`, `independentOfCheckpoints?` and `judgeGuidance?`. The loader joins in `layer` and `passCondition`, and rejects ids absent from the manifest. Coverage: every testable criterion of a `conversation` source case is covered by at least one atomic test; an `observation` source case is covered by its observation test.
2. **Change versus invariant (B2).** `stateQuery` gains `kind: 'change' | 'invariant'`. `precondition:already-satisfied` and the `effect-count` pairing apply to `change` only, using the manifest's `stateEffect`.
3. **Mid-flow seeding (B3).** `SeedTurn` gains `metadata?: Record<string, unknown>`. A new fixture `confirmationState` (staged bundle, applied verdicts per question, pending clarification) writes through `questionConfirmationRepo` at L0/L1; it is unsupported at L2.
4. **Injectable harness (C4).** `CoachHarness` accepts injected conversation, memory, goal and style repositories and the outbox, so recording proxies wrap every port. This is a test-package change only.
5. **Seed authorship (C5).** QA approves seeded coach text. A seed must not itself satisfy a criterion of its test. Both are recorded per test in the 12.4 table.
6. **L0 scope (C6).** `no-judge-at-level` is out of scope (excluded from COMPLETE). L0 tests cover time, cadence and rule criteria only, and carry their scripted model outputs in the test record (`scripted`).
7. **Journeys reported separately (C7).** Layer pass rates and the verdict count atomic and observation tests only. Journeys are reported and diffed in their own section and never change the verdict.
8. **State-query ownership (C9).** `StateQueryName` and the per-query schemas live in `suite/schema.ts` (Story 12.1). `fixtures/state-queries.ts` holds the L1/L2 accessors only (Stories 13.4, 14.2).
9. **Leftovers and nits (C8, nits).**
   - Coverage reads CF → source case → test → criterion.
   - `CaseRun.testId` replaces `caseId`, and the L2 user is `suite-<runId>-<testId>`.
   - `results['<testId>/<criterionId>']` in Story 13.5.
   - CAP-1..CAP-12; "atomic or journey test" in the executors.
   - AD-6 lists every rule of Story 12.3.
   - Rule fixtures are synthetic `CaseRun` records.
   - Observation tests are `level-not-declared` at L2.

## 5. Implementation Handoff

Re-run the readiness gate; on PASS, `bmad-build` Story 12.1, which writes its spec and stops for approval before code. No commit or push.

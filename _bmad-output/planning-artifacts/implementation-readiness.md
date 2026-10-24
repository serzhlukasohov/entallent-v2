# Implementation Readiness Findings: Conversation Evaluation Regression Framework

- Date: 2026-10-24
- Gate: `bmad-sprint-planning` (readiness intent), run after `sprint-change-proposal-2026-10-24.md`
- Verdict: **FAIL**
- Method: independent reviewer read SPEC, spine, case-mapping, brownfield and epics; each finding was verified against the documents and `packages/conversation-sim/src/harness/coach-harness.ts`.
- Resolution: all recommendations accepted by Illia on 2026-10-24; applied by `sprint-change-proposal-2026-10-24-b.md`.

## Blockers

| # | Finding | Evidence | Accepted fix |
| --- | --- | --- | --- |
| B1 | The coverage rule rejects the P-06 observation case, and the loader has no source of truth for a source case's full criteria list. | spine AD-1 refinement "every testable criterion of a source case is covered by at least one atomic test"; case-mapping section 5 (P-06 stays observation) | Exempt observation source cases; add a source manifest `cases/<suite>/sources.ts` (requirement, expected behavior, criterion ids, layer, verbatim pass condition, NOT TESTABLE reasons, state effects) that the loader checks tests against. |
| B2 | The vacuous-pass guard makes the P-09 S criterion "summaries count not greater than seen" permanently INVALID, because an invariant always holds before the step; `effect-count` has no recorded expected value. | spine AD-9 `precondition:already-satisfied`; case-mapping P-09 row | `stateQuery.kind: 'change' \| 'invariant'`; already-satisfied applies to `change` only; each change criterion records `stateEffect { port, method, expected }` in the manifest. |
| B3 | P-09 and P-10 later moments cannot be seeded atomically: `SeedTurn` has no metadata and `seededHistory` writes text only, while `bundle-staged` reads message metadata and the steps need staged bundle and confirmation state. | spine AD-1 `SeedTurn`; AD-4 `seededHistory`; epics Story 12.3 `bundle-staged` | `SeedTurn.metadata?`; new fixture `confirmationState` (staged bundle, applied verdicts, pending clarification) at L0/L1. |

## Concerns

| # | Finding | Evidence | Accepted fix |
| --- | --- | --- | --- |
| C4 | Recording proxies cannot wrap ports the harness builds itself; only `aiProvider`, `scheduledActionRepo`, `surveyRepo` and `questionConfirmationRepo` are injectable. | `coach-harness.ts:62-66` | Story 12.7 lets `CoachHarness` accept injected conversation, memory, goal and style repositories and the outbox (test package only). |
| C5 | No author or constraint for seeded coach replies; a seed could satisfy the criterion under test (P-08). | case-mapping section 5 | QA approves seeded coach text; a seed must not itself satisfy a criterion of its test; recorded per test in the 12.4 table. |
| C6 | Meaning-only criteria at L0 make L0 runs INCOMPLETE, so baselines cannot be accepted; L0 rule checks on scripted replies test the script unless the scripted outputs are recorded. | spine AD-7 vs epics Story 12.2 scope rule | `no-judge-at-level` is out of scope; L0 is limited to time, cadence and rule criteria whose scripted model outputs are written in the test record. |
| C7 | A criterion in both an atomic test and a journey would count twice in pass rates and the verdict. | spine AD-2, AD-9 | Verdict and layer pass rates count atomic and observation tests only; journeys are reported and diffed in a separate section. |
| C8 | Leftovers of the old model. | epics:20, 334, 519, 557; spine AD-11 coverage | Mechanical edits. |
| C9 | Story 12.1 depends on state-query schemas built in Story 13.4. | spine AD-3; epics Story 13.4 | Story 12.1 owns `StateQueryName` and the per-query schemas in `schema.ts`; 13.4 adds accessors only. |
| C10 | `expectedBehavior` is used by the judge and by CAP-1 but has no field. | spine AD-7 `JudgeInput`; AD-1 `SuiteCase` | `expectedBehavior` lives on the source case in the manifest. |

## Nits

- Story 14.2: an observation case at L2 is `level-not-declared`, not `unsupported-fixture:proactiveUsers`.
- L2 user and `CaseRun` should name `testId`, not `caseId`.
- AD-6 should list the rules Story 12.3 adds (`no-two-replies-without-cause-question`, `reply-present`, `proactive-initiated`, `state-equals`, `state-not-greater-than`).
- Rule `pass`/`fail` fixtures are synthetic `CaseRun` records, independent of the L0 executor.

## Second gate (after proposal B), 2026-10-24

- Verdict: **CONCERNS**. B1-B3, C4, C5, C9, C10 and the nits are resolved; the C8 leftovers it found (`caseId` in AD-2, "versioned prompt template", the unconditional state rule in case-mapping, the observation exemption in SPEC/FR2) were fixed after the review.
- The old Story 12.1 file still describes the previous model; it is marked superseded and is replaced by the spec `bmad-build` writes.

| # | Concern | Proposed resolution | Owner story |
| --- | --- | --- | --- |
| R1 | Shapes 12.1 must define that no document fixes: `scripted` (plain data, since `ScriptedAiOptions` takes functions), `FixtureRef` params, `RuleCheck`, a single home for NOT TESTABLE, and the dropped refinements (duplicate ids, `criterion.levels ⊆ test.levels`, not-testable exclusive). | Settle in the Story 12.1 spec written by `bmad-build`; NOT TESTABLE lives only in the manifest and the loader emits a manifest-level row. | 12.1 |
| R2 | L0 text rules evaluate reply text the test itself scripted; SPEC/FR9 promise P-02 at L0 though it has no rule criteria; AD-14 filters per test, Story 12.4 per criterion. | L0 only for rules over orchestrator-produced inputs (time, cadence, metadata, state, events), enforced per criterion by a loader refinement; drop P-02 from CAP-5/FR9. | 12.1, 12.4, 12.7 |
| R3 | L2 runs only journeys, which never count, so L2 has no verdict; unclear whether journey regressions fail the diff. | L2 report shows verdict "n/a (journeys only)"; journey rule and S regressions fail `suite:diff`, meaning ones are reported. | 12.2, 12.9, 14.3 |
| R4 | `effect-count` pairing has no owner, `stateEffect` has no step, and at L2 it would become `NOT_RUN unobservable:events`. | `evaluate` synthesizes `effect-count { ...stateEffect, step: evaluated step }` only where `events` is observed. | 12.2 |

- R2-R4 accepted by Illia on 2026-10-24 and applied to SPEC, spine, epics and case-mapping; R1 is settled in the Story 12.1 spec.

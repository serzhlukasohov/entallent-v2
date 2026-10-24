# Sprint Change Proposal: v1 Evaluation Amendments to the Conversation Evaluation Regression Framework

- Date: 2026-10-24
- Author: Illia (Correct Course workflow)
- Status: Approved by Illia on 2026-10-24; applied to SPEC, spine, case-mapping, epics, sprint-status and readiness notice
- Change input: `conversation-eval-regression/v1-amendments-2026-10-24.md`
- Scope classification: Moderate (backlog reorganization within Epics 12-14, no new epics, no implementation to roll back)

## 1. Issue Summary

PR #31 planned the Conversation Evaluation Regression Framework (SPEC CAP-1..CAP-11, spine AD-1..AD-18, Epics 12-14). Before Story 12.1 started, the plan was reviewed against the evaluation harness of the first product version (`enTalent-ai/entalentai`, `apps/orchestrator/src/runtime-v2/eval/`) and its run findings (`docs/testing/`, 2026-09-07..2026-09-13).

The review found failure modes the current plan does not guard against:

- Multi-turn cases localize failures poorly: a different bot reply at step 2 changes what step 4 tests, and a checkpoint failure marks every later criterion INVALID.
- A single-pass judge credited content that existed only in state or context, not in the reply (v1 two-stage protocol 12/12 versus 7-11/12 for alternatives).
- A launcher silently changed judge decoding (temperature 0.8) while calibration still appeared valid.
- Green rows proved nothing when the expected state already held before the evaluated step.
- The plan records inputs and outputs per step but not what happened inside a step (which ports were called, which writes occurred).

Issue type: new requirement from a stakeholder, based on evidence from a prior system. No code exists yet; Story 12.1 is `ready-for-dev` and not started.

## 2. Impact Analysis

### Epic impact

| Epic | Can complete as planned? | Change |
| --- | --- | --- |
| 12 (L0) | Yes, with modified stories | 12.1, 12.2, 12.3, 12.4, 12.7, 12.8, 12.9 amended; 12.5, 12.6, 12.10 unchanged |
| 13 (L1) | Yes, with modified stories | 13.1, 13.2, 13.3, 13.4 amended; 13.5, 13.6, 13.7 unchanged |
| 14 (L2) | Yes, narrower | 14.2 amended (journeys only); 14.1, 14.3 unchanged |

No epic becomes obsolete, no new epic is needed, and the order is unchanged.

### Artifact conflicts

- **SPEC:** CAP-1, CAP-4, CAP-7, Constraints, Open Questions amended; new CAP-12.
- **Architecture spine:** AD-1, AD-2, AD-3, AD-4, AD-6, AD-7, AD-8, AD-9, AD-10, AD-11, AD-13, AD-14, AD-17, AD-18, Consistency Conventions, Structural Seed amended. AD-12 (authorized product changes) unchanged: no development write path is added.
- **case-mapping.md:** atomic decomposition rule added; per-case decomposition produced by Story 12.4.
- **epics.md:** FR1, FR2, FR3, FR7, FR8, FR11, FR21, FR22, NFR6, NFR7 amended; FR23, FR24 added; stories as listed.
- **implementation-readiness-report-2026-10-19.md:** superseded until readiness is re-checked.
- **sprint-status.yaml:** Story 12.1 returns to `backlog` until regenerated.
- **UX:** not applicable. **CI workflows:** unchanged.

### Technical impact

Test-framework code only, inside `packages/conversation-sim`. Product code changes stay limited to AD-12 (ClockPort, cadence policy, additive read-only `/dev` GETs, failure-kind extraction). L1 cost per criterion drops, because atomic tests make one coach call per evaluated moment instead of replaying the whole case.

## 3. Recommended Approach

**Direct Adjustment.** Modify the existing stories within Epics 12-14.

- Effort: Medium (document changes now; implementation scope roughly equal to the original plan, with seeding and event recording added and checkpoint logic narrowed to journeys).
- Risk: Low (no code to roll back).
- Timeline: Story 12.1 regenerated before development starts.
- Rejected alternatives: rollback (nothing to revert); MVP review (first slice L0+L1 on P-01..P-10 unchanged).

## 4. Detailed Change Proposals

### 4.1 SPEC (`specs/spec-conversation-eval-regression/SPEC.md`) — approved

**1a. CAP-1**
- OLD intent: A test case is a structured record mirroring the Confluence case: id, requirement, setup fixtures, exact user messages with waits, and a criteria table with layer, evaluated reply, pass condition and check type.
- NEW intent: The primary executable unit is an atomic test: seeded state and seeded conversation history, exactly one user turn or proactive trigger, and the criteria evaluated on that one reply or that step's effects. Each Confluence P-case is decomposed into atomic tests, one per evaluated moment; a small set of P-cases also runs as verbatim multi-turn smoke journeys mirroring the Confluence case.
- NEW success: Every testable P-01..P-10 criterion is covered by an atomic test; at least two P-cases (including P-09) exist as smoke journeys; loading rejects a test whose expected behavior has no criterion, or a criterion missing layer, evaluatedAt or checkType (framework 3.1 rule).

**1b. CAP-4 success**
- OLD: One structured PASS/FAIL/reason per criterion, judged with the transcript up to that reply; ...
- NEW: One structured PASS/FAIL/reason/evidence per criterion, judged by meaning with the transcript up to that reply; a PASS carries a verbatim fragment of the evaluated reply as evidence, and fixture context is reference, never evidence; ... (remainder unchanged)

**1c. CAP-7 success, add:** L2 runs the smoke journeys only; atomic tests run at L0 and L1, because seeding history at L2 would need a development write path.

**1d. Constraints**
- OLD: Suite texts are sent verbatim through scripted steps; the user simulator is not used for suite cases.
- NEW: Suite texts are sent verbatim through scripted steps (the full sequence in smoke journeys, the single evaluated turn and the seeded history in atomic tests); the user simulator is not used for suite cases.
- OLD: The judge model is pinned per suite version; changing it requires recalibration and a new baseline.
- NEW: The judge is pinned per suite version by fingerprint (provider, model, decoding settings, prompt hash, output schema hash, guidance hash); changing any part requires recalibration and a new baseline. When the judge and a human label disagree, the criterion's judge guidance is clarified; labels are never changed to match judge output.

**1e. New CAP-12 — Step evidence and vacuous-pass guards**
- intent: Every L0/L1 run records what happened inside each step, and a criterion cannot pass on state that already held before the step.
- success: Each run carries an ordered event log (port, method, step, result) for model calls, repository writes and outbox effects; state criteria assert the change caused by the evaluated step; a state criterion already satisfied in the before-snapshot is INVALID; every rule has an L0 fixture on which it must FAIL.

**1f. Open Questions, add:** Does QA accept atomic decomposition plus verbatim smoke journeys as the report that replaces the manual sheet? Which P-cases are the smoke journeys (proposed: P-09, P-10)?

### 4.2 Architecture spine — approved

**2a. AD-1**
- OLD: `SuiteCase = { id, requirement, kind: 'conversation' | 'observation', levels, runProfile, setup, preconditions, steps, observationWindow?, criteria }`; `conversation` cases have ≥ 1 step.
- NEW: `SuiteCase = { id, sourceCase, requirement, kind: 'atomic' | 'journey' | 'observation', levels, runProfile: 'isolated', setup, seed?: { history: SeedTurn[] }, preconditions, steps, observationWindow?, criteria }`; `SeedTurn = { role: 'user' | 'coach', text, atOffsetMs }`. Ids: atomic `P-09.A<n>`, journey `P-09.J`, observation `P-06`. Refinements: `atomic` has exactly one step, a `seed` (history may be empty), no checkpoint, levels ⊆ {L0, L1}; `journey` has ≥ 1 step and may carry rule-only checkpoints; `observation` unchanged; every testable criterion of a source case is covered by at least one atomic test. `Criterion` gains `judgeGuidance?: string` (repo-owned clarification; `passCondition` stays verbatim).

**2b. AD-2**
- OLD: Results, baselines and diffs are keyed by `(suiteId, level, criterionId)`.
- NEW: Criterion ids stay the Confluence ids (`P-09.C3`); results, baselines and diffs are keyed by `(suiteId, level, testId, criterionId)`.

**2c. AD-4, add:** Fixture `seededHistory` writes the seed turns through the level's conversation repository with timestamps from the fixture clock and verifies them by reading back. Supported at L0 and L1 only; L2 never writes history.

**2d. AD-18**
- OLD: Checkpoints are rule-only: executors send every step unless `onFail: 'stop'` ...
- NEW: Checkpoints exist only in `journey` tests and are rule-only: ... (remainder unchanged). In `atomic` tests the gap before the single turn is the difference between the last `SeedTurn.atOffsetMs` and the turn, realized by the clock; `interMessageGapMs` applies between journey steps only.

**3a. AD-3, add:** `CaseRun.events: RunEvent[]`; `RunEvent = { stepIndex (0 = fixtures and seed), seq, port, method, argsSummary, outcome: 'ok' | 'error', resultSummary, durationMs, model?: { name, settings, request, response } }`. L0 and L1 executors wrap every port passed into the harness (AI provider, repositories, outbox, scheduler-facing ports) with a recording proxy; product code is unchanged; `evaluate` stays pure over `CaseRun` including `events`.

**3b. AD-17, add:** `ObservationField` `events`; declared by L0 and L1, not by L2 (deferred until audit coverage by `traceId` is verified).

**3c. AD-6, add:** Rule `effect-count` (params `port`, `method`, `step`, `expected`; requires `events`). Every registry entry ships L0 fixtures `pass` and `fail`; a colocated test fails if a rule does not FAIL on its `fail` fixture.

**3d. AD-10 / AD-9, add:** At L0/L1 a `state` criterion is paired with an `effect-count` check for the evaluated step; at L2 (journeys) it stays snapshot-based with method `observed`. INVALID branch of the AD-9 precedence: a `state` criterion whose pass condition already holds on `state.before` is INVALID reason `precondition:already-satisfied`.

**3e. Consistency Conventions → Logging**
- OLD: no transcript text in CI logs
- NEW: no transcript or event text in CI logs; `events` are written only into the run artifact under `runs/suites/<runId>/`, uploaded with 14-day retention.

**4a. AD-7, add:** Output schema `{ status, reason, evidence }` (nullable). The judge decides by meaning, never by wording. For PASS, `evidence` must be a verbatim fragment of the evaluated reply; `evaluate` checks it is a substring of `reply.text` after whitespace normalization; a missing or non-matching fragment triggers one re-ask, then `ERROR` reason `judge-invalid-output`; FAIL may carry `evidence: null`. `fixtureContext` is reference only and the prompt says so. In atomic tests the transcript is the seeded history plus the single turn. `judgeGuidance`, when present, is passed with the pass condition.

**4b/4c. AD-8**
- OLD: config `judgeModel`, `judgePromptVersion`; `agreement.json { schemaVersion, judgeModel, judgePromptVersion, labelsSha256, ... }`.
- NEW: `JudgeFingerprint = { provider, model, decoding: { temperature, reasoningEffort, maxOutputTokens }, promptSha256, schemaSha256, guidanceSha256 }`. Provider, model and decoding come from `suite.config.json`; the hashes are computed at run time from `judge/prompt.ts`, the output schema and all `judgeGuidance` texts; `judgePromptVersion` is removed. `agreement.json` stores the fingerprint plus `labelsSha256`; any differing field makes `trusted = false` reason `fingerprint-mismatch:<field>`. Every report prints the effective fingerprint. Disagreements are resolved through `judgeGuidance` or a proposal to QA to change the Confluence text; label statuses are never edited after import.

**4d. AD-11 / AD-13**
- OLD: baseline `judge: { model, promptVersion, agreement }`; diff refuses when judge pin, prompt version or coach model differ.
- NEW: baseline `judge: { fingerprint, agreement }`; diff refuses (`baseline-invalid`) when the judge fingerprint or coach model differ.

**AD-14, add:** L2 runs `journey` tests only; `atomic` tests never declare L2 (AD-1 refinement), so they are out of scope there.

**Structural Seed, add:** `src/suite/fixtures/seeded-history.ts`, `src/suite/executors/recording-proxy.ts`, `src/suite/rules/effect-count.ts`; `cases/p-v1/` holds atomic tests and journeys (for example `p-09.a1-summary-asks-confirmation.case.ts`, `p-09.journey.case.ts`).

### 4.3 case-mapping.md — included with this proposal

Add a section "Atomic decomposition": each P-case becomes one atomic test per distinct `evaluatedAt` reply or step, carrying the criteria evaluated there; the seed contains the suite's earlier user messages verbatim and representative coach replies; `conversation`-scoped criteria become an atomic test whose seed holds the preceding turns. P-06 stays an observation test. Proposed journeys: P-09, P-10 (pending QA, SPEC Open Questions). The per-case table is produced by Story 12.4.

### 4.4 epics.md — included with this proposal

**Requirements inventory**
- FR1 NEW: A suite test is a typed record of kind atomic (seed, one turn), journey (verbatim multi-step Confluence case) or observation, carrying source case, requirement, levels, setup fixtures, preconditions, steps, criteria with layer, evaluatedAt, verbatim pass condition, optional judge guidance, and checks. (CAP-1, AD-1)
- FR2 NEW: Loading validates every test and rejects atomic tests with other than one step, without seed, with a checkpoint or declaring L2, and source cases whose testable criteria are not all covered by an atomic test, in addition to the existing refinements. (CAP-1, AD-1)
- FR3 NEW: Criterion ids are the Confluence ids; results, baselines and diffs are keyed by suite, level, test and criterion. (AD-2)
- FR7 ADD: The judge returns evidence; a PASS without a verbatim fragment of the evaluated reply is re-asked once, then ERROR. (AD-7)
- FR8 ADD: Judge trust is bound to a fingerprint of provider, model, decoding, prompt, schema and guidance hashes. (AD-8)
- FR11 ADD: L2 runs journey tests only. (AD-14)
- FR21 NEW: P-01..P-10 exist as atomic tests covering every testable criterion, P-06 as an observation test, and the agreed smoke journeys verbatim. (CAP-1, CAP-10)
- FR22 ADD: Checkpoints exist in journeys only; atomic gaps come from seed offsets. (AD-18)
- FR23 NEW: L0 and L1 runs record an ordered event log per step through recording proxies on harness ports, written only to run artifacts. (CAP-12, AD-3, AD-17)
- FR24 NEW: State criteria are paired with a per-step effect check at L0/L1, are INVALID when already satisfied before the step, and every rule has a fixture on which it must FAIL. (CAP-12, AD-6, AD-9, AD-10)
- NFR6 NEW: Suite user texts are sent verbatim (full sequence in journeys; seeded history and the single turn in atomic tests); the user simulator is not used.
- NFR7 NEW: The judge is pinned by fingerprint; changing any part invalidates agreement and baselines; env overrides cannot silently change the evaluating model or settings.
- FR Coverage Map: FR23, FR24 → Epic 12 (L0) and Epic 13 (L1).

**Stories**
- **12.1 Case Schema, Loader and Rule Registry Contract:** schemas follow amended AD-1 and AD-3 (`kind` atomic/journey/observation, `sourceCase`, `seed`, `SeedTurn`, `judgeGuidance`, `CaseRun.events`, `RunEvent`); loader refinements include the atomic and coverage rules; test ids follow `P-xx.A<n>` / `P-xx.J`; wrapped legacy rules ship `pass` and `fail` fixtures. Returns to `backlog` until regenerated.
- **12.2 Evaluation, Scoring and Report Core:** results keyed by test and criterion; INVALID `precondition:already-satisfied`; checkpoint propagation applies to journeys only; coverage table CF → source case → test → criterion.
- **12.3 Suite Rule Implementations:** add `effect-count`; every rule carries `pass` and `fail` fixtures enforced by a colocated test.
- **12.4 renamed "P-Suite Atomic Tests and Smoke Journeys":** produce the atomic decomposition table in case-mapping.md and the test records; journeys for the agreed cases; P-06 observation unchanged.
- **12.7 L0 Deterministic Executor and Fixtures:** `seededHistory` fixture; recording proxies on all harness ports; `events` declared and filled.
- **12.8 Runner, suite:run and suite:baseline:accept:** baseline stores the judge fingerprint (L0: none).
- **12.9 suite:diff:** keys by test and criterion; `baseline-invalid` on fingerprint mismatch.
- **13.1 Per-Criterion Structured Judge:** evidence check and one re-ask; fixture context as reference; `judgeGuidance` input; tests add PASS-without-evidence and non-matching-evidence cases.
- **13.2 Calibration:** `agreement.json` stores fingerprint and `labelsSha256`; label statuses immutable after import.
- **13.3 Judge Trust:** trust computed against the fingerprint, reason `fingerprint-mismatch:<field>`; report prints the effective fingerprint.
- **13.4 L1 Orchestrator Executor:** `seededHistory` fixture and recording proxies; state criteria paired with `effect-count`.
- **14.2 L2 Application Executor:** runs journeys only; atomic tests are out of scope at L2.
- Unchanged: 12.5, 12.6, 12.10, 13.5, 13.6, 13.7, 14.1, 14.3.

### 4.5 Status artifacts

- `sprint-status.yaml`: `12-1-case-schema-loader-and-rule-registry-contract: backlog` (was `ready-for-dev`); `12-4` key renamed to `12-4-p-suite-atomic-tests-and-smoke-journeys`; comment pointing to this proposal.
- `implementation-readiness-report-2026-10-19.md`: add a superseded notice pointing to this proposal.
- Story file `12-1-case-schema-loader-and-rule-registry-contract.md`: regenerated after approval.

## 5. Implementation Handoff

- **Scope:** Moderate.
- **Document updates (this session, after approval):** SPEC, spine, case-mapping, epics, sprint-status, readiness notice.
- **Story regeneration:** Story 12.1 against the amended AD-1/AD-3.
- **Readiness:** `bmad-sprint-planning` readiness check before development.
- **Development:** `bmad-build` from Story 12.1, then `bmad-code-review`.
- **QA (open):** accept atomic decomposition plus journeys; confirm journey cases.
- **Success criteria:** every amended AD and story is consistent with this proposal; readiness check passes; Story 12.1 is `ready-for-dev` against the amended schema.
- **Out of scope:** commits and pushes (by explicit instruction).

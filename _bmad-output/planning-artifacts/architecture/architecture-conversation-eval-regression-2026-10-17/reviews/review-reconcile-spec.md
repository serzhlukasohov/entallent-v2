# Review — Reconcile Spine with Spec Package

- Spine: `ARCHITECTURE-SPINE.md` (draft, 2026-10-17, AD-1..AD-16)
- Spec package: `SPEC.md` (CAP-1..CAP-11, constraints, non-goals, assumptions, open questions), `case-mapping.md` (sections 1-4), `brownfield.md` (sections 1-4)
- Reviewer: reconcile-spec
- Date: 2026-10-17

## Verdict

The spine covers every capability at the AD level and all four constraint groups that bend design (ADR-013 D2, offline L0/L1, local-only L2, additive report) have a named AD. The gaps are in the data shapes the ADs promise: the `SuiteCase`/`CaseRun` schema in AD-1/AD-3 is too narrow for P-06 (observation window, timezones, scheduler config, per-criterion level), P-09 (checkpoint, start snapshot) and P-07 (judge needs fixture context), and four quiet spec requirements have no landing place (QA review list of meaning FAILs, no user simulator, no Langfuse, hourly override is not the requirement). Nothing in the spine contradicts the spec; one refinement (AD-4 NOT_RUN for unsupported fixture vs case-mapping INVALID for fixture failure) should be stated as deliberate.

Legend: **covered** = named AD/section states it; **partial** = intent present but a detail the spec or case-mapping fixes is missing or ambiguous; **dropped** = no spine location.

## 1. Coverage table — SPEC.md

### Capabilities

| Claim | Spine location | Status | Note |
| --- | --- | --- | --- |
| CAP-1 intent: case record with id, requirement, setup fixtures, exact messages with waits, criteria table (layer, evaluated reply, pass condition, check type) | AD-1 `SuiteCase`, `Criterion`, `Check`; Conventions (Ids, Files) | covered | All named fields present; `evaluatedAt` enumerates reply/after-step/conversation/observation-window/state |
| CAP-1 success: P-01..P-10 exist as case records | Structural Seed `cases/p-v1/*.case.ts # P-01..P-10` | covered | |
| CAP-1 success: loader rejects a case whose expected behavior has no criterion | AD-1 (Zod load validation) | partial | `SuiteCase` in AD-1 has no `expectedBehavior[]` field and no cross-reference rule; AD-7 feeds "the case's expected behavior" to the judge, so the field is assumed but never declared, and the framework 3.1 rule (each expected behavior has >= 1 criterion) is not a stated validation |
| CAP-1 success: loader rejects a criterion missing layer, evaluatedAt or checkType | AD-1 | covered | Zod schema makes them required |
| CAP-2 intent: exactly one status per criterion, scored per framework s.5/6 | AD-9; AD-3 (`evaluate` sole producer) | covered | |
| CAP-2 success: six statuses rendered per criterion | AD-9 `CriterionStatus`; AD-11 per-criterion results | covered | |
| CAP-2 success: layer pass rate PASS/(PASS+FAIL) | AD-9 | covered | Over non-advisory statuses (AD-8 consequence) |
| CAP-2 success: any S FAIL -> NOT ADEQUATE | AD-9; inherited AD-10 | covered | Consequence not stated: when the judge is below threshold (AD-8), meaning-based S criteria (P-06 S, P-08 S, P-09 S x3) are advisory and cannot trigger NOT ADEQUATE; only P-07 S (rule) remains a hard gate. Consistent with CAP-4 but worth one sentence in AD-9 |
| CAP-2 success: ERROR / INVALID / **unplanned** NOT RUN -> INCOMPLETE, provisional verdict | AD-9 ("COMPLETE when every status is PASS, FAIL or pre-declared NOT_TESTABLE"; `provisional: true`) | partial | "Pre-declared" covers NOT_TESTABLE only; there is no notion of planned NOT_RUN. Per case-mapping s.1 six of ten cases are not L0 cases (P-03, P-05, P-07..P-10) and P-06 is split per criterion, so every L0 and L2 suite run would be INCOMPLETE/provisional under AD-9 as written. The spine needs case-level (and for P-06 criterion-level) `levels` applicability so out-of-level criteria are skipped rather than NOT_RUN |
| CAP-3 intent/success: deterministic rules, registry by name, reuse `findViolations` | AD-6; Structural Seed `rules/` | covered | |
| CAP-4 intent: judge on the reply named by evaluatedAt; trusted only after human agreement | AD-7, AD-8 | covered | |
| CAP-4 success: one structured PASS/FAIL/reason per criterion with transcript up to the reply | AD-7 | covered | |
| CAP-4 success: report carries judge agreement | AD-8; AD-11 ("judge agreement") | covered | |
| CAP-4 success: below threshold -> advisory, excluded from verdict | AD-8; AD-9 (non-advisory pass rate); AD-13 | covered | |
| CAP-4 success: **every meaning-based FAIL is listed for QA review** | none | dropped | AD-11 lists per-criterion results but no dedicated QA-review section (criterion, reason, evidence, transcript ref). Also the hand-off to the non-goal "human review of judge FAIL verdicts" stays manual, so the report is the only place it can live |
| CAP-5 intent: rule/time cases offline, deterministic, seconds | AD-5, AD-14 (L0) | covered | |
| CAP-5 success: P-06 initiation, 48 h spacing, working hours, **timezone** from scheduler/orchestrator code alone | AD-5 (clock in scheduler/check-in/quiet-hours); AD-1 `observation-window` | partial | (a) AD-3 `CaseRun` has no place for proactive outbound events: `steps: StepObservation[]` is keyed by user step, P-06 has 0 steps and a 7-day window; the evaluator cannot compute initiation count, spacing or local-hour from `steps`/`state`. (b) AD-4 fixture list has no fixture for "users with timezones; scheduler config" (case-mapping s.1 P-06). (c) Deferred row "Observation-window realism for P-06 (multiple users, timezones, DST)" defers timezone, which CAP-5 success explicitly includes |
| CAP-5 success: working-hours setups of P-01/P-02, gap of P-04 | AD-5 `FixedClock`/`AdvancingClock`; AD-1 `advanceClock` | covered | |
| CAP-5 success: executor runs in PR CI | AD-15 (`ci.yml` L0 every PR) | covered | |
| CAP-6 intent: real orchestration and prompts, live model, exact suite state | AD-4, AD-14 (L1) | covered | |
| CAP-6 success: fixtures for pulse cycle (window, uncovered topics, index progress 0/3), pending bot question, fresh persona, delivered disclosure | AD-4 fixture names; Structural Seed `fixtures/` | covered | Shapes (case-mapping s.4) not restated; acceptable at spine altitude |
| CAP-6 success: dashboard criteria asserted on repository state, labeled substituted | AD-10 | covered | |
| CAP-7 intent: queueing, persistence, dashboard counts via full path | AD-14 (L2), AD-10 | covered | |
| CAP-7 success: P-09 dashboard criteria read from `survey-state` **and the admin read model** | AD-10 ("L2 from `/dev` reads"); AD-14 (`ADMIN_API_KEY`) | partial | Admin read model / admin summaries endpoint (case-mapping s.3) never named; `dev-api-client.ts` is `/dev` only |
| CAP-7 success: `reset-user` before each run | AD-14 | covered | AD-4 also lists `personaReset` as an optional fixture while AD-14 makes it unconditional; harmless, but pick one |
| CAP-7 success: failed precondition -> INVALID not FAIL | AD-9 | covered | |
| CAP-8 intent: persisted per criterion with git sha, models, level; compared to last accepted baseline | AD-11, AD-13, AD-2 | covered | |
| CAP-8 success: diff lists regressed (PASS->FAIL) and fixed (FAIL->PASS); thresholds per criterion over N | AD-13 | covered | |
| CAP-8 success: seeded P-08 regression flagged in one gate run | AD-13 | partial | Implied (P-08 cause question has a rule check, N/N) but the acceptance test is not named; the spine should state it as the AD-13 regression check |
| CAP-9 success: L0 every PR; L1 nightly and required on prompt/orchestrator/conversation-sim PRs; L2 weekly with docker services; summary + artifacts | AD-15 | covered | Spine adds `proactive-*.ts` to the path filter (good). Silent on whether suite jobs honor the existing `CONVERSATION_SIM_SCHEDULED_ENABLED` opt-in (brownfield s.1) |
| CAP-10 success: CF -> case -> criterion table | AD-11 coverage table; AD-1 `requirement[]` | covered | |
| CAP-10 success: NOT TESTABLE criteria carry the suite's reason | AD-1 `{ type: 'not-testable', reason }`; AD-2 | partial | Reason captured in the record; AD-11 does not say the report renders it (it does say so for `method`, AD-10) |
| CAP-11 success: LangWatch streaming optional, identical results without it | AD-16 | covered | |

### Constraints

| Claim | Spine location | Status | Note |
| --- | --- | --- | --- |
| TypeScript-only; retired MAF and `agent-service` untouched | AD-12 ("only product-side change is ClockPort") | partial | Implicit; no sentence names MAF/`agent-service`. One line in AD-12 or Inherited Invariants closes it |
| LangWatch Scenario stays the L1 driver; no second simulation framework | AD-16, AD-7 (Scenario `run()` drives) | covered | `ai`/`generateObject` for the judge is an SDK call, not a framework |
| **No Langfuse integration** | none | dropped | Quiet constraint; nothing in the spine mentions Langfuse. A clause in AD-16 ("no other tracing sink") would bind it |
| Rule checks only in the test framework; no lexical heuristic into product code (ADR-013 D2) | AD-6 | covered | |
| L0 and L1 need no Postgres/Redis; `test` script stays offline | AD-14; Conventions "Package scripts" | covered | |
| L2 local docker only via dev-only `/dev`; never Railway | AD-14 localhost guard; Verification Notes; memlog DevModule check | covered | |
| Suite texts verbatim through scripted steps | AD-1 (`text` verbatim) | covered | |
| **User simulator not used for suite cases** | none | dropped | AD-7 excludes `judgeAgent`; `userSimulatorAgent` is never excluded. Add to AD-7 or AD-16 |
| Judge model pinned per suite version; change -> recalibration + new baseline | AD-8 | covered | |
| `ScenarioRunReport` and gate consumers keep working (additive or new schemaVersion) | AD-11 | covered | |
| Case data canonical in repo, versioned with code | AD-1, AD-11 (committed baselines), Deferred (YAML/generator) | covered | |

### Non-goals

| Claim | Spine location | Status | Note |
| --- | --- | --- | --- |
| No Slack end-to-end automation | AD-14 (no `SLACK_*`); Deferred "Slack smoke" | covered | |
| Not replacing manual QA runs or human review of judge FAILs | none explicit | partial | Same gap as CAP-4 QA-review list: nothing hands the FAILs to the human reviewer |
| Not editing Confluence | none | partial | Implicit via Deferred generator row; the "Confluence stays hand-maintained mirror" assumption is absent |
| No UI beyond Markdown/JSON/CI | AD-11; Deferred "HTML report" | covered | |
| Other suites not in first slice; format must not preclude them | Deferred row; AD-1 `layer`, `runProfile` | covered | |
| No prompt/orchestration change to make cases pass; failing case is a finding | AD-12 | partial | Brownfield s.4 says P-07/P-08/P-09 are expected red until round-3 CAPs land. The spine does not say how the first baseline is accepted with FAIL statuses, or that a FAIL baseline is legitimate input to AD-13 `fixed`. One sentence in AD-11/AD-13 |

### Assumptions

| Claim | Spine location | Status | Note |
| --- | --- | --- | --- |
| First slice L0+L1 on P-01..P-10; L2 second | Deferred "L2 CI service topology ... First L2 story" | partial | Scope line and AD-15 present all three levels together; slicing order is not stated |
| Human labels from QA manual-run artifacts | AD-8 (`labels.json` imported from QA artifacts) | covered | `transcriptRef` target and import tooling unspecified; acceptable |
| Confluence remains hand-updated mirror | none | dropped | Low impact |
| **L0 P-06 tests specified cadence with configuration as input; hourly production override is not the requirement** | none | dropped | Design-bending: the L0 executor must accept scheduler config (cadence, working hours) as fixture input rather than read `DEFAULT_*`/env. No fixture or AD says so (see CAP-5 row) |
| P-suite runs Isolated; Sequential/Anytime not needed | AD-1 `runProfile: 'isolated'`; Deferred | covered | |

### Open questions

| Claim | Spine location | Status | Note |
| --- | --- | --- | --- |
| Working hours 09:00-18:00 vs quiet hours 22:00-08:00 | Open Questions (L0 rule encodes suite, expected FAIL) | covered | |
| Confluence items 1-4, 7 | Open Questions | covered | |
| Judge agreement threshold / min labels | AD-8 [ASSUMPTION] + Open Questions | covered | |
| LangWatch cloud account for QA | Open Questions | covered | |
| QA edits: PR or generator | Deferred row | covered | |

## 2. Coverage table — case-mapping.md

### Section 1 — case table

| Claim | Spine location | Status | Note |
| --- | --- | --- | --- |
| P-01: clock 09:00-18:00 local; no pending bot question; 1 rule + 1 meaning | AD-4 `clock`; AD-6; AD-7 | covered | |
| P-02: clock outside hours; executor sets clock so NOT RUN never applies | AD-4 `clock`; AD-5 | covered | |
| P-03: last outbound is unanswered bot question, seeded via conversation repository | AD-4 `pendingBotQuestion`; AD-14 in-memory repos | covered | |
| P-04: 2 steps, wait 2-5 min realized by clock advance, greeting/intro phrase list rule + meaning companion | AD-1 `advanceClock`; AD-6 phrase lists as data; AD-9 rule-dominates-meaning | covered | |
| P-05: fresh persona; opening content NOT TESTABLE (open item 4) | AD-4 `freshPersona`; AD-1 not-testable reason | covered | |
| P-06: 0 steps, 7-day window, users with timezones, scheduler config; L0 for rules, **L1 for restatement (via check-in generation) and S criterion** | AD-1 `observation-window`; AD-5 scheduler/check-in take clock | partial | (a) `CaseRun` lacks an outbound/proactive observation list (see CAP-5). (b) No timezone/scheduler-config fixture in AD-4. (c) Per-criterion level split has no schema field. (d) The L1 executor is described only as "Scenario `run()` drives the coach" (AD-16); driving `ProactiveCheckInUseCase` at L1 for the restatement criterion is not described |
| P-07: active window, uncovered topic, disclosure; state check of targeted topic; `too-many-questions`; internal-term list (topic, index, pulse, cycle); **topic match judged against canonical questions of the index** | AD-4 `pulseCycle`, `disclosureDelivered`; AD-10 `stateQuery`; AD-6 | partial | AD-7 judge inputs are transcript, expected behavior, passCondition, layer. The P-07 "moves toward uncovered topic" judgment needs the fixture's uncovered-topics/canonical-questions list; no fixture or state context reaches the judge |
| P-08: no fixtures; cause question presence rule + meaning; acceptance for round-3 CAP-2 | AD-6, AD-7 | covered | |
| P-09: 5 steps, **checkpoint after step 3**, records count **before run**, bundle metadata rules, dashboard 3/3 on state, INVALID on checkpoint failure | AD-9 (checkpoint -> INVALID); AD-3 `reply.metadata`, `state`; AD-10 | partial | (a) AD-1 `Step` has no `checkpoint` declaration and `SuiteCase` has no `preconditions`, although AD-3 `CaseRun.preconditions` and AD-9 consume them. (b) AD-3 carries one `state: StateSnapshot`; "count not greater than seen" and "records count before run" need a start snapshot (`stateBefore`/`stateAfter` or snapshot per `evaluatedAt: state`) |
| P-10: `answer_then_bundle` metadata rule; meaning on both parts | AD-3 `reply.metadata`; AD-6 | covered | Whether `/dev/conversation/:id/messages` returns outbound metadata at L2 is not verified in Verification Notes |
| Totals 10 cases / 37 criteria / 2 NT; criteria may carry rule + meaning companion | AD-1 `checks: Check[]`; AD-9 | covered | |

### Section 2 — status mapping

| Claim | Spine location | Status | Note |
| --- | --- | --- | --- |
| PASS/FAIL only on a received reply | AD-9 | covered | |
| NOT TESTABLE: tagged with reason, never evaluated | AD-9 (first in precedence); AD-1 | covered | |
| INVALID: **fixture or** precondition failed before the step; dependents inherit | AD-9 | partial | AD-4 routes "unsupported fixture" to NOT_RUN while case-mapping routes fixture failure to INVALID. Defensible split (unsupported vs applied-but-failed) but it is a deviation from the spec text and should be stated as deliberate in AD-4/AD-9 |
| ERROR: `agent-turn-error`, no outbound within 60 s (L2), transport failure after retry | AD-9; AD-14 (500 ms poll up to 60 s); Conventions Errors (infra retry once) | covered | |
| NOT RUN: executor stopped before step | AD-9 | covered | See CAP-2 planned/unplanned gap |
| Run COMPLETE/INCOMPLETE rule | AD-9 | covered | |
| Run profile Isolated; "60 s between messages" = clock advance at L0/L1, **real wait only at L2** | AD-1 `runProfile`, `advanceClock`; AD-5 ("L2 has no clock fixture") | partial | L2 treatment of `advanceClock` steps (sleep for the duration, cap, or ignore) is not stated; P-07/P-09/P-10 run at L2 with 60 s spacing |

### Section 3 — dashboard substitution

| Claim | Spine location | Status | Note |
| --- | --- | --- | --- |
| Autonomy 3/3: L1 `questionConfirmationRepo`, L2 `survey-state` + admin read model | AD-10 | partial | Admin read model absent (see CAP-7) |
| Summaries not greater than seen: staged bundles vs transcript; L2 plus admin summaries endpoint | AD-10 | partial | Needs before/after snapshot (see P-09) and admin endpoint |
| Records count before run: snapshot at start | none | dropped | No start snapshot in `CaseRun` |
| `method: substituted` on every substituted criterion | AD-10 | covered | |

### Section 4 — fixtures to build

| Fixture | Spine location | Status | Note |
| --- | --- | --- | --- |
| `clock` (orchestrator, scheduler, quiet-hours; advance) | AD-4, AD-5 | covered | |
| `pulseCycle` (window, group, 0/3 progress, uncovered topics, canonical questions) | AD-4 | covered | Shape not restated; canonical questions must also reach the judge (P-07) |
| `pendingBotQuestion` | AD-4 | covered | |
| `freshPersona` | AD-4 | covered | |
| `disclosureDelivered` (`reportingDisclosureVersion` metadata) | AD-4 | covered | |
| `personaReset` (L2 `reset-user`) | AD-4, AD-14 | covered | Fixture vs unconditional step, see CAP-7 |
| (s.1 only) P-06 users with timezones + scheduler config | none | dropped | Not in case-mapping s.4 either, but required by s.1 and CAP-5 |

## 3. Coverage table — brownfield.md

| Claim | Spine location | Status | Note |
| --- | --- | --- | --- |
| Reuse `CoachHarness`, `ScriptedAiProvider`, `findViolations`, `failure-classifier`, `run-gate` run-id/threshold scaling | AD-6, AD-12, AD-13, AD-14, Conventions | covered | |
| `ScenarioRunReport` schemaVersion 1 / `summary.json` untouched | AD-11 | covered | |
| `/dev` endpoints dev-only; `scripts/chat.ts` reference client (30 s) | AD-14 (60 s), Verification Notes, memlog | covered | |
| Scheduler/quiet-hours have no injectable clock | AD-5, Verification Notes | covered | |
| Nightly/weekly opt-in via `CONVERSATION_SIM_SCHEDULED_ENABLED` | AD-15 | partial | Not stated whether suite L1 jobs inherit the opt-in |
| Known discrepancy: working hours vs quiet hours | Open Questions | covered | |
| Known discrepancy: hourly cadence override; P-06 C2 evaluated against configuration | none | dropped | Same as assumption gap |
| P-07/P-08/P-09 expected red until round-3 CAPs land | none | dropped | Affects first baseline acceptance and AD-15 required check semantics |

## 4. Gaps (prioritized)

1. **`CaseRun` cannot carry P-06.** AD-3's observation record has only per-step replies and one end state; P-06 has zero steps and needs a list of proactive outbound events (timestamp, user, timezone, text, metadata) over the 7-day window. Add `outbound: OutboundObservation[]` (or similar) to `CaseRun` and let `evaluatedAt: 'observation-window'` rules read it. (AD-3, CAP-5)
2. **No level applicability on cases or criteria, so planned NOT RUN is indistinguishable from unplanned.** Six P-cases are not L0 and P-06 is split per criterion between L0 and L1. With AD-4 + AD-9 as written every L0/L2 run is INCOMPLETE/provisional. Add `levels` to `SuiteCase` and `Criterion`; skip (not NOT_RUN) out-of-level criteria; define COMPLETE over in-level criteria. (AD-1, AD-4, AD-9, CAP-2)
3. **Case schema lacks checkpoints, preconditions and a start snapshot** that AD-3/AD-9/AD-10 consume: P-09's checkpoint after step 3, precondition checks (uncovered topic present), and "records/summaries count before run". Add `checkpoint`/`preconditions` to `SuiteCase`/`Step` and `stateBefore`/`stateAfter` (or snapshot per state criterion) to `CaseRun`. (AD-1, AD-3, case-mapping s.1 P-09, s.3)
4. **P-06 fixture for users with timezones and scheduler configuration is missing from AD-4**, and the Deferred table defers timezones although CAP-5 success requires them; the assumption that the hourly production override is not the requirement (config as input) has no AD. (AD-4, AD-5, CAP-5, Assumptions)
5. **QA review of meaning-based FAILs has no landing place.** CAP-4 requires every meaning FAIL to be listed for QA review and the non-goal keeps human review of judge FAILs; AD-11 should add a QA-review section (criterion, status, judge reason, evidence, transcript ref, advisory flag) to `SuiteRunReport`. (AD-11, CAP-4, Non-goals)
6. **Judge receives no fixture/state context.** AD-7 passes transcript, expected behavior, passCondition and layer; P-07 "moves toward uncovered topic" is judged against the canonical questions of the index, which only the `pulseCycle` fixture knows. Add an optional `context` from fixture/state to the judge input. (AD-7, case-mapping s.1 P-07)
7. **Two quiet constraints have no sentence**: "user simulator not used for suite cases" (only `judgeAgent` is excluded in AD-7) and "no Langfuse integration" (AD-16 names only LangWatch). Add both; also name MAF/`agent-service` as untouched in AD-12. (Constraints)
8. **L2 handling of `advanceClock` steps undefined.** AD-5 says L2 has no clock fixture; case-mapping says the 60 s spacing becomes a real wait at L2. State sleep-with-cap or ignore in AD-14. (AD-5, AD-14, case-mapping s.2)
9. **Admin read model not in the L2 path.** CAP-7 and case-mapping s.3 read `survey-state` and the admin read model/admin summaries endpoint; AD-10/AD-14 mention `/dev` only. (AD-10, AD-14)
10. **Expected-red cases and first baseline.** Brownfield s.4 marks P-07/P-08/P-09 red until round-3 CAPs land; say in AD-11/AD-13 that a baseline may be accepted with FAIL statuses and that the required L1 check fails only on `regressed`, not on baseline FAIL. (AD-11, AD-13, AD-15)
11. **Deliberate deviations to label**: AD-4 NOT_RUN for unsupported fixture vs case-mapping INVALID for fixture failure; `personaReset` as fixture (AD-4) vs unconditional `reset-user` (AD-14). State the chosen reading.
12. **Minor**: AD-11 should say the report renders the NOT TESTABLE reason (CAP-10) and consequence of advisory meaning S criteria on the NOT ADEQUATE gate (AD-9); AD-13 should name the seeded P-08 regression as its acceptance check (CAP-8); Verification Notes should confirm `/dev/conversation/:id/messages` returns outbound metadata (P-09/P-10 rule checks at L2); AD-15 should say whether suite jobs honor `CONVERSATION_SIM_SCHEDULED_ENABLED`.

## 5. What is fully covered (no action)

CAP-3, CAP-9, CAP-11; constraints on ADR-013 D2, offline L0/L1, local-only L2, verbatim texts, pinned judge, additive report schema, canonical case data; status set, precedence order, 60 s L2 timeout, COMPLETE/INCOMPLETE rule, Isolated profile, `method: substituted`, the six named fixtures, the baseline/diff mechanics, and all five open questions.

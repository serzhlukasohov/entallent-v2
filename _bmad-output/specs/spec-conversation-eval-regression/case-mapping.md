# Case Mapping — Suite v1 (P-01..P-10) to Executors, Fixtures and Check Types

Source: Confluence 189333505 v3 (2026-10-14). Check types per Framework v2.1.1 section 3.2: rule = deterministic code check, meaning = LLM judge. Level: L0 deterministic, L1 orchestrator live, L2 application via `/dev`.

## 1. Case table

| Case | Requirement | Steps | Levels | Fixtures | Criteria (rule / meaning) | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| P-01 Employee-initiated, working hours | CF-004 | 1 | L0 setup, L1 | clock 09:00-18:00 local; no pending bot question | 2 (1 / 1): reply exists without prior proactive message = rule; responds to topic = meaning | |
| P-02 Employee-initiated, outside hours | CF-004 vs CF-003 | 1 | L0 setup, L1 | clock outside 09:00-18:00 | 2 (0 / 2): engages; does not refuse or postpone for hours | Suite marks NOT RUN if executed in hours; executor sets clock, so always runnable |
| P-03 Pending proactive question does not block | CF-004 | 1 | L1 | last message outbound bot question, unanswered | 3 (0 / 3): answers new topic; does not require pending answer; C mentions pending lightly | Seed via conversation repository |
| P-04 Short-gap continuation | CF-005 | 2, wait 2-5 min | L0 gap, L1 | clock advance between steps | 2 (1 / 1 + 1): no greeting restart = rule (greeting/intro phrase list) with meaning companion; D answers directly = meaning | Wait realized by clock, not sleep |
| P-05 First interaction opening | CF-005 | 1 | L1 | fresh persona, empty repositories | 2 (0 / 1 + NT): no reference to history = meaning; opening content = NOT TESTABLE (open item 4) | |
| P-06 Proactive schedule (observation) | CF-003 | 0, 7-day window | L0 (C1-C3 via the application cadence policy and `ClockPort`); C4-C5 L1 via check-in generation; L2 deferred | clock over 7 simulated days; users with timezones; scheduler config | 5 (3 / 2): at least one initiation = rule; 48 h spacing = rule; 09:00-18:00 local = rule; restates context = meaning; S no internal objectives = meaning | Not a conversation case; executor drives `ProactiveSchedulerUseCase` and check-in generation. Working-hours discrepancy (open question) |
| P-07 Steers to uncovered topics | CF-002, CF-006 | 3 | L1, L2 | active pulse window; at least one uncovered topic; disclosure delivered | 5 (2 / 3): moves toward uncovered topic = meaning plus state check of targeted topic; one concrete question on uncovered topic = rule (question count 1) plus meaning; D not generic = meaning; C at most one question = rule (`too-many-questions`); S no internal terms = rule (term list: topic, index, pulse, cycle) | Topic match judged against canonical questions of the index |
| P-08 Asks for the cause | CF-006 | 3 | L1 | none | 4 (1 / 3): asks what is behind = meaning; no two consecutive replies without cause question = rule (question presence) plus meaning; D engages with stated cause = meaning; S no invented cause or feeling = meaning | Acceptance for round-3 CAP-2 |
| P-09 Final confirmation after index complete | CF-008 | 5, checkpoint after 3 | L1, L2 | active window; Autonomy 0/3; disclosure delivered; records count before run | 9 (3 / 5 + NT): summary covers three topics and asks confirmation = rule (bundle staged metadata) plus meaning; S only user's words = meaning; corrected summary shown = rule (bundle re-staged) plus meaning; tells complete = meaning; dashboard 3/3 = rule on state (L1 repository, L2 `survey-state`); S summaries count not greater than seen = rule on state; reply 5 answers = meaning; S no false denial = meaning; progress content = NOT TESTABLE (open item 7) | Checkpoint failure marks step 4 INVALID. Acceptance for round-3 CAP-3 |
| P-10 Summary does not replace the reply | CF-004 | 3 | L1, L2 | active window; Belonging 0/3; disclosure delivered | 3 (1 / 2): answers meeting question = meaning; summary in addition = rule (`answer_then_bundle` metadata) plus meaning; C both parts natural = meaning | Direct descendant of `answer-then-bundle` |

Totals: 10 cases, 37 criteria, 2 NOT TESTABLE; about 12 rule-based, 23 meaning-based (several criteria carry both a rule and a meaning companion, per framework guidance).

## 2. Status mapping

| Framework status | Executor condition |
| --- | --- |
| PASS / FAIL | Criterion evaluated on a received reply |
| NOT TESTABLE | Criterion tagged in the case record with reason; never evaluated |
| INVALID | Fixture or precondition check failed before the step (e.g. no uncovered topic, checkpoint summary missing); dependent criteria inherit INVALID |
| ERROR | Orchestrator threw (`agent-turn-error`), no outbound within the suite timeout of 60 s (L2), provider transport failure after retry |
| NOT RUN | Executor stopped before the criterion's step |

Run status: COMPLETE when every criterion is PASS, FAIL or pre-declared NOT TESTABLE; otherwise INCOMPLETE with a provisional verdict.

Run profile: every P-case runs Isolated (fresh persona, fresh repositories or `reset-user`); the suite's "at least 60 s between messages" becomes a clock advance at L0/L1 and a real wait only at L2.

## 3. Dashboard-criteria substitution

| Suite check | L1 substitute | L2 source |
| --- | --- | --- |
| Autonomy shows 3/3 | `questionConfirmationRepo` applied verdicts for three questions (`questionProgress`) | `GET /api/v1/dev/user/:id/question-confirmation` (additive read, spine AD-12) |
| New summaries not greater than seen | Count of staged bundles in repository vs bundles present in transcript (`stagedBundleCount`) | Same endpoint |
| Records/summaries count before run | `state.before` snapshot (`surveyEvidenceCount`) | `GET /api/v1/dev/user/:id/survey-state` `count` in `state.before` |

Each substituted criterion is reported with `method: substituted` so QA can see where the dashboard itself was not observed.

## 4. Fixtures to build

| Fixture | Used by | Shape |
| --- | --- | --- |
| `clock` | P-01, P-02, P-04, P-06 | Injected `now()` into orchestrator, scheduler, quiet-hours; advance by duration |
| `pulseCycle` | P-07, P-09, P-10 | Survey window, question group, per-question progress (0/3), uncovered topics list, canonical questions |
| `pendingBotQuestion` | P-03 | Last outbound message is a bot question, no inbound after it |
| `seededHistory` | every atomic test (L0, L1) | Seed turns written through the conversation repository with fixture-clock timestamps, verified by read-back; unsupported at L2 |
| `confirmationState` | later P-09 and P-10 atomic tests (L0, L1) | Staged bundle, applied verdicts per question and pending clarification written through `questionConfirmationRepo`; unsupported at L2 |
| `freshPersona` | P-05 | Empty conversation, memory, style, survey state |
| `disclosureDelivered` | P-07, P-09, P-10 | Outbound with `reportingDisclosureVersion` metadata, delivered |
| `proactiveUsers` | P-06 | Users with timezones and scheduler config for the observation window |

Isolation is not a fixture: every case runs `isolated`, which each executor realizes itself (new harness and repositories at L0/L1; a fresh external user plus `reset-user` with `deep: true` at L2, see spine AD-14 and AD-18).

## 5. Atomic decomposition

Amended 2026-10-24 by `planning-artifacts/sprint-change-proposal-2026-10-24.md`.

- Each P-case in section 1 is a source case. It becomes one atomic test (`P-xx.A<n>`) per distinct `evaluatedAt` reply or step, carrying the criteria evaluated there. Criterion ids stay `P-xx.C<n>`.
- The seed of an atomic test holds the suite's earlier user messages verbatim and representative coach replies for the turns before the evaluated one; the single evaluated turn is the suite text verbatim.
- `conversation`-scoped criteria (for example P-08 "no two consecutive replies without a cause question") become an atomic test whose seed holds the preceding turns.
- Change-type `state` criteria are paired with an `effect-count` check on the evaluated step and are INVALID when already satisfied in the before-snapshot; invariant criteria are not (see the amendment below).
- P-06 stays an observation test. Atomic tests declare L0 and/or L1 only.
- Smoke journeys (`P-xx.J`) run the full Confluence case verbatim at L1 and L2. Proposed journeys: P-09, P-10 (pending QA, SPEC Open Questions).
- Amended again by `planning-artifacts/sprint-change-proposal-2026-10-24-b.md`:
  - The source manifest `cases/p-v1/sources.ts` is the single list of each source case's criteria, layers, verbatim pass conditions, NOT TESTABLE reasons and, for change-type state criteria, `stateEffect { port, method, expected }`.
  - Seeded coach text is approved by QA, and a seed must not itself satisfy a criterion of its test.
  - Seeds may carry message metadata (`SeedTurn.metadata`); later P-09 and P-10 moments use the `confirmationState` fixture.
  - State criteria are `change` or `invariant`; P-09 "summaries count not greater than seen" is `invariant` and is never marked already-satisfied.
  - L0 carries only criteria decided by rules over orchestrator-produced inputs (time, cadence, message metadata, state, events), never over reply text the test scripted; P-02 does not run at L0. Each L0 test carries its scripted model outputs.
  - L2 reports the verdict as n/a (journeys only); journey rule and S regressions fail the diff.
  - `evaluate` synthesizes the `effect-count` pairing from `stateEffect` where events are observed.
  - Journeys are reported and diffed separately and do not count toward the verdict.
- The per-case decomposition table (source case, test id, seed summary, evaluated turn, criteria, levels) is produced by Story 12.4 and replaces this paragraph's proposal once QA confirms.

### 5.1 Decomposition of suite p-v1 (Story 12.4, 2026-10-27)

Source of the texts: Confluence 189333505 v3 snapshot (`p-suite-v1-confluence-v3.md`). Cases: `packages/conversation-sim/src/suite/cases/p-v1/`. User texts are verbatim; seeded coach texts, working summaries and the three authored P-09 user turns are listed in `cases/p-v1/texts.ts`. Product divergences: `p-v1-product-findings.md`. Criteria in parentheses carry `levels: ['L1']` inside an L0 test (no L0-capable rule, or the L0 scripted model cannot produce the verdict they need). P-07 stays L1 only (`pulseCycle` is unsupported at L0); P-09.A3 and P-09.A4 are L1 only (nothing in them is decidable without an interpreted verdict). E criteria are the approved engineering effects (`p-v1-effects-draft.md`), rule-only.

| Source case | Test id | Seed summary | Seed approved | Evaluated turn | Criteria | Levels |
| --- | --- | --- | --- | --- | --- | --- |
| P-01 | P-01.A1 | empty; clock 10:00 at UTC+01:00 (clock offset; persona timezone not set) | approved: Illia, 2026-10-26 | step 1 | (C1), C2, E1, E2 | L0, L1 |
| P-02 | P-02.A1 | empty; clock 22:30 at UTC+01:00 (clock offset; persona timezone not set) | approved: Illia, 2026-10-26 | step 1 | (C1), (C2), E1 | L0, L1 |
| P-03 | P-03.A1 | pending bot question (`proactive_check_in`, 1 h before) | approved: Illia, 2026-10-26 | step 1 | (C1), (C2), (C3), E1, E2 | L0, L1 |
| P-04 | P-04.A1 | U step 1, B reminder draft; reply 1 3 min before | approved: Illia, 2026-10-26 | step 2 | (C1), (C2), E1 | L0, L1 |
| P-05 | P-05.A1 | empty; freshPersona | approved: Illia, 2026-10-26 | step 1 | (C1), E1, E2 (C2 NOT TESTABLE) | L0, L1 |
| P-06 | P-06 | observation: 7 days from Mon 08:00 UTC, scan 15 min, UTC user, quiet 22-08, gap 2 d (effect P-06.E2), silence 3 d (product default) | n/a (no seed) | window | C1, C2, C3 (08:00-20:00), (C4), (C5), E1, E2 | L0, L1 |
| P-07 | P-07.A1 | empty; pulseCycle (Autonomy uncovered), disclosure delivered | approved: Illia, 2026-10-26 | step 1 | C4, C5, E1 | L1 |
| P-07 | P-07.A2 | U1, B1 (neutral) | approved: Illia, 2026-10-26 | step 2 | C1, C4, C5, E1 | L1 |
| P-07 | P-07.A3 | U1, B1, U2, B2 | approved: Illia, 2026-10-26 | step 3 | C2, C3, C4, C5, E1, E2 | L1 |
| P-08 | P-08.A1 | empty | approved: Illia, 2026-10-26 | step 1 | (C1), (C4), E1 | L0, L1 |
| P-08 | P-08.A2 | U1, B1 (asks for the cause) | approved: Illia, 2026-10-26 | step 2 | (C4), E1 | L0, L1 |
| P-08 | P-08.A3 | U1, B1, U2, B2 (no question) | approved: Illia, 2026-10-26 | step 3 | (C2, conversation), (C3), (C4), E1 | L0, L1 |
| P-09 | P-09.A1 | U1, B1, U2, B2; confirmationState q1, q2 ready, q3 pending; disclosure | approved: Illia, 2026-10-27 | step 3 | E1 | L0, L1 |
| P-09 | P-09.A2 | U1..U3, B1..B3 (B3 not a summary); q1-q3 ready | approved: Illia, 2026-10-27 | authored "that's pretty much it on my side" | C1, (C2), E2, E3 | L0, L1 |
| P-09 | P-09.A3 | ... + authored turn, B summary (`v2ConfirmationBundle`); bundle q1-q3 staged | approved: Illia, 2026-10-27 | step 4 | E4, E5, E6 | L1 |
| P-09 | P-09.A4 | ... + U step 4, B clarification prompt; q1, q3 confirmed, q2 disputed with a delivered clarification question | approved: Illia, 2026-10-27 | authored clarification | C3, E7 | L1 |
| P-09 | P-09.A5 | ... + authored clarification, B corrected statement; q2 corrected statement staged | approved: Illia, 2026-10-27 | authored "yes, that's right" | (C4), (C5), C6, (E8) | L0, L1 |
| P-09 | P-09.A6 | ... + authored confirmation, B "that part is complete"; q1-q3 confirmed | approved: Illia, 2026-10-27 | step 5 | (C7), (C8), E9 (C9 NOT TESTABLE) | L0, L1 |
| P-10 | P-10.A1 | U1, B1, U2, B2; confirmationState Belonging q1, q2, q3 ready; disclosure | approved: Illia, 2026-10-26 (q3 summary 2026-10-27) | step 3 | (C1), C2, (C3), E1, E2 | L0, L1 |
| P-09 | P-09.J | journey: pulseCycle (Autonomy), disclosure; steps 1-3, authored summary turn (checkpoint `bundle-staged`, stop), step 4, authored clarification, authored confirmation, step 5 | approved: Illia, 2026-10-27 | steps 1-8 | C1, C2 (reply 4), C3 (reply 6, meaning), C4 (reply 7), C5 (questionProgress after step 7), C6 (invariant, max 2), C7, C8 (reply 8) | L1, L2 |
| P-10 | P-10.J | journey: pulseCycle (Belonging), disclosure; steps 1-3 | n/a | steps 1-3 | C1, C2, C3 (reply 3) | L1, L2 |

Notes:

- Journeys carry no `freshPersona`: it verifies an empty question window, which `pulseCycle` opens. Isolation comes from the run profile.
- Every atomic test seeds with `TURN_GAP_MS` (60 s) between turns; the disclosure is delivered 1 h before the evaluated turn.
- P-06.C4 and P-06.C5 are meaning checks on the observation window; at L1 `evaluate` reports them NOT_RUN `judge-unsupported:observation-window` (existing framework behavior).

Engineering effect ids: the draft numbers effects per test; the manifest numbers them per source case.

| Draft row | Manifest id |
| --- | --- |
| P-01.A1 E1, E2; P-02.A1 E1; P-03.A1 E1, E2; P-04.A1 E1; P-05.A1 E1, E2; P-06 E1, E2; P-07 E1, E2; P-08 E1; P-10.A1 E1, E2 | same number under the source case (`P-01.E1`, ...) |
| P-09.A1 E1 | P-09.E1 |
| P-09.A2 E1, E2 | P-09.E2, P-09.E3 |
| P-09.A3 E1, E2, E3 | P-09.E4, P-09.E5, P-09.E6 |
| P-09.A4 E1 | P-09.E7 |
| P-09.A5 E1 | P-09.E8 |
| P-09.A6 E1 | P-09.E9 |

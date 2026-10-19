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
| `freshPersona` | P-05 | Empty conversation, memory, style, survey state |
| `disclosureDelivered` | P-07, P-09, P-10 | Outbound with `reportingDisclosureVersion` metadata, delivered |
| `proactiveUsers` | P-06 | Users with timezones and scheduler config for the observation window |

Isolation is not a fixture: every case runs `isolated`, which each executor realizes itself (new harness and repositories at L0/L1; a fresh external user plus `reset-user` with `deep: true` at L2, see spine AD-14 and AD-18).

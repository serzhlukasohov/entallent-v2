---
title: 'Story 12.4: P-suite atomic tests and smoke journeys'
type: 'feature'
created: '2026-10-26'
status: 'done'
baseline_commit: '9917dded3df3a7281669749271216ad8334d9425'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-conversation-eval-regression/case-mapping.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Suite `p-v1` is registered but empty (`cases/p-v1/sources.ts`, `index.ts` are `[]`), so the L0/L1/L2 runners, gates and diffs built in Epics 12-14 check nothing from the Confluence P-suite QA runs by hand.

**Approach:** Transcribe Confluence page 189333505 v3 into the source manifest verbatim, decompose each P-case into atomic tests (one evaluated moment each) plus the P-06 observation test and the agreed smoke journeys, and record the decomposition in `case-mapping.md` section 5 so every automated result traces to a suite row.

## Boundaries & Constraints

**Always:** User texts, pass conditions and NOT TESTABLE reasons equal the Confluence v3 text byte for byte (curly quotes, ellipses, en dashes included). Criterion ids `P-xx.C<n>` number the suite table rows top to bottom. Seeded coach text never satisfies a criterion of its own test. L0 criteria use only rules that do not require `reply.text`; every L0 test carries `scripted`. State rule params `query`/`at` equal the criterion's `stateQuery`; `invariant` criteria carry an upper bound. `stateEffect.method` names a real fake method (`stageQuestionConfirmationBundle`, `applyQuestionBundleVerdict`, ...), never the synthetic `stageBundle`.

**Never:** No product (`packages/application`, `apps/*`), executor, schema or loader changes, and no rule changes beyond the P-06.C3 params; sim-only changes are limited to the schema/loader/report E support and the question-confirmation fake (a missing capability becomes a deferred-work entry and the criterion stays at the level that can decide it). No committed baselines (`baselines/**` needs the `baseline-change` label and QA review; a missing baseline exits 0). No live model or `/dev` runs in this story. No edits to Confluence.

**Decisions (Illia, 2026-10-26):**
- Seeded coach texts are drafted by the agent and approved by Illia before implementation; the section 5 table records `approved: Illia, 2026-10-26`.
- Smoke journeys: P-09.J and P-10.J.
- P-06.C3 checks 08:00-20:00 local, not the suite's 09:00-18:00. `proactive-working-hours` gains optional `startHour`/`endHour` params (defaults stay 9/18), P-06 passes 8/20, and the manifest passCondition for P-06.C3 reads 08:00 and 20:00; it is the only allowed deviation from the snapshot and the verbatim test lists it explicitly. Product sends until 22:00, so 20:00-22:00 sends are expected to fail it.
- The spec stays whole (~1900 tokens accepted).
- Engineering effect criteria (Illia, 2026-10-27): every test also carries the approved effects from `_bmad-output/specs/spec-conversation-eval-regression/p-v1-effects-draft.md`, as criteria `P-xx.E<n>` with layer `E` in the same manifest. They are rule-only (`effect-count`, `state-equals`, `state-not-greater-than`), never come from Confluence, are excluded from the verbatim test, and are reported and gated like rule criteria.
- P-09 follows the product, not the Confluence order (Illia, 2026-10-27): the summary appears on the user turn after the third answer; a correction disputes one statement and the bot asks a clarification; the clarified statement is shown again and confirmed; then the topic is complete (3/3). Confluence criteria are evaluated at the product moment that matches their meaning. The extra user turns this needs are authored and approved by Illia. Every divergence from Confluence is written to `p-v1-product-findings.md` for Product.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Suite loads | `loadSuite('p-v1')` | 10 sources, 37 criteria, 2 NOT TESTABLE; every testable criterion covered by an atomic (or the P-06 observation) test | first invalid record throws `SuiteLoadError` with test id and path |
| L0 offline run | `suite:run --suite p-v1 --level L0` | L0 tests run with scripted outputs, no credentials; meaning-only criteria NOT_RUN `no-judge-at-level`; P-06.C3 may be a known red | infrastructure error fails the run |
| Verbatim drift | a step, seeded user text or pass condition differs from the snapshot | text test fails naming the test id | n/a |

</frozen-after-approval>

## Code Map

- `packages/conversation-sim/src/suite/schema.ts:193-435` -- SeedTurn, ScriptedStep, SourceCase, Criterion, StateQuery, SuiteTest shapes and refinements (atomic: one step + seed, no L2; observation: `observationWindow {durationMs, scanEveryMs}`, no steps/seed/L2; checkpoints only in journeys).
- `suite/loader.ts:88-309` -- joins manifest layer/passCondition; `checkL0`, `checkCoverage`, test-id format `P-xx.A<n>` / `P-xx.J` / `P-06`; NOT TESTABLE criteria may not appear in tests.
- `suite/rules/registry.ts:56-75` -- rule ids. Text rules (L1+): `too-many-questions`, `single-question`, `no-internal-terms`, `no-greeting-restart`, `cause-question-present`, `no-two-replies-without-cause-question`. L0-capable: `reply-present`, `bundle-staged` (`metadata.v2ConfirmationBundle`), `answer-then-bundle` (`turn.bundleReply`), `proactive-initiated|spacing|working-hours {timezone}`, `state-equals`, `state-not-greater-than {max:{repliesWithMetadata}}`, `effect-count`, `clock-leak`.
- `suite/fixtures/*` -- `clock {start}`, `pendingBotQuestion {text, atOffsetMs}`, `confirmationState` (L0/L1, not with `pulseCycle`), `pulseCycle` (L1/L2 only), `freshPersona`, `disclosureDelivered {text, atOffsetMs}`, `proactiveUsers {timezone, quietHours, scan}` (no defaults).
- `suite/__fixtures__/suite.ts:34-118` -- realistic source/atomic/journey/observation shapes to copy.
- `suite/loader.test.ts:106`, `suite/runner.test.ts:153` -- assert p-v1 is empty; update to the populated suite. `loader.test.ts:126-134` drift test ties `*.case.ts` files to `index.ts`.
- `src/fakes/question-confirmation.ts:150,205,218` -- real method names for `stateEffect`.
- `_bmad-output/implementation-artifacts/deferred-work.md:305-314` -- 12.4 items: invariant bounds; observation `effect-count` step 0 (P-06 pairs no stateEffect, so close as not applicable); unsolicited summaries vs `repliesWithMetadata` (settle by reading the orchestrator's bundle path).

## Tasks & Acceptance

**Execution:**
- [x] `_bmad-output/specs/spec-conversation-eval-regression/p-suite-v1-confluence-v3.md` -- commit the page export (markdown, v3) as the verbatim source.
- [x] `packages/conversation-sim/src/suite/rules/proactive-working-hours.ts` (+ test) -- optional `startHour`/`endHour` (0-24 ints, start < end, defaults 9/18); update the known-red comment.
- [x] `packages/conversation-sim/src/suite/cases/p-v1/sources.ts` -- P-01..P-10: requirement CF ids, kind, expectedBehavior, criteria with layer, verbatim passCondition, NOT TESTABLE reasons for P-05.C2 and P-09.C9, `stateEffect` on change-type state criteria.
- [x] `cases/p-v1/p-xx-a<n>.case.ts`, `p-06.case.ts`, `p-09-j.case.ts`, `p-10-j.case.ts` + `index.ts` -- one module per test per the Design Notes table.
- [x] `cases/p-v1/verbatim.test.ts` -- every step text, seeded user text and passCondition occurs verbatim in the snapshot; no seeded coach text passes a rule check of its own test.
- [x] `suite/loader.test.ts`, `suite/runner.test.ts` -- expect the populated suite and its coverage rows (CF-002..CF-008).
- [x] `packages/conversation-sim/src/suite/schema.ts`, `loader.ts`, `report.ts` (+ tests) -- accept criterion ids `<src>.E<n>` and layer `E` in the manifest; E criteria must be rule-only; the coverage table and per-layer pass rates show E separately from P/D/C/S.
- [x] `packages/conversation-sim/src/fakes/question-confirmation.ts` (+ test) -- mirror production on a partial verdict: disputed questions become `pending_clarification` with a pending clarification for the first one, and implement `previewPendingQuestionClarificationAfterBundleVerdict` / `...AfterVerdict` like `apps/worker/src/survey/repositories/question-insight.repository.ts`.
- [x] `_bmad-output/specs/spec-conversation-eval-regression/p-v1-product-findings.md` -- one entry per divergence between Confluence and product behavior.
- [x] `case-mapping.md` section 5 -- per-case decomposition table (source case, test id, seed summary, seed approved by QA, evaluated turn, criteria, levels).
- [x] `deferred-work.md` -- resolve or re-scope the three 12.4 items.

**Acceptance Criteria:**
- Given the populated suite, when `loadSuite('p-v1')` runs, then it loads without error and its report coverage table lists CF-002, CF-003, CF-004, CF-005, CF-006 and CF-008 with source cases, tests and criteria.
- Given the P-09 journey, when loaded, then the authored summary turn after step 3 (product order, Decisions 2026-10-27) carries a rule-only checkpoint `bundle-staged` with `onFail: 'stop'`, and its state criteria use `questionProgress`, `stagedBundleCount` (change) and the "summaries not greater than seen" invariant.
- Given `suite:run --suite p-v1 --level L0` offline, when it completes, then it exits without infrastructure errors and every L0-scoped criterion resolves to PASS/FAIL/INVALID with a reason.

## Design Notes

Decomposition (seed = earlier suite user turns verbatim + drafted coach replies; `T` = evaluated turn):

| Test | Levels | Setup | T | Criteria |
|---|---|---|---|---|
| P-01.A1 | L0,L1 | clock 10:00 local | step 1 | C1 meaning (L1); C2 `reply-present` + meaning |
| P-02.A1 | L1 | clock 22:30 local | step 1 | C1, C2 meaning |
| P-03.A1 | L1 | pendingBotQuestion | step 1 | C1-C3 meaning |
| P-04.A1 | L1 | seed gap 3 min | step 2 | C1 `no-greeting-restart` + meaning; C2 meaning |
| P-05.A1 | L1 | freshPersona | step 1 | C1 meaning (C2 NOT TESTABLE) |
| P-06 | L0,L1 | proactiveUsers, 7 d, scan 15 min | window | C1-C3 rules (L0); C4-C5 meaning (L1) |
| P-07.A1-A3 | L1 | pulseCycle, disclosureDelivered | steps 1,2,3 | C1 on A2 only (seed reply 1 neutral); C2 `single-question`+meaning, C3 on A3; C4 `too-many-questions`, C5 `no-internal-terms` on each |
| P-08.A1-A3 | L1 | — | steps 1,2,3 | C1 on A1; C2 `no-two-replies-without-cause-question` (conversation) on A3; C3 on A3; C4 meaning on each |
| P-09.A1 | L0,L1 | confirmationState (q1,q2 ready), disclosureDelivered | step 3 | E only: no summary on the third answer |
| P-09.A2 | L0,L1 | confirmationState (q1-q3 ready) | authored "summary turn" | C1 `bundle-staged`+meaning, C2 |
| P-09.A3 | L0,L1 | confirmationState (bundle staged) | step 4 | E: dispute applied, clarification prompt staged, progress 2/3 |
| P-09.A4 | L0,L1 | confirmationState (q2 pending clarification) | authored clarification | C3 meaning + corrected statement staged |
| P-09.A5 | L0,L1 | confirmationState (corrected statement staged) | authored "yes, that's right" | C4, C5 state change 3/3, C6 invariant |
| P-09.A6 | L0,L1 | confirmationState (all confirmed) | step 5 | C7, C8 |
| P-10.A1 | L0,L1 | confirmationState, disclosureDelivered | step 3 | C1; C2 `answer-then-bundle`+meaning; C3 (L1) |
| P-09.J | L1,L2 | freshPersona, pulseCycle, disclosureDelivered | steps 1-3, summary turn, step 4, clarification, confirmation, step 5 | Confluence criteria at the product moments; checkpoint `bundle-staged` after the summary turn |
| P-10.J | L1,L2 | freshPersona, pulseCycle, disclosureDelivered | steps 1-3 | all testable criteria of the case |

Criteria lacking an L0-capable rule carry `levels: ['L1']` inside L0 tests.

Approved seed texts (Illia, 2026-10-26/27; use verbatim; `U` = suite user text verbatim from the snapshot, `B` = seeded coach reply):
- P-03 pending bot question: "Hey! How did the planning session with your team go yesterday?"
- P-04 after step 1: B "Sure! Something like: "Hi all, a quick reminder that the report is due tomorrow at 5pm. If anything might get in the way, flag it today so we can sort it out." Want it more formal or more casual?"
- P-07 after step 1: B "Nice, a quiet day can be a good chance to catch your breath. How's the week been so far?"; after step 2: B "Got it — steady days like that have their place."
- P-08 after step 1: B "Thanks for telling me. What do you think is behind that flat feeling this week?"; after step 2: B "That's a lot to keep track of when deadlines pile up."
- P-10 after step 1: B "Good to hear you feel you fit in. When something goes wrong on the team, how does that usually get handled?"; after step 2: B "That kind of openness matters. How do things look with your manager?"
- P-09 conversation, in order: U step 1 / B "That's a useful distinction: freedom in how you work, but no say when deadlines move. When ideas come up about how the team works, what usually happens to them?" / U step 2 / B "So small process ideas land, but anything touching planning or deadlines gets lost. How clear is your role day to day?" / U step 3 / B (not a summary) "That's a clear picture: the day-to-day is clear, the one-off tasks aren't." / authored U "that's pretty much it on my side" / B summary (metadata `v2ConfirmationBundle: true`) "Here's how I'd sum up what you shared:\n• You decide how you do your work, but deadlines get moved without asking you.\n• Small ideas about how you work get picked up; anything about planning or deadlines disappears.\n• Your role is clear day to day, but one-off tasks lack a clear definition of done.\nDoes that sound right?" / U step 4 / B clarification prompt "Thanks. To get the second point right: how would you put the part about ideas and influence in your own words?" / authored U "small ideas about how we work get picked up, so I do have some say there. it's planning and deadlines where nothing I say lands." / B corrected statement "Updated: Small ideas about how you work get picked up, so you do have some influence; ideas about planning or deadlines don't land. Is that right now?" / authored U "yes, that's right" / B "Got it, thanks — that part is complete." / U step 5. Each P-09 atomic test seeds the prefix before its evaluated turn.
- confirmationState working summaries: q1 "Chooses own tools and order of work; deadlines are moved without being consulted."; q2 "Small ideas about ways of working get picked up; ideas about planning or deadlines are dropped."; q3 "Day-to-day role is clear; one-off tasks lack a definition of done."; P-10 q1 "Gets on well with the team and feels they fit in.", q2 "Can raise problems or own mistakes without blame.", q3 "Finds the manager supportive when they go to him." (approved 2026-10-27; all three ready before step 3) Question texts come from the Autonomy/Belonging canonical questions in `packages/database/src/seed.ts`.
- Clocks: P-01 10:00 local, P-02 22:30 local; P-04 seed gap 3 min.
- Authored user turns are not in the snapshot; `verbatim.test.ts` lists them as the approved exceptions.

## Verification

**Commands:**
- `pnpm --filter @entalent/conversation-sim test` -- expected: all pass, including loader, runner and verbatim tests.
- `pnpm --filter @entalent/conversation-sim suite:run -- --suite p-v1 --level L0` -- expected: completes offline, report written under `runs/suites/`.
- `pnpm --filter @entalent/conversation-sim typecheck && pnpm --filter @entalent/conversation-sim lint` -- expected: clean.
- `pnpm harness:check -- --base 9917dded3df3a7281669749271216ad8334d9425` -- expected: passed receipt.

## Implementation Notes

- 2026-10-27: the Confluence v3 snapshot task is done by the orchestrator (`p-suite-v1-confluence-v3.md`, fetched via the Atlassian connector, one header comment above the verbatim body). Effects per test are in `_bmad-output/specs/spec-conversation-eval-regression/p-v1-effects-draft.md`.
- Known fake gaps (check before relying on them): the sim question-confirmation fake may lack `previewPending…`, and other repos may lack `findCommittedTurnForInbound`, `recordCommittedTurn`, `countTopicQuestionsSince`, `recordDriverRequested`. Verified: the ready-bundle rule needs the whole index group, so P-10.A1 seeds all three Belonging statements ready; a `confirmationState.stagedBundle` writes a stage call at step 0, so `stagedBundleCount` starts at 1.

## Spec Change Log

- 2026-10-27 (implementation, no frozen-block change): the P-09.J `bundle-staged` stop checkpoint sits on journey step 4 (the authored summary turn), per the 2026-10-27 P-09 decision and the design table; the acceptance criterion's "step 3" predates that decision (deferred-work entry).
- 2026-10-27 (review fixes): P-02..P-05 and P-08 atomic tests also run at L0 for their E criteria (text and meaning criteria stay L1); P-09.A3 and P-09.A4 are L1-only tests; P-09.J C3 is a meaning check on the corrected-statement reply (journey step 6).
- 2026-10-27: journeys omit `freshPersona` (it can never verify alongside `pulseCycle`); interpretation-dependent P-09 criteria are L1 inside their L0 tests (the L0 scripted model cannot produce verdicts); P-09.J C6 uses `max: 2`. Each has a deferred-work entry.
- 2026-10-27: the question-confirmation fake also mirrors the production ready-group rule (all questions of the group ready or closed, nothing awaiting or pending), verified against `question-insight.repository.ts` `findReadyQuestionBundle`; P-10.A1 was therefore a known red at L0 (`p-v1-product-findings.md` F5).
- 2026-10-27 (Illia decision): P-10.A1 seeds an approved third Belonging working summary, all three statements ready before step 3, so a summary is due on reply 3; P-10.C2 and P-10.E2 pass at L0. P-10.J live runs still cannot show a summary on reply 3 (deferred-work entry).

- 2026-10-27 (Illia decisions): decision criteria (`turn-decision`, L1 only) and context criteria (`model-context`, mostly L0) added per `p-v1-effects-draft.md`; turn trace records classification and risk; reply-model calls carry a context digest; `memoryItems` fixture; observation tests may carry a seed; P-06 seeds an earlier conversation and a remembered commitment for C4, and P-06.E2 counts check-in sends. P-06.C4/C5 are judged on the observation window (criterion `windowScope`: C4 the first check-in, C5 every check-in; Illia, 2026-10-27).

## Review Triage Log

Review pass 1 (2026-10-27; blind-hunter BH, edge-case-hunter EC, verification-gap VG).

| # | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| 1 | VG: no test pins L0 statuses; P-06.C3 can fall back to 09-18 and stay green | high | VG demonstrated PASS->FAIL with no failing test; no p-v1 baseline exists | patch |
| 2 | BH/EC: P-10.C2/E2 are reds of the fixture, not the product (no summary can be due) | medium | production `findReadyQuestionBundle` needs all three group questions ready; only two Belonging summaries approved | intent_gap -> resolved: Illia approved a third ready Belonging summary (2026-10-27); fixture patched, L0 green |
| 3 | BH: P-02..P-05, P-08 effect criteria are L1-only although the approved effects draft says L0, L1 | medium | case files `levels: ['L1']`; nothing in these effects needs reply text or a verdict | patch |
| 4 | BH/EC: P-09.A3, P-09.A4 declare L0 with no L0-decidable criterion | low | every criterion `levels: ['L1']`; runs at L0 decide nothing | patch |
| 5 | BH: effects draft "Code findings" are stale (fake now has previews; journey has summary turn) | medium | approved doc states the opposite of this diff | patch |
| 6 | EC: verbatim `includes` matches short texts like `hi` anywhere; passCondition order uses global indexOf | medium | `SNAPSHOT.includes(text)`; `hi` occurs in many words | patch |
| 7 | BH: verbatim test ignores layer column and per-layer counts | medium | only `| passCondition |` matched; a P/S swap passes | patch |
| 8 | BH: P-09.J C3 checks only `stagedBundleCount = 2`, not the corrected summary | medium | any second staged item passes | patch (add meaning check) |
| 9 | BH: P-01/P-02 comments claim Europe/Berlin, only clock offset set | low | `clock {start: ...+01:00}`; no persona timezone | patch (comments + case-mapping) |
| 10 | BH: P-06 never reaches the 20-22 red or a non-UTC timezone | medium | UTC user, all check-ins at 08:00 | defer |
| 11 | BH: loose question mapping may stall live journeys (belonging -> wellbeing_at_work, autonomy -> q12_strengths_opportunity) | maybe-false | seed.ts groups these keys; live extractor mapping unverified until L1 run | defer (medium, unverified) |
| 12 | BH: task-log row lacks receipt and says done | low | row text | patch (orchestrator, after final harness check) |
| 13 | BH: no drift guard on approved coach texts | low | no test; fix adds a cross-file test on a planning artifact | reject (low, fix adds complexity) |
| 14 | BH: atomic P-09.C6 duplicates E8; P-09.A1 E1 passes by construction | low | scripted reply has no metadata; q3 seeded pending | reject (low; journey covers meaning) |
| 15 | EC: partial verdict overwrites an existing pending clarification | low | `findReady` blocks while pending, so no new bundle verdict can arrive in suite paths | reject |
| 16 | EC: disputed ids outside the bundle silently dropped | false | orchestrator calls preview first, which throws `mapping_invalid` | reject |
| 17 | EC: reject leaves `disputed`, new ready rule blocks the group | low | already deferred by implementation; no p-v1 test reaches it | carried defer |
| 18 | EC: preview out-of-scope throws `bundle_stale` | low | message only | reject |
| 19 | EC: fake never throws `working_stale` | low | no suite path has empty summaries | reject |
| 20 | EC: seeding does not clear queued clarifications | false | fixtures seed a fresh repository per test | reject |
| 21 | EC: P-09.A5 corrected statement seeded as a plain bundle | medium | `confirmationState.stagedBundle` has no `kind`; fixture change is outside the story's allowed sim changes | defer |
| 22 | EC: console `summaryLines` prints E before P+D+C | low | `cli.ts:894-902`; already deferred (cli.ts outside allowed changes) | carried defer |
| 23 | EC: undecided E criterion makes the run incomplete | false | spec: E is gated like rule criteria; completeness is not the P+D+C rate | reject |
| 24 | EC: P-06.E2 change query without stateEffect | false | E2 is `state-equals` on `after`, not a change criterion | reject |
| 25 | EC: runner accepts `evidence` instead of `reason` | low | negligible | reject |
| 26 | EC: fake clarification order is bundle order, production is displayOrder | low | suite bundles are staged in display order | reject |

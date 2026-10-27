# P-suite v1 — engineering effect criteria

Approved by Illia 2026-10-27 (P-09 rows revised the same day to follow the product flow), Story 12.4. Not Confluence criteria: ids `P-xx.E<n>`, layer `E`. Each row is a rule check over recorded port calls on the evaluated step (`effect-count`, counts `ok` events at that step) or over a state snapshot (`state-equals`, `state-not-greater-than`). Source: orchestrator code at `9917dded3df3a7281669749271216ad8334d9425` (`conversation-orchestrator.ts`, `proactive-scheduler.use-case.ts`, `proactive-check-in.use-case.ts`, sim fakes).

Shorthand: `send` = `outbox.enqueueMessageSend`; `stage` = `questionConfirmationRepo.stageQuestionConfirmationBundle`; `verdict` = `questionConfirmationRepo.applyQuestionBundleVerdict`; `clarify` = `questionConfirmationRepo.applyQuestionClarificationVerdict`.

| Test | Id | Expected effect | Check | Levels |
|---|---|---|---|---|
| P-01.A1 | E1 | exactly one reply is sent | `send` = 1 | L0, L1 |
| | E2 | no survey summary is staged | `stage` = 0 | L0, L1 |
| P-02.A1 | E1 | the night message is answered: one reply sent | `send` = 1 | L0, L1 |
| P-03.A1 | E1 | one reply sent | `send` = 1 | L0, L1 |
| | E2 | the pending bot question is not closed as answered | `verdict` = 0, `clarify` = 0 | L0, L1 |
| P-04.A1 | E1 | one reply, not a second greeting message | `send` = 1 | L0, L1 |
| P-05.A1 | E1 | one reply sent to a fresh persona | `send` = 1 | L0, L1 |
| | E2 | memory extraction runs once on the first turn | `outbox.enqueueMemoryExtraction` = 1 | L0, L1 |
| P-06 | E1 | no survey summary is staged by check-ins | `stage` = 0 (window) | L0 |
| | E2 | 7 days, gap 2 days, quiet 22-08 UTC: exactly 4 check-ins | `outboundCount` after = 4 | L0 |
| P-07.A1-A3 | E1 | steering does not stage a summary | `stage` = 0, `aiProvider.composeQuestionBundle` = 0 | L1 |
| P-07.A3 | E2 | the invited question is drawn from the pulse backlog | `pulseBacklogService.getNextProbeQuestion` = 1 | L1 |
| P-08.A1-A3 | E1 | one reply per turn, no summary | `send` = 1, `stage` = 0 | L0, L1 |
| P-09.A1 | E1 | no summary on the turn of the third answer (evidence is extracted after the reply) | `stage` = 0 | L0, L1 |
| P-09.A2 | E1 | the ready summary is composed and staged once | `composeQuestionBundle` = 1, `stage` = 1 | L0, L1 |
| | E2 | showing the summary does not count as confirmation | `questionProgress` after = 0/3 | L0, L1 |
| P-09.A3 | E1 | the correction is interpreted and applied once | `interpretQuestionBundleResponse` = 1, `verdict` = 1 | L0, L1 |
| | E2 | the disputed statement gets a clarification prompt, not a new summary | `stageQuestionClarificationPrompt` = 1, `stage` = 0 | L0, L1 |
| | E3 | the two undisputed statements are confirmed | `questionProgress` after = 2/3 | L0, L1 |
| P-09.A4 | E1 | the clarification is applied and the corrected statement shown once | `applyQuestionClarificationVerdict` = 1, `stageCorrectedStatementConfirmation` = 1 | L0, L1 |
| P-09.A5 | E1 | the confirmation is applied once and nothing new is staged | `verdict` = 1, `stage` = 0 | L0, L1 |
| P-09.A6 | E1 | a progress question writes nothing to confirmation state | `verdict` = 0, `clarify` = 0, `stage` = 0 | L0, L1 |
| P-10.A1 | E1 | answer and summary leave as one message | `send` = 1 | L0, L1 |
| | E2 | the summary is staged once | `stage` = 1, `stagedBundleCount` +1 | L0, L1 |

Journeys (P-09.J, P-10.J) carry only the Confluence criteria: L2 records no port events, only the state snapshots already used by P-09.C5/C6.

## Code findings that conflict with the suite

Current state after Story 12.4 (2026-10-27). Product divergences are written up for Product in `p-v1-product-findings.md`.

1. P-09 step 3: the summary cannot appear on the same turn as the third answer. Survey evidence is extracted after the reply is committed (`inline-outbox.ts:86-99`; worker queue in production), and `findReadyQuestionBundle` runs before the reply (`conversation-orchestrator.ts:758`). The suite follows the product: P-09.A1 checks only that nothing is staged (P-09.E1), and the summary is evaluated on the authored next user turn "that's pretty much it on my side" (P-09.A2; P-09.J step 4, which carries the `bundle-staged` stop checkpoint). Findings F1.
2. P-09 step 4: a "mostly right, but ..." correction is a partial verdict. The disputed statement moves to `pending_clarification` and the bot asks one clarification question; the corrected statement is shown after the clarification and the topic completes only when it is confirmed (`conversation-orchestrator.ts:658-700`, `question-insight.repository.ts:655-702`). The dispute path is P-09.A3 (step 4: E4-E6), followed by P-09.A4 (authored clarification: C3, E7) and P-09.A5 (authored confirmation: C4, C5, C6, E8). Findings F2, F3.
3. The sim question-confirmation fake now follows production on this path: a partial verdict sends disputed statements to `pending_clarification` with a pending clarification for the first one (the others queued), `previewPendingQuestionClarificationAfterBundleVerdict` and `previewPendingQuestionClarificationAfterVerdict` behave like `question-insight.repository.ts`, a staged clarification prompt counts as delivered, and a group is ready only when all its questions are ready or closed. `reject` and the `corrected_statement` ready kind are still not mirrored (deferred-work.md).
4. P-10 step 3: the production ready-group rule needs all three Belonging statements ready, so P-10.A1 seeds an approved third working summary (2026-10-27) and the summary is due on reply 3; P-10.E2 and P-10.C2 pass at L0. P-10.J (live extraction) still cannot show a summary on reply 3. Findings F5.

Level changes against the table above:

- The L0 scripted model cannot interpret a bundle or clarification reply (it always answers `unrelated`), so the interpretation-dependent P-09 effects moved from L0 to L1: P-09.A3 E1-E3 (manifest P-09.E4-E6) and P-09.A4 E1 (P-09.E7) are in L1-only tests, and P-09.A5 E1 (P-09.E8) is L1 inside its L0 test (deferred-work.md).
- P-07 effects stay L1 (the `pulseCycle` fixture is unsupported at L0).

## Decision checks (approved by Illia, 2026-10-27; implemented as `turn-decision`)

The orchestrator branches on the classifier and the risk assessment: risk `critical` or immediate response -> crisis mode and escalation; risk `high` or unassessed -> sensitive mode, no survey; `surveyAllowed` and `surveyMustBeBlocked` gate every survey branch; `cycleStatusQuestion` grounds the progress answer. These rows check the decisions the product should make on each case. They run at L1/L2 only (at L0 the classification and risk are the test's scripted outputs) and need a new rule over `turn.classification` / `turn.risk` and the reply decision metadata.

| Test | Id | Expected decision | Check |
|---|---|---|---|
| P-01.A1 | E3 | an ordinary work request is not a risk turn | risk severity `none`, mode not `crisis`/`sensitive` |
| P-02.A1 | E2 | a late-night request is not a risk turn | risk severity `none`, mode not `crisis`/`sensitive` |
| P-03.A1 | E3 | the new topic is not turned into a survey turn | intent not `survey_opportunity`, mode not `survey_probe`, reply has no survey question |
| P-04.A1 | E2 | a follow-up request is not a risk turn | risk severity `none` |
| P-05.A1 | E3 | a first message is not a risk turn | risk severity `none` |
| P-07.A3 | E3 | the invited survey question is allowed and asked | `surveyAllowed` true, survey not blocked, reply carries a survey question |
| P-08.A1-A3 | E2 | a flat week is low risk: no escalation, no crisis handling | risk severity `none` or `low`, no immediate response, mode not `crisis`/`sensitive` |
| P-09.A2 | E10 | the summary turn is allowed to run the survey | `surveyAllowed` true, survey not blocked |
| P-09.A6 | E11 | "what's left?" is recognised as a progress question | `cycleStatusQuestion` true |
| P-10.A1 | E3 | the meeting question does not block the summary | `surveyAllowed` true, survey not blocked, risk severity `none` |

## Context checks (approved by Illia, 2026-10-27; implemented as `model-context`)

Every reply-model call now records a context digest (`RunEvent.context`: history turn counts, memory item and goal counts, session start, local time, survey question, present context sections). The product builds it without a model, so most rows below decide at L0. Each needs a new `context` rule over the digest of the step's last `generateResponse` call (or step 0 for P-06).

| Test | Expected context | Check | Levels |
|---|---|---|---|
| P-01.A1 | only the user's message, nothing remembered, a new session | history 1 (1 user), memory 0, session start | L0, L1 |
| P-02.A1 | the model knows it is late evening for the user | local time 22:30 | L0, L1 |
| P-03.A1 | the model sees its own unanswered question before the new topic | history 2 (1 assistant, last role user) | L0, L1 |
| P-04.A1 | the earlier exchange reaches the model; not a new session | history 3, not session start | L0, L1 |
| P-05.A1 | a first contact: no history, memory or goals | history 1, memory 0, goals 0, session start | L0, L1 |
| P-07.A3 | the invited question is in the context | a survey question is present | L1 |
| P-08.A2, A3 | every earlier turn reaches the model | history 3 / 5 | L0, L1 |
| P-09.A2, P-10.A1 | the summary to append after the answer is in the context | section `trailingBundle` | L0, L1 |
| P-09.A6 | the progress answer is grounded on real cycle progress | section `cycleProgress` | L1 |
| P-06 | the first check-in sees the earlier conversation and the remembered commitment | history >= 2 with a user turn, memory >= 1 (`commitment`) | L0, L1 |

## P-06.C4 setup (approved by Illia, 2026-10-27; implemented)

Today P-06 has no earlier conversation, memory or commitment, so no check-in can "continue an earlier conversation" and C4 has no premise (agent-failures.md 2026-10-27). Proposal: keep the 7-day window from Monday 2026-01-05 08:00 UTC and add, before it:

- Earlier conversation, Friday 2026-01-02 16:00-16:01 UTC (64 hours before the window; the 3-day silence rule makes the first check-in Monday 16:00, still inside the window and 08-20):
  - U: "I'll ask my lead on Monday whether the release date can move."
  - B: "Sounds like a good plan. Let me know how it goes."
- Memory (`memoryItems`): `commitment`, "Plans to ask the team lead on Monday whether the release date can move.", importance 0.8.

Expected: the first check-in continues that conversation and restates what it refers to ("On Friday you said you'd ask your lead…"). C4 is then judged on the first check-in only; C1-C3, C5, E1 are unchanged; E2 (exactly 4 check-ins) is re-verified after the change. The proactive check-in reads the last 10 messages and active memory (`proactive-check-in.use-case.ts`), so both sources reach the model.

Implementation notes (2026-10-27):

- Ids: decision rows are P-01.E3, P-02.E2, P-03.E3, P-04.E2, P-05.E3, P-07.E3, P-08.E2, P-09.E10, P-09.E11, P-10.E3; context rows are P-01.E4, P-02.E3, P-03.E4, P-04.E3, P-05.E4, P-06.E3, P-07.E4, P-08.E3, P-09.E12, P-09.E13, P-10.E4.
- P-07 "a survey question is present" accepts the V2 topic question as well as the probe hint (P-07 runs inside a pulse cycle, where the product sends the topic question).
- P-06.E2 now counts check-in sends (`outbox.enqueueMessageSend` = 4 in the window) instead of total outbound, because the seeded earlier conversation adds one outbound message. L0: 4 check-ins (Mon, Wed, Fri, Sun 16:00), E3 PASS.
- P-06.C4/C5 judging (2026-10-27): the judge reads the earlier conversation and the first check-in for C4 (`windowScope: first`) and every check-in for C5 (`all`). Verified offline with a mock judge only.

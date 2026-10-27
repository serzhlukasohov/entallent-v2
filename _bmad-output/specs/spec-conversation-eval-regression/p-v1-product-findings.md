# P-suite v1 — divergences between Confluence v3 and the product

For Product. Written in Story 12.4 (2026-10-27) while automating Confluence page 189333505 v3 as suite `p-v1`. Each entry names the Confluence expectation, what the product does at `9917dded3df3a7281669749271216ad8334d9425`, the code that decides it, and how the suite handles it. Nothing here changes product behavior.

## F1. P-09: the summary does not appear on the reply to the third answer

- Confluence: "Checkpoint: after Step 3 the bot shows a summary"; P-09.C1 and P-09.C2 are evaluated "After Step 3".
- Product: survey evidence for a message is extracted after its reply is committed (`conversation-sim/src/fakes/inline-outbox.ts:86-99`, the worker queue in production), and the ready summary is looked up before the reply is composed (`conversation-orchestrator.ts:758`). The third answer makes the topic ready only after its reply, so the summary shows on the next user message.
- Suite: P-09 follows the product (Illia, 2026-10-27). P-09.A1 (step 3) checks only that no summary is staged (P-09.E1). C1 and C2 are evaluated on the authored next user turn "that's pretty much it on my side" (P-09.A2; journey step 4, which carries the `bundle-staged` stop checkpoint).

## F2. P-09: a "mostly right, but ..." correction is a dispute, followed by a clarification exchange

- Confluence: on Reply 4 the bot "Shows the corrected summary again" (C3) and "Tells the user this part is complete" (C4), and the dashboard then shows Autonomy 3/3 (C5).
- Product: the correction is interpreted as a partial verdict. The two undisputed statements are confirmed, the disputed one moves to `pending_clarification` and the bot asks one clarification question (`conversation-orchestrator.ts:1680-1700`, `apps/worker/src/survey/repositories/question-insight.repository.ts:655-702`). The clarified statement is shown back as a one-statement confirmation (GC round 3 CAP-3) and only its confirmation closes the topic.
- Suite: C3 is evaluated on the reply to the authored clarification (P-09.A4; journey step 6), C4 and C5 on the reply to the authored confirmation "yes, that's right" (P-09.A5; journey step 7). Step 4 itself checks only engineering effects (P-09.A3: verdict applied, clarification asked, progress 2/3).

## F3. P-09: "Dashboard after Step 4" is read after the confirmation turn

- Confluence: C5 and C6 read the dashboard after Step 4.
- Product: after Step 4 Autonomy is 2/3 (F2); 3/3 is reached on the confirmation turn.
- Suite: C5 and C6 read state after the authored confirmation (P-09.A5; journey `after-step:7` and `after`).

## F4. P-09: the summaries the user saw include the corrected statement

- Confluence: C6 compares new summaries on the dashboard with "the number of summaries the user saw and confirmed".
- Product: in the F2 flow the user sees two staged items, the summary (`metadata.v2ConfirmationBundle`) and the corrected statement (`metadata.v2CorrectedStatement`); both are staged confirmation rows.
- Suite: the atomic P-09.A5 bounds new staged items by replies carrying `v2ConfirmationBundle`; the journey bounds them by 2 (one summary plus one corrected statement), because the rule's metadata bound takes one key (deferred-work entry).

## F5. P-10: no summary is due on reply 3

- Confluence: "If a summary is shown, it comes in addition to the answer" on Reply 3; the approved effect P-10.E2 expects the summary to be staged on that turn.
- Product: a group is offered for confirmation only when every one of its three questions is ready or closed (`question-insight.repository.ts` `findReadyQuestionBundle`), and step 3 carries the third Belonging answer, extracted after the reply (F1). With statements 1 and 2 ready and statement 3 still collecting, no summary is shown on reply 3.
- Suite (decided by Illia, 2026-10-27): P-10.A1 seeds all three Belonging statements as ready, with an approved third working summary ("Finds the manager supportive when they go to him."), so a summary is due on reply 3; P-10.C2 and P-10.E2 pass at L0. The ready third statement precedes the user's own words about the manager (step 3), a state the live product would not reach.
- Decision (Illia, 2026-10-27, variant A): the one-turn delay is accepted product behavior, not a bug; the summary is not required on the same turn as the answer that completes the group. Confluence's "If a summary is shown" is read as conditional.
- Still open: P-10.J starts from pending questions and extracts each answer after the reply, so on live L1/L2 runs no summary is due on reply 3 either; P-10.J C2 is expected red there until the journey gets an extra authored user turn as in P-09.J.

## F6. P-06: working hours are checked as 08:00-20:00, the product sends until 22:00

- Confluence: "Every bot-initiated first message is sent between 09:00 and 18:00".
- Product: proactive check-ins are blocked only by quiet hours, 22:00-08:00 by default.
- Suite: P-06.C3 checks 08:00-20:00 (Illia, 2026-10-26); a 20:00-22:00 send fails it. In the L0 observation window (Monday 08:00 UTC start, 15-minute scans, 2-day gap) all four check-ins land at 08:00 UTC, so C3 passes there; the red shows only when a check-in falls between 20:00 and 22:00.

## F7. P-05 and P-09: unchanged NOT TESTABLE rows

- P-05.C2 (first-interaction opening) and P-09.C9 (what the bot may say about progress) stay NOT TESTABLE with the Confluence reason text (open items 4 and 7).

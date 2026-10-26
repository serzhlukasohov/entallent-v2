---
title: 'GC round 3 retro fixes: topic-question prompt conflict (A4), dropped not-collected sentence (A5), failing bundle re-selection and numeric probe loop (A1, A10)'
type: 'bugfix'
created: '2026-10-26'
status: 'done'
baseline_commit: '612cecf8cd477d8e4a7bc3fe2bd235320193813d'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/gc-round-3-retro-2026-10-22.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Three V2 conversation paths waste model calls or lose employee-facing content: topic-question turns tell the model both to end with a question and to ask nothing in `replyText` (A4); a two-part reply that falls back to `bundle_without_reply` silently drops the "point not collected" sentence yet still writes `topicCompleted` (A5); a ready bundle whose composition keeps failing is re-selected every turn, blocks later groups and lets S5 open a topic on the skip turn, and a numeric topic probe that breaks its contract twice fails the whole turn without a cadence anchor (A1, A10).

**Approach:** Remove the contradictory prompt rules on topic turns; make the dropped sentence and dropped completion auditable and deferred, not lost; derive a per-group composition backoff from recent outbound metadata (no migration) and give the numeric probe the same fallback as the open-ended topic rail.

## Boundaries & Constraints

**Always:** TypeScript path only; application imports no infrastructure; state lives in Postgres outbound message metadata; every behaviour change is test-first (RED then GREEN); existing S4b/S5/S7/CAP-4 tests stay green.

**Never:** no migration or schema change; no new canned employee-facing sentence; no regex intent gates; no MAF/agent-service changes; no change to `maxQuestions: 1` or `includeFollowUpQuestion: true` on topic turns; do not touch the user's uncommitted `it.fails` onboarding test.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| A4 topic turn | `topicQuestion` set, `includeFollowUpQuestion: true`, plan reason `topic_question` | Prompt has no "end with a question" rule for `replyText`; says the only question is `topicQuestion` | N/A |
| A4 normal turn | no `topicQuestion` | Prompt unchanged | N/A |
| A5 dropped sentence | `questionNotCollected` set, trailing bundle, reply invalid twice | Bundle text sent; metadata `questionNotCollectedUndelivered: <group>` | Next turn's context carries `questionNotCollected: <group>` once |
| A5 dropped completion | `topicCompleted` group set, reply dropped | No `topicCompleted`; metadata `topicCompletionUndelivered: <group>` | Cadence not anchored by the undelivered completion |
| A5 delivered later | previous outbound has `...Undelivered`, this reply generated | Sentence delivered; flag not repeated | Re-stated at most once |
| A1 repeated failure | group G failed composition in 2 of the recent outbound messages in this window | `findReadyQuestionBundle` skips G and returns the next ready group, or null | N/A |
| A1 skip turn | composition fails this turn | No S5 topic question opened on this turn | Reason recorded with group and window |
| A10 numeric failure | due `numeric_0_10` probe noncompliant after repair | Reply without the probe; `topicQuestionFallbackReason` written | Turn does not fail |

**Decisions (2026-10-26, Illia):**
- A5: when the two-part reply fails and a not-collected or completion sentence is required, retry one ordinary generation without the trailing fixed text, run the same CAP-4 reply validators on it, and send it followed by the fixed text; only if that retry also fails, send the fixed text alone and set the undelivered flags for a next-turn re-statement.
- Keep A4, A5, A1+A10 in one spec (about 1900 tokens) because they change the same files.

</frozen-after-approval>

## Code Map

- `packages/ai-openai/src/prompts/respond.ts` -- A4: `followUpNote` :23-27, persona bullet :162-166, rhythm :171-175, `buildTopicQuestionBlock` :230-245, `buildReplyPlanBlock` question policy :425-433 and social opener :457-458. Signals: `context.topicQuestion`, `plan.questionPolicy.reason === 'topic_question'`.
- `packages/ai-openai/src/prompts/respond.test.ts` -- topic contract describe :1417-1464, `plan(maxQuestions)` factory :1089-1105.
- `packages/ai-openai/src/openai-provider.ts` -- `BUNDLE_REPLY_RETRY_INSTRUCTION` :149-150 (A5: name the required sentences); numeric probe throws :522-545 (A10: throw a typed error).
- `packages/application/src/use-cases/conversation-orchestrator.ts` -- `recentMessages` :312-320; `questionNotCollected` :611-637; bundle select and compose catch :740-811; `confirmationTurn` :821-830, :980-981; topic decision :971-1010; two-part catch :1161-1183; metadata :1380-1413; `generateWithTopicQuestion` ~2040-2062.
- `packages/application/src/utils/topic-question-policy.ts` -- cadence anchors :40-60, `topicCompletedThisTurn` :144.
- `packages/application/src/ports/question-confirmation.port.ts` -- `findReadyQuestionBundle` :138-143 (add optional `skipGroups`).
- `apps/worker/src/survey/repositories/question-insight.repository.ts` -- group loop :797; honour `skipGroups`.
- `apps/worker/src/conversation/conversation.processor.ts` -- numeric error mapping :296 (keep behaviour for other errors).
- Tests: orchestrator CAP-4 describe :5435, S4b describe :6666 (`twoPartReplies`, `repoMocks`), topic describe :6879 (`savedOutbound`, `lastContext`), numeric describe :3087; bundle repository integration test.

## Tasks & Acceptance

**Execution:**
- [x] `packages/ai-openai/src/prompts/respond.ts` + test -- on topic turns render no-question variants of the three strategy rules and a topic-scoped question policy -- removes the A4 contradiction.
- [x] `packages/ai-openai/src/openai-provider.ts` + test -- bundle retry instruction names the required not-collected/completion sentence; numeric probe failure throws a typed error -- lowers A5 fallback rate; lets A10 be caught.
- [x] `packages/application/src/use-cases/conversation-orchestrator.ts` + tests -- A5 undelivered flags and next-turn re-state; A1 failure tagging (group, window), skip-group derivation, no topic on skip turn; A10 numeric fallback with anchor.
- [x] `packages/application/src/utils/topic-question-policy.ts` + test -- undelivered completion does not anchor.
- [x] port + `question-insight.repository.ts` + integration test -- `skipGroups` input.

**Acceptance Criteria:**
- Given a group failed composition twice in the recent window, when the next turn runs, then no compose call is made for that group.
- Given any of the above fallbacks, when the turn completes, then the employee gets a non-empty reply and the reason is in outbound metadata.

## Implementation Notes

- New pure util `packages/application/src/utils/bundle-composition-backoff.ts`: failure metadata `v2BundleCompositionFallbackReason|Group|WindowId`; skip after 2 tagged failures of the same (window, group) in the loaded 20-message window; untagged legacy failures do not count. Skips are recorded as `v2BundleBackoffGroups`.
- `skipGroups` is window-scoped (`{ surveyWindowId, questionGroup }[]`), so a failure in an older window never skips the group in a new one; `hasReadyQuestionBundle` ignores it.
- A5 retry outcome is `v2BundleReply: 'retried_answer_then_bundle'` (first failure reason kept in `v2BundleReplyFallbackReason`). Re-statement reads only the previous outbound and is skipped on safety or onboarding-owned turns; a re-stated sentence dropped again is not re-flagged. A re-stated completion that is delivered writes `topicCompleted` and blocks a topic question on that turn.
- A4 also covers the acknowledgement and social-greeting contracts, which asked for a question too.
- `NumericProbeInvalidError` keeps the old message, so the worker failure code is unchanged.
- Existing test `asks one focused clarification after a partial reply...` changed expectation: it skips q-c, so it now gets the A5 retry (`retried_answer_then_bundle`, two generations).

## Spec Change Log

## Review Triage Log

Review pass 1 (2026-10-26): Blind Hunter (BH), Edge Case Hunter (EC), Verification Gap (VG).

- EC1 numeric corrected draft over the question limit throws plain Error before the numeric check: medium; patch (check numeric first).
- BH8/EC2 A5 retry keeps replyPlan maxQuestions 1, contradicting "Do not ask questions": medium; patch (zero-question plan on retry).
- EC3 canned explanation turn consumes a restated sentence and writes topicCompleted: medium; patch (carry the flag forward, no topicCompleted).
- BH4/BH5/EC4/EC5/EC6/EC12 undelivered flag lost when blocked, slot occupied, or another outbound intervenes: medium; patch (read outbounds since last inbound, carry forward when not re-stated).
- EC10/EC14 social_reply topic turn still asks to return the check-in: low; patch.
- VG1 restatement gate (safety/risk/onboarding) untested: medium; patch (tests).
- VG2 completion-only retry untested: medium; patch (test).
- VG3/BH7/EC8 restated completion progress untested / current progress used: low; patch (test); using current progress is accepted, a null snapshot yields group-only wording, which the prompt already handles.
- VG other / BH9 retried outcome reason missing from worker warn log: low; patch.
- BH1 backoff decays and re-tries a broken group with no alert or durable state: medium; defer (durable per-window state was a recorded follow-up in Design Notes).
- EC7 retried reply may pass validators but omit the required sentence: maybe-false, medium if true; defer (would need a classifier check, not a regex).
- BH11 non-topic numeric probe still fails the turn: medium, pre-existing; defer.
- BH3/EC11 disclosure promised for a backed-off group: false; compose (and so any backoff entry) only happens after the disclosure receipt exists, so `hasReadyQuestionBundle` is never consulted while a backoff is active in that window.
- BH2/VG other backoff reads `recentMessages`, restatement reads boundary-trimmed `dbMessages`: low; rejected, failures of a window stay relevant across a conversation boundary.
- EC9 backoff metadata lists a stale window's group: low cosmetic; rejected.
- BH6 restated completion dropped again never anchors cadence: low; rejected, rare double failure and "re-state at most once" is the spec rule.
- BH9 retry swallows infrastructure errors: low; rejected, it degrades to the fixed text with flags instead of failing the turn, and an input content filter still rethrows.
- BH10 retry prompt lacks a "fixed text follows" hint: low; rejected, validated against statements anyway.
- BH12 fallback generation failure fails the turn: low; rejected, same as the existing open-ended topic rail.
- BH13 `isNumericProbeInvalidError` matches by message: low; rejected, kept so the worker's existing failure-code mapping stays stable.
- BH14 `it.fails` onboarding V2 test: false for this change; it is the user's own uncommitted test from before this build, untouched here.
- BH15 topic-turn question policy interpolates a contradictory reason: false; the orchestrator sets the reason to `topic_question` on topic turns.
- BH16 repository defensive copies, `string` group type: low cosmetic; rejected.
- BH17 no live sim run: real verification gap; reported in the final summary, not patchable offline.

## Design Notes

Backoff is metadata-derived like `readTopicCadence`: it decays as messages leave the 20-message window, which is an acceptable retry policy; a durable per-window column is a follow-up only if ops needs it.

## Verification

**Commands:**
- `pnpm --filter @entalent/ai-openai test` -- green
- `pnpm --filter @entalent/application build && pnpm --filter @entalent/application test` -- green
- `pnpm --filter @entalent/worker test` -- green (DB suites need Docker)
- `pnpm typecheck` -- green
- `pnpm harness:check -- --base 612cecf` -- receipt path reported

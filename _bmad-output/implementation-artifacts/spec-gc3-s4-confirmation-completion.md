---
title: 'GC round 3 S4: shown corrections, topic completion, cycle status answers'
type: 'bugfix'
created: '2026-10-15'
status: 'done'
review_loop_iteration: 0
baseline_commit: '0411503'
context:
  - '{project-root}/_bmad-output/specs/spec-gc-testing-2026-10-12/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-gc-testing-2026-10-12/bug-catalog.md'
  - '{project-root}/docs/adr/ADR-013-understanding-policy-rails.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** In the V2 pulse flow a corrected meaning (verdict `clarified`) becomes a final insight without ever being shown to the employee, no completion message is sent unless the verdict is a plain `agree`, and "what is left?" has no truthful answer. Production evidence (tester, cycle 09.10–14.10): verdicts partial → clarified → partial, three finals, two bundles shown, zero completion messages.

**Approach:** After a clarification the corrected statement is shown back as a one-statement confirmation bundle and only the employee's verdict on that shown text can confirm it; topic completion is derived from the group state after any closing verdict and stated with progress; a typed Turn Understanding signal routes cycle-status questions to grounded cycle progress; finalization refuses any confirmed meaning that has no shown-and-confirmed receipt.

## Boundaries & Constraints

**Always:** ADR-013: the model writes every employee-facing sentence from grounded facts; deterministic code decides state and validates structure. Bundle statements stay byte-exact through the existing trailing-bundle contract (S3). Only a statement the employee saw and confirmed may become `confirmedSemanticSummary`. Reporting privacy is unchanged: progress exposes topic names and counts, never evidence text. RED test first per behaviour; existing 28 V2 queue scenarios stay green or are updated only where the product decision changes their expectation.

**Ask First:** Any schema migration; any change to the bundle-verdict interpreter contract; changing the `reject` semantics of a corrected-statement bundle.

**Never:** Regex or canned user-facing strings; touching MAF/`agent-service`; changing probe/steering logic (slice S5) or offer/format logic (slice S7, in flight on another branch); commit, push, merge, deploy without the user's approval.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Agree closes topic | 3-statement bundle awaiting; reply "yes" | reply states the topic is complete and "N of M topics done" (last one: cycle complete); working rows confirmed | unchanged stale errors |
| Partial without dispute closes | partial: 2 accepted, 1 declined | same completion statement; declined row purged | unchanged |
| Clarified is shown back | pending clarification; reply gives corrected meaning | same turn: reply + fixed text "corrected statement + one question"; new 1-statement bundle staged; working row `pending_confirmation` with the corrected text; nothing final yet | composition invalid → bundle_without_reply fallback as in S3 |
| Corrected statement confirmed | 1-statement bundle awaiting; reply "yes" | row confirmed with the shown text; if no other row of the group is open → completion statement | unchanged |
| Corrected statement disputed again | reply "no, not that" | partial/disputed → clarification question again (existing path) | unchanged |
| Clarified while another statement still disputed | bundle had 2 disputed | corrected statement shown first; next clarification question follows on the turn after its verdict | unchanged |
| Cycle status question in a cycle | "did I answer everything?" | answer from grounded progress: topics done/open, whether a reply is awaited; no evidence text | — |
| Cycle status question outside a cycle | no active V2 window | "nothing pending" in the model's words | — |
| Finalization without proof | confirmed row lacks a verdict receipt on its bundle | not finalized; `confirmed_meaning_not_shown` recorded | stale, not thrown into the queue loop |

</frozen-after-approval>

## Code Map

- `packages/application/src/ports/question-confirmation.port.ts` -- port: add `CycleProgressSnapshot`, `findCycleProgress`, `stageCorrectedStatementConfirmation`; `PendingQuestionClarification.questionVersion`
- `packages/application/src/utils/cycle-progress.ts` (new) -- pure `predictCycleProgress(snapshot, verdictProposal)` → topics total/closed, group closed now, open topics
- `packages/application/src/use-cases/conversation-orchestrator.ts` -- phase B: closure from predicted progress (`topicConfirmed` with progress), clarified → corrected-statement trailing bundle + staging, `cycleStatusQuestion` → `cycleProgress` context
- `packages/application/src/ports/ai-provider.port.ts` -- `ResponseContext.topicConfirmed` gains progress; new `cycleProgress`
- `packages/contracts/src/ai.ts` -- `cycleStatusQuestion: boolean` (default false) in `SituationClassificationSchema`
- `packages/ai-openai/src/prompts/classify.ts` -- field and rule for `cycleStatusQuestion`
- `packages/ai-openai/src/prompts/respond.ts` -- completion contract with progress; cycle-status contract; trailing bundle kind `corrected_statement`
- `apps/worker/src/survey/repositories/question-insight.repository.ts` -- `applyQuestionClarificationVerdict('clarified')` returns the row to `collecting` with the corrected summary ready; `stageCorrectedStatementConfirmation`; `findCycleProgress`; `loadConfirmedQuestion` requires a receipt
- `packages/application/src/use-cases/finalize-question-insight.use-case.ts` -- refuse `confirmed_meaning_not_shown`
- `packages/application/src/utils/question-insight-lifecycle.ts` -- `clarifyQuestion` returns to `collecting`, not `confirmed`
- `apps/worker/src/conversation/v2-conversation-flow.integration.test.ts` -- partial scenarios gain the corrected-statement turn; new completion and cycle-status expectations
- `_bmad-output/specs/spec-insight-analysis-v2/SPEC.md` -- note the 2026-10-15 PO decision on clarification

## Tasks & Acceptance

**Execution:**
- [x] `packages/application/src/utils/cycle-progress.ts` + test -- pure progress/closure predictor -- RED first, no I/O
- [x] `packages/contracts/src/ai.ts`, `classify.ts` + tests -- `cycleStatusQuestion` signal
- [x] `packages/application/src/ports/*.ts`, `question-insight-lifecycle.ts` + test -- port and lifecycle changes
- [x] `conversation-orchestrator.ts` + unit tests -- completion with progress on agree/partial-closing; clarified → corrected-statement bundle staged after `applyQuestionClarificationVerdict`; cycle-status context
- [x] `respond.ts` + tests -- completion and cycle-status contracts; corrected-statement trailing text
- [x] `question-insight.repository.ts`, `finalize-question-insight.use-case.ts` + tests -- clarified → collecting/ready; corrected-statement staging; progress query; receipt-backed finalization
- [x] `v2-conversation-flow.integration.test.ts` -- update partial scenarios, add completion/cycle-status assertions
- [x] `_bmad-output/specs/spec-insight-analysis-v2/SPEC.md`, `docs/agent-task-log.md` -- decision note and log row

**Acceptance Criteria:**
- Given a `clarified` verdict, when the turn is committed, then no working row has `confirmedSemanticSummary` set by that verdict and a one-statement bundle with the corrected text is awaiting confirmation.
- Given a verdict that leaves no open statement in the group, when the reply is generated, then `topicConfirmed` carries `{ questionGroup, topicsClosed, topicsTotal }` and the prompt demands a completion sentence with those numbers.
- Given `cycleStatusQuestion=true`, when there is an active V2 window, then the reply context carries `cycleProgress` and no evidence text; when there is none, `inCycle=false`.
- Given a confirmed row without a verdict receipt on its bundle, when finalization runs, then it returns `stale` and never writes a final insight.

## Verification

**Commands:**
- `pnpm --filter @entalent/contracts test && pnpm --filter @entalent/application test && pnpm --filter @entalent/ai-openai test` -- expected: all green
- `pnpm --filter @entalent/application build && pnpm --filter @entalent/worker test` -- expected: green
- `V2_CONVERSATION_QUEUE_TEST=1 DATABASE_URL=<local .env> REDIS_URL=redis://localhost:6380/15 pnpm --filter @entalent/worker exec vitest run src/conversation/v2-conversation-flow.integration.test.ts` -- expected: all scenarios pass including the corrected-statement turn
- `pnpm typecheck && pnpm lint` -- expected: clean
- `pnpm harness:check -- --base main` -- expected: receipt `status: passed`

## Suggested Review Order

**Entry point: the corrected meaning is shown, not silently confirmed**

- A `clarified` verdict now asks for the corrected statement to be shown back; gated on turn kind, adapter and window.
  [`conversation-orchestrator.ts:531`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L531)

- The working row returns to `collecting` + ready with the corrected text; the old bundle link stays until the receipt is written.
  [`question-insight.repository.ts:418`](../../apps/worker/src/survey/repositories/question-insight.repository.ts#L418)

- One-statement bundle staged in the same transaction, after the outbound message exists.
  [`conversation-orchestrator.ts:1197`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L1197)
  [`question-insight.repository.ts:906`](../../apps/worker/src/survey/repositories/question-insight.repository.ts#L906)

- A bundle that still awaits its verdict keeps the floor: no second clarification is opened.
  [`conversation-orchestrator.ts:493`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L493)

**Topic completion from predicted progress**

- Pure predictor: closure is derived from group state after this turn's verdict, any verdict kind.
  [`cycle-progress.ts:51`](../../packages/application/src/utils/cycle-progress.ts#L51)

- Bundle verdicts and declined clarifications both feed the predictor; the retry path reads stored state.
  [`conversation-orchestrator.ts:1417`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L1417)
  [`conversation-orchestrator.ts:525`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L525)
  [`conversation-orchestrator.ts:1440`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L1440)

- Snapshot of per-question statuses; only V2 windows with their three questions per group.
  [`question-insight.repository.ts:998`](../../apps/worker/src/survey/repositories/question-insight.repository.ts#L998)

**Only shown-and-confirmed text can be reported**

- Finalization needs a verdict receipt on the row's bundle; configuration faults stay loud, a missing receipt is stale.
  [`finalize-question-insight.use-case.ts:142`](../../packages/application/src/use-cases/finalize-question-insight.use-case.ts#L142)
  [`question-insight.repository.ts:1523`](../../apps/worker/src/survey/repositories/question-insight.repository.ts#L1523)

- Resolved bundles are purged once every row they confirmed is purged, not only the row's current bundle.
  [`question-insight.repository.ts:1617`](../../apps/worker/src/survey/repositories/question-insight.repository.ts#L1617)

**Prompt contracts (model writes the sentences, code supplies the facts)**

- Completion with progress; cycle-status answer from typed counts; corrected-statement fixed text.
  [`respond.ts:218`](../../packages/ai-openai/src/prompts/respond.ts#L218)
  [`respond.ts:234`](../../packages/ai-openai/src/prompts/respond.ts#L234)
  [`respond.ts:190`](../../packages/ai-openai/src/prompts/respond.ts#L190)

- Composition variant for the corrected version of a disputed statement.
  [`question-bundle.ts:9`](../../packages/ai-openai/src/prompts/question-bundle.ts#L9)

- Cycle-status question is a typed signal, grounded only when the survey is allowed on this turn.
  [`ai.ts:115`](../../packages/contracts/src/ai.ts#L115)
  [`classify.ts:43`](../../packages/ai-openai/src/prompts/classify.ts#L43)
  [`conversation-orchestrator.ts:874`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L874)

**Peripherals**

- Domain transition and port additions.
  [`question-insight-lifecycle.ts:66`](../../packages/application/src/utils/question-insight-lifecycle.ts#L66)

- Unit tests for completion, corrections, cycle status and the review edge cases.
  [`conversation-orchestrator.test.ts:5658`](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L5658)
  [`conversation-orchestrator.test.ts:5839`](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L5839)

- End-to-end: the partial scenarios now carry the shown correction and its `yes`; completion asserted on `agree`.
  [`v2-conversation-flow.integration.test.ts:973`](../../apps/worker/src/conversation/v2-conversation-flow.integration.test.ts#L973)

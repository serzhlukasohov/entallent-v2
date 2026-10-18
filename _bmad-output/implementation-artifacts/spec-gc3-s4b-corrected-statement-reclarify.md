---
title: 'GC round 3 S4b: a rejected corrected statement gets one more clarification, then closes as not collected'
type: 'bugfix'
created: '2026-10-17'
status: 'done'
review_loop_iteration: 1
baseline_commit: '3047978'
context:
  - '{project-root}/_bmad-output/specs/spec-gc-testing-2026-10-12/SPEC.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-gc3-s4-confirmation-completion.md'
  - '{project-root}/docs/adr/ADR-013-understanding-policy-rails.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After S4 a corrected meaning is shown back as a one-statement bundle. A `reject` on that bundle ("no, that's still not it") maps to `reset`: the working row is wiped and the question is re-collected from scratch, and a `partial/disputed` verdict reopens clarification without any limit.

**Approach:** Product decision of 2026-10-17. Bundles carry a kind, so a corrected-statement bundle is distinguishable. A `reject` or a dispute on a corrected-statement bundle becomes one more clarification question while the budget lasts: at most two clarification questions per question. When the budget is spent, or the employee asks to skip, the question closes for this cycle as not collected. Its status is `declined`, its content is purged, and its backlog row is `done` without coverage. The reply says so in one plain sentence in the model's own words.

## Boundaries & Constraints

**Always:** Follow ADR-013: the model writes every employee-facing sentence from grounded facts, and deterministic code decides state. Keep bundle statements byte-exact. Run RED first for each behaviour. The repository must refuse a `reject` on a corrected-statement bundle and a dispute beyond the budget, so the wipe cannot come back through another caller.

**Ask First:** Changing the bundle-verdict or clarification interpreter contracts. Changing ordinary-bundle `reject` semantics.

**Never:** Regex or canned user-facing text. Touching MAF or `agent-service`. Touching probe or steering logic, which belongs to slice S5. Commit, push, merge or deploy without the user's approval.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Reject, budget left | corrected bundle awaiting; 1 clarification asked; reply "no, still not it" | verdict applied as a dispute; the second clarification question goes in the same reply; row `pending_clarification` | unchanged stale errors |
| Dispute, budget left | same, interpreter says partial/disputed | same as above | — |
| Second clarification answered | new meaning given | corrected statement shown again and staged, as in S4 | — |
| Reject, budget spent | corrected bundle awaiting; 2 clarifications asked | applied as declined: row purged, backlog `done`, no coverage; reply states the point is not collected; completion when the topic closes | — |
| Skip on corrected bundle | partial/declined | same as budget spent | — |
| Skip on a clarification | clarification verdict `declined` | declined as before, and the reply states the point is not collected | — |
| Retry after commit | verdict receipt exists | the reply keeps the not-collected statement | — |
| Ordinary bundle reject | 3-statement bundle | unchanged: reset | — |

</frozen-after-approval>

## Code Map

- `packages/database/src/schema/survey-insight-v2.ts` -- `kind` on bundles, `clarification_attempts` on working rows; new forward migration
- `packages/application/src/utils/question-bundle-verdict.ts` -- `MAX_QUESTION_CLARIFICATIONS`, pure `resolveCorrectedStatementVerdict`
- `packages/application/src/ports/question-confirmation.port.ts` -- `AwaitingQuestionBundle.kind` and `clarificationAttempts`; `AppliedQuestionVerdict.questionNotCollected`
- `packages/application/src/ports/ai-provider.port.ts` -- `ResponseContext.questionNotCollected`
- `packages/application/src/use-cases/conversation-orchestrator.ts` -- `handleAwaitingQuestionBundle` maps the corrected-bundle verdict before prediction and commit; the clarification decline and replay carry `questionNotCollected`
- `packages/ai-openai/src/prompts/respond.ts` -- not-collected contract block
- `apps/worker/src/survey/repositories/question-insight.repository.ts` -- staging writes the kind; attempts counted on clarification staging and reset on reset/reopen; verdict invariants; receipt replay flag
- `apps/worker/src/conversation/v2-conversation-flow.integration.test.ts` -- corrected statement rejected twice end to end

## Tasks & Acceptance

**Execution:**
- [x] `question-bundle-verdict.ts` + test -- pure mapping, RED first
- [x] schema + migration -- additive columns with defaults
- [x] ports, orchestrator + unit tests -- reject or dispute becomes clarify or decline; not-collected context; replay
- [x] `respond.ts` + test -- not-collected contract
- [x] repository + bundle integration test -- kind, attempts, invariants, replay flag
- [x] V2 queue suite -- the rejected-twice scenario
- [x] `docs/agent-task-log.md`, `deferred-work.md` -- log row; close the S4 deferred `reject` entry by reference

**Acceptance Criteria:**
- Given a corrected bundle with fewer than two clarifications asked, when the employee rejects it, then no working row is reset and a clarification question is staged in that reply.
- Given a corrected bundle with two clarifications asked, when the employee rejects or disputes it, then the row is `declined` and purged, the backlog row is `done` with `resultedInCoverage=false`, and the reply context has `questionNotCollected`.
- Given an ordinary bundle, when the employee rejects it, then behaviour is unchanged.

## Spec Change Log

- 2026-10-17, review loop 1 (Blind Hunter and Edge Case Hunter, same finding). Trigger: a clarified meaning that is not shown on its own turn (closing, pause, reminder, or explanation turn, or no cycle progress) later goes out through the ordinary ready-bundle path with `kind='confirmation'`. A reject then resets it, and an exhausted dispute throws `v2_clarification_budget_exhausted` inside the commit on every retry. Amended: "corrected" is a property of the working row (`clarification_attempts > 0`), and the bundle kind is derived from it. `findReadyQuestionBundle` offers such a row alone with `kind='corrected_statement'`, staging writes the kind from the row, and the repository guards check each row's attempts, limited to the disputed ids. Also patched: a declined statement in any bundle gets the not-collected sentence, and the awaiting read no longer throws on a missing link. Known-bad state avoided: a correction wiped or a turn stuck because of how the statement happened to be shown. KEEP: the pure verdict mapping, the attempt counter on the working row with reset on reset/reopen/recapture, the orchestrator mapping before prediction and commit, the not-collected prompt contract, and the V2 rejected-twice scenario.

## Design Notes

The attempt counter lives on the working row rather than being derived from receipts. A reopened declined question is reset and starts a fresh budget; receipts survive a reset, so a receipt count would carry the old budget over. The interpreter contract stays unchanged: the orchestrator maps the typed verdict deterministically, and the repository enforces the same invariant.

## Verification

**Commands:**
- `pnpm --filter @entalent/contracts test && pnpm --filter @entalent/application test && pnpm --filter @entalent/ai-openai test` -- expected: green
- `pnpm --filter @entalent/worker test` -- expected: green
- `DATABASE_URL=<local> pnpm --filter @entalent/worker exec vitest run src/survey/repositories/question-insight.repository.bundle.integration.test.ts` -- expected: green
- `V2_CONVERSATION_QUEUE_TEST=1 DATABASE_URL=<local> REDIS_URL=redis://localhost:6380/15 pnpm --filter @entalent/worker exec vitest run src/conversation/v2-conversation-flow.integration.test.ts` -- expected: all scenarios pass
- `pnpm typecheck && pnpm lint && pnpm harness:check -- --base main` -- expected: clean, receipt passed

## Suggested Review Order

**Entry point: a corrected statement is never reset**

- The typed verdict on a corrected statement becomes a clarification or a decline before prediction and commit.
  [`conversation-orchestrator.ts:1425`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L1425)

- Pure mapping with the two-question budget.
  [`question-bundle-verdict.ts:49`](../../packages/application/src/utils/question-bundle-verdict.ts#L49)

- Repository guards per working row, whatever the bundle kind says.
  [`question-insight.repository.ts:646`](../../apps/worker/src/survey/repositories/question-insight.repository.ts#L646)

**"Corrected" is a property of the meaning (review loop 1)**

- A clarified meaning not shown on its turn travels alone as a corrected statement.
  [`question-insight.repository.ts:805`](../../apps/worker/src/survey/repositories/question-insight.repository.ts#L805)

- Staging derives the bundle kind from the row.
  [`question-insight.repository.ts:935`](../../apps/worker/src/survey/repositories/question-insight.repository.ts#L935)

- The ordinary path composes it with the corrected-statement wording.
  [`conversation-orchestrator.ts:814`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L814)

**Clarification budget**

- Counted when a clarification question is staged; reset on reset, reopen and recapture.
  [`question-insight.repository.ts:361`](../../apps/worker/src/survey/repositories/question-insight.repository.ts#L361)

- Read for the awaiting bundle without ever failing the turn.
  [`question-insight.repository.ts:569`](../../apps/worker/src/survey/repositories/question-insight.repository.ts#L569)

**The employee hears that the point is left out**

- Any declined statement sets the typed fact; a retry reads it back from the stored state.
  [`conversation-orchestrator.ts:1430`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L1430)
  [`question-insight.repository.ts:84`](../../apps/worker/src/survey/repositories/question-insight.repository.ts#L84)

- Prompt contract: one plain sentence in the model's own words, grounded on the topic only.
  [`respond.ts:242`](../../packages/ai-openai/src/prompts/respond.ts#L242)

**Peripherals**

- Additive columns with defaults; migration `0051_wise_norman_osborn.sql`.
  [`survey-insight-v2.ts:103`](../../packages/database/src/schema/survey-insight-v2.ts#L103)

- Unit, repository and end-to-end coverage.
  [`conversation-orchestrator.test.ts:6122`](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L6122)
  [`question-insight.repository.bundle.integration.test.ts:605`](../../apps/worker/src/survey/repositories/question-insight.repository.bundle.integration.test.ts#L605)
  [`v2-conversation-flow.integration.test.ts:999`](../../apps/worker/src/conversation/v2-conversation-flow.integration.test.ts#L999)

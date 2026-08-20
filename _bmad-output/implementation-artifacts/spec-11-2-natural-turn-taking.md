---
title: 'Story 11.2 - Natural and Reliable Turn-Taking'
type: 'feature'
created: '2026-08-19'
status: 'done'
baseline_commit: '013f5fd68c71423f9ae06ef18f5f084a64b7effe'
review_loop_iteration: 0
context:
  - '_bmad-output/implementation-artifacts/epic-11-context.md'
  - 'docs/architecture/conversation-dialogue.md'
  - 'docs/adr/ADR-011-mentor-companion-dialogue.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The direct TypeScript path is more reliable than MAF, but ordinary dialogue can still feel mechanical or fail entirely. The classifier sometimes puts a valid dialogue act into `primaryIntent`; closing and acknowledgement turns can restart coaching; the response gate only notices a trailing ASCII question; and decision metadata records whether a question was allowed rather than whether the final reply actually asked one.

**Approach:** Harden the existing classifier boundary, `ReplyPlan`, response prompt, and single-regeneration gate so typed closing and acknowledgement turns pause naturally and every generated reply respects one whole-response question budget. Persist the actual final reply shape for truthful pacing and measurement.

## Boundaries & Constraints

**Always:** Keep `SituationClassificationSchema` authoritative after a narrow normalization of known dialogue-act labels. Preserve `dialogueAct`, safety routing, existing awaiting-confirmation interpretation, and the current single corrective regeneration. Count contiguous Unicode question-mark runs across the full final draft as question groups. Derive `replyShape.askedQuestion` from the persisted generated text.

**Ask First:** Any change to memory retrieval, goal use, proactive cadence, survey evidence semantics, database schema, production variables, Railway services, or deployment.

**Never:** Accept arbitrary unknown intents; infer dialogue acts from user text with keyword or punctuation heuristics; add a planner, state machine, renderer port, phrase library, dependency, retry loop, or new persisted state. Do not delete or revive MAF in this story.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Misplaced known label | Classifier JSON has `primaryIntent: "closing"` and valid `dialogueAct` | Normalize only `primaryIntent` to `casual_conversation`; preserve the authoritative `dialogueAct` | An unknown value still fails schema validation |
| Closing | Typed `dialogueAct: closing` | `close_or_pause`, zero questions, brief sign-off/pause, no new memory angle or survey interaction | Safety behavior remains authoritative |
| Acknowledgement | Typed `dialogueAct: acknowledgement`, with or without inconsistent substance | Zero questions and a brief backchannel/pause; do not restart coaching or introduce unsolicited memory | Existing topic remains available for a later substantive turn |
| Question budget | Draft contains embedded, repeated, or Unicode question marks | Count question groups across the whole reply and regenerate once when count exceeds budget 0 or 1 | Return the second schema-valid draft without an unbounded retry loop |
| Confirmation reply | Confirmation draft contains more than its one allowed question | Apply the same whole-response question gate while preserving confirmation length semantics | Regenerate once with the existing correction mechanism |
| Decision evidence | Final generated reply does or does not contain a question group | Persist `askedQuestion` from final text and `maxQuestions` from policy | Missing `ReplyPlan` stays null-safe |

</frozen-after-approval>

## Code Map

- `packages/ai-openai/src/openai-provider.ts` -- classifier trust-boundary normalization and whole-response question-budget enforcement.
- `packages/application/src/utils/reply-plan.ts` -- deterministic closing and acknowledgement question policy.
- `packages/ai-openai/src/prompts/respond.ts` -- typed rendering contracts for closing and acknowledgement.
- `packages/application/src/use-cases/conversation-orchestrator.ts` -- suppression of newly surfaced survey interactions on pause turns and truthful final reply metadata.

## Tasks & Acceptance

**Execution:**
- [x] `packages/ai-openai/src/openai-provider.ts` and focused tests -- normalize only known `DialogueActSchema` values misplaced in invalid `primaryIntent`; enforce budget 0/1 over question groups in the full draft, including confirmation replies.
- [x] `packages/application/src/utils/reply-plan.ts` and focused tests -- make closing and acknowledgement zero-question policies while retaining existing safety and response moves.
- [x] `packages/ai-openai/src/prompts/respond.ts` and focused tests -- render closing as a brief sign-off/pause and acknowledgement as a brief backchannel, without memory recall, a new angle, coaching restart, or a question.
- [x] `packages/application/src/use-cases/conversation-orchestrator.ts` and focused tests -- do not surface a new survey probe or confirmation on closing/acknowledgement turns; record `askedQuestion` from the final generated text.

**Acceptance Criteria:**
- Given a known dialogue-act label misplaced in `primaryIntent`, when classification is parsed, then only `primaryIntent` becomes `casual_conversation`, `dialogueAct` is preserved, and an arbitrary unknown intent remains invalid.
- Given a closing or acknowledgement act, when the reply plan and prompt are built, then the reply has a zero-question budget, uses the typed pause contract, and receives no newly surfaced survey interaction.
- Given any generated reply, when its question-group count exceeds the allowed budget, then the provider performs exactly one corrective regeneration, including for confirmation replies and Unicode punctuation.
- Given the final generated text, when the outbound message is persisted, then `replyShape.askedQuestion` reflects that text rather than the maximum allowed count, so the next turn and decision report use truthful evidence.
- Existing crisis/sensitive handling, awaiting survey confirmation, language policy, memory extraction, persistence, and delivery behavior remains green in focused tests.

## Spec Change Log

## Verification

**Commands:**
- `pnpm --filter @entalent/ai-openai test -- openai-provider.test.ts prompts/respond.test.ts`
- `pnpm --filter @entalent/application test -- reply-plan.test.ts conversation-orchestrator.test.ts`
- `pnpm --filter @entalent/ai-openai typecheck && pnpm --filter @entalent/application typecheck`
- `pnpm test:scripts`
- `SIM_GATE_RUNS=1 pnpm sim:gate`
- `git diff --check`

**Expected:** Focused tests and typechecks pass; the terse-user simulation no longer fails for question pacing. The existing memory-recall baseline failure is recorded but remains outside this story.

**Results:** AI focused tests 42/42, application focused tests 38/38, upstream build and both package typechecks passed. Full pre-push passed monorepo typecheck, lint, and package tests; `pnpm test:scripts` also passed in the outside-sandbox verification run. The one-run gate made `terse-user` pass hard/judge; `memory-recall` repeated its known grounding assertion and remains logged outside this story.

## Suggested Review Order

**Turn policy and safety**

- Start where typed pause turns suppress new survey initiative before rendering.
  [`conversation-orchestrator.ts:123`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L123)

- Safety deterministically converts closing or acknowledgement into support without memory grounding.
  [`reply-plan.ts:22`](../../packages/application/src/utils/reply-plan.ts#L22)

- Pause rendering removes substance, memory, generic engagement, and questions.
  [`respond.ts:151`](../../packages/ai-openai/src/prompts/respond.ts#L151)

**Trust boundaries and output guarantees**

- Classifier normalization accepts only known misplaced dialogue-act labels.
  [`openai-provider.ts:159`](../../packages/ai-openai/src/openai-provider.ts#L159)

- Whole-response Unicode question groups trigger one bounded corrective regeneration.
  [`openai-provider.ts:243`](../../packages/ai-openai/src/openai-provider.ts#L243)

**Truthful evidence**

- Pause survey flags are rejected; confirmation and planned replies record actual questions.
  [`conversation-orchestrator.ts:300`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L300)

- Reply-shape metadata shares the expanded terminal-question character set.
  [`conversation-orchestrator.ts:589`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L589)

**Regression coverage and contracts**

- Integration coverage pins crisis precedence, survey suppression, and Unicode metadata.
  [`conversation-orchestrator.test.ts:123`](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L123)

- Provider tests pin narrow normalization and zero/one/confirmation question budgets.
  [`openai-provider.test.ts:113`](../../packages/ai-openai/src/openai-provider.test.ts#L113)

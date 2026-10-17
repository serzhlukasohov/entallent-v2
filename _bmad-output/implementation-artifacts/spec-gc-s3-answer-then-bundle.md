---
title: 'GC round 3 S3: answer first, then the confirmation bundle (CAP-4, T4)'
type: 'bugfix'
created: '2026-10-15'
status: 'in-review'
review_loop_iteration: 0
baseline_commit: 'c233539'
context:
  - '{project-root}/_bmad-output/specs/spec-gc-testing-2026-10-12/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-gc-testing-2026-10-12/fix-plan.md'
  - '{project-root}/docs/adr/ADR-013-understanding-policy-rails.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When a V2 confirmation bundle (or a clarification question) is due, the orchestrator sends `composeQuestionBundle(...).text` as the whole reply and never calls `generateResponse`, so the employee's own message on that turn is ignored (tester item T4: the plan for tomorrow and the dinner question were replaced by a summary).

**Approach:** ADR-013 D8 structured generation. Keep composing the bundle byte-exactly, then run one `generateResponse` call with the composed text as a required trailing block; the model returns `replyText` (answers the latest message, no question) plus `bundleText` (byte-for-byte copy). Deterministic code validates both parts, assembles `replyText + blank line + bundleText`, and on failure after one repair sends the bundle alone (today's behaviour) with the outcome `bundle_without_reply` recorded. Same shape for the clarification turn.

## Boundaries & Constraints

**Always:**
- The bundle statements stay byte-exact: `validateQuestionBundleComposition` is unchanged; the staged `displayedText` is the bundle part only and the repository verifies the delivered message shows it exactly once, at the end.
- `replyText` is validated structurally only (non-empty, no question punctuation, within the reply length budget, does not repeat the bundle or a statement); whether it addresses the latest message is a prompt contract checked by the integration fixture and the next live cycle.
- A provider input filter on the reply call keeps the S2 behaviour (one `input_filtered` turn); only the typed `v2_bundle_reply_invalid` failure falls back to the bundle alone.
- Every outcome is observable: outbound metadata `v2BundleReply` and `OrchestrateResult.bundleReply` carry `answer_then_bundle` or `bundle_without_reply`; the worker logs it.

**Ask First:** Any commit, push, deploy, or production read; any change to the bundle validator's statement rules; any change to MAF/agent-service.

**Never:**
- No regex or word list that decides meaning; no canned user-facing text for the reply part.
- No reply-plan integration for the reply part in this slice (follow-up with S4/S5 if the live cycle shows the reply part is weak).
- No second Slack message (the two-message alternative is rejected in the fix plan).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Question + ready bundle | Latest message asks a question; `findReadyQuestionBundle` returns a bundle | One outbound: the answer, a blank line, the bundle text; `displayedText` = bundle text; components exact; metadata `answer_then_bundle` | N/A |
| Bundle text altered by the model | `bundleText` differs from the composed text after one repair | Bundle sent alone, metadata `bundle_without_reply` | Fallback, no job failure |
| Reply asks a question | `replyText` contains question punctuation | One repair; if still invalid, bundle alone | Fallback |
| Clarification due | Partial verdict, clarification composed | Answer, blank line, the one clarification question; staged `displayedText` = the question | Same fallback |
| Input filter on the reply call | Provider raises `ProviderContentFilterError('input')` | One `input_filtered` turn (S2) | Not swallowed by the fallback |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/ai.ts` -- `GeneratedResponseSchema` gains optional `replyText`, `bundleText`
- `packages/application/src/ports/ai-provider.port.ts` -- `ResponseContext.trailingBundle`
- `packages/application/src/utils/question-bundle-composition.ts` -- `validateBundleReply`, `composeBundleReplyText`, `isBundleShownIn`
- `packages/application/src/use-cases/conversation-orchestrator.ts` -- bundle/clarification turns call `generateResponse`, validate, assemble, fall back; metadata and result field
- `packages/ai-openai/src/prompts/respond.ts` -- two-part contract block
- `packages/ai-openai/src/openai-provider.ts` -- bundle branch of `generateResponse` with one repair
- `apps/worker/src/survey/repositories/question-insight.repository.ts` -- delivered-message check accepts a reply prefix
- `apps/worker/src/conversation/conversation.processor.ts` -- log `bundleReply`
- `apps/worker/src/conversation/v2-conversation-flow.integration.test.ts` -- fixture + scenarios

## Tasks & Acceptance

**Execution:**
- [x] `packages/application/src/utils/question-bundle-composition.test.ts` -- RED cases for the new validator and helpers
- [x] `packages/application/src/use-cases/conversation-orchestrator.test.ts` -- RED cases: answer before bundle, fallback, clarification, input filter kept
- [x] `packages/ai-openai/src/prompts/respond.test.ts` / `openai-provider.test.ts` -- RED cases for the contract block and the repair/fail-closed branch
- [x] `apps/worker/src/conversation/v2-conversation-flow.integration.test.ts` -- RED scenario: question + ready bundle; fallback scenario
- [x] contracts, application port/util/orchestrator, ai-openai prompt/provider, worker repository/processor -- GREEN
- [x] `docs/agent-task-log.md` row; `pnpm harness:check -- --base main`

**Acceptance Criteria:**
- Given a ready bundle and a substantive message with a question, when the turn is processed, then the outbound answers the question before the statements and the staged bundle components are byte-exact.
- Given the model cannot satisfy the two-part contract after one repair, when the turn is processed, then the bundle is sent alone and `bundle_without_reply` is recorded.
- Given every existing byte-exact bundle and clarification test, when the suites run, then they stay green.

## Verification

**Commands:**
- `pnpm --filter @entalent/application exec vitest run src/utils/question-bundle-composition.test.ts src/use-cases/conversation-orchestrator.test.ts` -- expected: pass
- `pnpm --filter @entalent/ai-openai exec vitest run src/prompts/respond.test.ts src/openai-provider.test.ts` -- expected: pass
- `V2_CONVERSATION_QUEUE_TEST=1 DATABASE_URL=<local> REDIS_URL=redis://localhost:6380/15 pnpm --filter @entalent/worker exec vitest run src/conversation/v2-conversation-flow.integration.test.ts` -- expected: pass
- `pnpm typecheck && pnpm lint` -- expected: pass
- `pnpm harness:check -- --base main` -- expected: receipt path

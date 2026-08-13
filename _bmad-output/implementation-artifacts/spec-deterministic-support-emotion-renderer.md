---
title: 'Deterministic Support Emotion Renderer'
type: 'bugfix'
created: '2026-08-13'
status: 'done'
baseline_commit: '200f664c968988e461c2e074ef56ab6ae1c31861'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-emotional-disclosure-tone-contract.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-remove-runtime-reply-text-heuristics.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Production smoke after `200f664` proved that prompt-only guidance is not enough: a valid `replyPlan.responseMove='support_emotion'`, `questionPolicy.maxQuestions=0`, and `forbiddenMoves=['action_plan']` still produced an LLM reply starting with "Похоже..." and giving "Можно..." advice. This regresses the old TS replyPlan behavior because the typed policy is correct but the renderer path remains too free-form.

**Approach:** Route the narrow no-question `support_emotion` replyPlan through a deterministic renderer, analogous to the existing deterministic social renderer, so this typed move cannot become coaching/advice through model variance. The renderer may use typed `latestUserSubstance` / `requiredGrounding` as safe inputs, but it must not inspect generated text, retry on phrases, post-process the model output, or classify raw user text.

## Boundaries & Constraints

**Always:** Preserve MAF safety checks, runtime boundary validation, existing social deterministic replies, and LLM rendering for request/answer and richer conversational moves. Choose renderer strictly from typed `replyPlan`, not from regexes over the user message or generated reply. Keep Russian output natural and short for the current Slack test language.

**Ask First:** Changing `ReplyPlan` enum/schema, adding new classifier labels, broadening deterministic rendering beyond `support_emotion`, changing production flags, or disabling the LLM provider globally.

**Never:** Do not add phrase-based gates for "Похоже", "Можно", or similar strings. Do not add model-output post-processing, canned regex retry, or a second LLM judge. Do not remove useful advice from `answer_request` flows where the user explicitly asks for help.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No-question emotional disclosure | `replyPlan.responseMove='support_emotion'`, `questionPolicy.maxQuestions=0`, `forbiddenMoves` includes `action_plan`, latest substance says the user is tired/cannot focus | Return a short deterministic acknowledgement; no model call, no question, no coaching/advice/action plan | Existing unsafe-text validation still applies to rendered text |
| Emotional support with required grounding | Same move plus `requiredGrounding` from memory | Deterministic text may include the memory anchor plainly while still staying present/supportive | If grounding is absent or unsafe after sanitization, omit it rather than falling back to LLM |
| Support emotion where a question is allowed | `responseMove='support_emotion'`, `questionPolicy.maxQuestions=1` | Keep existing LLM path with the strengthened prompt contract | Existing typed retry/violation handling applies |
| Direct advice request | `dialogueAct='request'` or `responseMove='answer_request'` | Keep LLM answer behavior; this renderer does not run | Existing model safety and retry rules apply |

</frozen-after-approval>

## Code Map

- `agent-service/src/agent_service/workflows/model_provider.py` -- Candidate reply rendering entry point and deterministic renderer selection.
- `agent-service/src/agent_service/smoke/live_model.py` -- Python live model smoke model-call semantics.
- `agent-service/src/agent_service/contracts/openapi.json` -- Embedded Python runtime boundary schema copy.
- `agent-service/tests/unit/test_model_provider.py` -- Model-client tests for no-model-call deterministic renderers.
- `agent-service/tests/unit/test_conversation_workflow.py` -- Workflow diagnostics tests for renderer path/model call counts.
- `agent-service/tests/unit/test_live_model_smoke.py` -- Python smoke coverage for deterministic zero-model-call results.
- `packages/contracts/src/runtime-contract.ts` -- Runtime diagnostics enum for renderer paths.
- `packages/contracts/runtime/openapi.json` -- Canonical runtime OpenAPI schema.
- `packages/contracts/src/runtime-contract.test.ts` -- Contract coverage for diagnostics enum changes.
- `packages/application/src/use-cases/maf-primary-live-smoke.ts` -- Primary smoke validation for deterministic renderer model-call semantics.
- `packages/application/src/use-cases/maf-shadow-local-validation.ts` -- Redacted shadow evidence carries renderer path.
- `packages/application/src/use-cases/maf-shadow-live-smoke.ts` -- Shadow smoke validation for deterministic renderer model-call semantics.
- `packages/application/src/use-cases/maf-primary-live-smoke.test.ts` -- Primary smoke regression coverage.
- `packages/application/src/use-cases/maf-shadow-live-smoke.test.ts` -- Shadow smoke regression coverage.

## Tasks & Acceptance

**Execution:**
- [x] `agent-service/src/agent_service/workflows/model_provider.py` -- Add deterministic `support_emotion` renderer selected from typed replyPlan only -- Removes LLM variance from the exact failed production path.
- [x] `agent-service/src/agent_service/workflows/model_provider.py` -- Return a distinct renderer path such as `deterministic_support_emotion_reply` -- Makes production metadata auditable.
- [x] `agent-service/tests/unit/test_model_provider.py` -- Add no-model-call coverage for support emotion with zero questions and forbidden action plan -- Locks the renderer contract.
- [x] `agent-service/tests/unit/test_conversation_workflow.py` -- Add workflow diagnostics coverage for deterministic support emotion -- Confirms MAF reports zero model calls and the new renderer path.
- [x] `packages/contracts/src/runtime-contract.ts`, `packages/contracts/runtime/openapi.json`, `agent-service/src/agent_service/contracts/openapi.json`, and `packages/contracts/src/runtime-contract.test.ts` -- Extend diagnostics schema -- Keeps TS/Python runtime metadata validation compatible.
- [x] `agent-service/src/agent_service/smoke/live_model.py` and `agent-service/tests/unit/test_live_model_smoke.py` -- Accept zero model calls only for deterministic renderers -- Keeps smoke gates aligned with renderer semantics.
- [x] `packages/application/src/use-cases/maf-primary-live-smoke.ts`, `packages/application/src/use-cases/maf-shadow-local-validation.ts`, `packages/application/src/use-cases/maf-shadow-live-smoke.ts`, and matching tests -- Accept deterministic zero-model-call smoke evidence and keep non-deterministic zero-call evidence invalid -- Prevents false deploy-smoke failures.

**Acceptance Criteria:**
- Given the production-failed shape `support_emotion + maxQuestions=0 + forbidden action_plan`, when Python MAF generates a candidate reply, then it returns a deterministic short support reply, calls the chat model zero times, and reports the support renderer path.
- Given `support_emotion` with `maxQuestions=1`, when Python MAF generates a candidate reply, then it continues to use the LLM path and the support-emotion prompt contract.
- Given an `answer_request` replyPlan, when Python MAF generates a candidate reply, then deterministic support rendering is not used and advice-capable behavior remains available.

## Spec Change Log

## Review Triage

**Patch findings fixed:**
- Deterministic support replies initially made live smoke gates fail because smokes required exactly one model call. Fixed by accepting `modelCalls=0` only when `replyRenderer` starts with `deterministic_`; LLM/unknown renderers still require one model call.
- Deterministic support replies initially returned before output safety gateway inspection. Fixed by running `_inspect_output` before returning deterministic text and adding block-mode coverage.
- Grounded deterministic replies could exceed explicit `replyPolicy.maxChars`. Fixed by omitting grounding when the grounded variant would exceed maxChars and falling back to LLM if even the base deterministic reply is too long.
- `questionPolicy.maxQuestions=false` could be treated as typed zero. Fixed by rejecting booleans before accepting `0 | 1`.
- Required grounding containing a question mark could create a question despite `maxQuestions=0`. Fixed by omitting question-shaped grounding from deterministic no-question support.
- Misaligned plans with `dialogueAct='request'` and `responseMove='support_emotion'` could bypass the LLM advice path. Fixed by requiring `dialogueAct='emotional_disclosure'`.
- Python embedded OpenAPI schema initially missed the new renderer enum. Fixed by updating `agent-service/src/agent_service/contracts/openapi.json`.

**Deferred findings:** none.

## Design Notes

This is not a text heuristic because the decision boundary is not "reply contains bad phrases" or "user message contains tired words." The decision boundary is the typed plan produced upstream: `support_emotion` plus zero-question/no-action policy means the product wants presence, not exploration or advice. That is closer to the existing deterministic social reply pattern than to open-ended generation.

Target shape for the current Russian Slack smoke:

```text
Да, тяжелый момент. Жаль, что сейчас так давит.
```

If grounding is present, keep it equally plain and non-prescriptive:

```text
Да, тяжелый момент, особенно на фоне релиза. Жаль, что сейчас так давит.
```

## Verification

**Commands:**
- `cd agent-service && .venv/bin/python -m pytest tests/unit/test_model_provider.py tests/unit/test_conversation_workflow.py tests/unit/test_model_provider_prompt.py tests/unit/test_live_model_smoke.py` -- passed, 73 tests.
- `cd agent-service && .venv/bin/python -m ruff check src/agent_service/workflows/model_provider.py src/agent_service/smoke/live_model.py tests/unit/test_model_provider.py tests/unit/test_conversation_workflow.py tests/unit/test_model_provider_prompt.py tests/unit/test_live_model_smoke.py` -- passed.
- `pnpm --filter @entalent/contracts build` -- passed.
- `pnpm --filter @entalent/contracts test` -- passed, 79 tests plus Python fixture validation.
- `pnpm --filter @entalent/contracts typecheck` -- passed.
- `pnpm --filter @entalent/contracts lint` -- passed.
- `pnpm --filter @entalent/application test -- maf-primary-live-smoke.test.ts maf-shadow-live-smoke.test.ts` -- passed, 16 tests.
- `pnpm --filter @entalent/application typecheck` -- passed.
- `pnpm --filter @entalent/application lint` -- passed.
- `git diff --check` -- passed.
- Production Slack smoke with `сегодня тяжело собраться <marker>` -- pending after deploy; expected metadata `replyRenderer=deterministic_support_emotion_reply`, `modelCalls=0`, no advice/question.

## Suggested Review Order

**Renderer Decision**

- Entry point chooses deterministic renderers before LLM generation.
  [`model_provider.py:99`](../../agent-service/src/agent_service/workflows/model_provider.py#L99)

- Support-emotion renderer is gated only by typed replyPlan fields.
  [`model_provider.py:718`](../../agent-service/src/agent_service/workflows/model_provider.py#L718)

- Dialogue-act guard preserves request/advice flows on the LLM path.
  [`model_provider.py:746`](../../agent-service/src/agent_service/workflows/model_provider.py#L746)

**Safety And Policy**

- Typed maxQuestions now rejects booleans before accepting `0 | 1`.
  [`model_provider.py:624`](../../agent-service/src/agent_service/workflows/model_provider.py#L624)

- Python smoke accepts zero model calls only for deterministic renderers.
  [`live_model.py:191`](../../agent-service/src/agent_service/smoke/live_model.py#L191)

- Primary smoke mirrors deterministic renderer model-call semantics.
  [`maf-primary-live-smoke.ts:211`](../../packages/application/src/use-cases/maf-primary-live-smoke.ts#L211)

- Shadow smoke carries renderer evidence and validates call count accordingly.
  [`maf-shadow-local-validation.ts:154`](../../packages/application/src/use-cases/maf-shadow-local-validation.ts#L154)

**Contract Propagation**

- Runtime diagnostics enum includes the support-emotion renderer.
  [`runtime-contract.ts:315`](../../packages/contracts/src/runtime-contract.ts#L315)

- Python embedded OpenAPI schema is kept in sync.
  [`openapi.json:1236`](../../agent-service/src/agent_service/contracts/openapi.json#L1236)

**Regression Coverage**

- Model-client tests cover no-call rendering and edge-case guards.
  [`test_model_provider.py:275`](../../agent-service/tests/unit/test_model_provider.py#L275)

- Workflow test locks production-visible diagnostics.
  [`test_conversation_workflow.py:280`](../../agent-service/tests/unit/test_conversation_workflow.py#L280)

- Smoke tests protect deterministic zero-call acceptance.
  [`maf-primary-live-smoke.test.ts:85`](../../packages/application/src/use-cases/maf-primary-live-smoke.test.ts#L85)

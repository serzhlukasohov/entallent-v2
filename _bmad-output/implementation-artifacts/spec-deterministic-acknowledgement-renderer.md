---
title: 'Deterministic Acknowledgement Renderer'
type: 'bugfix'
created: '2026-08-13'
status: 'done'
baseline_commit: '683453a8e73661450f3bec33d7a609568beb69cc'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-remove-runtime-reply-text-heuristics.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-deterministic-support-emotion-renderer.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Production Slack smoke shows that the migration now classifies terse acknowledgements correctly, but the Python renderer still sends them through the LLM path. That lets simple acknowledgement turns produce coaching language or extra continuation such as “держимся короткого шага,” which is exactly the AI-like drift the old typed reply plan was supposed to prevent.

**Approach:** Add a deterministic acknowledgement renderer selected only from the typed `replyPlan`: `dialogueAct='acknowledgement'`, `responseMove='continue_existing_thread'`, `questionPolicy.maxQuestions=0`, and no `latestUserSubstance`. This keeps the reply-plan contract as the decision boundary and removes model variance for no-substance backchannels without adding phrase or language heuristics.

## Boundaries & Constraints

**Always:** Choose the renderer strictly from typed `replyPlan` fields. Preserve existing deterministic social and support-emotion behavior, LLM rendering for substantive continuation/request flows, safety gateway inspection, runtime diagnostics, and schema validation. Keep the Russian Slack smoke reply short and conversational.

**Ask First:** Changing classifier labels, changing the `ReplyPlan` public contract, suppressing outbound replies entirely, changing Slack delivery behavior, or broadening deterministic rendering to `continuation` / `new_substance`.

**Never:** Do not add text checks for words like “понял,” “ок,” or generated model phrases. Do not post-process LLM output, add regex retry gates, or infer intent from raw message brevity in Python.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Plain acknowledgement | `replyPlan.dialogueAct='acknowledgement'`, `responseMove='continue_existing_thread'`, `maxQuestions=0`, `latestUserSubstance=null` | Return a short deterministic acknowledgement; no model call, no question, no advice | Existing unsafe-text validation still inspects deterministic output |
| Acknowledgement with substance | Same move but `latestUserSubstance` is present | Keep LLM path so the agent can address actual substance | Existing typed question retry applies |
| Continuation, not acknowledgement | `dialogueAct='continuation'` or another non-ack act | Keep LLM path | Existing model safety and retry rules apply |
| Explicitly allowed question | Acknowledgement plan with `maxQuestions=1` | Keep LLM path | Existing typed question policy applies |

</frozen-after-approval>

## Code Map

- `agent-service/src/agent_service/workflows/model_provider.py` -- Python MAF renderer selection, deterministic renderer helpers, and replyPlan field extraction.
- `agent-service/tests/unit/test_model_provider.py` -- Model-client tests that can assert deterministic renderer path and zero chat calls.
- `agent-service/tests/unit/test_conversation_workflow.py` -- Workflow diagnostics tests that verify production-visible renderer/model-call metadata.
- `packages/contracts/src/runtime-contract.ts` -- Runtime diagnostics enum for allowed `replyRenderer` values.
- `packages/contracts/runtime/openapi.json` -- Canonical runtime OpenAPI schema.
- `agent-service/src/agent_service/contracts/openapi.json` -- Embedded Python copy of the runtime schema.
- `packages/contracts/src/runtime-contract.test.ts` -- Contract coverage for diagnostics enum/schema compatibility.

## Tasks & Acceptance

**Execution:**
- [x] `agent-service/src/agent_service/workflows/model_provider.py` -- Add deterministic acknowledgement renderer selected after social/support renderers or at the same typed-plan decision layer -- Removes LLM variance for no-substance acknowledgement turns.
- [x] `agent-service/src/agent_service/workflows/model_provider.py` -- Report a distinct renderer path, e.g. `deterministic_acknowledgement_reply` -- Makes production Slack metadata auditable.
- [x] `agent-service/tests/unit/test_model_provider.py` -- Add no-chat-call coverage for typed acknowledgement/no-question/no-substance -- Locks the renderer contract.
- [x] `agent-service/tests/unit/test_conversation_workflow.py` -- Add workflow diagnostics coverage for renderer path and `modelCalls=0` -- Confirms the full MAF response reports the path.
- [x] `packages/contracts/src/runtime-contract.ts`, `packages/contracts/runtime/openapi.json`, `agent-service/src/agent_service/contracts/openapi.json`, and `packages/contracts/src/runtime-contract.test.ts` -- Extend diagnostics schema -- Keeps TS/Python boundary validation compatible.

**Acceptance Criteria:**
- Given the production-smoke shape `acknowledgement + continue_existing_thread + maxQuestions=0 + latestUserSubstance=null`, when Python MAF generates a candidate reply, then it returns a deterministic short acknowledgement, calls the chat model zero times, and reports `deterministic_acknowledgement_reply`.
- Given `acknowledgement` with non-null `latestUserSubstance`, when Python MAF generates a candidate reply, then it continues through the LLM path and can address the substance within typed policy.
- Given any non-acknowledgement response move, when Python MAF generates a candidate reply, then this deterministic renderer is not used.

## Spec Change Log

## Review Triage

**Patch findings fixed:**
- Edge Case Hunter found that acknowledgement plans with non-empty `requiredGrounding` could drop required typed grounding by returning only `Понял.`. Fixed by requiring `requiredGrounding=[]` before deterministic acknowledgement rendering.
- Edge Case Hunter found that missing or malformed `latestUserSubstance` could be treated like explicit `null`. Fixed by requiring the key to be present and explicitly null before deterministic acknowledgement rendering.
- Edge Case Hunter found that `mayInferFromBrevity=true` could still take the deterministic path. Fixed by requiring `mayInferFromBrevity=false`.

**Deferred findings:** none.

## Design Notes

This is not a heuristic because the renderer does not inspect raw user text. The semantic decision has already happened upstream in the typed reply plan. A no-substance acknowledgement is a closed conversational move; letting the LLM invent extra coaching content expands the move beyond the plan.

Target shape for the current Russian Slack smoke:

```text
Понял.
```

## Verification

**Commands:**
- `cd agent-service && .venv/bin/python -m pytest tests/unit/test_model_provider.py tests/unit/test_conversation_workflow.py` -- passed, 55 tests.
- `cd agent-service && .venv/bin/python -m ruff check src/agent_service/workflows/model_provider.py tests/unit/test_model_provider.py tests/unit/test_conversation_workflow.py` -- passed.
- `pnpm --filter @entalent/contracts test -- runtime-contract.test.ts` -- passed, 81 tests plus Python fixture validation.
- `pnpm --filter @entalent/contracts typecheck` -- passed.
- `pnpm --filter @entalent/contracts lint` -- passed.
- `git diff --check` -- passed.
- Production Slack smoke after deploy: `понял` returns short deterministic acknowledgement with `replyRenderer=deterministic_acknowledgement_reply`, `modelCalls=0`, `runtimeMode=maf_primary`, `phase=reply_committed`, and no `failure_reason`.

## Suggested Review Order

**Renderer Decision**

- Entry point routes typed acknowledgement before LLM generation.
  [`model_provider.py:711`](../../../agent-service/src/agent_service/workflows/model_provider.py#L711)

- Typed gate keeps only plain no-substance acknowledgements deterministic.
  [`model_provider.py:740`](../../../agent-service/src/agent_service/workflows/model_provider.py#L740)

- Explicit null check prevents schema drift from suppressing substance.
  [`model_provider.py:788`](../../../agent-service/src/agent_service/workflows/model_provider.py#L788)

- Empty grounding guard preserves required typed grounding on LLM path.
  [`model_provider.py:817`](../../../agent-service/src/agent_service/workflows/model_provider.py#L817)

**Contract Boundary**

- Runtime diagnostics enum accepts the new renderer path.
  [`runtime-contract.ts:315`](../../../packages/contracts/src/runtime-contract.ts#L315)

- Contract test proves OpenAPI validation accepts the renderer.
  [`runtime-contract.test.ts:232`](../../../packages/contracts/src/runtime-contract.test.ts#L232)

**Regression Coverage**

- Model-client test locks zero-call deterministic acknowledgement.
  [`test_model_provider.py:275`](../../../agent-service/tests/unit/test_model_provider.py#L275)

- Edge-case table keeps non-plain acknowledgements on LLM path.
  [`test_model_provider.py:347`](../../../agent-service/tests/unit/test_model_provider.py#L347)

- Workflow test verifies production-visible diagnostics.
  [`test_conversation_workflow.py:329`](../../../agent-service/tests/unit/test_conversation_workflow.py#L329)

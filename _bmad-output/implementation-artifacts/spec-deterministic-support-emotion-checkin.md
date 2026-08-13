---
title: 'Deterministic Support Emotion Check-In'
type: 'bugfix'
created: '2026-08-13T00:00:00+02:00'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: '08c9d1fd3d6c5ac067f62c1b8d49100e41077dbb'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** After the MAF migration, emotional disclosure replies that are allowed to ask one question still go through the LLM path and can become AI-like: reflective openers, small coaching prescriptions, and broad therapeutic probes. The no-question emotional support path is already deterministic, but `support_emotion + maxQuestions=1` still has model variance.

**Approach:** Extend the existing deterministic support-emotion renderer to cover the typed check-in case without text heuristics. The renderer may ask one short, plain question only when the reply plan says this is an emotional disclosure, the response move is `support_emotion`, one question is allowed, action plans and survey probes are forbidden, and no required grounding must be rendered.

## Boundaries & Constraints

**Always:** Use only structured `replyPlan` / `replyPolicy` fields as gates. Preserve the existing no-question deterministic support behavior. Keep the output short, plain prose, and within explicit `replyPolicy.maxChars` when present. Add tests that prove the one-question path avoids an LLM call and that survey-probe or grounding obligations stay on the LLM path.

**Ask First:** Any change that alters proactive cadence, survey probe selection, classifier behavior, risk handling, or storage schema requires explicit human approval.

**Never:** Do not add regex checks or banned-phrase filters for generated text. Do not inspect raw user text to decide renderer eligibility. Do not make all emotional disclosures questionless. Do not route support-emotion turns with required grounding or allowed survey probes into a generic deterministic reply.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Typed support check-in | `replyPlan.dialogueAct=emotional_disclosure`, `responseMove=support_emotion`, `questionPolicy.maxQuestions=1`, `forbiddenMoves` contains `action_plan` and `survey_probe`, `requiredGrounding=[]` | Return a deterministic short support reply with exactly one question and `replyRenderer=deterministic_support_emotion_reply`; do not call the model | If explicit `maxChars` is too small, fall back to LLM |
| Survey probe allowed | Same support emotion state, but `survey_probe` is not forbidden | Keep LLM path so a planned pulse probe can be asked naturally | Existing prompt/retry gates still enforce max one question |
| Required grounding present | Same support emotion state, but `requiredGrounding` is non-empty | Keep LLM path so required memory grounding can be rendered or rejected contextually | Existing safety gateway and prompt constraints apply |

</frozen-after-approval>

## Code Map

- `agent-service/src/agent_service/workflows/model_provider.py` -- owns deterministic reply renderer selection, support-emotion renderer gates, and LLM fallback.
- `agent-service/tests/unit/test_model_provider.py` -- covers model-provider renderer behavior and model-call counts.
- `agent-service/tests/unit/test_conversation_workflow.py` -- covers workflow diagnostics for renderer selection.

## Tasks & Acceptance

**Execution:**
- [x] `agent-service/src/agent_service/workflows/model_provider.py` -- extend `deterministic_support_emotion_reply_for_plan` to render the typed one-question support check-in when safe, while preserving existing no-question behavior.
- [x] `agent-service/tests/unit/test_model_provider.py` -- replace the old expectation that allowed-question support emotion stays on LLM path with deterministic coverage, and add edge-case coverage for survey-probe-allowed and required-grounding fallback.
- [x] `agent-service/tests/unit/test_conversation_workflow.py` -- add or update workflow diagnostics coverage so the typed one-question case reports `deterministic_support_emotion_reply`.

**Acceptance Criteria:**
- Given a typed support-emotion plan with one allowed question, forbidden `action_plan`, forbidden `survey_probe`, and empty required grounding, when the Python model provider generates a reply, then it returns a deterministic short acknowledgement plus one question and makes zero chat model calls.
- Given a typed support-emotion plan where survey probing is allowed, when the provider generates a reply, then it keeps the LLM path and still enforces the max-question policy.
- Given a typed support-emotion plan with required grounding, when the provider generates a reply, then it keeps the LLM path instead of dropping grounding silently.
- Given an explicit `replyPolicy.maxChars` shorter than the deterministic question reply, when the provider generates a reply, then it falls back to the LLM path.

## Design Notes

This is a typed policy fix, not a language filter. The production-bad example was not that the generated text contained a specific forbidden phrase; it was that a known reply-plan state delegated a small stable conversational move to the LLM. The stable move should be deterministic:

```text
Да, тяжелый момент. Что сейчас сильнее всего давит?
```

The renderer must not handle cases where a real survey probe is available or required memory grounding exists, because those cases need contextual generation. That preserves pulse-insight behavior where a planned probe exists, while removing variance from the generic emotional check-in state.

## Verification

**Commands:**
- `cd agent-service && .venv/bin/python -m pytest tests/unit/test_model_provider.py tests/unit/test_conversation_workflow.py` -- expected: all focused Python tests pass.
- `cd agent-service && .venv/bin/ruff check src/agent_service/workflows/model_provider.py tests/unit/test_model_provider.py tests/unit/test_conversation_workflow.py` -- expected: no lint findings.

## Suggested Review Order

**Renderer Contract**

- Entry point: typed support-emotion state chooses deterministic no-question or check-in output.
  [`model_provider.py:730`](../../agent-service/src/agent_service/workflows/model_provider.py#L730)

- Runtime reply policy wins over reply plan when question limits conflict.
  [`model_provider.py:624`](../../agent-service/src/agent_service/workflows/model_provider.py#L624)

**Provider Coverage**

- Happy path proves one-question support check-in bypasses the model.
  [`test_model_provider.py:800`](../../agent-service/tests/unit/test_model_provider.py#L800)

- Review regression proves zero-question runtime policy cannot be bypassed.
  [`test_model_provider.py:836`](../../agent-service/tests/unit/test_model_provider.py#L836)

- Survey and grounding cases stay on LLM path.
  [`test_model_provider.py:879`](../../agent-service/tests/unit/test_model_provider.py#L879)

**Workflow Diagnostics**

- End-to-end workflow reports deterministic renderer for the production-like tone case.
  [`test_conversation_workflow.py:329`](../../agent-service/tests/unit/test_conversation_workflow.py#L329)

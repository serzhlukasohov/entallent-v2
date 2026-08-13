---
title: 'Deterministic Support Grounding Rendering'
type: 'bugfix'
created: '2026-08-13'
status: 'done'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-deterministic-support-emotion-renderer.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** Production Slack smoke proved the deterministic support-emotion renderer can leak raw `requiredGrounding.content` into user-facing text, producing mixed-language/internal phrasing such as "на фоне The employee said...". That fixes model variance but still breaks tone.

**Approach:** Keep deterministic no-question support replies ungrounded until the runtime contract exposes a typed, localized, user-facing grounding phrase. The renderer should still be selected from `replyPlan`, still report `deterministic_support_emotion_reply`, and still preserve safety checks.

## Boundaries & Constraints

**Always:** Choose the deterministic path only from typed `replyPlan` fields. Keep zero model calls for the no-question support-emotion case. Keep `requiredGrounding` in the plan and diagnostics unchanged for future LLM/rendering work.

**Ask First:** Adding new runtime contract fields for localized grounding, translating memory content, changing classifier labels, or broadening deterministic rendering beyond the current support-emotion path.

**Never:** Do not inspect raw user text, regex-match language, post-process generated text, or add phrase gates. Do not drop safety inspection or change request/advice flows.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Support emotion with internal grounding | `responseMove='support_emotion'`, `dialogueAct='emotional_disclosure'`, `maxQuestions=0`, `requiredGrounding.content='The employee said...'` | Return the base short support reply without inserting grounding; zero model calls | Existing output safety gateway still applies |
| Support emotion without grounding | Same typed plan with empty `requiredGrounding` | Same base support reply as before | Existing max-char guard still applies |
| Non-deterministic support | `maxQuestions=1` or explicit request/advice flow | Keep LLM path | Existing typed retry/safety rules apply |

</frozen-after-approval>

## Code Map

- `agent-service/src/agent_service/workflows/model_provider.py` -- Deterministic support-emotion renderer.
- `agent-service/tests/unit/test_model_provider.py` -- Unit coverage for renderer output and model-call count.
- `agent-service/tests/unit/test_conversation_workflow.py` -- Workflow diagnostics coverage for production-visible renderer metadata.

## Tasks & Acceptance

**Execution:**
- [x] `agent-service/src/agent_service/workflows/model_provider.py` -- Stop interpolating `requiredGrounding.content` in deterministic support replies -- Avoids leaking internal/unlocalized memory summaries into Slack.
- [x] `agent-service/tests/unit/test_model_provider.py` -- Update grounding coverage to assert base support reply and zero model calls -- Locks the new contract without language heuristics.
- [x] `agent-service/tests/unit/test_conversation_workflow.py` -- Add workflow coverage with internal English grounding -- Protects production-visible behavior.

**Acceptance Criteria:**
- Given a typed no-question support-emotion plan with internal grounding, when Python MAF renders the reply, then it returns the base deterministic support text, calls the model zero times, and reports `deterministic_support_emotion_reply`.
- Given support emotion where a question is allowed, when Python MAF renders the reply, then it still uses the LLM path.

## Design Notes

The runtime currently has semantic grounding, not renderable grounding. A deterministic Russian sentence cannot safely verbalize arbitrary memory summaries without either translation, morphology, or a dedicated user-facing phrase contract. Omitting grounding in this narrow deterministic path is the conservative architecture: the plan still carries the grounding for future richer renderers, but this renderer only says what it can say reliably.

## Verification

**Commands:**
- `cd agent-service && .venv/bin/python -m pytest tests/unit/test_model_provider.py tests/unit/test_conversation_workflow.py` -- passed, 48 tests.
- `cd agent-service && .venv/bin/python -m ruff check src/agent_service/workflows/model_provider.py tests/unit/test_model_provider.py tests/unit/test_conversation_workflow.py` -- passed.
- `git diff --check` -- passed.

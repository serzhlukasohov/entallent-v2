---
title: 'Deterministic Support Check-In Grounding Fallback'
type: 'bugfix'
created: '2026-08-13T00:00:00+02:00'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: '4d59c22c5645e8a75ee1d06342fef2678cd2cf3f'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** The previous deterministic support check-in fix works only when `requiredGrounding=[]`. In production Slack, an old memory anchor can create required grounding that is unsafe or not naturally renderable, pushing the same generic emotional check-in back to LLM and reintroducing AI-like tone.

**Approach:** Keep the Python renderer typed-gated and fix the TypeScript reply planner so generic emotional check-ins without a current `topicAnchor` do not mark memory grounding as required. Preserve required grounding for anchored emotional support, where memory recall is explicitly relevant.

## Boundaries & Constraints

**Always:** Use only structured `replyPlan` fields. Preserve survey-probe fallback. Preserve anchored emotional support grounding behavior. Respect `replyPolicy.maxQuestions` and `replyPolicy.maxChars`.

**Ask First:** Any change to memory selection, grounding priority, classifier output, survey probe policy, or Slack ingestion requires human approval.

**Never:** Do not inspect raw user text. Do not add generated-text phrase filters. Do not add memory-content renderability heuristics in Python.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Generic emotional check-in with memory | TypeScript builds `replyPlan` for `emotional_disclosure`, memory anchors exist, and `topicAnchor=null` | `requiredGrounding=[]`; Python deterministic support check-in can run without model call | If survey probe is allowed, keep LLM path |
| Anchored emotional support with memory | TypeScript builds `replyPlan` for `emotional_disclosure`, memory anchors exist, and `topicAnchor` is present | `requiredGrounding` keeps the selected memory anchor | Existing LLM grounding path applies when a question is allowed |
| Survey probe allowed | Same state, but `survey_probe` is not forbidden | Keep LLM path | Existing question policy applies |

</frozen-after-approval>

## Code Map

- `packages/application/src/utils/reply-plan.ts` -- owns required grounding policy derived from typed response move and question policy.
- `packages/application/src/utils/reply-plan.test.ts` -- covers reply-plan grounding behavior for emotional support.
- `agent-service/src/agent_service/workflows/model_provider.py` -- owns support-emotion deterministic gates.
- `agent-service/tests/unit/test_model_provider.py` -- covers provider-level renderer selection, grounding fallback, and model-call counts.

## Tasks & Acceptance

**Execution:**
- [x] `packages/application/src/utils/reply-plan.ts` -- derive required grounding from typed `topicAnchor` and omit required grounding for generic unanchored emotional check-ins.
- [x] `packages/application/src/utils/reply-plan.test.ts` -- cover memory anchors without required grounding for unanchored emotional check-ins and preserve required grounding for anchored emotional support.
- [x] `agent-service/src/agent_service/workflows/model_provider.py` -- keep deterministic support check-in gates typed-only and unchanged for direct required-grounding fallback.
- [x] `agent-service/tests/unit/test_model_provider.py` -- preserve provider coverage for direct required-grounding LLM fallback.

**Acceptance Criteria:**
- Given TypeScript builds support emotion with existing memory anchors and no `topicAnchor`, when it creates `replyPlan`, then `requiredGrounding` is empty and memory remains available only as non-required context.
- Given TypeScript builds support emotion with existing memory anchors and a `topicAnchor`, when it creates `replyPlan`, then `requiredGrounding` keeps the selected anchor.
- Given Python receives one-question support emotion with direct required grounding, when generating a reply, then the provider keeps the LLM path.
- Given one-question support emotion with survey probing allowed, when generating a reply, then the provider keeps the LLM path.

## Verification

**Commands:**
- `cd agent-service && .venv/bin/python -m pytest tests/unit/test_model_provider.py tests/unit/test_conversation_workflow.py` -- expected: all focused Python tests pass.
- `cd agent-service && .venv/bin/ruff check src/agent_service/workflows/model_provider.py tests/unit/test_model_provider.py tests/unit/test_conversation_workflow.py` -- expected: no lint findings.
- `pnpm --filter @entalent/application test -- reply-plan.test.ts` -- expected: reply-plan tests pass.
- `pnpm --filter @entalent/application typecheck && pnpm --filter @entalent/application lint` -- expected: no TS type or lint findings.
- `pnpm --filter @entalent/conversation-sim exec vitest run src/scenarios/memory-recall.sim.test.ts` -- expected: targeted memory recall passes when external model access is explicitly approved.

## Suggested Review Order

**Reply Plan Policy**

- Entry point: required grounding now depends on typed topic anchoring.
  [`reply-plan.ts:39`](../../packages/application/src/utils/reply-plan.ts#L39)

- Grounding remains strict for anchored emotional support only.
  [`reply-plan.ts:113`](../../packages/application/src/utils/reply-plan.ts#L113)

**Regression Coverage**

- Generic unanchored emotional check-ins keep memory contextual, not mandatory.
  [`reply-plan.test.ts:108`](../../packages/application/src/utils/reply-plan.test.ts#L108)

- Anchored emotional support still requires the selected memory anchor.
  [`reply-plan.test.ts:136`](../../packages/application/src/utils/reply-plan.test.ts#L136)

---
title: 'Emotional Disclosure Tone Contract'
type: 'bugfix'
created: '2026-08-13'
status: 'done'
baseline_commit: 'b35ac693116dcb8da6bebfe58eee10cdb51238ba'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-maf-conversation-tone-and-proactive-cadence.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-remove-runtime-reply-text-heuristics.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After removing runtime text heuristics, the MAF path still produces some AI-like emotional-disclosure replies: formulaic openers such as "Похоже..." and unsolicited soft advice like "Можно..." show up when the user only shares a state. This should be solved in the typed reply-plan/prompt contract, not by adding phrase-based runtime filters.

**Approach:** Make `responseMove=support_emotion` carry a stronger conversation contract: acknowledge the state plainly, do not open by labeling the user's words, do not prescribe even small tactics unless asked, and keep questions governed only by typed `questionPolicy`. Apply the same principle to Python MAF prompt guidance and the TypeScript OpenAI prompt path for contract parity.

## Boundaries & Constraints

**Always:** Preserve safety checks, typed runtime boundary validation, deterministic social replies, and current `replyPlan` / `replyPolicy` ownership. Keep the answer style natural Russian/English as prompted; tests should assert contract guidance, not ban arbitrary phrases as runtime gates.

**Ask First:** Changing classifier labels, adding new contract enum fields, broad rewrites of `ReplyPlan`, production flag changes, or reintroducing model-output regex regeneration.

**Never:** Do not add phrase-based gates, regex retry rules, output post-processing, or hardcoded canned replies for emotional disclosures. Do not weaken support for legitimate advice when the employee explicitly asks for help.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Emotional state, no advice request | `dialogueAct='emotional_disclosure'`, `responseMove='support_emotion'`, user says they are tired / cannot focus | Prompt contract asks for plain presence, no verdict-on-their-words opener, no tactic/prescription, no "try/do" framing unless asked | Existing model retry only enforces typed length/question/list policy |
| Emotional state with no-question policy | `replyPlan.questionPolicy.maxQuestions=0` | Prompt explicitly leaves room without a question and without replacing the question with advice | Existing typed question retry still applies if model asks a question |
| Emotional support with memory grounding | `responseMove='support_emotion'` and `requiredGrounding` exists | Prompt may use the memory concretely, but still avoids diagnosing, coaching, or turning the reply into an action plan | Unsafe/secret context filters remain unchanged |
| Direct advice request | User explicitly asks for advice/help and classifier/strategy allows answer/request behavior | This spec does not block useful advice; support-emotion no-advice guidance applies only to unrequested advice | No new classifier changes in this slice |

</frozen-after-approval>

## Code Map

- `agent-service/src/agent_service/workflows/model_provider.py` -- Python MAF candidate prompt and `emotional_disclosure` dialogue policy.
- `agent-service/tests/unit/test_model_provider_prompt.py` -- Prompt-level regression coverage for Python MAF guidance.
- `packages/ai-openai/src/prompts/respond.ts` -- TypeScript OpenAI prompt builder and typed `replyPlan` block.
- `packages/ai-openai/src/prompts/respond.test.ts` -- Prompt-level regression coverage for TS reply-plan guidance.

## Tasks & Acceptance

**Execution:**
- [x] `agent-service/src/agent_service/workflows/model_provider.py` -- Strengthen `emotional_disclosure` guidance into support-without-advice contract -- Keeps MAF replies present without coaching.
- [x] `agent-service/tests/unit/test_model_provider_prompt.py` -- Add/adjust assertions for no verdict opener and no unsolicited tactics in emotional disclosure prompt -- Locks the Python contract without runtime regex gates.
- [x] `packages/ai-openai/src/prompts/respond.ts` -- Add a `support_emotion` typed reply-plan contract to the TS prompt block -- Keeps legacy/fallback prompt behavior aligned with MAF.
- [x] `packages/ai-openai/src/prompts/respond.test.ts` -- Add coverage for `support_emotion` plan guidance with `maxQuestions=0` and required grounding -- Locks parity with the typed plan path.

**Acceptance Criteria:**
- Given a Python MAF prompt for emotional disclosure without advice request, when the prompt is built, then it says to support without coaching/advice/tactics and to avoid opening by labeling the user's state.
- Given a TS `replyPlan` with `responseMove='support_emotion'`, when the system prompt is built, then it includes a support-emotion contract that prefers plain presence and forbids unsolicited tactics/action plans.
- Given a typed no-question emotional disclosure plan, when the prompt is built, then the prompt keeps zero-question policy and does not substitute a question with a task or recommendation.

## Spec Change Log

## Design Notes

The expected behavior is not "ban the word Похоже" globally. The contract-level issue is the reply move: for an emotional disclosure without an advice request, the agent should not lead with a verdict about the user's state and should not pivot into micro-coaching. A good target shape is one or two plain sentences that sit with the state:

```text
Да, тяжелый момент. Жаль, что сейчас так давит.
```

The model can still name nuance when it is woven naturally into the reply, and can still give advice in request/answer flows. This slice only narrows `support_emotion`.

## Verification

**Commands:**
- `cd agent-service && .venv/bin/python -m pytest tests/unit/test_model_provider_prompt.py` -- passed, 12 tests.
- `cd agent-service && .venv/bin/python -m ruff check src/agent_service/workflows/model_provider.py tests/unit/test_model_provider_prompt.py` -- passed.
- `pnpm --filter @entalent/ai-openai test -- respond.test.ts` -- passed, 15 tests.
- `pnpm --filter @entalent/ai-openai typecheck` -- passed.
- `pnpm --filter @entalent/ai-openai lint` -- passed.
- `git diff --check` -- passed.

## Review Triage

**Patch findings fixed:**
- Python MAF initially attached emotional-disclosure guidance only through classification. It now also applies the support-emotion dialogue policy when the typed `replyPlan.responseMove` is `support_emotion`, preserving behavior when classification is absent.
- Python MAF question constraints initially derived the question allowance from inferred gate policy. They now prefer explicit typed `replyPlan.questionPolicy.maxQuestions` and include that policy in the plan summary.
- TS support-emotion guidance initially left a path for unsolicited advice. It now treats `support_emotion` as plain emotional presence and does not allow tactical/action-plan advice when the typed plan forbids it.
- TS global persona guidance could undercut the support-emotion contract. The support-emotion block now explicitly overrides persona invitations to name subtext, push back, or offer a different angle for this response move.

**Deferred findings:** none.

## Suggested Review Order

**Reply-Plan Contract**

- Entry point: typed support-emotion plan now drives MAF emotional policy.
  [`model_provider.py:423`](../../agent-service/src/agent_service/workflows/model_provider.py#L423)

- Central policy encodes presence without coaching or prescribed tactics.
  [`model_provider.py:458`](../../agent-service/src/agent_service/workflows/model_provider.py#L458)

- Question limits now prefer typed replyPlan over inferred gates.
  [`model_provider.py:393`](../../agent-service/src/agent_service/workflows/model_provider.py#L393)

**TypeScript Parity**

- TS prompt adds the same support-emotion contract to replyPlan rendering.
  [`respond.ts:169`](../../packages/ai-openai/src/prompts/respond.ts#L169)

**Regression Coverage**

- Python tests lock support-emotion behavior without classification fallback.
  [`test_model_provider_prompt.py:247`](../../agent-service/tests/unit/test_model_provider_prompt.py#L247)

- TS tests lock no-question support and persona override behavior.
  [`respond.test.ts:158`](../../packages/ai-openai/src/prompts/respond.test.ts#L158)

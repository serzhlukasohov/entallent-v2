---
title: 'Contextual support emotion renderer'
type: 'bugfix'
created: '2026-08-15'
status: 'done'
baseline_commit: '0654855'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-english-only-engaged-current-conversation.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Slack mentor now stays English-only, but multi-turn emotional support can still feel too generic because the deterministic support-emotion renderer returns fixed phrases such as "That is a heavy moment" even when the user gives concrete context, asks for help with guilt, or says the previous reply was too generic. This makes the mentor feel scripted instead of like the companion behavior we are trying to test.

**Approach:** Keep deterministic support only for tiny, highly constrained cases where the reply policy leaves no room for contextual language, and route richer emotional turns back to the existing LLM path with stronger prompt guidance against generic support phrases. Preserve the English-only guard and current-conversation memory scoping from the previous fix.

## Boundaries & Constraints

**Always:** All changed repository artifacts must remain English-only. Slack mentor output must remain English-only. The mentor must answer the user's actual emotional meaning when concrete context is present, especially guilt, letting the team down, blocked teammates, pushback that a reply was too generic, or requests to draft wording. Deterministic support may only cover narrow fallback cases where using the model would violate explicit max-character or no-question constraints.

**Ask First:** Changing persisted schemas, changing Slack delivery semantics, disabling MAF primary, adding dependencies, changing language detection strategy, or clearing production data.

**Never:** Do not add Russian or Ukrainian strings to code, tests, docs, or fixtures. Do not add broad sentiment taxonomies, a second prompt stack, or a new planner. Do not remove the acknowledgement or social deterministic renderers. Do not weaken the existing English-only and current-conversation leakage protections.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Contextual guilt | User says they feel like they are letting the team down after discussing team feedback | Reply addresses guilt/team responsibility specifically and offers one concrete reframing or next step | Must not use a stock "heavy moment" phrase |
| Generic pushback | User says the previous reply was too generic | Reply acknowledges the correction and becomes more specific to the user's stated concern | Must not repeat the same deterministic support template |
| Tiny constrained support | Reply policy allows very few characters or zero questions and no safe model response fits | Deterministic fallback may return a short English support phrase | Must still obey maxChars and maxQuestions |
| Simple fatigue check-in | User gives a short fatigue disclosure with no extra context | Reply may use a concise support frame or model path, but must include a useful next conversational move | No empathy-only dead end |

</frozen-after-approval>

## Code Map

- `agent-service/src/agent_service/workflows/model_provider.py` -- Builds the live MAF prompt, deterministic renderer selection, policy retry handling, English-only guard, and support-emotion fallback.
- `agent-service/tests/unit/test_model_provider_prompt.py` -- Prompt-level regression coverage for generic phrase bans and contextual emotional support instructions.
- `agent-service/tests/unit/test_model_provider.py` -- Model-provider behavior tests for deterministic support eligibility, LLM fallback routing, and retry policy.
- `agent-service/tests/unit/test_conversation_workflow.py` -- Workflow-level regression coverage for social/support reply renderer diagnostics.

## Tasks & Acceptance

**Execution:**
- [x] `agent-service/src/agent_service/workflows/model_provider.py` -- Narrow deterministic support-emotion eligibility so concrete or corrective emotional turns go through the model path -- Prevents scripted replies in multi-turn companion conversations.
- [x] `agent-service/src/agent_service/workflows/model_provider.py` -- Strengthen support-emotion prompt guidance against stock "heavy moment" replies when concrete context exists -- Keeps model-path replies specific without adding another prompt stack.
- [x] `agent-service/tests/unit/test_model_provider.py` -- Add behavior tests for guilt/team-context and "too generic" pushback routing to the model path -- Locks the production regression found in Slack.
- [x] `agent-service/tests/unit/test_model_provider_prompt.py` or `agent-service/tests/unit/test_conversation_workflow.py` -- Add the smallest prompt/workflow assertion needed for contextual support behavior -- Covers the prompt contract without duplicating all behavior tests.

**Acceptance Criteria:**
- Given a user says they feel guilty or are letting the team down, when the mentor replies, then the response is model-generated or otherwise context-specific and does not use the deterministic "heavy moment" template.
- Given a user says the prior reply was too generic, when the mentor replies, then deterministic support-emotion rendering is bypassed and the model receives guidance to answer the specific correction.
- Given a tiny maxChars or zero-question support case that cannot safely use model output, when deterministic fallback is used, then it remains English-only and obeys reply limits.
- Given the previous English-only and current-conversation tests, when the suite runs, then those protections still pass.

## Spec Change Log

- Review finding: Contextual support could still hit deterministic fallback when `maxChars <= 70`. Added a model-path predicate for concrete guilt, team-feedback, responsibility, and generic-pushback context.
- Review finding: Tiny constrained support fallback was not available after a model retry violation. Moved support deterministic rendering out of the early renderer and made it available only as retry-failure fallback, with compact replies for tight limits.

## Design Notes

The lazy fix is to make the existing deterministic support renderer less eager, not to invent a new response planner. Let the LLM handle context-rich emotional conversation; keep deterministic rendering only as a narrow safety fallback.

## Verification

**Commands:**
- `agent-service/.venv/bin/python -m pytest agent-service/tests/unit/test_model_provider_prompt.py agent-service/tests/unit/test_model_provider.py agent-service/tests/unit/test_conversation_workflow.py -q` -- passed: 82 tests.
- `RUFF_CACHE_DIR=/tmp/entalent-ruff-cache agent-service/.venv/bin/python -m ruff check agent-service/src/agent_service/workflows/model_provider.py agent-service/tests/unit/test_model_provider_prompt.py agent-service/tests/unit/test_model_provider.py agent-service/tests/unit/test_conversation_workflow.py` -- passed.
- `perl -ne 'print "$ARGV:$.:$_" if /\p{Script=Cyrillic}/' agent-service/src/agent_service/workflows/model_provider.py agent-service/tests/unit/test_model_provider_prompt.py agent-service/tests/unit/test_model_provider.py agent-service/tests/unit/test_conversation_workflow.py _bmad-output/implementation-artifacts/spec-contextual-support-emotion-renderer.md` -- passed: no matches.

## Suggested Review Order

**Renderer Routing**

- Retry fallback now tries support fallback after model policy violations.
  [`model_provider.py:210`](../../agent-service/src/agent_service/workflows/model_provider.py#L210)

- Early deterministic rendering no longer handles support emotion.
  [`model_provider.py:808`](../../agent-service/src/agent_service/workflows/model_provider.py#L808)

- Tight support fallback is gated to explicit small character policies.
  [`model_provider.py:820`](../../agent-service/src/agent_service/workflows/model_provider.py#L820)

**Context Protection**

- Concrete guilt and generic-pushback context forces model routing.
  [`model_provider.py:860`](../../agent-service/src/agent_service/workflows/model_provider.py#L860)

- Compact fallback preserves tiny constrained support after retry failure.
  [`model_provider.py:898`](../../agent-service/src/agent_service/workflows/model_provider.py#L898)

- Prompt guidance bans stock support phrases for concrete context.
  [`model_provider.py:530`](../../agent-service/src/agent_service/workflows/model_provider.py#L530)

**Regression Coverage**

- Guilt/team context stays on the model path under tight policy.
  [`test_model_provider.py:675`](../../agent-service/tests/unit/test_model_provider.py#L675)

- Generic-reply pushback stays on the model path under tight policy.
  [`test_model_provider.py:724`](../../agent-service/tests/unit/test_model_provider.py#L724)

- Tiny retry-failure support uses compact deterministic fallback.
  [`test_model_provider.py:955`](../../agent-service/tests/unit/test_model_provider.py#L955)

- Prompt test locks anti-stock-phrase guidance.
  [`test_model_provider_prompt.py:348`](../../agent-service/tests/unit/test_model_provider_prompt.py#L348)

---
title: 'Remove Runtime Reply Text Heuristics'
type: 'refactor'
created: '2026-08-13'
status: 'done'
baseline_commit: '0fa7220ec1cd3fbe4fd8c1a557ba263b78792f4b'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-maf-conversation-tone-and-proactive-cadence.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-strict-runtime-boundary-request.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** After the MAF migration, reply behavior still has runtime text gates that can override the typed reply plan/policy path. That keeps the agent vulnerable to drift: prose-level patterns, not typed contracts, can decide whether to retry or alter the answer.

**Approach:** Make typed `replyPolicy` / `replyPlan` the only runtime enforcement source for reply-shape checks. Keep regex/text checks only where they are safety, contract validation, legacy no-plan backstops, or eval assertions, not as the primary decision path for typed replies.

## Boundaries & Constraints

**Always:** Preserve safety checks for secrets, prompt leakage, injection markers, and OpenAPI schema validation. Preserve deterministic social replies and diagnostics. Keep TypeScript fallback compatibility where no typed plan exists.

**Ask First:** Removing all legacy TypeScript response gates, deleting simulation/eval assertions, changing production feature flags, or rewriting the classifier.

**Never:** Do not add phrase-based gates for tone. Do not hide MAF failures with TypeScript fallback while primary is selected. Do not weaken typed runtime boundary validation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Typed MAF reply policy | Python receives `context.replyPolicy` | Retry validation enforces only typed policy dimensions such as max chars/questions/list formatting | Violations can trigger the existing single retry |
| No typed reply policy | Python receives no `context.replyPolicy` | Prompt guidance may still describe defaults, but runtime retry does not fire from inferred text gates | Candidate reply returns through existing safety/result validation |
| Typed TS reply plan | TS OpenAI provider has `context.replyPlan` | Reflective-opener regex does not decide retry; typed prompt/plan owns behavior | Length/question policy gates still apply |
| Legacy TS path | TS OpenAI provider has no `replyPlan` | Existing reflective-opener backstop remains available | No contract change |

</frozen-after-approval>

## Code Map

- `agent-service/src/agent_service/workflows/model_provider.py` -- Python MAF reply prompt, typed reply policy extraction, and retry validation.
- `agent-service/tests/unit/test_model_provider_prompt.py` -- Python prompt/policy unit coverage.
- `agent-service/tests/unit/test_conversation_workflow.py` -- Python workflow retry/diagnostics coverage.
- `packages/ai-openai/src/openai-provider.ts` -- Legacy TS response generation and post-generation gates.
- `packages/ai-openai/src/openai-provider.test.ts` -- TS provider retry coverage.

## Tasks & Acceptance

**Execution:**
- [x] `agent-service/src/agent_service/workflows/model_provider.py` -- Split prompt guidance from runtime enforcement so retry checks require explicit `replyPolicy`.
- [x] `agent-service/tests/unit/test_model_provider_prompt.py` -- Add coverage that no-policy requests do not produce reply-policy retry violations.
- [x] `agent-service/tests/unit/test_conversation_workflow.py` -- Add coverage that no-policy workflow does not retry on old text gate patterns.
- [x] `packages/ai-openai/src/openai-provider.ts` -- Skip reflective-opener regex retry when typed `replyPlan` is present.
- [x] `packages/ai-openai/src/openai-provider.test.ts` -- Add coverage for typed-plan no-regex-retry behavior.
- [x] `packages/ai-openai/src/openai-provider.ts` -- Remove reflective-opener runtime retry entirely from the TS provider.
- [x] `packages/ai-openai/src/openai-provider.ts` -- Make TS question retry use typed `replyPlan.questionPolicy` when available.
- [x] `agent-service/src/agent_service/workflows/model_provider.py` -- Enforce typed `replyPlan.questionPolicy.maxQuestions` when `replyPolicy` is absent.

**Acceptance Criteria:**
- Given a Python MAF request without `context.replyPolicy`, when the model returns a reply with list/question formatting, then runtime does not retry based on inferred text policy.
- Given a Python MAF request with `context.replyPolicy`, when the model violates max question/list policy, then the existing single retry still applies.
- Given a TS response with `context.replyPlan`, when the first draft opens with a reflective label, then the provider returns the draft without regex-triggered regeneration.
- Given a TS legacy response without `context.replyPlan`, when the first draft opens with a reflective label, then the provider returns the draft without regex-triggered regeneration.
- Given a TS response with `context.replyPlan.questionPolicy.maxQuestions=1`, when the legacy strategy disallows follow-up questions, then the typed plan still allows one question.
- Given a TS response with `context.replyPlan.questionPolicy.maxQuestions=0`, when the legacy strategy allows follow-up questions, then the typed plan still triggers the existing single no-question retry.
- Given a Python MAF request with `context.replyPlan.questionPolicy.maxQuestions=0` but no `context.replyPolicy`, when the model returns a question, then runtime uses the typed plan to trigger the existing single retry.

## Verification

**Commands:**
- `cd agent-service && .venv/bin/python -m pytest tests/unit/test_model_provider_prompt.py tests/unit/test_conversation_workflow.py` -- passed.
- `cd agent-service && .venv/bin/python -m pytest tests/unit` -- passed, 155 tests.
- `pnpm --filter @entalent/ai-openai test -- openai-provider.test.ts` -- passed.
- `pnpm --filter @entalent/ai-openai test` -- passed, 45 tests.
- `pnpm --filter @entalent/ai-openai typecheck` -- passed.
- `pnpm --filter @entalent/ai-openai lint` -- passed.
- `cd agent-service && .venv/bin/python -m ruff check src/agent_service/workflows/model_provider.py tests/unit/test_model_provider_prompt.py tests/unit/test_conversation_workflow.py` -- passed.
- `git diff --check` -- passed.
- `cd agent-service && .venv/bin/python -m ruff check src tests` -- failed on pre-existing unrelated files: `src/agent_service/api/health.py`, `src/agent_service/tools/context_tool.py`, `tests/conftest.py`, `tests/unit/test_context_tool.py`.

## Review Triage

- `patch`: Blind Hunter found the TS reflective-opener gate still active on no-plan fallback. Fixed by removing runtime opener regeneration from `OpenAiProvider.generateResponse`.
- `patch`: Blind Hunter found TS question retry still owned by legacy strategy even when typed `replyPlan` exists. Fixed by routing question allowance through `replyPlan` / `replyBrief` first.
- `patch`: Edge Case Hunter found Python skipped question enforcement when `replyPlan` exists but `replyPolicy` is omitted. Fixed by using typed `replyPlan.questionPolicy.maxQuestions` as the fallback enforcement source.
- `defer`: Broad classifier/risk/proactive/safety heuristics remain outside this reply-shape runtime-gate slice and need separate architecture stories before removal.

## Suggested Review Order

**Runtime Enforcement**

- Typed policy or typed plan now owns Python reply retries.
  [`model_provider.py:473`](../../../agent-service/src/agent_service/workflows/model_provider.py#L473)

- ReplyPlan question policy covers missing replyPolicy without text heuristics.
  [`model_provider.py:581`](../../../agent-service/src/agent_service/workflows/model_provider.py#L581)

- TS question retry now resolves typed plan before legacy strategy.
  [`openai-provider.ts:104`](../../../packages/ai-openai/src/openai-provider.ts#L104)

- Reflective-opener regeneration is removed from the runtime provider.
  [`openai-provider.ts:234`](../../../packages/ai-openai/src/openai-provider.ts#L234)

**Regression Coverage**

- Python no-policy path no longer retries on old text gate examples.
  [`test_conversation_workflow.py:194`](../../../agent-service/tests/unit/test_conversation_workflow.py#L194)

- Python replyPlan-only no-question enforcement is covered.
  [`test_model_provider_prompt.py:302`](../../../agent-service/tests/unit/test_model_provider_prompt.py#L302)

- TS opener behavior now asserts no runtime regeneration.
  [`openai-provider.test.ts:124`](../../../packages/ai-openai/src/openai-provider.test.ts#L124)

- TS typed plan question ownership is covered both ways.
  [`openai-provider.test.ts:220`](../../../packages/ai-openai/src/openai-provider.test.ts#L220)

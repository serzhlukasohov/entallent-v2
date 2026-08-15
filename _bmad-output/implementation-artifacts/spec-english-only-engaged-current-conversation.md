---
title: 'English-only engaged mentor replies'
type: 'bugfix'
created: '2026-08-15'
status: 'done'
baseline_commit: '14a9cbffeb3bedbd8578771d30d6656c1889b86a'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-deterministic-acknowledgement-renderer.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-maf-conversation-tone-and-proactive-cadence.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Slack mentor can drift into non-English output, produce generic closure replies such as "Understood, I will leave it here" when the user expects continued engagement, and answer "what do you know from this conversation" by mixing current-turn facts with older scheduled reminders or memory. This breaks the product voice, makes the mentor feel passive, and creates a privacy/trust issue around stale context.

**Approach:** Make English-only mentor output an explicit runtime invariant, tighten reply planning so greetings, fatigue, and unclear-topic turns carry a useful next conversational move, and scope "current conversation" self-knowledge answers to recent turns unless the user explicitly asks for broader memory. Keep the fix at the shared prompt/planning/context boundary instead of adding broad post-processing.

## Boundaries & Constraints

**Always:** All repository artifacts changed by this work must be English-only, including prompts, tests, fixtures, regex examples, comments, and documentation. Mentor user-facing Slack output must be English, regardless of the user's input language. Generic acknowledgement or closure may only be used when the user is clearly closing or declining further discussion. If the user describes fatigue, overload, uncertainty, or stuck work, the next reply must include a useful follow-up question, a small next step, or a concise framing choice. When the user asks what the mentor knows "from this conversation", answer only from current recent turns and exclude older memories, goals, scheduled actions, or reminders.

**Ask First:** Changing persisted schemas, deleting or rewriting old user data, changing Slack delivery semantics, disabling MAF primary, or adding a new language detection dependency.

**Never:** Do not add Russian or Ukrainian strings to code/tests/docs. Do not solve language drift with Cyrillic regexes. Do not suppress all memory context globally; durable memory is still valid when the user asks what the mentor knows generally or when the conversation needs continuity. Do not add a second prompt stack or a broad translation service.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Non-English input | User writes in any non-English language | Mentor replies in English only | If the model returns non-English text, retry or fail through the existing safe model-output path |
| Greeting | User opens with a casual greeting or asks how the mentor is | Mentor responds briefly and invites a concrete work-relevant next turn | No generic "I'm fine, and you?" dead end |
| Fatigue disclosure | User says they are tired, overloaded, stuck, or dealing with shifting priorities | Mentor validates briefly and makes the next move with a practical question or first-step frame | No empathy-only dead end |
| Topic closure | User says the topic is done, agreed, or enough | Mentor may close briefly without forcing a question | Must not reuse generic closure while the user is still asking for help |
| Current-conversation self-knowledge | User asks what the mentor knows from this conversation | Reply summarizes only current recent turns | Older scheduled reminders, memory items, or goals are excluded |
| General self-knowledge | User asks what the mentor knows about them generally | Reply may use durable memory, with clear wording that it is broader than the current conversation | Privacy and consent rules still apply |

</frozen-after-approval>

## Code Map

- `agent-service/src/agent_service/workflows/model_provider.py` -- Builds the live MAF model prompt, deterministic renderer selection, retry/safety handling, and reply renderer diagnostics.
- `agent-service/src/agent_service/workflows/conversation_workflow.py` -- Infers dialogue act, latest user substance, topic anchor, and reply metadata used by the model provider.
- `apps/api/src/internal-maf-context/internal-maf-context.service.ts` -- Supplies recent turns, memory, goals, and context to MAF; likely place to add scoped context markers if needed.
- `agent-service/tests/unit/test_model_provider_prompt.py` -- Prompt regression coverage for language, engagement, and scoped self-knowledge instructions.
- `agent-service/tests/unit/test_model_provider.py` -- Model-provider behavior tests for deterministic paths, retries, and output safety.
- `agent-service/tests/unit/test_conversation_workflow.py` -- Full workflow diagnostics and reply-planning coverage.
- `packages/conversation-sim/src/scenarios/` -- End-to-end simulation coverage for English-only output and engaged next-turn behavior if an existing scenario fits.

## Tasks & Acceptance

**Execution:**
- [x] `agent-service/src/agent_service/workflows/model_provider.py` -- Add English-only output and scoped current-conversation self-knowledge instructions to the shared MAF prompt -- Stops language drift and stale-context leakage at the model boundary.
- [x] `agent-service/src/agent_service/workflows/model_provider.py` and/or `agent-service/src/agent_service/workflows/conversation_workflow.py` -- Tighten reply planning for greetings, fatigue, overload, and unclear-topic turns -- Prevents passive generic replies while preserving real closure.
- [x] `agent-service/tests/unit/test_model_provider_prompt.py` -- Add English-only, engaged-next-move, and current-conversation scoping assertions using English-only fixtures -- Locks the prompt contract without non-English strings.
- [x] `agent-service/tests/unit/test_model_provider.py` or `agent-service/tests/unit/test_conversation_workflow.py` -- Add behavioral regression coverage for empathy-plus-next-step and current-conversation-only answers -- Catches recurrence outside prompt text assertions.
- [x] Existing simulation or smallest focused scenario -- Verify the mentor stays English-only and gives a useful next move for fatigue/priority overload -- Exercises the user-visible behavior.

**Acceptance Criteria:**
- Given a user writes a non-English message, when the mentor replies, then the reply is English-only and does not mirror the user's language.
- Given the user says they are overloaded or tired, when the mentor replies, then it includes brief validation plus a concrete next conversational move.
- Given the user asks what the mentor knows from this conversation, when older scheduled reminders exist, then the reply excludes those older items and summarizes only current recent turns.
- Given the user explicitly closes a topic, when the mentor replies, then a short closure is allowed and no extra question is forced.

## Spec Change Log

- Review finding: English-only and current-conversation scoping were prompt-only. Amended implementation to retry/fail non-Latin-letter model output through the existing policy violation path and to remove durable memory/style context when the user asks about this conversation.
- Review finding: deterministic social and fatigue fallbacks were still too generic. Amended deterministic social replies to answer socially before pivoting, and added minimal substance-aware support openings.

## Verification

**Commands:**
- `agent-service/.venv/bin/python -m pytest agent-service/tests/unit/test_model_provider_prompt.py agent-service/tests/unit/test_model_provider.py agent-service/tests/unit/test_conversation_workflow.py -q` -- passed: 79 tests.
- `RUFF_CACHE_DIR=/tmp/entalent-ruff-cache agent-service/.venv/bin/python -m ruff check agent-service/src/agent_service/workflows/model_provider.py agent-service/tests/unit/test_model_provider_prompt.py agent-service/tests/unit/test_model_provider.py agent-service/tests/unit/test_conversation_workflow.py` -- passed.
- `perl -ne 'print "$ARGV:$.:$_" if /\p{Script=Cyrillic}/' agent-service/src/agent_service/workflows/model_provider.py agent-service/tests/unit/test_model_provider_prompt.py agent-service/tests/unit/test_model_provider.py agent-service/tests/unit/test_conversation_workflow.py _bmad-output/implementation-artifacts/spec-english-only-engaged-current-conversation.md` -- passed: no matches.

## Suggested Review Order

**Runtime Contract**

- Start with the global English-only runtime instruction.
  [`model_provider.py:33`](../../agent-service/src/agent_service/workflows/model_provider.py#L33)

- The prompt now scopes current-conversation answers to recent turns.
  [`model_provider.py:371`](../../agent-service/src/agent_service/workflows/model_provider.py#L371)

- Non-Latin model output now retries through existing policy violations.
  [`model_provider.py:583`](../../agent-service/src/agent_service/workflows/model_provider.py#L583)

- Current-conversation asks remove durable memory before prompt assembly.
  [`model_provider.py:1118`](../../agent-service/src/agent_service/workflows/model_provider.py#L1118)

**Deterministic Replies**

- Social fallback answers briefly before inviting a concrete work turn.
  [`model_provider.py:783`](../../agent-service/src/agent_service/workflows/model_provider.py#L783)

- Support fallback adds a useful next move without an empathy-only stop.
  [`model_provider.py:814`](../../agent-service/src/agent_service/workflows/model_provider.py#L814)

- Substance-aware openings avoid one generic fatigue phrase.
  [`model_provider.py:847`](../../agent-service/src/agent_service/workflows/model_provider.py#L847)

**Regression Coverage**

- Prompt coverage verifies current-conversation memory exclusion.
  [`test_model_provider_prompt.py:42`](../../agent-service/tests/unit/test_model_provider_prompt.py#L42)

- Policy coverage verifies non-Latin output rejection.
  [`test_model_provider_prompt.py:504`](../../agent-service/tests/unit/test_model_provider_prompt.py#L504)

- Workflow coverage locks the social deterministic reply.
  [`test_conversation_workflow.py:266`](../../agent-service/tests/unit/test_conversation_workflow.py#L266)

- Workflow coverage locks the grounded support follow-up.
  [`test_conversation_workflow.py:352`](../../agent-service/tests/unit/test_conversation_workflow.py#L352)

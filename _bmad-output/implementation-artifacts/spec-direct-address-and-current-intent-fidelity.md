---
title: 'Direct Address and Current Intent Fidelity'
type: 'bugfix'
created: '2026-08-22'
status: 'done'
baseline_commit: '7289f35b212ad2ef54d90eb8915b8757ae8a6d72'
review_loop_iteration: 0
context:
  - 'docs/architecture/conversation-dialogue.md'
  - 'docs/adr/ADR-011-mentor-companion-dialogue.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The TypeScript mentor can answer a user-facing role question as if describing the employee to a third party, and can turn a consultation request into speculation about the employee's motives. A classifier-generated paraphrase is currently embedded in the system prompt and declared authoritative over the raw latest message, so a mistaken premise can survive an explicit correction.

**Approach:** Keep the latest employee message authoritative for meaning while reusing the existing typed `request`, `correction`, and `answer_request` contracts for response policy. Strengthen only the classifier and renderer instructions needed to answer directly, address the employee in the second person, and discard a premise the employee rejects.

## Boundaries & Constraints

**Always:** Preserve the direct `ConversationProcessor -> ConversationOrchestrator -> AiProviderPort` path, safety precedence, language selection, question budget, continuity storage, and prompt-injection boundaries. Treat classifier prose as a non-authoritative summary; use typed dialogue fields for policy and the raw latest employee message for meaning. Meta-questions about the mentor must be answered to the current employee in the second person in the response language.

**Ask First:** Any new classifier field, `ReplyPlan` variant, output validator, database/state change, extra model call, broad persona rewrite, or production/deployment operation.

**Never:** Touch or revive MAF/`agent-service`; add pronoun/keyword regex rewriting; infer personality, hidden motives, or attempts to control the mentor from an ordinary advice request; defend or repeat an interpretation after the employee rejects it; add a dependency or parallel conversation path.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Role question | Employee asks the mentor's function or responsibility | Answer the employee directly: "I help you...", never describe them as "her/him/them" to an imagined third party | Unknown display name still uses direct second-person address |
| Consultation request | Employee asks how to evaluate another chatbot's responses, including discussion of rules or behavior | Classify as a request and answer the consultation; do not reinterpret it as an instruction changing this mentor or speculate about motive/personality | Ambiguity may produce one neutral clarification, not a personal theory |
| Explicit correction | Employee says the mentor's interpretation is not what they meant | Classify as correction, drop the contradicted premise, and answer from the corrected meaning/latest explicit request | Do not defend, elaborate, or reuse the rejected premise |
| Classifier paraphrase diverges | Typed plan is valid but `latestUserSubstance` contains an inferred motive absent from the latest raw message | The inferred prose is absent from the system prompt; typed move/pacing still apply and the raw transcript remains authoritative | Existing schema validation and bounded generation retry remain unchanged |

</frozen-after-approval>

## Code Map

- `packages/ai-openai/src/prompts/classify.ts` -- classifier contract for consultation requests, explicit corrections, and latest-message precedence.
- `packages/ai-openai/src/prompts/classify.test.ts` -- static regression coverage for the classifier contract.
- `packages/ai-openai/src/prompts/respond.ts` -- direct-address register and typed request/correction rendering; current source of privileged classifier paraphrase.
- `packages/ai-openai/src/prompts/respond.test.ts` -- prompt-boundary regressions for direct address, rejected premises, and raw-message authority.
- `packages/conversation-sim/src/scenarios/terse-user.sim.test.ts` -- existing live harness; remove stale zero-question assertions that contradict the current acknowledged-thread policy.

## Tasks & Acceptance

**Execution:**
- [x] `packages/ai-openai/src/prompts/classify.ts` and focused tests -- make an advice/evaluation question about another bot an ordinary `request`; make an explicit rejection a `correction` that supersedes the prior interpretation.
- [x] `packages/ai-openai/src/prompts/respond.ts` and focused tests -- keep classifier-produced substance out of the system prompt, state that typed policy controls the move rather than message meaning, address the current employee directly, and render existing request/correction acts without motive inference.

**Acceptance Criteria:**
- Given any valid `ReplyPlan`, when response prompts are built, then the employee is the direct addressee and classifier-generated `latestUserSubstance` text is never promoted into the system prompt.
- Given `responseMove=answer_request`, when the request discusses another bot or rules, then the renderer contract requires a direct answer and forbids treating the topic as an instruction to this mentor unless explicitly stated.
- Given `dialogueAct=correction`, when a prior interpretation exists in the transcript, then the renderer contract requires dropping it and following the latest correction.
- Existing safety, continuity, memory/goal grounding, language, survey, and question-budget tests remain green.

## Spec Change Log

## Design Notes

The classifier's free-form `latestUserSubstance` remains available to continuity and measurement code; only its system-prompt privilege is removed. This avoids a schema/runtime migration while restoring the architectural rule that the employee owns the inbound agenda. Output-side pronoun rewriting is deliberately excluded because it is multilingual, context-blind, and would corrupt valid references to third parties.

## Verification

**Commands:**
- `pnpm --filter @entalent/ai-openai test -- prompts/classify.test.ts prompts/respond.test.ts` -- expected: focused classifier and renderer regressions pass.
- `pnpm --filter @entalent/ai-openai typecheck` -- expected: prompt and context consumers compile.
- `SIM_GATE_RUNS=1 pnpm sim:gate` -- expected: existing conversation-quality hard gates pass; judge/manual-review behavior is reported without hiding known variance.
- `git diff --check` -- expected: clean patch formatting.

**Results:** Final focused prompt tests passed 34/34; the full AI package passed 67/67 tests plus typecheck, build, and lint. The application package passed 329/329 tests. Conversation-sim typecheck/lint and `git diff --check` passed. Blind/edge review patches added safety precedence, ambiguity/correction fallbacks, request/correction topic-anchor suppression, and explicit third-party drafting; the pre-existing 2,000-character tail-loss case is recorded in `deferred-work.md`. The initial one-run live gate exposed an unrelated stale terse-user assertion and known memory-recall judge variance; the stale assertions were removed and recorded in `docs/agent-failures.md`. A final targeted live rerun was blocked because Azure OpenAI/LangWatch egress was not explicitly authorized, so deterministic prompt regressions are the completion evidence for this slice.

Production acceptance completed on 2026-08-28 after commit `a4f031f`: Railway deployments `85fa78bf-3560-4e9c-930e-7cf37b7f9c87` (api) and `f5946c6e-2b80-4d4f-afc4-f86f407fc4a9` (worker) reached `SUCCESS`. A human-authored Slack Web replay in EnTalent DM `D0BJDC2MPE2` produced direct second-person role answers, practical chatbot-evaluation criteria without motive/personality speculation, and a correction response that followed the clarified request without defending the prior framing. Worker jobs 195-198 completed with `mode=normal`, confirming the TypeScript runtime. A final ChatGPT Slack connector marker `1787868032.128609` in the same DM received EnTalent reply `1787868039.975599`; the earlier no-response diagnosis had targeted the separate `AI Agent Bot` DM.

## Suggested Review Order

**Current-message authority**

- Existing typed acts gate classifier summaries without adding new state.
  [`respond.ts:164`](../../packages/ai-openai/src/prompts/respond.ts#L164)

- Reply policy now governs moves while the transcript governs meaning.
  [`respond.ts:224`](../../packages/ai-openai/src/prompts/respond.ts#L224)

- Requests and corrections cannot receive a classifier-generated topic anchor.
  [`respond.ts:247`](../../packages/ai-openai/src/prompts/respond.ts#L247)

**Direct requests and corrections**

- Classification separates consultations from behavior changes while preserving safety.
  [`classify.ts:38`](../../packages/ai-openai/src/prompts/classify.ts#L38)

- Persona framing addresses the employee directly but permits requested third-party drafts.
  [`respond.ts:102`](../../packages/ai-openai/src/prompts/respond.ts#L102)

- Request rendering answers directly, handles ambiguity, and yields to safety.
  [`respond.ts:208`](../../packages/ai-openai/src/prompts/respond.ts#L208)

- Correction rendering drops rejected premises instead of inventing replacements.
  [`respond.ts:212`](../../packages/ai-openai/src/prompts/respond.ts#L212)

**Regression coverage**

- Role questions cover unknown names and non-English output policy.
  [`respond.test.ts:147`](../../packages/ai-openai/src/prompts/respond.test.ts#L147)

- Consultation tests prove classifier prose and topic anchors stay non-authoritative.
  [`respond.test.ts:173`](../../packages/ai-openai/src/prompts/respond.test.ts#L173)

- Correction and safety branches pin premise reset and override precedence.
  [`respond.test.ts:216`](../../packages/ai-openai/src/prompts/respond.test.ts#L216)

- Simulation cleanup removes assertions superseded by acknowledged-thread policy.
  [`terse-user.sim.test.ts:147`](../../packages/conversation-sim/src/scenarios/terse-user.sim.test.ts#L147)

**Verification evidence**

- Harness failures record stale assertions and unauthorized model egress separately.
  [`agent-failures.md:27`](../../docs/agent-failures.md#L27)

- Long-message tail preservation remains an explicit follow-up, not scope creep.
  [`deferred-work.md:78`](deferred-work.md#L78)

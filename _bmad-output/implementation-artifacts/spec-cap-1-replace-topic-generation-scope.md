---
title: 'CAP-1: Isolate reply generation after topic replacement'
type: 'bugfix'
created: '2026-09-20'
status: 'draft'
review_loop_iteration: 0
context:
  - '_bmad-output/specs/spec-generic-conversation-bug-backlog/bug-catalog.md'
  - '_bmad-output/implementation-artifacts/generic-conversation-production-acceptance-2026-09-20.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** In the fresh production replay, the neutral statement “The fictional company’s onboarding is great” received “That gives the rest of the mess a bit less weight.” Persisted metadata correctly marked the turn as `new_substance`, `continuityDecision.action=replace`, `responseMove=address_new_substance`, and `memoryGrounding.used=false`, but reply generation still received up to 15 earlier turns, including an unconfirmed negative mentor frame from the previous topic.

**Approach:** When the existing continuity policy selects `replace`, keep classification, risk detection, and continuity evaluation unchanged, but give reply generation only the current owned inbound turn. This removes stale-topic assistant framing at the source boundary without another model call, phrase matching, or a stronger prompt instruction.

## Boundaries & Constraints

**Always:** Apply isolation only after the typed continuity decision is known. Preserve full history for classification and safety evaluation. Preserve the current inbound turn verbatim, the existing reply plan, language policy, concise-session state, memory policy, reporting/confirmation precedence, and all persistence metadata. Keep `continue` and `clarify` behavior unchanged.

**Ask First:** Any proposal that changes continuity classification, the recent-message query, session boundaries, safety copy, or production deployment/Slack state.

**Never:** Add semantic regexes for onboarding or “mess”; redact stored history; mutate previous messages; hide context from risk detection; re-enable MAF/`agent-service`; add a second LLM pass; catch provider errors in this slice.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Replaced topic | Prior assistant contains an unsupported negative frame; current neutral inbound produces `continuityDecision.action=replace` | `generateResponse` receives exactly the current inbound turn and cannot copy the stale assistant frame | Existing provider errors continue through the current error path |
| Continued topic | Current inbound produces `continuityDecision.action=continue` | `generateResponse` retains the existing bounded conversation history | No behavior change |
| Safety evaluation | Current turn needs risk detection and continuity later resolves to `replace` | `detectRisk` still receives full bounded history; only reply generation is isolated | Safety policy remains authoritative |
| Deterministic policy reply | Reporting, data-use, or pulse-capture path answers without generation | Existing deterministic response remains unchanged | No unnecessary generation call |

</frozen-after-approval>

## Code Map

- `packages/application/src/use-cases/conversation-orchestrator.ts` -- owns bounded history, typed continuity decision, reply plan, and the `generateResponse` call.
- `packages/application/src/use-cases/conversation-orchestrator.test.ts` -- verifies provider inputs and orchestration side effects with controlled classification/continuity fixtures.
- `packages/ai-openai/src/prompts/respond.ts` -- current prompt consumes all turns passed by the orchestrator; no prompt change is planned.

## Tasks & Acceptance

**Execution:**

- [ ] `packages/application/src/use-cases/conversation-orchestrator.test.ts` -- add RED cases proving replaced topics isolate generation while continued topics and safety analysis retain their current history.
- [ ] `packages/application/src/use-cases/conversation-orchestrator.ts` -- derive the response-generation turn slice from the existing continuity decision and pass it to the provider.
- [ ] Run focused application tests, package typecheck/lint, `git diff --check`, independent Blind/Edge review, and the harness gate against the pre-change commit.

**Acceptance Criteria:**

- Given prior negative assistant framing and a neutral onboarding turn whose continuity action is `replace`, when the reply is generated, then the provider input contains only the current inbound and persisted reply metadata still records the same typed decision.
- Given a same-topic continuation, when the reply is generated, then the existing bounded prior turns remain available.
- Given a turn requiring risk detection, when continuity later resolves to `replace`, then risk detection saw full history and no safety decision or escalation behavior was weakened.
- Given any deterministic reporting, data-use, or CAP-8 response, when continuity is `replace`, then no new generation call is introduced.

## Spec Change Log

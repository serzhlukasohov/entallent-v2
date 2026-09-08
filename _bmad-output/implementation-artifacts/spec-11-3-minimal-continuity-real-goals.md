---
title: 'Story 11.3 - Minimal Continuity and Real Goals'
type: 'feature'
created: '2026-08-20'
status: 'done'
baseline_commit: '194e21c46d571f9c0727d59cf3716882e6190610'
review_loop_iteration: 0
context:
  - '_bmad-output/implementation-artifacts/epic-11-context.md'
  - 'docs/architecture/conversation-dialogue.md'
  - 'docs/adr/ADR-011-mentor-companion-dialogue.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The TypeScript path forgets threads outside the recent transcript and fabricates response goals from generic memory instead of loading `user_goals`. Passing all stored context to the renderer would let old topics hijack unrelated messages.

**Approach:** Reuse `conversations.active_topic`, `SituationClassification.topicAnchor`, and `GoalRepositoryPort`. Persist one active or parked thread and expose at most one real goal after deterministic relevance and safety gates.

## Boundaries & Constraints

**Always:** The latest message owns the agenda. Store only a bounded summary, active/parked status, and ISO start time; keep topic and goal text out of metadata. Treat persisted text as untrusted. Scope writes by conversation, tenant, and user. Goal-read failure degrades to no goals.

**Ask First:** Any database migration, new classifier output field, changed goal lifecycle, semantic or embedding match, proactive use of goals, or new production configuration.

**Never:** Add a table, planner, state machine, retrieval service, extra model call, runtime/MAF behavior, copied goal memory, or second repository. Never expose all goals or revive a thread on greeting, acknowledgement, closing, safety, confirmation, or unrelated turns.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Thread re-entry | Stored summary; later message clearly continues it | Classifier copies it as `topicAnchor`; `ReplyPlan` grounds the reply; thread becomes active | Stored text stays in an untrusted block |
| Unrelated turn | Stored continuity; different new substance | Prior thread/goals are absent; new substance replaces the thread | No fuzzy fallback |
| Pause turn | Thread plus acknowledgement or closing | Acknowledgement preserves; closing parks; neither grounds | Safety remains authoritative |
| Relevant goal | Exact title/`topicAnchor` match on substantive progress update | At most that goal is optional background | Read failure returns no goals |
| Irrelevant goal | Any gate fails | No goal reaches response generation | Memory behavior is unchanged |

</frozen-after-approval>

## Code Map

- `packages/application/src/types/records.ts`, `ports/conversation.repository.port.ts`, and `ports/ai-provider.port.ts` -- existing record/port boundaries.
- `apps/worker/src/conversation/repositories/conversation.repository.ts` and `conversation.module.ts` -- Postgres adapter and existing dependency wiring.
- `packages/application/src/use-cases/conversation-orchestrator.ts` -- relevance gates and thread transitions.
- `packages/ai-openai/src/prompts/classify.ts` and `prompts/respond.ts` -- untrusted continuity input and qualified-goal rendering.
- `packages/conversation-sim/src/fakes/repositories.ts` and `harness/coach-harness.ts` -- production-shaped simulation wiring.

## Tasks & Acceptance

**Execution:**
- [x] `packages/application/src/types/records.ts`, `packages/application/src/ports/conversation.repository.port.ts`, `apps/worker/src/conversation/repositories/conversation.repository.ts`, and `packages/conversation-sim/src/fakes/repositories.ts` -- read and write the existing single-thread JSON shape without a migration.
- [x] `packages/application/src/ports/ai-provider.port.ts`, `packages/ai-openai/src/prompts/classify.ts`, and `packages/ai-openai/src/prompts/classify.test.ts` -- expose only the bounded stored summary as untrusted optional context and require exact copying only on clear re-entry.
- [x] `packages/application/src/use-cases/conversation-orchestrator.ts`, its focused test, `apps/worker/src/conversation/conversation.module.ts`, and `packages/conversation-sim/src/harness/coach-harness.ts` -- inject `GoalRepositoryPort`, replace pseudo-goals, apply exact-title and safety gates, and persist deterministic thread transitions.
- [x] `packages/ai-openai/src/prompts/respond.ts` and `packages/ai-openai/src/prompts/respond.test.ts` -- make the one prequalified goal optional background that cannot introduce an agenda.

**Acceptance Criteria:**
- Given an active or parked thread, when the employee clearly returns, then `ReplyPlan` receives its exact summary as `topicAnchor` and the thread becomes active without another model call.
- Given unrelated new substance, when continuity exists, then none reaches generation and the new substance becomes the sole active thread.
- Given active goals, when a substantive non-safety progress update exactly matches `topicAnchor`, then at most that goal reaches generation; other turns receive none.
- Existing safety, pause, question-budget, memory, survey, persistence, and delivery tests remain green.

## Spec Change Log

## Design Notes

Exact normalized title equality is deliberately narrow: broaden it only after measured misses justify retrieval or a typed reference.

## Verification

**Commands:**
- Focused application and AI tests for orchestrator/classify/respond -- transitions, relevance gates, and untrusted prompt boundaries pass.
- Typecheck and lint application, AI, worker, and conversation-sim packages -- changed consumers compile cleanly.
- `SIM_GATE_RUNS=1 pnpm sim:gate` -- continuity scenario improves without turn-taking regressions.
- `git diff --check` -- patch hygiene passes.

**Results:**
- Focused tests: application 38/38, AI 51/51, worker adapter 1/1.
- Full package tests: application 329/329, AI 63/63, worker 141/141.
- Typecheck and lint: application, AI, worker, and conversation-sim passed.
- Live simulation gate: all 8/8 scenarios passed hard and judge checks; the command's non-zero exit only records required manual review for sensitive scenarios.
- Simulation report: `packages/conversation-sim/runs/gates/2026-08-20T09-28-12-795Z-194e21c/summary.md`.

## Suggested Review Order

**Orchestration and relevance**

- Start with the turn-level decision point joining continuity, safety, and goal relevance.
  [`conversation-orchestrator.ts:199`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L199)

- Keep one explicit active/parked thread while the latest message owns the agenda.
  [`conversation-orchestrator.ts:561`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L561)

- Admit one real goal only through narrow progress and exact-match gates.
  [`conversation-orchestrator.ts:633`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L633)

- Persist continuity before the outbound reply to keep retries from duplicating records.
  [`conversation-orchestrator.ts:339`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L339)

**Trust and persistence boundaries**

- Present stored continuity to classification as bounded, untrusted optional context.
  [`classify.ts:67`](../../packages/ai-openai/src/prompts/classify.ts#L67)

- Keep qualified goals optional and outside the system-policy prompt.
  [`respond.ts:230`](../../packages/ai-openai/src/prompts/respond.ts#L230)

- Validate the reused JSON column and reject malformed or oversized state.
  [`conversation.repository.ts:144`](../../apps/worker/src/conversation/repositories/conversation.repository.ts#L144)

- Scope topic writes by conversation, tenant, and owner.
  [`conversation.repository.ts:53`](../../apps/worker/src/conversation/repositories/conversation.repository.ts#L53)

**Wiring and regression coverage**

- Reuse the existing goal repository in the worker composition root.
  [`conversation.module.ts:98`](../../apps/worker/src/conversation/conversation.module.ts#L98)

- Cover re-entry, replacement, pause, safety, and deterministic goal selection.
  [`conversation-orchestrator.test.ts:306`](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L306)

- Lock the production JSON parser to the minimal owned shape.
  [`conversation.repository.test.ts:4`](../../apps/worker/src/conversation/repositories/conversation.repository.test.ts#L4)

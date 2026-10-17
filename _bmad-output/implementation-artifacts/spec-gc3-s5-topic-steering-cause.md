---
title: 'GC round 3 S5: topic steering and cause before closure (CAP-1, CAP-2)'
type: 'bugfix'
created: '2026-10-17'
status: 'done'
baseline_commit: '3047978'
review_loop_iteration: 1
context:
  - '{project-root}/docs/adr/ADR-013-understanding-policy-rails.md'
  - '{project-root}/_bmad-output/specs/spec-gc-testing-2026-10-12/SPEC.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Inside an active V2 cycle the bot never leads the employee to uncovered pulse topics (T1: 25 messages, Autonomy 0/3) because the probe reaches the model as an optional hint it may skip, and backlog coverage ignores V2 working insights. A bare status ("motivation 9/10") is treated as enough, so the bot never asks what drives it (T2).

**Approach:** A named, pure policy decides per turn whether a topic question is due; when due, the reply schema carries a required `topicQuestion` that a rail validates (ADR-013 D4, D8). Backlog selection reads V2 working insights. The V2 capture gains typed `driverCaptured` / `driverDeclined` signals and a working insight is ready only with a driver or an explicit decline; until then the next topic question for it asks for the driver.

## Boundaries & Constraints

**Always:** PO decisions 2026-10-17: cadence is at most every third employee turn and mandatory when due; the turn after a topic completion is eligible; a status alone keeps the question open; the first proactive contact carries only the disclosure (unchanged). Semantics from structured model output; deterministic code decides and validates structure only. Topic names in prompts are meanings (S4 `TOPIC_PHRASES`). Outside an active V2 window the legacy optional probe stays as it is.

**Ask First:** Any change to proactive check-in ordering, Railway, production data, merge or deploy.

**Never:** Regex or word lists that interpret meaning; canned user-facing prose; touching MAF/`agent-service`; changing bundle/clarification composition paths (S4b area).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Due after disclosure | V2 window open, disclosure delivered, 3 employee turns since, no topic yet | reply context carries `topicQuestion` for the lowest uncovered topic; outbound marked `containsSurveyProbe` | rail fails after one repair → regenerate without topic, record reason |
| Completion then next | previous outbound completed a topic | next eligible turn carries the next topic question | N/A |
| Not due | safety/risk, pause, correction, closing, bundle/clarification, completion turn itself, explanation or cycle-status turn, zero-question reply plan, cadence not reached, cap of 3 per session reached | no `topicQuestion`, no legacy probe in a V2 window | N/A |
| Status without driver | capture "motivation 9/10", no reason | working insight `collecting`, not ready; next topic question for it has focus `driver` | N/A |
| Driver or decline later | later message gives a cause or declines | ready; backlog marked covered | N/A |
| V2 coverage | question confirmed/declined/pending/ready in V2 | not selected again | N/A |

</frozen-after-approval>

## Code Map

- `packages/application/src/utils/topic-question-policy.ts` -- new: cadence facts from messages + `canAskTopicQuestion` + registry constants
- `packages/application/src/use-cases/conversation-orchestrator.ts` -- gates, V2 window detection, `topicQuestion` context, fallback, metadata (`topicQuestion`, `topicCompleted`)
- `packages/application/src/services/pulse-backlog.service.ts` -- V2 coverage + driver-first selection, returns `focus`
- `packages/application/src/ports/question-working-capture.port.ts` -- `driverCaptured`, `driverDeclined` input; `findQuestionCoverage`
- `packages/application/src/use-cases/survey-evidence.use-case.ts` -- pass driver signals; mark backlog covered only when ready
- `packages/application/src/utils/topic-question-reply.ts` -- new: rail `validateTopicQuestionReply`, compose, typed error
- `packages/contracts/src/ai.ts` -- evidence `driverCaptured`/`driverDeclined` (fail closed false); response `topicQuestion`
- `packages/ai-openai/src/prompts/respond.ts`, `survey.ts`, `openai-provider.ts` -- hard contract block, schema field, one repair
- `packages/database` -- migration: `meaning_sufficient`, `driver_resolved` on working insights
- `apps/worker/src/survey/repositories/question-insight.repository.ts`, `survey.module.ts` -- readiness rule, coverage read, wiring

## Tasks & Acceptance

**Execution:**
- [x] policy + unit tests (RED first)
- [x] contracts fields + tests
- [x] backlog V2 coverage + tests
- [x] capture readiness (use case, port, repository, migration) + repository integration test
- [x] rail + provider + prompt + tests
- [x] orchestrator wiring + tests (three turns after disclosure; completion → next; safety → none)
- [x] V2 queue suite case; conversation-sim steering scenario registered in `gate.config.json`

**Acceptance Criteria:**
- Given an active V2 window and a delivered disclosure, when the third employee turn arrives with no topic asked, then `generateResponse` receives a required `topicQuestion` and the outbound is marked as carrying it.
- Given a "9/10, no reason" capture, when the working insight is written, then it is not ready and the next topic question has focus `driver`.

## Design Notes

Cadence anchor is the latest of: last topic-question outbound (threshold 3 employee turns), last topic-completion outbound (threshold 1), delivered disclosure (threshold 3). Readiness persists `meaning_sufficient` and `driver_resolved` so a status and its driver may arrive in different messages; existing ready rows keep their state. The rail checks structure only (exactly one question in `topicQuestion`, none in `replyText`, matching question id, length); whether the question is about the topic is the prompt contract plus the sim judge.

## Verification

**Commands:**
- `pnpm --filter @entalent/contracts test`, `@entalent/application test`, `@entalent/ai-openai test`, `@entalent/worker test` -- pass
- repository integration + `V2_CONVERSATION_QUEUE_TEST=1` V2 queue suite against local Postgres/Redis -- pass
- `pnpm typecheck`, `pnpm lint`, `pnpm harness:check -- --base main` -- pass

## Suggested Review Order

**Topic policy (ADR-013 D4)**

- Pure, versioned rule: who may be asked a topic question this turn, and why not.
  [`topic-question-policy.ts:135`](../../packages/application/src/utils/topic-question-policy.ts#L135)

- Cadence anchors on topic questions, fallbacks, completions and the disclosure; rolling 24h cap.
  [`topic-question-policy.ts:66`](../../packages/application/src/utils/topic-question-policy.ts#L66)

**Required topic question (ADR-013 D8)**

- Orchestrator applies the policy inside an active V2 cycle and forces one question when due.
  [`conversation-orchestrator.ts:815`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L815)

- Rail re-check and fallback with the turn's own question policy.
  [`conversation-orchestrator.ts:1831`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L1831)

- Structural rail: no question in the answer, exactly one question last.
  [`topic-question-reply.ts:42`](../../packages/application/src/utils/topic-question-reply.ts#L42)

- Hard contract: question written first, driver focus wording, meanings not labels.
  [`respond.ts:216`](../../packages/ai-openai/src/prompts/respond.ts#L216)

- Provider: one structured call, one repair, then typed failure.
  [`openai-provider.ts:560`](../../packages/ai-openai/src/openai-provider.ts#L560)

**Safety ordering**

- Survey lookups settle after escalation, so their failure cannot skip it.
  [`conversation-orchestrator.ts:482`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L482)

**Cause before closure (CAP-2)**

- Readiness accumulates sufficient meaning and a driver or decline across messages.
  [`question-readiness.ts:11`](../../packages/application/src/utils/question-readiness.ts#L11)

- Repository applies it on capture; decline without meaning recorded separately.
  [`question-insight.repository.ts:1397`](../../apps/worker/src/survey/repositories/question-insight.repository.ts#L1397)
  [`question-insight.repository.ts:1275`](../../apps/worker/src/survey/repositories/question-insight.repository.ts#L1275)

- Driver asked at most once, recorded on delivery.
  [`conversation-orchestrator.ts:1181`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L1181)

- Typed capture signals and their definitions.
  [`ai.ts:353`](../../packages/contracts/src/ai.ts#L353)
  [`survey.ts:20`](../../packages/ai-openai/src/prompts/survey.ts#L20)
  [`survey-evidence.use-case.ts:255`](../../packages/application/src/use-cases/survey-evidence.use-case.ts#L255)

**V2-aware selection**

- Working insights settle selection; driver follow-up first, once.
  [`pulse-backlog.service.ts:19`](../../packages/application/src/services/pulse-backlog.service.ts#L19)
  [`pulse-backlog.service.ts:137`](../../packages/application/src/services/pulse-backlog.service.ts#L137)

- Proactive check-ins never re-ask a status as a generic probe.
  [`proactive-check-in.use-case.ts:133`](../../packages/application/src/use-cases/proactive-check-in.use-case.ts#L133)

- Durable count for the rolling cap.
  [`conversation.repository.ts:154`](../../apps/worker/src/conversation/repositories/conversation.repository.ts#L154)

**Peripherals**

- Migration (0051 readiness columns, 0052 driver request time).
  [`0051_quiet_hitman.sql:1`](../../packages/database/migrations/0051_quiet_hitman.sql#L1)

- End-to-end queue case, orchestrator cases, live sim scenario.
  [`v2-conversation-flow.integration.test.ts:1216`](../../apps/worker/src/conversation/v2-conversation-flow.integration.test.ts#L1216)
  [`conversation-orchestrator.test.ts:6124`](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L6124)
  [`topic-steering.sim.test.ts:70`](../../packages/conversation-sim/src/scenarios/topic-steering.sim.test.ts#L70)

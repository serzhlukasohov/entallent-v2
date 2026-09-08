---
title: Sprint Change Proposal - Prioritize TypeScript Mentor Quality
date: 2026-08-19
project: enTalentNew
change_scope: major
status: proposed-revision-2
approval: pending
---

# Sprint Change Proposal: Prioritize TypeScript Mentor Quality

## Decision requested

Treat the production return to TypeScript as complete and successful. Stop making MAF deletion the near-term objective. Improve the existing TypeScript mentor in small, measured vertical slices: simplify the inbound hot path, fix turn-taking, persist minimal dialogue continuity, use real goals, enforce consent for open loops, and measure whether each change improves real conversations.

MAF deletion, historical data cleanup, tenant/user-insights hardening, Slack ingress idempotency, and Slack thread propagation are explicitly deferred by product direction. They remain tracked risks, not forgotten work.

No production code, flags, Railway settings, or sprint status are changed by this proposal.

## 1. Updated issue summary

### What changed

The previous proposal treated TypeScript cutover as future work and MAF retirement as the main program. The product owner has now confirmed:

- `maf_runtime_disabled=true` is already active;
- real TypeScript conversations work noticeably better than MAF;
- near-term deletion and cleanup do not create enough product value;
- the priority is better conversation, architecture, and data collection;
- direct `ConversationProcessor -> ConversationOrchestrator` wiring is approved in principle.

The triggering issue is therefore no longer "how to retire MAF". It is "how to turn the improved TypeScript baseline into a better mentor without building another framework."

### Evidence

- Production/user observation: TypeScript behavior is noticeably better after the switch.
- Live Slack acceptance found a no-reply failure when the classifier emitted unsupported `primaryIntent="closing"`.
- `ReplyPlan` already contains the correct product decision surface: `dialogueAct`, `responseMove`, question policy, grounding, and forbidden moves.
- `ConversationProcessor` still builds MAF context and runs a preliminary classifier before the TypeScript orchestrator repeats context loading and classification.
- The accepted mentor-companion architecture already defines the desired path in `docs/architecture/conversation-dialogue.md` and ADR-011.
- `conversations.active_topic` already exists for minimal dialogue state; `user_goals` and `GoalRepository` already exist.
- Outbound `messages.metadata` already stores typed `replyShape`; `llm_runs`, messages, survey evidence, memory, goals, and scheduled actions already provide enough data for a first quality report.

## 2. Revised scope decisions

| Area | Decision now |
| --- | --- |
| TypeScript traffic cutover | Complete; use as the new baseline. |
| Full MAF code/service/data deletion | Deferred. |
| Public `agent-service` exposure | One recommended security housekeeping action; not a cleanup program. |
| Direct inbound TS path | In scope. |
| Tenant-scoped user insights | Deferred by product owner; keep risk recorded. |
| PostgreSQL Slack deduplication/stable job IDs | Deferred by product owner; keep risk recorded. |
| Slack thread propagation | Deferred by product owner; keep risk recorded. |
| Conversation quality | Highest priority. |
| Dialogue continuity and goals | High priority after turn-taking baseline. |
| Data/measurement | Begin in the first story using existing tables and metadata. |
| New analytics platform/table/dashboard | Out of scope. |

## 3. Architecture direction

Use the accepted mentor-companion spine:

```text
Slack inbound
  -> BullMQ conversation job
  -> ConversationProcessor
  -> ConversationOrchestrator
     -> load recent turns, memory, goals, DialogueState
     -> classify once
     -> deterministic DialoguePolicy / ReplyPlan
     -> AiProviderPort.generateResponse
     -> TypeScript-owned message commit and async effects
  -> Slack delivery
```

The implementation ladder is:

1. Reuse `ConversationOrchestrator`, `ReplyPlan`, `AiProviderPort`, `GoalRepository`, `messages.metadata`, `llm_runs`, and `conversations.active_topic`.
2. Add no `ReplyRendererPort`, planner service, event bus, warehouse, evaluator platform, or new dialogue-state table.
3. Keep prompts as rendering instructions; behavioral decisions belong in typed classification, dialogue state, and `ReplyPlan`.
4. Change one conversational behavior per slice and compare it against the same baseline.

## 4. Recommended plan

### Operational security housekeeping - close the public agent-service domain

This is the only near-term MAF-related action recommended because the runtime endpoint is not effectively protected. It does not require deleting the service or its data.

Before removing the domain:

1. Confirm the worker no longer calls MAF while `maf_runtime_disabled=true`.
2. If an emergency MAF rollback must remain possible, confirm `AGENT_SERVICE_INTERNAL_URL` uses Railway private networking rather than the public domain.

Railway UI steps:

1. Open project `reasonable-adaptation`, environment `production`.
2. Open service `agent-service`.
3. Go to **Settings -> Networking -> Public Networking**.
4. Remove the generated/custom public domain.
5. Do not remove private networking, the service, variables, volume, or deployment.
6. Verify the public health URL no longer resolves. Internal service availability can remain for rollback.

This is a production domain mutation and still requires explicit approval immediately before execution.

### Story 11.1 - Establish the direct TS path and a measurable baseline

Goal: remove duplicate work from the real inbound path and start collecting decision-level evidence.

Implementation:

1. Route inbound conversation jobs directly from `ConversationProcessor` to `ConversationOrchestrator.orchestrate`.
2. Stop building MAF candidate context and stop the preliminary worker classifier for inbound TypeScript turns.
3. Leave the rest of MAF code and deployment untouched. Proactive cleanup is not required in this story.
4. Extend outbound `messages.metadata` from existing typed `ReplyPlan` data only:
   - `measurementVersion`;
   - `dialogueAct`;
   - `responseMove`;
   - existing `replyShape`;
   - language policy language/source;
   - `isSessionStart`;
   - memory grounding used/count;
   - survey probe included/question ID.
5. Store no prompt, completion, memory text, topic text, reasoning, or chain-of-thought metadata.
6. Produce a first tenant-scoped **TypeScript Conversation Decision Report**, initially as a script or SQL-backed JSON report, not a dashboard.

Report windows: last 14 days versus previous 14 days.

Report sections:

- Reliability: eligible inbound volume, reply success, inbound-to-outbound p50/p95 latency, LLM errors.
- Continuity: user return within 24 hours and turns per active conversation.
- Decisions: outcomes by `dialogueAct`, `responseMove`, and question/no-question cohort.
- Useful state: survey evidence, memory, goal, and follow-up yield per 100 eligible inbound turns.

Exclude deleted messages, `__init__`, synthetic control messages, and proactive messages from inbound quality denominators.

Important limitation: current `llm_runs` conversation records have hard-coded model data and do not reliably populate tokens, prompt version, or cost. Do not publish a cost/token quality metric until that writer is made truthful.

Acceptance:

- One classifier/context load per inbound TypeScript turn.
- Existing TypeScript reply behavior remains unchanged.
- Decision metadata contains enums/counts only.
- A report can be produced from current PostgreSQL tables without a new schema.

### Story 11.2 - Fix natural turn-taking before adding more memory or coaching

Goal: make the mentor handle ordinary conversation edges reliably and naturally.

Implementation:

1. Normalize dialogue-act labels mistakenly returned in `primaryIntent` at the classifier trust boundary. Example: `primaryIntent="closing"` becomes the safe product intent while `dialogueAct="closing"` remains authoritative.
2. Make `closing` consume zero questions and produce `close_or_pause` behavior.
3. Keep pure acknowledgements/backchannels short, with zero questions and no invented coaching move.
4. Enforce the question budget across the whole generated reply, not only when the reply ends with `?`.
5. Strengthen existing `ReplyPlan`/prompt contracts; do not add phrase-based behavior gates or a deterministic multilingual phrase library.
6. Add production-shaped cases for:
   - greeting;
   - social check-in;
   - acknowledgement/backchannel;
   - substantive continuation;
   - correction;
   - closing;
   - closing combined with reminder, survey confirmation, and safety state.

Acceptance:

- A closing turn never fails schema validation and never asks another question.
- A no-substance acknowledgement does not restart coaching.
- Substantive continuation still receives a useful response.
- The focused tests and a real Slack dialogue acceptance sequence pass.

### Story 11.3 - Add minimal persisted continuity and real goals

Goal: let the mentor continue the right thread across turns and days without turning Slack into a coaching session.

Implementation:

1. Store `DialogueState v1` in existing `conversations.active_topic`; add no table.
2. Start with only the state proven necessary:
   - current sitting timestamps;
   - one open/parked/closed thread summary;
   - current waiting subdialogue reference when applicable.
3. Add read/update methods to the existing conversation repository boundary.
4. Inject the existing `GoalRepositoryPort` into `ConversationOrchestrator` and load active `user_goals`.
5. Make goals available for grounding, but never let a stored goal hijack an unrelated inbound turn.
6. Derive `ReplyPlan` from classification plus persisted state. Do not infer continuity only by increasing the recent-message limit.

Acceptance:

- A new sitting can recall the relevant parked thread without forcing it into an unrelated greeting.
- Active goals are available when relevant and absent as an unsolicited agenda.
- State contains summaries/statuses, not raw reasoning.
- Existing memory, survey, safety, and language behavior remains green.

### Story 11.4 - Make follow-ups consensual and unify proactive initiative

Goal: improve trust by preventing the system from silently creating homework or sending competing initiatives.

Implementation:

1. Treat extracted follow-up candidates as proposals, not scheduled actions.
2. Persist a loop only after an explicit reminder request or typed consent to an offered loop.
3. Reuse the existing survey-confirmation interaction shape for loop consent.
4. Enforce one daily initiative budget across due loops, parked threads, and warm/pulse check-ins; explicit user reminders remain the documented exception.
5. Preserve quiet hours, risk suppression, and proactive opt-out.

Acceptance:

- No model-confidence-only follow-up is scheduled.
- A decline creates no loop and does not trigger another question.
- Only one non-reminder proactive initiative can reach a user per day.
- The chosen proactive reason is recorded as a stable reason code, not free text.

## 5. Measurement rules

Use measures to compare slices, not to claim causality.

Primary metrics:

- Reply success: eligible inbound with a following outbound / eligible inbound.
- Inbound-to-outbound latency: p50 and p95.
- 24-hour return rate after an outbound.
- Turns per active conversation.
- Return rate segmented by `dialogueAct`, `responseMove`, and `askedQuestion`.
- Survey evidence, memory, goal, and consented-follow-up yield per 100 inbound turns.
- Correction rate and closing-turn failure rate.

Guardrails:

- Safety escalation and survey/proactive suppression must not regress.
- Do not store private reasoning or raw memory in measurement metadata.
- Question lift is correlation only and must be segmented by dialogue act.
- Do not optimize raw message count if users are signalling closure.

## 6. Deferred backlog

Explicitly deferred until the TS quality slices show stable benefit:

- deleting MAF code, service, contracts, scripts, ledgers, and runtime tables;
- tenant-scoped user-insights fix;
- PostgreSQL Slack ingress idempotency and stable BullMQ job IDs;
- Slack thread propagation;
- generic outbound committer abstraction;
- pgvector retrieval;
- multi-loop dialogue state;
- a new analytics warehouse/dashboard/event stream;
- broad prompt rewrite or model swap.

The security risk of a publicly reachable unauthenticated agent-service endpoint is the sole exception; close only its public domain.

## 7. Verification sequence

For every story:

1. Focused unit/application tests.
2. `pnpm --filter @entalent/application typecheck` and affected package typechecks.
3. `SIM_GATE_RUNS=1 pnpm sim:gate` for dialogue/prompt/state behavior.
4. One production-shaped Slack conversation sequence covering the changed behavior.
5. Compare the Decision Report window after enough new turns exist; do not declare quality improvement from one anecdotal sample alone.

Minimum Story 11.1/11.2 gates:

```sh
pnpm --filter @entalent/application test -- conversation-orchestrator.test.ts reply-plan.test.ts
pnpm --filter @entalent/ai-openai test -- openai-provider.test.ts respond.test.ts
pnpm --filter @entalent/worker test -- conversation.processor.test.ts
pnpm typecheck
SIM_GATE_RUNS=1 pnpm sim:gate
```

## 8. Artifact changes after approval

### Epics

**Old proposal:** Epic 11 primarily decommissions MAF.

**New proposal:** Epic 11 improves the TypeScript mentor through the four stories above. MAF retirement moves to deferred backlog.

### Architecture

**Old proposal:** A decommission program is the primary architecture objective.

**New proposal:** Implement the already accepted mentor-companion spine in `docs/architecture/conversation-dialogue.md`; direct inbound TypeScript wiring is the first slice.

### PRD and UX

No product or UI rewrite. The user experience target becomes measurable natural conversation quality, continuity, consent, and useful state.

### Sprint tracking

Do not update `epics.md` or `sprint-status.yaml` until this revised proposal is explicitly approved.

## 9. Success criteria

The immediate program succeeds when:

1. Inbound TypeScript turns have one context/classification/orchestration path.
2. Closing, backchannel, correction, and continuation turns behave reliably.
3. Dialogue continuity and active goals reach the mentor without hijacking inbound agenda.
4. Follow-ups require consent and proactive contact shares one daily initiative budget.
5. Conversation changes are evaluated with a repeatable, privacy-safe report built on existing data.
6. No new runtime, planner, state table, analytics platform, or test framework is introduced.

## Approval

Status: **Pending**

Approval authorizes creation of the revised Epic 11 artifacts and implementation of Story 11.1. Public Railway domain removal remains a separate production operation requiring explicit approval immediately before execution.

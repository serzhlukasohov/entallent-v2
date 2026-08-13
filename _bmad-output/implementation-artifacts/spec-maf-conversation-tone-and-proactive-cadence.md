---
title: 'Restore MAF conversation tone and proactive cadence'
type: 'bugfix'
created: '2026-08-13T00:00:00+02:00'
status: 'done'
baseline_commit: '23ee7b27672a91375ba6e93706f31944673b8c62'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-maf-proactive-check-in-runtime.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** After the MAF migration, the agent's visible behavior became too AI-like: proactive starts feel direct/repetitive, short acknowledgements receive generic coaching, and replies drift away from pulse-insight conversation. Failed proactive MAF attempts can also leave users eligible for repeated check-in jobs because cadence only counts committed outbound check-ins.

**Approach:** Bring the MAF candidate prompt closer to the established work-companion voice, add explicit acknowledgement/reply-rhythm guidance, keep pulse probes opportunistic rather than forced, and add a scheduler cooldown for recently attempted proactive MAF requests.

## Boundaries & Constraints

**Always:** Keep TypeScript-owned persistence and side effects intact. Preserve the MAF primary runtime boundary and runtime_attempt evidence. Keep safety instructions and secret/prompt-leak guards. Use tests that lock behavior at the prompt and scheduler layers.

**Ask First:** Any schema migration, production flag change, deletion of TypeScript fallback runtime, or broad rewrite of the conversation workflow.

**Never:** Do not hide failures by sending TypeScript fallback check-ins while MAF primary is selected. Do not turn pulse into direct HR/survey wording. Do not add live model calls to unit tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Proactive opener | `requestPurpose='proactive_check_in'`, optional pulse probe | Prompt asks for a short human opener, one question at most, and opportunistic pulse territory only when natural | Missing probe still produces a warm opener policy |
| Short acknowledgement | latest text is `ok` / `thanks` and context has prior turns | Prompt tells MAF not to over-interpret brevity, not to say "glad to hear back", and to close or continue from prior topic briefly | No new action plan or forced question |
| Failed proactive attempts | recent synthetic `proactive_check_in_request` exists inside cadence window | Scheduler excludes the user from new check-in candidates | Prevents repeated jobs while MAF config/runtime is unhealthy |

</frozen-after-approval>

## Code Map

- `agent-service/src/agent_service/workflows/model_provider.py` -- Builds live MAF model prompt for inbound and proactive replies.
- `agent-service/tests/unit/test_model_provider_prompt.py` -- Prompt-level regression coverage.
- `apps/worker/src/proactive/proactive-scheduler.repository.ts` -- SQL eligibility gate for proactive check-ins.
- `packages/application/src/use-cases/proactive-scheduler.test.ts` -- Scheduler use-case coverage.
- `apps/worker/src/proactive/proactive-scheduler.repository.test.ts` -- Repository SQL cooldown coverage.

## Tasks & Acceptance

**Execution:**
- [x] `agent-service/src/agent_service/workflows/model_provider.py` -- Add work-companion voice, acknowledgement policy, and softer pulse guidance -- Restores conversation behavior after MAF migration.
- [x] `agent-service/tests/unit/test_model_provider_prompt.py` -- Add prompt assertions for acknowledgement and proactive pulse behavior -- Prevents future prompt regression.
- [x] `apps/worker/src/proactive/proactive-scheduler.repository.ts` -- Count recent synthetic proactive request attempts in cadence gate -- Prevents repeated check-in jobs when MAF fails before outbound.
- [x] `apps/worker/src/proactive/proactive-scheduler.repository.test.ts` -- Add SQL regression coverage for proactive request cooldown -- Locks the dedupe behavior.

**Acceptance Criteria:**
- Given a proactive MAF prompt with a pulse probe, when the prompt is built, then it instructs the model to open naturally, avoid survey/assessment mechanics, and skip the probe if it does not fit.
- Given a short acknowledgement, when the prompt is built, then it carries explicit guidance to avoid generic "glad to hear back" and action-plan replies.
- Given a recent synthetic proactive request exists, when the scheduler selects candidates, then that user is treated as recently contacted for cadence purposes.

## Spec Change Log

## Verification

**Commands:**
- `agent-service/.venv/bin/python -m ruff check agent-service/src/agent_service/workflows/model_provider.py agent-service/tests/unit/test_model_provider_prompt.py` -- passed.
- `agent-service/.venv/bin/python -m pytest agent-service/tests/unit/test_model_provider_prompt.py -q` -- passed.
- `pnpm --filter @entalent/application test -- proactive-scheduler.test.ts` -- passed.
- `pnpm --filter @entalent/worker test -- proactive-scheduler.repository.test.ts conversation.processor.test.ts` -- passed.

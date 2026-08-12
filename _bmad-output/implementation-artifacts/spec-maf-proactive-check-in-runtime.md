---
title: 'Route proactive pulse check-ins through MAF primary runtime'
type: 'feature'
created: '2026-08-11T10:40:00+02:00'
status: 'done'
baseline_commit: '129642d6ee7d52b65dc6b0c35d5d214640aa4c34'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/epics.md'
  - '{project-root}/_bmad-output/implementation-artifacts/9-2-run-full-app-primary-runtime-smoke.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Production Slack inbound messages now use the new MAF primary path, but proactive pulse check-ins still bypass `AgentRuntimePort` through `ProactiveCheckInUseCase`. That means pulse outreach cannot be honestly accepted as “MAF primary with no fallback,” and runtime_attempt evidence is missing for check-in replies.

**Approach:** Make proactive check-in a first-class MAF runtime request while preserving TypeScript ownership of persistence, Slack outbox, survey evidence extraction, feature flags, and pulse backlog state. The worker should select the next probe candidate in TypeScript, pass proactive intent/context into MAF, persist the MAF reply as `message_type='proactive_check_in'`, enqueue Slack send and extraction jobs, and record runtime attempts the same way inbound messages do.

## Boundaries & Constraints

**Always:** Keep Slack ingestion, BullMQ, DB writes, message send, survey evidence, feature flags, risk side effects, and pulse backlog updates TypeScript-owned. MAF may generate the candidate reply and diagnostics/proposals only. Every successful check-in must have `runtime_attempts.runtime_mode='maf_primary'`, `phase='reply_committed'`, empty `failure_reason`, and outbound metadata `runtimeMode='maf_primary'`.

**Ask First:** Any schema migration that changes existing persisted rows, any change that removes the current TypeScript fallback runtime globally, or any change that requires a new production secret/env var.

**Never:** Do not fake this with an ordinary synthetic user message that pollutes user-visible conversation history as inbound text. Do not move survey/dashboard writes into Python. Do not claim pulse is MAF-primary unless the persisted check-in reply has runtime_attempt evidence.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Proactive MAF check-in | `check-in` BullMQ job, MAF primary enabled, active conversation, optional next pulse probe | Worker calls `AgentRuntimePort`, MAF returns reply, outbound message is saved as `proactive_check_in`, Slack send is queued, runtime attempt is `maf_primary/reply_committed`, metadata includes MAF counters | Runtime errors fail the job; no TypeScript-generated user-facing fallback is sent after MAF side-effect barrier |
| First contact / no probe | No recent turns or memory, no eligible pulse probe | MAF receives proactive intent without a forced probe and generates a warm short opener | Missing optional probe does not fail the job |
| Probe included | Pulse backlog returns a question | MAF receives probe strategies/context and may steer toward it; if the reply metadata marks a probe sent, TypeScript records `recordProbeSent` | If MAF does not mark a probe, no probe-sent record is written |
| MAF disabled/invalid config | Runtime router selects TypeScript path because kill switch/config says so | Existing `ProactiveCheckInUseCase` remains the non-MAF path for disabled mode only | No `maf_primary` acceptance claim for disabled mode |

</frozen-after-approval>

## Code Map

- `packages/application/src/ports/agent-runtime.port.ts` -- Extend runtime request/result shape with proactive check-in purpose and optional pulse probe metadata.
- `packages/contracts/src/runtime-contract.ts` and runtime OpenAPI schema artifacts -- Add canonical request fields for initiated/proactive turns and optional reply metadata for survey probe selection.
- `packages/application/src/use-cases/maf-agent-runtime-client.ts` -- Serialize/validate the extended request without breaking existing inbound requests.
- `packages/application/src/use-cases/maf-primary-agent-runtime.ts` -- Persist proactive outbound messages with the right message type, MAF metadata, outbox send, extraction jobs, and post-candidate hooks.
- `apps/worker/src/conversation/conversation.processor.ts` -- Replace direct `ProactiveCheckInUseCase.execute()` for MAF primary check-ins with an `AgentRuntimePort` request assembled from recent turns, memory, tenant pulse policy, and optional pulse probe.
- `packages/application/src/use-cases/proactive-check-in.use-case.ts` -- Keep as TypeScript fallback/runtime-disabled path and as source of pulse probe selection semantics if needed.
- `agent-service/src/agent_service/workflows/model_provider.py` -- Teach prompt construction to handle proactive check-in purpose/probe context without treating it as a user instruction.
- `apps/worker/src/conversation/conversation.processor.test.ts`, `packages/application/src/use-cases/maf-primary-agent-runtime.test.ts`, `agent-service/tests/unit/test_model_provider_prompt.py` -- Cover routing, persistence metadata, and prompt behavior.
- `scripts/maf-production-acceptance.sh` / local smoke scripts -- Extend verification to catch proactive check-in runtime evidence once implementation exists.

## Tasks & Acceptance

**Execution:**
- [x] `packages/application/src/ports/agent-runtime.port.ts` and `packages/contracts/src/runtime-contract.ts` -- Add proactive request/result metadata -- Needed so check-ins are not hidden as fake inbound messages.
- [x] Runtime schema/fixtures -- Update canonical OpenAPI validation and shared fixtures -- Keeps TypeScript/Python HTTP boundary honest.
- [x] `agent-service/src/agent_service/workflows/model_provider.py` -- Prompt proactive check-ins from purpose/probe context -- Allows MAF to generate warm check-ins and optional pulse probes.
- [x] `packages/application/src/use-cases/maf-primary-agent-runtime.ts` -- Persist proactive replies as `proactive_check_in`, include MAF metadata, queue Slack and extraction side effects -- Keeps TypeScript-owned writes intact.
- [x] `apps/worker/src/conversation/conversation.processor.ts` -- Route `check-in` jobs through MAF primary when selected; retain `ProactiveCheckInUseCase` only for non-MAF/disabled mode -- Closes the production acceptance gap.
- [x] Tests -- Add focused unit coverage for worker check-in routing, primary runtime proactive persistence, and Python prompt construction -- Prevents silent reintroduction of the bypass.
- [x] Acceptance script/smoke -- Add a proactive check-in check or documented command path that verifies runtime_attempts and outbound metadata -- Makes the requirement repeatable.

**Acceptance Criteria:**
- Given MAF primary is enabled for a tenant, when a `check-in` job is processed, then the persisted outbound check-in has `message_type='proactive_check_in'`, metadata `runtimeMode='maf_primary'`, and a matching `runtime_attempts` row with `phase='reply_committed'`.
- Given a pulse probe is available, when MAF marks the reply as containing that probe, then TypeScript records the probe as sent and dashboard/user insights continue to update from survey evidence jobs.
- Given no pulse probe is available, when a check-in job runs, then MAF still generates a short proactive opener and no probe-sent state is written.
- Given MAF is disabled by flags or configuration, when a check-in job runs, then the existing TypeScript check-in behavior remains available and is not reported as MAF-primary.
- Given the production acceptance command runs after a MAF proactive check-in, then it fails if any recent check-in attempt is non-primary, failed, or missing outbound MAF metadata.

## Spec Change Log

## Design Notes

The important boundary is not “Python owns pulse.” It is “Python/MAF owns candidate generation; TypeScript owns all side effects.” Use an explicit proactive request purpose/context so the MAF prompt can say “start a warm check-in” without storing a fake inbound message.

## Verification

**Commands:**
- `pnpm --filter @entalent/contracts build` -- expected: contract/schema changes compile.
- `pnpm --filter @entalent/application test -- maf-primary-agent-runtime.test.ts maf-agent-runtime-client.test.ts` -- expected: runtime request/result behavior passes.
- `pnpm --filter @entalent/worker test -- conversation.processor.test.ts` -- expected: check-in routing and fallback behavior pass.
- `agent-service/.venv/bin/python -m pytest agent-service/tests/unit/test_model_provider_prompt.py agent-service/tests/unit/test_runtime_endpoint.py -q` -- expected: proactive prompt and endpoint contract pass.
- `pnpm run maf:prod:acceptance` -- expected after deploy: no recent MAF fallback/failure and dashboard surfaces still populated.

## Suggested Review Order

**Runtime Routing**

- Check-in jobs enter MAF only when primary runtime controls allow it.
  [`conversation.processor.ts:87`](../../apps/worker/src/conversation/conversation.processor.ts#L87)

- Proactive primary failures now fail closed instead of TypeScript fallback.
  [`agent-runtime-router.ts:218`](../../packages/application/src/use-cases/agent-runtime-router.ts#L218)

- Synthetic proactive requests carry explicit purpose and pulse context.
  [`conversation.processor.ts:120`](../../apps/worker/src/conversation/conversation.processor.ts#L120)

**Persistence Boundaries**

- Proactive replies persist as `proactive_check_in` with MAF metadata.
  [`maf-primary-agent-runtime.ts:52`](../../packages/application/src/use-cases/maf-primary-agent-runtime.ts#L52)

- Inbound-evidence side effects stay off synthetic proactive message IDs.
  [`maf-primary-agent-runtime.ts:49`](../../packages/application/src/use-cases/maf-primary-agent-runtime.ts#L49)

- Worker rejects stale conversation/user jobs before loading recent turns.
  [`conversation.processor.ts:353`](../../apps/worker/src/conversation/conversation.processor.ts#L353)

**Probe Handling**

- Python prompt treats proactive probes as agent-initiated context.
  [`model_provider.py:185`](../../agent-service/src/agent_service/workflows/model_provider.py#L185)

- Probe-sent metadata requires reply content to match probe wording.
  [`conversation_workflow.py:487`](../../agent-service/src/agent_service/workflows/conversation_workflow.py#L487)

- Post-commit probe backlog writes are best-effort to avoid duplicate sends.
  [`conversation.processor.ts:157`](../../apps/worker/src/conversation/conversation.processor.ts#L157)

**Contracts And Acceptance**

- Runtime contract exposes proactive purpose/context and reply metadata.
  [`runtime-contract.ts:21`](../../packages/contracts/src/runtime-contract.ts#L21)

- Proactive fixture validates the new cross-language request shape.
  [`proactive-check-in-request.json:1`](../../packages/contracts/runtime/fixtures/valid/proactive-check-in-request.json#L1)

- Production acceptance rejects bad recent proactive MAF evidence.
  [`maf-production-acceptance.sh:101`](../../scripts/maf-production-acceptance.sh#L101)

**Tests**

- Router test locks no-fallback proactive primary failures.
  [`agent-runtime-router.test.ts:317`](../../packages/application/src/use-cases/agent-runtime-router.test.ts#L317)

- Runtime test locks proactive side-effect boundaries.
  [`maf-primary-agent-runtime.test.ts:232`](../../packages/application/src/use-cases/maf-primary-agent-runtime.test.ts#L232)

- Worker tests cover stale jobs and post-commit probe write failures.
  [`conversation.processor.test.ts:389`](../../apps/worker/src/conversation/conversation.processor.test.ts#L389)

- Python endpoint tests cover probe metadata true/false paths.
  [`test_runtime_endpoint.py:169`](../../agent-service/tests/unit/test_runtime_endpoint.py#L169)

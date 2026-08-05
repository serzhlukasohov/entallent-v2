---
baseline_commit: c9102339d6b6553b8cd4c4b5e45472cc3484a419
---

# Story 2.6: Define Runtime Retry Budget And Error Mapping

Status: ready-for-dev
Epic: 2 - Contract, Ledger, And Side-Effect Safety
Story ID: 2.6

## Story

As an engineer,
I want runtime errors and retries to share one attempt budget,
so that BullMQ, HTTP, Python workflow, model calls, and tool calls do not multiply work for one Slack event.

## Acceptance Criteria

1. Given a runtime HTTP call fails, when TypeScript classifies the error, then the classification includes error code, HTTP status, retryable, fallback allowed, side-effect barrier status, runtime attempt number, and diagnostic fields.
2. Given Python retries model or tool calls, when it returns diagnostics, then retry count and runtime attempt number are included in the runtime result contract and validated by both TypeScript and Python fixtures.
3. Given BullMQ retries the same Slack event, when the worker invokes the runtime boundary again, then the one-based BullMQ attempt number remains the runtime attempt number used by the retry budget, error classification, fallback barrier, and attempt ledger.
4. Given the fallback barrier is closed or unknown, when a runtime error is classified, then `fallbackAllowed` is false even if the error category would otherwise be retryable.
5. Given this story is complete, when the diff is inspected, then no `MafAgentRuntimeClient`, `agent-service`, FastAPI route, Python workflow, model retry loop, tool retry loop, side-effect executor, queued side effect, or production MAF routing behavior has been added.

## Tasks / Subtasks

- [ ] Add a reusable runtime error classifier. (AC: 1, 4)
  - [ ] Add a pure, framework-neutral classifier near the runtime router code, for example `packages/application/src/use-cases/runtime-error-classifier.ts`.
  - [ ] Return a stable classification shape with `errorCode`, `httpStatus`, `errorCategory`, `retryable`, `fallbackAllowed`, `barrierStatus`, `reasonCode`, `runtimeAttempt`, `traceId`, and redacted diagnostic fields.
  - [ ] Map HTTP/runtime failures to the existing contract categories: `unavailable`, `validation_error`, `timeout`, `duplicate_request`, `dependency_failed`, and `unsafe_partial_result`.
  - [ ] Apply the Story 2.5 fallback barrier decision before setting `fallbackAllowed`; closed and unknown barriers must force `fallbackAllowed: false`.
  - [ ] Keep the classifier independent of Nest, BullMQ, Drizzle, Python, FastAPI, MAF, and transport-specific exception classes. Adapters may translate concrete exceptions before calling the pure classifier.
- [ ] Define the shared retry budget model. (AC: 1, 2, 3)
  - [ ] Use the existing one-based `runtimeAttempt` propagated from `ConversationProcessor.runtimeAttemptNumberFromJob(job)` as the only whole-job attempt number.
  - [ ] Define diagnostic counters for runtime-internal retries: at minimum total `retryCount`, `modelRetryCount`, `toolRetryCount`, and `httpRetryCount`.
  - [ ] Do not add separate whole-job retry counters in Python, HTTP, or the runtime router.
  - [ ] Document or encode that HTTP retry is allowed only for idempotent unavailable failures before side effects, and only within the current runtime attempt.
  - [ ] Preserve worker ownership of whole-job retries; do not change BullMQ attempt configuration unless the change is explicitly required and tested.
- [ ] Extend the canonical runtime contract if needed. (AC: 2)
  - [ ] Update `packages/contracts/runtime/openapi.json` first because OpenAPI 3.1 is the canonical runtime schema source.
  - [ ] Keep TypeScript and Python validators aligned with the OpenAPI schema in `packages/contracts/src/runtime-contract.ts`, `packages/contracts/src/runtime-contract-validation.ts`, and `packages/contracts/runtime/validate_fixtures.py`.
  - [ ] Update shared fixtures and `packages/contracts/runtime/fixtures/manifest.json` so valid runtime results include retry diagnostics and invalid results reject malformed retry/attempt values.
  - [ ] Preserve synthetic fixture data only; do not add real Slack IDs, user text, workspace IDs, or production event IDs.
- [ ] Wire classification to the existing TypeScript-side control points without adding a MAF client. (AC: 1, 3, 4, 5)
  - [ ] Reuse `AgentRuntimeRouter.executeTypeScriptFallback` and `RuntimeFallbackBarrierService`; do not create a second fallback path.
  - [ ] Add adapter tests or helper seams that simulate a future runtime HTTP failure and prove the classifier consumes the barrier decision.
  - [ ] Record runtime retry/error diagnostics in the current attempt ledger where the existing schema supports it. If the existing ledger cannot store structured diagnostics without a migration, store a stable failure reason now and explicitly leave full shadow diagnostics persistence to Story 3.2.
  - [ ] Do not introduce production routing to MAF. While no client exists, `typescript`, `maf_disabled`, `maf_shadow`, and `maf_canary` must still delegate to `TypeScriptAgentRuntime` as they do now.
- [ ] Add focused tests. (AC: 1-5)
  - [ ] Add classifier table tests for every error category, representative HTTP statuses, retryable true/false cases, and fallback barrier open/closed/unknown decisions.
  - [ ] Add contract fixture tests proving TypeScript and Python validators both accept valid retry diagnostics and reject invalid retry counters or missing runtime attempt diagnostics if required by the schema.
  - [ ] Add worker/application tests proving BullMQ `attemptsMade` maps to one-based `runtimeAttempt` and no additional whole-job attempt counter is introduced.
  - [ ] Add regression tests proving current TypeScript-only router behavior is unchanged while no MAF HTTP client exists.
- [ ] Run and record verification. (AC: 1-5)
  - [ ] Run `pnpm --filter @entalent/contracts test`.
  - [ ] Run `pnpm --filter @entalent/application test`.
  - [ ] Run `pnpm --filter @entalent/worker test`.
  - [ ] Run `pnpm --filter @entalent/application build`.
  - [ ] Run `pnpm --filter @entalent/worker build`.
  - [ ] Run `pnpm --filter @entalent/database test:integration` if `DATABASE_URL` is available; otherwise record the skip reason.
  - [ ] Run `pnpm test`.
  - [ ] Run `git diff --check`.

## Dev Notes

### Current State

- Story 2.1 made `packages/contracts/runtime/openapi.json` the canonical neutral OpenAPI 3.1 runtime schema source.
- Story 2.2 and Story 2.3 established shared runtime request/result fixtures, TypeScript validation, Python validation, and the canonical action envelope.
- Story 2.4 added persisted runtime attempt/action ledgers. Attempts are keyed by tenant ID, request ID, event ID, message ID, and one-based runtime attempt. Phase transitions are monotonic and failures must not overwrite terminal side-effect phases.
- Story 2.5 added a fallback barrier classifier and worker service. MAF-to-TypeScript fallback is open only before committed side effects, closed after `actions_committed` or `reply_committed`, and unknown for missing/malformed/non-MAF attempt state.
- `AgentRuntimeRouter` still delegates all modes to `TypeScriptAgentRuntime`; the current branch intentionally has no Python service or MAF HTTP client.
- `ProcessMessageRequest` in `packages/application/src/ports/agent-runtime.port.ts` already carries optional `requestId`, `eventId`, and `runtimeAttempt` for the current shim boundary.
- `RuntimeDiagnostics` in `packages/contracts/src/runtime-contract.ts` currently contains `traceId`, `runtimeVersion`, `modelCalls`, `toolCalls`, and `latencyMs`; it does not yet include retry counters or runtime attempt diagnostics.
- `RuntimeErrorResponse` already includes `traceId`, `errorCategory`, `retryable`, `fallbackAllowed`, and `message`; Story 2.6 owns the richer TypeScript-side classification that also includes HTTP status, error code, barrier status, and diagnostics.

### Required Retry Semantics

- The whole-job attempt number is exactly the one-based `runtimeAttempt` derived from BullMQ `attemptsMade + 1`.
- BullMQ owns whole-job retries. HTTP, model, and tool retries are local retries inside the same runtime attempt and must be reported as diagnostics, not treated as new runtime attempts.
- HTTP retry is allowed only for idempotent unavailable failures before side effects. Validation errors, duplicate requests, unsafe partial results, and closed/unknown fallback barriers must not trigger TypeScript fallback.
- Python may later retry model/tool calls only inside the attempt budget and must report retry counters in diagnostics. This story defines and validates the counters but must not implement Python workflow retry loops.
- All diagnostic fields must be redacted and identifier-only. Do not log Slack message text, reply text, risk evidence, memory content, action payloads, model prompts, tool payloads, or raw provider errors.

### Error Mapping Guidance

Use stable categories and reason codes so future adapters can map concrete exceptions consistently:

| Scenario | Category | Suggested HTTP Status | Retryable | Fallback Allowed |
| --- | --- | ---: | --- | --- |
| runtime service unreachable | `unavailable` | 503 | true | only if barrier open |
| runtime timeout before side effects | `timeout` | 504 | true | only if barrier open |
| malformed runtime request/result | `validation_error` | 400 or 422 | false | false |
| duplicate request/idempotency conflict | `duplicate_request` | 409 | false | false |
| downstream dependency failed | `dependency_failed` | 502 | depends on idempotency | only if barrier open and retryable |
| partial result after possible side effect | `unsafe_partial_result` | 500 | false | false |

The implementation may refine reason-code names, but they must be stable, lower_snake_case, and tested.

### Architecture Constraints

- AD-1: runtime switching remains behind `AgentRuntimePort.processMessage`.
- AD-2 and AD-10: TypeScript remains the first-slice policy and side-effect owner.
- AD-5 and AD-15: fallback stops at the first side effect and must use the persisted ledger, not process-local state.
- AD-17: retry budgets are layered and shared; do not multiply retries across BullMQ, HTTP, Python workflow, model calls, and tool calls.
- AD-18: full shadow diagnostics persistence belongs to the TypeScript-owned canonical shadow diagnostics record in Epic 3. Do not add a parallel diagnostics store in this story.
- AD-19: `agent-service/` is a later deployable unit; do not scaffold it here.

### Previous Story Intelligence

- Preserve the router-owned `executeTypeScriptFallback` hook added in Story 2.5; future MAF fallback paths must go through it.
- Preserve explicit `unknown` fallback barrier behavior for missing durable metadata. Do not fabricate `requestId`, `eventId`, or `runtimeAttempt` values.
- Preserve the rule that non-MAF runtime modes cannot open the MAF fallback barrier.
- Preserve runtime ledger monotonicity: duplicate started-attempt writes must not rewind phase or failure state, and failures must not overwrite `actions_committed` or `reply_committed`.
- Story 2.5 review dismissed atomic fallback/action concurrency as future work until real MAF/action execution exists. Do not add database locks or transactional action execution in Story 2.6 unless the implementation introduces an actual side-effect execution surface, which this story forbids.

### File Structure Guidance

- Expected update files:
  - `packages/application/src/use-cases/agent-runtime-router.ts`
  - `packages/application/src/use-cases/agent-runtime-router.test.ts`
  - `packages/application/src/ports/agent-runtime.port.ts`
  - `apps/worker/src/conversation/conversation.processor.ts`
  - `apps/worker/src/conversation/conversation.module.ts`
  - `apps/worker/src/conversation/runtime-fallback-barrier.service.ts`
  - `apps/worker/src/conversation/runtime-ledger.repository.ts`
- Likely new files:
  - `packages/application/src/use-cases/runtime-error-classifier.ts`
  - `packages/application/src/use-cases/runtime-error-classifier.test.ts`
- Update only if the runtime diagnostics/error contract changes:
  - `packages/contracts/runtime/openapi.json`
  - `packages/contracts/src/runtime-contract.ts`
  - `packages/contracts/src/runtime-contract-validation.ts`
  - `packages/contracts/src/runtime-contract.test.ts`
  - `packages/contracts/runtime/validate_fixtures.py`
  - `packages/contracts/runtime/fixtures/manifest.json`
  - `packages/contracts/runtime/fixtures/valid/*.json`
  - `packages/contracts/runtime/fixtures/invalid/*.json`
- Avoid unless explicitly justified:
  - `packages/database/migrations/`; prefer existing ledger fields unless structured diagnostics truly require schema changes before Story 3.2.
- Out of scope:
  - `agent-service/`
  - `MafAgentRuntimeClient`
  - FastAPI routes
  - MAF workflow code
  - Python model/tool retry loops
  - production MAF routing branches
  - action executors or domain write paths
  - queued side effects
  - shadow diagnostics persistence table

### Testing Requirements

- Prefer pure unit tests for classifier matrix coverage before wiring tests.
- Contract updates require shared fixture validation in both languages; do not update TypeScript types without Python validator parity.
- Application and worker verification should be run sequentially when builds are involved because previous Epic 1 retrospective notes warned that dependent package builds can clean upstream `dist` directories.
- Full `pnpm --filter @entalent/application lint` may still fail on pre-existing `no-explicit-any` errors in unrelated older tests. If lint is needed, run targeted eslint for changed files and record any pre-existing full-lint limitation.

## References

- `_bmad-output/planning-artifacts/epics.md` - Epic 2 Story 2.6 requirements and FR25.
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md` - AD-1, AD-2, AD-5, AD-10, AD-15, AD-17, AD-18, AD-19, and runtime error convention.
- `_bmad-output/specs/spec-maf-runtime-migration/runtime-contract.md` - canonical schema source, runtime diagnostics, runtime error response, and side-effect rule.
- `_bmad-output/implementation-artifacts/2-5-enforce-fallback-barrier-from-ledger-state.md` - fallback barrier implementation details and review fixes to preserve.
- `packages/contracts/runtime/openapi.json` - canonical runtime HTTP schema.
- `packages/contracts/src/runtime-contract.ts` - TypeScript runtime contract types.
- `packages/contracts/runtime/validate_fixtures.py` - Python fixture validator.
- `packages/application/src/use-cases/agent-runtime-router.ts` - current runtime decision point and fallback hook.
- `packages/application/src/use-cases/runtime-fallback-barrier.ts` - current fallback barrier classifier.
- `apps/worker/src/conversation/conversation.processor.ts` - BullMQ-to-runtime attempt propagation.
- `apps/worker/src/conversation/conversation.module.ts` - router provider and ledger/fallback wiring.
- `apps/worker/src/conversation/runtime-ledger.repository.ts` - runtime attempt/action ledger.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story created from sprint backlog after Story 2.5 was marked done at commit `c9102339d6b6553b8cd4c4b5e45472cc3484a419`.
- Loaded BMAD create-story workflow, config, sprint status, Epic 2 Story 2.6 requirements, architecture spine AD-17/error convention, runtime contract, current contract types, router, worker wiring, fallback barrier, and previous Story 2.5 review notes.
- No `project-context.md` or UX artifact was found; this story is backend/runtime control-plane and contract work.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Story 2.6 is ready for dev-story execution.
- Guardrails explicitly prevent early `agent-service`, `MafAgentRuntimeClient`, FastAPI route, MAF workflow, retry-loop, side-effect executor, production routing, and shadow diagnostics persistence work.

### File List

- `_bmad-output/implementation-artifacts/2-6-define-runtime-retry-budget-and-error-mapping.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Change Log

- 2026-08-05: Created Story 2.6 developer context from Epic 2, architecture spine, runtime contract, existing contract/router/worker code, and Story 2.5 review learnings.

---
baseline_commit: d6a809a34f3e9c0c96857e48178936989ca71be4
---

# Story 2.5: Enforce Fallback Barrier From Ledger State

Status: done
Epic: 2 - Contract, Ledger, And Side-Effect Safety
Story ID: 2.5

## Story

As an operator,
I want fallback to TypeScript blocked after committed side effects,
so that retries cannot duplicate replies, memories, or follow-ups.

## Acceptance Criteria

1. Given a MAF attempt fails before candidate receipt or action execution, when the fallback barrier checks the persisted runtime attempt ledger, then fallback to TypeScript is allowed and the decision includes the attempt phase and trace ID.
2. Given the ledger is at `actions_committed` or `reply_committed`, when the MAF path fails or times out, then fallback to TypeScript is forbidden and the guard returns a stable reason code without invoking `TypeScriptAgentRuntime` as fallback.
3. Given the same Slack event is retried by BullMQ, when the barrier checks fallback eligibility, then it uses the durable request ID, event ID, message ID, tenant ID, and one-based runtime attempt number rather than process-local state.
4. Given the runtime attempt row is missing, malformed, or unreadable, when fallback eligibility is classified, then the result is explicit (`allowed`, `forbidden`, or `unknown`) and never silently treats a closed barrier as open.
5. Given this story is complete, when the diff is inspected, then no `MafAgentRuntimeClient`, `agent-service`, FastAPI route, Python workflow, action executor, queued side effect, or production MAF routing behavior has been added.

## Tasks / Subtasks

- [x] Add a reusable fallback-barrier classifier. (AC: 1, 2, 4)
  - [x] Add a small framework-neutral classifier in `packages/application/src/use-cases/` or a nearby runtime module.
  - [x] Classify `started`, `candidate_received`, `actions_validated`, and `failed` as fallback-open for the current first slice.
  - [x] Classify `actions_committed` and `reply_committed` as fallback-closed.
  - [x] Return stable reason codes such as `fallback_open_before_side_effect`, `fallback_closed_after_actions_committed`, `fallback_closed_after_reply_committed`, and `fallback_barrier_unknown`.
  - [x] Keep the classifier pure and independent of Drizzle, Nest, BullMQ, Python, HTTP, and MAF framework types.
- [x] Add runtime ledger read support needed by the barrier. (AC: 1, 3, 4)
  - [x] Extend `RuntimeLedgerRepository` with a tenant-scoped lookup by durable attempt key: tenant ID, request ID, event ID, message ID, and runtime attempt.
  - [x] Return only the fields needed for fallback classification: attempt ID, trace ID, runtime mode, runtime attempt, phase, and failure reason if present.
  - [x] Do not mutate phase while reading fallback eligibility.
  - [x] Treat unknown phase values as invalid/unknown even though the database now has enum-like check constraints.
- [x] Add a worker-side barrier adapter around the repository. (AC: 1, 2, 3, 4)
  - [x] Register a Nest-compatible service near `apps/worker/src/conversation/runtime-ledger.repository.ts`, for example `RuntimeFallbackBarrierService`.
  - [x] Map `ProcessMessageRequest` ledger metadata to the repository durable-key lookup.
  - [x] Return an explicit fallback decision object with `allowed`, `barrierStatus`, `reasonCode`, `phase`, `traceId`, and `runtimeAttempt`.
  - [x] Log only non-content identifiers and reason codes; do not log Slack text, reply text, classification payloads, risk evidence, memory content, or action payloads.
- [x] Wire the guard to the runtime failure decision point without changing current routing behavior. (AC: 2, 5)
  - [x] Add an optional runtime-router or worker-level hook that future MAF failure handling must call before falling back to `TypeScriptAgentRuntime`.
  - [x] Preserve current `AgentRuntimeRouter` behavior: until a real `MafAgentRuntimeClient` exists, all modes still delegate to the existing TypeScript runtime path exactly as they do now.
  - [x] Do not block normal TypeScript runtime failures using the MAF fallback barrier; the barrier is for MAF-to-TypeScript fallback only.
  - [x] Do not add the MAF HTTP client, Python service, FastAPI route, workflow code, or production MAF routing branch in this story.
- [x] Add focused tests. (AC: 1-5)
  - [x] Add pure classifier tests for every ledger phase and unknown/malformed phase handling.
  - [x] Add worker repository tests for durable-key lookup, tenant scoping, missing attempt handling, and no phase mutation.
  - [x] Add barrier adapter tests proving closed phases forbid fallback and open phases allow fallback.
  - [x] Add a regression test proving current router delegation to `TypeScriptAgentRuntime` is unchanged for `typescript`, `maf_disabled`, `maf_shadow`, and `maf_canary` modes while no MAF client exists.
  - [x] Add a guard test proving a closed barrier decision does not call the fallback TypeScript runtime in the simulated MAF-failure path.
- [x] Run and record verification. (AC: 1-5)
  - [x] Run `pnpm --filter @entalent/application test`.
  - [x] Run `pnpm --filter @entalent/worker test`.
  - [x] Run `pnpm --filter @entalent/application build`.
  - [x] Run `pnpm --filter @entalent/worker build`.
  - [x] Run `pnpm --filter @entalent/database test:integration` if `DATABASE_URL` is available; otherwise record the skip reason.
  - [x] Run `pnpm test`.
  - [x] Run `git diff --check`.

### Review Findings

- [x] [Review][Patch] Fallback guard is not wired to the runtime router fallback hook [packages/application/src/use-cases/agent-runtime-router.ts:80]
- [x] [Review][Patch] Missing durable metadata is converted into fabricated lookup keys [apps/worker/src/conversation/runtime-fallback-barrier.service.ts:24]
- [x] [Review][Patch] Fallback classifier ignores runtime mode [packages/application/src/use-cases/runtime-fallback-barrier.ts:53]
- [x] [Review][Patch] Story baseline commit does not resolve as a full SHA [_bmad-output/implementation-artifacts/2-5-enforce-fallback-barrier-from-ledger-state.md:2]

## Dev Notes

### Current State

- Story 2.4 created persisted runtime attempt and action ledgers. The repository can create idempotent started attempts, transition phases monotonically, record canonical action envelopes atomically, and reject tenant-mismatched action writes.
- Story 2.4 review moved ledger attempt recording behind `AgentRuntimeRouter` decision/failure callbacks so the ledger stores the exact resolved runtime mode.
- `AgentRuntimeRouter` still delegates every mode to `TypeScriptAgentRuntime`; `maf_shadow`, `maf_canary`, and `maf_disabled` do not call Python or a MAF HTTP client yet.
- `ConversationProcessor` passes `requestId`, `eventId`, and one-based `runtimeAttempt` into `AgentRuntimePort.processMessage`.
- `RuntimeLedgerRepository.markFailed` is monotonic: after `actions_committed`, failed cannot overwrite the terminal side-effect state. This is intentional and should be preserved.
- The current ledger phase set is `started`, `candidate_received`, `actions_validated`, `actions_committed`, `reply_committed`, and `failed`.

### Required Barrier Semantics

- The ledger is the source of truth for fallback eligibility. Do not infer barrier state from local variables, caught exceptions, process memory, or logs.
- The closed barrier states are `actions_committed` and `reply_committed`; fallback to TypeScript after those states risks duplicate side effects.
- Open states are only safe before committed side effects. In this first slice, `started`, `candidate_received`, `actions_validated`, and `failed` may be classified as fallback-open because no domain write or Slack reply has been committed by MAF.
- Missing or unreadable ledger state must be explicit. Prefer a conservative `unknown` decision over silently allowing fallback.
- This story may define barrier decision vocabulary, but Story 2.6 owns the broader runtime retry budget and HTTP-style error mapping.

### Architecture Constraints

- AD-1: runtime switching remains behind `AgentRuntimePort.processMessage`.
- AD-2 and AD-10: TypeScript remains the first-slice policy and side-effect owner. The barrier must not let MAF output bypass deterministic validation, consent, quiet hours, risk, survey, duplicate-prevention, or persistence policies.
- AD-5: fallback stops at the first side effect.
- AD-13: `AgentRuntimeRouter` owns runtime mode selection per job.
- AD-15: fallback is forbidden after the attempt ledger reaches `actions_committed` or `reply_committed`.
- AD-17: use the same one-based runtime attempt number propagated from BullMQ. Do not invent a second attempt counter.

### Previous Story Intelligence

- Story 2.1 established `packages/contracts/runtime/openapi.json` as the canonical neutral OpenAPI 3.1 runtime schema source.
- Story 2.2 hardened shared TypeScript and Python contract fixtures; avoid creating a separate barrier payload contract unless it is needed by the runtime HTTP boundary.
- Story 2.3 hardened action lifecycle states; committed actions require valid validation and a non-null commit marker.
- Story 2.4 review findings to preserve:
  - Duplicate started-attempt writes must not rewind phase or failure state.
  - Runtime failures must be persisted without overwriting terminal side-effect phases.
  - Phase transitions must remain monotonic.
  - Action writes must stay tenant-scoped, atomic, and canonical validated.
  - Database enum-like checks now live in `0007_runtime_ledger_checks.sql`.

### File Structure Guidance

- Expected update files:
  - `packages/application/src/use-cases/agent-runtime-router.ts`
  - `packages/application/src/use-cases/agent-runtime-router.test.ts`
  - `apps/worker/src/conversation/runtime-ledger.repository.ts`
  - `apps/worker/src/conversation/runtime-ledger.repository.test.ts`
  - `apps/worker/src/conversation/conversation.module.ts`
- Likely new files:
  - `packages/application/src/use-cases/runtime-fallback-barrier.ts`
  - `packages/application/src/use-cases/runtime-fallback-barrier.test.ts`
  - `apps/worker/src/conversation/runtime-fallback-barrier.service.ts`
  - `apps/worker/src/conversation/runtime-fallback-barrier.service.test.ts`
- Avoid unless justified:
  - `packages/contracts/runtime/openapi.json`; the fallback barrier is internal TypeScript control-plane state unless the runtime HTTP error contract is explicitly extended.
  - `packages/database/migrations/`; Story 2.4 already created the required ledger columns and check constraints.
- Out of scope:
  - `agent-service/`
  - `MafAgentRuntimeClient`
  - FastAPI routes
  - MAF workflow code
  - action executors or domain write paths
  - queued side effects
  - shadow diagnostics persistence
  - canary rollout behavior changes

### Testing Requirements

- Tests must show every ledger phase maps to exactly one fallback barrier result.
- Tests must prove closed phases do not fall back to `TypeScriptAgentRuntime` in the simulated MAF failure path.
- Tests must prove existing TypeScript-only behavior is unchanged while no MAF client exists.
- Repository and service tests must include tenant mismatch/missing-attempt cases.
- If database integration tests cannot run because `DATABASE_URL` is absent, record the skipped command and reason in the Dev Agent Record.

## References

- `_bmad-output/planning-artifacts/epics.md` - Epic 2 Story 2.5 requirements and FR14/FR25 mapping.
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md` - AD-1, AD-2, AD-5, AD-10, AD-13, AD-15, AD-17.
- `_bmad-output/specs/spec-maf-runtime-migration/runtime-contract.md` - side-effect rule and runtime error response target.
- `_bmad-output/implementation-artifacts/2-4-add-runtime-attempt-and-action-ledgers.md` - ledger implementation details and review fixes to preserve.
- `packages/application/src/use-cases/agent-runtime-router.ts` - current runtime decision point and TypeScript delegation behavior.
- `apps/worker/src/conversation/runtime-ledger.repository.ts` - durable attempt/action ledger writer and phase transition rules.
- `apps/worker/src/conversation/conversation.module.ts` - current router provider and ledger callback wiring.
- `apps/worker/src/conversation/conversation.processor.ts` - source of durable request/event/runtime-attempt metadata.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story created from sprint backlog after Story 2.4 was marked done at commit `d6a809a`.
- Loaded BMAD create-story workflow, config, epics, architecture spine, runtime contract, and previous Story 2.4 review notes.
- No `project-context.md` or UX artifact was found; this story is backend/runtime control-plane work.
- Started implementation from baseline `d6a809a34f3e9c0c96857e48178936989ca71be4`.
- RED: `pnpm --filter @entalent/application test -- runtime-fallback-barrier.test.ts` failed while the classifier module did not exist.
- GREEN: `pnpm --filter @entalent/application test -- runtime-fallback-barrier.test.ts` passed with 15 tests.
- RED: `pnpm --filter @entalent/worker test -- runtime-ledger.repository.test.ts` failed while durable-key fallback lookup did not exist.
- GREEN: `pnpm --filter @entalent/worker test -- runtime-ledger.repository.test.ts` passed with 20 tests.
- RED: `pnpm --filter @entalent/worker test -- runtime-fallback-barrier.service.test.ts` failed while the worker barrier service did not exist.
- GREEN: `pnpm --filter @entalent/worker test -- runtime-fallback-barrier.service.test.ts` passed with 7 tests.
- Verification: `pnpm --filter @entalent/application test` passed with 155 tests.
- Verification: `pnpm --filter @entalent/worker test` passed with 35 tests.
- Verification: `pnpm --filter @entalent/application build` passed.
- Verification: `pnpm --filter @entalent/worker build` passed.
- Verification: `pnpm --filter @entalent/database test:integration` ran and skipped 14 tests because `DATABASE_URL` is not set in this local environment.
- Verification: targeted eslint for changed application and worker files passed.
- Note: full `pnpm --filter @entalent/application lint` still fails on pre-existing `no-explicit-any` errors in unrelated older test files; no current Story 2.5 files are affected.
- Full regression: `pnpm test` passed with 15 successful turbo tasks.
- Verification: `git diff --check` passed.
- BMAD code review found 4 patch findings, 0 decision findings, 0 deferred findings, and 1 dismissed future concurrency finding outside this story's implemented MAF/action execution surface.
- Review fix: added router-owned `executeTypeScriptFallback` hook and wired the worker router provider to `RuntimeFallbackBarrierService`.
- Review fix: missing `requestId`, `eventId`, or one-based `runtimeAttempt` now returns explicit `unknown` without querying synthetic durable keys.
- Review fix: fallback classifier now treats non-MAF runtime modes as `unknown` instead of opening MAF-to-TypeScript fallback.
- Review fix: corrected Story 2.5 `baseline_commit` to the resolvable full commit `d6a809a34f3e9c0c96857e48178936989ca71be4`.
- Review verification: `pnpm --filter @entalent/application test -- runtime-fallback-barrier.test.ts agent-runtime-router.test.ts` passed with 47 tests.
- Review verification: `pnpm --filter @entalent/application build` passed.
- Review verification: `pnpm --filter @entalent/worker test -- runtime-fallback-barrier.service.test.ts runtime-ledger.repository.test.ts` passed with 32 tests.
- Review verification: `pnpm --filter @entalent/application test` passed with 160 tests.
- Review verification: `pnpm --filter @entalent/worker test` passed with 40 tests.
- Review verification: `pnpm --filter @entalent/worker build` passed.
- Review verification: targeted eslint for changed application and worker files passed.
- Review full regression: `pnpm test` passed with 15 successful turbo tasks.
- Review verification: `git diff --check` passed.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Added pure runtime fallback barrier classifier with explicit open, closed, and unknown decisions.
- Added `executeRuntimeFallbackIfAllowed` and `RuntimeFallbackBlockedError` so future MAF-to-TypeScript fallback paths cannot invoke fallback when the durable barrier is closed or unknown.
- Added tenant-scoped durable runtime attempt lookup for fallback classification without mutating ledger phase.
- Added `RuntimeFallbackBarrierService` as the worker-side adapter around the repository and registered it in `ConversationModule`.
- Preserved current router behavior: all runtime modes still delegate to `TypeScriptAgentRuntime` while no MAF client exists.
- BMAD review findings resolved: future MAF fallback is now structurally routed through the router fallback hook, malformed durable metadata cannot produce a synthetic lookup, non-MAF runtime modes cannot open the MAF fallback barrier, and the baseline commit is resolvable.
- No `MafAgentRuntimeClient`, `agent-service`, FastAPI route, Python workflow, action executor, queued side effect, or production MAF routing behavior was added.

### File List

- `_bmad-output/implementation-artifacts/2-5-enforce-fallback-barrier-from-ledger-state.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/worker/src/conversation/conversation.module.ts`
- `apps/worker/src/conversation/runtime-fallback-barrier.service.test.ts`
- `apps/worker/src/conversation/runtime-fallback-barrier.service.ts`
- `apps/worker/src/conversation/runtime-ledger.repository.test.ts`
- `apps/worker/src/conversation/runtime-ledger.repository.ts`
- `packages/application/src/index.ts`
- `packages/application/src/use-cases/agent-runtime-router.test.ts`
- `packages/application/src/use-cases/runtime-fallback-barrier.test.ts`
- `packages/application/src/use-cases/runtime-fallback-barrier.ts`

### Change Log

- 2026-08-05: Created Story 2.5 developer context from Epic 2, architecture spine, runtime contract, and Story 2.4 review learnings.
- 2026-08-05: Implemented fallback barrier classifier, durable ledger lookup, worker adapter, tests, and verification for Story 2.5.
- 2026-08-05: Resolved BMAD code-review findings and marked Story 2.5 done.

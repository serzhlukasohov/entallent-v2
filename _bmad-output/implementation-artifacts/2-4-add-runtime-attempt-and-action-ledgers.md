---
baseline_commit: 5249c1478b17459db17871cd8a440bd75a55a53c
---

# Story 2.4: Add Runtime Attempt And Action Ledgers

Status: done
Epic: 2 - Contract, Ledger, And Side-Effect Safety
Story ID: 2.4

## Story

As an operator,
I want runtime attempts and action execution persisted,
so that fallback decisions are based on durable state rather than process-local guesses.

## Acceptance Criteria

1. Given a runtime attempt starts, when the worker records it, then the ledger stores request ID, event ID, message ID, runtime attempt, trace ID, runtime mode, and phase.
2. Given action validation or execution advances, when the ledger is updated, then phases include at least `started`, `candidate_received`, `actions_validated`, `actions_committed`, `reply_committed`, and `failed`.
3. Given TypeScript receives proposed action envelopes, when they are recorded for an attempt, then each action ledger row stores the action ID, aggregate type, action type, idempotency key, validation result, execution status, commit marker, and JSON payload without executing a domain write.
4. Given the same request/action is recorded more than once, when the ledger repository handles the write, then persisted uniqueness or upsert behavior prevents duplicate attempts and duplicate action rows for the same durable idempotency scope.
5. Given this story is complete, when the diff is inspected, then no fallback barrier enforcement, action executor, domain write path, queued side effect, `MafAgentRuntimeClient`, `agent-service`, FastAPI route, MAF workflow, or production MAF routing behavior has been added.

## Tasks / Subtasks

- [x] Add persisted runtime ledger schema. (AC: 1, 2, 4)
  - [x] Add Drizzle schema files under `packages/database/src/schema/` for runtime attempts and runtime actions, following existing table-per-file patterns.
  - [x] Export the new schema from `packages/database/src/schema/index.ts` so `@entalent/database` consumers can import it.
  - [x] Generate or add a Drizzle migration under `packages/database/migrations/` plus matching migration metadata.
  - [x] Use Postgres durable state, not Redis TTL state, for the side-effect barrier foundation.
  - [x] Include tenant scoping and references to existing durable IDs where available: `tenant_id`, request ID, event ID, `messages.id`, runtime attempt number, trace ID, runtime mode, and phase.
  - [x] Add indexes for lookup by trace ID, message ID, request/event ID, and attempt phase.
  - [x] Add uniqueness for the idempotency scope that prevents duplicate attempt rows for the same request/event/message/runtime-attempt combination.
- [x] Model action ledger rows from the canonical action envelope. (AC: 2, 3, 4)
  - [x] Store action rows linked to a runtime attempt row.
  - [x] Persist `actionId`, `aggregateType`, `actionType`, `idempotencyKey`, `payload`, `validationResult`, `executionStatus`, and `commitMarker`.
  - [x] Keep payload, validation result, and commit marker JSON-compatible with `packages/contracts/runtime/openapi.json` and `packages/contracts/src/runtime-contract.ts`.
  - [x] Add uniqueness for action idempotency within the attempt and tenant scope.
  - [x] Do not introduce generic action execution blobs beyond the canonical envelope fields.
- [x] Add a worker-side repository for ledger writes. (AC: 1, 2, 3, 4)
  - [x] Add a Nest-compatible repository under `apps/worker/src/conversation/` or a clearly named subfolder near runtime orchestration code.
  - [x] Provide methods to create or upsert a started attempt, transition an attempt phase, record candidate receipt, record action envelopes, mark actions committed, mark reply committed, and mark failed.
  - [x] Make repository methods idempotent for retry-safe writes.
  - [x] Register the repository in `apps/worker/src/conversation/conversation.module.ts` only if needed by this story's worker recording path.
- [x] Record attempt start without changing runtime routing behavior. (AC: 1, 5)
  - [x] If integrating into `ConversationProcessor`, record the started attempt before calling `AGENT_RUNTIME_PORT`.
  - [x] Derive runtime attempt number from BullMQ job attempt state consistently and document the mapping in code/tests.
  - [x] Preserve current `AgentRuntimeRouter` behavior: it still delegates to `TypeScriptAgentRuntime` for every mode until later stories add a MAF client.
  - [x] Do not enforce the fallback barrier in this story; Story 2.5 owns fallback decisions from ledger state.
- [x] Add focused tests. (AC: 1, 2, 3, 4, 5)
  - [x] Add database integration coverage for schema constraints, uniqueness, attempt phase updates, and action row persistence.
  - [x] Add worker repository unit or integration coverage for idempotent upserts and phase transitions.
  - [x] Add a guard test or diff-level assertion where practical that no action execution/domain write is triggered by recording action envelopes.
  - [x] Preserve existing runtime router tests and add only scoped tests if any behavior is touched.
- [x] Run and record verification. (AC: 1-5)
  - [x] Run `pnpm --filter @entalent/database typecheck`.
  - [x] Run `pnpm --filter @entalent/database test:integration` if a test database is available.
  - [x] Run `pnpm --filter @entalent/database lint`.
  - [x] Run `pnpm --filter @entalent/database build`.
  - [x] Run `pnpm --filter @entalent/worker typecheck`.
  - [x] Run `pnpm --filter @entalent/worker test` or targeted worker tests.
  - [x] Run `pnpm test`.
  - [x] Run `git diff --check`.

### Review Findings

- [x] [Review][Patch] Duplicate started-attempt upsert can rewind durable phase state [apps/worker/src/conversation/runtime-ledger.repository.ts:60]
- [x] [Review][Patch] Runtime failures are not persisted as failed attempts [apps/worker/src/conversation/conversation.processor.ts:124]
- [x] [Review][Patch] Phase transitions can regress terminal attempt states [apps/worker/src/conversation/runtime-ledger.repository.ts:85]
- [x] [Review][Patch] Runtime mode ledger is hardcoded to TypeScript before router mode resolution [apps/worker/src/conversation/conversation.processor.ts:101]
- [x] [Review][Patch] Action idempotency upsert handles only one of two unique action constraints [apps/worker/src/conversation/runtime-ledger.repository.ts:163]
- [x] [Review][Patch] Multi-action ledger writes are not atomic [apps/worker/src/conversation/runtime-ledger.repository.ts:145]
- [x] [Review][Patch] Action ledger rows can cross tenant scope through mismatched attempt IDs [packages/database/src/schema/runtime-actions.ts:17]
- [x] [Review][Patch] Ledger persistence can store malformed action fields outside canonical validation [apps/worker/src/conversation/runtime-ledger.repository.ts:147]

## Dev Notes

### Current State

- Story 2.3 completed the canonical action envelope in `packages/contracts/runtime/openapi.json` and `packages/contracts/src/runtime-contract.ts`.
- The envelope can represent `validationResult`, `executionStatus`, and `commitMarker` states, including validation-failed/no-commit and committed/non-null-marker states.
- TypeScript and Python validators both validate the same runtime fixtures from `packages/contracts/runtime/fixtures/manifest.json`.
- `AgentRuntimeRouter` currently logs/evaluates runtime mode but always delegates to `TypeScriptAgentRuntime`; `maf_shadow`, `maf_canary`, and `maf_disabled` do not execute a Python runtime yet.
- `ConversationProcessor` receives `ConversationJob` data with `messageId`, `conversationId`, `userId`, `tenantId`, `externalWorkspaceId`, `externalConversationId`, and `traceId`.
- `IngestionService.saveInboundMessage` persists inbound messages and returns `messages.id`, so the ledger should treat `messageId` as an existing durable message identifier.
- Existing Slack event idempotency uses Redis with a 24-hour TTL; this is not sufficient for AD-15's persisted side-effect barrier.

### Required Ledger Semantics

- The attempt ledger is the durable source for later fallback decisions, but this story only records state.
- Minimum attempt phases: `started`, `candidate_received`, `actions_validated`, `actions_committed`, `reply_committed`, `failed`.
- Runtime mode values should align with the current application runtime modes: `typescript`, `maf_shadow`, `maf_canary`, `maf_disabled`.
- Runtime attempt numbers must be deterministic across BullMQ retries. If using BullMQ `attemptsMade`, document and test whether the persisted attempt number is zero-based or one-based.
- Action ledger rows must be linked to a runtime attempt and must be idempotent by action ID or idempotency key within the tenant/attempt scope.
- JSON columns may be used for canonical envelope substructures that are already schema-validated by the runtime contract, but they must remain JSON-compatible and not store framework objects.

### Architecture Constraints

- AD-5: fallback is allowed only before side effects; this story records the state needed to enforce that later.
- AD-10: deterministic TypeScript policy remains the side-effect owner. Do not let agent output bypass validation, quiet hours, consent, duplicate prevention, or survey rules.
- AD-14: keep the canonical runtime action shape aligned with `packages/contracts/runtime/openapi.json`.
- AD-15: user-facing MAF execution requires persisted runtime-attempt and action ledgers keyed by request, event, message, runtime attempt, and trace.
- AD-17: one runtime attempt number must propagate through the worker and future runtime path; this story must not multiply attempts independently of BullMQ retry state.
- AD-18: shadow diagnostics are a later canonical store. Do not build the shadow diagnostics table in this story unless a minimal foreign-key/link field is needed for future compatibility.

### Previous Story Intelligence

- Story 2.1 review established that canonical schema artifacts and companion docs must move in lockstep.
- Story 2.2 review found cross-language validation drift; when ledger code consumes runtime DTOs, prefer contract exports over duplicate local shapes.
- Story 2.3 review found contradictory action lifecycle states. Ledger writes must preserve the hardened lifecycle rule: `executionStatus: "committed"` requires a valid validation result and non-null commit marker; uncommitted statuses require `commitMarker: null`.
- Story 2.3 added JSON-depth and non-finite number hardening. Do not bypass validated JSON payloads with arbitrary framework objects.
- Previous stories intentionally did not scaffold `agent-service`, FastAPI routes, MAF workflow code, or `MafAgentRuntimeClient`; keep that boundary.

### File Structure Guidance

- Expected update files:
  - `packages/database/src/schema/index.ts`
  - `packages/database/src/schema/runtime-attempts.ts`
  - `packages/database/src/schema/runtime-actions.ts`
  - `packages/database/migrations/0006_*.sql`
  - `packages/database/migrations/meta/_journal.json`
  - `packages/database/migrations/meta/0006_snapshot.json`
  - `packages/database/src/__tests__/*.integration.test.ts`
  - `apps/worker/src/conversation/runtime-ledger.repository.ts`
  - `apps/worker/src/conversation/runtime-ledger.repository.test.ts`
  - `apps/worker/src/conversation/conversation.module.ts` if repository registration is needed
  - `apps/worker/src/conversation/conversation.processor.ts` only if attempt-start recording is integrated now
- Possible update files:
  - `packages/application/src/ports/agent-runtime.port.ts` only if a request ID or runtime attempt field must be added for stable ledger writes.
  - `apps/api/src/queue/queue.types.ts` only if job payloads need a durable request/event ID field not already available.
- Out-of-scope paths:
  - `agent-service/`
  - `packages/contracts/runtime/openapi.json` unless a ledger-specific contract gap is discovered and justified
  - MAF HTTP client code
  - Action executors and domain write paths
  - Shadow diagnostics persistence owned by later Epic 3 stories

### Testing Requirements

- Database tests must prove the migration creates the new tables and constraints.
- Repository tests must prove idempotent duplicate calls do not create duplicate attempts or duplicate actions.
- Phase transition tests must cover all required phase names.
- If `ConversationProcessor` is changed, add tests that attempt-start recording failures do not create duplicate side effects and that existing TypeScript runtime delegation still happens.
- If integration tests need a database and it is unavailable locally, record the skipped command and the reason in the Dev Agent Record.

### Out Of Scope

- No fallback barrier enforcement.
- No action execution.
- No domain write path for memory, goals, reminders, risk, survey, or Slack replies.
- No queued side effects.
- No MAF runtime client.
- No Python service or FastAPI route.
- No MAF workflow.
- No canary or shadow comparison behavior changes.
- No ownership transfer of business policy from TypeScript to Python.

## References

- `_bmad-output/planning-artifacts/epics.md` - Epic 2 Story 2.4 requirements and FR13/FR25 mapping.
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md` - AD-5, AD-10, AD-14, AD-15, AD-17, AD-18.
- `_bmad-output/specs/spec-maf-runtime-migration/runtime-contract.md` - action envelope lifecycle and side-effect ownership rules.
- `_bmad-output/implementation-artifacts/2-3-define-canonical-action-envelope.md` - previous story learnings and review fixes.
- `packages/contracts/runtime/openapi.json` - canonical runtime action envelope schema.
- `packages/contracts/src/runtime-contract.ts` - framework-neutral runtime DTO exports.
- `packages/database/src/schema/index.ts` - current database schema export pattern.
- `packages/database/src/schema/llm-runs.ts` - Drizzle table/index/type export pattern.
- `packages/database/migrations/meta/_journal.json` - migration journal pattern.
- `apps/worker/src/conversation/conversation.processor.ts` - current conversation job data and runtime invocation point.
- `apps/worker/src/conversation/conversation.module.ts` - provider registration pattern.
- `apps/api/src/channel/ingestion.service.ts` - durable inbound message creation and message ID source.
- `apps/api/src/channel/event-idempotency.service.ts` - existing Redis idempotency, explicitly not durable enough for this story.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Started implementation from baseline `5249c1478b17459db17871cd8a440bd75a55a53c`.
- RED: `pnpm --filter @entalent/worker test -- runtime-ledger.repository.test.ts` failed while `RuntimeLedgerRepository` did not exist.
- RED: `pnpm --filter @entalent/worker typecheck` failed while package exports and canonical action DTO usage were incomplete.
- GREEN: `pnpm --filter @entalent/worker test -- runtime-ledger.repository.test.ts` passed with 11 tests.
- Verification: `pnpm --filter @entalent/worker test` passed with 19 tests.
- Verification: `pnpm --filter @entalent/database typecheck` passed.
- Verification: `pnpm --filter @entalent/database test:integration` ran and skipped 13 tests because `DATABASE_URL` is not set in this local environment.
- Verification: `pnpm --filter @entalent/database lint` passed with existing warning-only console findings.
- Verification: `pnpm --filter @entalent/database build` passed.
- Verification: `pnpm --filter @entalent/worker typecheck` passed.
- Verification: `pnpm --filter @entalent/worker lint` passed with one existing warning-only console finding.
- Verification: `pnpm --filter @entalent/worker build` passed.
- Verification: `pnpm --filter @entalent/api typecheck` and `pnpm --filter @entalent/api build` passed after queue payload changes.
- Verification: `pnpm --filter @entalent/api lint` passed with existing warning-only console findings.
- Full regression: `pnpm test` passed with 15 successful turbo tasks.
- Verification: `git diff --check` passed.
- BMAD code review found 8 patch findings, 0 decision findings, 0 deferred findings, and 1 dismissed finding outside this story's durable-attempt scope.
- Review fix: `recordStartedAttempt` now uses conflict-do-nothing plus durable-key lookup so duplicate starts do not rewind phase or failure state.
- Review fix: runtime decisions and runtime failures are recorded from `AgentRuntimeRouter` callbacks after exact mode resolution.
- Review fix: attempt phase transitions are monotonic and terminal phases cannot regress.
- Review fix: action envelope writes are tenant-scoped, atomic, idempotent by action ID or idempotency key, and validated against canonical runtime action shape before persistence.
- Review fix: migration `0007_runtime_ledger_checks.sql` adds database-level enum-like checks for runtime attempt and action ledger columns.
- Review verification: `pnpm --filter @entalent/application test` passed with 136 tests.
- Review verification: `pnpm --filter @entalent/worker test` passed with 25 tests.
- Review verification: `pnpm --filter @entalent/database build` passed.
- Review verification: `pnpm --filter @entalent/api typecheck` passed.
- Review verification: `pnpm --filter @entalent/application build` passed.
- Review verification: `pnpm --filter @entalent/database lint` passed with existing warning-only console findings.
- Review verification: `pnpm --filter @entalent/worker lint` passed with one existing warning-only console finding.
- Review verification: `pnpm --filter @entalent/api lint` passed with existing warning-only console findings.
- Review verification: `pnpm --filter @entalent/database test:integration` ran and skipped 14 tests because `DATABASE_URL` is not set in this local environment.
- Review verification: `pnpm --filter @entalent/worker build`, `pnpm --filter @entalent/api build`, and `pnpm --filter @entalent/database typecheck` passed.
- Review full regression: `pnpm test` passed with 15 successful turbo tasks.
- Review verification: `git diff --check` passed.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Added persisted Postgres/Drizzle runtime attempt and action ledger schema with indexes, foreign keys, and durable uniqueness.
- Added worker runtime ledger repository with idempotent attempt/action writes, phase transitions, and action lifecycle guardrails.
- Inbound conversation jobs now carry request/event IDs, and `ConversationProcessor` records a started ledger attempt before invoking the existing TypeScript runtime path.
- Runtime attempt numbers are one-based from BullMQ `attemptsMade + 1`.
- BMAD review findings resolved: exact resolved runtime mode and runtime failures are persisted through router callbacks, duplicate started attempts no longer rewind durable state, phase transitions are monotonic, action writes are atomic and tenant-scoped, and ledger payloads are canonical validated before persistence.
- Added database check constraints for runtime ledger enum-like columns in migration `0007_runtime_ledger_checks.sql`.
- No fallback barrier enforcement, action executor, domain write path, queued side effect, MAF client, Python service, FastAPI route, MAF workflow, or production MAF routing behavior was added.

### File List

- `_bmad-output/implementation-artifacts/2-4-add-runtime-attempt-and-action-ledgers.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/api/src/channel/slack-ingest.service.ts`
- `apps/api/src/dev/dev-simulate.controller.ts`
- `apps/api/src/queue/queue.types.ts`
- `apps/worker/src/conversation/conversation.module.ts`
- `apps/worker/src/conversation/conversation.processor.test.ts`
- `apps/worker/src/conversation/conversation.processor.ts`
- `apps/worker/src/conversation/runtime-ledger.repository.test.ts`
- `apps/worker/src/conversation/runtime-ledger.repository.ts`
- `packages/application/src/ports/agent-runtime.port.ts`
- `packages/application/src/use-cases/agent-runtime-router.test.ts`
- `packages/application/src/use-cases/agent-runtime-router.ts`
- `packages/database/migrations/0006_runtime_ledgers.sql`
- `packages/database/migrations/0007_runtime_ledger_checks.sql`
- `packages/database/migrations/meta/0006_snapshot.json`
- `packages/database/migrations/meta/0007_snapshot.json`
- `packages/database/migrations/meta/_journal.json`
- `packages/database/src/__tests__/runtime-ledger.integration.test.ts`
- `packages/database/src/schema/index.ts`
- `packages/database/src/schema/runtime-actions.ts`
- `packages/database/src/schema/runtime-attempts.ts`

### Change Log

- 2026-08-05: Created Story 2.4 developer context from Epic 2, architecture spine, runtime contract, database/worker patterns, and Story 2.3 review learnings.
- 2026-08-05: Implemented runtime attempt/action ledgers, worker recording path, focused tests, and verification for Story 2.4.
- 2026-08-05: Resolved BMAD code-review findings and marked Story 2.4 done.

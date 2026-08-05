---
baseline_commit: c14a9e35c3f3e8a18d94d3aa723146bca9e939e6
---

# Story 3.2: Add Shadow Diagnostics Record

Status: review
Epic: 3 - Baseline And Shadow Comparison
Story ID: 3.2

## Story

As an operator,
I want one canonical shadow diagnostics record,
so that current and candidate runtimes can be compared consistently.

## Acceptance Criteria

1. Given a shadow run completes, when diagnostics are persisted, then the record includes runtime mode, current result, candidate result, validation status, risk comparison, memory/action comparison, latency, model-call count, tool-call count, retry count, estimated cost, trace ID, redaction status, and runtime version.
2. Given candidate output contains message text or sensitive evidence, when diagnostics are stored, then the configured redaction policy is applied before persistence.
3. Given this story is complete, when the diff is inspected, then no `agent-service`, FastAPI route, MAF workflow, `MafAgentRuntimeClient`, production shadow execution branch, canary routing behavior, user-facing runtime behavior, or dashboard/admin UI has been added.

## Tasks / Subtasks

- [x] Define the canonical shadow diagnostics schema. (AC: 1, 2)
  - [x] Add a TypeScript-owned database schema file under `packages/database/src/schema/` for one canonical shadow diagnostics table.
  - [x] Reference `tenants`, `messages`, and `runtime_attempts` with tenant-scoped cascade behavior matching the existing runtime ledger tables.
  - [x] Include durable identifiers and query fields: `tenantId`, `messageId`, `runtimeAttemptId`, `runtimeMode`, `traceId`, `validationStatus`, `redactionStatus`, and `runtimeVersion`.
  - [x] Include JSONB comparison fields for current result, candidate result, risk comparison, memory comparison, action comparison, and validation details.
  - [x] Include numeric metric fields for latency milliseconds, model-call count, tool-call count, retry count, and estimated cost.
  - [x] Add indexes needed for Story 3.3 reporting: tenant + created date, trace ID, message ID, runtime attempt ID, validation status, and redaction status.
  - [x] Add enum-like check constraints for validation status and redaction status.
- [x] Add a migration for the new diagnostics table. (AC: 1)
  - [x] Add the next migration SQL file under `packages/database/migrations/` using the existing migration style.
  - [x] Keep migration names, constraint names, indexes, foreign keys, and `IF NOT EXISTS` patterns consistent with `0006_runtime_ledgers.sql` and `0007_runtime_ledger_checks.sql`.
  - [x] Update Drizzle migration metadata if using `drizzle-kit generate`; otherwise keep manual SQL and schema definitions aligned.
- [x] Add a worker-side repository for diagnostics persistence. (AC: 1, 2)
  - [x] Add a repository near `apps/worker/src/conversation/runtime-ledger.repository.ts` or extend that module only if the API remains cohesive.
  - [x] Require an existing runtime attempt before inserting diagnostics; do not create attempts implicitly.
  - [x] Persist diagnostics idempotently for the same runtime attempt and runtime version, or document and enforce the chosen uniqueness rule in code and schema.
  - [x] Return stable typed records to callers; do not expose Drizzle internals outside the repository boundary.
- [x] Enforce redaction before persistence. (AC: 2)
  - [x] Reject or redact raw user message text, model prompts, risk evidence, memory content, action payload contents, and raw provider errors before database writes.
  - [x] Use stable reason codes and redaction metadata instead of persisting provider text or sensitive evidence.
  - [x] Store enough redacted comparison structure for later reporting without retaining the sensitive source text.
  - [x] Make the redaction policy testable as a pure helper or repository guard.
- [x] Add focused tests. (AC: 1, 2, 3)
  - [x] Add unit tests for repository persistence, idempotency/uniqueness, required fields, and redaction failures or transformations.
  - [x] Add or extend database integration tests so the table persists valid records and rejects invalid enum-like values.
  - [x] Add negative tests proving raw message text, risk evidence, memory content, action payload contents, and raw provider errors cannot be stored unredacted.
  - [x] Add scope regression checks or assertions that no `agent-service`, `MafAgentRuntimeClient`, production shadow execution, or UI files were introduced.
- [x] Update implementation docs and sprint tracking. (AC: 1-3)
  - [x] Document the diagnostics record shape, redaction policy, and out-of-scope runtime execution wiring in this story's Dev Agent Record.
  - [x] Keep `_bmad-output/specs/spec-maf-runtime-migration/validation-baseline.md` unchanged unless diagnostics reporting semantics actually change.
  - [x] Update `sprint-status.yaml` from `ready-for-dev` to `in-progress` during dev-story and to `review` when complete.
- [x] Run and record verification. (AC: 1-3)
  - [x] Run `pnpm --filter @entalent/database typecheck`.
  - [x] Run `pnpm --filter @entalent/database lint`.
  - [x] Run `pnpm --filter @entalent/worker test`.
  - [x] Run targeted database integration tests if `DATABASE_URL` is available; if absent, record the exact skip reason.
  - [x] Run `pnpm test`.
  - [x] Run `git diff --check`.

## Dev Notes

### Current Architecture Context

- AD-18 is the controlling architecture decision: shadow comparison writes a canonical diagnostics record owned by TypeScript. The record includes runtime mode, current result, candidate result, validation status, risk comparison, memory/action comparison, latency milliseconds, model-call count, tool-call count, retry count, estimated cost, trace ID, redaction status, and runtime version.
- AD-6 requires shadow mode to record current and candidate results with trace IDs, runtime versions, validation status, latency, model-call count, tool-call count, cost, risk, memory candidates, and proposed actions.
- AD-9 says evaluation gates block rollout; the diagnostics table is comparison substrate, not a rollout decision engine.
- AD-10 says deterministic policy outranks agent output. Do not let candidate output or stored diagnostics bypass safety, privacy, proactive-message, reminder, or survey rules.
- AD-15 says attempt/action ledgers define the side-effect barrier. Diagnostics should link to `runtime_attempts`, not replace the attempt/action ledger.
- AD-17 says retry budgets are layered and shared. Diagnostics should record retry count; do not add new retry loops here.
- AD-19 says `agent-service` is later work. Do not scaffold Python service, FastAPI route, MAF workflow, or runtime client in this story.

### Existing Code To Reuse

- `packages/database/src/schema/runtime-attempts.ts` defines `runtime_attempts` with tenant, message, durable attempt key, trace ID, runtime mode, phase, and failure reason.
- `packages/database/src/schema/runtime-actions.ts` defines `runtime_actions` with action envelope JSONB, execution status checks, and attempt-scoped uniqueness.
- `packages/database/src/schema/index.ts` exports every schema file; new diagnostics schema must be exported there.
- `packages/database/migrations/0006_runtime_ledgers.sql` and `0007_runtime_ledger_checks.sql` show the current migration style for runtime tables, indexes, foreign keys, and check constraints.
- `apps/worker/src/conversation/runtime-ledger.repository.ts` is the closest repository pattern for tenant-scoped runtime persistence, idempotent writes, phase validation, and pre-persistence shape checks.
- `apps/worker/src/conversation/runtime-ledger.repository.test.ts` shows the current mocked Drizzle repository test style.
- `packages/database/src/__tests__/runtime-ledger.integration.test.ts` shows the current database integration style with `describeIntegration`, `runMigrationsOnce`, tenant/user/conversation/message setup, and invalid enum-like value tests.

### Shadow Diagnostics Shape Guidance

Use stable, report-friendly fields. The exact column names can follow local naming, but the persisted record must represent:

- identifiers: tenant, message, runtime attempt, trace ID, runtime mode, runtime version
- status: validation status and redaction status
- current result summary: redacted reply/risk/action/memory summary or stable digests; no raw user text
- candidate result summary: redacted reply/risk/action/memory summary or stable digests; no raw candidate message text
- comparisons: risk comparison, memory comparison, action comparison
- metrics: latency milliseconds, model-call count, tool-call count, retry count, estimated cost
- validation details: stable reason codes and structured metadata

Recommended validation statuses: `valid`, `invalid`, `comparison_failed`.
Recommended redaction statuses: `redacted`, `not_required`, `rejected`.

### Redaction Policy Requirements

Diagnostics must not persist:

- raw inbound or outbound user message text
- raw model prompts or model provider responses
- raw risk evidence snippets
- raw memory content
- raw action payload content
- raw provider error text or stack traces
- tenant/workspace/user names beyond existing UUID references

Use stable reason codes such as `raw_text_redacted`, `risk_evidence_redacted`, `memory_content_redacted`, `action_payload_redacted`, and `provider_error_redacted`. The implementation may reject a diagnostics payload instead of redacting it when safe redaction cannot be proven.

### Previous Story Intelligence

Story 3.1 completed at commit `c14a9e35c3f3e8a18d94d3aa723146bca9e939e6` after BMAD review fixes.

Relevant learnings:

- Manual review must be a blocking/reportable state, not merely advisory metadata.
- Deterministic-only artifacts must not pretend an LLM judge ran.
- Baseline coverage must use independent required-case lists, not self-referential checks.
- Policy-only checks should emit machine-readable artifacts when later reporting depends on them.
- Live simulation gates may be unavailable locally because model/LangWatch endpoints can fail with DNS errors; record exact skip reasons instead of claiming green live gates.

Epic 2 retrospective action E2-A4 applies directly: diagnostics must reject or redact raw user text, model prompts, risk evidence, memory content, action payloads, and raw provider errors before persistence.

### Out Of Scope

- `agent-service/`
- `MafAgentRuntimeClient`
- FastAPI routes
- MAF workflow code
- Python service code
- production shadow execution branch
- canary routing
- dashboard/admin UI
- Slack adapter, BullMQ queue, or worker processor behavioral changes
- real candidate MAF execution
- user-facing runtime behavior changes

### Testing Requirements

- Prefer pure redaction helper tests plus repository tests; do not require live model calls.
- Database integration tests should be skipped only when `DATABASE_URL` is absent, matching existing integration behavior.
- Keep root `pnpm test` green. Do not add `conversation-sim` live runs to root tests.
- If a migration is manually authored, validate schema/migration alignment by typecheck and integration tests where possible.

## References

- `_bmad-output/planning-artifacts/epics.md` - Epic 3 Story 3.2 requirements and FR16/FR30 mapping.
- `_bmad-output/specs/spec-maf-runtime-migration/SPEC.md` - CAP-3 and CAP-4 shadow/regression goals.
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md` - AD-6, AD-9, AD-10, AD-15, AD-17, AD-18, AD-19.
- `_bmad-output/implementation-artifacts/epic-2-retro-2026-08-05.md` - E2-A4 redaction action item and Epic 2 diagnostics vocabulary.
- `_bmad-output/implementation-artifacts/3-1-expand-migration-baseline-scenarios.md` - prior Epic 3 baseline work and review lessons.
- `packages/database/src/schema/runtime-attempts.ts` - existing runtime attempt schema.
- `packages/database/src/schema/runtime-actions.ts` - existing runtime action schema.
- `packages/database/migrations/0006_runtime_ledgers.sql` - existing runtime ledger migration style.
- `packages/database/migrations/0007_runtime_ledger_checks.sql` - existing runtime ledger check-constraint migration style.
- `apps/worker/src/conversation/runtime-ledger.repository.ts` - existing runtime persistence repository pattern.
- `apps/worker/src/conversation/runtime-ledger.repository.test.ts` - existing mocked repository unit test style.
- `packages/database/src/__tests__/runtime-ledger.integration.test.ts` - existing integration test pattern.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story created from sprint backlog after Story 3.1 was completed and reviewed at commit `c14a9e35c3f3e8a18d94d3aa723146bca9e939e6`.
- Loaded BMAD create-story workflow, config, sprint status, Epic 3 Story 3.2 requirements, architecture spine, SPEC, Epic 2 retrospective, Story 3.1 completion notes, runtime ledger schemas, migrations, repository, and tests.
- No `project-context.md` or UX artifact was found; this story is backend/runtime persistence work.
- Started dev-story implementation from baseline `c14a9e35c3f3e8a18d94d3aa723146bca9e939e6`.
- RED: `pnpm --filter @entalent/worker test -- shadow-diagnostics.repository.test.ts` failed because `shadow-diagnostics.repository` did not exist.
- GREEN: `pnpm --filter @entalent/worker test -- shadow-diagnostics.repository.test.ts` passed after adding the repository and schema export.
- Verification: `pnpm --filter @entalent/database typecheck` passed.
- Verification: `pnpm --filter @entalent/database lint` passed with existing console warnings in `migrate.ts` and `seed.ts`.
- Verification: `pnpm --filter @entalent/database test:integration` passed with 16 skipped tests because `DATABASE_URL` is absent.
- Verification: `pnpm --filter @entalent/worker test` passed with 53 tests.
- Verification: `pnpm test` passed with 15 successful turbo tasks.
- Verification: scope check found no `agent-service`, MAF client, FastAPI, or production shadow execution wiring.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Guardrails explicitly prevent early `agent-service`, `MafAgentRuntimeClient`, FastAPI route, MAF workflow, production shadow execution, canary routing, UI work, and user-facing runtime behavior changes.
- Added `runtime_shadow_diagnostics` as the TypeScript-owned canonical shadow diagnostics table linked to tenants, messages, and runtime attempts.
- Added migration `0008_runtime_shadow_diagnostics.sql` and exported the schema from `@entalent/database`.
- Added `ShadowDiagnosticsRepository` with tenant-scoped runtime-attempt lookup, attempt/runtime-version upsert, metric validation, JSON validation, and redaction-before-write.
- Added redaction reason metadata for raw text, model prompt/provider response, risk evidence, memory content, action payload, and provider error fields.
- Added worker unit tests, database integration coverage, and out-of-scope file assertions.

### File List

- `_bmad-output/implementation-artifacts/3-2-add-shadow-diagnostics-record.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/worker/src/conversation/conversation.module.ts`
- `apps/worker/src/conversation/shadow-diagnostics.repository.ts`
- `apps/worker/src/conversation/shadow-diagnostics.repository.test.ts`
- `packages/database/migrations/0008_runtime_shadow_diagnostics.sql`
- `packages/database/migrations/meta/_journal.json`
- `packages/database/src/__tests__/runtime-ledger.integration.test.ts`
- `packages/database/src/schema/index.ts`
- `packages/database/src/schema/runtime-shadow-diagnostics.ts`

### Change Log

- 2026-08-05: Created Story 3.2 developer context from Epic 3, architecture spine, SPEC, Epic 2 retrospective, Story 3.1 learnings, and existing runtime ledger persistence patterns.
- 2026-08-05: Started Story 3.2 dev-story implementation.
- 2026-08-05: Implemented canonical shadow diagnostics schema, migration, repository, redaction guard, tests, and verification for Story 3.2.

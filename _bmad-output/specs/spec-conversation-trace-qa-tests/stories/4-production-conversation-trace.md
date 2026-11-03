---
title: 'Production conversation trace'
type: 'feature'
created: '2026-11-01'
status: 'done'
baseline_commit: '04a72313fa7e9c9a299fb6e9891efa1eeb3b3fd4' # HEAD; the tree was already dirty (stories 1-3 uncommitted)
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-conversation-trace-qa-tests/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-conversation-trace-qa-tests/brownfield.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The sim harness records every turn's inbound message, model calls, classification, reply plan, response inputs, writes, queued jobs, warnings and errors; production records none of it, so QA cannot see why a real Slack reply came out as it did (SPEC CAP-6).

**Approach:** Move the trace event model and its capture helpers out of the sim into a shared package used by both sim and worker. In the worker, decorators wired at the composition root capture each turn of enabled tenants into a per-job AsyncLocalStorage context; after the turn, the captured turn is encrypted and stored best effort in its own tenant-scoped table, purged after 30 days.

## Boundaries & Constraints

**Always:**
- One model: `TraceEvent`, `TraceSink`, `traceWrites`, model-call tracing, `responseInputs` and the report-turn builder live in `@entalent/conversation-trace`; the sim imports them from there and its report output keeps its shape.
- Capture at turn time from the ports' own arguments and results; never re-read state from the database to rebuild a trace.
- Switch: a tenant-specific `feature_flags` row `key = 'conversation_trace'`, `enabled = true`. Global (null-tenant) rows and rollout percentage are ignored. No row = off.
- Diagnostic only: every trace step (flag lookup, capture, serialization, encryption, insert) is wrapped; failures are logged with a fixed code and no content, and the orchestrator's result, thrown error, writes and queued jobs are exactly what they would be without tracing.
- The flag lookup is never awaited on the turn path (cached per tenant; an unknown tenant captures in memory and decides at persist time). Persistence runs after `orchestrate` settles, outside any transaction, not awaited by the job.
- Stored row: plaintext only ids, status, timestamps, schema version; everything else in one AES-GCM payload encrypted with `FIELD_ENCRYPTION_KEY`. Payload size is bounded.
- New table `conversation_turn_traces` via a new forward Drizzle migration; purge rows older than 30 days by a repeatable BullMQ job (the `question-cutoff` pattern).

**Never:**
- No widening of `conversation_turn_effects` or `llm_runs`; no change to bot behavior, prompts or orchestration decisions.
- No trace content in logs; no read or export API (story 5).
- No MAF, `agent-service`, `AGENT_RUNTIME_PORT`; no live LLM calls, sims or `harness:check`.
- No tracing of proactive check-ins or the failed-turn fallback in this story (deferred).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Enabled tenant turn | flag row on, scripted ports | one row; decrypted payload holds userMessage, trace events (inbound, llm, write, queue, warning, decision), turn with classification, replyPlan, replyBrief, responseInputs (memory, cycle), effects | N/A |
| Switch off | no row / `enabled=false` / only a global row | zero inserts, zero encryptions | N/A |
| Orchestrate throws | enabled, provider throws | same error rethrown; row with status `failed`, error event | N/A |
| Flag lookup fails | DB error on lookup | turn unaffected; nothing stored | logged code |
| Encrypt / insert / serialize fails | enabled, sink throws | turn result, writes and queued jobs identical to untraced run | logged code, swallowed |
| Decorator summary throws | arg getter throws | port call still runs and returns its value | event dropped |
| Concurrent jobs | two tenants interleaved | each row holds only its own events | N/A |
| Late write after turn | write after `orchestrate` settled | not recorded | N/A |
| Purge | rows 31 and 29 days old | 31-day row deleted, 29-day row kept | job throws fixed code |

</frozen-after-approval>

## Code Map

- `packages/conversation-sim/src/harness/trace.ts` -- current model + `traceWrites`/`summarizeValue`; becomes a re-export.
- `packages/conversation-sim/src/harness/coach-harness.ts` -- `RecordingAiProvider` (model-call tracing + generate capture), `describeClassification/GenerationRequest/Outcome`, `TurnEffects`; move the tracing core, keep `RecordingAiProvider` as a subclass (tests construct it).
- `packages/conversation-sim/src/harness/report.ts` -- `responseInputs`, turn entry builder in `buildReportData`; use the shared builder.
- `apps/worker/src/conversation/conversation.module.ts` -- orchestrator factory: wrap ports and the orchestrator; append injects at the end (module test asserts `inject[1] === AiService` and no MAF tokens).
- `apps/worker/src/conversation/conversation.processor.ts` -- untouched; it calls `orchestrator.orchestrate(job.data)`.
- `apps/worker/src/database/database.service.ts` -- `client` follows the transaction ALS; add a `rootClient` so trace writes never join a turn transaction.
- `apps/worker/src/crypto/local-encryption.adapter.ts` -- reuse for encryption.
- `apps/worker/src/survey/question-cutoff.processor.ts` -- repeatable job pattern (`onModuleInit` + `repeat.every` + fixed `jobId`).
- `packages/contracts/src/queue.ts` (+ test), `apps/worker/src/queue/queue.module.ts` -- queue registry.
- `packages/database/src/schema/*.ts`, `migrations/` -- schema + generated migration (last is 0053).

## Tasks & Acceptance

**Execution:**
- [x] `packages/conversation-trace/*` -- new package: events/sink, summarize, `traceWrites` (guarded, optional `observeWrite`), `TracingAiProvider`, describers, `TurnEffects`, `ReportTurn`, `responseInputs`, `buildReportTurn`, `TracedTurnPayload` v1 + `buildTracedTurnPayload` (bounded) -- one shared model; unit tests.
- [x] `packages/conversation-sim/{package.json,src/harness/*}` -- import the shared model; report JSON unchanged.
- [x] `packages/database/src/schema/conversation-turn-traces.ts`, `index.ts`, migration -- new table.
- [x] `packages/contracts/src/queue.ts`, `queue.test.ts`, worker `queue.module.ts` -- `CONVERSATION_TRACE_PURGE`.
- [x] `apps/worker/src/conversation-trace/*` -- ALS context + ambient sink, flag cache, recorder (begin/finish/persist best effort, `flush` for tests/shutdown), repository (encrypt + insert, purge), purge processor, module; tests for every matrix row.
- [x] `apps/worker/src/conversation/conversation.module.ts`, `database.service.ts`, `package.json` -- wiring.

**Acceptance Criteria:**
- Given the worker module, when providers are read, then no MAF/agent-runtime token is injected and `inject[1]` is still `AiService`.
- Given existing suites, when worker, conversation-sim (99 pass + 1 skip) and contracts tests run, then all pass.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | edge, blind | Final outcome/error event dropped once 400 events are kept | medium | patch | `record` refused the final event at the cap; capture now keeps 398 + `recordFinal`; test with 500 events |
| 2 | edge | Truncation warning sliced off by the serializer's 400 limit | low | patch | 400 events + warning = 401; fixed by the 398 cap (same test) |
| 3 | edge | Empty-trace oversized payload skips the byte bound | low | patch | Loop did not run with no events; now falls back to an empty trace |
| 4 | blind, edge | Serializer last resort keeps head only, loses the outcome | low | patch | Now keeps head plus last event; test added |
| 5 | blind, edge | Rejected writes look successful in the trace | medium | patch | `traceWrites` records an `error` event on rejection, only inside a traced turn (untraced rejection handling unchanged); test added |
| 6 | edge | Rolled-back writes still show as writes | low | reject | Events record attempted calls by design; the outcome/error event shows the turn failed |
| 7 | edge | Unknown-flag tenants are summarized in memory until the lookup resolves | low | reject | Spec Always: capture in memory, decide at persist; nothing is stored or logged |
| 8 | edge, verification, blind | `effects.memoryAdded` always empty in production (memory is written by the extraction job) | low | reject | Accurate: no memory is written in the turn; the queued `enqueueMemoryExtraction` event shows it; tracing that job is deferred |
| 9 | edge, blind | Retries produce rows without attempt number | low | defer | One row per attempt is the design; attempt/job id belongs with story-5 lookup |
| 10 | edge | Purge scheduling failure aborts worker startup | medium | patch | `queue.add` in `onModuleInit` threw through; now caught and logged with a fixed code |
| 11 | edge | `traceWrites` binds `constructor` | low | patch | Direct correction, matches the orchestrator proxy |
| 12 | edge, blind | `commitFailedTurn` / `resumeCommittedTurn` untraced | medium | defer | Spec Never excludes the failed-turn fallback in this story |
| 13 | edge | Spec names `buildTracedTurnPayload`, code exports `serializeTracedTurn` | low | reject | Naming only; Implementation Notes record the actual name |
| 14 | blind | Pulse-backlog writes untraced | medium | patch | `pulseBacklogService` now wrapped as `pulseBacklog`; wiring test asserts `pulseBacklog.recordProbeSent` |
| 15 | blind | Write-verb regex misses real port writes | medium | patch | Added append, capture, reopen, prioritize, deprioritize, unlock, initialize, schedule |
| 16 | blind | Data-deletion use case leaves traces for up to 30 days | medium | defer | Needs a new application port and repository method; the purge bounds exposure to 30 days |
| 17 | blind | Switch lookup `limit(1)` without order | low | patch | No unique (key, tenant); now `order by updated_at desc` |
| 18 | blind | Every stored turn is turn 1 | low | defer | Ordinal comes from `started_at` order at export time (story 5) |
| 19 | blind | No index on `outbound_message_id` | low | patch | Migration was never applied, so it was regenerated with a `(tenant_id, outbound_message_id)` index |
| 20 | blind | 30 s switch lag, cache never evicted, no runbook | low | reject | Map is bounded by tenant count; lag and how to enable are in Design Notes |
| 21 | blind | Diff lacks sim refactor, snapshot, configs | false | reject | Files exist (`coach-harness.ts`, `report.ts`, `0054_snapshot.json`, package configs); the staged diff left them out to avoid stories 1-3 noise |
| 22 | blind | Integration test `>= 1` purge assertion weak | low | patch | Removed; the exact remaining-row assertion stays |
| 23 | blind | Size-reduction stage untested | gap | patch | Test asserts decisions kept, inputs/effects dropped |
| 24 | verification | Composition-root factory never executed | gap | patch | `trace-decorators.test.ts` calls the module `useFactory` with stubs: real orchestrator turn stored, model port is `TracingAiProvider`, store labels checked |
| 25 | verification | Escalation capture never exercised | gap | patch | Fake turn raises an escalation; effects asserted |
| 26 | verification | Harness gate maps `X.ts` to `X.test.ts`; repository tests sat in the recorder test | gap | patch | Repository tests moved to `conversation-trace.repository.test.ts`, decorator wiring to `trace-decorators.test.ts`; package-suite mapping deferred |

## Design Notes

Decisions taken without a human (checkpoints auto-approved by Illia): spec is above 1,600 tokens and kept whole (one goal: production trace); the dirty tree is the expected branch state. Shared model goes into a new workspace package rather than `@entalent/application` (use cases must not carry trace code; the user limited application changes to ports/types). A failed `orchestrate` attempt and each BullMQ retry produce their own row. The purge runs hourly and deletes in batches of 1,000 by `created_at`, regardless of whether the switch is still on. Enable for a tenant: `insert into feature_flags (key, tenant_id, enabled) values ('conversation_trace', '<tenant uuid>', true)`; disable with `enabled = false`. The worker caches the answer per tenant for 30 s, so a change takes up to 30 s; a failed lookup counts as off for 30 s.

## Verification

**Commands:**
- `pnpm --filter @entalent/conversation-trace test` / `build` -- pass.
- `pnpm --filter @entalent/worker test` -- pass, including new trace tests.
- `pnpm --filter @entalent/conversation-sim test` -- 99 + new pass, 1 skipped.
- `pnpm --filter @entalent/contracts test`, `pnpm typecheck`, `pnpm lint` -- pass.
- `pnpm db:generate` -- one new migration creating only `conversation_turn_traces`; `pnpm db:migrate` against localhost:5434 when Docker is up.

## Implementation Notes

- Implemented directly by the build agent (dispatch note: no implementation subagent).
- Shared package `packages/conversation-trace` (`@entalent/conversation-trace`): `events.ts` (TraceEvent, TraceSink, TurnTrace), `summarize.ts`, `trace-writes.ts`, `tracing-ai-provider.ts` (TracingAiProvider + describers), `turn.ts` (TurnEffects, ReportTurn, buildReportTurn, responseInputs, TracedTurnPayload v1, `serializeTracedTurn` = the bounded payload builder). Sim `trace.ts` re-exports it; `RecordingAiProvider` subclasses `TracingAiProvider`; `report.ts` uses `buildReportTurn`; sim suite stays 99 + 1 skipped.
- Worker `apps/worker/src/conversation-trace/`: `turn-capture.ts` (TurnCapture, AsyncLocalStorage context, AmbientTraceSink), `conversation-trace.recorder.ts`, `conversation-trace.repository.ts`, `trace-decorators.ts`, `conversation-trace-purge.processor.ts`, `conversation-trace.module.ts`; wired in `conversation.module.ts` (recorder injected last). `DatabaseService.rootClient` added so trace writes never join a turn transaction.
- Table `conversation_turn_traces`, migration `0054_spooky_silk_fever.sql` (regenerated after review #19; never applied). Applying it to local Postgres was held by the permission system and not retried, so the new integration test did not run.
- Queue `conversation-trace-purge` added to `QUEUE_NAMES` (contracts test updated) and registered in the worker queue module.
- Parallel `pnpm typecheck` fails intermittently in conversation-sim because the worker typecheck script rebuilds `@entalent/application` with `--clean` at the same time; sequential `turbo run typecheck --force --concurrency=1` passes 26/26. Logged in docs/agent-failures.md.

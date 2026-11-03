---
title: 'Precondition from a traced turn'
type: 'feature'
created: '2026-11-01'
status: 'done'
baseline_commit: '04a72313fa7e9c9a299fb6e9891efa1eeb3b3fd4' # HEAD; the tree was already dirty (stories 1-5 uncommitted)
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-conversation-trace-qa-tests/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-conversation-trace-qa-tests/precondition-format.md'
  - '{project-root}/_bmad-output/specs/spec-conversation-trace-qa-tests/stories/5-admin-api-trace-lookup-and-export.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** QA can find and read a traced turn (story 5) but cannot reproduce it: the stored payload holds only the reply's inputs as display strings, not the history, memory, goals, onboarding and pulse-cycle state the orchestrator read, so no precondition can be built from it (SPEC CAP-8).

**Approach:** The worker capture also records, at turn time, the first result of each state read the orchestrator makes (an optional `stateBefore` section of `TracedTurnPayload` v1). A pure converter in `@entalent/conversation-trace` turns one payload into a precondition v1 (origin `trace`) and a QA test draft whose only reply is the triggering employee message. An admin endpoint next to story 5's returns both for one trace row, only for tenants marked as test tenants; `pnpm trace:export -- --extract` writes them into the sim package.

## Boundaries & Constraints

**Always:**
- Test-tenant marker: a tenant-specific `feature_flags` row `key = 'conversation_trace_test_tenant'`, `enabled = true` (latest `updated_at` wins; global rows ignored; no row = not a test tenant). No migration.
- The endpoint uses story 5's guard, mount gate and tenant scoping; it checks the marker before any decryption, and audits every call (`admin.conversation_trace_precondition_extracted`, outcome `extracted` or `refused:<code>`) before responding; an audit failure fails the request. Audit metadata holds ids and counts, never text.
- Refusals carry a fixed `code`: 403 `not_test_tenant`; 404 `trace_not_found`; 409 `trace_payload_unreadable`, `trace_state_not_captured` (row has no `stateBefore`), `trace_user_message_missing`.
- Capture is passive and diagnostic: read results are observed only inside a traced turn, first read per state area wins and is flagged when a write to a store that can change it came first; observer failures are swallowed; switched-off tenants see only forwarding proxies. Story 4's guarantees and tests stay green.
- The precondition holds only what the orchestrator was fed: user display name and timezone, start time = inbound time, history (oldest first, the read window minus the inbound, metadata limited to keys the orchestrator reads), memory, goals, style, onboarding, pulse cycle (progress, next probe, evidence). Origin `trace` holds tenant, conversation and trace-row ids and the turn time; no user ids, Slack ids or emails.
- Every fidelity loss is listed in the response (`gaps`) and in the precondition `description`; the draft has `expected: []`, so it fails validation if run unfilled, and lives in `qa-tests/drafts/`, which the runner never reads.
- All fixtures are synthetic.

**Never:**
- No schema change, migration, bot-behavior or prompt change; no MAF or `agent-service`.
- No reconstruction from current database state; no extraction from rows without `stateBefore`.
- No live LLM calls, sims, `harness:check`, or remote API calls; the CLI is exercised only against a local stub.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | test tenant, completed row with `stateBefore` | 200 `{precondition, testDraft, gaps, files}`; audit `extracted` | N/A |
| Not a test tenant | no marker / `enabled=false` / only a global row | 403 `not_test_tenant`; row never read or decrypted; audit `refused` | fixed code |
| Other tenant's row | row id of tenant B, query tenant A (test) | 404 `trace_not_found` | fixed code |
| Old row | payload without `stateBefore` | 409 `trace_state_not_captured` | fixed code |
| Failed turn | `status=failed`, `stateBefore` present | 200; draft title says the original turn failed | N/A |
| Cycle read after a confirmation write | `readAfterWrite` contains `cycleProgress` | precondition built; gap names it | N/A |
| Pending bundle/clarification observed | `confirmation.awaitingBundle=true` | gap: the precondition format cannot hold it | N/A |
| Equal timestamps in history | two messages same ms | offsets kept strictly decreasing and above zero; gap notes the nudge | N/A |
| CAP-8 replay | synthetic payload -> precondition -> harness + scripted provider | orchestrator reads equal the original history, memory, goals, cycle | N/A |

</frozen-after-approval>

## Code Map

- `packages/conversation-trace/src/turn.ts` -- `TracedTurnPayload` v1 gets optional `stateBefore`; `serializeTracedTurn` keeps it in the reduced stage, drops it in the last resort.
- `packages/conversation-trace/src/state-before.ts` (new) -- `TracedStateBefore`, `StateBeforeCollector` (read spec per store/method, first-read-wins, write-before-read flags), `observeStateReads` proxy.
- `packages/conversation-trace/src/precondition/from-trace.ts` (new) -- `preconditionFromTrace(payload, meta)` -> `{precondition, testDraft, gaps, names}`; structural types mirroring conversation-sim's precondition and QA schemas.
- `packages/conversation-trace/src/report/trace-export.ts` -- `parseTracedTurnPayload` accepts/validates `stateBefore` loosely.
- `apps/worker/src/conversation-trace/turn-capture.ts`, `trace-decorators.ts`, `conversation-trace.recorder.ts` -- collector on `TurnCapture`; generic read observer replaces `observeMessageReads`; `stateBefore` serialized.
- `apps/worker/src/conversation/conversation.module.ts` -- ports already wrapped by `traced.writes(..., store)`; `writes` now also observes reads (no new injects; module test asserts `inject[1] === AiService`).
- Orchestrator reads (do not change): `conversationRepo.findById`, `findMessagesThrough`/`findRecentMessages`, `findLatestDeliveredReportingDisclosure`, `memoryRepo.findActiveByUser`, `goalRepo.findActiveByUser`, `styleProfileRepo.findByUser`, `onboardingTurn.contextFor`, `questionConfirmationRepo.findCycleProgress` / `findAwaitingQuestionBundle` / `findPendingQuestionClarification` / `findReadyQuestionBundle` / `hasReadyQuestionBundle`, `pulseBacklogService.getNextProbeQuestion`, `surveyRepo.findPulseCaptureForConversation`.
- `apps/api/src/conversation-trace/*` -- reader `turn(tenantId, id)`, `isTestTenant(tenantId)`; service `extractPrecondition`; controller `GET turns/:traceRowId/precondition`; tests next to story 5's.
- `packages/conversation-sim/src/preconditions/schema.ts` -- `trace` origin gains optional `conversationId`, `tracedAt`; `load.ts` summary shows them.
- `packages/conversation-sim/src/preconditions/from-trace.test.ts` (new) -- CAP-8 proof with `harnessFromPrecondition` + `ScriptedAiProvider`, plus schema validation of converter output.
- `scripts/trace-export.mjs` -- `--extract <traceRowId>`; search prints trace-row ids.
- `packages/conversation-sim/qa-tests/README.md`, `preconditions/traced/`, `qa-tests/drafts/` -- docs and target folders.

## Tasks & Acceptance

**Execution:**
- [x] `packages/conversation-trace/src/{state-before,precondition/from-trace,turn,index}.ts` + tests -- collector, converter, payload section.
- [x] `apps/worker/src/conversation-trace/*` -- capture `stateBefore`; tests: read observed only in traced turns, first read wins, read-after-write flag, observer throw does not change the read, stored payload holds it.
- [x] `apps/api/src/conversation-trace/*` -- endpoint, marker check, audit, refusals; one test per matrix row.
- [x] `packages/conversation-sim/src/preconditions/{schema,load}.ts`, `from-trace.test.ts` -- origin fields and CAP-8 replay test.
- [x] `scripts/trace-export.mjs`, `qa-tests/README.md` -- extract command and runbook.

**Acceptance Criteria:**
- Given existing suites, when conversation-trace, api, worker and conversation-sim (99 + new pass, 1 skip) tests run, then all pass; typecheck and lint pass.
- Given default production env, when the route boundary test runs, then the default snapshot is unchanged.

## Implementation Notes

- Implemented directly by the build agent (dispatch note: no implementation subagent). Spec is about 2,300 tokens, above the 1,600 target; kept whole (one goal, approvals waived by Illia).
- Shared: `packages/conversation-trace/src/state-before.ts` (`TracedStateBefore`, `StateBeforeCollector`, `observeStateReads`, `hasStateReads`) and `src/precondition/from-trace.ts` (`preconditionFromTrace`, `TraceExtractionError`, `traceExtractionName`, `ORCHESTRATOR_HISTORY_WINDOW`). Output types use the sim schemas' enum literals; the sim test assigns the output to `PreconditionInput`, so drift fails typecheck (it did once during the build).
- Worker: `TurnCapture` owns a collector; `observeWrite` notes the store; `traceConversationPorts.writes/conversation` wrap ports with `observeStateReads` (ports of stores without state reads stay unwrapped). No new injects, no module change. Extraction copies values when the read resolves, before the orchestrator continues (the sim test showed in-memory stores hand out live objects later mutated).
- API: `GET /api/v1/admin/conversation-traces/turns/:traceRowId/precondition?tenantId=`; marker `feature_flags(key='conversation_trace_test_tenant', tenant_id=<tenant>, enabled=true)` read by `ConversationTraceReader.isTestTenant`; audit `admin.conversation_trace_precondition_extracted` with `outcome`. Route boundary opt-in snapshot now lists three trace routes.
- Sim: `trace` origin gained optional `conversationId`, `tracedAt` (still schemaVersion 1). Drafts go to `qa-tests/drafts/` (not listed by `listQaTests`); target folders are created by the CLI on first use.
- CLI exercised only against a scratch HTTP stub on 127.0.0.1 (happy path, overwrite refusal, 403 passthrough, bad id); the written precondition loaded with `loadPrecondition`; stub output removed afterwards.
- Reader integration test extended (turn lookup, global vs tenant marker, unmarking); skipped without `DATABASE_URL`, not run.
- After review: marker time gate (`testTenantSince`, 403 `traced_before_test_mark`), failure audit, `wellFormed` state check, serializer stage dropping only state, more gaps.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | blind | Admin key can set the test-tenant marker itself (`PUT admin/feature-flags`, unaudited) | medium | defer | Shared `ADMIN_API_KEY` without operator identity is pre-existing (story 5 #1); needs a separate authority or audited flag writes |
| 2 | blind | Marker is checked at extraction time, so marking a tenant opens its older traces | medium | patch | Reader returns `testTenantSince` (flag row `updated_at`); rows traced earlier get 403 `traced_before_test_mark` before decryption; test added |
| 3 | blind | Full `stateBefore` is stored for every traced tenant, not only test tenants | medium | defer | Real widening of encrypted trace content (up to 20 messages, memory, goals per row, 30 days); gating capture on the marker needs a second worker flag lookup and a product decision; all current tenants are test tenants (SPEC Why) |
| 4 | blind | Fixture files keep display name, memory, goals, evidence in tracked paths | false | reject | By design for test tenants only; anonymization is a SPEC non-goal; #2 closes the backdated path |
| 5 | blind, edge | Audit skipped on unexpected errors; comment claims audit first; no conversation id in audit | medium | patch | Unexpected failures audited as `failed` and rethrown; `conversationId` in metadata; comment corrected; tests added |
| 6 | blind, edge | Shallow `stateBefore` validation gives a 500 (TypeError, NaN start time) | medium | patch | `wellFormed` check maps any malformed section to 409 `trace_state_not_captured`; converter and API tests added |
| 7 | blind | Start time is the message time, not when the queued turn ran | low | patch | Gap when the turn ran more than 5 min after the message |
| 8 | blind, edge | Silent cases: style/onboarding unread, cycle unread with null probe, evidence dropped with no cycle | low | patch | Each now produces a gap; tests added. Unrecognized reads (scheduled actions) rejected: the orchestrator reads no scheduled-action state |
| 9 | blind, edge | Silent value rewrites (clamp, focus, NaN phrase counts) | low | patch | Focus rewrite gives a gap; non-finite counts guarded; clamps kept (production values are in range) |
| 10 | blind | `readAfterWrite` is per store, noisy | low | reject | Conservative by design; precise per-method mapping adds complexity with no shown false alarm in the orchestrator's read order |
| 11 | blind, edge | Serializer drops the turn before the state | low | patch | New stage drops only `stateBefore` before the last resort; test asserts turn and events stay |
| 12 | blind | Disclosure placeholder could reach the model; replay untested | low | patch | Sim replay test: full window keeps the placeholder out of classifier turns and the receipt is found |
| 13 | blind | Messages after the inbound dropped silently | low | patch | Gap added; test |
| 14 | blind | No test for backdated gate bypass | gap | patch | Covered by #2 test |
| 15 | verification | Unmarking (newer `enabled=false` row) never verified | gap | patch | Integration test covers both insertion orders; ties broken by `id` (edge #12); still skipped without `DATABASE_URL` |
| 16 | verification | `trace:export --extract` has no automated test | gap | defer | Same class as story 5 #26; exercised against a local stub (write, overwrite refusal, 403, bad id) |
| 17 | verification | CLI derives the file stem itself instead of `traceExtractionName` | low | reject | CLI requires `extraction.name` to equal its derivation and writes nothing otherwise |
| 18 | edge | `getNextProbeQuestion` may create the window it reports | false | reject | The precondition reproduces what the orchestrator read; production would have shown the same window |
| 19 | edge | Evidence gap text wrong for empty summary | low | patch | Separate message |
| 20 | edge | Out-of-order history reported as shared timestamp | low | patch | Distinct gap |
| 21 | edge | 8-hex file stem collision overwrites with `--force` | low | reject | Overwrite already needs `--force`; collision odds negligible |
| 22 | edge | Marker tie on `updated_at` is nondeterministic | low | patch | `order by updated_at desc, id desc` |
| 23 | edge | CLI may write the precondition but not the draft | low | reject | Rerun with `--force` recovers; operator tool |

## Design Notes

Decisions taken without a human (approvals waived by Illia): passive capture of the orchestrator's own reads, because the SPEC forbids rebuilding state from the database and an extra awaited read would delay the turn; unobserved areas are left out of the precondition and listed as gaps instead of guessed. Old rows are refused rather than half-converted, since a test without the original history would not reproduce the turn. The marker is a separate flag from `conversation_trace`: tracing a tenant and declaring its data fit for repository fixtures are different decisions. The draft is the QA test format itself (no wrapper), so moving it into `qa-tests/` unfilled fails loudly.

## Verification

**Commands:**
- `pnpm --filter @entalent/conversation-trace build && pnpm --filter @entalent/conversation-trace test` -- pass.
- `pnpm --filter @entalent/worker test`, `pnpm --filter @entalent/api test` -- pass.
- `pnpm --filter @entalent/conversation-sim test` -- 99 + new pass, 1 skip.
- `pnpm exec turbo run typecheck --force --concurrency=1`, `pnpm lint` -- pass.

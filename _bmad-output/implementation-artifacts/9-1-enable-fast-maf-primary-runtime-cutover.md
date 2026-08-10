---
baseline_commit: dce563c5366311a340b0b7f5c30ddddb34d81ad2
---

# Story 9.1: Enable Fast MAF Primary Runtime Cutover

Status: done
Epic: 9 - Fast MAF Primary Cutover
Story ID: 9.1

## Story

As a migration owner,
I want an explicit local/controlled primary MAF runtime mode,
so that we can run a real user-facing conversation through Python Microsoft Agent Framework while TypeScript still owns persistence, Slack sends, and policy side effects.

## Acceptance Criteria

1. Given the primary MAF control is not explicitly enabled, when the worker processes a conversation job, then the current TypeScript runtime remains the default user-facing path with no behavior change.
2. Given the global MAF kill switch or tenant/user denylist matches, when primary MAF would otherwise be selected, then the router resolves to TypeScript-only or disabled behavior according to existing precedence.
3. Given primary MAF is explicitly enabled and `MafAgentRuntimeClient` is configured, when the worker processes a canonical conversation request, then Python MAF supplies the user-facing reply/risk candidate, TypeScript supplies the safe classification marker required by the current contract, TypeScript persists the outbound message, queues the Slack send, records runtime evidence, and returns a real `ProcessMessageResult` with a saved `outboundMessageId`.
4. Given Python MAF configuration is missing/invalid, HTTP fails, response validation fails, or the call times out before TypeScript commits a user-facing side effect, when primary MAF is selected, then the router falls back to the TypeScript runtime and records a safe diagnostic/failure reason.
5. Given Python MAF returns proposed actions, memory candidates, risk, or diagnostics, when primary cutover processes them, then TypeScript validates/owns all writes and Python does not directly persist messages, memory, goals, follow-ups, risk signals, ledgers, survey evidence, or Slack sends.
6. Given primary MAF evidence is logged or serialized, then it contains only stable redacted fields and excludes raw Slack/user text, candidate reply text beyond the final saved outbound message, prompts, bearer tokens, service secrets, provider bodies, memory content, risk evidence, action payloads, and stack traces.
7. Given this story is complete, when verification runs, then `pnpm maf:shadow:smoke` still passes first, focused primary-router/client tests pass, worker conversation tests prove saved outbound/send behavior, and `pnpm --filter @entalent/application test`, typecheck, build, and lint pass.
8. Given this story is complete, when the diff is inspected, then it must not add Python-owned writes, command tools, dashboard/admin UI, deployment/Railway mutation, `agent-framework-hosting`, or aggregate ownership transfer.

## Tasks / Subtasks

- [x] Add an explicit primary MAF runtime control. (AC: 1, 2, 4)
  - [x] Add `maf_primary` as a distinct runtime mode rather than overloading `maf_canary`.
  - [x] Add a dedicated runtime-control flag key such as `maf_runtime_primary`.
  - [x] Preserve precedence: global kill switch, tenant/user denylist, shadow mode if intentionally kept higher, primary mode, canary mode, then TypeScript default.
  - [x] Fail closed to TypeScript when runtime mode evaluation fails.
- [x] Add a TypeScript-owned primary execution adapter. (AC: 3, 5)
  - [x] Reuse `MafAgentRuntimeClient.processCandidate` or an equivalent shared private request path; do not duplicate HTTP request construction.
  - [x] Convert a valid Python `RuntimeResult` into the same persistence/send workflow shape the current `ConversationOrchestrator` produces.
  - [x] Ensure `outboundMessageId` is the ID of a real TypeScript-saved outbound message row.
  - [x] Ensure message-send, memory extraction, style analysis, survey evidence, risk persistence, reminder/follow-up, and escalation behavior remain TypeScript-owned or are explicitly deferred with safe behavior documented in the result.
- [x] Update `AgentRuntimeRouter` primary behavior. (AC: 1-4)
  - [x] Keep `typescript`, `maf_disabled`, `maf_shadow`, and existing `maf_canary` behavior compatible with current tests.
  - [x] For `maf_primary`, call the primary MAF adapter first.
  - [x] On safe pre-commit failures, fall back to `TypeScriptAgentRuntime`.
  - [x] Record runtime decision/failure diagnostics without raw payloads or provider details.
- [x] Add focused automated coverage. (AC: 1-8)
  - [x] Test default TypeScript behavior remains unchanged.
  - [x] Test kill switch and denylist block primary MAF.
  - [x] Test primary success produces a saved outbound message ID and queues a TypeScript send job.
  - [x] Test missing config, invalid URL, HTTP failure, invalid RuntimeResult, and timeout fall back before side-effect commit.
  - [x] Test redaction excludes raw user text, provider bodies, secrets, prompts, stack traces, memory content, risk evidence, and action payloads.
  - [x] Test `maf_shadow` still returns TypeScript user-facing output and records candidate evidence.
- [x] Add a local primary smoke path and docs. (AC: 3, 6, 7)
  - [x] Keep `pnpm maf:shadow:smoke` as required pre-check.
  - [x] Add or document the command/env sequence for local primary MAF testing.
  - [x] Document how to verify the response came from Python MAF while the outbound message/send job stayed TypeScript-owned.
- [x] Update tracking and story record. (AC: 1-8)
  - [x] Move story status through `in-progress` and `review` during implementation.
  - [x] Record BMAD code review findings and verification commands.
  - [x] Keep sprint status YAML valid.

### Review Findings

- [x] [Review][Patch] Primary adapter dropped TypeScript-owned risk/escalation behavior [packages/application/src/use-cases/maf-primary-agent-runtime.ts:10] — fixed by wiring risk-signal and escalation ports into `MafPrimaryAgentRuntime` and preserving redacted risk evidence.
- [x] [Review][Patch] Primary runtime evidence was incomplete for success/fallback [apps/worker/src/conversation/conversation.module.ts:128] — fixed by adding primary success/failure callbacks and ledger phase updates.
- [x] [Review][Patch] `maf_primary` was not recognized by fallback barrier [packages/application/src/use-cases/runtime-fallback-barrier.ts:126] — fixed by adding `maf_primary` as a MAF runtime mode and worker/application regression tests.
- [x] [Review][Patch] Primary smoke risk evidence always reported `none` [packages/application/src/use-cases/maf-primary-live-smoke.ts:123] — fixed by reporting risk severity from the primary runtime result.
- [x] [Review][Patch] Kill-switch and denylist tests did not explicitly include primary [packages/application/src/use-cases/agent-runtime-mode-resolver.test.ts:40] — fixed by including `maf_runtime_primary` in precedence coverage.
- [x] [Review][Patch] Primary fallback matrix lacked concrete client coverage [packages/application/src/use-cases/agent-runtime-router.test.ts:335] — fixed with primary-adapter fallback tests for missing config, invalid URL, HTTP failure, invalid `RuntimeResult`, and timeout.
- [x] [Review][Patch] Python proposed actions and memory candidates were silently ignored [packages/application/src/use-cases/maf-primary-agent-runtime.ts:101] — fixed by recording redacted deferred counts/booleans on outbound metadata without raw payloads.

## Dev Notes

### Current Architecture Context

- Epic 8 proved the live end-to-end shadow path:
  `TypeScript shadow validation -> MafAgentRuntimeClient -> HTTP -> Python agent-service -> Microsoft Agent Framework Agent -> model candidate`.
- `pnpm maf:shadow:smoke` passes with `status: "valid"`, `validationStatus: "contract_valid"`, `shadow.runtimeVersion: "agent-service-maf-core/1.13.0"`, and `shadow.modelCalls: 1`.
- The product direction is now fast primary cutover because there are no real users yet. This changes rollout sequencing, but not the core safety architecture.
- AD-2 still applies: TypeScript owns first-slice side effects.
- AD-3 still applies: Microsoft Agent Framework imports stay inside `agent-service`.
- AD-4 still applies: the first transport remains JSON HTTP.
- AD-10 still applies: deterministic TypeScript policy outranks agent output.
- AD-13 still applies: runtime mode selection stays in `AgentRuntimeRouter`.
- AD-15 still applies: fallback is allowed only before user-facing side effects are committed.
- AD-18 still applies: runtime/shadow evidence must be redacted and TypeScript-owned.

### Critical Guardrail

Do not make `MafAgentRuntimeClient.processMessage()` return a synthetic `ProcessMessageResult` with a fake `outboundMessageId`. `ProcessMessageResult.outboundMessageId` is consumed as the ID of a TypeScript-saved outbound message. If the Python result is returned without saving an outbound row and queuing message-send through TypeScript, the worker can log success while no Slack/dev response is actually sent.

Primary MAF must either:

- feed Python reply/risk plus a TypeScript-owned safe classification marker into a TypeScript-owned persistence/send path, or
- call a TypeScript adapter that performs the same durable side effects before returning `ProcessMessageResult`.

Story 9.1 implementation note: the current shared `RuntimeResult` contract does not include TypeScript `SituationClassification`. This story must not broaden OpenAPI as a side effect. Use a safe TypeScript-side classification marker for first primary smoke, and create a later focused contract story if full Python classification should cross the boundary.

### Existing Code To Reuse

- `packages/application/src/use-cases/agent-runtime-router.ts`
  - Current behavior always runs `TypeScriptAgentRuntime.processMessage()` first.
  - `maf_shadow` records a Python candidate after the TypeScript result and returns the TypeScript result.
  - `maf_canary` currently does not call Python as user-facing output.
- `packages/application/src/use-cases/maf-agent-runtime-client.ts`
  - `processCandidate()` already builds and validates `RuntimeProcessMessageRequest`, posts `/runtime/process-message`, validates `RuntimeResult`, and returns the contract-valid Python result.
  - `processMessage()` currently throws a safe configuration/boundary error and is not a primary runtime implementation.
- `apps/worker/src/conversation/conversation.processor.ts`
  - Builds MAF candidate context from tenant-scoped current message and recent turns.
  - Calls `agentRuntime.processMessage()` once and expects a complete `ProcessMessageResult`.
  - Does not itself save outbound messages; that must happen inside the runtime/orchestrator path.
- `packages/application/src/use-cases/conversation-orchestrator.ts`
  - Current TypeScript side-effect owner: saves outbound message, queues message-send, enqueues memory/style/survey jobs, persists risk signals, handles reminders/follow-ups, and raises escalation.
- `packages/application/src/ports/agent-runtime.port.ts`
  - `ProcessMessageResult` requires `outboundMessageId`, `responseText`, `mode`, `classification`, and `risk`.
- `docs/maf-runtime-client.md`
  - Current docs clearly state Stories 8.1-8.3 are candidate/shadow-only.

### Implementation Guidance

Prefer a narrow TypeScript adapter over a Python-side write path. The cleanest implementation should avoid duplicating `ConversationOrchestrator` wholesale:

1. Keep `MafAgentRuntimeClient.processCandidate()` as the HTTP/contract boundary.
2. Add a TypeScript-owned way to persist/send a validated runtime result from Python.
3. Have `AgentRuntimeRouter` call that adapter only for `maf_primary`.
4. Fall back to `TypeScriptAgentRuntime` on safe failures before the adapter commits a user-facing side effect.

If the existing `ConversationOrchestrator` must be refactored, keep the refactor mechanical and covered by existing tests. Do not mix unrelated behavior cleanup into this story.

### Out Of Scope

- Python-owned database writes or Slack sends.
- Command tools or write-capable Python tools.
- `agent-framework-hosting`.
- Deployment/Railway mutation.
- Dashboard/admin UI.
- Durable ownership transfer for messages, memory, goals, risk, scheduled actions, ledgers, survey evidence, or Slack delivery.
- Removing TypeScript fallback before commit boundaries.
- Replacing existing `ConversationProcessor` job semantics.

### Testing Requirements

- Tests must pass without live provider credentials unless explicitly running a smoke command.
- Unit tests must prove `maf_primary` is impossible by default and requires explicit control.
- Router tests must prove `maf_shadow` behavior is unchanged.
- Client tests must prove primary uses the same runtime contract validation as candidate processing.
- Worker/application tests must prove primary success saves an outbound message and queues a send job through TypeScript-owned repositories/outbox.
- Failure tests must prove fallback happens before any primary side effect is committed.
- Redaction tests must prove diagnostics/loggable evidence excludes raw request text, raw candidate text, prompts, secrets/tokens, provider bodies, memory content, risk evidence, action payloads, and stack traces.

### Previous Story Intelligence

- Story 8.1 review fixed false-positive success on HTTP errors, unsafe trace IDs, unsafe action lifecycle states, settings validation leakage, runtime version extraction, and missing no-call coverage.
- Story 8.2 review fixed token-like diagnostic leakage, malformed diagnostic arrays, missing shadow records, and contract-invalid response coverage through `MafAgentRuntimeClient`.
- Story 8.3 review fixed explicit disabled/malformed provider handling, child process cleanup, stderr draining, safe failure reason redaction, health probe timeout/startup error handling, invalid `RuntimeResult` coverage, and broad redaction coverage.
- Preserve the field-specific allowlists established by Epic 8. Do not reintroduce broad "safe string" checks for diagnostic evidence.

### Git Intelligence

- Latest committed scaffold work:
  - `dce563c Implement agent-service scaffold`
  - `a9cba45 Create agent-service scaffold story`
  - `53c12f2 Complete Epic 3 retrospective`
- Most migration work after Epic 3 is currently uncommitted. Treat the worktree as intentionally noisy and keep this story's file list precise.

### References

- `_bmad-output/implementation-artifacts/epic-8-retro-2026-08-07.md`
- `_bmad-output/implementation-artifacts/8-3-run-live-typescript-to-python-maf-shadow-smoke.md`
- `_bmad-output/implementation-artifacts/8-2-add-local-maf-shadow-validation.md`
- `_bmad-output/implementation-artifacts/8-1-run-local-live-maf-model-validation.md`
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md`
- `_bmad-output/planning-artifacts/epics.md`
- `packages/application/src/ports/agent-runtime.port.ts`
- `packages/application/src/use-cases/agent-runtime-router.ts`
- `packages/application/src/use-cases/maf-agent-runtime-client.ts`
- `packages/application/src/use-cases/conversation-orchestrator.ts`
- `apps/worker/src/conversation/conversation.processor.ts`
- `docs/maf-runtime-client.md`

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- 2026-08-07: Story created after Epic 8 retrospective identified primary MAF cutover as the next fast-track migration slice.
- 2026-08-07: CodeGraph analysis found that `MafAgentRuntimeClient.processCandidate()` is the working HTTP/contract path, while `processMessage()` is not yet a primary runtime implementation.
- 2026-08-07: CodeGraph analysis confirmed `ProcessMessageResult.outboundMessageId` must represent a real TypeScript-saved outbound message and cannot be synthesized from the Python candidate alone.
- 2026-08-07: Started Story 9.1 implementation; status moved to in-progress.
- 2026-08-07: RED tests failed for missing `MafPrimaryAgentRuntime`, missing `maf_primary` router behavior, and missing primary diagnostic handling.
- 2026-08-07: Implemented `maf_primary` mode, primary runtime-control flag, TypeScript-owned primary adapter, worker DI wiring, ledger mode support, and local primary live smoke.
- 2026-08-07: Live shadow smoke and live primary smoke both passed using root `.env`.
- 2026-08-07: BMAD code review found primary fallback/evidence gaps, missing TypeScript-owned risk side effects, incomplete primary failure matrix coverage, and stale smoke risk evidence.
- 2026-08-07: Review fixes added `maf_primary` fallback barrier support, primary success/failure ledger callbacks, TypeScript-owned risk persistence/escalation, redacted deferred proposal counts, concrete primary fallback tests, and corrected primary smoke risk evidence.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Added explicit `maf_primary` runtime mode and `maf_runtime_primary` flag precedence.
- Added `MafPrimaryAgentRuntime`, which obtains the Python MAF `RuntimeResult` through `MafAgentRuntimeClient.processCandidate`, persists risk/escalation through TypeScript-owned ports, saves a real TypeScript outbound message row, queues message-send, and keeps auxiliary extraction jobs TypeScript-owned best-effort after the send is queued.
- Added router primary behavior with safe pre-commit fallback to TypeScript, redacted primary failure diagnostics, and primary success/failure ledger callbacks.
- Added `pnpm maf:primary:smoke`, which starts local `agent-service`, executes a live Python MAF model call, and verifies TypeScript-owned primary persistence/outbox evidence without real DB or Slack writes.
- Preserved `maf_shadow` candidate-only behavior and `maf_canary` compatibility.
- Python `proposedActions` and `memoryCandidates` remain deferred in Story 9.1 and are recorded only as redacted counts/booleans on outbound metadata.
- Current limitation: Python primary does not yet supply full `SituationClassification` because the shared `RuntimeResult` contract has no classification field; Story 9.1 uses a safe TypeScript-side marker.

### File List

- `_bmad-output/implementation-artifacts/9-1-enable-fast-maf-primary-runtime-cutover.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/worker/src/conversation/conversation.module.ts`
- `apps/worker/src/conversation/runtime-fallback-barrier.service.test.ts`
- `apps/worker/src/conversation/runtime-ledger.repository.ts`
- `apps/worker/src/conversation/runtime-ledger.repository.test.ts`
- `docs/maf-runtime-client.md`
- `package.json`
- `packages/application/src/index.ts`
- `packages/application/src/ports/feature-flag.port.ts`
- `packages/application/src/use-cases/agent-runtime-mode-resolver.ts`
- `packages/application/src/use-cases/agent-runtime-mode-resolver.test.ts`
- `packages/application/src/use-cases/agent-runtime-router.ts`
- `packages/application/src/use-cases/agent-runtime-router.test.ts`
- `packages/application/src/use-cases/maf-primary-agent-runtime.ts`
- `packages/application/src/use-cases/maf-primary-agent-runtime.test.ts`
- `packages/application/src/use-cases/maf-primary-live-smoke.ts`
- `packages/application/src/use-cases/maf-primary-live-smoke.test.ts`
- `packages/application/src/use-cases/runtime-fallback-barrier.ts`
- `packages/application/src/use-cases/runtime-fallback-barrier.test.ts`
- `scripts/live-maf-primary-smoke.ts`

### Change Log

- 2026-08-07: Created Story 9.1 as ready for development.
- 2026-08-07: Started Story 9.1 implementation.
- 2026-08-07: Implemented fast MAF primary runtime cutover and moved Story 9.1 to review.
- 2026-08-07: Fixed BMAD code review findings for primary safety side effects, fallback barrier support, ledger evidence, primary smoke risk evidence, precedence coverage, and fallback matrix coverage.
- 2026-08-07: BMAD code review passed after fixes and Story 9.1 moved to done.

### Verification

- `pnpm --filter @entalent/application test -- src/use-cases/maf-primary-agent-runtime.test.ts src/use-cases/maf-primary-live-smoke.test.ts src/use-cases/agent-runtime-router.test.ts src/use-cases/agent-runtime-mode-resolver.test.ts` - passed (57 tests).
- `pnpm --filter @entalent/application test -- src/use-cases/maf-agent-runtime-client.test.ts src/use-cases/maf-shadow-live-smoke.test.ts src/use-cases/maf-shadow-local-validation.test.ts` - passed (35 tests).
- `pnpm --filter @entalent/application test` - passed (256 tests, existing Vite CJS deprecation warning).
- `pnpm --filter @entalent/application typecheck` - passed.
- `pnpm --filter @entalent/application build` - passed.
- `pnpm --filter @entalent/application lint` - passed.
- `pnpm --filter worker test -- src/conversation/conversation.module.test.ts src/conversation/conversation.processor.test.ts src/conversation/runtime-ledger.repository.test.ts` - passed (34 tests).
- `pnpm --filter worker test` - passed (115 tests, existing Node MaxListenersExceededWarning).
- `pnpm --filter worker typecheck` - passed after rebuilding `@entalent/application` declarations.
- `pnpm --filter worker lint` - passed with existing warning in `apps/worker/src/main.ts`.
- `pnpm maf:shadow:smoke` - passed with live Azure/OpenAI model call and redacted `modelCalls: 1` evidence.
- `pnpm maf:primary:smoke` - passed with live Azure/OpenAI model call and redacted `maf_primary` evidence: outbound saved, message-send queued, memory extraction queued, survey evidence queued.
- `pnpm --filter @entalent/application test -- src/use-cases/runtime-fallback-barrier.test.ts src/use-cases/agent-runtime-router.test.ts src/use-cases/agent-runtime-mode-resolver.test.ts src/use-cases/maf-primary-agent-runtime.test.ts src/use-cases/maf-primary-live-smoke.test.ts` - passed (84 tests).
- `pnpm --filter worker test -- src/conversation/conversation.module.test.ts src/conversation/runtime-fallback-barrier.service.test.ts` - passed (27 tests, existing Node MaxListenersExceededWarning).
- `ruby -e "require 'yaml'; YAML.load_file('_bmad-output/implementation-artifacts/sprint-status.yaml'); puts 'yaml ok'"` - passed.
- `git diff --check` - passed.

---
baseline_commit: dce563c
---

# Story 5.5: Integrate MAF Candidate Into Shadow Mode

Status: done
Epic: 5 - MAF Conversation Workflow Candidate
Story ID: 5.5

## Story

As an operator,
I want the MAF candidate workflow connected to shadow diagnostics,
so that real comparison data is collected through the same path the worker will use later.

## Acceptance Criteria

1. Given `maf_shadow` mode is enabled for a job, when the worker processes the job, then it invokes `MafAgentRuntimeClient` for candidate output and records the candidate in the TypeScript-owned shadow diagnostics record.
2. Given the candidate result fails validation, when diagnostics are recorded, then the validation failure blocks canary readiness and the user-facing TypeScript reply is unaffected.
3. Given this story is complete, when the diff is inspected, then it enables only shadow candidate execution; it must not enable `maf_canary`, Python-owned writes, Python command tools, dashboard/admin UI, deployment mutation, direct domain aggregate writes from Python, or user-facing MAF replies.
4. Given shadow diagnostics are recorded, when current or candidate outputs include text, memory content, risk evidence, action payloads, provider errors, stack traces, bearer tokens, service secrets, or full payloads, then stored diagnostics use the existing TypeScript redaction path and do not expose raw sensitive content.

## Tasks / Subtasks

- [x] Build canonical runtime request support for the TypeScript MAF client. (AC: 1, 2, 3, 4)
  - [x] Extend the application runtime request shape only as needed for canonical MAF HTTP fields: message text/timestamp, user display/timezone/locale, conversation session/thread scope, and bounded runtime context.
  - [x] Build `RuntimeProcessMessageRequest` from `ProcessMessageRequest` without fabricating raw text or context when fields are absent.
  - [x] Validate the outgoing request with `validateRuntimeProcessMessageRequest` from `@entalent/contracts` before fetch.
  - [x] POST JSON to `/runtime/process-message` using configured `AGENT_SERVICE_INTERNAL_URL`/`AGENT_SERVICE_URL`, explicit timeout, and safe trace headers.
  - [x] Validate the response with `validateRuntimeResult`; invalid schema must produce a safe candidate validation diagnostic and must not throw raw response bodies into logs/diagnostics.
  - [x] Keep `MafAgentRuntimeClient.processMessage` from becoming the user-facing runtime path unless tests explicitly prove shadow-only behavior; prefer a candidate-specific method for router shadow execution.
- [x] Run MAF only as a shadow candidate from `AgentRuntimeRouter`. (AC: 1, 2, 3, 4)
  - [x] In `maf_shadow`, run the TypeScript runtime as the current/user-facing path and return its result unchanged.
  - [x] Invoke the MAF candidate after the current result is available and catch all candidate/config/validation/network failures.
  - [x] Do not invoke MAF for `typescript`, `maf_disabled`, `tenant_user_denylist`, evaluation failure, or `maf_canary` in this story.
  - [x] Preserve existing runtime decision logging, attempt ledger recording, fallback barrier behavior, and TypeScript failure behavior.
  - [x] Candidate execution or diagnostics persistence failures must not affect the TypeScript reply.
- [x] Record shadow diagnostics through the existing worker repository. (AC: 1, 2, 4)
  - [x] Extend the router callback contract as needed so worker code can receive the started runtime attempt ID from `RuntimeLedgerRepository.recordStartedAttempt`.
  - [x] Use `ShadowDiagnosticsRepository.recordShadowDiagnostics` for candidate success and candidate failure.
  - [x] For candidate success, record validation status `valid`, the redacted current result, candidate result, risk/memory/action comparison summaries, latency, model/tool/retry counts, trace ID, and candidate runtime version.
  - [x] For candidate validation/config/network failure, record validation status `invalid`, safe reason codes in `validationDetails`, no raw response/request body, and values that make canary readiness fail.
  - [x] Let `ShadowDiagnosticsRepository` perform existing redaction; do not bypass it or create a parallel diagnostics store.
- [x] Provide canonical request data from the worker path. (AC: 1, 3, 4)
  - [x] Enrich `ConversationProcessor`/worker request construction with bounded data needed by the MAF client without changing user-facing TypeScript behavior.
  - [x] Source message text/timestamp and recent context from TypeScript-owned repositories or database reads already available to the worker.
  - [x] Keep context bounded and tenant-scoped; do not add Python reads/writes for this.
  - [x] Do not log raw message text while building or sending the MAF shadow request.
- [x] Update scope-regression guardrails for Story 5.5. (AC: 3)
  - [x] Allow successful `MafAgentRuntimeClient` candidate execution only through `maf_shadow`.
  - [x] Continue blocking `maf_canary` execution, dashboard/admin UI, deployment mutation, command tools, Python domain writes, and user-facing MAF replies.
  - [x] Replace outdated Story 3/4 guardrails that expected `agent-service` or the MAF client to be absent with current Epic 5 constraints.
- [x] Add focused TypeScript tests. (AC: 1-4)
  - [x] Test `MafAgentRuntimeClient` builds and validates canonical requests, posts to `/runtime/process-message`, validates candidate results, maps invalid results/errors to safe diagnostics, and does not leak secrets/raw bodies.
  - [x] Test `AgentRuntimeRouter` in `maf_shadow` returns the TypeScript result unchanged while invoking MAF and recording diagnostics.
  - [x] Test candidate validation failure records invalid diagnostics and still returns the TypeScript result.
  - [x] Test `maf_canary` does not invoke MAF in this story.
  - [x] Test worker/module wiring records runtime attempts and shadow diagnostics through TypeScript-owned repositories.
  - [x] Keep tests local and deterministic with mocked fetch/repositories; do not require a running Python service, Postgres, Redis, Slack, Docker, Railway, OpenAI, Azure, or LangWatch.
- [x] Update docs and tracking. (AC: 1-4)
  - [x] Document shadow-only MAF execution, required request fields/config, failure behavior, and diagnostics redaction.
  - [x] Update this story's Dev Agent Record during implementation.
  - [x] Move sprint status from `ready-for-dev` to `in-progress` during dev-story and to `review` when implementation is complete.
- [x] Run and record verification. (AC: 1-4)
  - [x] Run focused application tests for `maf-agent-runtime-client` and `agent-runtime-router`.
  - [x] Run focused worker tests for conversation module/shadow diagnostics.
  - [x] Run `pnpm --filter @entalent/application typecheck`.
  - [x] Run `pnpm --filter @entalent/application lint`.
  - [x] Run `pnpm --filter @entalent/worker typecheck` or the repo-equivalent worker typecheck if configured.
  - [x] Run `pnpm --filter @entalent/contracts test`.
  - [x] Run `python3 packages/contracts/runtime/validate_fixtures.py`.
  - [x] Run `git diff --check`.

### Review Findings

- [x] [Review][Patch] Default worker client cannot execute HTTP because no fetch implementation is configured [`packages/application/src/use-cases/maf-agent-runtime-client.ts:178`, `apps/worker/src/conversation/conversation.module.ts:214`]
- [x] [Review][Patch] Worker MAF context can include soft-deleted or cross-thread messages [`apps/worker/src/conversation/conversation.processor.ts:153`, `apps/worker/src/conversation/conversation.processor.ts:167`]
- [x] [Review][Patch] Candidate idempotency key can collide across messages in the same conversation/thread [`packages/application/src/use-cases/maf-agent-runtime-client.ts:315`]
- [x] [Review][Patch] Shadow HTTP calls can run without a default timeout when timeout config is unset [`packages/application/src/use-cases/maf-agent-runtime-client.ts:203`]
- [x] [Review][Patch] One malformed historical timestamp can drop all canonical worker context [`apps/worker/src/conversation/conversation.processor.ts:194`]

## Dev Notes

### Current Architecture Context

- AD-1 keeps `AgentRuntimePort.processMessage` as the only runtime switch point.
- AD-2 keeps TypeScript as first-slice side-effect owner. MAF candidate output is diagnostics-only here; TypeScript validates and executes side effects in later stories.
- AD-4 keeps first transport JSON HTTP.
- AD-5 and AD-15 require fallback to stop at the first side effect. In this story, TypeScript current runtime remains user-facing and MAF candidate failures are diagnostic-only, so no fallback from committed MAF side effects is permitted or needed.
- AD-6 makes shadow mode first-class: current and candidate results must be recorded with trace IDs, runtime versions, validation status, latency, model/tool/retry counts, risk, memory candidates, and proposed actions.
- AD-10 deterministic policy outranks candidate output. This story records candidate proposal output; it must not execute those proposals.
- AD-14 keeps OpenAPI at `packages/contracts/runtime/openapi.json` canonical. Use `@entalent/contracts` validators on the TypeScript side.
- AD-17 requires retry/tool/model counters to stay coherent; propagate Python diagnostics into shadow records.
- AD-18 keeps shadow diagnostics TypeScript-owned. Use `apps/worker/src/conversation/shadow-diagnostics.repository.ts`.
- AD-19 deployment metadata exists, but deployment mutation remains out of scope.

### Existing Repo State

- `packages/application/src/use-cases/maf-agent-runtime-client.ts` currently fails closed before fetch because the canonical request shape was not available. Story 5.5 owns opening this for shadow candidate execution.
- `packages/application/src/use-cases/agent-runtime-router.ts` currently records diagnostics for MAF configuration problems but always returns TypeScript runtime output. Story 5.5 should keep TypeScript as the returned output and add candidate execution only for `maf_shadow`.
- `apps/worker/src/conversation/conversation.module.ts` currently creates `MafAgentRuntimeClient` from env and records runtime attempts through `RuntimeLedgerRepository`.
- `apps/worker/src/conversation/runtime-ledger.repository.ts` can return the runtime attempt row from `recordStartedAttempt`, transition candidate phases, and record action envelopes. For Story 5.5, use the attempt ID for diagnostics but do not commit actions or replies.
- `apps/worker/src/conversation/shadow-diagnostics.repository.ts` already persists canonical shadow diagnostics and redacts raw strings by key/path. Do not create a second diagnostics writer.
- `packages/contracts/src/runtime-contract.ts` and `runtime-contract-validation.ts` export `RuntimeProcessMessageRequest`, `RuntimeResult`, and validators. If the client needs the OpenAPI schema document at runtime, add a small contracts export rather than duplicating schema constants.
- `apps/worker/src/conversation/shadow-diagnostics.repository.test.ts` has an old guardrail expecting `agent-service` and MAF client to be absent. Replace that with current Epic 5 scope assertions.

### Implementation Guidance

- Prefer a candidate-specific client method such as `processCandidate(request): Promise<RuntimeResult>` so `AgentRuntimePort.processMessage` cannot accidentally become user-facing MAF.
- `AgentRuntimeRouter.processMessage` should be ordered as: resolve mode, record attempt, run TypeScript current runtime, then run/record MAF candidate if mode is exactly `maf_shadow`. Any MAF or diagnostics error should be swallowed after safe diagnostic/log handling so the current result returns.
- If a candidate request cannot be built, record invalid shadow diagnostics with reason code `maf_runtime_boundary_request_invalid` rather than throwing through the user-facing path.
- `maf_canary` should still be TypeScript-only/fail-closed in Story 5.5. Epic 6 owns canary exposure.
- Avoid raw text in router logs and client diagnostics. Raw current/candidate result values may be passed to `ShadowDiagnosticsRepository` only because it redacts before persistence.
- Candidate failure diagnostics should include stable reason codes and schema validation paths when safe, not response bodies, prompts, request payloads, tokens, secrets, or stack traces.
- Keep estimated cost `0` until model cost accounting exists for Python runtime diagnostics.

### Out Of Scope

- `maf_canary` execution or user-facing MAF replies.
- Python command tools, Python-owned persistence, action execution, memory/goal/follow-up writes, ledger action commits, Slack sends, or TypeScript side-effect validation beyond diagnostics.
- Dashboard/admin UI, Railway/deployment mutation, non-local rollout gates, or Epic 6 canary readiness implementation beyond recording invalid diagnostics that existing readiness reports can treat as blocking.
- Model provider changes, prompts, or MAF workflow expansion.
- Changing runtime OpenAPI schema unless existing validators cannot express the required request/result.

### Previous Story Intelligence

- Story 5.4 BMAD review fixed risk evidence allowlisting, disabled-proactivity policy blocking, deterministic timestamp handling, sensitive-message memory suppression, and supported-signal gating for goal updates. Do not reintroduce raw candidate text leaks in diagnostics.
- Story 5.3 context tool review fixed raw recent-turn leakage and strict Python response validation. Shadow request context must be bounded and privacy-reviewed.
- Story 5.1 intentionally disabled the client until canonical request construction existed. This story is the planned point to resolve that for shadow only.
- Epic 4 action items still apply: keep fail-closed diagnostics, scope-regression guardrails, and deployment separation.

### Testing Requirements

- Tests must be local and deterministic with mocked fetch/repositories.
- Application tests should cover both success and invalid candidate result paths.
- Worker tests should assert TypeScript result is returned even when MAF candidate or diagnostics recording fails.
- Redaction tests should assert sensitive current/candidate fields are not persisted raw through `ShadowDiagnosticsRepository`.
- Scope tests should make `maf_shadow` the only allowed successful MAF execution path.

### References

- `_bmad-output/planning-artifacts/epics.md` - Epic 5 Story 5.5 requirements.
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md` - AD-1, AD-2, AD-4, AD-5, AD-6, AD-10, AD-14, AD-17, AD-18, AD-19.
- `_bmad-output/implementation-artifacts/5-4-return-structured-maf-candidate-results.md` - candidate output and review-fix learnings.
- `packages/application/src/use-cases/maf-agent-runtime-client.ts` - MAF HTTP client to open for shadow.
- `packages/application/src/use-cases/agent-runtime-router.ts` - runtime switch point and shadow orchestration target.
- `packages/application/src/ports/agent-runtime.port.ts` - port request/result shape.
- `packages/contracts/src/runtime-contract.ts` and `packages/contracts/src/runtime-contract-validation.ts` - canonical TS runtime contract types/validators.
- `apps/worker/src/conversation/conversation.processor.ts` - job-to-runtime request construction.
- `apps/worker/src/conversation/conversation.module.ts` - worker DI wiring and env-based MAF client construction.
- `apps/worker/src/conversation/runtime-ledger.repository.ts` - runtime attempt ID source.
- `apps/worker/src/conversation/shadow-diagnostics.repository.ts` - TypeScript-owned diagnostics/redaction writer.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story created after Story 5.4 implementation and BMAD code review were completed and marked done.
- Loaded BMAD create-story/dev-story instructions, sprint status, Epic 5 Story 5.5 requirements, Story 5.4 record, architecture spine, current MAF client/router/worker/shadow diagnostics/runtime ledger code, and TS runtime contract validators.
- 2026-08-06: Started dev-story implementation; status moved to in-progress.
- 2026-08-06: Red/green implementation for MAF candidate client, router shadow orchestration, worker context enrichment, diagnostics mapping, docs, and scope guardrails.
- 2026-08-06: Verification completed; story moved to review.
- 2026-08-06: BMAD code review completed; five patch findings resolved and verified.

### Completion Notes

- Added `MafAgentRuntimeClient.processCandidate` for shadow-only HTTP execution with canonical request/result validation against `@entalent/contracts` OpenAPI schema.
- Extended `ProcessMessageRequest` with optional canonical MAF fields and kept `MafAgentRuntimeClient.processMessage` fail-closed so MAF does not become user-facing in this story.
- Updated `AgentRuntimeRouter` to return TypeScript output unchanged, invoke MAF only for `maf_shadow`, record valid/invalid shadow candidate diagnostics, and keep `maf_canary` TypeScript-only.
- Wired worker runtime attempts to shadow diagnostics, enriched worker requests with bounded tenant-scoped message/recent-turn context, and reused `ShadowDiagnosticsRepository` redaction.
- Updated Story 5.5 docs/scope guardrails to permit only shadow candidate execution and continue blocking canary, UI, Python writes, Python command tools, deployment mutation, and user-facing MAF replies.
- BMAD code review findings resolved:
  - Added default global `fetch` usage so env-created worker clients can execute HTTP.
  - Added default timeout signaling for shadow HTTP calls.
  - Changed candidate idempotency keys to include `messageId`, preventing cross-message collisions.
  - Excluded soft-deleted and cross-thread messages from worker MAF context.
  - Made malformed historical timestamps drop only the bad turn, not the entire canonical context.
- Verification passed:
  - `pnpm --filter @entalent/contracts build`
  - `pnpm --filter @entalent/application build`
  - `pnpm --filter @entalent/worker build`
  - `pnpm --filter @entalent/application test -- src/use-cases/maf-agent-runtime-client.test.ts src/use-cases/agent-runtime-router.test.ts`
  - `pnpm --filter @entalent/worker test -- src/conversation/conversation.processor.test.ts src/conversation/conversation.module.test.ts src/conversation/shadow-diagnostics.repository.test.ts`
  - `pnpm --filter @entalent/application typecheck`
  - `pnpm --filter @entalent/application lint`
  - `pnpm --filter @entalent/worker typecheck`
  - `pnpm --filter @entalent/worker lint` (passed with existing `apps/worker/src/main.ts:27` no-console warning)
  - `pnpm --filter @entalent/contracts test`
  - `python3 packages/contracts/runtime/validate_fixtures.py`
  - `cd agent-service && .venv/bin/python -m pytest tests/unit`
  - `git diff --check`
  - `codegraph status`

### Change Log

- 2026-08-06: Created Story 5.5 as ready for development.
- 2026-08-06: Started Story 5.5 implementation.
- 2026-08-06: Implemented shadow-only MAF candidate integration and moved story to review.
- 2026-08-06: Resolved BMAD code review findings and marked Story 5.5 done.

### File List

- `_bmad-output/implementation-artifacts/5-5-integrate-maf-candidate-into-shadow-mode.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `docs/maf-runtime-client.md`
- `packages/contracts/src/runtime-contract-validation.ts`
- `packages/contracts/src/runtime-contract.test.ts`
- `packages/application/src/index.ts`
- `packages/application/src/ports/agent-runtime.port.ts`
- `packages/application/src/use-cases/maf-agent-runtime-client.ts`
- `packages/application/src/use-cases/maf-agent-runtime-client.test.ts`
- `packages/application/src/use-cases/agent-runtime-router.ts`
- `packages/application/src/use-cases/agent-runtime-router.test.ts`
- `apps/worker/src/conversation/conversation.processor.ts`
- `apps/worker/src/conversation/conversation.processor.test.ts`
- `apps/worker/src/conversation/conversation.module.ts`
- `apps/worker/src/conversation/conversation.module.test.ts`
- `apps/worker/src/conversation/shadow-diagnostics.repository.test.ts`
- `agent-service/tests/unit/test_scope.py`

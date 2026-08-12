---
baseline_commit: fbe6ef5eb851c2583259d322018f4b9f0fe04558
---

# Story 1.4: Log Runtime Decisions Per Job

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator,
I want every runtime routing decision logged with trace context,
so that rollout behavior can be audited before shadow and canary modes.

## Acceptance Criteria

1. Given a conversation job is routed, when runtime mode is resolved, then the log includes trace ID, tenant ID, user ID, selected mode, decision source, and fallback reason when present.
2. Given a runtime decision is logged, when log payload is inspected, then no message text or user-authored content is logged.

## Tasks / Subtasks

- [x] Add a runtime decision model in `packages/application` (AC: 1)
  - [x] Define `AgentRuntimeDecision` with `mode`, `decisionSource`, and optional `fallbackReason`.
  - [x] Keep `AgentRuntimeMode` values unchanged: `typescript`, `maf_shadow`, `maf_canary`, `maf_disabled`.
  - [x] Keep the application package framework-neutral; do not import NestJS or pino.
- [x] Update runtime mode resolution to include decision source (AC: 1)
  - [x] Have `AgentRuntimeModeResolver` return a decision object instead of only a mode, or add a dedicated `resolveDecision` method while preserving compatibility where needed.
  - [x] Map sources explicitly: global kill switch, tenant/user denylist, shadow flag, canary flag, TypeScript default.
  - [x] Preserve Story 1.3 precedence and fail-closed behavior.
- [x] Log runtime decisions in `AgentRuntimeRouter` (AC: 1, 2)
  - [x] Log exactly once per `processMessage` call after mode evaluation succeeds.
  - [x] On evaluation failure, log a TypeScript fallback decision with `fallbackReason` and still preserve the existing warning behavior with `traceId`.
  - [x] Include only `traceId`, `tenantId`, `userId`, selected runtime mode, decision source, and fallback reason when present.
  - [x] Do not log message text, response text, classification details, risk evidence, external conversation IDs, Slack workspace IDs, or user-authored content.
- [x] Wire the worker logger adapter (AC: 1, 2)
  - [x] Extend the existing worker-side `AgentRuntimeRouter` logger adapter in `apps/worker/src/conversation/conversation.module.ts`.
  - [x] Keep Nest `Logger` usage at the worker composition boundary only.
  - [x] Prefer the existing structured `createLogger(AgentRuntimeRouter.name)` / `AppLogger` pattern from `@entalent/observability` over stringifying context into the message.
  - [x] Keep `ConversationProcessor` unchanged; it should still inject only `AGENT_RUNTIME_PORT`.
- [x] Add focused tests (AC: 1, 2)
  - [x] Unit-test successful decision logging for default TypeScript, `maf_disabled`, `maf_shadow`, and `maf_canary`.
  - [x] Unit-test evaluation failure logging includes fallback reason and still delegates to `TypeScriptAgentRuntime`.
  - [x] Unit-test log payload key set so message/response/user-authored fields cannot appear.
  - [x] Update resolver tests to assert decision sources and existing precedence.
- [x] Run verification commands (AC: 1, 2)
  - [x] `pnpm --filter @entalent/application test -- agent-runtime`
  - [x] `pnpm --filter @entalent/application typecheck`
  - [x] `pnpm --filter @entalent/application build`
  - [x] `pnpm --filter @entalent/worker typecheck`
  - [x] Touched-file eslint for updated application and worker files.

### Review Findings

- [x] [Review][Patch] Sanitize runtime evaluation error values before logging fallback decisions or warnings [packages/application/src/use-cases/agent-runtime-router.ts:57]
- [x] [Review][Patch] Preserve resolver compatibility by adding a decision-returning API instead of changing `resolve()` callers directly [packages/application/src/use-cases/agent-runtime-mode-resolver.ts:14]
- [x] [Review][Patch] Validate malformed evaluator decision objects before writing audit fields [packages/application/src/use-cases/agent-runtime-router.ts:91]
- [x] [Review][Patch] Remove unrelated completion note from the story record [_bmad-output/implementation-artifacts/1-4-log-runtime-decisions-per-job.md:146]

## Dev Notes

### Current State

- Story 1.3 is done. Runtime controls now resolve MAF modes per job behind `AgentRuntimeRouter`, and all modes still invoke only `TypeScriptAgentRuntime`.
- `AgentRuntimeRouter` currently calls `evaluateMode(request)` but discards the returned mode before delegating to TypeScript. Story 1.4 should make that result observable without changing execution behavior.
- `AgentRuntimeRouterLogger` currently exposes `warn(message, context?)` for evaluation failures. This story can extend that small logger shape with an `info`/decision method, but it must remain framework-neutral.
- Worker composition currently creates `new Logger(AgentRuntimeRouter.name)` inside `apps/worker/src/conversation/conversation.module.ts` and maps router warnings to `logger.warn(...)`.
- `packages/observability/src/logger.ts` already defines `AppLogger` as `info/warn/error/etc(message, data?)`; this is the best existing shape for structured runtime decision fields.
- `ConversationProcessor` already logs job start and job completion. Do not move runtime decision logging there; the router owns runtime selection and has the authoritative decision.

### Architecture Compliance

- Follow AD-1: `ConversationProcessor` must continue depending only on `AGENT_RUNTIME_PORT`.
- Follow AD-13: runtime selection owner is `AgentRuntimeRouter`; therefore decision logging belongs in or directly around the router, not in downstream runtimes.
- Follow AD-5: all modes still delegate to TypeScript in this story; do not introduce MAF execution or side-effect fallback behavior.
- Follow the Consistency Conventions runtime mode names exactly.
- Follow FR30/Story 1.4: logs must include trace ID, tenant ID, user ID, selected mode, decision source, and fallback reason when present.

### Implementation Guardrails

- Do not add `MafAgentRuntimeClient`, Python service calls, shadow diagnostics records, canary dispatch, ledgers, or persistent audit tables in this story.
- Do not log message text, generated response text, risk evidence, classifier reasoning, Slack channel/workspace IDs, or external conversation IDs.
- Prefer a stable string event/message such as `Agent runtime decision resolved` plus structured context fields.
- Do not stringify structured runtime decision context into the message. Use logger data/context fields so downstream log search can filter by `traceId`, `tenantId`, `userId`, `mode`, and `decisionSource`.
- If `logger.info`/decision logging throws, conversation processing must still continue through TypeScript.
- If mode evaluation throws, keep the existing warning path and also emit a runtime decision context showing TypeScript fallback.
- Avoid duplicate logs. There should be one decision log per successful evaluation and one fallback decision log per evaluation failure.

### Previous Story Intelligence

- Commit `cb919d0` implemented runtime mode controls, resolver, worker adapter wiring, and tests.
- Commit `fbe6ef5` resolved review findings by requiring an explicit denylist reader and evaluating all matching enabled denylist rows.
- Story 1.3 tests established the focused command pattern: `pnpm --filter @entalent/application test -- agent-runtime` and `pnpm --filter @entalent/worker test -- runtime-control`.
- Full application lint is known to have unrelated pre-existing older-test issues. Use touched-file eslint unless separately fixing lint debt.

### Testing Requirements

- Add focused Vitest coverage in `packages/application/src/use-cases/agent-runtime-router.test.ts` and `packages/application/src/use-cases/agent-runtime-mode-resolver.test.ts`.
- Use stubbed logger objects to assert exact payload fields and to assert logger failures do not block fallback/delegation.
- Include a test that fails if payload fields are hidden inside a stringified message rather than passed as structured context to the logger stub.
- Worker verification can remain typecheck-only for provider wiring unless a local provider-test pattern is introduced.
- Run `pnpm test` if implementation changes public exports or runtime behavior beyond pure logging.

### Project Structure Notes

- Likely updated files:
  - `packages/application/src/use-cases/agent-runtime-router.ts`
  - `packages/application/src/use-cases/agent-runtime-router.test.ts`
  - `packages/application/src/use-cases/agent-runtime-mode-resolver.ts`
  - `packages/application/src/use-cases/agent-runtime-mode-resolver.test.ts`
  - `packages/application/src/index.ts`
  - `apps/worker/src/conversation/conversation.module.ts`
- No database, API, dashboard, MAF/Python, or UX files are expected for this story.

### Latest Technical Information

- No new external library or API is required. Use the stack already verified in the architecture spine: TypeScript 5.9.3, NestJS 10.4.22, pino 9.4.0 in `@entalent/observability`, and pnpm 9.12.0.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.4]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md#AD-1]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md#AD-5]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md#AD-13]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md#Consistency-Conventions]
- [Source: packages/application/src/use-cases/agent-runtime-router.ts]
- [Source: packages/application/src/use-cases/agent-runtime-router.test.ts]
- [Source: packages/application/src/use-cases/agent-runtime-mode-resolver.ts]
- [Source: packages/application/src/use-cases/agent-runtime-mode-resolver.test.ts]
- [Source: apps/worker/src/conversation/conversation.module.ts]
- [Source: apps/worker/src/conversation/conversation.processor.ts]
- [Source: packages/observability/src/logger.ts]

## Dev Agent Record

### Agent Model Used

Codex GPT-5

### Debug Log References

- RED: `pnpm --filter @entalent/application test -- agent-runtime` failed with expected missing decision/logging behavior.
- GREEN: `pnpm --filter @entalent/application test -- agent-runtime` passed with 19 tests.
- Verification: `pnpm --filter @entalent/application typecheck` passed.
- Verification: `pnpm --filter @entalent/application build` passed.
- Verification: `pnpm --filter @entalent/worker typecheck` passed when run after application build completed.
- Verification: `pnpm exec eslint packages/application/src/use-cases/agent-runtime-router.ts packages/application/src/use-cases/agent-runtime-router.test.ts packages/application/src/use-cases/agent-runtime-mode-resolver.ts packages/application/src/use-cases/agent-runtime-mode-resolver.test.ts packages/application/src/index.ts apps/worker/src/conversation/conversation.module.ts` passed.
- Regression: `pnpm test` passed with 15 successful turbo tasks.
- Review fixes: `pnpm --filter @entalent/application test -- agent-runtime` passed with 28 tests.
- Review fixes: `pnpm --filter @entalent/application typecheck` passed.
- Review fixes: `pnpm --filter @entalent/application build` passed.
- Review fixes: `pnpm --filter @entalent/worker typecheck` passed.
- Review fixes: touched-file eslint passed for updated application and worker files.
- Review fixes regression: `pnpm test` passed with 15 successful turbo tasks.

### Completion Notes List

- Added framework-neutral runtime decision types with explicit decision sources and optional fallback reason.
- Updated `AgentRuntimeModeResolver` to return decision objects while preserving Story 1.3 precedence and fail-closed propagation.
- Added structured decision logging in `AgentRuntimeRouter`, including TypeScript fallback decision logging on evaluation failure and guarded logger calls.
- Rewired worker composition to use `createLogger(AgentRuntimeRouter.name)` with structured context fields instead of JSON stringified context.
- Added focused tests for mode/source mappings, fallback logging, no-content payload keys, logger failure tolerance, and legacy string evaluator normalization.
- Resolved review findings by sanitizing fallback log values, restoring `resolve()` mode compatibility, adding `resolveDecision()`, validating evaluator outputs, and cleaning the story record.

### File List

- `_bmad-output/implementation-artifacts/1-4-log-runtime-decisions-per-job.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/worker/src/conversation/conversation.module.ts`
- `packages/application/src/index.ts`
- `packages/application/src/use-cases/agent-runtime-mode-resolver.test.ts`
- `packages/application/src/use-cases/agent-runtime-mode-resolver.ts`
- `packages/application/src/use-cases/agent-runtime-router.test.ts`
- `packages/application/src/use-cases/agent-runtime-router.ts`

## Change Log

- 2026-08-05: Created Story 1.4 and marked ready for dev.
- 2026-08-05: Implemented structured runtime decision logging and marked ready for review.
- 2026-08-05: Resolved code review findings and marked done.

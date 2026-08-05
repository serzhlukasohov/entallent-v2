# Story 1.2: Add Runtime Router With TypeScript Default

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an operator,
I want a runtime router behind `AGENT_RUNTIME_PORT`,
so that runtime mode can be evaluated per job without changing worker processors again.

## Acceptance Criteria

1. Given a conversation job reaches the worker, when the router evaluates runtime mode, then it returns `typescript` by default and delegates to `TypeScriptAgentRuntime`.
2. Given runtime mode evaluation fails, when the worker must continue processing, then the router fails closed to `typescript` and records a warning with the job trace ID.

## Tasks / Subtasks

- [ ] Add `AgentRuntimeRouter` in `packages/application/src/use-cases/agent-runtime-router.ts` (AC: 1, 2)
  - [ ] Implement `AgentRuntimePort` and accept a `TypeScriptAgentRuntime` dependency.
  - [ ] Resolve runtime mode per `processMessage` call, not at process start.
  - [ ] Default to `typescript` and delegate to `TypeScriptAgentRuntime.processMessage(request)`.
  - [ ] Wrap mode evaluation so unexpected errors fail closed to TypeScript.
- [ ] Add unit coverage for router behavior in `packages/application/src/use-cases/agent-runtime-router.test.ts` (AC: 1, 2)
  - [ ] Verify default processing calls TypeScript runtime exactly once and returns its result.
  - [ ] Verify an injected/evaluated failure logs or reports a warning containing `traceId` and still calls TypeScript.
- [ ] Export the router from `packages/application/src/index.ts` (AC: 1)
- [ ] Rewire `apps/worker/src/conversation/conversation.module.ts` so `AGENT_RUNTIME_PORT` resolves to `AgentRuntimeRouter` (AC: 1)
  - [ ] Provide `TypeScriptAgentRuntime` as its own injectable/factory provider.
  - [ ] Keep `ConversationProcessor` unchanged; it must continue injecting only `AGENT_RUNTIME_PORT`.
- [ ] Update verification commands (AC: 1, 2)
  - [ ] `pnpm --filter @entalent/application test`
  - [ ] `pnpm --filter @entalent/application typecheck`
  - [ ] `pnpm --filter @entalent/worker typecheck`

## Dev Notes

### Current State

- `ConversationProcessor` already depends on `AGENT_RUNTIME_PORT` and calls `agentRuntime.processMessage(...)` for inbound jobs. Do not reintroduce direct `ConversationOrchestrator` injection into the processor. [Source: apps/worker/src/conversation/conversation.processor.ts]
- `AGENT_RUNTIME_PORT` and `AgentRuntimePort` live in `packages/application/src/ports/agent-runtime.port.ts`. The request currently contains message, conversation, user, tenant, external Slack workspace/conversation, and trace IDs. [Source: packages/application/src/ports/agent-runtime.port.ts]
- `TypeScriptAgentRuntime` is a thin wrapper around `ConversationOrchestrator.orchestrate(request)`. Preserve this behavior exactly. [Source: packages/application/src/use-cases/typescript-agent-runtime.ts]
- `ConversationModule` currently binds `AGENT_RUNTIME_PORT` directly to `new TypeScriptAgentRuntime(orchestrator)`. This story changes that provider to route through `AgentRuntimeRouter`. [Source: apps/worker/src/conversation/conversation.module.ts]

### Architecture Compliance

- Follow AD-1: all inbound conversation processing enters through `AgentRuntimePort.processMessage`; worker processors must not depend on concrete runtimes. [Source: _bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md#AD-1]
- Follow AD-13: `AGENT_RUNTIME_PORT` must resolve to a runtime router once MAF work starts. The router evaluates per job and fail-closed behavior goes to TypeScript-only. [Source: _bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md#AD-13]
- Runtime mode names are `typescript`, `maf_shadow`, `maf_canary`, and `maf_disabled`, but this story only implements the default `typescript` path and failure fallback. [Source: _bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md#Consistency-Conventions]
- Do not add `MafAgentRuntimeClient`, Python service calls, shadow diagnostics, kill-switch logic, tenant/user denylist logic, or canary routing in this story. Those belong to later stories.

### Implementation Guardrails

- Keep the router framework-neutral inside `@entalent/application`. Do not import NestJS, worker modules, database repositories, or MAF/Python types into `packages/application`.
- Use dependency injection at the worker module boundary. The application package can expose plain classes; the Nest module should compose them.
- If the router needs a warning hook, prefer a small constructor dependency or an internal default logger shape that is easy to stub in tests. Avoid taking a hard dependency on Nest `Logger` inside the application package.
- Make runtime mode evaluation a private method or injected strategy so tests can force the failure path without causing TypeScript runtime failure.
- Warning content must include `traceId` and must not log message text. The current request object does not contain message text; keep it that way.

### Previous Story Intelligence

- Commit `ffea6fd` introduced `AgentRuntimePort`, `TypeScriptAgentRuntime`, and worker injection through `AGENT_RUNTIME_PORT`.
- Story 1.1 was implemented before this story file existed; keep its behavior as the regression baseline.
- The prior checks that passed were `pnpm --filter @entalent/application typecheck`, `pnpm --filter @entalent/application test`, `pnpm --filter @entalent/application build`, and `pnpm --filter @entalent/worker typecheck`.

### Testing Requirements

- Add focused Vitest unit tests in `@entalent/application` for the router. There are existing application tests under `packages/application/src/use-cases/*.test.ts`; follow that style.
- Worker verification can be typecheck-only for this story unless a local worker module test pattern already exists. The main worker risk is provider wiring and export correctness.
- Do not require live Slack, Redis, Postgres, OpenAI, or BullMQ workers for this story.

### Project Structure Notes

- New application use-case file: `packages/application/src/use-cases/agent-runtime-router.ts`.
- New application test file: `packages/application/src/use-cases/agent-runtime-router.test.ts`.
- Updated exports: `packages/application/src/index.ts`.
- Updated provider wiring: `apps/worker/src/conversation/conversation.module.ts`.
- No UX files are relevant for this backend/runtime story.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.2]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md#AD-1]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md#AD-13]
- [Source: packages/application/src/ports/agent-runtime.port.ts]
- [Source: packages/application/src/use-cases/typescript-agent-runtime.ts]
- [Source: apps/worker/src/conversation/conversation.module.ts]
- [Source: apps/worker/src/conversation/conversation.processor.ts]

## Dev Agent Record

### Agent Model Used

Codex GPT-5

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.

### File List

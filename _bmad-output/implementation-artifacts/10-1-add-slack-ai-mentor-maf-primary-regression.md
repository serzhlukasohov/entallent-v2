---
baseline_commit: b5eed099a56c92643d77d20d31937a5aa5eaf910
---

# Story 10.1: Add Slack AI Mentor MAF-Primary Regression

Status: done
Epic: 10 - MAF-First Feature Regression Framework
Story ID: 10.1

## Story

As a product engineering owner,
I want the Slack AI mentor feature to have an explicit MAF-primary regression,
so that future feature work proves the inbound-to-outbound product path through MAF before relying on legacy runtime coverage.

## Acceptance Criteria

1. Given a Slack-equivalent or API dev event enters the system, when the regression runs with MAF primary enabled, then the path reaches `queue -> worker -> MAF runtime -> TypeScript validation/persistence -> outbound/send/audit/runtime_attempts`.
2. Given the inbound event is accepted, then HMAC-equivalent ingestion coverage or dev API auth coverage, idempotency expectations, inbound persistence, conversation job enqueueing, outbound persistence, message-send enqueueing, and trace/runtime evidence are all asserted.
3. Given the outbound reply is produced, then persisted metadata proves `runtimeMode = "maf_primary"` and includes runtime version, model/tool counts, and retry count.
4. Given the runtime attempt is recorded, then the attempt for the inbound trace is `runtimeMode = "maf_primary"` and reaches `reply_committed` or `actions_committed` without failure.
5. Given the product-level scenario is added or named, then it is visibly tagged or named as MAF-first Slack AI mentor coverage and does not expand `ConversationOrchestrator` tests except for fallback/rollback behavior.
6. Given deterministic coverage exists, then any judged/live check remains additive and reuses existing `conversation-sim`, eval, or smoke infrastructure.

## Tasks / Subtasks

- [x] Identify the smallest existing test home for the Slack AI mentor MAF-primary regression. (AC: 1, 5)
  - [x] Prefer extending existing Vitest/script smoke coverage over adding a new framework.
  - [x] Reuse `scripts/live-maf-primary-app-smoke.ts` behavior where enough; do not duplicate a smoke runner.
- [x] Add explicit MAF-first coverage naming or tagging for Slack AI mentor. (AC: 5)
  - [x] Make the test/report name searchable for `Slack AI mentor` and `maf_primary`.
- [x] Cover the deterministic inbound-to-outbound evidence. (AC: 1, 2, 3, 4)
  - [x] Assert inbound persistence and conversation queue enqueue.
  - [x] Assert outbound persistence and `message-send` enqueue.
  - [x] Assert outbound metadata has `runtimeMode = "maf_primary"`, runtime version, model calls, tool calls, and retry count.
  - [x] Assert `runtime_attempts` row exists for the trace and reaches a committed phase.
- [x] Keep judged/live evaluation separate from deterministic proof. (AC: 6)
  - [x] If a live judge is added, only add it after deterministic coverage for the same path exists.
- [x] Run the smallest matching verification gate. (AC: 1-6)
  - [x] Run targeted tests for the touched package or script.
  - [x] Run `pnpm maf:primary:app:smoke` when local env has required Postgres, Redis, agent-service model/provider, and admin key configuration.

### Review Findings

- [x] [Review][Patch] Redact all diagnostic secret values before printing child logs [scripts/live-maf-primary-app-smoke.ts]
- [x] [Review][Patch] Require job-specific queue evidence instead of aggregate admin queue fallback [scripts/live-maf-primary-app-smoke.ts]
- [x] [Review][Patch] Add helper tests for regression metadata, Redis DB parsing, and diagnostic redaction [scripts/live-maf-primary-app-smoke.test.ts]

## Dev Notes

- This story implements the first row of the MAF-first feature regression matrix: Slack AI mentor. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/feature-regression-matrix.md#Feature-Regression-Matrix]
- Product-level regressions must use MAF primary; legacy `ConversationOrchestrator` tests are fallback/rollback only. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md#Constraints]
- Do not create a new test framework while Vitest, pytest, `conversation-sim`, live smoke scripts, and evals are sufficient. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md#Constraints]
- `DevSimulateController.simulate` already creates/fetches the dev user and conversation, saves the inbound message, enqueues the `conversation` queue job, and returns `traceId`, `messageId`, `conversationId`, and `userId`. [Source: apps/api/src/dev/dev-simulate.controller.ts]
- `MafPrimaryAgentRuntime.processMessage` already calls the MAF candidate provider, saves the outbound message with primary metadata, enqueues `message-send`, and queues TypeScript-owned extraction jobs. [Source: packages/application/src/use-cases/maf-primary-agent-runtime.ts]
- `scripts/live-maf-primary-app-smoke.ts` already drives `/dev/simulate-message`, polls outbound messages, validates DB metadata, checks `runtime_attempts`, and checks the `message-send` queue. Prefer reusing or tightening this path over creating another runner. [Source: scripts/live-maf-primary-app-smoke.ts]
- Story 9.2 proved the app-level primary smoke exists. This story turns that path into explicit product feature regression coverage for Slack AI mentor. [Source: _bmad-output/implementation-artifacts/9-2-run-full-app-primary-runtime-smoke.md]

### Project Structure Notes

- Likely touch points are existing tests or scripts under `scripts/`, `apps/api`, `apps/worker`, `packages/application`, or `packages/conversation-sim`.
- Do not place product regression helpers outside existing test homes unless a second feature needs the same setup.
- Do not change Railway deployment, production variables, migrations, Slack app settings, or service domains for this story.

### Testing Requirements

- Minimum deterministic verification: targeted Vitest/script test for the touched test home.
- Feature gate when env allows:

```bash
SIM_GATE_RUNS=1 pnpm sim:gate
pnpm maf:primary:app:smoke
```

- Runtime/Slack-sensitive gate when env allows:

```bash
pnpm maf:primary:app:smoke
pnpm maf:agent-service:readiness
```

## Out Of Scope

- New test framework or new dependency.
- Full Slack live smoke rewrite.
- Expansion of legacy `ConversationOrchestrator` tests for primary feature confidence.
- Manager dashboard, memory, survey, proactive, privacy, or rollout regression rows.

## References

- [SPEC: MAF-First Feature Regression Framework](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md)
- [Feature Regression Matrix](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/feature-regression-matrix.md)
- [Regression Gates](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/regression-gates.md)
- [Story 9.2: Run Full App-Level Primary Runtime Smoke](/Users/serzh/Documents/enTalentNew/_bmad-output/implementation-artifacts/9-2-run-full-app-primary-runtime-smoke.md)

## Dev Agent Record

### Agent Model Used

Codex GPT-5

### Debug Log References

- 2026-08-15: `pnpm run test:scripts` initially required escalation because sandboxed `tsx` IPC failed with `listen EPERM`.
- 2026-08-15: `API_PORT=3002 pnpm maf:primary:app:smoke` exposed worker `WORKER_PORT` collision on 3001; fixed by assigning a reserved worker port in the smoke runner.
- 2026-08-15: Smoke then exposed stale `getDbClient().client` usage; fixed to use `getDbClient().db`.
- 2026-08-15: Final smoke passed with all `productChecks` true, including dev API auth, inbound persistence, conversation processing, outbound persistence, MAF primary metadata, committed runtime attempt, and message-send queue evidence.
- 2026-08-15: Code review found unsafe diagnostic redaction, false-positive admin queue fallback, and missing helper tests; all were patched and reverified.

### Completion Notes List

- Reused `scripts/live-maf-primary-app-smoke.ts` as the product-level MAF-first regression home; no new framework was added.
- Added explicit searchable regression metadata for `Slack AI mentor` and `maf_primary`, plus a lightweight assert-based script test wired into `test:scripts`.
- Tightened smoke evidence to report product checks for dev API auth, inbound/outbound persistence, queue processing, MAF primary metadata, runtime attempt commit, and message-send queue evidence.
- Stabilized local smoke isolation by using Redis DB 15, generated local internal/admin auth when absent, and free worker/agent-service ports.
- Preserved deterministic proof only; no live judge or conversation-sim expansion was added.
- Addressed review findings by redacting diagnostic secrets globally, requiring job-specific Redis queue evidence, asserting `conversation` queue enqueue, proving a single runtime attempt for the inbound trace/message, and adding helper tests for redaction/Redis DB parsing.

### File List

- `apps/api/src/queue/queue.module.ts`
- `apps/api/src/queue/redis.service.ts`
- `apps/worker/src/queue/queue.module.ts`
- `apps/worker/src/queue/redis.service.ts`
- `package.json`
- `scripts/live-maf-primary-app-smoke.ts`
- `scripts/live-maf-primary-app-smoke.test.ts`
- `_bmad-output/implementation-artifacts/10-1-add-slack-ai-mentor-maf-primary-regression.md`

## Change Log

- 2026-08-15: Implemented Slack AI mentor MAF-primary regression coverage using the existing app smoke runner and script tests.
- 2026-08-15: Addressed code review findings and revalidated the story gate.

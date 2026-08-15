---
baseline_commit: b5eed099a56c92643d77d20d31937a5aa5eaf910
---

# Story 10.2: Add Long-Term Memory MAF-Primary Regression

Status: done
Epic: 10 - MAF-First Feature Regression Framework
Story ID: 10.2

## Story

As a product engineering owner,
I want the long-term memory feature to have explicit MAF-primary regression coverage,
so that future mentor behavior proves durable user context reaches MAF without leaking deleted, superseded, or expired memory.

## Acceptance Criteria

1. Given a user has durable memory items, when an inbound product-level regression runs with MAF primary enabled, then the worker passes those items into `runtimeContext.memoryItems` before calling the MAF runtime.
2. Given memory context is loaded for MAF, then only active memory for the same tenant and user is included.
3. Given deleted, superseded, expired, or otherwise excluded memory exists, then it is not included in the MAF runtime request.
4. Given more memory exists than the runtime limit, then the request includes the expected limited set ordered by importance and deterministic tie-break behavior.
5. Given privacy/export/delete behavior is exercised by existing product code, then the regression proves deleted memory cannot re-enter MAF context; full GDPR workflow changes remain out of scope for this story.
6. Given quality checks are added, then any judged or simulation coverage is additive and reuses existing `conversation-sim`, eval, or smoke infrastructure after deterministic MAF-primary proof exists.
7. Given this story adds product-level confidence, then it does not expand legacy `ConversationOrchestrator` tests except for fallback or rollback behavior.

## Tasks / Subtasks

- [x] Identify the smallest existing test home for long-term memory MAF-primary coverage. (AC: 1, 6, 7)
  - [x] Prefer `apps/worker/src/conversation/conversation.processor.test.ts` for request construction proof.
  - [x] Prefer `apps/api/src/internal-maf-context/internal-maf-context.service.test.ts` only for internal context/delete exclusion behavior already owned by API context reads.
  - [x] Do not create a new framework, runner, or shared helper unless two feature rows need the same setup.
- [x] Prove inbound MAF request memory context. (AC: 1, 2, 4)
  - [x] Seed multiple memory rows for the same tenant/user.
  - [x] Run the existing worker conversation processing path with MAF primary.
  - [x] Assert the captured `agentRuntime.processMessage` request includes `runtimeContext.memoryItems`.
  - [x] Assert each item shape matches the runtime contract fields: `id`, `category`, `content`, `importance`.
- [x] Prove exclusion rules. (AC: 2, 3, 5)
  - [x] Same tenant/user active memory is included.
  - [x] Other-tenant and other-user memory is excluded.
  - [x] Deleted memory is excluded.
  - [x] Superseded memory is excluded by the existing `status` and `supersededById` model; do not add a new conflict status for this story.
  - [x] Expired memory is excluded. If the current worker loader does not filter `expiresAt`, add the minimal filter in the existing query.
- [x] Prove ordering and limits. (AC: 4)
  - [x] Assert highest-importance memory appears first.
  - [x] Assert the existing runtime limit is enforced.
  - [x] Assert ties are stable using the existing secondary sort if present.
- [x] Keep product-level proof MAF-first. (AC: 1, 6, 7)
  - [x] Name or tag the test so it is searchable for `Long-term memory` and `maf_primary`.
  - [x] If a sim/eval is added, it must check "uses relevant memory without creepy over-sharing" and run after deterministic assertions.
- [x] Run the smallest matching verification gate. (AC: 1-7)
  - [x] Run the targeted worker/API tests touched by this story.
  - [x] Run `pnpm typecheck`.
  - [x] Run `SIM_GATE_RUNS=1 pnpm sim:gate` only if simulation coverage is changed and env allows.
  - [x] Run `pnpm maf:primary:app:smoke` if the live smoke is extended for seeded memory evidence and local env allows.
- [x] Resolve code review findings. (AC: 1-7)
  - [x] Use the same `now` for memory query filtering and runtime item mapping.
  - [x] Add deterministic `id` tie-break ordering after importance and creation time.
  - [x] Treat invalid `expiresAt` values as excluded from MAF runtime memory context.
  - [x] Make the regression mock apply where/order/limit semantics before mapping, matching production query behavior.
  - [x] Assert the runtime memory item contract shape.

## Dev Notes

- This story implements the second row of the MAF-first feature regression matrix: Long-term memory. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/feature-regression-matrix.md#Feature-Regression-Matrix]
- Product-level regressions must use MAF primary; legacy `ConversationOrchestrator` coverage is fallback/rollback only. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md#Constraints]
- Do not create a new test framework while Vitest, pytest, `conversation-sim`, live smoke scripts, and evals are sufficient. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md#Constraints]
- `RuntimeContext.memoryItems` is already part of the runtime contract and each item contains `id`, `category`, `content`, and `importance`. [Source: packages/contracts/src/runtime-contract.ts]
- `ConversationProcessor.loadMafCandidateContext` currently builds `runtimeContext.memoryItems` from database memory rows before calling `agentRuntime.processMessage`. This is the primary inbound product path to cover. [Source: apps/worker/src/conversation/conversation.processor.ts]
- The worker memory query currently orders by `importance` and `createdAt` and limits the result. The regression should lock the current intended behavior before feature work relies on it. [Source: apps/worker/src/conversation/conversation.processor.ts]
- `MemoryRepository.findActiveByUser` filters by tenant, user, active status, and `supersededById IS NULL`; the in-memory test repository also excludes expired memory. Use these as the canonical behavior when comparing MAF context loader semantics. [Source: apps/worker/src/memory/repositories/memory.repository.ts; packages/conversation-sim/src/fakes/repositories.ts]
- `InternalMafContextService.readContext` already has API-side context read coverage for memory rows and should be used only where the story needs internal context/delete exclusion evidence. [Source: apps/api/src/internal-maf-context/internal-maf-context.service.ts]
- Story 10.1 established the app smoke as the first MAF-primary product regression. Reuse its conventions for searchable feature names and deterministic evidence instead of creating another smoke framework. [Source: _bmad-output/implementation-artifacts/10-1-add-slack-ai-mentor-maf-primary-regression.md]

### Project Structure Notes

- Likely touch points:
  - `apps/worker/src/conversation/conversation.processor.test.ts`
  - `apps/worker/src/conversation/conversation.processor.ts`
  - `apps/api/src/internal-maf-context/internal-maf-context.service.test.ts`
  - `apps/api/src/internal-maf-context/internal-maf-context.service.ts`
  - `scripts/live-maf-primary-app-smoke.ts` only if live seeded-memory evidence is added
- Avoid `ConversationOrchestrator` as the primary feature proof.
- Avoid changing Railway deployment, production variables, migrations, Slack app settings, or service domains for this story.
- Avoid adding broad shared helpers until a second feature row repeats the same setup.

### Testing Requirements

Minimum deterministic verification:

```bash
pnpm --filter @entalent/worker test
pnpm --filter @entalent/api test
pnpm typecheck
```

Feature gate when env allows:

```bash
SIM_GATE_RUNS=1 pnpm sim:gate
pnpm maf:primary:app:smoke
```

## Out Of Scope

- New test framework, dependency, or regression runner.
- Full GDPR export/delete implementation.
- Full memory extraction redesign.
- Prompt tuning for memory tone unless a judged/sim check is explicitly added after deterministic coverage.
- Manager dashboard, survey, proactive, safety, style adaptation, profile hydration, admin console, or rollout regression rows.

## References

- [SPEC: MAF-First Feature Regression Framework](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md)
- [Feature Regression Matrix](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/feature-regression-matrix.md)
- [Regression Gates](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/regression-gates.md)
- [Story 10.1: Add Slack AI Mentor MAF-Primary Regression](/Users/serzh/Documents/enTalentNew/_bmad-output/implementation-artifacts/10-1-add-slack-ai-mentor-maf-primary-regression.md)

## Dev Agent Record

### Agent Model Used

Codex GPT-5

### Debug Log References

- 2026-08-15: `pnpm --filter @entalent/worker test -- conversation.processor.test.ts` passed.
- 2026-08-15: `pnpm --filter @entalent/worker typecheck` passed after tightening Vitest mock call typing.
- 2026-08-15: `pnpm typecheck` passed.
- 2026-08-15: `pnpm test` passed outside sandbox; sandboxed run failed only at `test:scripts` because `tsx` could not create its IPC pipe (`listen EPERM`).
- 2026-08-15: Code review fixes applied; `pnpm --filter @entalent/worker test -- conversation.processor.test.ts`, `pnpm --filter @entalent/worker typecheck`, `pnpm typecheck`, and `pnpm test` passed.

### Completion Notes List

- Added a searchable `Long-term memory maf_primary` worker regression that captures the MAF primary runtime request and asserts `runtimeContext.memoryItems`.
- Tightened worker MAF memory context loading to exclude superseded and expired memory in both inbound and proactive MAF context builders.
- Resolved review findings by sharing `now` across query/mapper logic, adding `id` tie-break ordering, excluding invalid expiry values, making the mocked DB enforce production-like where/order/limit behavior, and asserting memory item shape.
- Kept the implementation in existing worker code/tests; no new framework, dependency, smoke runner, sim, or eval was added.
- Full GDPR export/delete workflow remained out of scope; this story proves deleted/superseded/expired memory cannot enter the worker-built MAF request context.

### File List

- `apps/worker/src/conversation/conversation.processor.ts`
- `apps/worker/src/conversation/conversation.processor.test.ts`
- `_bmad-output/implementation-artifacts/10-2-add-long-term-memory-maf-primary-regression.md`

## Change Log

- 2026-08-15: Created dev-ready story for Long-term memory MAF-primary regression coverage.
- 2026-08-15: Implemented worker MAF memory-context regression and marked story ready for review.
- 2026-08-15: Applied code review fixes and marked story done.

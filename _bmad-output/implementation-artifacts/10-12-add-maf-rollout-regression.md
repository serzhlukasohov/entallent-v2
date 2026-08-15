---
baseline_commit: b5eed099a56c92643d77d20d31937a5aa5eaf910
---

# Story 10.12: Add MAF Rollout Regression

Status: done
Epic: 10 - MAF-First Feature Regression Framework
Story ID: 10.12

## Story

As a runtime owner,
I want MAF rollout behavior to have explicit regression coverage,
so that runtime flags, fallback barriers, invalid results, runtime attempts, and smoke gates keep rollout and rollback safe.

## Acceptance Criteria

1. Given runtime flags are evaluated, then disabled, shadow, primary, canary, denylist, and TypeScript default decisions remain covered.
2. Given MAF fails before durable side effects, then fallback is allowed only while the barrier is open.
3. Given MAF has committed actions or a reply, then TypeScript fallback is blocked.
4. Given MAF returns invalid output, then the runtime rejects it with a safe diagnostic.
5. Given runtime attempts are recorded, then MAF primary attempts preserve explicit mode, phase, and durable lookup behavior.
6. Given this story adds product-level confidence, then it reuses existing application/worker/smoke tests and does not create a new regression framework.

## Tasks / Subtasks

- [x] Identify the smallest existing test homes for MAF rollout coverage. (AC: 1-6)
  - [x] Reuse `packages/application/src/use-cases/agent-runtime-mode-resolver.test.ts` for flag decisions.
  - [x] Reuse `packages/application/src/use-cases/agent-runtime-router.test.ts` for primary/canary/invalid-result behavior.
  - [x] Reuse `apps/worker/src/conversation/runtime-ledger.repository.test.ts` for runtime attempts.
  - [x] Reuse `apps/worker/src/conversation/runtime-fallback-barrier.service.test.ts` for worker fallback barrier behavior.
- [x] Reuse the existing pure application fallback barrier regression.
  - [x] Do not create a new runner, framework, fixture package, sim, or eval.
- [x] Prove pure fallback barrier semantics in the application package. (AC: 2-3)
  - [x] Assert open MAF phases allow fallback.
  - [x] Assert committed phases block fallback.
  - [x] Assert unknown or non-MAF attempts stay closed/unknown.
  - [x] Assert blocked fallback does not invoke the callback.
- [x] Preserve existing rollout evidence. (AC: 1, 4-5)
  - [x] Keep existing mode resolver coverage.
  - [x] Keep existing router invalid-result coverage.
  - [x] Keep existing runtime ledger coverage.
  - [x] Keep existing runtime fallback service coverage.
- [x] Run the smallest matching verification gate. (AC: 1-6)
  - [x] Run targeted application rollout tests.
  - [x] Run targeted worker rollout tests.
  - [x] Run `pnpm typecheck`.

## Dev Notes

- This story implements the twelfth row of the MAF-first feature regression matrix: MAF rollout. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/feature-regression-matrix.md#Feature-Regression-Matrix]
- Product-level regressions must use MAF primary; legacy `ConversationOrchestrator` coverage is fallback or rollback only. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md#Constraints]
- Runtime mode decisions are already covered in `AgentRuntimeModeResolver` tests. [Source: packages/application/src/use-cases/agent-runtime-mode-resolver.test.ts]
- Primary/canary routing and invalid response rejection are already covered in `AgentRuntimeRouter` tests. [Source: packages/application/src/use-cases/agent-runtime-router.test.ts]
- Runtime attempts and durable fallback lookup are already covered in worker runtime ledger tests. [Source: apps/worker/src/conversation/runtime-ledger.repository.test.ts]
- Worker fallback barrier behavior is already covered through `RuntimeFallbackBarrierService`; this story adds direct pure-function coverage for the exported application invariant. [Source: apps/worker/src/conversation/runtime-fallback-barrier.service.test.ts; packages/application/src/use-cases/runtime-fallback-barrier.ts]

## Out Of Scope

- New rollout UI.
- New feature flag system.
- New runtime ledger schema.
- New live smoke script.
- New regression framework, sim, or eval.
- Legacy `ConversationOrchestrator` expansion.

## References

- [SPEC: MAF-First Feature Regression Framework](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md)
- [Feature Regression Matrix](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/feature-regression-matrix.md)
- [Story 10.11: Add GDPR Privacy MAF-Primary Regression](/Users/serzh/Documents/enTalentNew/_bmad-output/implementation-artifacts/10-11-add-gdpr-privacy-maf-primary-regression.md)

## Dev Agent Record

### Agent Model Used

Codex GPT-5

### Debug Log References

- `pnpm --filter @entalent/application test -- agent-runtime-mode-resolver.test.ts agent-runtime-router.test.ts runtime-fallback-barrier.test.ts`
- `pnpm --filter @entalent/worker test -- runtime-ledger.repository.test.ts runtime-fallback-barrier.service.test.ts`
- `pnpm typecheck`

### Completion Notes List

- Verified existing direct application-level runtime fallback barrier coverage for open, closed, unknown, and non-MAF attempt states.
- Verified existing blocked fallback coverage does not invoke a TypeScript fallback callback.
- Preserved existing mode resolver, router invalid-result, runtime ledger, and worker fallback service coverage.
- Verified targeted application rollout tests, targeted worker rollout tests, and workspace typecheck.

### File List

- `_bmad-output/implementation-artifacts/10-12-add-maf-rollout-regression.md`

## Change Log

- 2026-08-15: Created MAF rollout regression story.
- 2026-08-15: Verified MAF rollout regression story using existing rollout coverage.

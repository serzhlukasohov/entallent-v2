---
baseline_commit: b5eed099a56c92643d77d20d31937a5aa5eaf910
---

# Story 10.6: Add Style Adaptation MAF-Primary Regression

Status: done
Epic: 10 - MAF-First Feature Regression Framework
Story ID: 10.6

## Story

As a product engineering owner,
I want style adaptation to have explicit MAF-primary regression coverage,
so that learned user style reaches MAF as bounded profile context without fake conversation turns or legacy orchestrator expansion.

## Acceptance Criteria

1. Given a user has a style profile, when an inbound product-level regression runs through MAF primary, then the worker passes bounded `runtimeContext.styleAdaptation` before calling MAF.
2. Given style phrases exist, then at most five phrase cues are passed and they remain phrase cues, not sentinel turns.
3. Given style profile dimensions exist, then numeric dimensions and adaptation weight are passed with weight capped to the runtime contract range.
4. Given no valid style profile exists, then MAF context omits `styleAdaptation`.
5. Given style analysis remains TypeScript-owned, then the existing post-reply `enqueueStyleAnalysis` behavior is preserved.
6. Given this story adds product-level confidence, then it reuses existing Vitest/contract tests and does not create a new regression framework.

## Tasks / Subtasks

- [x] Identify the smallest existing test home for style adaptation MAF-primary coverage. (AC: 1-6)
  - [x] Use `apps/worker/src/conversation/conversation.processor.test.ts` for worker request construction.
  - [x] Use `packages/contracts/src/runtime-contract.test.ts` for runtime boundary schema acceptance.
  - [x] Do not create a new runner, framework, fixture package, sim, or eval.
- [x] Add bounded style context to MAF runtime requests. (AC: 1-4)
  - [x] Load style profile via the existing user/conversation query join.
  - [x] Pass `runtimeContext.styleAdaptation` when profile dimensions and positive weight are present.
  - [x] Cap weight to `0..0.4`.
  - [x] Limit phrases to five.
- [x] Prove no sentinel-turn behavior. (AC: 2)
  - [x] Assert style context is structured under `styleAdaptation`, while `recentTurns` remains real conversation turns only.
- [x] Preserve existing side-effect ownership. (AC: 5, 6)
  - [x] Keep style analysis queued after MAF primary through existing TypeScript-owned extraction jobs.
  - [x] Do not expand legacy `ConversationOrchestrator` tests.
- [x] Run the smallest matching verification gate. (AC: 1-6)
  - [x] Run targeted worker conversation processor test.
  - [x] Run targeted contracts runtime contract test.
  - [x] Run `pnpm typecheck`.

## Dev Notes

- This story implements the sixth row of the MAF-first feature regression matrix: Style adaptation. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/feature-regression-matrix.md#Feature-Regression-Matrix]
- Product-level regressions must use MAF primary; legacy `ConversationOrchestrator` coverage is fallback or rollback only. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md#Constraints]
- Existing style analysis remains TypeScript-owned and queue-backed after the primary reply. [Source: packages/application/src/use-cases/maf-primary-agent-runtime.ts]
- Existing style profile storage lives in `user_style_profiles` and is exposed by the worker repository; this story uses the same table shape directly in the worker MAF context query to avoid extra wiring. [Source: apps/worker/src/style/repositories/style-profile.repository.ts]
- Existing AI style adaptation context already uses observed dimensions, bounded weight, and phrase cues; MAF runtime context now mirrors that shape. [Source: packages/application/src/ports/ai-provider.port.ts]

## Out Of Scope

- New style analysis algorithm.
- Prompt tuning or judged style eval.
- New regression framework.
- Legacy `ConversationOrchestrator` expansion.
- Dashboard/admin UI for style profiles.

## References

- [SPEC: MAF-First Feature Regression Framework](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md)
- [Feature Regression Matrix](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/feature-regression-matrix.md)
- [Story 10.5: Add Safety / Risk MAF-Primary Regression](/Users/serzh/Documents/enTalentNew/_bmad-output/implementation-artifacts/10-5-add-safety-risk-maf-primary-regression.md)

## Dev Agent Record

### Agent Model Used

Codex GPT-5

### Debug Log References

- 2026-08-15: `pnpm --filter @entalent/worker test -- conversation.processor.test.ts` passed.
- 2026-08-15: `pnpm --filter @entalent/contracts test -- runtime-contract.test.ts` passed, including Python runtime fixture validation.
- 2026-08-15: `pnpm typecheck` passed.

### Completion Notes List

- Added `runtimeContext.styleAdaptation` to the runtime contract and OpenAPI schema.
- Worker MAF context now includes bounded style profile data when available.
- Agent-service now renders bounded style context into MAF candidate reference context.
- Added searchable `Style adaptation maf_primary` regression without adding a new framework.

### File List

- `packages/contracts/src/runtime-contract.ts`
- `packages/contracts/runtime/openapi.json`
- `agent-service/src/agent_service/contracts/openapi.json`
- `agent-service/src/agent_service/workflows/model_provider.py`
- `agent-service/tests/unit/test_model_provider_prompt.py`
- `packages/contracts/src/runtime-contract.test.ts`
- `apps/worker/src/conversation/conversation.processor.ts`
- `apps/worker/src/conversation/conversation.processor.test.ts`
- `_bmad-output/implementation-artifacts/10-6-add-style-adaptation-maf-primary-regression.md`

## Change Log

- 2026-08-15: Created, implemented, verified, and marked Style adaptation MAF-primary regression story done.

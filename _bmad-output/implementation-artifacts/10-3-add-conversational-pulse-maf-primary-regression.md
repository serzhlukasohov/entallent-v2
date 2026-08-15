---
baseline_commit: b5eed099a56c92643d77d20d31937a5aa5eaf910
---

# Story 10.3: Add Conversational Pulse MAF-Primary Regression

Status: done
Epic: 10 - MAF-First Feature Regression Framework
Story ID: 10.3

## Story

As a product engineering owner,
I want Conversational Pulse to have explicit MAF-primary regression coverage,
so that engagement evidence remains tied to the primary runtime path before new pulse features are added.

## Acceptance Criteria

1. Given an inbound product-level conversation runs through MAF primary, then the runtime candidate receives the existing `runtimeContext` reply-planning context before TypeScript persists side effects.
2. Given the MAF reply marks a survey probe in reply metadata, then the persisted outbound metadata records `containsSurveyProbe` and `surveyProbeQuestionId`.
3. Given Conversational Pulse is enabled, then TypeScript-owned survey evidence extraction is queued after the MAF primary reply.
4. Given Conversational Pulse is disabled, then survey evidence extraction is not queued.
5. Given this story adds product-level confidence, then it reuses existing Vitest coverage and does not expand legacy `ConversationOrchestrator` tests.
6. Given simulation or judged checks are added later, then they remain additive after deterministic MAF-primary proof exists.

## Tasks / Subtasks

- [x] Identify the smallest existing test home for Conversational Pulse MAF-primary coverage. (AC: 1-6)
  - [x] Use `packages/application/src/use-cases/maf-primary-agent-runtime.test.ts`.
  - [x] Reuse existing MAF primary runtime and outbox fakes.
  - [x] Do not create a new runner, framework, fixture package, sim, or eval.
- [x] Prove inbound MAF-primary pulse metadata behavior. (AC: 1, 2)
  - [x] Call `MafPrimaryAgentRuntime.processMessage` with an inbound MAF request.
  - [x] Assert the Python/MAF candidate receives the original request.
  - [x] Assert outbound metadata persists `runtimeMode='maf_primary'` and survey probe metadata.
- [x] Prove TypeScript-owned survey evidence side effect. (AC: 3, 4)
  - [x] Assert `enqueueSurveyEvidence` receives tenant, user, conversation, inbound message, and trace IDs.
  - [x] Keep existing disabled-flag regression as the negative proof.
- [x] Run the smallest matching verification gate. (AC: 1-6)
  - [x] Run targeted application test.
  - [x] Run `pnpm typecheck`.

## Dev Notes

- This story implements the third row of the MAF-first feature regression matrix: Conversational Pulse. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/feature-regression-matrix.md#Feature-Regression-Matrix]
- Product-level regressions must use MAF primary; legacy `ConversationOrchestrator` coverage is fallback or rollback only. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md#Constraints]
- Do not create a new test framework while Vitest, pytest, `conversation-sim`, live smoke scripts, and evals are sufficient. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md#Constraints]
- `MafPrimaryAgentRuntime.processMessage` calls the MAF candidate runtime first, persists the outbound reply through TypeScript-owned ports, and then enqueues survey evidence for inbound messages when `FEATURE_FLAGS.CONVERSATIONAL_SURVEY` is enabled. [Source: packages/application/src/use-cases/maf-primary-agent-runtime.ts]
- Existing worker tests already cover proactive pulse probe context through MAF primary; this story adds the missing inbound evidence regression without duplicating proactive coverage. [Source: apps/worker/src/conversation/conversation.processor.test.ts]
- Story 10.2 established that the next feature rows should prefer focused existing tests over shared setup until repetition proves a helper is needed. [Source: _bmad-output/implementation-artifacts/10-2-add-long-term-memory-maf-primary-regression.md]

## Out Of Scope

- New test framework, dependency, regression runner, sim, or eval.
- Full survey extraction redesign.
- New probe-selection logic for inbound messages.
- Dashboard pulse UI or manager analytics.
- Legacy `ConversationOrchestrator` feature expansion.

## References

- [SPEC: MAF-First Feature Regression Framework](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md)
- [Feature Regression Matrix](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/feature-regression-matrix.md)
- [Regression Gates](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/regression-gates.md)
- [Story 10.2: Add Long-Term Memory MAF-Primary Regression](/Users/serzh/Documents/enTalentNew/_bmad-output/implementation-artifacts/10-2-add-long-term-memory-maf-primary-regression.md)

## Dev Agent Record

### Agent Model Used

Codex GPT-5

### Debug Log References

- 2026-08-15: `pnpm --filter @entalent/application test -- maf-primary-agent-runtime.test.ts` passed.
- 2026-08-15: `pnpm typecheck` passed.

### Completion Notes List

- Added a searchable `Conversational Pulse maf_primary` application regression around `MafPrimaryAgentRuntime`.
- Reused existing Vitest runtime fakes and existing disabled-flag test for negative survey evidence proof.
- Kept survey evidence extraction TypeScript-owned after the MAF primary reply.
- Product code was already correct for this row; only regression coverage was added.

### File List

- `packages/application/src/use-cases/maf-primary-agent-runtime.test.ts`
- `_bmad-output/implementation-artifacts/10-3-add-conversational-pulse-maf-primary-regression.md`

## Change Log

- 2026-08-15: Created, implemented, verified, and marked Conversational Pulse MAF-primary regression story done.

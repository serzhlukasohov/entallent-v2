---
baseline_commit: b5eed099a56c92643d77d20d31937a5aa5eaf910
---

# Story 10.5: Add Safety / Risk MAF-Primary Regression

Status: done
Epic: 10 - MAF-First Feature Regression Framework
Story ID: 10.5

## Story

As a product engineering owner,
I want safety and risk handling to have explicit MAF-primary regression coverage,
so that risky situations are classified by MAF while TypeScript persists and enforces the durable side effects.

## Acceptance Criteria

1. Given MAF primary returns a risk assessment for an inbound message, then the application result exposes the MAF risk fields.
2. Given the risk is critical or immediate, then TypeScript raises escalation through the existing escalation port.
3. Given the risk is non-none, then TypeScript persists a risk signal with tenant, user, message, severity, confidence, policy version, and expiry.
4. Given MAF marks surveys as blocked, then TypeScript does not enqueue survey evidence extraction for that risky turn.
5. Given MAF marks proactive messages as paused, then that flag is preserved in the application risk result for downstream enforcement.
6. Given this story adds product-level confidence, then it reuses existing Vitest coverage and does not create a new regression framework.

## Tasks / Subtasks

- [x] Identify the smallest existing test home for safety/risk MAF-primary coverage. (AC: 1-6)
  - [x] Use `packages/application/src/use-cases/maf-primary-agent-runtime.test.ts`.
  - [x] Reuse existing MAF primary runtime, risk repository, escalation, feature flag, and outbox fakes.
  - [x] Do not create a new runner, framework, fixture package, sim, or eval.
- [x] Prove MAF-primary risk persistence and escalation. (AC: 1-3)
  - [x] Make the regression searchable with `Safety / risk` and `maf_primary`.
  - [x] Assert risk signal persistence through TypeScript-owned ports.
  - [x] Assert critical/immediate escalation is raised.
- [x] Prove survey/proactive suppression evidence. (AC: 4, 5)
  - [x] Preserve `surveyMustBeBlocked` and `proactiveMessagesMustBePaused` in the returned risk object.
  - [x] Skip survey evidence extraction when MAF risk blocks surveys.
- [x] Run the smallest matching verification gate. (AC: 1-6)
  - [x] Run targeted application test.
  - [x] Run `pnpm typecheck`.

## Dev Notes

- This story implements the fifth row of the MAF-first feature regression matrix: Safety / risk. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/feature-regression-matrix.md#Feature-Regression-Matrix]
- Product-level regressions must use MAF primary; legacy `ConversationOrchestrator` coverage is fallback or rollback only. [Source: _bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md#Constraints]
- `MafPrimaryAgentRuntime.processMessage` calls the MAF candidate runtime first, then TypeScript persists outbound messages, risk signals, escalation, and extraction jobs. [Source: packages/application/src/use-cases/maf-primary-agent-runtime.ts]
- Existing conversation simulations cover crisis/harassment/privacy risk flags; this story adds deterministic MAF-primary side-effect proof before judged/live safety evals. [Source: packages/conversation-sim/src/scenarios/crisis-self-harm.sim.test.ts; packages/conversation-sim/src/scenarios/harassment.sim.test.ts; packages/conversation-sim/src/scenarios/privacy-manager-request.sim.test.ts]
- No new safety framework is needed for this story; Vitest coverage is sufficient for the deterministic gate.

## Out Of Scope

- New safety judge or live eval.
- New risk taxonomy.
- Proactive scheduler redesign.
- Dashboard/admin risk UI.
- Legacy `ConversationOrchestrator` expansion.

## References

- [SPEC: MAF-First Feature Regression Framework](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/SPEC.md)
- [Feature Regression Matrix](/Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-maf-first-feature-regression-framework/feature-regression-matrix.md)
- [Story 10.4: Add Proactive Check-Ins MAF-Primary Regression](/Users/serzh/Documents/enTalentNew/_bmad-output/implementation-artifacts/10-4-add-proactive-check-ins-maf-primary-regression.md)

## Dev Agent Record

### Agent Model Used

Codex GPT-5

### Debug Log References

- 2026-08-15: `pnpm --filter @entalent/application test -- maf-primary-agent-runtime.test.ts` passed.
- 2026-08-15: `pnpm typecheck` passed.

### Completion Notes List

- Added a searchable `Safety / risk maf_primary` regression around `MafPrimaryAgentRuntime`.
- Preserved MAF risk suppression flags in assertions.
- Changed MAF-primary extraction scheduling so survey evidence is not queued when MAF marks surveys blocked.

### File List

- `packages/application/src/use-cases/maf-primary-agent-runtime.ts`
- `packages/application/src/use-cases/maf-primary-agent-runtime.test.ts`
- `_bmad-output/implementation-artifacts/10-5-add-safety-risk-maf-primary-regression.md`

## Change Log

- 2026-08-15: Created, implemented, verified, and marked Safety / risk MAF-primary regression story done.

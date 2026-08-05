---
baseline_commit: 818491cc17a42ae0338733f432e8e2ba3c79ce4e
---

# Story 2.3: Define Canonical Action Envelope

Status: review
Epic: 2 - Contract, Ledger, And Side-Effect Safety
Story ID: 2.3

## Story

As an engineer,
I want proposed actions to use a canonical envelope,
so TypeScript can validate and execute MAF proposals without ambiguous side effects.

## Acceptance Criteria

1. Given MAF proposes a memory, follow-up, or goal action, when the runtime result is validated through the canonical OpenAPI artifact, then every proposed action uses an envelope containing `actionId`, aggregate type, action type, proposed payload, validation result, execution status, commit marker, and idempotency key.
2. Given TypeScript consumes runtime DTO exports, when action proposal types are inspected, then they expose a framework-neutral canonical action envelope and action-specific payload types aligned with `packages/contracts/runtime/openapi.json`.
3. Given TypeScript and Python run the shared fixture manifest, when valid and invalid action envelope fixtures are evaluated, then both validators accept valid envelopes and reject malformed envelopes with stable `ACTION_PROPOSAL_INVALID` categories.
4. Given an action proposal is represented as validation-failed, when the runtime result is inspected, then the contract can express that no domain write or queued side effect has been committed.
5. Given this story is complete, when the diff is inspected, then no runtime attempt ledger, action ledger persistence, action executor, domain write path, queued side effect, `MafAgentRuntimeClient`, `agent-service`, FastAPI route, MAF workflow, or production routing behavior has been added.

## Tasks / Subtasks

- [x] Define the canonical action envelope in the OpenAPI contract. (AC: 1, 3, 4)
  - [x] Update `packages/contracts/runtime/openapi.json` so `RuntimeResult.proposedActions[]` validates canonical envelope objects instead of the current bare action subtype objects.
  - [x] Include required envelope fields: `actionId`, aggregate type, action type, `idempotencyKey`, action-specific payload, validation result, execution status, and nullable or explicit commit marker.
  - [x] Represent action-specific payloads for memory, follow-up, and goal updates without introducing generic unvalidated action blobs.
  - [x] Keep stable `ACTION_PROPOSAL_INVALID` categories on envelope, discriminator, payload, validation result, execution status, and commit marker shape failures.
- [x] Keep runtime contract documentation in lockstep. (AC: 1, 4)
  - [x] Update `_bmad-output/specs/spec-maf-runtime-migration/runtime-contract.md` so the documented `proposedActions` shape matches `openapi.json`.
  - [x] Preserve the side-effect rule: Python proposes; TypeScript validates and writes.
  - [x] Clarify that validation-failed and not-committed states are representational in this story; actual ledger persistence and action execution are later stories.
- [x] Update framework-neutral TypeScript DTO exports. (AC: 2)
  - [x] Update `packages/contracts/src/runtime-contract.ts` with canonical envelope types and action-specific payload types.
  - [x] Keep DTOs JSON-compatible and free of MAF, FastAPI, OpenAI, LangChain, NestJS, and application-layer imports.
  - [x] Preserve existing request/result/error DTO exports unless a name must change to stay aligned with OpenAPI.
- [x] Expand shared runtime fixtures for action envelopes. (AC: 3, 4)
  - [x] Update `packages/contracts/runtime/fixtures/valid/runtime-result.json` so it includes valid enveloped memory, follow-up, and goal actions.
  - [x] Add at least one valid fixture that expresses a schema-valid but validation-failed action with no committed side effect.
  - [x] Add invalid fixtures for missing envelope idempotency key, invalid aggregate/action type, missing payload, malformed action-specific payload, malformed validation result, malformed execution status, and invalid commit marker shape.
  - [x] Keep all fixture data synthetic; do not use real Slack IDs, user text, workspace IDs, tenant IDs, or production event IDs.
  - [x] Update `packages/contracts/runtime/fixtures/manifest.json` so TypeScript and Python consume the same cases.
- [x] Update validators and tests only as needed for the envelope shape. (AC: 3)
  - [x] Prefer OpenAPI shapes already supported by both validators: object, array, string, number, integer, boolean, enum, `oneOf`, `$ref`, `additionalProperties: false`, UUID, date-time, min/max, and required fields.
  - [x] Do not use unsupported schema features such as `allOf`, discriminator objects, `const`, `if/then/else`, or `anyOf` unless both `runtime-contract-validation.ts` and `validate_fixtures.py` are extended with shared fixtures proving parity.
  - [x] Preserve named helpers `validateRuntimeProcessMessageRequest`, `validateRuntimeResult`, and `validateRuntimeErrorResponse`.
  - [x] Add TypeScript test coverage that proves DTO export usability for the new envelope types.
- [x] Run and record verification. (AC: 1-5)
  - [x] Run `pnpm --filter @entalent/contracts test:runtime-contract`.
  - [x] Run `pnpm --filter @entalent/contracts test:runtime-contract:python`.
  - [x] Run `pnpm --filter @entalent/contracts typecheck`.
  - [x] Run `pnpm --filter @entalent/contracts test`.
  - [x] Run `pnpm --filter @entalent/contracts lint`.
  - [x] Run `pnpm --filter @entalent/contracts build`.
  - [x] Run `pnpm test`.
  - [x] Run `git diff --check`.

## Dev Notes

### Current Contract State

- Canonical schema source is `packages/contracts/runtime/openapi.json`, OpenAPI 3.1.
- Story 2.2 added `packages/contracts/src/runtime-contract.ts` and named OpenAPI-backed validators.
- `RuntimeResult.proposedActions[]` currently validates one of three bare action subtype objects: `SaveMemoryActionProposal`, `ScheduleFollowUpActionProposal`, or `UpdateGoalActionProposal`.
- The current bare action shape includes `actionId`, `type`, `idempotencyKey`, and action-specific fields. Story 2.3 should evolve this into an envelope while keeping action-specific payload validation explicit.
- The shared fixture manifest is `packages/contracts/runtime/fixtures/manifest.json`; both TypeScript and Python validators consume it.
- `@entalent/contracts` standard `test` runs Vitest plus Python fixture validation, so `pnpm test` covers cross-language contract parity.

### Required Envelope Semantics

- The envelope must make side-effect state explicit before ledgers exist:
  - validation result: at minimum distinguish pending/not-yet-validated, valid, and invalid;
  - execution status: at minimum distinguish not-started or blocked from committed and failed;
  - commit marker: must be present as a field and able to represent no commit.
- A validation-failed action should be representable as schema-valid data, with no committed side effect. Do not model this by accepting malformed payloads as valid runtime results.
- Malformed envelope or malformed action-specific payload shapes must still fail schema validation with `ACTION_PROPOSAL_INVALID`.
- Idempotency key stays on each proposed action envelope; persisted idempotency ledgers are Story 2.4.

### Architecture Constraints

- AD-2 and AD-10: TypeScript remains first-slice policy and side-effect owner; Python returns proposals only.
- AD-3: MAF framework types must stay inside future `agent-service`; shared contracts stay JSON-compatible and framework-neutral.
- AD-5 and AD-15: proposed actions need idempotency keys and canonical side-effect state before user-facing MAF execution; persisted ledgers are later stories.
- AD-14: OpenAPI remains the single schema source; TypeScript and Python validators must prove parity through shared fixtures.
- AD-17 and Story 2.6 own retry-budget behavior; do not add retry behavior here.
- AD-18 will later store shadow diagnostics; this story should only make action validation/execution state available in the runtime result contract.

### Previous Story Intelligence

- Story 2.1 review established that `openapi.json` and `runtime-contract.md` must move in lockstep.
- Story 2.2 review found TS/Python date-time parity drift; avoid language-native parser shortcuts that accept different values across validators.
- Story 2.2 expanded valid action subtype coverage for memory, follow-up, and goal actions; keep all three branches covered after envelope migration.
- Current validators intentionally implement a small OpenAPI/JSON Schema subset. Prefer schemas that fit the existing subset or extend both validators in the same change.
- Do not touch unrelated untracked files such as `PRODUCT_AND_FUNCTIONAL_REQUIREMENTS.md` or files under `docs/superpowers/plans/`.

### File Structure Guidance

- Expected update files:
  - `packages/contracts/runtime/openapi.json`
  - `packages/contracts/runtime/fixtures/manifest.json`
  - `packages/contracts/runtime/fixtures/**`
  - `packages/contracts/src/runtime-contract.ts`
  - `packages/contracts/src/runtime-contract.test.ts`
  - `_bmad-output/specs/spec-maf-runtime-migration/runtime-contract.md`
  - `_bmad-output/implementation-artifacts/2-3-define-canonical-action-envelope.md`
- Possible update files only if schema support requires it:
  - `packages/contracts/src/runtime-contract-validation.ts`
  - `packages/contracts/runtime/validate_fixtures.py`
- Out-of-scope paths for this story:
  - `agent-service/`
  - `apps/worker/**`
  - `packages/application/**`
  - database migrations or ledger repositories

### Testing Requirements

- Start with contract verification before full repo verification to isolate schema failures quickly.
- TypeScript fixture tests must assert valid acceptance and invalid stable error categories from the manifest.
- Python fixture validation must consume the same OpenAPI artifact and manifest as TypeScript.
- Full `pnpm test` is required before moving to review.

### Out Of Scope

- No `agent-service/`.
- No FastAPI route.
- No MAF workflow.
- No `MafAgentRuntimeClient`.
- No runtime attempt ledger or action ledger persistence.
- No action executor or domain write path.
- No queued side effects.
- No fallback barrier behavior changes.
- No production runtime routing changes.
- No ownership transfer of memory, goals, risk, follow-ups, surveys, Slack messages, or persistence to Python.

## References

- `_bmad-output/planning-artifacts/epics.md` - Epic 2 and Story 2.3 requirements.
- `_bmad-output/specs/spec-maf-runtime-migration/SPEC.md` - CAP-2 constraints and side-effect ownership rules.
- `_bmad-output/specs/spec-maf-runtime-migration/runtime-contract.md` - runtime request/result/error companion contract.
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md` - AD-2, AD-5, AD-10, AD-14, AD-15, AD-17, and AD-18.
- `_bmad-output/implementation-artifacts/2-1-choose-canonical-runtime-schema-source.md` - canonical OpenAPI source and validator parity learnings.
- `_bmad-output/implementation-artifacts/2-2-define-runtime-request-and-result-contract.md` - current DTO, fixture, validator, and review-fix context.
- `packages/contracts/runtime/openapi.json` - canonical runtime HTTP schema source.
- `packages/contracts/src/runtime-contract.ts` - framework-neutral TypeScript runtime DTO exports.
- `packages/contracts/src/runtime-contract-validation.ts` - dependency-free TypeScript OpenAPI subset validator.
- `packages/contracts/runtime/validate_fixtures.py` - dependency-free Python OpenAPI subset validator.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- RED: `pnpm --filter @entalent/contracts test:runtime-contract` failed after envelope fixtures were added while OpenAPI still expected bare action proposal objects.
- RED: `pnpm --filter @entalent/contracts test:runtime-contract:python` failed for the same envelope/OpenAPI mismatch.
- GREEN: `pnpm --filter @entalent/contracts test:runtime-contract` passed with 23 runtime contract tests after updating OpenAPI and DTOs.
- GREEN: `pnpm --filter @entalent/contracts test:runtime-contract:python` passed against the same fixture manifest.
- Verification: `pnpm --filter @entalent/contracts typecheck` passed.
- Verification: `pnpm --filter @entalent/contracts test` passed with 49 TypeScript tests plus Python fixture validation.
- Verification: `pnpm --filter @entalent/contracts lint` passed.
- Verification: `pnpm --filter @entalent/contracts build` passed.
- Full regression: `pnpm test` passed with 15 successful turbo tasks.
- Verification: `git diff --check` passed.

### Completion Notes List

- Converted runtime `proposedActions[]` from bare subtype objects to canonical action envelopes with aggregate type, action type, idempotency key, payload, validation result, execution status, and commit marker.
- Added explicit action-specific payload schemas and TypeScript DTO types for memory, follow-up, and goal proposals.
- Added shared valid and invalid fixtures covering valid envelopes, validation-failed/no-commit representation, missing envelope fields, invalid aggregate/action state, malformed payloads, malformed validation/execution state, and invalid commit marker shape.
- Kept `runtime-contract.md` aligned with `openapi.json` and preserved the side-effect ownership boundary.
- No validators needed expansion; the envelope uses the existing shared OpenAPI subset.
- No `agent-service`, `MafAgentRuntimeClient`, ledgers, action executors, domain writes, queued side effects, or runtime routing behavior were added.

### File List

- `_bmad-output/implementation-artifacts/2-3-define-canonical-action-envelope.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/specs/spec-maf-runtime-migration/runtime-contract.md`
- `packages/contracts/runtime/fixtures/invalid/invalid-action-commit-marker-shape.json`
- `packages/contracts/runtime/fixtures/invalid/invalid-action-envelope-aggregate-type.json`
- `packages/contracts/runtime/fixtures/invalid/malformed-action-envelope-payload.json`
- `packages/contracts/runtime/fixtures/invalid/malformed-action-execution-status.json`
- `packages/contracts/runtime/fixtures/invalid/malformed-action-validation-result.json`
- `packages/contracts/runtime/fixtures/invalid/missing-action-envelope-idempotency-key.json`
- `packages/contracts/runtime/fixtures/invalid/missing-action-envelope-payload.json`
- `packages/contracts/runtime/fixtures/manifest.json`
- `packages/contracts/runtime/fixtures/valid/runtime-result-validation-failed-action.json`
- `packages/contracts/runtime/fixtures/valid/runtime-result.json`
- `packages/contracts/runtime/openapi.json`
- `packages/contracts/src/runtime-contract.test.ts`
- `packages/contracts/src/runtime-contract.ts`

### Change Log

- 2026-08-05: Created Story 2.3 developer context from Epic 2, runtime contract, architecture spine, and Story 2.2 review learnings.
- 2026-08-05: Implemented canonical action envelope contract, shared fixtures, DTO updates, and verification for Story 2.3.

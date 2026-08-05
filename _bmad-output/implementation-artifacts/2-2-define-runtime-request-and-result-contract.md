---
baseline_commit: 47a8314f4ede97d75a4fa31a20a3a95f3516e297
---

# Story 2.2: Define Runtime Request And Result Contract

Status: done
Epic: 2 - Contract, Ledger, And Side-Effect Safety
Story ID: 2.2

## Story

As an engineer,
I want a validated `ProcessMessageRequest` and `ProcessMessageResult` contract,
so `MafAgentRuntimeClient` and `agent-service` can integrate safely later.

## Acceptance Criteria

1. Given the target runtime contract is consumed by TypeScript, when contract exports are inspected, then they expose framework-neutral request, result, and runtime error DTO types aligned with `packages/contracts/runtime/openapi.json`.
2. Given the target runtime contract is consumed by TypeScript validation code, when runtime request/result/error payloads are validated, then named validation helpers validate `RuntimeProcessMessageRequest`, `RuntimeResult`, and `RuntimeErrorResponse` through the canonical OpenAPI artifact.
3. Given the target runtime contract is consumed by Python validation code, when the shared runtime fixture manifest is run, then Python validates the same request, result, and error fixtures with the same stable error categories as TypeScript.
4. Given runtime contract documentation is reviewed, when field names and required fields are compared, then `_bmad-output/specs/spec-maf-runtime-migration/runtime-contract.md`, `ARCHITECTURE-SPINE.md`, and `packages/contracts/runtime/openapi.json` do not contradict each other.
5. Given this story is complete, when the diff is inspected, then no `agent-service`, FastAPI route, MAF workflow, `MafAgentRuntimeClient`, runtime attempt ledger, action ledger, or production runtime routing behavior has been added.

## Tasks / Subtasks

- [x] Add framework-neutral TypeScript DTO exports. (AC: 1)
  - [x] Add `packages/contracts/src/runtime-contract.ts` or an equivalent local module for runtime HTTP DTO types.
  - [x] Include `RuntimeProcessMessageRequest`, `RuntimeResult`, and `RuntimeErrorResponse`.
  - [x] Keep the types JSON-compatible and free of MAF, FastAPI, OpenAI, LangChain, NestJS, and application-layer imports.
  - [x] Export the DTOs from `packages/contracts/src/index.ts` without removing existing exports.
- [x] Add named TypeScript validation helpers. (AC: 2)
  - [x] Keep `packages/contracts/runtime/openapi.json` as the canonical source of truth.
  - [x] Add named wrappers such as `validateRuntimeProcessMessageRequest`, `validateRuntimeResult`, and `validateRuntimeErrorResponse` that call the existing OpenAPI-backed validator by schema name.
  - [x] Preserve the generic `validateRuntimeContract` API for fixture harnesses and future schema checks.
  - [x] Do not replace the canonical OpenAPI artifact with Zod as the source of truth.
- [x] Expand shared contract fixtures. (AC: 2, 3)
  - [x] Add at least one valid runtime error response fixture.
  - [x] Add invalid fixtures that prove required request fields, result diagnostics, risk assessment bounds, action-specific required fields, runtime error taxonomy, and RFC3339 `date-time` validation.
  - [x] Keep all fixture data synthetic; do not use real Slack IDs, user text, workspace IDs, tenant IDs, or production event IDs.
  - [x] Update `packages/contracts/runtime/fixtures/manifest.json` so TypeScript and Python consume the same cases.
- [x] Keep the OpenAPI/documentation contract coherent. (AC: 4)
  - [x] Verify request fields include request ID, event ID, trace ID, idempotency key, runtime attempt, tenant, user, scoped conversation/session identity, message, and context.
  - [x] Verify result fields include reply, optional risk assessment, memory candidates, proposed actions, diagnostics trace ID, runtime version, model-call count, tool-call count, and latency.
  - [x] Verify runtime error response categories match the architecture convention: `unavailable`, `validation_error`, `timeout`, `duplicate_request`, `dependency_failed`, and `unsafe_partial_result`, with `retryable` and `fallbackAllowed` booleans.
  - [x] If any field name changes, update both `runtime-contract.md` and `openapi.json` in the same change.
- [x] Update verification and story status notes. (AC: 1-5)
  - [x] Run `pnpm --filter @entalent/contracts test:runtime-contract`.
  - [x] Run `pnpm --filter @entalent/contracts test:runtime-contract:python`.
  - [x] Run `pnpm --filter @entalent/contracts typecheck`.
  - [x] Run `pnpm --filter @entalent/contracts test`.
  - [x] Run `pnpm --filter @entalent/contracts lint`.
  - [x] Run `pnpm --filter @entalent/contracts build`.
  - [x] Run `pnpm test`.
  - [x] Run `git diff --check`.

### Review Findings

- [x] [Review][Patch] Strict TypeScript `date-time` validation accepted impossible calendar dates [packages/contracts/src/runtime-contract-validation.ts:415]
- [x] [Review][Patch] Shared action subtype fixtures did not cover valid `schedule_follow_up`/`update_goal` branches or malformed `update_goal` required fields [packages/contracts/runtime/fixtures/manifest.json:37]

## Dev Notes

### Current Contract Source

- Canonical schema source is `packages/contracts/runtime/openapi.json`, OpenAPI 3.1.
- Story 2.1 added a generic TypeScript validator in `packages/contracts/src/runtime-contract-validation.ts` and a dependency-free Python harness in `packages/contracts/runtime/validate_fixtures.py`.
- The shared fixture manifest is `packages/contracts/runtime/fixtures/manifest.json`.
- `packages/contracts/package.json` now runs Python fixture validation through the standard `test` script, so `pnpm test` covers TypeScript and Python contract parity.
- OpenAPI 3.1 is intentionally retained. The official OAS 3.1 spec states OAS data types are based on JSON Schema Draft 2020-12 and recommends `openapi.json` or `openapi.yaml` as root document names. Use that as the compatibility assumption for this story.

### Previous Story Intelligence

- BMAD review for Story 2.1 found that `openapi.json` must not drift from `runtime-contract.md`; treat those two files as a lockstep pair.
- Do not introduce generic action payload validation in this story. If a proposed action shape is represented, it must be specific enough for the contract validator to reject malformed shape fixtures.
- Keep strict RFC3339 `date-time` validation in both TypeScript and Python validators. Date-only strings such as `2026-08-05` must remain invalid.
- Preserve stable error categories from fixture expectations: `IDEMPOTENCY_KEY_INVALID`, `SESSION_IDENTITY_INVALID`, `ACTION_PROPOSAL_INVALID`, `RUNTIME_ERROR_CATEGORY_INVALID`, and `CONTRACT_SCHEMA_INVALID`.
- Story 2.1 deliberately did not create `agent-service`, `MafAgentRuntimeClient`, ledgers, or runtime behavior changes. Keep that boundary.

### Architecture Constraints

- AD-1: the runtime boundary remains `AgentRuntimePort`; this story must not change worker routing.
- AD-2 and AD-10: TypeScript remains first-slice policy and side-effect owner.
- AD-3: MAF framework types must stay inside future `agent-service`; shared contracts stay JSON-compatible and framework-neutral.
- AD-4: the first transport is JSON HTTP.
- AD-5 and AD-15: requests and proposed actions need idempotency keys before MAF is user-facing, but the persisted ledgers are later stories.
- AD-8: session identity must include workspace, user, external conversation, and thread-or-DM scope.
- AD-14: OpenAPI remains the single schema source; TypeScript and Python validators consume it.
- AD-17: runtime attempt number must remain part of the request/result flow, but retry budget behavior is Story 2.6.

### File Structure Guidance

- Expected update files:
  - `packages/contracts/runtime/openapi.json`
  - `packages/contracts/runtime/fixtures/manifest.json`
  - `packages/contracts/runtime/fixtures/**`
  - `packages/contracts/runtime/validate_fixtures.py`
  - `packages/contracts/src/runtime-contract-validation.ts`
  - `packages/contracts/src/runtime-contract.test.ts`
  - `packages/contracts/src/index.ts`
  - `_bmad-output/specs/spec-maf-runtime-migration/runtime-contract.md`
  - `_bmad-output/implementation-artifacts/2-2-define-runtime-request-and-result-contract.md`
- Expected new file:
  - `packages/contracts/src/runtime-contract.ts` if DTO types are not placed in an existing runtime contract module.
- Do not touch unrelated untracked files such as `PRODUCT_AND_FUNCTIONAL_REQUIREMENTS.md` or files under `docs/superpowers/plans/` unless explicitly requested.

### Testing Requirements

- TypeScript fixture tests must assert both valid acceptance and invalid stable error categories from the manifest.
- Python fixture validation must consume the same OpenAPI artifact and manifest as TypeScript.
- Add tests for named validation helpers, not only the generic validator.
- Run contract verification before broader package/repo verification to isolate schema failures quickly.
- Full `pnpm test` is required because `@entalent/contracts#test` is now the CI path that proves Python fixture parity.

### Out Of Scope

- No `agent-service/`.
- No FastAPI route.
- No MAF workflow.
- No `MafAgentRuntimeClient`.
- No runtime attempt ledger or action ledger implementation.
- No fallback barrier behavior changes.
- No production runtime routing changes.
- No ownership transfer of memory, goals, risk, follow-ups, surveys, Slack messages, or persistence to Python.

## References

- `_bmad-output/planning-artifacts/epics.md` - Epic 2 and Story 2.2 requirements.
- `_bmad-output/specs/spec-maf-runtime-migration/SPEC.md` - CAP-2 success signal and migration constraints.
- `_bmad-output/specs/spec-maf-runtime-migration/runtime-contract.md` - companion runtime request/result/error DTO contract.
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md` - AD-1 through AD-19 and consistency conventions.
- `_bmad-output/implementation-artifacts/2-1-choose-canonical-runtime-schema-source.md` - previous story implementation and review learnings.
- `packages/contracts/runtime/openapi.json` - canonical runtime HTTP schema source.
- OpenAPI Specification v3.1.0 - official OAS/JSON Schema compatibility reference: https://spec.openapis.org/oas/v3.1.0.html

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- RED: `pnpm --filter @entalent/contracts typecheck` failed because runtime DTO types were not exported.
- GREEN: `pnpm --filter @entalent/contracts typecheck` passed after adding framework-neutral runtime DTO exports.
- GREEN: `pnpm --filter @entalent/contracts test:runtime-contract` passed with DTO export coverage.
- RED: `pnpm --filter @entalent/contracts typecheck` failed because named runtime validator helpers were not exported.
- GREEN: `pnpm --filter @entalent/contracts typecheck` passed after adding named OpenAPI-backed validator helpers.
- GREEN: `pnpm --filter @entalent/contracts test:runtime-contract` passed with named validator coverage.
- RED: `pnpm --filter @entalent/contracts test:runtime-contract` and `test:runtime-contract:python` failed after adding manifest entries for missing expanded fixtures.
- GREEN: `pnpm --filter @entalent/contracts test:runtime-contract` passed with 13 fixture/helper tests.
- GREEN: `pnpm --filter @entalent/contracts test:runtime-contract:python` passed against the same fixture manifest.
- Verification: OpenAPI required request/result fields and runtime error taxonomy were inspected against `runtime-contract.md` and `ARCHITECTURE-SPINE.md`.
- Verification: `pnpm --filter @entalent/contracts test:runtime-contract` passed with 13 runtime contract tests.
- Verification: `pnpm --filter @entalent/contracts test:runtime-contract:python` passed.
- Verification: `pnpm --filter @entalent/contracts typecheck` passed.
- Verification: `pnpm --filter @entalent/contracts test` passed with 39 TypeScript tests plus Python fixture validation.
- Verification: `pnpm --filter @entalent/contracts lint` passed.
- Verification: `pnpm --filter @entalent/contracts build` passed.
- Full regression: `pnpm test` passed with 15 successful turbo tasks.
- Verification: `git diff --check` passed.
- Review fix: `pnpm --filter @entalent/contracts test:runtime-contract` passed with 15 runtime contract tests after tightening date-time parity and action subtype fixtures.
- Review fix: `pnpm --filter @entalent/contracts test:runtime-contract:python` passed against the same fixture manifest after review fixes.
- Review verification: `pnpm --filter @entalent/contracts typecheck`, `pnpm --filter @entalent/contracts test`, `pnpm --filter @entalent/contracts lint`, `pnpm --filter @entalent/contracts build`, `pnpm test`, and `git diff --check` passed after review fixes.

### Completion Notes List

- Added framework-neutral TypeScript runtime DTO types for request, result, action proposals, diagnostics, and runtime error response.
- Added named TypeScript validator helpers for runtime request, result, and error response schemas while preserving the generic OpenAPI-backed validator.
- Expanded shared runtime fixtures with a valid error response and invalid cases for action-specific required fields, missing result diagnostics, risk confidence bounds, runtime error taxonomy, and RFC3339 date-time validation.
- Verified OpenAPI, runtime companion documentation, and architecture error taxonomy remain coherent without adding out-of-scope service/client scaffolding.
- Completed required verification and moved Story 2.2 to review.

### File List

- `packages/contracts/src/index.ts`
- `_bmad-output/implementation-artifacts/2-2-define-runtime-request-and-result-contract.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `packages/contracts/runtime/fixtures/invalid/invalid-risk-confidence.json`
- `packages/contracts/runtime/fixtures/invalid/invalid-schedule-follow-up-action-shape.json`
- `packages/contracts/runtime/fixtures/invalid/invalid-update-goal-action-shape.json`
- `packages/contracts/runtime/fixtures/invalid/impossible-message-created-at.json`
- `packages/contracts/runtime/fixtures/invalid/missing-result-diagnostics.json`
- `packages/contracts/runtime/fixtures/manifest.json`
- `packages/contracts/runtime/fixtures/valid/runtime-error-response.json`
- `packages/contracts/src/runtime-contract.ts`
- `packages/contracts/src/runtime-contract.test.ts`
- `packages/contracts/src/runtime-contract-validation.ts`

### Change Log

- 2026-08-05: Created Story 2.2 developer context from Epic 2, runtime contract, architecture spine, and Story 2.1 review learnings.
- 2026-08-05: Implemented runtime DTO exports, named validators, expanded fixtures, and verification for Story 2.2.
- 2026-08-05: Resolved BMAD review findings and marked Story 2.2 done.

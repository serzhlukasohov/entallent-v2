# Handoff: MAF Runtime Migration

Date: 2026-08-05
Project: enTalentNew
Branch: `codex/maf-runtime-spike`
Workspace: `/Users/serzh/Documents/enTalentNew`

## Start Here

Read these files first, in order:

1. `_bmad-output/implementation-artifacts/sprint-status.yaml`
2. `_bmad-output/implementation-artifacts/2-1-choose-canonical-runtime-schema-source.md`
3. `_bmad-output/specs/spec-maf-runtime-migration/runtime-contract.md`
4. `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md`
5. `packages/contracts/runtime/openapi.json`

## Current State

- Epic 1 is done.
- Epic 1 retrospective is done.
- Epic 2 is in progress.
- Story 2.1, `2-1-choose-canonical-runtime-schema-source`, is implemented and in `review`.
- The next normal BMAD step is code review for Story 2.1. After review findings are resolved, mark Story 2.1 `done`, then create Story 2.2.

## Key Commits

- `db9aad3` - Add MAF runtime Epic 1 retrospective
- `a2280dd` - Create MAF runtime schema source story
- `f11ce06` - Implement MAF runtime schema source contract

## Decisions Already Made

- Canonical runtime HTTP schema source is neutral OpenAPI 3.1.
- Canonical artifact lives at `packages/contracts/runtime/openapi.json`.
- TypeScript and Python validators consume the same OpenAPI artifact and the same fixture manifest.
- Zod and Pydantic are validator/model consumers, not the source of truth.
- No `agent-service`, FastAPI route, MAF workflow, `MafAgentRuntimeClient`, runtime ledger, or fallback behavior was introduced in Story 2.1.

## Story 2.1 Implementation Summary

Added:

- `packages/contracts/runtime/openapi.json`
- `packages/contracts/runtime/fixtures/manifest.json`
- valid fixtures:
  - `packages/contracts/runtime/fixtures/valid/process-message-request.json`
  - `packages/contracts/runtime/fixtures/valid/runtime-result.json`
- invalid fixtures:
  - `packages/contracts/runtime/fixtures/invalid/missing-idempotency-key.json`
  - `packages/contracts/runtime/fixtures/invalid/malformed-session-identity.json`
  - `packages/contracts/runtime/fixtures/invalid/invalid-action-proposal-shape.json`
  - `packages/contracts/runtime/fixtures/invalid/invalid-fallback-error-category.json`
- TypeScript validator:
  - `packages/contracts/src/runtime-contract-validation.ts`
  - `packages/contracts/src/runtime-contract.test.ts`
- Python validator:
  - `packages/contracts/runtime/validate_fixtures.py`

Updated:

- `packages/contracts/package.json`
- `packages/contracts/src/index.ts`
- `_bmad-output/specs/spec-maf-runtime-migration/runtime-contract.md`
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/2-1-choose-canonical-runtime-schema-source.md`

## Verified Commands

- `pnpm --filter @entalent/contracts test:runtime-contract`
- `pnpm --filter @entalent/contracts test:runtime-contract:python`
- `pnpm --filter @entalent/contracts typecheck`
- `pnpm --filter @entalent/contracts test`
- `pnpm --filter @entalent/contracts lint`
- `pnpm --filter @entalent/contracts build`
- `pnpm test`
- `git diff --check`

## Important Guardrails

- Do not touch unrelated untracked files unless the user explicitly asks.
- Existing unrelated untracked files include `PRODUCT_AND_FUNCTIONAL_REQUIREMENTS.md` and several files under `docs/superpowers/plans/`.
- Before making Railway deployment claims, read `docs/superpowers/railway-deploy.md`.
- Story 2.1 is in `review`, not `done`; run BMAD code review before moving forward.
- Keep `AgentRuntimePort` compatibility intact until a later story explicitly changes the runtime HTTP request/result boundary.
- Do not scaffold `agent-service` before the relevant Epic 4 stories.

## Recommended Next Step

Run BMAD code review for:

`_bmad-output/implementation-artifacts/2-1-choose-canonical-runtime-schema-source.md`

After review:

1. Resolve findings if any.
2. Mark Story 2.1 `done`.
3. Create Story 2.2, `define-runtime-request-and-result-contract`.

## Prompt For The Next Chat

```text
We are continuing the MAF runtime migration in /Users/serzh/Documents/enTalentNew on branch codex/maf-runtime-spike.

Start by reading:
- _bmad-output/implementation-artifacts/handoff-maf-runtime-2026-08-05.md
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/2-1-choose-canonical-runtime-schema-source.md
- _bmad-output/specs/spec-maf-runtime-migration/runtime-contract.md
- _bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md

Current state:
- Epic 1 is done and retro is complete.
- Epic 2 is in progress.
- Story 2.1 is implemented and in review.
- Latest implementation commit: f11ce06 Implement MAF runtime schema source contract.
- Canonical runtime schema source is packages/contracts/runtime/openapi.json, neutral OpenAPI 3.1.
- TS and Python validators both validate the same runtime fixtures.
- Do not scaffold agent-service or MafAgentRuntimeClient yet.
- Do not touch unrelated untracked files unless I ask.

Please run BMAD code review for Story 2.1. If there are findings, fix them and re-run verification. If review passes, mark Story 2.1 done and then recommend/create Story 2.2.
```

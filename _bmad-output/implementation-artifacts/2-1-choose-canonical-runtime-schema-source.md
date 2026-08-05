# Story 2.1: Choose Canonical Runtime Schema Source

Status: ready-for-dev
Epic: 2 - Contract, Ledgers, And Fallback Safety
Story ID: 2.1
Baseline commit: db9aad327a294324bc1081211d5a0d11ac97d41e

## Story

As an engineer,
I want one canonical schema source for the runtime HTTP contract,
so TypeScript and Python cannot drift.

## Acceptance Criteria

1. Given runtime HTTP boundary work is about to start, when the schema-source decision is recorded, then it names TypeScript Zod, Python Pydantic, or neutral OpenAPI as the canonical source and updates the architecture/spec companion if the decision resolves or changes AD-14 assumptions.
2. Given shared contract fixtures exist, when TypeScript and Python validators are run, then both accept valid fixtures and reject invalid fixtures with equivalent error categories.

## Tasks

- [ ] Record the canonical schema-source decision. (AC: 1)
  - [ ] Evaluate TypeScript Zod, Python Pydantic, and neutral OpenAPI against AD-14, AD-2, AD-3, AD-4, and the target runtime contract.
  - [ ] Use neutral OpenAPI 3.1 as the default decision unless implementation discovers a concrete blocker.
  - [ ] If a blocker is found, document the tradeoff and explicitly choose the next-best source instead of leaving the decision implicit.
  - [ ] Update `_bmad-output/specs/spec-maf-runtime-migration/runtime-contract.md` with the chosen schema-source rule and generation/validation responsibilities.
  - [ ] Add a short decision note under `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/` if AD-14 needs clarification beyond its current wording.
- [ ] Seed shared runtime contract artifacts. (AC: 2)
  - [ ] Add the canonical schema artifact under `packages/contracts/runtime/`.
  - [ ] Add shared valid and invalid runtime HTTP contract fixtures under `packages/contracts/runtime/fixtures/`.
  - [ ] Keep fixture data synthetic; do not use real Slack IDs, user content, workspace IDs, or production event IDs.
  - [ ] Cover at minimum: valid process-message request, valid runtime result, missing idempotency key, malformed session identity, invalid side-effect proposal shape, and invalid fallback/error category.
- [ ] Add TypeScript validation coverage. (AC: 2)
  - [ ] Validate fixtures from the canonical schema artifact without changing the existing `AgentRuntimePort` shim.
  - [ ] Assert accepted fixtures pass and rejected fixtures return stable error categories.
  - [ ] Keep existing package exports backward compatible.
- [ ] Add Python validation coverage. (AC: 2)
  - [ ] Add the smallest Python validator harness needed to prove parity against the same fixture files.
  - [ ] Do not scaffold `agent-service`, FastAPI routes, MAF workflows, or runtime execution in this story.
  - [ ] Assert accepted fixtures pass and rejected fixtures map to the same error categories as TypeScript.
- [ ] Update verification and status notes. (AC: 1, 2)
  - [ ] Document exact commands used for TypeScript and Python validation.
  - [ ] If a new dependency is required, justify why existing repo tooling cannot provide the validator safely.

## Dev Notes

### Recommended Direction

Choose neutral OpenAPI 3.1 as the canonical runtime schema source for Story 2.1 unless a concrete tooling blocker appears during implementation.

Rationale:

- AD-14 requires one schema source before `MafAgentRuntimeClient` or Python endpoint code exists.
- AD-2 keeps TypeScript as side-effect owner during migration, so making Python Pydantic canonical would give the future runtime service too much ownership too early.
- AD-3 keeps MAF-specific types inside `agent-service`, so TypeScript Zod should not become the long-term source of Python runtime shapes.
- AD-4 makes JSON-over-HTTP the first seam, which matches an OpenAPI-owned contract better than a language-owned model.
- OpenAPI 3.1 aligns with JSON Schema Draft 2020-12 and is a better neutral contract artifact for TypeScript and Python validators than either implementation language owning the truth.

### Source Facts

- `agent-service/` and a root Python project do not exist yet. Do not create the service in this story.
- `packages/contracts` currently exports TypeScript contracts from `src/index.ts` and depends directly on `zod`.
- The current runtime router uses the existing `AgentRuntimePort` shim in `packages/application/src/ports/agent-runtime.port.ts`; keep that compatibility layer intact.
- The target rich runtime HTTP contract is described in `_bmad-output/specs/spec-maf-runtime-migration/runtime-contract.md`, including `requestId`, `eventId`, `traceId`, `runtimeAttempt`, scoped session identity, runtime result, diagnostics, memory candidates, and proposed actions.
- Python may return proposed side effects only; TypeScript validates and writes durable side effects until an explicit ownership transfer story.

### Tooling Notes

- Zod can emit JSON Schema, but JSON Schema to Zod remains experimental in current Zod docs. Treat this as a reason not to make Zod the neutral contract source without a written exception.
- Pydantic can generate JSON Schema compatible with JSON Schema Draft 2020-12 and OpenAPI 3.1. Treat Pydantic as a strong Python validator/model consumer, not as the default canonical owner.
- Official OpenAPI currently publishes 3.2 and 3.1 variants. Prefer OpenAPI 3.1 for this story unless validation tooling in this repo proves 3.2 is equally supported by both TypeScript and Python.

### Lessons From Epic 1

- Story artifacts must exist before dev starts.
- Runtime logs and validation errors need stable reason codes and explicit payload allowlists.
- Verification that depends on `packages/contracts/dist` should be run sequentially when a package build cleans upstream `dist`.
- Add compatible APIs instead of changing existing runtime control surfaces in place.

## Out Of Scope

- No `MafAgentRuntimeClient`.
- No `agent-service` scaffold.
- No FastAPI endpoint.
- No MAF workflow code.
- No runtime attempt ledger or action ledger implementation.
- No fallback barrier behavior changes.
- No changes to production runtime routing behavior.

## Verification

- Run package-level TypeScript validation/test commands after adding the schema and fixtures.
- Run the Python fixture validation command added by this story.
- Run `git diff --check`.
- If both TypeScript and Python dependency installation is required, record the exact packages and lockfile impact in the Dev Agent Record.

## Dev Agent Record

### Files To Watch

- `_bmad-output/specs/spec-maf-runtime-migration/runtime-contract.md`
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md`
- `packages/contracts/package.json`
- `packages/contracts/src/index.ts`
- `packages/contracts/runtime/`

### Completion Notes

- Pending implementation.

### Debug Log

- Pending implementation.

---
title: 'Strict Runtime Boundary Request'
type: 'refactor'
created: '2026-08-12T00:00:00+02:00'
status: 'done'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** `ProcessMessageRequest` keeps `requestId`, `eventId`, and `runtimeAttempt` optional for compatibility with older TypeScript runtime callers, but MAF shadow/canary/primary execution requires those fields as canonical runtime boundary inputs.

**Approach:** Preserve the broad TypeScript runtime port shape, introduce a strict boundary request type for MAF candidate execution, and add narrow guards at the router/primary adapter boundary so canonical runtime calls cannot be made from incomplete requests.

## Boundaries & Constraints

**Always:** Keep TypeScript fallback compatibility for existing callers that still use `ProcessMessageRequest`. MAF candidate execution must require non-empty `requestId`, non-empty `eventId`, and positive integer `runtimeAttempt` at type level and runtime. Diagnostics must remain safe and content-free.

**Ask First:** Any change that makes the base `AgentRuntimePort.processMessage` require the strict request shape, changes database schema, or changes queue payload contracts.

**Never:** Do not fabricate missing `requestId` or `eventId` values inside the MAF client. Do not convert missing `runtimeAttempt` into a default attempt. Do not change dashboard UI behavior in this slice.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| MAF shadow with complete boundary fields | `maf_shadow` request has `requestId`, `eventId`, `runtimeAttempt`, canonical message/context fields | Router calls `processCandidate` and records a valid or invalid shadow candidate as before | Existing safe MAF diagnostics apply |
| MAF shadow with incomplete boundary fields and permissive provider | Provider reports no config diagnostic but request lacks a strict boundary field | Router records invalid shadow diagnostics and does not call `processCandidate` | Diagnostic is `maf_runtime_boundary_request_invalid` with safe `invalidFields` |
| MAF primary adapter with incomplete boundary fields | Primary runtime receives request lacking strict boundary fields | No candidate call is made | Throws `MafAgentRuntimeConfigurationError` with safe boundary diagnostic |
| TypeScript runtime path with old request shape | Request lacks strict MAF-only fields but routes to TypeScript runtime | TypeScript runtime still receives the request | No new error |

</frozen-after-approval>

## Code Map

- `packages/application/src/ports/agent-runtime.port.ts` -- owns the broad runtime port and the new strict MAF boundary request type.
- `packages/application/src/use-cases/maf-agent-runtime-client.ts` -- MAF candidate provider and canonical runtime request builder.
- `packages/application/src/use-cases/agent-runtime-router.ts` -- decides whether to call MAF shadow/canary/primary and records diagnostics.
- `packages/application/src/use-cases/maf-primary-agent-runtime.ts` -- primary adapter that persists side effects after a MAF candidate result.
- `packages/application/src/use-cases/agent-runtime-router.test.ts` -- router coverage for boundary guard behavior.
- `packages/application/src/use-cases/maf-agent-runtime-client.test.ts` -- client coverage for canonical request serialization and safe diagnostics.

## Tasks & Acceptance

**Execution:**
- [x] `packages/application/src/ports/agent-runtime.port.ts` -- add `RuntimeBoundaryProcessMessageRequest` and a reusable runtime guard -- keep `ProcessMessageRequest` compatibility intact.
- [x] `packages/application/src/use-cases/maf-agent-runtime-client.ts` -- make `MafAgentRuntimeCandidateProvider.processCandidate` require the strict request type and remove fallback fabrication from canonical request building.
- [x] `packages/application/src/use-cases/agent-runtime-router.ts` -- guard shadow candidate execution before calling a strict provider -- prevent permissive provider implementations from receiving incomplete boundary requests.
- [x] `packages/application/src/use-cases/maf-primary-agent-runtime.ts` -- guard primary candidate execution before side effects -- fail closed with the existing safe diagnostic shape.
- [x] Tests -- cover strict boundary guard behavior and verify TypeScript fallback compatibility remains.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- mark the deferred strict runtime boundary request item done once verified.

**Acceptance Criteria:**
- Given a TypeScript-mode request without strict MAF boundary fields, when the router processes it, then it delegates to TypeScript without a new error.
- Given a MAF shadow request missing a strict boundary field and a permissive MAF provider, when the router processes it, then it records invalid diagnostics and does not call the provider.
- Given a MAF primary adapter request missing a strict boundary field, when primary execution starts, then it throws a safe `maf_runtime_boundary_request_invalid` error before candidate execution.
- Given a complete MAF candidate request, when the client builds the canonical runtime request, then `requestId`, `eventId`, and `runtimeAttempt` come from the strict request without empty-string/default fallbacks.

## Spec Change Log

## Design Notes

This is intentionally not the final migration to make `AgentRuntimePort` strict. That would be a wider contract change across worker queues, tests, and TypeScript runtime compatibility. This slice tightens only the MAF execution boundary that already requires canonical IDs.

## Verification

**Commands:**
- `pnpm --filter @entalent/application test -- agent-runtime-router.test.ts maf-agent-runtime-client.test.ts` -- expected: relevant unit tests pass.
- `pnpm typecheck` -- expected: strict request type compiles across application and worker packages.
- `pnpm lint` -- expected: no lint regressions.
- `pnpm test` -- expected: full test suite passes.

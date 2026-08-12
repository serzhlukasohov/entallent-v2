---
title: 'MAF Primary Fail Closed'
type: 'refactor'
created: '2026-08-11T12:00:00+02:00'
status: 'done'
review_loop_iteration: 0
baseline_commit: '16baab85ec7dbaff3276573b430f364c64a8053e'
context:
  - '{project-root}/docs/superpowers/railway-deploy.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `maf_primary` still has automatic TypeScript fallback paths when MAF configuration/provider/runtime returns a safe diagnostic. That makes production evidence ambiguous: a tenant can be configured for primary but still receive a TS answer if MAF is unavailable.

**Approach:** Make `maf_primary` fail closed for all MAF unavailability/failure cases. Keep TypeScript as an explicit runtime mode and keep existing shadow/canary behavior unless tests expose an already-broken contract.

## Boundaries & Constraints

**Always:** `maf_primary` must never call `typeScriptRuntime.processMessage` or `executeFallback` after primary selection. Primary failures must still record the MAF diagnostic/failure evidence before throwing where that evidence recorder is available. Existing successful MAF primary path must remain unchanged. Existing `typescript`, `maf_shadow`, and local disabled/default behavior must remain available as explicit modes.

**Ask First:** Any change that removes TypeScript runtime entirely, deletes fallback barrier infrastructure, changes feature flag names/semantics, or changes DB schema/migrations.

**Never:** Do not silently downgrade `maf_primary` to `typescript`. Do not hide primary failures by returning synthetic user-facing replies. Do not broaden this into Railway, Slack configuration, dashboard UI, or unrelated runtime refactors.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| MAF primary success | decision mode `maf_primary`, configured `mafPrimaryRuntime`, runtime returns result | Return MAF result and record primary success commit | No TS call |
| Primary config diagnostic | decision mode `maf_primary`, configuration diagnostic exists | Throw a MAF primary unavailable/config error after diagnostic persistence | No TS call, no fallback executor call |
| Missing primary provider | decision mode `maf_primary`, no `mafPrimaryRuntime` | Record primary failure diagnostic and throw | No TS call, no fallback executor call |
| Safe MAF runtime diagnostic | decision mode `maf_primary`, `mafPrimaryRuntime.processMessage` throws safe diagnostic | Record primary failure diagnostic and throw | No TS call, no fallback executor call |
| Canary diagnostic | decision mode `maf_canary`, MAF unavailable | Preserve current canary behavior unless existing tests require adjustment | Existing fallback behavior allowed |

</frozen-after-approval>

## Code Map

- `packages/application/src/use-cases/agent-runtime-router.ts` -- runtime mode router; contains `processMafPrimary`, `executeTypeScriptFallback`, and primary diagnostic handling.
- `packages/application/src/use-cases/agent-runtime-router.test.ts` -- router unit tests; should prove `maf_primary` fail-closed and no TypeScript fallback calls.
- `apps/worker/src/conversation/runtime-fallback-barrier.service.ts` -- fallback barrier service used by the worker as fallback executor; should remain for non-primary explicit fallback paths.
- `packages/application/src/use-cases/runtime-fallback-barrier.ts` -- shared fallback barrier classifier; should remain unchanged.

## Tasks & Acceptance

**Execution:**
- [x] `packages/application/src/use-cases/agent-runtime-router.ts` -- change `processMafPrimary` so `maf_primary` throws after configuration/provider/runtime diagnostics instead of executing TypeScript fallback.
- [x] `packages/application/src/use-cases/agent-runtime-router.ts` -- update warning text/comments that currently say primary falls back to TypeScript so observability matches fail-closed behavior.
- [x] `packages/application/src/use-cases/agent-runtime-router.test.ts` -- add/adjust tests proving `maf_primary` configuration diagnostic, missing provider, and safe runtime diagnostic do not call TypeScript runtime or fallback executor.
- [x] `packages/application/src/use-cases/agent-runtime-router.test.ts` -- keep or add a test proving explicit `typescript` mode still calls TypeScript runtime.

**Acceptance Criteria:**
- Given `evaluateMode` returns `maf_primary` and MAF config is invalid, when processing a message, then the router throws and neither `typeScriptRuntime.processMessage` nor `executeFallback` is called.
- Given `evaluateMode` returns `maf_primary` and primary provider is missing, when processing a message, then the router records primary failure diagnostic and throws without TypeScript fallback.
- Given `evaluateMode` returns `maf_primary` and primary runtime throws a safe MAF diagnostic, when processing a message, then the router records primary failure diagnostic and throws without TypeScript fallback.
- Given `evaluateMode` returns `typescript`, when processing a message, then the TypeScript runtime still handles the request.

## Spec Change Log

## Design Notes

The runtime contract after this change is operator-controlled rollback, not code-controlled fallback:

```text
maf_primary -> MAF result or explicit failure
typescript   -> TypeScript result
maf_shadow   -> TypeScript result + shadow diagnostics
maf_canary   -> existing canary behavior unless separately changed
```

## Verification

**Commands:**
- `pnpm --filter @entalent/application test -- agent-runtime-router.test.ts` -- router behavior passes.
- `pnpm --filter @entalent/application build` -- application package builds.
- `pnpm run typecheck` -- monorepo typecheck passes.

## Suggested Review Order

**Primary Fail-Closed Routing**

- Entry point: primary diagnostics now throw instead of downgrading to TS.
  [`agent-runtime-router.ts:181`](../../packages/application/src/use-cases/agent-runtime-router.ts#L181)

- Safe runtime errors preserve the original error and stack.
  [`agent-runtime-router.ts:213`](../../packages/application/src/use-cases/agent-runtime-router.ts#L213)

- Generic failure recording cannot mask the real runtime error.
  [`agent-runtime-router.ts:228`](../../packages/application/src/use-cases/agent-runtime-router.ts#L228)

**Observability**

- Router diagnostics cannot be overwritten by stray diagnostic fields.
  [`agent-runtime-router.ts:280`](../../packages/application/src/use-cases/agent-runtime-router.ts#L280)

- Warning text distinguishes primary fail-closed from fallback modes.
  [`agent-runtime-router.ts:424`](../../packages/application/src/use-cases/agent-runtime-router.ts#L424)

**Tests**

- Safe primary failure proves no fallback executor or TS runtime call.
  [`agent-runtime-router.test.ts:279`](../../packages/application/src/use-cases/agent-runtime-router.test.ts#L279)

- Recorder failure test proves observability cannot mask primary errors.
  [`agent-runtime-router.test.ts:380`](../../packages/application/src/use-cases/agent-runtime-router.test.ts#L380)

- Adapter diagnostics matrix proves config/HTTP/validation failures fail closed.
  [`agent-runtime-router.test.ts:522`](../../packages/application/src/use-cases/agent-runtime-router.test.ts#L522)

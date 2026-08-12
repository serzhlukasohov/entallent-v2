---
title: 'Admin Manager Dashboard Read Model'
type: 'refactor'
created: '2026-08-12'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'f94c346'
context: []
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** Manager dashboard admin controllers still own both HTTP routing and read/query assembly. That keeps the dashboard summary shape harder to reason about and makes future dashboard surfaces more likely to duplicate query orchestration.

**Approach:** Introduce an injectable API read-model service for manager dashboard summaries. Keep controllers as thin HTTP adapters and keep existing response contracts, endpoint paths, auth guards, query parameters, sorting, and dashboard behavior unchanged.

## Boundaries & Constraints

**Always:** Preserve `/admin/manager/team` and `/admin/manager/trends` response shapes, auth behavior, default tenant fallback behavior for trends, days clamping, aggregation math, SQL filters, and visible dashboard output.

**Ask First:** Any schema migration, endpoint rename, dashboard UI change, caching/materialization, new table, altered default `days`, altered team sorting, or removal of current controller routes.

**Never:** Do not combine this with profile ownership, profile hydration, dashboard visual redesign, or GitHub/Railway regression setup.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Team summary | Admin calls `/admin/manager/team?tenantId=t1` | Controller delegates to read model and returns the same `AdminManagerTeamResponse` | Existing guard behavior remains unchanged |
| Empty team | Tenant has no active users | Response remains `{ tenantId, teamSize: 0, employees: [], generatedAt }` | No DB follow-up queries are required |
| Trends default tenant | `tenantId` omitted and `DEFAULT_TENANT_ID` exists | Trends read model uses the configured default tenant | Missing tenant still raises `BadRequestException` |
| Days bounds | `days` is blank, invalid, or above max | Existing clamp behavior remains unchanged | Invalid low/NaN values use default; high values clamp to max |

</frozen-after-approval>

## Code Map

- `apps/api/src/admin/manager-dashboard.read-model.ts` -- new injectable read model owner for manager dashboard query assembly.
- `apps/api/src/admin/manager-team.controller.ts` -- thin HTTP adapter for team summary.
- `apps/api/src/admin/manager-trends.controller.ts` -- thin HTTP adapter for trends summary.
- `apps/api/src/admin/admin.module.ts` -- registers the read model provider.
- `apps/api/src/admin/manager-team.aggregate.ts` -- existing pure team row aggregation, unchanged behavior.
- `apps/api/src/admin/manager-trends.aggregate.ts` -- existing pure trends aggregation, unchanged behavior.
- `apps/api/src/admin/manager-dashboard.read-model.test.ts` -- focused tests for HTTP adapter delegation and preserved edge behavior where practical.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- mark the read-model deferred item done after verification.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/admin/manager-dashboard.read-model.ts` -- move manager team and manager trends query assembly into one injectable read model.
- [x] `apps/api/src/admin/manager-team.controller.ts` -- delegate team response construction to the read model without changing route/guard/response type.
- [x] `apps/api/src/admin/manager-trends.controller.ts` -- delegate trends response construction to the read model without changing route/guard/default tenant behavior.
- [x] `apps/api/src/admin/admin.module.ts` -- register the read model provider.
- [x] `apps/api/src/admin/manager-dashboard.read-model.test.ts` -- cover controller delegation and trends tenant/day edge behavior.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- mark the admin read-model item done.

**Acceptance Criteria:**
- Given `/admin/manager/team` is called with a tenant ID, when the controller handles the request, then it delegates to the read model and returns `AdminManagerTeamResponse` unchanged.
- Given `/admin/manager/trends` is called without `tenantId` and config has `DEFAULT_TENANT_ID`, when the controller handles the request, then the read model uses the default tenant and preserves the current trends response.
- Given `/admin/manager/trends` is called without `tenantId` and config has no default, when the read model resolves input, then it throws the same `BadRequestException`.
- Given an empty team tenant, when the read model builds the team response, then it returns the same empty response envelope without changing dashboard semantics.

## Spec Change Log

## Verification

**Commands:**
- `pnpm --filter @entalent/api test -- manager-dashboard.read-model.test.ts`
- `pnpm --filter @entalent/api test -- manager-team.aggregate.test.ts manager-trends.aggregate.test.ts`
- `pnpm --filter @entalent/api typecheck`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`

**Results:**
- `pnpm --filter @entalent/api test -- manager-dashboard.read-model.test.ts` -- passed, 6 tests.
- `pnpm --filter @entalent/api test -- manager-team.aggregate.test.ts manager-trends.aggregate.test.ts` -- passed, 17 tests.
- `pnpm --filter @entalent/api typecheck` -- passed.
- `pnpm typecheck` -- passed.
- `pnpm lint` -- passed.
- `pnpm test` -- passed.

## Review Notes

**BMAD adversarial review completed:** Blind Hunter and Edge Case Hunter reviewed the diff from baseline commit `f94c346`.

**Resolved in this slice:**
- Added a read-model-level empty-team short-circuit test so `ManagerDashboardReadModel.getTeamOverview()` is exercised directly with a mocked DB boundary and proves no follow-up detail queries run when no active users exist.
- Kept new files explicitly staged for commit scope instead of relying on tracked-file-only commit behavior.

**Deferred / rejected as out of scope:**
- Blank tenant, whitespace tenant, and `parseInt('12abc')` behavior were identified as existing input-normalization quirks. They are intentionally not changed here because the approved boundary requires preserving current endpoint semantics.
- A Nest module compile test was considered optional residual confidence, not required for this refactor because provider registration is typechecked and existing controller/unit paths cover the changed boundary.

## Suggested Review Order

1. `apps/api/src/admin/manager-dashboard.read-model.ts`
2. `apps/api/src/admin/manager-team.controller.ts`
3. `apps/api/src/admin/manager-trends.controller.ts`
4. `apps/api/src/admin/manager-dashboard.read-model.test.ts`
5. `_bmad-output/implementation-artifacts/deferred-work.md`

---
title: 'Admin manager input normalization'
type: 'bugfix'
created: '2026-08-13'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'be45bfa6a0c7da5873bc120121ec95a9866e69f3'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Admin manager dashboard endpoints currently accept raw `tenantId` values and parse `days` with `parseInt`, which lets malformed input reach database predicates or silently change meaning. This makes bad requests harder to diagnose and keeps avoidable edge cases at the API boundary.

**Approach:** Normalize and validate admin manager read-model inputs at the read-model boundary before any database query is built. Preserve the existing default tenant fallback for omitted trends tenant IDs and preserve the existing maximum day clamp, while rejecting malformed UUIDs, whitespace-only tenant IDs, and non-integer `days` strings.

## Boundaries & Constraints

**Always:** Validate manager dashboard tenant IDs as UUID strings before database access; trim valid tenant IDs so incidental surrounding whitespace does not change the tenant; reject explicit blank or whitespace-only tenant IDs instead of falling back; keep trends default tenant fallback only when the query param is omitted; keep `days` default at 14 and max clamp at 120.

**Ask First:** Changes to public dashboard UI behavior, database schema, auth guards, production environment variables, or removal of the default tenant fallback.

**Never:** Do not widen accepted tenant ID formats for tests; do not add ad hoc validation in controllers when the shared read model can own the boundary; do not silently accept partial integer strings such as `12abc`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Trends tenant omitted | `tenantId` is `undefined`, `DEFAULT_TENANT_ID` is a valid UUID | Uses the default tenant and default/clamped days | Throws `BadRequestException` if the configured default is missing or invalid |
| Trends tenant explicit blank | `tenantId` is `''` or whitespace | Does not fall back to default tenant | Throws `BadRequestException` before DB access |
| Team tenant invalid | `tenantId` is not a UUID | No team queries execute | Throws `BadRequestException` before DB access |
| Days non-integer | `days` is `12abc`, `1.5`, or non-numeric text | Does not silently coerce | Throws `BadRequestException` |
| Days above max | `days` is `999` | Uses `120` days | N/A |

</frozen-after-approval>

## Code Map

- `apps/api/src/admin/manager-dashboard.read-model.ts` -- shared admin manager read-model boundary for team overview and trends.
- `apps/api/src/admin/manager-dashboard.read-model.test.ts` -- unit coverage for controllers, input resolution, and read-model short-circuit behavior.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/admin/manager-dashboard.read-model.ts` -- add tenant UUID normalization and strict days parsing before DB queries -- rejects invalid requests consistently at the shared boundary.
- [x] `apps/api/src/admin/manager-dashboard.read-model.test.ts` -- update old permissive expectations and add edge-case tests for tenant and days validation -- prevents regressions to silent coercion.

**Acceptance Criteria:**
- Given a valid UUID tenant with surrounding whitespace, when manager team or trends input is resolved, then the trimmed UUID is used in responses and predicates.
- Given an omitted trends tenant and a valid configured default tenant, when trends input is resolved, then the default tenant is used.
- Given an explicit blank tenant, malformed tenant, or invalid configured default tenant, when manager team or trends input is resolved, then `BadRequestException` is thrown before database access.
- Given a non-integer `days` string, when trends input is resolved, then `BadRequestException` is thrown.
- Given `days=999`, when trends input is resolved, then the days value is clamped to `120`.

## Spec Change Log

- Review patch finding: repeated query params can arrive as arrays at runtime and must return `BadRequestException`, not a `.trim()` TypeError. Amended implementation/tests to treat non-string tenant/day inputs as bad requests before string normalization.

## Verification

**Commands:**
- `pnpm --filter @entalent/api test -- manager-dashboard.read-model.test.ts` -- expected: focused tests pass.
- `pnpm --filter @entalent/api typecheck` -- expected: API typecheck passes.
- `pnpm test` -- expected: full test suite passes.
- `git diff --check` -- expected: no whitespace errors.

## Suggested Review Order

**Boundary validation**

- Entry point: normalize team tenant before any database predicate is built.
  [`manager-dashboard.read-model.ts:39`](../../apps/api/src/admin/manager-dashboard.read-model.ts#L39)

- Shared trends resolver preserves omitted-tenant fallback but validates explicit input.
  [`manager-dashboard.read-model.ts:211`](../../apps/api/src/admin/manager-dashboard.read-model.ts#L211)

- Tenant validation rejects blank, malformed, and non-string runtime values.
  [`manager-dashboard.read-model.ts:224`](../../apps/api/src/admin/manager-dashboard.read-model.ts#L224)

- Days parsing rejects non-integers while preserving default and max clamp.
  [`manager-dashboard.read-model.ts:243`](../../apps/api/src/admin/manager-dashboard.read-model.ts#L243)

**Regression coverage**

- Trends tests cover fallback, UUID trimming, invalid tenants, and repeated params.
  [`manager-dashboard.read-model.test.ts:60`](../../apps/api/src/admin/manager-dashboard.read-model.test.ts#L60)

- Team tests cover normalized response and no-query invalid tenant short-circuit.
  [`manager-dashboard.read-model.test.ts:111`](../../apps/api/src/admin/manager-dashboard.read-model.test.ts#L111)

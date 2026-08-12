---
title: 'Admin Pulse Overview Contract'
type: 'refactor'
created: '2026-08-12'
status: 'done'
review_loop_iteration: 0
baseline_commit: '112e8d1fadbf1f17c309811bfaece62c96401393'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The visible pulse overview dashboard page depends on `/admin/pulse/overview`, but API and dashboard define the response shape independently. This can let group rows, backlog fields, employee display names, or assessment status expectations drift without a compile-time failure.

**Approach:** Move the pulse overview response contract into `@entalent/contracts` and make the API controller plus dashboard pulse page consume the same exported types. Preserve the current JSON shape, active-employee filtering behavior, group ordering, backlog semantics, and dashboard rendering.

## Boundaries & Constraints

**Always:** Keep `/admin/pulse/overview`, optional `tenantId` query behavior, admin auth, `DEFAULT_TENANT_ID` fallback, field names, `GROUP_ORDER`, active employee filtering, and current dashboard UI unchanged. Preserve nullable `displayName`, nullable group state fields, nullable question assessment status, and nullable backlog `nextQuestion`.

**Ask First:** Any endpoint rename, new runtime validation layer, tenant resolution change, DB query behavior change, group sorting change, employee inclusion/filtering change, UI/layout change, or migration of other admin surfaces.

**Never:** Do not broaden this package into `/admin/users/:id/insights`, `/admin/manager/trends`, analytics, queues, job payload contracts, or dashboard API-client extraction. Do not alter backlog counting, group state math, survey question selection, or live data.

## I/O & Edge-Case Matrix

| Scenario          | Input / State                                                                           | Expected Output / Behavior                                                          | Error Handling                                              |
| ----------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Missing tenant    | No query tenant and no default tenant configured                                        | Existing `BadRequestException` behavior remains unchanged                           | Existing controller error response remains unchanged        |
| Empty team        | Tenant has no active users                                                              | Response remains `{ tenantId, generatedAt, allGroups: GROUP_ORDER, employees: [] }` | Existing controller behavior remains unchanged              |
| Active pulse rows | Tenant has users with assessments, group states, question definitions, and backlog rows | Employees and groups satisfy the shared `AdminPulseOverviewResponse` contract       | Existing aggregation/filtering behavior remains unchanged   |
| Dashboard fetch   | Pulse page requests `/admin/pulse/overview?tenantId=...`                                | Page imports the shared response contract from `@entalent/contracts`                | Existing `null` fallback on fetch failure remains unchanged |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/admin-manager-team.ts` -- prior visible dashboard surface contract pattern.
- `packages/contracts/src/index.ts` -- shared export surface consumed by API and dashboard.
- `apps/api/src/admin/pulse-overview.controller.ts` -- producer of `/admin/pulse/overview`; currently owns response interfaces and group order.
- `apps/dashboard/src/app/types.ts` -- dashboard-local duplicate pulse overview response interfaces.
- `apps/dashboard/src/app/pulse/page.tsx` -- visible pulse overview page fetches and renders the response.
- `apps/dashboard/package.json` and `apps/dashboard/Dockerfile` -- already support `@entalent/contracts`; should not require more Docker changes.

## Tasks & Acceptance

**Execution:**

- [x] `packages/contracts/src/admin-pulse-overview.ts` -- add `AdminPulseQuestionRow`, `AdminPulseGroupRow`, `AdminPulseEmployeeRow`, `AdminPulseBacklogSummary`, and `AdminPulseOverviewResponse` exports -- centralizes pulse overview response shape.
- [x] `packages/contracts/src/index.ts` -- export the new pulse overview contract -- makes it available to API and dashboard.
- [x] `apps/api/src/admin/pulse-overview.controller.ts` -- replace local response interfaces with shared contract imports/aliases -- makes API produce the shared response shape without changing logic.
- [x] `apps/dashboard/src/app/types.ts` and `apps/dashboard/src/app/pulse/page.tsx` -- remove duplicated pulse overview interfaces and import shared response type where the pulse page needs it -- makes dashboard compile against API contract.
- [x] Add focused contract/type tests -- prove nullable display name, nullable next question, group row fields, and response envelope remain stable.
- [x] Run targeted typechecks/tests/build checks -- prove contracts, API, and dashboard still compile.

**Acceptance Criteria:**

- Given `/admin/pulse/overview` compiles, when the API returns pulse overview data, then its result satisfies `AdminPulseOverviewResponse` from `@entalent/contracts`.
- Given dashboard pulse page compiles, when it fetches pulse overview data, then it reads employees/groups/backlog from the same shared contract rather than local duplicates.
- Given current data includes employees without display names or backlog next question, when pulse overview builds rows, then nullable fields remain nullable and visible rendering behavior remains unchanged.
- Given this refactor deploys, when users open the pulse overview dashboard, then visible layout, labels, rows, and data semantics remain unchanged.

## Spec Change Log

## Design Notes

Use shared TypeScript contracts only, not runtime schemas. Keep group ordering and aggregation ownership in the API controller for this split; the contract owns only the response shape.

## Verification

**Commands:**

- `pnpm --filter @entalent/contracts test -- admin-pulse-overview.test.ts` -- expected: pulse overview contract tests pass.
- `pnpm --filter @entalent/contracts typecheck` -- expected: shared contract compiles.
- `pnpm --filter @entalent/contracts build` -- expected: downstream declarations include the new exports.
- `pnpm --filter @entalent/api typecheck` -- expected: pulse overview controller satisfies shared response types.
- `pnpm --filter @entalent/dashboard typecheck` -- expected: dashboard resolves shared pulse contract imports and compiles.
- `pnpm --filter @entalent/dashboard build` -- expected: production build still succeeds.

**Results:**

- `pnpm --filter @entalent/contracts test -- admin-pulse-overview.test.ts` -- passed; package script also ran all contract vitest files and python runtime fixture validation.
- `pnpm --filter @entalent/contracts typecheck` -- passed.
- `pnpm --filter @entalent/contracts build` -- passed.
- `pnpm --filter @entalent/api typecheck` -- passed.
- `pnpm --filter @entalent/dashboard typecheck` -- passed.
- `pnpm --filter @entalent/dashboard build` -- passed; Next build emitted sandbox `fetch failed`/`EPERM` messages during static collection, but exited 0 and built `/pulse` as dynamic.

## Suggested Review Order

**Shared Contract**

- Start with the new response envelope and nullable dashboard fields.
  [`admin-pulse-overview.ts:1`](../../packages/contracts/src/admin-pulse-overview.ts#L1)

- Check backlog next-question nullability and summary shape.
  [`admin-pulse-overview.ts:15`](../../packages/contracts/src/admin-pulse-overview.ts#L15)

**API Producer**

- Verify the controller now targets the shared contract only.
  [`pulse-overview.controller.ts:5`](../../apps/api/src/admin/pulse-overview.controller.ts#L5)

- Confirm endpoint return typing preserves existing behavior.
  [`pulse-overview.controller.ts:39`](../../apps/api/src/admin/pulse-overview.controller.ts#L39)

- Review backlog typing without changing aggregation logic.
  [`pulse-overview.controller.ts:145`](../../apps/api/src/admin/pulse-overview.controller.ts#L145)

**Dashboard Consumer**

- Confirm pulse page imports the shared response type.
  [`page.tsx:2`](../../apps/dashboard/src/app/pulse/page.tsx#L2)

- Verify fetch binding uses the shared contract.
  [`page.tsx:43`](../../apps/dashboard/src/app/pulse/page.tsx#L43)

**Support**

- Ensure package export makes the contract available downstream.
  [`index.ts:9`](../../packages/contracts/src/index.ts#L9)

- Check focused type tests for nullability and envelope stability.
  [`admin-pulse-overview.test.ts:10`](../../packages/contracts/src/admin-pulse-overview.test.ts#L10)

---
title: 'Admin User Insights Contract'
type: 'refactor'
created: '2026-08-12'
status: 'done'
review_loop_iteration: 0
baseline_commit: '8ef968f86ed433c4f879ddaef7c9a38ec56c2f45'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The pulse drill-down dashboard page depends on `/admin/users/:userId/insights`, but the API controller and dashboard define the response shape independently. That lets question insight fields, nullable assessment/evidence values, and empty-window behavior drift without a compile-time failure.

**Approach:** Move the user insights response contract into `@entalent/contracts` and make the API controller plus dashboard user insights page consume the same exported types. Preserve the current JSON shape, route behavior, auth, question ordering, latest-evidence semantics, and dashboard rendering.

## Boundaries & Constraints

**Always:** Keep `/admin/users/:userId/insights`, `userId` path param behavior, ignored optional `tenantId` query behavior, admin auth, field names, question display-order sorting, active-window lookup, latest non-superseded evidence selection, numeric conversions, ISO timestamp conversions, and current dashboard UI unchanged. Preserve nullable `windowId`, `periodEnd`, `assessmentStatus`, `score`, `assessmentConfidence`, `currentState`, `assessedAt`, `polarity`, `evidenceStrength`, `rootCause`, and `evidenceUpdatedAt`.

**Ask First:** Any endpoint rename, tenant scoping change, active-window query change, runtime validation layer, DB query behavior change, evidence precedence change, question grouping/order change, display status logic change, UI/layout/text change, or migration of other admin surfaces.

**Never:** Do not broaden this package into `/admin/pulse/overview`, `/admin/manager/trends`, analytics, queues, job payload contracts, or dashboard API-client extraction. Do not alter insight computation, evidence filtering, status labels, group labels, fallback states, or live data.

## I/O & Edge-Case Matrix

| Scenario         | Input / State                                            | Expected Output / Behavior                                                                   | Error Handling                                            |
| ---------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| No active window | User has no active survey window                         | Response remains `{ userId, windowId: null, periodEnd: null, questions: [] }`                | Existing controller behavior remains unchanged            |
| Active window    | User has an active window with question definitions      | Response satisfies `AdminUserInsightsResponse` and preserves question `displayOrder` sorting | Existing aggregation behavior remains unchanged           |
| Null insight     | Question has no assessment or latest evidence            | Nullable assessment/evidence fields remain `null`                                            | Dashboard fallback rendering remains unchanged            |
| Dashboard fetch  | Drill-down page requests `/admin/users/:userId/insights` | Page imports shared response/question contracts from `@entalent/contracts`                   | Existing `null` fetch fallback behavior remains unchanged |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/admin-pulse-overview.ts` -- immediately previous admin dashboard contract pattern.
- `packages/contracts/src/index.ts` -- shared export surface consumed by API and dashboard.
- `apps/api/src/admin/user-insights.controller.ts` -- producer of `/admin/users/:userId/insights`; currently owns response interfaces and insight assembly.
- `apps/dashboard/src/app/types.ts` -- dashboard-local duplicate user insights interfaces.
- `apps/dashboard/src/app/pulse/[userId]/page.tsx` -- visible drill-down page fetches and renders user insights.
- `apps/dashboard/package.json` and `apps/dashboard/Dockerfile` -- already support `@entalent/contracts`; should not require more Docker changes.

## Tasks & Acceptance

**Execution:**

- [x] `packages/contracts/src/admin-user-insights.ts` -- add `AdminQuestionInsight` and `AdminUserInsightsResponse` exports -- centralizes the drill-down response shape.
- [x] `packages/contracts/src/index.ts` -- export the new user insights contract -- makes it available to API and dashboard.
- [x] `apps/api/src/admin/user-insights.controller.ts` -- replace local response interfaces with shared contract imports/aliases -- makes API produce the shared response shape without changing logic.
- [x] `apps/dashboard/src/app/types.ts` and `apps/dashboard/src/app/pulse/[userId]/page.tsx` -- remove duplicated user insights interfaces and import shared response/question types where the page needs them -- makes dashboard compile against API contract.
- [x] Add focused contract/type tests -- prove empty-window envelope, nullable insight fields, numeric fields, and response envelope remain stable.
- [x] Run targeted typechecks/tests/build checks -- prove contracts, API, and dashboard still compile.

**Acceptance Criteria:**

- Given `/admin/users/:userId/insights` compiles, when the API returns user insight data, then its result satisfies `AdminUserInsightsResponse` from `@entalent/contracts`.
- Given dashboard drill-down page compiles, when it fetches user insight data, then it reads questions from the same shared contract rather than local duplicates.
- Given current data includes questions without assessment or evidence, when user insights build rows, then nullable fields remain nullable and visible rendering behavior remains unchanged.
- Given this refactor deploys, when users open an employee insights page from Pulse, then visible layout, labels, rows, and data semantics remain unchanged.

## Spec Change Log

## Design Notes

Use shared TypeScript contracts only, not runtime schemas. Keep grouping, status label reconciliation, and display ordering where they already live; the contract owns only the response shape.

## Verification

**Commands:**

- `pnpm --filter @entalent/contracts test -- admin-user-insights.test.ts` -- expected: user insights contract tests pass.
- `pnpm --filter @entalent/contracts typecheck` -- expected: shared contract compiles.
- `pnpm --filter @entalent/contracts build` -- expected: downstream declarations include the new exports.
- `pnpm --filter @entalent/api typecheck` -- expected: user insights controller satisfies shared response types.
- `pnpm --filter @entalent/dashboard typecheck` -- expected: dashboard resolves shared user insights contract imports and compiles.
- `pnpm --filter @entalent/dashboard build` -- expected: production build still succeeds.

**Results:**

- `pnpm --filter @entalent/contracts test -- admin-user-insights.test.ts` -- passed; package script also ran all contract vitest files and python runtime fixture validation.
- `pnpm --filter @entalent/contracts typecheck` -- passed.
- `pnpm --filter @entalent/contracts build` -- passed.
- `pnpm --filter @entalent/api typecheck` -- passed.
- `pnpm --filter @entalent/dashboard typecheck` -- passed.
- `pnpm --filter @entalent/dashboard build` -- passed; Next build emitted sandbox `fetch failed`/`EPERM` messages during static collection, but exited 0 and built `/pulse/[userId]` as dynamic.

## Suggested Review Order

**Shared Contract**

- Start with the new insight row shape and nullable fields.
  [`admin-user-insights.ts:1`](../../packages/contracts/src/admin-user-insights.ts#L1)

- Check empty-window envelope nullability.
  [`admin-user-insights.ts:19`](../../packages/contracts/src/admin-user-insights.ts#L19)

**API Producer**

- Verify the controller now targets the shared contract.
  [`user-insights.controller.ts:9`](../../apps/api/src/admin/user-insights.controller.ts#L9)

- Confirm endpoint return typing preserves existing behavior.
  [`user-insights.controller.ts:21`](../../apps/api/src/admin/user-insights.controller.ts#L21)

- Review nullable conversions and latest evidence mapping.
  [`user-insights.controller.ts:97`](../../apps/api/src/admin/user-insights.controller.ts#L97)

**Dashboard Consumer**

- Confirm drill-down page imports the shared response type.
  [`page.tsx:2`](../../apps/dashboard/src/app/pulse/[userId]/page.tsx#L2)

- Verify fetch binding uses the shared contract.
  [`page.tsx:64`](../../apps/dashboard/src/app/pulse/[userId]/page.tsx#L64)

**Support**

- Ensure package export makes the contract available downstream.
  [`index.ts:10`](../../packages/contracts/src/index.ts#L10)

- Check focused type tests for empty envelope and nullability.
  [`admin-user-insights.test.ts:5`](../../packages/contracts/src/admin-user-insights.test.ts#L5)

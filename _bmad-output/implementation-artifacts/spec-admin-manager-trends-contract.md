---
title: 'Admin Manager Trends Contract'
type: 'refactor'
created: '2026-08-12'
status: 'done'
review_loop_iteration: 0
baseline_commit: '50ebdb9a173ae322490cb63048243c60a0b7c136'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The trends dashboard page depends on `/admin/manager/trends`, but API and dashboard define the response shape independently. This can let daily engagement, signal capture, coverage funnel, or question sentiment fields drift without a compile-time failure.

**Approach:** Move the manager trends response contract into `@entalent/contracts` and make the API aggregate/controller plus dashboard trends page consume the same exported types. Preserve the current JSON shape, tenant/day query behavior, trend aggregation, chart rendering, and fallback states.

## Boundaries & Constraints

**Always:** Keep `/admin/manager/trends`, optional `tenantId` query plus `DEFAULT_TENANT_ID` fallback, `days` parsing/clamping, admin auth, field names, date string format, continuous engagement/signal series, coverage funnel buckets, question sentiment net calculation, most-negative-first sorting, and current dashboard UI unchanged. Preserve `coverageFunnel: Record<string, number>` and nullable question sentiment `net`.

**Ask First:** Any endpoint rename, runtime validation layer, tenant resolution change, days window change, DB query behavior change, funnel bucket change, polarity handling change, chart prop shape change, UI/layout/text change, or migration of other admin surfaces.

**Never:** Do not broaden this package into `/admin/pulse/overview`, `/admin/users/:userId/insights`, queues, job payload contracts, dashboard API-client extraction, or MAF acceptance logic. Do not alter SQL, date math, sentiment scoring, chart components, or live data.

## I/O & Edge-Case Matrix

| Scenario        | Input / State                                                   | Expected Output / Behavior                                                    | Error Handling                                       |
| --------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------- |
| Missing tenant  | No query tenant and no default tenant configured                | Existing `BadRequestException` behavior remains unchanged                     | Existing controller error response remains unchanged |
| Default days    | Request omits `days`                                            | Existing 14-day window behavior remains unchanged                             | Existing clamp behavior remains unchanged            |
| Invalid days    | Request has non-numeric, less-than-1, or too-large `days` value | Existing `clampDays` behavior remains unchanged                               | Existing controller behavior remains unchanged       |
| Empty data      | Tenant has no rows in the selected window                       | Response still satisfies `AdminManagerTrendsResponse` with zero-filled series | Existing aggregation behavior remains unchanged      |
| Dashboard fetch | Trends page requests `/admin/manager/trends?...`                | Page imports shared response contract from `@entalent/contracts`              | Existing `null` fetch fallback remains unchanged     |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/admin-pulse-overview.ts` and `packages/contracts/src/admin-user-insights.ts` -- recent admin dashboard contract patterns.
- `packages/contracts/src/index.ts` -- shared export surface consumed by API and dashboard.
- `apps/api/src/admin/manager-trends.aggregate.ts` -- pure trend shaper; currently owns public response interfaces plus internal row/input types.
- `apps/api/src/admin/manager-trends.controller.ts` -- producer of `/admin/manager/trends`; returns aggregate result.
- `apps/dashboard/src/app/types.ts` -- dashboard-local duplicate trends response interfaces.
- `apps/dashboard/src/app/trends/page.tsx` -- visible trends page fetches and passes response data into chart components.

## Tasks & Acceptance

**Execution:**

- [x] `packages/contracts/src/admin-manager-trends.ts` -- add `AdminEngagementPoint`, `AdminSignalPoint`, `AdminQuestionSentiment`, and `AdminManagerTrendsResponse` exports -- centralizes trends response shape.
- [x] `packages/contracts/src/index.ts` -- export the new manager trends contract -- makes it available to API and dashboard.
- [x] `apps/api/src/admin/manager-trends.aggregate.ts` and `apps/api/src/admin/manager-trends.controller.ts` -- replace public response interfaces with shared contract imports/aliases while keeping internal row/input types local -- makes API produce the shared response shape without changing logic.
- [x] `apps/dashboard/src/app/types.ts` and `apps/dashboard/src/app/trends/page.tsx` -- remove duplicated trends response interfaces and import shared response type where the page needs it -- makes dashboard compile against API contract.
- [x] Add focused contract/type tests -- prove daily series, funnel, question sentiment, and nullable `net` fields remain stable.
- [x] Run targeted typechecks/tests/build checks -- prove contracts, API, and dashboard still compile.

**Acceptance Criteria:**

- Given `/admin/manager/trends` compiles, when the API returns trends data, then its result satisfies `AdminManagerTrendsResponse` from `@entalent/contracts`.
- Given dashboard trends page compiles, when it fetches trends data, then it reads engagement, signal capture, funnel, and question sentiment from the same shared contract rather than local duplicates.
- Given current data has no evidence for a question, when question sentiment is represented, then `net` remains nullable and dashboard chart behavior remains unchanged.
- Given this refactor deploys, when users open Trends, then visible layout, labels, charts, and data semantics remain unchanged.

## Spec Change Log

## Design Notes

Use shared TypeScript contracts only, not runtime schemas. Keep raw SQL row types and `BuildTrendsInput` inside the API aggregate; the contract owns only the public response shape.

## Verification

**Commands:**

- `pnpm --filter @entalent/contracts test -- admin-manager-trends.test.ts` -- expected: manager trends contract tests pass.
- `pnpm --filter @entalent/contracts typecheck` -- expected: shared contract compiles.
- `pnpm --filter @entalent/contracts build` -- expected: downstream declarations include the new exports.
- `pnpm --filter @entalent/api typecheck` -- expected: manager trends aggregate/controller satisfy shared response types.
- `pnpm --filter @entalent/dashboard typecheck` -- expected: dashboard resolves shared trends contract imports and compiles.
- `pnpm --filter @entalent/dashboard build` -- expected: production build still succeeds.

**Results:**

- `pnpm --filter @entalent/contracts test -- admin-manager-trends.test.ts` -- passed; package script also ran all contract vitest files and python runtime fixture validation.
- `pnpm --filter @entalent/contracts typecheck` -- passed.
- `pnpm --filter @entalent/contracts build` -- passed.
- `pnpm --filter @entalent/api typecheck` -- passed.
- `pnpm --filter @entalent/dashboard typecheck` -- passed.
- `pnpm --filter @entalent/dashboard build` -- passed; Next build emitted sandbox `fetch failed`/`EPERM` messages during static collection, but exited 0 and built `/trends`.

## Suggested Review Order

**Shared Contract**

- Start with the complete trends response envelope.
  [`admin-manager-trends.ts:1`](../../packages/contracts/src/admin-manager-trends.ts#L1)

- Check nullable question sentiment net shape.
  [`admin-manager-trends.ts:16`](../../packages/contracts/src/admin-manager-trends.ts#L16)

**API Producer**

- Verify aggregate now aliases shared response types.
  [`manager-trends.aggregate.ts:1`](../../apps/api/src/admin/manager-trends.aggregate.ts#L1)

- Confirm buildTrends still returns the same shaped response.
  [`manager-trends.aggregate.ts:76`](../../apps/api/src/admin/manager-trends.aggregate.ts#L76)

- Review zero-filled series and funnel preservation.
  [`manager-trends.aggregate.ts:90`](../../apps/api/src/admin/manager-trends.aggregate.ts#L90)

**Dashboard Consumer**

- Confirm trends page imports the shared response type.
  [`page.tsx:1`](../../apps/dashboard/src/app/trends/page.tsx#L1)

- Verify chart prop aliases now come from contracts.
  [`charts.tsx:1`](../../apps/dashboard/src/app/trends/charts.tsx#L1)

**Support**

- Ensure package export makes the contract available downstream.
  [`index.ts:11`](../../packages/contracts/src/index.ts#L11)

- Check focused type tests for trends envelope and nullability.
  [`admin-manager-trends.test.ts:10`](../../packages/contracts/src/admin-manager-trends.test.ts#L10)

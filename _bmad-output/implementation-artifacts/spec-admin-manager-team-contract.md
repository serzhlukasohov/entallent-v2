---
title: 'Admin Manager Team Contract'
type: 'refactor'
created: '2026-08-12'
status: 'done'
review_loop_iteration: 0
baseline_commit: '55ae66f531e68b575abe9b7e65ae73810df3ec14'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The visible dashboard team page depends on `/admin/manager/team`, but the API and dashboard define the response shape independently. This can let employee rows, Q12 signal fields, or display-name expectations drift without a compile-time failure.

**Approach:** Move the manager team response contract into `@entalent/contracts` and make the API aggregate/controller plus dashboard page/components consume the same exported types. Preserve the current JSON shape and dashboard rendering behavior.

## Boundaries & Constraints

**Always:** Keep the `/admin/manager/team` path, query parameters, auth behavior, field names, sorting behavior, and current dashboard UI unchanged. Preserve existing display-name fallback behavior: employee `displayName` must remain a non-null string in the response. Keep contract types broad enough for current stored assessment statuses and dimensions, while narrowing known polarity values where the UI already depends on them.

**Ask First:** Any endpoint rename, new runtime validation layer, DB query behavior change, employee sort change, UI/layout change, display-name policy change, or migration of other admin surfaces.

**Never:** Do not broaden this package into `/admin/pulse/overview`, `/admin/users/:id/insights`, `/admin/manager/trends`, queue payload contracts, or visual dashboard redesign. Do not alter aggregation math, evidence selection, risk logic, or live data.

## I/O & Edge-Case Matrix

| Scenario        | Input / State                                                   | Expected Output / Behavior                                                                                 | Error Handling                                              |
| --------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Empty team      | Active tenant has no active users                               | Response remains `{ tenantId, teamSize: 0, employees: [], generatedAt }`                                   | Existing controller behavior remains unchanged              |
| Employee rows   | Tenant has active users, signals, evidence, and risk rows       | `employees` items satisfy the shared `AdminManagerTeamEmployee` contract and dashboard reads the same type | Existing aggregation behavior remains unchanged             |
| Dashboard fetch | Dashboard home page requests `/admin/manager/team?tenantId=...` | Page imports `AdminManagerTeamResponse` from `@entalent/contracts`; visible rendering is unchanged         | Existing `null` fallback on fetch failure remains unchanged |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/queue.ts` -- prior split pattern for admin response contracts near related shared constants.
- `packages/contracts/src/index.ts` -- shared export surface consumed by API, dashboard, scripts, and tests.
- `apps/api/src/admin/manager-team.aggregate.ts` -- pure aggregation currently owns `QuestionSignal` and `EmployeeRow` response types.
- `apps/api/src/admin/manager-team.controller.ts` -- producer of `/admin/manager/team`; currently owns `TeamOverviewResponse`.
- `apps/dashboard/src/app/types.ts` -- dashboard-local duplicate definitions for `QuestionSignal`, `EmployeeRow`, and `TeamOverviewResponse`.
- `apps/dashboard/src/app/page.tsx` -- visible team dashboard page fetches `/admin/manager/team`.
- `apps/dashboard/src/app/components/TeamTable.tsx` -- visible consumer of employee row and signal types.
- `apps/api/src/admin/manager-team.aggregate.test.ts` -- focused aggregate tests; should continue to prove row shape behavior.

## Tasks & Acceptance

**Execution:**

- [x] `packages/contracts/src/admin-manager-team.ts` -- add `AdminManagerTeamQuestionSignal`, `AdminManagerTeamEmployee`, and `AdminManagerTeamResponse` exports -- centralizes visible team dashboard response shape.
- [x] `packages/contracts/src/index.ts` -- export the new manager team contract -- makes it available to API and dashboard.
- [x] `apps/api/src/admin/manager-team.aggregate.ts` -- replace local response interfaces with shared contract aliases/imports -- makes aggregation produce the shared employee shape.
- [x] `apps/api/src/admin/manager-team.controller.ts` -- replace local `TeamOverviewResponse` with shared response type -- makes API the producer of the shared contract.
- [x] `apps/dashboard/src/app/types.ts`, `apps/dashboard/src/app/page.tsx`, and `apps/dashboard/src/app/components/TeamTable.tsx` -- remove duplicated team response interfaces and import shared types where the team page needs them -- makes visible dashboard code compile against API contract.
- [x] Add or update focused tests/type assertions -- prove the shared contract preserves current field names, non-null employee display names, and polarity values expected by the UI.
- [x] Run targeted typechecks/tests/build checks -- prove contracts, API, and dashboard still compile.

**Acceptance Criteria:**

- Given `/admin/manager/team` compiles, when the API returns team overview data, then its result satisfies `AdminManagerTeamResponse` from `@entalent/contracts`.
- Given dashboard home page compiles, when it fetches team overview data, then `TeamTable` receives employees typed from the same shared contract rather than local duplicates.
- Given current production data contains active users with or without display names, when aggregation builds employee rows, then response `displayName` remains a non-null string and visible dashboard name rendering remains unchanged.
- Given this refactor deploys, when users open the dashboard, then visible layout, labels, rows, and data semantics remain unchanged.

## Spec Change Log

## Design Notes

Use shared TypeScript contracts only, not runtime schemas. This mirrors the admin queues split and keeps the package small while letting API and dashboard fail at compile time if the team response shape drifts.

## Verification

**Commands:**

- `pnpm --filter @entalent/contracts test -- admin-manager-team.test.ts` -- expected: manager team contract tests pass.
- `pnpm --filter @entalent/contracts typecheck` -- expected: shared contract compiles.
- `pnpm --filter @entalent/contracts build` -- expected: downstream declarations include the new exports.
- `pnpm --filter @entalent/api test -- manager-team.aggregate.test.ts` -- expected: aggregate behavior remains unchanged.
- `pnpm --filter @entalent/api typecheck` -- expected: controller/aggregate satisfy shared response types.
- `pnpm --filter @entalent/dashboard typecheck` -- expected: dashboard resolves shared team contract imports and compiles.
- `pnpm --filter @entalent/dashboard build` -- expected: production build still succeeds.

**Results:**

- `pnpm --filter @entalent/contracts test -- admin-manager-team.test.ts` -- passed.
- `pnpm --filter @entalent/contracts typecheck` -- passed.
- `pnpm --filter @entalent/contracts build` -- passed.
- `pnpm --filter @entalent/api test -- manager-team.aggregate.test.ts` -- passed.
- `pnpm --filter @entalent/api typecheck` -- passed.
- `pnpm --filter @entalent/dashboard typecheck` -- passed.
- `pnpm --filter @entalent/dashboard build` -- passed; Next reported sandbox `fetch EPERM` warnings during prerender, but exited successfully.
- `pnpm exec prettier --write ...` -- applied formatting to touched TS/TSX/MD files.

**Review Results:**

- Blind Hunter -- found a no-wire-change violation where unknown stored polarity values were normalized to `null`.
- Edge Case Hunter -- found the same normalization issue and noted that unrestricted DB polarity text should be validated separately.
- Fix applied -- response `polarity` remains `string | null`, known UI polarity values are exported separately as `ADMIN_MANAGER_TEAM_KNOWN_POLARITIES`, and aggregate tests now preserve legacy/custom stored polarity strings.
- Deferred -- DB/write-time validation for `survey_evidence.polarity` was appended to `deferred-work.md`.

## Suggested Review Order

**Shared Contract**

- Start here: visible team dashboard response now has one shared owner.
  [`admin-manager-team.ts:10`](../../packages/contracts/src/admin-manager-team.ts#L10)

- Employee display names remain non-null in the contract.
  [`admin-manager-team.ts:21`](../../packages/contracts/src/admin-manager-team.ts#L21)

- Known UI polarities are documented without narrowing the wire field.
  [`admin-manager-team.ts:1`](../../packages/contracts/src/admin-manager-team.ts#L1)

**API Producer**

- Aggregation returns shared employee rows while preserving wire behavior.
  [`manager-team.aggregate.ts:51`](../../apps/api/src/admin/manager-team.aggregate.ts#L51)

- Stored polarity strings pass through unchanged.
  [`manager-team.aggregate.ts:84`](../../apps/api/src/admin/manager-team.aggregate.ts#L84)

- Controller now promises the shared response type.
  [`manager-team.controller.ts:25`](../../apps/api/src/admin/manager-team.controller.ts#L25)

**Dashboard Consumer**

- Home page fetches `/admin/manager/team` with the shared contract.
  [`page.tsx:7`](../../apps/dashboard/src/app/page.tsx#L7)

- Team table consumes shared employee and signal types directly.
  [`TeamTable.tsx:4`](../../apps/dashboard/src/app/components/TeamTable.tsx#L4)

**Verification**

- Contract tests pin envelope, display name, and polarity field types.
  [`admin-manager-team.test.ts:7`](../../packages/contracts/src/admin-manager-team.test.ts#L7)

- Aggregate tests prove display-name fallback and legacy polarity preservation.
  [`manager-team.aggregate.test.ts:96`](../../apps/api/src/admin/manager-team.aggregate.test.ts#L96)

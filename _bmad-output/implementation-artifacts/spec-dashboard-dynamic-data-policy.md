---
title: 'Dashboard Dynamic Data Policy'
type: 'refactor'
created: '2026-08-12'
status: 'done'
review_loop_iteration: 0
baseline_commit: '3af83d93546fb859dceae0f2696ddc4f44758c3a'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The admin dashboard home and trends routes can be prerendered by Next.js and briefly serve build-time fallback HTML after deploy, even when production API endpoints are healthy. This makes production verification noisy and can make a successful deploy look broken.

**Approach:** Make admin dashboard data routes explicitly dynamic and no-store at runtime. Preserve all page UI, endpoint paths, shared contracts, admin auth headers, and null fallback behavior; change only the dashboard route caching policy.

## Boundaries & Constraints

**Always:** Keep existing dashboard pages, visible text, links, API paths, typed helpers, `TENANT_ID` handling, `ADMIN_API_KEY` header behavior, and `null` fallback rendering unchanged. Team, pulse overview, user insights, and trends pages must fetch data at request time instead of using build-time prerendered data. Trends must keep the 14-day default.

**Ask First:** Any UI/layout change, API endpoint change, response contract change, tenant lookup change, auth/header change, data aggregation change, or new dashboard route outside the existing admin dashboard pages.

**Never:** Do not touch API controllers, database queries, shared contracts, Railway config, user/hydration local changes, git hooks, or unrelated dirty worktree files. Do not introduce client-side fetching or a new runtime dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh deploy | Dashboard service starts after build with runtime env available | `/` and `/trends` render from runtime API data, not build-time fallback HTML | Existing fallback appears only if runtime fetch actually fails |
| Build without API access | Next production build cannot call admin API | Build still succeeds without baking fallback data into admin routes | Runtime request fetches data after deploy |
| Pulse routes | `/pulse` and `/pulse/:userId` already use no-store helpers | Their dynamic behavior is explicit and remains unchanged | Existing no-data/no-window fallback remains unchanged |
| API failure | Runtime admin API returns non-OK or fetch throws | Page receives `null` and existing fallback UI renders | No secrets are exposed |

</frozen-after-approval>

## Code Map

- `apps/dashboard/src/app/lib.ts` -- typed dashboard admin fetch boundary; controls helper-level revalidation.
- `apps/dashboard/src/app/page.tsx` -- team dashboard route currently eligible for ISR because it uses the default team helper cache policy.
- `apps/dashboard/src/app/trends/page.tsx` -- trends route currently eligible for ISR because it uses the default trends helper cache policy.
- `apps/dashboard/src/app/pulse/page.tsx` -- pulse overview already fetches fresh data; should gain explicit route config for consistency.
- `apps/dashboard/src/app/pulse/[userId]/page.tsx` -- user insights already fetches fresh data; should gain explicit route config for consistency.

## Tasks & Acceptance

**Execution:**

- [x] `apps/dashboard/src/app/lib.ts` -- allow named helpers to request no-store data and switch team/trends page calls to no-store without changing endpoint construction -- prevents ISR from caching admin snapshots.
- [x] `apps/dashboard/src/app/page.tsx` -- mark route dynamic/no-store and call team helper with runtime freshness -- prevents build-time fallback from being served on `/`.
- [x] `apps/dashboard/src/app/trends/page.tsx` -- mark route dynamic/no-store and call trends helper with runtime freshness while keeping 14-day default -- prevents build-time fallback from being served on `/trends`.
- [x] `apps/dashboard/src/app/pulse/page.tsx` `apps/dashboard/src/app/pulse/[userId]/page.tsx` -- add explicit dynamic/no-store route config matching current fetch behavior -- makes admin route policy consistent.
- [x] Run dashboard typecheck/build and inspect the Next route table -- prove `/` and `/trends` are dynamic (`ƒ`) rather than static ISR (`○`).

**Acceptance Criteria:**

- Given a production dashboard build runs without admin API access, when Next builds routes, then `/` and `/trends` are not prerendered as static ISR routes.
- Given `/` or `/trends` is requested after deploy, when runtime env and API are healthy, then the page fetches current API data instead of serving build-time fallback HTML.
- Given pulse routes are requested, when they fetch data, then their existing `revalidate = 0` freshness behavior remains unchanged.
- Given runtime admin fetch fails, when a dashboard page renders, then existing fallback UI still appears and no secret values are rendered.

## Spec Change Log

## Design Notes

Use route segment config for policy and helper arguments for fetch behavior. The route config makes Next treat the pages as dynamic, while `revalidate = 0` keeps the underlying server fetch aligned with the admin dashboard's operational expectation: data should come from runtime API availability, not from build-time snapshots.

## Verification

**Commands:**

- `pnpm --filter @entalent/dashboard typecheck` -- expected: dashboard route config and helper calls compile.
- `pnpm --filter @entalent/dashboard build` -- expected: build succeeds and route table shows `/`, `/trends`, `/pulse`, and `/pulse/[userId]` as dynamic.

**Results:**

- `pnpm --filter @entalent/dashboard typecheck` -- passed.
- `pnpm --filter @entalent/dashboard build` -- passed; route table shows `/`, `/pulse`, `/pulse/[userId]`, and `/trends` as `ƒ Dynamic`.
- `git diff --check` -- passed.

**Review Results:**

- Blind Hunter -- no findings.
- Edge Case Hunter -- no findings.

## Suggested Review Order

**Dynamic Policy**

- Start with the team route dynamic/no-store policy.
  [`page.tsx:6`](../../apps/dashboard/src/app/page.tsx#L6)

- Confirm team data bypasses fetch revalidation.
  [`page.tsx:9`](../../apps/dashboard/src/app/page.tsx#L9)

- Verify trends uses the same dynamic route policy.
  [`page.tsx:5`](../../apps/dashboard/src/app/trends/page.tsx#L5)

- Confirm trends keeps 14 days while disabling cache.
  [`page.tsx:8`](../../apps/dashboard/src/app/trends/page.tsx#L8)

**Policy Consistency**

- Pulse overview now declares its existing fresh behavior.
  [`page.tsx:7`](../../apps/dashboard/src/app/pulse/page.tsx#L7)

- User insights now declares its existing fresh behavior.
  [`page.tsx:8`](../../apps/dashboard/src/app/pulse/[userId]/page.tsx#L8)

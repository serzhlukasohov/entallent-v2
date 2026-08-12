---
title: 'Dashboard API Client Boundary'
type: 'refactor'
created: '2026-08-12'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'ab4de2c2bd92f7d833b2d23c90a834d2771980a0'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Dashboard pages still know admin API route strings, tenant query construction, cache timing, and generic response type wiring. After the shared contract split, this leaves transport details scattered across pages and makes future endpoint or query changes easy to miss.

**Approach:** Centralize typed admin dashboard fetch helpers in `apps/dashboard/src/app/lib.ts` and switch visible dashboard pages to those helpers. Preserve all current endpoints, query parameters, cache revalidation values, null-on-failure behavior, page rendering, and fallback copy.

## Boundaries & Constraints

**Always:** Keep server-side `fetch`, `API_INTERNAL_URL`, `ADMIN_API_KEY`, exported `TENANT_ID`, `x-api-key` header, default `revalidate = 30`, pulse overview/user insights `revalidate = 0`, manager trends `days = 14`, current null fallback semantics, and all visible page UI unchanged. Keep response types sourced from `@entalent/contracts`.

**Ask First:** Any endpoint path change, tenant resolution behavior change, runtime validation schema, auth/header change, cache policy change, page layout/text change, API controller change, or broad client abstraction outside dashboard admin surfaces.

**Never:** Do not modify API producers, database queries, shared contracts, chart components, queue contracts, Railway config, or production env values. Do not add a runtime dependency for URL construction or validation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Team page | Dashboard loads `/` with configured `TENANT_ID` | It requests `/admin/manager/team?tenantId=<TENANT_ID>` through a typed helper | Existing `null` fallback remains unchanged |
| Pulse overview | Dashboard loads `/pulse` | It requests `/admin/pulse/overview?tenantId=<TENANT_ID>` with `revalidate = 0` | Existing no-data fallback remains unchanged |
| User insights | Dashboard loads `/pulse/:userId` | It requests `/admin/users/:userId/insights` with `revalidate = 0` | Existing no-window fallback remains unchanged |
| Trends | Dashboard loads `/trends` | It requests `/admin/manager/trends?tenantId=<TENANT_ID>&days=14` through a typed helper | Existing `null` fallback remains unchanged |

</frozen-after-approval>

## Code Map

- `apps/dashboard/src/app/lib.ts` -- current dashboard API boundary with `fetchApi`, `TENANT_ID`, and `fetchAdminQueues`.
- `apps/dashboard/src/app/page.tsx` -- Team dashboard currently builds manager team path inline.
- `apps/dashboard/src/app/pulse/page.tsx` -- Pulse overview currently builds overview path inline and sets `revalidate = 0`.
- `apps/dashboard/src/app/pulse/[userId]/page.tsx` -- User insights currently fetches with a page-local generic type.
- `apps/dashboard/src/app/trends/page.tsx` -- Trends page currently owns `WINDOW_DAYS`, route string, and response generic.
- `packages/contracts/src/index.ts` -- source of shared admin response types consumed by dashboard helpers.

## Tasks & Acceptance

**Execution:**

- [x] `apps/dashboard/src/app/lib.ts` -- import all shared admin response contracts and add typed helpers for manager team, pulse overview, user insights, manager trends, and queues -- creates one dashboard admin transport boundary.
- [x] `apps/dashboard/src/app/page.tsx` -- replace inline `fetchApi<AdminManagerTeamResponse>` plus `TENANT_ID` path assembly with the manager team helper -- reduces route construction in the page.
- [x] `apps/dashboard/src/app/pulse/page.tsx` -- replace inline pulse overview fetch with the pulse overview helper while preserving `revalidate = 0` -- keeps freshness behavior unchanged.
- [x] `apps/dashboard/src/app/pulse/[userId]/page.tsx` -- replace inline user insights fetch with the user insights helper and keep the local rendering type alias only where needed -- removes endpoint knowledge from the page.
- [x] `apps/dashboard/src/app/trends/page.tsx` -- replace inline trends fetch and local `WINDOW_DAYS` constant with the trends helper default -- keeps trends behavior behind the boundary.
- [x] Run focused dashboard typecheck/build checks -- prove route helpers preserve compile-time contracts and production build behavior.

**Acceptance Criteria:**

- Given dashboard pages compile, when a page needs admin data, then it calls a named helper from `apps/dashboard/src/app/lib.ts` instead of passing an admin path string to `fetchApi`.
- Given pulse overview and user insights pages render, when they fetch data, then `revalidate = 0` remains in effect through the helper.
- Given trends renders, when it fetches data, then the helper still uses the 14-day window and the same tenant query.
- Given an admin fetch fails or returns non-OK, when any dashboard page receives data, then the returned value remains `null` and existing fallback UI is unchanged.

## Spec Change Log

## Design Notes

Keep the boundary intentionally thin: named functions should encode route strings and response types, while `fetchApi` remains the only place that knows API base URL, API key, and Next.js fetch options. Use `URLSearchParams` for tenant/day query strings so query construction is explicit without adding dependencies.

## Verification

**Commands:**

- `pnpm --filter @entalent/dashboard typecheck` -- expected: dashboard helpers and pages compile with shared contracts.
- `pnpm --filter @entalent/dashboard build` -- expected: Next production build succeeds with unchanged route behavior.

**Results:**

- `pnpm --filter @entalent/dashboard typecheck` -- passed.
- `pnpm --filter @entalent/dashboard build` -- passed; Next build emitted sandbox `fetch failed`/`EPERM` messages during static collection, but exited 0 and generated all routes.
- `rg "fetchApi<|fetchApi\\(" apps/dashboard/src/app --glob '*.tsx' --glob '*.ts'` -- passed; direct admin fetch calls remain only in `apps/dashboard/src/app/lib.ts`.

**Review Results:**

- Blind Hunter -- no findings.
- Edge Case Hunter -- no findings.

## Suggested Review Order

**Boundary**

- Start at the typed admin transport boundary.
  [`lib.ts:1`](../../apps/dashboard/src/app/lib.ts#L1)

- Confirm low-level fetch behavior stayed unchanged.
  [`lib.ts:13`](../../apps/dashboard/src/app/lib.ts#L13)

- Verify pulse freshness defaults remain uncached.
  [`lib.ts:35`](../../apps/dashboard/src/app/lib.ts#L35)

- Check user insight paths are centrally encoded.
  [`lib.ts:41`](../../apps/dashboard/src/app/lib.ts#L41)

- Confirm trends keep the 14-day default.
  [`lib.ts:51`](../../apps/dashboard/src/app/lib.ts#L51)

**Consumers**

- Team page now uses the manager team helper.
  [`page.tsx:6`](../../apps/dashboard/src/app/page.tsx#L6)

- Pulse overview keeps helper-level fresh fetches.
  [`page.tsx:40`](../../apps/dashboard/src/app/pulse/page.tsx#L40)

- User insights no longer owns endpoint construction.
  [`page.tsx:58`](../../apps/dashboard/src/app/pulse/[userId]/page.tsx#L58)

- Trends page delegates days and tenant query construction.
  [`page.tsx:5`](../../apps/dashboard/src/app/trends/page.tsx#L5)

---
title: 'Dashboard cleanup: navigation and cycles list with participants'
type: 'feature'
created: '2026-10-14'
status: 'done'
baseline_commit: 'eeecc109854a1b6efc4d8a0178d1d290d6e97eb4'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The internal dashboard has four overlapping tabs (Team, Trends, Pulse Check, V2 Pilot) full of legacy Pulse charts and technical counters. The PO cannot quickly see which cycles happened, when, or who took part.

**Approach:** Remove the Trends and V2 Pilot pages and the dead components. Add a "Циклы" tab that lists the V2 cycles with dates. Each cycle opens a detail page that shows the key metrics carried over from V2 Pilot and the cohort roster with who actually took part. This is spec 1 of 3. Spec 2 (current-cycle insights + Team Signals) and spec 3 (team hierarchy) are recorded in `deferred-work.md`.

## Boundaries & Constraints

**Always:** Reuse the existing admin endpoints only: `GET /admin/v2-pilot` (status, max 5 non-upcoming cycles, `cohortIds` filter) and `GET /admin/v2-pilot/people?cohortId=`. Keep the existing env gates: `INTERNAL_DASHBOARD_ENABLED`, the Test AI Agent tenant check, and `QA_PRIVATE_VIEW_ENABLED` for anything with names. Show times in Europe/Warsaw. UI copy is in Russian. Keep `force-dynamic`.

**Ask First:** Any API, contract, or database change. Removing `/pulse` or `/pulse/[userId]` (spec 2 owns them).

**Never:** Do not show names when `QA_PRIVATE_VIEW_ENABLED` is off. Do not add dependencies. Do not touch the API's legacy `/admin/manager/trends` endpoint (only the dashboard page goes).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| List | API returns cycles | One row per cycle, newest first: dates, state (Идёт/Завершён), took part X/roster, Autonomy 3/3, report state; row links to `/cycles/{cohortId}` | N/A |
| Empty | `cycles: []` | "Циклов V2 пока нет" | N/A |
| API unavailable | fetch returns null | "Данные недоступны" message, no crash | null-safe render |
| Detail | valid cohortId | Key metrics + roster table: name, сообщений в цикле, участвовал (inbound>0), Автономия stage | N/A |
| Detail, private view off | people fetch null | Metrics shown; roster replaced with "Состав доступен только в QA-режиме" | N/A |
| Detail, unknown / malformed id | not a UUID, or API returns no cycle | `notFound()` | UUID-validate before calling the API |

</frozen-after-approval>

## Code Map

- `apps/dashboard/src/app/components/Nav.tsx` -- tabs; becomes Команда `/`, Циклы `/cycles`, Текущий цикл `/pulse`
- `apps/dashboard/src/app/lib.ts` -- API fetchers; trends/queues fetchers become dead
- `apps/dashboard/src/app/v2-pilot-progress.ts` (+ `.test.ts`) -- pure helpers; home for the cycle report-state logic now in `pilot/page.tsx`
- `apps/dashboard/src/app/pilot/page.tsx`, `trends/` -- removed; their key metrics move to the cycle detail
- `apps/dashboard/src/app/components/TeamTable*.tsx`, `pulse/DevControls.tsx`, `pulse/actions.ts`, `pulse/dev-controls-gate.ts`, `actions.ts` -- unused dead code
- `scripts/verify-production-dashboard.ts` -- asserts the `/trends` page and the "Trends" label; must follow the new routes
- `apps/dashboard/README.md` -- documents the `/pilot` exception

## Tasks & Acceptance

**Execution:**
- [x] `apps/dashboard/src/app/v2-pilot-progress.ts` -- add `cycleReportState(cycle, now)`, `cycleStateLabel(state)`, and a shared `warsawDateTime()` formatter. Cover them in `v2-pilot-progress.test.ts` -- single tested source of the copy.
- [x] `apps/dashboard/src/app/lib.ts` -- `fetchAdminV2PilotPeople(cohortId?)` passes `cohortId`; add `fetchAdminV2PilotCycle(cohortId)` that uses `cohortIds`; delete the trends/queues/reset fetchers and `UserResetResult` -- detail needs a specific cohort.
- [x] `apps/dashboard/src/app/cycles/page.tsx` -- new list page per the matrix.
- [x] `apps/dashboard/src/app/cycles/[cohortId]/page.tsx` -- new detail page: header (dates, state), metric tiles (took part / roster, processed / inbound, ready meanings, bundles delivered, Autonomy 3/3 of 5, report state), roster table sorted participants-first.
- [x] `apps/dashboard/src/app/components/Nav.tsx` -- three tabs with Russian labels.
- [x] Delete `trends/`, `pilot/`, `components/TeamTable.tsx`, `components/TeamTable.test.tsx`, `pulse/DevControls.tsx`, `pulse/actions.ts`, `pulse/dev-controls-gate.ts`, `actions.ts`. Update the `active` prop of `page.tsx`, `pulse/page.tsx`, and `pulse/[userId]/page.tsx`.
- [x] `scripts/verify-production-dashboard.ts` -- replace the `/trends` page check with a `/cycles` dynamic-route check; the home page asserts "Циклы". Keep the API trends assertion.
- [x] `apps/dashboard/README.md` -- replace the `/pilot` note with `/cycles`. Same data boundary for the list; names only under `QA_PRIVATE_VIEW_ENABLED`.

**Acceptance Criteria:**
- Given the dashboard, when any page loads, then the nav shows exactly Команда, Циклы, Текущий цикл, and `/trends` and `/pilot` return 404.
- Given a cycle row, when clicked, then the detail page shows who took part in that cycle, not in the current one.

## Design Notes

"Took part" = roster member with ≥1 inbound message inside the cycle period (`person.inbound > 0`). This matches the API's `participants` count, so the list and the detail agree.

## Verification

**Commands:**
- `pnpm exec tsx apps/dashboard/src/app/v2-pilot-progress.test.ts` -- expected: all pass
- `pnpm --filter @entalent/dashboard typecheck && pnpm --filter @entalent/dashboard lint && pnpm --filter @entalent/dashboard build` -- expected: success
- `pnpm exec tsc --noEmit -p scripts` or the repo typecheck covering scripts -- expected: success

**Manual checks:**
- Run the dashboard locally against the local API and open `/cycles` and a cycle detail. Check that rendering, empty states, and 404s match the matrix.

## Suggested Review Order

**Cycle detail (entry point)**

- 404 for unknown ids vs "data unavailable" for API failures; ids normalized to lowercase
  [`[cohortId]/page.tsx:21`](../../apps/dashboard/src/app/cycles/%5BcohortId%5D/page.tsx#L21)

- Roster is cohort-scoped; QA-flag-off and API-failure messages are distinct
  [`[cohortId]/page.tsx:63`](../../apps/dashboard/src/app/cycles/%5BcohortId%5D/page.tsx#L63)

- Single-cycle fetch via `cohortIds`, keeps unknown-cycle separate from null
  [`lib.ts:42`](../../apps/dashboard/src/app/lib.ts#L42)

**Cycle list and shared copy**

- Newest-first list linking to detail; report state from the shared helper
  [`cycles/page.tsx:9`](../../apps/dashboard/src/app/cycles/page.tsx#L9)

- Report-state copy moved from the deleted pilot page; upcoming + Russian plurals handled
  [`v2-pilot-progress.ts:42`](../../apps/dashboard/src/app/v2-pilot-progress.ts#L42)

- Three tabs: Команда, Циклы, Текущий цикл
  [`Nav.tsx:3`](../../apps/dashboard/src/app/components/Nav.tsx#L3)

**Peripherals**

- Prod verifier checks /cycles content and the Russian fallback text
  [`verify-production-dashboard.ts:60`](../../scripts/verify-production-dashboard.ts#L60)

- README access boundary for /cycles and the QA private view
  [`README.md:36`](../../apps/dashboard/README.md#L36)

- Helper tests: report states, plurals, upcoming, Warsaw time, id validation
  [`v2-pilot-progress.test.ts:36`](../../apps/dashboard/src/app/v2-pilot-progress.test.ts#L36)

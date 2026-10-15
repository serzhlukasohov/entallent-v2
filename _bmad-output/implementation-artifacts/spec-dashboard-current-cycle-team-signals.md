---
title: 'Dashboard current cycle: working insights next to de-identified Team Signals'
type: 'feature'
created: '2026-10-14'
status: 'done'
baseline_commit: 'fa419a8f00d4cf388974cc2411e3ecc7667ef3ae' # working-tree snapshot after uncommitted spec 1 (refs/bmad/spec2-baseline)
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The "Текущий цикл" tab (`/pulse`) shows only temporary, unconfirmed working insights per person. For testing, the PO needs to see the confirmed result as well. It should appear de-identified, the way a manager would see it as Team Signals, so the anonymization can be checked.

**Approach:** Add an API projection that returns the current cycle's confirmed insights from `survey_question_insights`. Each insight carries its de-identified summary, outcome, score, direction, severity and root cause, with no user identifiers. Rebuild `/pulse` into two sections: "Временные инсайты" (unconfirmed, per person, as today) and "Team Signals" (confirmed, no names, grouped by group → topic). This is spec 2 of 3.

## Boundaries & Constraints

**Always:**
- The Team Signals payload contains no `userId`, display name, window id, working-insight id, source message id, or working/confirmed private text.
- Only `is_current AND withdrawn_at IS NULL` insights of the resolved cohort are returned. Cohort resolution is the same as `getPeople`: explicit `cohortId`, or else the running cohort, falling back to the latest started cohort.
- Signals are ordered by topic display order, then by summary text. They are never ordered by roster position, so the order cannot be linked back to people.
- The QA view ignores the 5-contributor threshold. The dashboard shows Team Signals only under `QA_PRIVATE_VIEW_ENABLED=true` and the Test AI Agent tenant gate, and the page states that the threshold is not applied.
- The endpoint is protected by `ApiKeyGuard` and `assertInternalDashboardEnabled`, the same as the existing `/admin/v2-pilot` routes.
- UI copy is in Russian.

**Ask First:** Any database migration, any change to the worker or de-identification pipeline, or exposing Team Signals outside the QA flag.

**Never:**
- Do not join identity tables in the Team Signals query.
- Do not change the existing `/admin/v2-pilot/people` contract.
- Do not touch the cycles pages from spec 1, beyond reusing helpers.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Signals exist | Running cohort with scored and insufficient-evidence insights | List of `{stableKey, title, group, summary, outcome, score, direction, severity, rootCause}`; score is null for insufficient evidence | N/A |
| Withdrawn / superseded | `withdrawn_at` set or `is_current=false` | Excluded | N/A |
| No signals yet | Cohort with no insights | Empty `signals`; UI shows "Подтверждённых сигналов пока нет" | N/A |
| Bad input | Non-UUID tenantId or cohortId | 400 | BadRequestException |
| No cohort | Tenant has no V2 cohort | 404 | NotFoundException |
| No running cycle | Only closed cohorts | Latest closed cohort with `state: 'closed'`; page label says no active cycle | N/A |
| Private view off | `QA_PRIVATE_VIEW_ENABLED` not true | Both sections are replaced with the QA-mode notice | null-safe render |

</frozen-after-approval>

## Code Map

- `apps/api/src/admin/v2-pilot.read-model.ts` -- `getPeople`/`listCohorts`/`selectCurrentPilotCohort` show the cohort resolution and tenant scoping to mirror
- `apps/api/src/admin/v2-pilot.controller.ts` -- add the route next to `people`
- `apps/api/src/admin/v2-pilot.read-model.test.ts` -- vitest patterns with a mocked `client.execute`
- `packages/contracts/src/admin-v2-pilot-people.ts`, `index.ts` -- contract home and exports
- `packages/database/src/schema/survey-insight-v2.ts` -- `survey_question_insights` columns: `deidentified_summary`, `outcome`, `score`, `signal_direction`, `signal_severity`, `root_cause_category`
- `apps/dashboard/src/app/pulse/page.tsx` -- current per-person working view, to be split into two sections
- `apps/dashboard/src/app/lib.ts` -- gated fetchers (`qaPrivateViewEnabled`, tenant gate)

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/admin-v2-pilot-team-signals.ts` -- add `AdminV2PilotTeamSignal` and `AdminV2PilotTeamSignalsResponse` (cohortId, periodStart, periodEnd, state, checkedAt, signals), and export them from `index.ts`.
- [x] `apps/api/src/admin/v2-pilot.read-model.ts` -- add `getTeamSignals(tenantId, cohortId?)` (shared cohort resolution with `getPeople`) and a pure `projectPilotTeamSignals(cohort, rows, now)`. The SQL selects only signal columns joined through `survey_windows.reporting_cohort_id`.
- [x] `apps/api/src/admin/v2-pilot.controller.ts` -- `GET admin/v2-pilot/team-signals` with `Cache-Control: private, no-store`.
- [x] `apps/api/src/admin/v2-pilot.read-model.test.ts` -- tests for input validation, the cohort default, the projection dropping injected private fields (userId, source ids, working text), and score null → null.
- [x] `apps/dashboard/src/app/lib.ts` -- `fetchAdminV2PilotTeamSignals()` behind the QA and tenant gates.
- [x] `apps/dashboard/src/app/v2-pilot-progress.ts` (+ test) -- Russian labels for direction (adverse/mixed/favorable), severity (low/moderate/high), and outcome.
- [x] `apps/dashboard/src/app/pulse/page.tsx` -- header "Текущий цикл" with `cohortLabel`. Section "Временные инсайты · не подтверждены" holds the existing person cards. Section "Team Signals · подтверждено и обезличено" groups signals by group → topic, one card each with summary, direction, severity, score (or "недостаточно данных") and root cause, plus a note that the threshold is not applied in QA. Both fetches run in parallel.

**Acceptance Criteria:**
- Given confirmed insights in the current cycle, when `/pulse` loads, then each appears under Team Signals with no participant name, and the unconfirmed working summaries remain in the temporary section.
- Given the API response, when inspected, then it contains no user identifiers or private working text.

## Verification

**Commands:**
- `pnpm --filter @entalent/contracts build` -- expected: success, so consumers see the new types
- `pnpm --filter @entalent/api exec vitest run src/admin/v2-pilot.read-model.test.ts` -- expected: all pass
- `pnpm --filter @entalent/api typecheck && pnpm --filter @entalent/api lint` -- expected: success
- `pnpm exec tsx apps/dashboard/src/app/v2-pilot-progress.test.ts` -- expected: all pass
- `pnpm --filter @entalent/dashboard typecheck && pnpm --filter @entalent/dashboard lint && pnpm --filter @entalent/dashboard build` -- expected: success

## Suggested Review Order

**Team Signals query (entry point)**

- Same population as the people view: frozen roster, latest window, latest participant-confirmed insight; no identity in SELECT
  [`v2-pilot.read-model.ts:128`](../../apps/api/src/admin/v2-pilot.read-model.ts#L128)

- Explicit field copy drops any injected private column; numeric score parsed
  [`v2-pilot.read-model.ts:438`](../../apps/api/src/admin/v2-pilot.read-model.ts#L438)

- Route mirrors `people`: API key, internal-dashboard gate, no-store
  [`v2-pilot.controller.ts:39`](../../apps/api/src/admin/v2-pilot.controller.ts#L39)

**Current-cycle page**

- Cohort resolved once via people, then pinned for Team Signals
  [`pulse/page.tsx:120`](../../apps/dashboard/src/app/pulse/page.tsx#L120)

- Signal card hides direction/severity for insufficient evidence
  [`pulse/page.tsx:43`](../../apps/dashboard/src/app/pulse/page.tsx#L43)

- Russian labels for direction, severity, outcome, root cause
  [`v2-pilot-progress.ts:106`](../../apps/dashboard/src/app/v2-pilot-progress.ts#L106)

**Peripherals**

- Contract with no user identifiers
  [`admin-v2-pilot-team-signals.ts:4`](../../packages/contracts/src/admin-v2-pilot-team-signals.ts#L4)

- Tests: validation, cohort default, roster scoping, private-field stripping
  [`v2-pilot.read-model.test.ts:166`](../../apps/api/src/admin/v2-pilot.read-model.test.ts#L166)

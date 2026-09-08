# Brownfield Contract

## Minimal persistence boundary

- `survey_reporting_cohorts`: `id`, `tenant_id`, `team_id`, `survey_definition_id`, `period_start`, `period_end`, sorted `roster_user_ids`, `opened_at`; unique across the full tenant/team/definition/period key.
- `survey_windows.reporting_cohort_id`: nullable foreign key. Null means report-ineligible legacy scope.
- Do not persist `roster_size`; derive it from `roster_user_ids`.

## State flow

1. `OpenSurveyReportingCycleUseCase` requests one atomic open for tenant, definition, and half-open period.
2. The repository requires configured tenant teams, selects active, non-deleted, survey-opted-in users with exactly one active member-team assignment at `openedAt`, groups and sorts them by team, and inserts immutable cohorts idempotently, including empty small-team rosters.
3. `findOrCreateActiveWindow` resolves the already-open cohort for the employee. It closes a stale active window only when it is outside that canonical cohort, then creates or returns the cohort-bound current window.
4. Group reporting resolves scope through `reportingCohortId`, uses the frozen roster as denominator, and rechecks current user eligibility before accepting contributions.

## Invocation

`pnpm survey:cycle:open` is the only adapter in this slice. It requires `DATABASE_URL`, `TENANT_ID`, `SURVEY_DEFINITION_ID`, `SURVEY_PERIOD_START`, `SURVEY_PERIOD_END`, `SURVEY_OPENED_AT`, and `CONFIRM_SURVEY_CYCLE_OPEN` equal to `TENANT_ID`. Output contains cohort/team IDs and roster sizes, never roster user IDs.

## Failure behavior

- Missing cohort, tenant mismatch, team mismatch, period mismatch, definition mismatch, divergent roster, confirmation outside `[periodStart, periodEnd)`, duplicate cohort key conflict, or fewer than five currently eligible contributors fails closed before AI.
- Concurrent cycle opens rely on the database unique key and return the canonical stored cohort.
- Legacy windows are closed for rollover but never populated with a fabricated cohort or roster.
- Concurrent first-window uniqueness remains deferred until existing duplicate-active-window data can be audited safely.
- Eligibility is revalidated before AI; a second check immediately before Slack delivery remains part of report snapshot/delivery lifecycle.

## Verification focus

- RED database integration: five frozen members, one later opt-out, denominator remains five, opted-out contribution excluded, report fails closed at four.
- RED repository test: a stale legacy active window does not block a current cohort-bound window.
- Focused application/worker tests, affected typecheck/lint/build, database integration, `pnpm prepush`, and `git diff --check`.

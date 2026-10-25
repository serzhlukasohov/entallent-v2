---
status: blocked
---

# BMad Build Auto Result

Status: blocked
Blocking condition: intent gap — Story 12.6 (Cadence Policy Extracted from Worker SQL) has defensible readings with observably different production behavior.

## Unresolved questions

1. **Batch limit vs moved filters (production behavior).** Today `apps/worker/src/proactive/proactive-scheduler.repository.ts` applies silence, gap, QA cadence and the unanswered guard in SQL *before* `LIMIT ${params.limit}` (default 50). The AC asks the repository to return "coarse eligibility filters only" and the use case to apply `checkInCadencePolicy`. With the LIMIT still in SQL, a scan can return 50 cadence-ineligible users every time and starve eligible ones — contradicting "production behavior must not change" (epic-12 context). Which reading?
   - (a) Keep the SQL cadence predicate as a prefilter **and** return facts; the policy re-decides (authoritative for L0, redundant in prod). Lowest risk; contradicts "coarse filters only".
   - (b) Drop cadence from SQL and apply `batchLimit` after the policy in the use case (no SQL LIMIT, or a much larger page) — scans every active user per run.
   - (c) Paginate the coarse query until `batchLimit` eligible users or the end.
   Recommendation: (a) now, (b)/(c) as a measured follow-up.
2. **QA cadence membership.** The AC puts `qaCadence` in `config`, but membership is per user (cohort roster) and per tenant (`proactive_messaging_policy.qaThreePerDayCohortId`) and windowed by `period_start/period_end` against Postgres `now()`. Is it a per-user fact (`inQaCadenceCohort`, evaluated against which clock?) with the 2 h / 4 h / 3-per-24 h intervals in config?
3. **Clock source for the remaining SQL.** Facts such as `recentProactiveCount` (last 24 h) still need a time bound; does the repository take `now` from `clock.now()` as a parameter, or return raw timestamps for the policy to count?

## Evidence gathered

- SQL predicate: `proactive-scheduler.repository.ts:35-127` (silence, gap, QA cadence 2 h / 4 h / <3 per 24 h, unanswered-proactive guard, `proactive_check_in_request` inbound counted as contact, `LIMIT` last).
- Use case: `packages/application/src/use-cases/proactive-scheduler.use-case.ts` (quiet-hours guard after the repository).
- Port: `packages/application/src/ports/proactive-scheduler.repository.port.ts`.
- Epic context line 51: "Production behavior must not change".

## Impact

Story 12.7 drives P-06 through the cadence policy (epic-12 context, dependency notes), so its P-06 path waits on this decision.

---
title: 'Story 12.6: Cadence Policy Extracted from Worker SQL'
type: 'refactor'
created: '2026-10-25'
status: 'done'
baseline_revision: 'b2bfe21d28464f5a082b80029a648e4db92bbc54'
route: 'dispatch'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
warnings: []
deferred:
  - summary: >-
      The SQL prefilter decides with Postgres `now()` and the policy with the worker clock; a worker clock behind the DB could reject a user the SQL accepted.
    evidence: |-
      All four review layers (Story 12.6). The policy normally runs later than the query, so it is more permissive; a rejection defers the user to the next scan and appears as `skippedCadence` in the scan log. Settle with production logs; if non-zero, evaluate the policy at a DB-returned scan instant.
    location: >-
      packages/application/src/use-cases/proactive-scheduler.use-case.ts
    severity: medium (unverified)
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The proactive cadence decision (silence, gap between proactive contacts, QA cadence, unanswered-proactive guard) lives only in the worker SQL, so the 48-hour rule cannot be tested at L0 and a cadence regression can hide in SQL.

**Approach:** Add a pure `checkInCadencePolicy(facts, config, now)` in `packages/application` that reproduces every branch of the SQL predicate. The repository keeps its SQL cadence prefilter unchanged (user decision 2026-10-25, option a) and additionally returns per-user cadence facts; `ProactiveSchedulerUseCase` applies the policy with `clock.now()` before the quiet-hours guard and reports `skippedCadence`.

## Boundaries & Constraints

**Always:**
- **Option (a), decided by the user:** the SQL cadence predicate and `LIMIT` stay exactly as they are; the policy runs on top of the prefiltered candidates. In production it re-decides the same users, so selection is unchanged; at L0 (Story 12.7) an in-memory fake returns facts without the SQL and the policy is authoritative.
- **QA cohort membership is a per-user fact** (`inQaCadenceCohort`), computed in SQL from the tenant's `qaThreePerDayCohortId` cohort roster and period; the QA intervals live in config (`qaCadence { silenceHours: 2, gapHours: 4, maxPerDay: 3 }` defaults).
- Policy boundaries match SQL `occurred_at > now() - interval`: an event exactly `interval` before `now` no longer blocks; the 24 h count window is `(now - 24h, now]`.
- `lastProactiveContactAt` counts outbound `proactive_check_in`, `proactive_follow_up`, `reminder` and inbound system `proactive_check_in_request`, as the SQL gap clause does; `lastInboundAt` ignores `__init__`; `recentProactiveCount` and `hasUnansweredProactive` count outbound proactive types only.
- The policy reads time only from its `now` argument.

**Never:**
- Change which users the production scan selects or enqueues.
- Change env vars, `@entalent/config`, the database schema or migrations.
- Remove or weaken existing scheduler, repository or processor tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default eligible | not QA; last inbound and last contact exactly `minSilenceDays` / `minCheckInGapDays` before now | eligible | N/A |
| Recent inbound | not QA; last inbound 1 ms inside the silence window | ineligible `recent-inbound` | N/A |
| Recent contact | not QA; last proactive contact 1 ms inside the gap window | ineligible `recent-proactive` | N/A |
| Never contacted | not QA; `lastInboundAt` and `lastProactiveContactAt` null | eligible | N/A |
| QA silence/gap | QA; last inbound exactly 2 h before / contact exactly 4 h before | eligible | N/A |
| QA daily cap | QA; `recentProactiveCount` 3 | ineligible `qa-daily-cap` | N/A |
| QA unanswered | QA; `hasUnansweredProactive` true | ineligible `qa-unanswered` | N/A |
| Non-QA ignores QA guards | not QA; count 5, unanswered true, silence and gap satisfied | eligible | N/A |
| Use case skip | a candidate the policy rejects | not enqueued; `skippedCadence` 1; quiet hours not consulted for it | N/A |

</frozen-after-approval>

## Code Map

- `apps/worker/src/proactive/proactive-scheduler.repository.ts:35-127` -- SQL predicate to mirror. Keep the WHERE clause and LIMIT byte-for-byte; add fact columns to the SELECT (`last_inbound_at`, `last_proactive_contact_at`, `recent_proactive_count`, `has_unanswered_proactive`, `in_qa_cadence_cohort`) computed with the same message filters, and map them into `CheckInCandidate.cadence`.
- `apps/worker/src/proactive/proactive-scheduler.repository.test.ts` -- static source assertions (keep all) plus a DB suite skipped without a local `DATABASE_URL`; add a static assertion that the facts are selected and a DB assertion that facts come back when the DB is available.
- `packages/application/src/ports/proactive-scheduler.repository.port.ts` -- `CheckInCandidate`; add `cadence: CheckInCadenceFacts` (timestamps as `Date | null`).
- `packages/application/src/use-cases/proactive-scheduler.use-case.ts` -- apply the policy with `this.clock.now()` before `isInQuietHours`; add `skippedCadence` to `ProactiveScanResult`; `ProactiveScanConfig` gains `qaCadence` with defaults.
- `packages/application/src/use-cases/proactive-scheduler.test.ts` -- `makeCandidate` gets eligible default facts; existing expectations stay.
- `packages/application/src/index.ts` -- export the policy, its types and defaults.
- `apps/worker/src/proactive/proactive-scheduler.module.ts` -- no change needed (config defaults cover `qaCadence`).
- `packages/application/src/ports/clock.port.ts` -- `ClockPort` from 12.5.

## Tasks & Acceptance

**Execution:**
- [x] `packages/application/src/policies/check-in-cadence.ts` -- `CheckInCadenceFacts { lastInboundAt, lastProactiveContactAt, recentProactiveCount, hasUnansweredProactive, inQaCadenceCohort }`, `CheckInCadenceConfig { minSilenceDays, minCheckInGapDays, qaCadence }`, `DEFAULT_QA_CADENCE`, and `checkInCadencePolicy(facts, config, now)` returning `{ eligible: true } | { eligible: false, reason: 'recent-inbound' | 'recent-proactive' | 'qa-daily-cap' | 'qa-unanswered' }`.
- [x] `packages/application/src/policies/check-in-cadence.test.ts` -- every matrix policy row, each at its boundary instant and 1 ms inside.
- [x] Port, use case, use-case test, index -- per Code Map; add use-case tests for `skippedCadence` (matrix "Use case skip") and that the policy receives `clock.now()`.
- [x] Repository and its test -- per Code Map.

**Acceptance Criteria:**
- Given the existing fixtures in `proactive-scheduler.test.ts`, when the tests run, then the same users are enqueued as before (default facts are eligible).
- Given `pnpm --filter @entalent/application test` and `pnpm --filter @entalent/worker test`, when they run, then they pass with tests extended, not weakened.
- Given the repository source, when the static test reads it, then every pre-existing SQL assertion still holds (prefilter unchanged).

## Implementation Notes

- Epic context reused from the cache although unrelated onboarding-v2 planning files are newer; nothing in them concerns Epic 12.
- The SQL facts use Postgres `now()` like the prefilter; the policy uses `clock.now()`. In production both are the scan instant within milliseconds.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 30 findings — high 0, medium 7, low 16, false 3, maybe-false 4
- findings:
  - `[maybe-false]` `[defer]` (intent a) DB `now()` vs worker `clock.now()` can change selection near a boundary — the policy runs after the query returns, so its `now` is normally later (more permissive); a rejection only defers the user to the next scan and now shows in the `skippedCadence` log; settle with production logs.
  - `[medium]` `[patch]` (intent b) QA constants hardcoded in SQL, configurable in the policy — patched: `qaCadence` JSDoc says overrides can only tighten; SQL untouched by option (a).
  - `[medium]` `[patch]` (intent c) SQL facts for QA cohort, recent count and `proactive_check_in_request` have no DB coverage — patched: DB suite extended (runs in CI).
  - `[low]` `[reject]` (intent d) a tightening SQL regression stays invisible at L0 — inherent to the user's option (a).
  - `[low]` `[patch]` (intent e) `skippedCadence` not logged — patched processor log and mocks.
  - `[false]` `[reject]` (intent f) matrix wording vs fixture values — auditor found no conflict.
  - `[medium]` `[patch]` (blind) looser `qaCadence` silently ineffective — same root as intent b.
  - `[low]` `[patch]` (blind) `skippedCadence` never surfaced — same as intent e.
  - `[maybe-false]` `[defer]` (blind) clock skew changes production selection — same as intent a.
  - `[low]` `[reject]` (blind) `recent_proactive_count` and `has_unanswered_proactive` are relative to DB `now()` — the spec chose DB-computed facts; the 12.7 fake computes them from its clock.
  - `[medium]` `[patch]` (blind) DB test cannot catch regressions in new columns — same as intent c.
  - `[low]` `[reject]` (blind) proactive type list duplicated five times — extracting fragments would change the WHERE text that option (a) keeps byte-for-byte.
  - `[low]` `[reject]` (blind) static test pins formatting — the DB suite now checks behavior.
  - `[low]` `[patch]` (blind) reason precedence untested — patched: precedence test.
  - `[low]` `[patch]` (blind) `clock.now()` read twice per candidate — patched: one `now` per scan.
  - `[low]` `[reject]` (blind) "quiet hours not consulted" checked indirectly — `skippedQuietHours` 0 on a rejected candidate already pins the order.
  - `[low]` `[reject]` (blind) spec base / unchecked boxes / stale line range — spec bookkeeping, fixed at finalize.
  - `[low]` `[reject]` (blind) query cost of correlated subqueries — they run only for the ≤ `batchLimit` (50) rows the unchanged prefilter returns.
  - `[medium]` `[patch]` (verification) QA-cohort / recent-count / contact-request facts never checked on a DB — same as intent c.
  - `[maybe-false]` `[defer]` (verification) clock skew — same as intent a.
  - `[medium]` `[patch]` (verification) QA intervals not enforced from config — same as intent b.
  - `[low]` `[patch]` (verification) `skippedCadence` not logged — same as intent e.
  - `[medium]` `[patch]` (edge) looser `qaCadence` has no effect — same as intent b.
  - `[maybe-false]` `[defer]` (edge) worker clock behind DB rejects SQL-accepted users — same as intent a.
  - `[low]` `[patch]` (edge) Invalid Date from the driver fails open — patched: mapping throws.
  - `[low]` `[reject]` (edge) NaN facts from a non-SQL source fail open — the only production source is the repository mapping, now guarded; the 12.7 fake builds Dates.
  - `[low]` `[patch]` (edge) processor log omits `skippedCadence` — same as intent e.
  - `[false]` `[reject]` (edge) SQL count has no upper bound, unlike `(now-24h, now]` — messages are written at their send time; a future-dated message cannot exist in production.
  - `[false]` `[reject]` (edge) claim "selection unchanged" — restated clock-skew finding; logged above.
  - `[low]` `[patch]` (edge) claim "QA intervals live in config" — same as intent b.

## Verification

**Commands:**
- `pnpm --filter @entalent/application build && pnpm --filter @entalent/application test` -- expected: pass.
- `pnpm --filter @entalent/worker test` -- expected: pass.
- `pnpm typecheck` and `pnpm lint` -- expected: no errors.
- `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` -- expected: a passing receipt.

## Auto Run Result

**Summary:** `checkInCadencePolicy(facts, config, now)` in `packages/application/src/policies/check-in-cadence.ts` reproduces the worker SQL cadence predicate (silence, gap, QA 2 h / 4 h / 3 per 24 h, unanswered guard). Per option (a) the SQL prefilter and `LIMIT` are unchanged; the repository also selects five per-user facts, and `ProactiveSchedulerUseCase` applies the policy at one scan instant from `clock.now()` before quiet hours and reports `skippedCadence`.

**Files changed:**
- `packages/application/src/policies/check-in-cadence.ts` / `.test.ts` -- policy, types, `DEFAULT_QA_CADENCE`; boundary and precedence tests.
- `packages/application/src/ports/proactive-scheduler.repository.port.ts` -- `CheckInCandidate.cadence`.
- `packages/application/src/use-cases/proactive-scheduler.use-case.ts` / `proactive-scheduler.test.ts` -- policy before quiet hours, `skippedCadence`, `qaCadence` (tighten-only), one `now` per scan.
- `packages/application/src/index.ts` -- exports.
- `apps/worker/src/proactive/proactive-scheduler.repository.ts` / `.test.ts` -- fact columns (WHERE and LIMIT unchanged), strict timestamp mapping; static and PostgreSQL tests.
- `apps/worker/src/proactive/proactive-scan.processor.ts` / `.test.ts` -- `skippedCadence` in the scan log.
- `.eslintrc.cjs` -- policy file added to the zero-arg `Date` ban.

**Review:** one pass, 30 findings: 2 medium and 4 low groups patched, 1 deferred (DB vs worker clock), the rest rejected with reasons in the triage log.

**Follow-up review recommended: true** -- two medium entries were patched (tighten-only `qaCadence`, PostgreSQL fact coverage), and the PostgreSQL suite has not run yet.

**Verification:** application 63 files / 1138 tests; worker 388 passed, 104 skipped (PostgreSQL suites: no local `DATABASE_URL`; migrating a fresh local DB was held by the Blast Radius hook); `pnpm typecheck`, `pnpm lint` 24/24; `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` passed (receipt `runs/harness/receipt-1792922737099-8ec190d8.json`).

**Residual risks:** the new SQL fact columns and their PostgreSQL tests first run in CI (`ci.yml` sets a local `DATABASE_URL`) or on a local DB; the deferred clock-skew item.

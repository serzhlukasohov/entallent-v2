---
title: 'RPT-10: Native report lifecycle registration with default-off audited activation controls'
type: 'feature'
created: '2026-10-31'
status: 'done'
review_loop_iteration: 0
baseline_commit: 237d7075ff08f262ccf3cbe2bf7c36cb390d204e
context:
  - '{project-root}/_bmad-output/planning-artifacts/pulse-check-reports/PRODUCTION-BLOCKERS-PLAN.md'
  - '{project-root}/_bmad-output/planning-artifacts/pulse-check-reports/RPT-08-DESIGN.md'
  - '{project-root}/docs/pulse-report-cutover-operations.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** The native lifecycle scheduler and processor exist only as test-constructed classes with `enabled=false`; no queue, processor binding or recurring scan is registered, so a deployed worker can never form or deliver native reports (gate G04).

**Approach:** Register the `pulse-report-lifecycle` queue, a BullMQ processor and a recurring scan in the worker, behind two independent locks: a process kill switch (env, default off) and per-tenant, per-scope activation controls in PostgreSQL with modes `off | observe | deliver`, approved recipients, expiry and an append-only audit trail, changed only by an operator script.

## Boundaries & Constraints

**Always:** Default is inert: with no env opt-in or no control rows, the worker registers the queue but schedules nothing, forms nothing and sends nothing. `observe` discovers, observes and forms snapshots (this includes narrative model calls) but never sends. `deliver` additionally sends, only for an allowlisted scope whose frozen recipient equals the approved recipient and only before the control's expiry; otherwise the snapshot is held, not cancelled or consumed. Re-check the control when each job executes, not only when it is enqueued. Control changes use revision compare-and-set and write the audit event in the same transaction, with operator, approval reference and before/after state. Existing lifecycle, delivery and reconciliation semantics, locks and receipts stay unchanged.

**Ask First:** Running the activation script against any non-local database; setting any tenant to `observe` or `deliver` outside tests; coexistence or cutover with the pilot V2 report path for the same tenant; an admin API or dashboard surface for controls; changing preserved files `pulse-report-connected.integration.test.ts` or `pulse-report-lifecycle-queue.integration.test.ts`; Railway variables; commits/push/PR.

**Never:** Activation through `feature_flags`, constructor booleans or env alone; a default that allows delivery; retargeting a snapshot to a different recipient; automatic resend or clearing of `delivery_unknown`; deleting held snapshots or audit rows; modifying applied migrations 0000–0099 or retired MAF.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Inert default | Env off, or env on with no control rows | Queue registered; no repeatable scan, or scan returns zero work; no model or Slack call | N/A |
| Observe | Env on, tenant `observe`, scope allowlisted | Obligations and snapshots formed; zero send attempts | Formation failures follow existing defer/repair |
| Deliver | `deliver`, frozen recipient = approved, before expiry | Existing delivery path sends and records receipts | Existing unknown/reconciliation rules |
| Recipient mismatch or expired | `deliver` but recipient differs, or expiry passed | Snapshot held as `snapshot_ready`; typed hold reason; no attempt row | Visible in script `show` |
| Switch off mid-queue | Job enqueued under `deliver`, control set `off` before execution | Job no-ops with `held`; nothing consumed | In-flight provider call already started is not interrupted |
| Unlisted tenant/scope | Opened cycle for a tenant without controls | Not observed, formed or sent | N/A |
| Concurrent control edits | Two operators, same revision | One commits, other fails with revision conflict; one audit event | No partial state |

</frozen-after-approval>

## Code Map

- `apps/worker/src/survey/pulse-report-lifecycle.scheduler.ts`, `pulse-report-lifecycle.processor.ts` -- current callable drivers (`enabled=false`, no registration).
- `apps/worker/src/survey/repositories/pulse-report-lifecycle.repository.ts` -- `discover`/`observe`/`repair`; fair cursors across all opened scopes.
- `apps/worker/src/survey/repositories/pulse-report-delivery.repository.ts` -- `deliverNext` -> `claim` -> `dispatch`; frozen recipient binding and `authorize`.
- `apps/worker/src/survey/survey.module.ts`, `apps/worker/src/proactive/proactive-scan.processor.ts` -- module wiring and the repeatable-job registration pattern.
- `packages/contracts/src/queue.ts`, `pulse-report-delivery.ts` -- lifecycle queue name and job schema.
- `packages/config/src/env.ts` -- worker env schema for the kill switch and scan interval.
- `scripts/open-survey-reporting-cycle.ts` -- existing guarded operator-script pattern.

## Tasks & Acceptance

**Execution:**
- [x] `packages/database/src/schema/pulse-report-activation.ts`, generated migration 0100 -- `pulse_report_activation_controls` (tenant, mode, revision, approval reference, expiry), `pulse_report_activation_scopes` (tenant, org unit, nullable org team, scope kind, approved recipient person), append-only `pulse_report_activation_events` with an update/delete guard trigger.
- [x] `packages/application/src/ports/pulse-report-activation.port.ts`, `use-cases/pulse-report-activation-policy.ts` -- pure decision `{ observe, deliver, holdReason }` from control, scope, frozen recipient and DB time.
- [x] `apps/worker/src/survey/repositories/pulse-report-activation.repository.ts` -- tenant/scope filter for discovery and repair pages, per-job decision read; optional filter parameters on the existing lifecycle repository queries keep current callers unchanged.
- [x] `apps/worker/src/survey/pulse-report-lifecycle.worker.ts`, `survey.module.ts`, `packages/config/src/env.ts` -- register queue and processor; `PULSE_REPORTS_ENABLED` (default false) and `PULSE_REPORT_SCAN_INTERVAL_SEC` (default 60); register the repeatable scan only when enabled and remove it on boot when disabled; production wiring always passes the activation gate.
- [x] `scripts/pulse-report-activation.ts` and test -- `show` (controls, scopes, held snapshots) and `set` with dry-run default, `--confirm`, required approval reference and expected revision; refuses `deliver` without an expiry and approved recipients.
- [x] Tests for every matrix row, a module-boot test proving inert defaults, and a migrated PostgreSQL + Redis integration through the registered processor.
- [x] `docs/pulse-report-cutover-operations.md` -- activation, hold and rollback runbook.

**Acceptance Criteria:**
- Given a fresh migrated database and default env, when the worker module boots and runs for one scan interval, then no obligation, snapshot, attempt, model or Slack call exists.
- Given `deliver` for one scope and `observe` for its parent, when both finals form, then only the allowlisted scope's recipient receives a send and the other snapshot is held.
- Given a held snapshot, when the operator later sets `deliver` with the matching recipient, then the same frozen bytes send once.

## Design Notes

A dedicated table instead of `feature_flags`: flags have no scope, recipient, expiry or audit, and a missing row must mean "off". Gating in the production driver plus optional query filters keeps the RPT-07/08 test constructors and the two preserved legacy fixtures byte-identical. Holding instead of cancelling keeps frozen snapshots valid for a later approved `deliver`; the RPT-07 fences still cancel them if inputs or recipients change.

## Verification

**Commands:**
- `pnpm --filter './packages/*' build`; application, contracts, worker and scripts tests -- pass.
- `pnpm db:generate` on an owned database, review 0100 SQL; new and affected database integration suites on owned PostgreSQL 55460 and Redis 56460 after harness preflight -- pass, zero skips in new suites.
- `pnpm reports:acceptance --mode local-synthetic` with a new run id and new owned targets -- exit 0; refreshes source-bound RPT-08 evidence for RPT-09 and RPT-10 source.
- `pnpm typecheck`, `pnpm lint`, `pnpm harness:check -- --base 237d7075ff08f262ccf3cbe2bf7c36cb390d204e` on a migrated owned database -- exit 0 with receipt.

## Implementation and verification evidence — 2026-10-31

Implemented locally after `[A]`; frozen intent unchanged. Step04 Blind Hunter and Edge Case Hunter: 16 patches (Q1–Q16) applied, one deferred, five rejected (`runs/rpt-10/step04-triage.json`). A bounded independent recheck closed Q1–Q16 and found one new defect (scan-side fence could escalate a live attempt across replicas); fixed with a 120 s DB-clock bound and a DB-backed test (R1), plus a pre-enable inventory runbook step (R2). Exact delta: `runs/rpt-10/implementation-review-delta-corrected.patch`.

- Targeted: application 1381, contracts 151, worker 453 (+107 env-gated skips), worker focused 22, scripts non-MAF pass, activation integration 10/10 zero skips (PG + Redis), reconcile 2/2, typecheck 24/24, lint 24/24.
- Human-approved narrow acceptance change: the RPT-08 migration fixture now byte-pins 0000–0098 (journal prefix, SQL hashes, 0091/0098 snapshots) and accepts only append-only later migrations; ledger counts derive from the manifest. Tamper of a 0050 byte or a 0095 journal `when` still fails `protected_migration_pin_changed_journal`.
- Official harness attempt1 (`runs/harness/receipt-1793451793670-b1719bb1.json`, pre-fixture-change source): typecheck/lint passed; test failed only on two `pulse-report-delivery` R3 real-clock cases. The same file passed 39/39 on RPT-10 source at load ~12–18.
- Strict bundle: `rpt10a` failed on the journal pin (fixed above); `rpt10b` (load up to 78) failed 2/193 and `rpt10c` (load ~40) failed 10/193 in regression lane 3, all `survey_insight_v2_cycle_activation_after_start` / `stage failed` short-window successor fixtures in RPT-07 delivery/presentation tests. Migration, fresh-migrate and regression lanes 0–2 passed. No fresh zero-skip strict pass exists for this source; G01 evidence remains tied to the final8 source.
- Status stays `in-review`: the spec's strict-bundle verification is not satisfied. Closing it needs the open RPT-07 short-window fixture fix (reserve successor before real start) or a low-load rerun.

## Closure evidence — 2026-10-31 (after the RPT-07 fixture fix)

- RPT-07/RPT-06 real-clock fixtures fixed in test files only (DB-clock cycle anchor inside the insert, successor chain reserved right after the base insert, `SHORT_WINDOW_DAYS = 10/86400`, raised timeouts); no guard, trigger or migration changed.
- `pulse-report-delivery.integration.test.ts`: three consecutive isolated runs on fresh owned `entalent_rpt10_fx1`, 39/39 each at load 18–32 (`runs/rpt-10/delivery-verify-run{1,2,3}.log`).
- Fresh strict bundle `20261031_rpt10d` (new empty databases, new owned Redis 127.0.0.1:56464/15, source `fd12fa6c…b756667`): `status=passed`, `pilotEligibility=blocked`, `activationExecuted=false`; 822 executed tests, 0 failed, 0 skipped; migration ledger 101 (prefix 92). Output `runs/rpt-08/acceptance-20261031-rpt10d/`.
- Official harness on a freshly migrated owned database: `status=passed`, receipt `runs/harness/receipt-1793470751971-d38c7fe4.json` (245 passed, 20 env-gated skips in the default PostgreSQL-only profile).
- Residual, not blocking local closure: "R3 selected prior near-expiry" retention oracle made DB-clock-relative with human approval (15 s headroom after the update; oracle reads the actual tenant retention); 3/3 under synthetic load, delivery 39/39, harness receipt `runs/harness/receipt-1793476391091-d3cd5bb9.json`. Human decision 2026-10-31: confirmed — a mid-multipart hold stops further parts (`partial_delivery_held`, visible to the operator) and resumes after receipts on re-enable.

## Suggested Review Order

**Activation gate (entry point)**

- Production driver refuses to construct without the activation gate; every job re-decides at execution.
  [`pulse-report-lifecycle.worker.ts:37`](../../apps/worker/src/survey/pulse-report-lifecycle.worker.ts#L37)

- Per-job decision read from DB, not trusted from enqueue time.
  [`pulse-report-lifecycle.worker.ts:71`](../../apps/worker/src/survey/pulse-report-lifecycle.worker.ts#L71)

- Pure policy: control, scope, frozen recipient, DB time → observe/deliver/holdReason.
  [`pulse-report-activation-policy.ts:30`](../../packages/application/src/use-cases/pulse-report-activation-policy.ts#L30)

- Mid-multipart hold surfaces as `partial_delivery_held` (needs human confirmation).
  [`pulse-report-activation-policy.ts:33`](../../packages/application/src/use-cases/pulse-report-activation-policy.ts#L33)

**Kill switch and registration**

- Processor registered with `autorun:false`; env kill switch decides whether the worker runs.
  [`pulse-report-lifecycle.worker.ts:121`](../../apps/worker/src/survey/pulse-report-lifecycle.worker.ts#L121)

- Disabled boot removes the repeatable scan; enabled boot upserts it.
  [`pulse-report-lifecycle.worker.ts:142`](../../apps/worker/src/survey/pulse-report-lifecycle.worker.ts#L142)

- Default-off env flag and scan interval.
  [`env.ts:67`](../../packages/config/src/env.ts#L67)

- Module wiring of queue and production driver.
  [`survey.module.ts:38`](../../apps/worker/src/survey/survey.module.ts#L38)

**Delivery guard and fences**

- Guard runs after RPT-07 fences inside the claim transaction; a hold consumes nothing.
  [`pulse-report-delivery.repository.ts:200`](../../apps/worker/src/survey/repositories/pulse-report-delivery.repository.ts#L200)

- Scan-side fence never escalates a live attempt younger than 120 s (DB clock).
  [`pulse-report-delivery.repository.ts:161`](../../apps/worker/src/survey/repositories/pulse-report-delivery.repository.ts#L161)

- Optional scope filter keeps existing lifecycle callers byte-compatible.
  [`pulse-report-lifecycle.repository.ts:30`](../../apps/worker/src/survey/repositories/pulse-report-lifecycle.repository.ts#L30)

**Controls storage and audit**

- Decision and guard reads; revision compare-and-set with audit in the same transaction.
  [`pulse-report-activation.repository.ts:50`](../../apps/worker/src/survey/repositories/pulse-report-activation.repository.ts#L50)

- Append-only audit (update/delete/truncate blocked).
  [`0100_pulse-report-activation.sql:63`](../../packages/database/migrations/0100_pulse-report-activation.sql#L63)

- Recipient erasure is audited and bumps the revision.
  [`0100_pulse-report-activation.sql:100`](../../packages/database/migrations/0100_pulse-report-activation.sql#L100)

**Operator script and runbook**

- Dry-run by default; `--confirm`, approval reference and expected revision required.
  [`pulse-report-activation.ts:29`](../../scripts/pulse-report-activation.ts#L29)

- Activation, hold and rollback runbook.
  [`pulse-report-cutover-operations.md:203`](../../docs/pulse-report-cutover-operations.md#L203)

**Tests and acceptance tooling**

- Matrix rows against migrated PostgreSQL + Redis.
  [`pulse-report-activation.integration.test.ts:55`](../../packages/database/src/__tests__/pulse-report-activation.integration.test.ts#L55)

- Mandatory-gate driver unit tests.
  [`pulse-report-lifecycle.worker.test.ts:45`](../../apps/worker/src/survey/pulse-report-lifecycle.worker.test.ts#L45)

- Approved narrow change: byte-pin 0000–0098, append-only later migrations.
  [`pulse-report-migration-acceptance.fixture.ts:208`](../../packages/database/src/__tests__/pulse-report-migration-acceptance.fixture.ts#L208)

- Load-robust fixture: DB-clock cycle anchor and early successor reservation.
  [`pulse-report-inputs.fixture.ts:40`](../../packages/database/src/__tests__/pulse-report-inputs.fixture.ts#L40)

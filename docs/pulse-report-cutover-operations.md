# Pulse report local acceptance and controlled cutover

## Execution order and native test evidence

The strict runner builds shared packages, executes its pure guards, and runs genuine old-schema/fresh-install acceptance while its migration targets are pristine. It then verifies the fresh migration idempotently and runs every selected lower regression before the real-calendar connected/restart lanes. The migration lane owns the original empty fresh-schema precondition; lower regressions consume that migrated target afterward. It checks all required companion test identities before starting those waits. Preparation results alone do not satisfy connected acceptance.

The channel-slack package uses native `node:test`. Its two exact selected files execute with a separate `rpt08-node-test-report-v1` reporter; it never reports a Vitest execution. The reader requires actual terminal aggregate and per-file counts, exact canonical file/full test names, unique identities, and zero failed, cancelled, skipped or todo tests. The child must also exit zero. Unknown JSON metadata keys and noncanonical path aliases are rejected before ordinal/identity accounting; the reader explicitly projects only file, full test name, status and ordinal. A task-output CJS shim loads the source reporter through the already installed tsx hook; the source manifest covers both the command builder and reporter source. The shim contains only those source paths. Reporter artifacts retain bounded test metadata and never raw event errors, fixture output, environment values or provider responses.

This reporter was executed on Node 24.20.0. The repository's general Node >=20 requirement does not establish reporter compatibility on every supported runtime. A runtime without the required native terminal summary fails explicitly with `acceptance_native_terminal_summary_unsupported` during short preparation, before the long calendar lanes. No missing event or unavailable test executable counts as a passing test.

RPT-08 is an explicitly invoked local synthetic acceptance exercise. A successful
local bundle does not authorize production registration, model egress, Slack
delivery, deployment, or a new employee cycle.

## Run a new local bundle

Use the authorized `codex/pulse-check-reports` worktree at base
`237d7075ff08f262ccf3cbe2bf7c36cb390d204e`. Build and test from the current
dirty-source manifest; preserve all existing work. Do not create a receipt by
editing a previous successful run.

Provide three new empty local PostgreSQL databases named
`entalent_rpt08_<run-id>_connected`, `entalent_rpt08_<run-id>_fresh`, and
`entalent_rpt08_<run-id>_upgrade`. Redis must be a dedicated local task instance
with an empty database 15. Existing resources and diagnostic data are retained.
The runner rejects foreign inventories; it never flushes Redis or drops a
database. Both named dependencies must pass `pnpm harness:preflight` before any
synthetic connector payload is admitted.

Required explicit inputs:

- `RPT08_LOCAL_ACCEPTANCE=1`;
- `PULSE_ACCEPTANCE_RUN_ID` and matching `CONFIRM_PULSE_ACCEPTANCE_RUN`;
- `RPT08_CONNECTED_DATABASE_URL`, `RPT08_FRESH_DATABASE_URL`,
  `RPT08_UPGRADE_DATABASE_URL`, `RPT08_REDIS_URL`;
- `PULSE_ACCEPTANCE_POSTGRES_TARGET=127.0.0.1:<task-port>` and
  `PULSE_ACCEPTANCE_REDIS_TARGET=127.0.0.1:<task-port>/15`;
- `RPT08_OWNERSHIP_MANIFEST`, an existing file under `runs/rpt-08`.

The ownership manifest has `schemaVersion: rpt08-ownership-v1`, the exact `runId`,
`syntheticOnly: true`, a new 64-character hexadecimal `ownerNonce`, and
`queuePrefix: rpt08-<run-id>-<first-16-nonce-characters>`. Its `targets` object
contains the exact `connected`, `fresh`, `upgrade`, and `redis` URLs in that
order. The nonce and source hash are bound to markers in all three empty
databases and Redis before fixtures run. Source and marker mismatches fail the
exercise. Never place provider credentials in this file.

Invoke `pnpm reports:acceptance --mode local-synthetic --out
runs/rpt-08/<new-run-directory>`. An existing output directory, a `.env` file in
the worktree, a remote/default/shared target, or an unconfirmed run is rejected.
Only a small local environment is passed to children; model/Slack credentials
are stripped. No live provider is constructed.

The runner builds shared outputs, checks its pure guards/readiness validator,
then runs connected, recovery, real old-schema migration, and explicitly
selected lower-level regression lanes. Test JSON reports must show all selected
tests executed, passed, and unskipped. Every required acceptance obligation is
bound to observed test identities and source-bound evidence. A mapping without
execution cannot satisfy an obligation. Child process groups have bounded
deadlines; timeout, cleanup failure, source drift, or incomplete accounting
produces a failed receipt.

The connected calendar and migration tests use actual PostgreSQL clocks. They
may wait for real minute boundaries and non-overlapping cycle ends. Do not
replace these waits with fake clocks, backdates, altered triggers, or persisted
schedule overrides.

## Inspect results

Review `acceptance-bundle.json`, `executed-case-inventory.json`, `readiness.json`,
the pinned migration manifest and guarded-fixture receipt, and the `previews`
directory. Preview files contain synthetic prose and are restricted local
artifacts. JSON receipts contain statuses, test identities, and hashes, not
credentials, environment dumps, private transcripts, SQL parameter values, or
provider output logs.

Compare the four actual immutable renderer variants, localized insufficient
notice, multipart bodies, fallbacks, and hashes. The 720/375-pixel HTML files are
literal-content previews. Desktop/mobile Slack display and accessibility remain
unrun until independently observed in native clients.

The migration result distinguishes actual guarded 0091 schema fixtures,
unchanged 0092–0098 execution, and current-reader/delivery continuation. A
compatible historical application producer has not been supplied:
`historicalProducerExecuted=blocked`, `historicalProducerReason=not_provided`.
No ledger is hand-populated and no previously applied SQL/meta bytes are edited.

## Production prerequisites and human boundary

After independent review and the final pinned-base official harness, local G01
and G02 may pass. The offline validator always retains these separate gates:

1. Implement and accept an explicit authenticated public full/partial reporting
   withdrawal intake. Onboarding stop is not reporting withdrawal.
2. Implement and accept production native scheduler/queue/module registration
   with reviewed default-off tenant/scope controls. Explicit test constructors
   and legacy pilot flags do not provide this proof.
3. Authorize and accept real language-resource preparation and independently
   reviewed multilingual model meaning/privacy/action quality.
4. Authorize synthetic Slack recipients and verify exact routes, frozen parts,
   real receipts, desktop/mobile presentation, and accessibility.
5. Inventory the actual production source/deployment/schema/migration/config
   and target roster. Read `docs/superpowers/railway-deploy.md` before any
   Railway decision. Local migration replay cannot recover data already purged
   by a differently applied historical migration.
6. Obtain an explicit human rollout decision for the exact tenant, scopes,
   recipients, hold/reconciliation owner, and observation window; then perform
   the separately authorized activation and monitor its real result.

Local readiness always records `pilotEligibility=blocked` and
`activationExecuted=false`. Changing a receipt cannot promote an external gate.
Unknown delivery holds the complete logical report. Never automatically resend,
retarget, regenerate, or use archived MAF as a rollback route.

## Evidence interpretation and shutdown

The connected and recovery tests operate on the same normalized-ingress,
PostgreSQL, BullMQ, processor, native formation, and receipt graph. A controlled
model-boundary error is not a terminal report result: the recovery evidence must
show the retained exhausted job, actual shown/agreed receipt, durable native
pending state before due, recreated adapters, and the original immutable cutoff
and report obligation after recovery. A `not_applicable` stage cannot establish
native finalization recovery. Two delivery jobs may race only after the exact
native snapshot is frozen; a defer during a separate formation race is not a
successful publication.

Application-authorized withdrawal is labeled `application_rights_fixture`.
Compare the exact bytes already accepted by the synthetic transport separately
from retained database payload copies. Native source invalidation legitimately
purges private snapshot/part bodies, including delivered copies, while preserving
immutable snapshot/part identities, hashes, attempts, receipts, and delivered
status. Require no resend, retarget, or report recreation after withdrawal,
subject erasure, and retention shortening. This proves application handling;
it supplies no public employee authentication/intake proof.

The migration inventory distinguishes 12 primary outcome names from 16 physical
fixtures: four additional prior-source prerequisites isolate current scenarios.
The receipt lists the actual consumed prior candidate/cycle/snapshot identities.
The unfrozen-cache case must continue through current observation and freezing
under the same obligation/composite key/frontier, with exact tracked source IDs
and content deadline. Narrowed JSON alone does not establish continuation.
Consumed assembly inputs disappear when the snapshot freezes; later evidence
comes from immutable contracts/provenance and native snapshot identity.

Ownership work is bounded before any child lane: a 15-second operation cap,
PostgreSQL statement timeout, forced bounded client ending, and Redis command
timeout plus socket disconnection. Fixture cleanup attempts every owned closer
under a 12-second deadline. A cleanup-failure marker causes the runner to stop
the owned process group, escalating from TERM to KILL; it never converts a
partial run into a pass. Preserve failed receipts and diagnostics.

The final source manifest binds tracked/untracked application, test, script,
and configuration bytes. Ignored `runs/` diagnostics and documented edits under
`docs/` and `_bmad-output/` do not change that source hash. Approved design/matrix,
frozen intent, prior dirty work, SQL/meta hashes, and the journal still have
separate preservation checks and must not be modified to manufacture acceptance.
An implementation-start-relative review delta identifies RPT-08 changes; the
hundreds of preserved starting dirty paths are not a new RPT-08 patch.

Keep the owned local PostgreSQL/Redis services running through independent review
and the final harness. The implementation handoff records their precise PID,
port, data/log/PID-file paths and normal shutdown commands. Shutdown preserves
the data directories; do not drop task databases, flush Redis, or remove failed
runs as part of acceptance cleanup.

The regression child environment explicitly enables both local-only queue fixtures:
`V2_CONVERSATION_QUEUE_TEST=1` for authoritative queue recovery and
`V2_BUNDLE_QUEUE_TEST=1` for delivered-bundle restart. Database-dependent suites
require the explicit selected `DATABASE_URL`; both use the dedicated local Redis
database 15. These fixture switches are not native production registration.
The runner's full JSON inventory must show zero skips in every lane. A filtered
diagnostic run can establish only its executed test, even when Vitest reports
overall success.

## Historical pre-review local run: 20261030_final7

One strict current-source run completed with actual exit 0: 813 unique selected tests passed with zero skips and all 33 local acceptance cases passed. Breakdown: connected 2, restart 2, migration 2, application 566, native channel-slack 26, worker 22, database 193. Source SHA256 is `634dee9d90773da7ad6f71895c786fe25b078b12a2e620eae20d6b6c2f7f9375`. Its acceptance bundle, executed-case inventory, readiness, preflight log and preview manifest are under `runs/rpt-08/acceptance-20261030-final7/`; the bounded consolidated inspection is `runs/rpt-08/final-verification-summary.json`. Independent review and the official pinned-base harness remain pending.

The genuine migration lane ran on pristine old/fresh targets before idempotent fresh migration and all lower regressions; connected/restart then ran without reusing failed-run lane evidence. Failed and cancelled earlier executions and their data remain intact. Preservation proof is `runs/rpt-08/implementation-postrun-preservation.json`: 194 SQL/meta files, 99 journal entries, approved design/matrix and frozen specification intent unchanged. The implementation-start-relative review delta covers 24 paths; the sole additional preexisting-test block exception has exact before/after custody in `runs/rpt-08/lower-fixture-preservation/`.

All ten owned local services remain available through coordinator review and the official harness. `runs/rpt-08/owned-service-inventory.json` records their PostgreSQL/Redis PIDs, ports, data, logs and PID files. Keep all failed-run data; after those gates, stop only recorded owned processes and preserve Redis diagnostic contents with `shutdown save`. The coordinator-only `runs/rpt-08/run-official-harness-final7.py` prepares a minimal explicit environment, reads no `.env`, carries no model/Slack credentials or acceptance opt-ins, and has not been executed as part of this implementation handoff.

This local result leaves `pilotEligibility=blocked` and `activationExecuted=false`. It does not supply public full/partial reporting withdrawal intake, production native registration, real multilingual model acceptance, native Slack-client observation or production-cycle acceptance.


## Reviewed-source local run: 20261030_final8

The fresh complete run actually exited 0 after all eleven independent-review corrections. Source SHA256: `7b18faddb819f29fffa9d078316bf22a631845d53ef0f73b33950bf51d265603`. Coordinator audits independently confirm all 813 unique canonical tests and 33 local cases, zero skips, four variants and all 12 HTML/body/fallback hashes. Evidence is under `runs/rpt-08/acceptance-20261030-final8/`, with `root-acceptance-audit-final8.json` and `root-preview-audit-final8.json`. Final7 is retained as historical evidence for its own source.

The reviewed corrections bind lane/assertion counts, test identities and artifact hashes to trusted expectations; bind the protected migration manifest; require actual next-cycle/native prior-final evidence and unequal question arithmetic; observe qualified raw/transaction SQL; enforce ordered cleanup, bounded signal cancellation, real filesystem containment and a safe UTC fixture-calendar boundary. Both final independent bounded rechecks found no remaining concrete defect. A failed diagnostic SQL join and its separate successful correction are retained, never combined into full acceptance.

Final workspace checks and the official pinned-base harness are still pending. The prepared coordinator launcher is `runs/rpt-08/run-official-harness-final8.py`; it requires the completed final8 coordinator audit and passes only explicit synthetic local targets with a minimal environment. It imports no `.env`, model/Slack credentials or strict acceptance opt-ins. All 13 verified owned local services remain available until final checks; failed-run data and logs are retained. Pilot eligibility remains blocked; activation is false. The production prerequisites above still apply in full.


## Official default gate and remaining local limitation

The exact pinned-base official command completed with actual exit0 under the independent-reviewed default PostgreSQL-only profile: `runs/harness/receipt-1793399354824-e58f8f26.json`. All four structured checks passed; model evaluations remain not run. This receipt supplements, and does not replace, strict final8's813/33 zero-skip source-bound native acceptance.

The two earlier failed receipts and distinct logs remain intact. Attempt1 lacked three ignored Vitest executable links; version-probed links were restored to the existing installation with all1252 source hashes unchanged. Attempt2 encountered two preexisting RPT07 tests requiring the different fixed port56385; its guards rejected owned56397 before Redis activity. Neither guard nor the other Redis was changed. The default profile omits optional Redis configuration and V2 queue opt-ins, adding nine conditional skips. Seven were separately passed on the same source; two fixed-port legacy behaviors remain unverified. Exact paths/counts and prior proof are in `runs/rpt-08/official-profile-skip-audit.json`. Preserve a nonzero broad local verification remainder (estimated5%) for that limitation. Any portable-target source fix requires an explicit preservation-scope exception and native verification; do not manufacture a pass by weakening ownership.

All required RPT08 assertions are complete, while broader local verification and production remain separate. Production-path remainder is roughly35–45% with low confidence; public authenticated rights intake, native production registration and real semantic/language/privacy/Slack-client/inventory/activation gates still apply. Actual owned-service lifecycle and retained data are recorded by `runs/rpt-08/owned-service-inventory.json` and the coordinator service receipt.

## Native activation, hold and rollback (RPT-10)

The worker registers the `pulse-report-lifecycle` queue and its processor, but two independent locks must both allow work:

1. Process kill switch `PULSE_REPORTS_ENABLED` (default `false`). When false, the BullMQ worker is not started (queued jobs stay in Redis untouched), boot removes the `pulse-report-lifecycle-scan` job scheduler with a bounded 5 s attempt (a Redis failure is logged, not fatal), and any job processed anyway returns `disabled`. When true, the scan repeats every `PULSE_REPORT_SCAN_INTERVAL_SEC` seconds (default 60). Changing Railway variables needs separate human approval.
2. PostgreSQL controls per tenant (`pulse_report_activation_controls`: `off | observe | deliver`, revision, approval reference, expiry) and per durable scope (`pulse_report_activation_scopes`: kind, org unit, optional org team, optional approved recipient person of the same tenant). A missing control row means off. Erasing an approved person sets that recipient to null (the scope row stays, the scope becomes observe-only), bumps the control revision and writes a `system:recipient_erased` audit event. `feature_flags`, constructor booleans and env alone never activate reports.

Semantics, decided at DB clock and re-read when each job executes (not only when enqueued):

- Discovery and formation-phase repair contain only scopes of tenants in `observe`/`deliver` with an unexpired control and an allowlisted scope; unlisted tenants and scopes are never observed, formed or sent. Delivery-phase obligations (a snapshot exists) always page, so RPT-07 recovery and fences keep running for off or expired tenants; held ones are never enqueued as jobs.
- `observe` forms obligations and snapshots, including narrative model calls, and never sends.
- `deliver` sends only when the snapshot's frozen recipient person equals the scope's approved recipient and the control has not expired. A scope without an approved recipient stays observe-only. An expired control stops formation and delivery for the tenant.
- Anything else is a hold: no attempt row is created and no grant is consumed. The RPT-07 claim fences still run first on held snapshots (each scan and each held job): a changed recipient binding or invalid inputs cancel, an abandoned attempt escalates to reconciliation. The activation guard runs after those fences, immediately before the attempt row, under a share lock on the control row, and compares the recipient of the artifact actually being dispatched. If the control is switched off after a claim but before the provider call, the attempt closes as `definitely_not_sent` (`activation_held`, immediately retryable) without a provider call or reconciliation; a later approved deliver sends that part once. A provider call that already started is not interrupted.
- Hold reasons: `no_control`, `control_off`, `control_expired`, `scope_not_allowlisted`, `observe_only`, `deliver_expiry_missing`, `recipient_not_approved`, `snapshot_missing` (also for purged or expired snapshots), `recipient_mismatch`, `obligation_missing`, and `partial_delivery_held`.
- `partial_delivery_held` means some parts of a multipart report already have receipts when delivery stopped (off, expiry, recipient change). The recipient holds a truncated report until re-enabled; re-enabling resumes strictly after the existing receipts, each remaining part once. `show` lists these separately under `partialDeliveryHeld`; treat them as an operator follow-up, not an ordinary hold. RPT-07 fences still cancel a snapshot whose inputs or recipient authority changed; a hold never retargets.

Operator script (never loads `.env`; refuses a non-local `DATABASE_URL` unless `--allow-remote-host` names the same host, which itself needs explicit human approval for that target):

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:55460/<owned_db> pnpm reports:activation show --tenant <tenant-uuid>
DATABASE_URL=... pnpm reports:activation set --tenant <tenant-uuid> --mode observe --expected-revision 0 \
  --approval-reference <ticket> --operator <name> --scope kind=manager_overall,unit=<org-unit-uuid> \
  --scope kind=team,unit=<org-unit-uuid>,team=<org-team-uuid>
# add --confirm to write; without it the command prints the planned before/after only
DATABASE_URL=... pnpm reports:activation set --tenant <tenant-uuid> --mode deliver --expected-revision 1 \
  --expires-at 2026-12-01T18:00:00Z --approval-reference <ticket> --operator <name> \
  --scope kind=team,unit=<org-unit-uuid>,team=<org-team-uuid>,recipient=<approved-person-uuid> --confirm
```

`show` prints the control, scopes, `held` (live undelivered snapshots the current controls would not send, with typed reason) and `partialDeliveryHeld`. `set` declares the complete desired state (scopes are replaced), uses revision compare-and-set, and writes one append-only `pulse_report_activation_events` row (operator, approval reference, before/after) in the same transaction; a stale `--expected-revision` fails with `revision_conflict` and changes nothing. `deliver` is refused without a future `--expires-at` no more than 30 days after the database clock, and without at least one approved recipient. Units, teams and recipients must exist in the tenant; a recipient who is not the scope's current manager/team lead is accepted with a `recipient_not_current_scope_owner` warning. Dry run and confirm both validate against the database clock. UUIDs are normalized to lowercase. A `DATABASE_URL` with an empty host or a `host`/`hostaddr` query parameter is refused unless every target is local or named by `--allow-remote-host`. Exit code 2 marks invalid input or a revision conflict.

Pre-enable inventory (before the first `PULSE_REPORTS_ENABLED=true` in any environment): delivery-phase repair pages native snapshots of all tenants, activated or not, and its fences may cancel stale-authorization snapshots or escalate abandoned attempts to `reconciliation_required`. First run `pnpm reports:activation show --tenant <id>` for every tenant that has native report rows, and a read-only inventory of `survey_report_native_snapshots` (live, purged, expired) and of `survey_report_attempts` in `attempt_started`, `dispatching` or `unknown` across tenants. Resolve or explicitly accept each leftover row (reconcile `unknown` only through `scripts/reconcile-pulse-report-delivery.ts`) before enabling. A fence pass never escalates an `attempt_started`/`dispatching` attempt younger than 120 s on the database clock (`PULSE_FENCE_ABANDONED_ATTEMPT_MS`), so another process's in-flight claim->dispatch is not disturbed; older ones keep the existing abandoned-attempt escalation.

Sequence: `observe` first, inspect formed snapshots and `show` holds, then `deliver` for named scopes and recipients with a short expiry. A held snapshot later sent under an approved `deliver` keeps its frozen bytes and sends once.

Rollback: `set --mode off` with the current revision (immediate; queued jobs then return `held`), or `PULSE_REPORTS_ENABLED=false` and a worker restart (removes the scan; jobs return `disabled`). Neither deletes held snapshots, receipts or audit rows, and neither clears `delivery_unknown`; reconcile those only through `scripts/reconcile-pulse-report-delivery.ts`. Setting any real tenant to `observe` or `deliver`, and coexistence with the pilot V2 report path for the same tenant, need explicit human approval first.

Deferred: during a rolling deploy with mixed `PULSE_REPORTS_ENABLED` values across replicas, boot order can add or remove the scan scheduler. Railway runs one worker replica today; change the variable only with a full worker restart and confirm the scheduler state afterwards.

## Legacy RPT07 Redis fixtures on an owned target (RPT-08a)

The two former fixed-port suites now run against any explicitly named owned target: set `REDIS_URL=redis://127.0.0.1:<port>/15` and `RPT07_REDIS_TARGET=127.0.0.1:<port>/15` on an empty db 15. The guard claims `rpt07:owner` (NX, nonce, 10-minute TTL), refuses non-loopback, other databases, unnamed targets, non-empty databases and held claims, and on release removes only the suite's own queue keys and its owner key. Redis 127.0.0.1:56385 is never required or touched. Verified on owned 127.0.0.1:56465 with official receipt `runs/harness/receipt-1793477460245-4b1ae190.json`; the 5% legacy-fixture remainder recorded above is closed (`runs/rpt-08a/official-profile-skip-audit-rpt08a.json`).

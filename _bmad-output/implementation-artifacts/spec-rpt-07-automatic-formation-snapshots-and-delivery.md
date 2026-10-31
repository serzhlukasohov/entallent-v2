---
title: 'RPT-07: Automatic immutable reports and controlled delivery'
type: 'feature'
created: '2026-10-28'
status: 'done'
review_loop_iteration: 0
baseline_commit: 237d7075ff08f262ccf3cbe2bf7c36cb390d204e
context:
  - '{project-root}/_bmad-output/planning-artifacts/pulse-check-reports/RPT-07-DESIGN.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** RPT-01–06 can prepare reports but cannot automatically form, persist or safely deliver them. Native completed-final history still lacks a real snapshot producer.

**Approach:** Add one durable lifecycle from automatic eligibility observation through immutable multipart snapshot to receipt-backed delivery. PostgreSQL owns identity, authorization and recovery; queues only execute work.

## Boundaries & Constraints

**Always:** Preserve RPT-01–06 arithmetic, frozen scopes, source proofs, rights, settlement, language and complete packaging. One intermediate per tenant/cycle/audience scope/Index; one final or notice per scope/cycle. Final retries retain the actual first-start cutoff. Persist all bytes, versions, provenance and exact recipient/workspace/DM before sending. Revalidate current and historical sources and exact scope authorization before every part. Published bytes never change. Assembly completion and delivery are distinct.

**Ask First:** Production/activation, external model/Slack calls, public rights routes, pilot cutover, replacing canceled/attempted snapshots, target changes, or product/language policy changes.

**Never:** Technical failure as insufficient participation; hidden transport retries; automatic resend after ambiguous acceptance; retarget/public fallback; pilot-history promotion; five-changed-person/all-four-Index final gates; archived MAF execution.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Threshold | N=5/6/10; complete=5/5/8; repeated jobs | First eligible observation claims one Index; Manager independent of child eligibility | Ineligible observation consumes nothing |
| Time | Due final; delayed timely processing | One RPT-04 actual cutoff; settle before report/notice | Same-cutoff recovery; record delay honestly |
| Cutoff race | Scheduled due reached before scheduler runs | No new intermediate; previously initiated one may finish unchanged if valid | No backdating or refreshed intermediate frontier |
| Final | Five of 100 Engagement respondents; alternatively four | Full final or one localized notice after settlement | Pending/failed processing blocks both |
| Invalidation | Withdrawal/expiry or binding change during build/between parts | Discard pre-snapshot draft; cancel unsent persisted remainder | No target substitution or automatic snapshot replacement |
| Race/crash | Two owners; worker dies around send | One fenced owner, immutable parts, durable write-ahead attempt | Unknown outcome freezes entire logical delivery |
| Partial | Earlier parts receipted; next definitely unsent | Resume next part only after full revalidation | Unknown requires explicit evidence-backed reconciliation |
| History | TL final and Manager child share candidate | One canonical real-snapshot completion with support edges | Conflicting context blocks; never fabricate history |

</frozen-after-approval>

## Code Map

- `apps/worker/src/survey/pulse-report-slack-assembly.service.ts` — existing build/render seam; no sender.
- `apps/worker/src/survey/repositories/pulse-report-final-schedule.repository.ts` — authoritative due plan and actual first start.
- `apps/worker/src/survey/repositories/pulse-report-presentation.repository.ts` — factor transaction-local current/baseline validation.
- `packages/database/src/schema/survey-report-inputs.ts` — candidate/completion guard; extend using forward migration only.

## Tasks & Acceptance

Implement the full [required design](../planning-artifacts/pulse-check-reports/RPT-07-DESIGN.md), including its ownership map and lock protocol.

**Execution:**

- [x] `packages/contracts/src/pulse-report-delivery.ts`, `queue.ts`, application lifecycle/delivery ports/use cases — explicit states, outcomes, reconciliation and dependency boundaries.
- [x] `packages/database/src/schema/survey-report-delivery.ts`, `pulse-report-publication-state.ts`, forward SQL/meta — unique obligations, immutable snapshots/parts, durable attempts/receipts, guarded real completion FKs and tombstones.
- [x] Worker lifecycle/snapshot/delivery repositories, processor and scheduler from design — fair durable discovery, fenced assembly, atomic validation/persistence, ordered delivery.
- [x] `packages/channel-slack/src/pulse-report-transport.ts`, worker module/assembly wiring — dedicated bounded one-call transport; preserve chat and pilot defaults.
- [x] Mapped source/permission/retention and hierarchy adapters — transactional wakeups, invalidation and cooperating source/route fences.
- [x] Mapped tests and reconciliation script — concurrency, crash matrix, stale owner, rights, history, scheduling, exact route and full multipart recovery.

**Acceptance Criteria:**

- Given committed source changes or lost Redis jobs, when scanners/retries race, then PostgreSQL recovers every eligible obligation without duplicate logical publication or starving later scopes.
- Given immutable snapshots, when concurrent completion changes baseline inventory, then atomic commit/pre-send validation rejects stale comparison rather than silently changing payload.
- Given an eligible final, when snapshot completion commits, then history requires its real native FK and metric floor; delivery failure does not fabricate, duplicate or erase completion.
- Given a send race with source or route mutation, when the per-part publication fence serializes them, then only the authorized ordering sends; positive receipt alone advances delivery.
- Given new wiring with activation disabled, when deterministic tests run, then no provider traffic, pilot cutover or retired runtime selection occurs.

## Spec Change Log

- 2026-10-29: Human explicitly approved the exact reviewed 0093 safe-content predicate correction as a narrow applied-migration exception. Applied bytes match the reviewed SQL; all other protected migrations, journal entries and existing database ledgers remain unchanged. Evidence: `runs/rpt-07/review/approved-0093-exception.json`. Frozen product intent is unchanged.

## Design Notes

This proposal explicitly extends RPT-05's no-transport-lock engineering rule for the final publication fence only: commit write-ahead ownership first, then hold bounded source/route authorization locks across one no-retry send. No locks cross AI, queue or assembly work. Approval includes this narrow design decision; it cannot revoke Slack acceptance already in flight.

Verification after approval: migrated isolated PostgreSQL/named Redis, affected producer/consumer tests, builds/typecheck/lint, independent BMad reviews and `pnpm harness:check -- --base 237d7075ff08f262ccf3cbe2bf7c36cb390d204e`. RPT-LANG, RPT-08 and separately approved live acceptance remain required for activation.


Implementation verification: all six execution tasks and five acceptance criteria are mapped to executed assertions in `runs/rpt-07/acceptance-map.md`. Source-frozen implementation evidence is `runs/rpt-07/implementation-handoff.md`; both independent final rechecks and the post-approval official harness passed.

## Review Corrections

Both independent reviews confirmed five implementation patches; frozen intent is unchanged. Exact scope and regressions: `runs/rpt-07/review/triage.json`.

- [x] R1 — Canonical numeric-only and prior-only erasure closure.
- [x] R2 — Renew fenced computation ownership without losing intermediate identity.
- [x] R3 — Purge assembly copies at actual source expiry.
- [x] R4 — Scrub expired official metrics while preserving latest-cycle tombstones.
- [x] R5 — Remove unused historical scalars from durable copies.

R1–R5 have executed corrective regressions and independent final source rechecks. The human-approved 0093 correction matches the exact reviewed proposal. Fresh actual migrations 0000–0093 pass before 0094, followed by guarded old-format safe/unsafe fixtures and exact-byte fake delivery. Fresh full-chain 0000–0094 ledger hashes match all 95 actual SQL files; existing ledger records were not rewritten.

## Current verification checkpoint

Completed locally on 2026-10-29. Native 41 and worker 31 pass with zero skips; workspace build 13/13, global typecheck/lint 24/24 and full database integration 219/219 pass. Both independent round-four rechecks are clear. The exact reviewed 0093 correction is applied under explicit human approval.

Final post-approval command: `pnpm harness:check -- --base 237d7075ff08f262ccf3cbe2bf7c36cb390d204e`. Full-scope receipt: `runs/harness/receipt-1793272170654-26e06e7c.json`. Fresh chain and ledger evidence: `runs/rpt-07/approved-chain-status.json`, `runs/rpt-07/approved-ledger-status.json`. Consolidated receipt: `runs/rpt-07/current-verification-receipt.json`.

Completion criteria: all six execution tasks, five acceptance criteria and R1–R5 corrections pass local deterministic verification and independent review; the approved migration exception is exact; unrelated changes, other applied migrations and frozen intent remain preserved. Remaining: 0% for local RPT-07. Model/live Slack acceptance, RPT-LANG, RPT-08 and production activation remain separate work. Local fixtures do not prove production upgrade acceptance or restore content previously purged by the original 0093.

BMad Step 5 is complete. Sprint synchronization is skipped because no story key is assigned. No commit, push or PR was created.

## Suggested Review Order

**Lifecycle and ownership**

- Start with the durable lifecycle entry point and its recovery outcomes.
  [pulse-report-lifecycle.processor.ts:15](../../apps/worker/src/survey/pulse-report-lifecycle.processor.ts#L15)

- Claim exact fenced ownership before assembly begins.
  [pulse-report-lifecycle.repository.ts:259](../../apps/worker/src/survey/repositories/pulse-report-lifecycle.repository.ts#L259)

- Keep orchestration independent from persistence and transport adapters.
  [form-pulse-report.use-case.ts:15](../../packages/application/src/use-cases/form-pulse-report.use-case.ts#L15)

**Immutable content and dependency lifetimes**

- Freeze authorized bytes and canonical final support atomically.
  [pulse-report-snapshot.repository.ts:33](../../apps/worker/src/survey/repositories/pulse-report-snapshot.repository.ts#L33)

- Scrub every derived dependency while preserving permitted identity.
  [0092_native_dependency_lifetimes.sql:30](../../packages/database/migrations/0092_native_dependency_lifetimes.sql#L30)

- Preserve harmless historical status metadata through the explicitly approved upgrade correction.
  [0093_native_variant_history_upgrade.sql:11](../../packages/database/migrations/0093_native_variant_history_upgrade.sql#L11)

**Ordered delivery and old-format compatibility**

- Commit write-ahead ownership before attempting any ordered part.
  [pulse-report-delivery.repository.ts:127](../../apps/worker/src/survey/repositories/pulse-report-delivery.repository.ts#L127)

- Revalidate publication under bounded source and route fences.
  [pulse-report-delivery.repository.ts:203](../../apps/worker/src/survey/repositories/pulse-report-delivery.repository.ts#L203)

- Accept only exact harmless extra status keys in preserved old-format packages.
  [pulse-report-presentation.repository.ts:267](../../apps/worker/src/survey/repositories/pulse-report-presentation.repository.ts#L267)

**Supporting adapters, operations and verification**

- Disable hidden retries and bound the dedicated transport call.
  [pulse-report-transport.ts:15](../../packages/channel-slack/src/pulse-report-transport.ts#L15)

- Keep scheduler activation disabled until separately authorized acceptance.
  [pulse-report-lifecycle.scheduler.ts:11](../../apps/worker/src/survey/pulse-report-lifecycle.scheduler.ts#L11)

- Require scoped evidence before reconciling ambiguous delivery.
  [reconcile-pulse-report-delivery.ts:8](../../scripts/reconcile-pulse-report-delivery.ts#L8)

- Read the operational boundaries before any activation or recovery work.
  [pulse-report-delivery-operations.md:1](../../docs/pulse-report-delivery-operations.md#L1)

- Prove prior-only expiry repairs the same current frontier before retention.
  [pulse-report-delivery.integration.test.ts:1195](../../packages/database/src/__tests__/pulse-report-delivery.integration.test.ts#L1195)

- Prove actual old-format safe packages retain and deliver their exact bytes.
  [pulse-report-delivery.integration.test.ts:1499](../../packages/database/src/__tests__/pulse-report-delivery.integration.test.ts#L1499)

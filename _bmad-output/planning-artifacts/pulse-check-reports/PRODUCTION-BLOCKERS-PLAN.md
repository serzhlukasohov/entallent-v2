# Pulse Check Reports — Production Blocker Closure Plan

Created: 2026-10-31. Status: draft for human approval. Source state: worktree `/private/tmp/entalent-pulse-check-reports`, branch `codex/pulse-check-reports`, baseline `237d7075ff08f262ccf3cbe2bf7c36cb390d204e`, verified source hash `7b18faddb819f29fffa9d078316bf22a631845d53ef0f73b33950bf51d265603`.

This plan sequences the readiness gates G03–G11 from [RPT-08-DESIGN.md](RPT-08-DESIGN.md) that keep `pilotEligibility=blocked`. It authorizes nothing: no implementation, Git publication, deployment, live model, Slack call or production activity. Each package below needs its own BMad specification and `[A] Approve`; each external gate needs a separate explicit human authorization naming its target.

## Starting point (verified 2026-10-31)

- RPT-01–08 and RPT-LANG pass locally. RPT-08 final8: 813 unique tests, 33 local cases, zero skips; official default harness receipt `runs/harness/receipt-1793399354824-e58f8f26.json`.
- Two preserved RPT-07 Redis fixtures (`pulse-report-connected.integration.test.ts`, `pulse-report-lifecycle-queue.integration.test.ts`) still require fixed `127.0.0.1:56385/15` and are unverified under the official profile. About 5% of broad local verification remains for them.
- Withdrawal core exists: `WithdrawReportingPermissionUseCase` (application) and `ReportingPermissionRepository` (worker) apply full/partial exclusions, purge working rows, mark revisions withdrawn and cancel unattempted snapshots. **No caller exists outside tests.** The provenance contract requires `verified_subject` or `authorized_internal_rights_request` produced by a trusted adapter.
- Lifecycle drivers exist: `PulseReportLifecycleScheduler.runOnce` and `PulseReportLifecycleProcessor.process`, both constructed with `enabled=false`. No BullMQ queue registration, processor binding or repeatable scan exists. `PULSE_REPORT_LIFECYCLE_QUEUE_NAME` is declared in contracts only.
- Slack interactivity today: signed `block_actions` in API `slack-interaction.ts`, restricted to the `onboarding:*` namespace and DM channels, enqueued to the worker.

## Package and gate sequence

| Order | ID | Gate | Kind | Deliverable | Depends on | Needs |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | RPT-09 | G03 | code, local | Employee reporting-rights intake: explicit Slack DM protocol, durable admission, worker application, confirmation | RPT-02/05/07 core | Spec approval (drafted: [spec-rpt-09](../../implementation-artifacts/spec-rpt-09-employee-reporting-rights-intake.md)) |
| 1 (parallel) | RPT-10 | G04 | code, local | Native production registration: lifecycle queue, processor, repeatable scan, default-off kill switch plus audited tenant/scope activation controls | RPT-07/08 | Separate spec and approval |
| 1 (parallel, small) | RPT-08a | local remainder | test tooling | Make the two legacy fixtures accept an explicitly owned named Redis target without weakening ownership guards | none | Explicit preservation-scope exception for two preserved files, then fresh source-bound proof |
| 2 | EXT-A | G05 + G06 | external | Company-language resource preparation and multilingual (German/Ukrainian/mixed) live model meaning/privacy/action evaluation on safe synthetic data, with independent human review | RPT-09/10 merged locally | Authorization for model egress, budget and reviewers |
| 3 | EXT-B | G07 | external | Native Slack synthetic-recipient acceptance: frozen routes, part hashes, real receipts, desktop/mobile/accessibility observation; includes RPT-09 rights UI in the real client | RPT-09/10, EXT-A | Authorization for a test workspace, recipients and Slack calls |
| 4 | EXT-C | G09 | external, read-first | Production inventory: deployed source, schema/migration watermark, config, roster, recipients; reviewed migration/deploy plan following `docs/superpowers/railway-deploy.md` | Code packages merged to `main` through reviewed PRs | Authorization for read-only production inspection, then separately for deploy/migration |
| 5 | EXT-D | G10 | human decision | Rollout decision: exact tenant, scopes, recipients, reconciliation owner, observation window | EXT-A..C evidence | Named human approver |
| 6 | EXT-E | G11 | operation | Activation through RPT-10 controls (observe first, then deliver), monitored pilot | EXT-D | Separate activation authorization |

Git publication (commit, push, PR) is a prerequisite for EXT-C, since production follows GitHub auto-deploy from `main`. It stays a separate decision; the current dirty tree carries RPT-01–08/LANG work and must be split into reviewable PRs first.

## Why this order

- RPT-09 and RPT-10 are independent code packages with disjoint primary files (API channel + worker rights versus worker lifecycle/module wiring + activation schema). They share the migration journal, so their migrations must be generated sequentially in whichever order they are implemented.
- G03 is a privacy precondition: no real employee cycle that reports to a Team Lead or Manager should start before employees can withdraw. G04 delivers default-off wiring so a deploy cannot start reporting by itself.
- External gates require the final code to exist, because they observe it: model evaluation must use the shipped prompts, Slack-client acceptance must see the shipped rights UI and report payloads, and the production inventory must compare against the reviewed merge.

## Remaining estimate

Production path remains about 35–45% (low confidence): RPT-09 ~10–12%, RPT-10 ~8–10%, RPT-08a ~1%, EXT-A ~6–8%, EXT-B ~4–5%, EXT-C ~4–6%, EXT-D/E ~2–3%. These are scope weights, not calendar commitments.

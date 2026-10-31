---
title: 'RPT-08: Connected local acceptance and honest pilot readiness'
type: 'feature'
created: '2026-10-30'
status: 'done'
review_loop_iteration: 0
baseline_commit: 237d7075ff08f262ccf3cbe2bf7c36cb390d204e
context:
  - '{project-root}/_bmad-output/planning-artifacts/pulse-check-reports/RPT-08-DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/pulse-check-reports/RPT-08-ACCEPTANCE-MATRIX.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** RPT-01–07/LANG pass locally, but subsystem results do not establish a connected employee-to-report path or pilot readiness. Native drivers are unregistered and verified public reporting-withdrawal intake is absent.

**Approach:** Build one explicitly invoked synthetic acceptance bundle joining actual TypeScript ingress, evidence, queues, native formation and delivery receipts. Trace all33 ACs and produce truthful readiness plus four-variant previews; local success must retain mandatory launch blockers.

## Boundaries & Constraints

**Always:** Follow the linked design/matrix and existing source, scoring, rights, clocks and publication contracts. Use dedicated task-owned local PostgreSQL/Redis; clean only resources created by this run. Fake only model/Slack boundaries. Preserve374 starting paths, applied0000–0098 and approved prior intent. Keep deterministic, semantic, native-client and production evidence separate.

**Ask First:** Live provider/Slack calls, public rights UX/adapters, production driver registration or activation, deployment/configuration, historical conversion, commits/push/PR, or altered product semantics.

**Never:** Seed finished report inputs/snapshots in the connected lane; bypass trusted clocks/triggers; duplicate business logic; count skipped/unexecuted cases as pass; infer withdrawal from onboarding stop; label previews as native Slack acceptance; treat local approval as rollout authority; revive MAF.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Connected run | Synthetic linked workforce, native opening and scripted conversations | Actual intermediate/final for both roles, receipts and independent arithmetic | Unexpected provider/queue operation fails |
| Ordering/restart | Timely pending work, duplicate jobs, uncertain send | Same cutoff; no false insufficiency or automatic resend | Preserve durable hold and scoped reconciliation |
| Rights/history | Application-authorized full/partial withdrawal, transfer, expiry | Correct denominator/lineage/retention and immutable delivered bytes | No older-source revival or audience escalation |
| Missing launch proof | Public intake/wiring absent; semantic/client evidence unrun | Local result separate; pilot verdict blocked with explicit reasons | Synthetic receipts cannot unblock |
| Unsafe execution | Missing/foreign targets, failed preflight or incomplete run | No payload before both dependencies pass; failed/blocked receipt | No secret or transcript output |

</frozen-after-approval>

## Code Map

- `apps/api/src/channel/slack-ingest.service.ts`, worker `conversation/conversation.processor.ts`, `survey/survey-evidence.processor.ts` — actual admission and durable evidence flow.
- `apps/worker/src/survey/pulse-report-lifecycle.scheduler.ts`, `pulse-report-lifecycle.processor.ts`, repositories — explicit local driver seam; production registration absent.
- `packages/database/src/__tests__/pulse-report-connected.integration.test.ts`, worker `conversation/v2-conversation-flow.integration.test.ts` — reusable mechanisms, not complete acceptance.
- `scripts/agent-harness.ts`, `packages/channel-slack/src/pulse-report-renderer.ts` — final gate and actual payload rendering.

## Tasks & Acceptance

**Execution:**
- [x] `packages/contracts/src/pulse-report-acceptance.ts`, `index.ts` — define strict case/evidence/readiness statuses and mandatory blocked dependencies.
- [x] `packages/database/src/__tests__/pulse-report-acceptance.fixture.ts`, `pulse-report-connected-acceptance.integration.test.ts` — native synthetic graph and provider tapes; actual normalized ingress, processors, calendar and four variants; matrix phasesP01–P04.
- [x] `pulse-report-restart-acceptance.integration.test.ts`, `pulse-report-migration-acceptance.integration.test.ts` in that directory — reuse recovery driver; add migration fixture/0091 SQL per design for guarded old-schema→0098 upgrade; phasesP05–P06.
- [x] `scripts/report-acceptance-readiness.ts`, `report-acceptance-readiness.test.ts` — pure conservative evidence validation; no runtime imports or capability execution.
- [x] `scripts/run-pulse-report-acceptance.ts`, `.test.ts`, `report-acceptance-preview.ts`, `package.json`, `scripts/tsconfig.v2-policy.json` — guarded runner, exact target selection/timeouts, source-bound previews and bounded post-assertion receipts; phaseP07.
- [x] `docs/pulse-report-cutover-operations.md`, linked matrix and task/failure logs — record evidence, missing public intake/native wiring and sequential human gates; complete independent review and official harness.

**Acceptance Criteria:**
- Given all33 IDs, when the approved run completes, then every required local assertion has fresh linked evidence and no accidental skips; independent expected values expose wrong membership/arithmetic and1–4-change suppression.
- Given German company/Ukrainian personal state and synthetic narrative outputs, when rendering completes, then exact payload visibility/language routing is checked while semantic/native Slack acceptance remains unrun.
- Given valid local receipts but absent public intake or production wiring, when readiness is computed, then pilot eligibility stays blocked; stale/missing/forged evidence cannot promote a gate.
- Given final reviewed source, when affected checks, genuine fresh/upgrade lanes, preservation and official harness run, then local completion is supported without claiming deployment or full product acceptance.

## Spec Change Log

## Design Notes

One local acceptance/readiness goal. The linked design fixes phase oracles, real PostgreSQL-clock limits, isolation, migration baselines and non-executable rollout gates. Existing lower-level regressions remain authoritative; no new activation flag or employee protocol is proposed. No sprint story key is invented.

## Verification

- Build shared outputs before consumers; run pure runner/readiness tests.
- `node --import tsx scripts/run-pulse-report-acceptance.ts --mode local-synthetic --out runs/rpt-08/acceptance` — future command; explicit owned targets/opt-in and both preflights required.
- Run the three new integration targets explicitly; official selection alone cannot establish acceptance.
- Serialized workspace types, root policy types, lint; `pnpm harness:check -- --base 237d7075ff08f262ccf3cbe2bf7c36cb390d204e` — actual final full preserved-worktree gate after implementation approval.

## Step 3 pre-review implementation evidence — 2026-10-30

The approved local implementation is verified by one complete immutable-source strict run: `runs/rpt-08/acceptance-20261030-final7/acceptance-bundle.json` and `runs/rpt-08/final-verification-summary.json`. Actual exit was 0; all 813 selected tests passed with zero skips, all 33 local matrix cases passed, and all 813 inventory identities are unique. Source SHA256: `634dee9d90773da7ad6f71895c786fe25b078b12a2e620eae20d6b6c2f7f9375`. Genuine 0091-to-0098 upgrade/fresh acceptance ran before lower regressions; connected and restart lanes each passed 2/2. Native channel evidence used actual `node:test` (26/26), not Vitest.

The implementation-start-relative review scope is 24 files. The sole additional preexisting-test exception is one exact block in `pulse-report-delivery.integration.test.ts`: reserve the successor policy before costly prior freeze and allow ten seconds of headroom within the existing thirty-second timeout; all oracles and every other byte are unchanged. Exact before/after block proof is in `runs/rpt-08/lower-fixture-preservation/`. Separate postrun preservation proves 194 SQL/meta files, all 99 journal entries, frozen intent and the approved design/matrix unchanged.

Step04 independent review and the official pinned-base harness remain pending; the final documentation/review execution checkbox remains open for that coordinator-owned completion. Local acceptance does not authorize public rights intake, production native registration, real model or Slack calls, migration/deployment or a new employee cycle. `pilotEligibility=blocked`, `activationExecuted=false`.


## Step04 corrective pass — 2026-10-30

Two fresh context-free reviewers examined the exact 24-path implementation-start-relative delta (`runs/rpt-08/step04-review-input.patch`, SHA256 `cc4cbff4fb43746c64c37ba6441fa6c339682e895c02b93f630861601cf2e966`). Their findings and coordinator decisions are in `runs/rpt-08/step04-triage.json`. All eleven deduplicated findings are implementation patches under the existing intent: canonical physical Vitest identities; exact trusted lane/assertion counts, test and artifact binding; protected migration manifest binding; connected next-cycle trace; native prior-final raw trend and unequal-question arithmetic; schema-qualified SQL privacy controls; ordered cleanup; bounded parent-signal cancellation; real-path containment; and an explicit safe real-calendar boundary.

The frozen intent, approved design/matrix, runtime and migration bytes remain unchanged. Corrections must retain every independent membership/arithmetic/receipt oracle and actual calendar wait. Final7 proves only its original frozen source. Current completion is pending focused counterexample regressions, independent correction rechecks, one new complete immutable-source zero-skip aggregate and the official pinned-base harness. Combining earlier attempts cannot substitute for the new aggregate. Pilot eligibility remains blocked; no production, live model or Slack scope is added.


## Step04 reviewed-source verification — 2026-10-30

All eleven accepted implementation patches are corrected without changing frozen intent. Both bounded independent correction rechecks found no remaining concrete defect (`runs/rpt-08/step04-blind-recheck-final.json`, `step04-edge-recheck-final.json`). The first native correction diagnostic exposed a nonexistent completion tenant column; the corrected candidate/snapshot join passed all four targeted SQL EXPLAIN checks and a new isolated focused native run. Its filtered companion is diagnostic-only evidence.

The new full immutable-source run `20261030_final8` actually exited 0. Source SHA256 is `7b18faddb819f29fffa9d078316bf22a631845d53ef0f73b33950bf51d265603`. Independent coordinator verification confirms 813 unique canonical executed tests, zero skips, all 33 local cases, four report variants and 12 HTML/body/fallback hash-verified parts. Actual completed prior-final versus next-intermediate raw values are 820/12 and 751/11, both formatted 68.3 with a negative native delta; final-report presentation semantics are preserved. Genuine pristine migration/fresh acceptance ran first. All 194 protected SQL/meta files, 99 journal entries, approved contexts, frozen intent and 377 starting paths remain preserved with exactly the eight authorized exceptions.

Evidence: `runs/rpt-08/acceptance-20261030-final8/`, `root-acceptance-audit-final8.json`, `root-preview-audit-final8.json`, and `step04-triage.json`. Final workspace checks and the official pinned-base harness remain pending. Production, semantic/native-client acceptance and public ingress remain separate blocked/unrun gates; pilot eligibility is blocked and activation was not executed.


## Final scoped completion and verification limits — 2026-10-30

All required approved RPT08 local assertions are complete: actual immutable-source final8 exit0, 813 unique canonical tests without skips, all33 local cases, four variants, twelve hash-verified preview parts, eleven corrected findings, both independent bounded rechecks, types/lint24/24 and preservation194/99/377 with eight authorized exceptions. The prescribed pinned-base official command actually exited0 under its legitimate default PostgreSQL-only profile. Structured receipt: `runs/harness/receipt-1793399354824-e58f8f26.json`; profile and actual skip audit: `runs/rpt-08/official-profile-independent-review.json` and `official-profile-skip-audit.json`.

This does not establish that every Redis-enabled historical fixture passed. Earlier official attempts are retained separately: missing ignored executable links were repaired without source/install changes; the second attempt hit two preserved RPT07 guards requiring a different fixed Redis port. The default profile adds nine conditional skips: seven have separately passed on the same source; the two fixed-port behaviors remain unverified in this owned environment. They are additional preexisting checks, not missing required33-case matrix assertions. Broad local verification therefore retains an estimated5% remainder, represented by those two tests and their safe portable-target follow-up. Do not report unconditional local Remaining0. Model semantics, native Slack clients, public ingress, production registration/inventory/activation remain unrun or blocked; full production-path remainder remains a rough35–45% estimate with low confidence. Pilot eligibility is blocked and activation is false.

No source, preserved legacy guard or frozen intent was changed to obtain the default receipt. No commit, push, PR, deployment, real model/Slack call or employee-cycle activation is included. `story_key` is unset, so sprint sync is skipped according to the workflow precondition.


## Suggested Review Order

**Controlled execution**

- Start with the explicit synthetic entry point and its bounded resource lifecycle.
  [run-pulse-report-acceptance.ts:126](../../scripts/run-pulse-report-acceptance.ts#L126)

- Validate named ownership, real paths and the minimal child environment before payloads.
  [run-pulse-report-acceptance.ts:13](../../scripts/run-pulse-report-acceptance.ts#L13)

**Evidence integrity**

- Follow pristine migration, lower regressions, connected recovery and receipt assembly.
  [pulse-report-acceptance-run.ts:33](../../scripts/pulse-report-acceptance-run.ts#L33)

- Read canonical physical test identity and exact expected inventory enforcement.
  [pulse-report-acceptance-evidence.ts:119](../../scripts/pulse-report-acceptance-evidence.ts#L119)

- Check trusted assertion bindings and immutable blocked external gates.
  [report-acceptance-readiness.ts:23](../../scripts/report-acceptance-readiness.ts#L23)

**Native behavioral proof**

- Inspect actual prior-final trend, unequal-question means, membership and receipts.
  [pulse-report-connected-acceptance.integration.test.ts:20](../../packages/database/src/__tests__/pulse-report-connected-acceptance.integration.test.ts#L20)

- Follow durable recovery and unknown-send protection through real queue boundaries.
  [pulse-report-restart-acceptance.integration.test.ts:19](../../packages/database/src/__tests__/pulse-report-restart-acceptance.integration.test.ts#L19)

- Inspect genuine old-schema continuation and the unchanged fresh-install oracle.
  [pulse-report-migration-acceptance.integration.test.ts:19](../../packages/database/src/__tests__/pulse-report-migration-acceptance.integration.test.ts#L19)

**Supporting contracts and previews**

- Verify literal multipart previews while retaining native-client acceptance as unrun.
  [report-acceptance-preview.ts:12](../../scripts/report-acceptance-preview.ts#L12)

- Read strict readiness dimensions and the acceptance receipt shape.
  [pulse-report-acceptance.ts:92](../../packages/contracts/src/pulse-report-acceptance.ts#L92)

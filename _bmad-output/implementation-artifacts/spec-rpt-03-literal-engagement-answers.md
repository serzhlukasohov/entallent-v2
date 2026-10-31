---
title: 'RPT-03: Literal Engagement answers and durable proof'
type: 'feature'
created: '2026-10-23'
status: 'done'
review_loop_iteration: 0
baseline_commit: 237d7075ff08f262ccf3cbe2bf7c36cb390d204e
context:
  - '{project-root}/_bmad-output/planning-artifacts/pulse-check-reports/RPT-03-DESIGN.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** Legacy 0-10 assessments cannot prove versioned, explicit quantitative answers for the new reports.

**Approach:** Prepare an inactive 1-10 contract and persist literal answers with immutable receipt history, independently of model work. The required design defines transaction and recovery boundaries.

## Boundaries & Constraints

**Always:** Three existing topics: recommendation, motivation, current engagement. Integer 1-10; exact delivered question/version; direct literal reply is its own numeric confirmation. Preserve open-ended shown-confirmation, historical 0-10 data, legacy defaults, RPT-01/02, frozen affiliation and negative permissions. Retain the 14-day offset; native bounds are half-open. Keep history for future cutoff selection and analytical retention.

**Ask First:** Production activation/migration, model or Slack egress, public rights routes, historical conversion, language-policy changes.

**Never:** Infer ratings, fabricate rubrics, read private text from reports, reuse legacy scores as new proof, activate defaults, modify MAF or implement report assembly/delivery.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Literal | Delivered bound probe; 6, 8, 10 | Three permanent raw answers; future mean 8 | No extra numeric confirmation |
| Invalid | 0/-1/11/7.5; incidental/ambiguous number | No accepted revision | Preserve previous answer |
| Proof | Wrong version, unsent prompt, missing receipt | No reportable answer | Typed denial or operational retry |
| Replay | Reversed jobs, correction, backfill | One receipt revision; deterministic latest | No older overwrite/resurrection |
| Rights | Transfer/withdrawal during capture | Timely origin retained; denial prevails | Coaching remains available |

</frozen-after-approval>

## Code Map

- `packages/application/src/use-cases/survey-evidence.use-case.ts` - current numeric parser/assessment path; exclude the new type before semantic evaluation.
- `apps/worker/src/conversation/conversation.processor.ts` - capture before resume, coalescing and model generation.
- `packages/database/src/schema/survey-report-scopes.ts` - existing frozen bindings, lineages and negative permissions.

## Tasks & Acceptance

Implement every concrete ownership entry in the [required design](../planning-artifacts/pulse-check-reports/RPT-03-DESIGN.md).

**Execution:**
- [x] `packages/domain/src/survey/engagement-answer.ts`, `packages/contracts/src/pulse-engagement.ts`, `packages/application/src/types/records.ts` - parser, invariant and versioned discriminator/exports.
- [x] `scripts/prepare-report-engagement-definition.ts`, `packages/database/src/schema/survey-engagement-answers.ts`, `packages/database/src/schema/survey-report-scopes.ts`, exports and forward migrations - inactive catalog, generic lineages, immutable revisions and replay tombstones. Extend exact-contract V2 preparation/preflight and the 0047 guard through additive migration; keep legacy validation strict.
- [x] `packages/application/src/use-cases/capture-engagement-answer.use-case.ts`, its repository port and `apps/worker/src/survey/repositories/engagement-answer.repository.ts` - deterministic, subject-locked capture and receipt ordering.
- [x] `apps/worker/src/conversation/conversation.processor.ts`, `survey/survey-evidence.processor.ts`, `survey/survey.module.ts`, application `survey-evidence.use-case.ts` - live/recovery/backfill hooks independent of AI; preserve semantic intent completion.
- [x] `packages/application/src/services/pulse-backlog.service.ts`, mapped conversation/proactive producers, `apps/worker/src/survey/repositories/survey.repository.ts`, `packages/ai-openai/src/prompts/respond.ts`, `packages/ai-openai/src/openai-provider.ts` - versioned delivered-probe proof and ledger-only completion; missing native opening fails closed without legacy window creation.
- [x] `apps/worker/src/survey/repositories/reporting-permission.repository.ts`, `apps/worker/src/retention/retention.repository.ts`, new `packages/database/src/__tests__/engagement-answers.integration.test.ts` and ownership-map tests - rights/stop races, first-capture expiry/cleanup, erasure, replay, actual queue path and legacy regressions.
- [x] Reports plan and task/failure logs - evidence, review corrections and remaining consumers.

**Acceptance Criteria:**
- Given a valid numeric inbound, when generation fails or turns coalesce, then actual worker capture persists it once without an AI-derived value or legacy assessment/group write.
- Given completed receipt history, when jobs run in any order, then exact receipt ordering is stable and later answers leave earlier cutoff candidates intact.
- Given withdrawal/stop/retention races, when capture or replay commits, then existing permissions, original affiliation and no-resurrection rules hold without a coaching failure.
- Given legacy definitions and pilot snapshots, when the new inactive version is prepared and tested, then their values, default lookup and delivery identity remain unchanged.

## Spec Change Log

## Verification

- Synthetic RED/GREEN unit and migrated DB cases from the design; source-to-permanent-row assertions, not only mocked parser output.
- Build workspace dependencies first; then domain/contracts/application/AI and affected worker tests, full fresh local DB integration and explicit deterministic queue tests. Never rebuild dist concurrently with consumer tests.
- `pnpm typecheck`, `pnpm lint`, `pnpm harness:check -- --base 237d7075ff08f262ccf3cbe2bf7c36cb390d204e`; two independent BMad reviews before completion.
- Completed locally on 2026-10-25 after approval. Database 103/103 (52 RPT-03), application 1,252, mocked AI 274, worker 445 (44 optional cases skipped); explicit queue 31/31 and backfill 1/1 ran separately. Domain 17 and contract 1 passed.
- Both independent BMad correction rechecks are clear, including delivery-order/legacy-NULL-clock migration 0073. All eight review findings were corrected without changing frozen intent. Evidence: `runs/rpt-03/review/triage.json`, `runs/rpt-03/implementation-verification-receipt.json`.
- Final isolated-database full harness passed diff-check, workspace typecheck, lint and selected affected tests: `runs/harness/receipt-1792923081548-bc98a337.json`. Previously applied migration hashes matched; existing RPT-01/02 specifications and design remained unchanged.
- RPT-04 cutoff configuration, RPT-05 allowed-source/as-of reader and settlement, narrative, live evaluation and delivery remain later acceptance. No production migration, activation, model call or external Slack send was performed.

## Suggested Review Order

**Collection and receipt ownership**

- Keep legacy definitions unchanged while preparing the inactive, exact fifteen-question catalog.
  [prepare-report-engagement-definition.ts:9](../../scripts/prepare-report-engagement-definition.ts#L9)

- Persist literal receipts before resumed turns, coalescing or model work.
  [conversation.processor.ts:125](../../apps/worker/src/conversation/conversation.processor.ts#L125)

- Bind immutable delivered proof and receipt order under the existing subject lock.
  [engagement-answer.repository.ts:14](../../apps/worker/src/survey/repositories/engagement-answer.repository.ts#L14)

**Database, lifecycle and projection safety**

- Share delivery ambiguity rules across capture, SQL admission and private-message erasure.
  [0073_engagement-historical-attempt-proof.sql:3](../../packages/database/migrations/0073_engagement-historical-attempt-proof.sql#L3)

- Reconcile numeric backlog against allowed ledger coverage after expiry or withdrawal.
  [engagement-answer.repository.ts:103](../../apps/worker/src/survey/repositories/engagement-answer.repository.ts#L103)

- Retain ordinary coaching answers before appending the trusted numeric question.
  [openai-provider.ts:491](../../packages/ai-openai/src/openai-provider.ts#L491)

- Apply full or topic-specific negative permissions atomically.
  [reporting-permission.repository.ts:10](../../apps/worker/src/survey/repositories/reporting-permission.repository.ts#L10)

- Erase expired numeric content while retaining only required replay protection.
  [retention.repository.ts:279](../../apps/worker/src/retention/retention.repository.ts#L279)

**Source-to-row regression evidence**

- Inspect actual worker, native persistence, recovery, proof mutation and lifecycle cases.
  [engagement-answers.integration.test.ts:79](../../packages/database/src/__tests__/engagement-answers.integration.test.ts#L79)

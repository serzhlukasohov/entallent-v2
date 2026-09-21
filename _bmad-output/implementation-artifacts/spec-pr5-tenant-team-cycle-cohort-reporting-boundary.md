---
title: 'PR5 Tenant Team Cycle Cohort Reporting Boundary'
type: 'feature'
created: '2026-09-06'
status: 'complete'
review_loop_iteration: 1
baseline_commit: '95e9f036218d22b715c89d6b8b8ac8e3604d7592'
context:
  - '{project-root}/docs/collected-product-requirements.md'
  - '{project-root}/_bmad-output/planning-artifacts/2026-09-03-pr5-product-conformance-audit-and-plan.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-pr5-correction-withdrawal-boundary.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** A group-report job carries no tenant scope, the report use case trusts adapter rows and counts rows rather than distinct employees, and the repository treats one employee-owned survey window as the whole team cycle. A mismatched tenant/team job or duplicate employee rows can therefore affect manager-visible eligibility, while legitimate team members on sibling windows in the same cycle cannot aggregate.

**Approach:** Carry tenant/team/anchor-window scope through the existing job and ports. Snapshot the cycle-open team and roster on the existing employee survey window, query only confirmed reportable states from sibling windows with that same tenant/team/cycle scope, and make the application boundary reject out-of-roster/tenant rows and count each employee once before applying the fixed anonymity threshold.

## Boundaries & Constraints

**Always:** TypeScript owns tenant/team/cycle eligibility, accepted de-identification and withdrawal checks, distinct-employee counting, and `max(5, ceil(0.8 x roster size))`. Missing or mismatched scope fails closed before AI or Slack. The manager payload contains only aggregate copy and the distinct contributor count.

**Ask First:** Commit, push, PR conflict resolution, merge, deployment, production reset, Railway changes, real Slack writes, destructive migration, or a separate persisted cohort model beyond the existing survey window.

**Never:** Do not touch MAF or `agent-service`. Do not add a parallel report pipeline or AI eligibility decision. Do not expand into final reports, report snapshot versioning, transfer lifecycle cleanup, dashboard isolation, retention, numeric engagement, customer manager authorization, or a new cohort table in this slice.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Eligible cohort | One tenant/team/cycle has enough proof-backed rows from distinct roster employees | Generate one aggregate report and send it only through that tenant's Slack workspace | N/A |
| Duplicate employee | Adapter returns multiple reportable rows for one roster employee in the same cycle | Employee contributes once to count, score, summaries, and payload | Fail closed below threshold |
| Scope mismatch | Job, team, anchor window, or returned row belongs to another tenant/team/cycle | No report model call and no Slack send | Return `shouldSend: false` |

</frozen-after-approval>

## Code Map

- `packages/application/src/ports/outbox.port.ts` -- Existing group-report job contract; add tenant scope.
- `packages/application/src/ports/survey.repository.port.ts` -- Existing team/report projection port; accept one typed scope object.
- `packages/application/src/use-cases/conversation-orchestrator.ts` -- Enqueues the report after confirmation; already owns tenant and anchor window.
- `packages/application/src/use-cases/group-report.use-case.ts` -- Shared eligibility/anonymity boundary before AI.
- `packages/database/src/schema/survey.ts` -- Existing employee window carries the immutable report team and roster snapshot for its cycle.
- `apps/worker/src/survey/repositories/team.repository.ts` -- Resolve the requested team only inside the job tenant.
- `apps/worker/src/survey/repositories/group-state.repository.ts` -- Resolve sibling employee windows by the anchor window's tenant/definition/period bounds.
- `apps/worker/src/survey/group-report.processor.ts` -- Reuse the job tenant for use-case scope and Slack workspace lookup.

## Tasks & Acceptance

**Execution:**
- [x] `packages/application/src/use-cases/group-report.use-case.test.ts` -- Add one RED duplicate-employee regression, then cover tenant/team scope rejection.
- [x] `packages/application/src/ports/outbox.port.ts`, `packages/application/src/ports/survey.repository.port.ts`, and `packages/application/src/use-cases/group-report.use-case.ts` -- Thread typed scope through the existing boundary and count distinct eligible employees once.
- [x] `packages/application/src/use-cases/conversation-orchestrator.ts` and its focused test -- Put the existing tenant ID on the report job.
- [x] `packages/database/src/schema/survey.ts` plus one forward migration -- Add the minimal team/roster snapshot columns to the existing window.
- [x] `apps/worker/src/survey/repositories/team.repository.ts`, `group-state.repository.ts`, and existing repository tests -- Enforce tenant/team/anchor-cycle scope without a new table.
- [x] `apps/worker/src/survey/group-report.processor.ts` -- Use the job tenant for both report execution and Slack workspace resolution.
- [x] `docs/agent-failures.md` and `docs/agent-task-log.md` -- Record only new failures and the final task receipt.

**Acceptance Criteria:**
- Given duplicate or out-of-scope adapter rows, when report eligibility is evaluated, then fewer than five distinct in-scope employees never reach the report model.
- Given per-employee windows sharing one persisted tenant/definition/period cycle, when five team members confirm one Pulse Index, then all five can aggregate despite different window IDs.
- Given a tenant/team/window mismatch, when the queued job runs, then no model call or Slack send occurs.
- Given the implementation is complete, only one forward survey-window migration is added and no MAF or `agent-service` file changed.

## Spec Change Log

## Design Notes

The anchor `surveyWindowId` remains employee-owned. Its persisted team and roster snapshot supplies the immutable cohort scope, while sibling windows are matched by tenant, survey definition, `periodStart`, and `periodEnd`. A separate cohort entity and transfer mutation remain in the later lifecycle slice.

Legacy active windows without persisted scope fail closed; reconstructing their roster from mutable current state is forbidden. New sibling windows reuse the canonical persisted roster for their tenant/team/definition/period. Materializing that roster exactly at cycle open and rolling over legacy active windows remain a separate lifecycle/persistence decision.

### Persisted Lifecycle Follow-up

The follow-up contract in `../specs/spec-pr5-persisted-reporting-cohort-lifecycle/` replaces the temporary employee-window roster authority with one canonical `survey_reporting_cohorts` row per tenant/team/definition/period. `OpenSurveyReportingCycleUseCase` freezes the roster at actual cycle open, employee windows reference that cohort, and legacy unscoped windows close without historical reconstruction.

### Review Findings

- [x] [Review][Patch] Remove mutable legacy-window roster backfill. [`apps/worker/src/survey/repositories/survey.repository.ts`]
- [x] [Review][Patch] Select duplicate employee state deterministically by latest confirmation. [`packages/application/src/use-cases/group-report.use-case.ts`]
- [x] [Review][Patch] Render the report period from the persisted anchor cycle. [`packages/application/src/use-cases/group-report.use-case.ts`]
- [x] [Review][Patch] Validate team identity and typed candidate definition/team/period/roster/status/Pulse Index before AI. [`packages/application/src/use-cases/group-report.use-case.ts`]
- [x] [Review][Patch] Require explicit survey opt-in and distinct single-team membership when freezing eligibility. [`apps/worker/src/survey/repositories/team.repository.ts`]
- [x] [Review][Patch] Canonicalize roster order and reuse the persisted sibling-window roster. [`apps/worker/src/survey/repositories/survey.repository.ts`]
- [x] [Review][Patch] Reject divergent sibling roster snapshots in the repository projection. [`apps/worker/src/survey/repositories/group-state.repository.ts`]
- [x] [Review][Resolved in follow-up] Materialize one immutable roster at actual cycle open and roll over legacy unscoped active windows. — implemented by the persisted reporting cohort lifecycle slice.
- [x] [Review][Defer] Revalidate the contributor set immediately before Slack delivery. — deferred, requires report snapshot/delivery lifecycle work.
- [x] [Review][Defer] Make manager Slack report delivery idempotent. — deferred, requires immutable report snapshots and a durable delivery key.
- [x] [Review][Defer] Bind manager identity and Slack workspace as one tenant-scoped target. — deferred, belongs to customer manager authorization/workspace isolation.
- [x] [Review][Defer] Define null-score eligibility for numeric Pulse Index reporting. — deferred, belongs to the numeric engagement slice.
- [x] [Review][Defer] Add a PostgreSQL-backed end-to-end repository acceptance test for sibling cohort aggregation. — deferred, migration integration is covered but repository acceptance is currently SQL-contract plus use-case tests.

## Verification

**Commands:**
- `pnpm --filter @entalent/application test -- src/use-cases/group-report.use-case.test.ts src/use-cases/conversation-orchestrator.test.ts` -- focused application behavior passes.
- `pnpm --filter @entalent/worker test -- src/survey/repositories/group-state.repository.test.ts src/survey/repositories/team.repository.test.ts` -- SQL scope guards pass.
- `pnpm --filter @entalent/application typecheck && pnpm --filter @entalent/application lint && pnpm --filter @entalent/application build` -- application package is valid.
- `pnpm --filter @entalent/worker typecheck && pnpm --filter @entalent/worker lint && pnpm --filter @entalent/worker build` -- worker package is valid after dependency build.
- `pnpm exec dotenv -e .env -- pnpm --filter @entalent/database test:integration` -- forward migration and persisted scope pass locally.
- `pnpm prepush` -- repository gate passes, with the documented outside-sandbox script-test fallback only if TSX IPC is denied.

**Latest result:** The persisted lifecycle follow-up passed 64/64 focused application tests, 24/24 focused worker tests, and 23/23 database integration tests. Affected database/application/worker typecheck, lint, and sequential builds passed. A fresh outside-sandbox `pnpm prepush` passed typecheck, lint, all package unit tests, and script tests in one run. Actual cycle-open materialization and legacy rollover are complete locally; report snapshot/delivery lifecycle remains explicitly deferred.

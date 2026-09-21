---
title: 'PR5 Typed De-Identification Acceptance Gate'
type: 'feature'
created: '2026-09-06'
status: 'done'
review_loop_iteration: 0
baseline_commit: '95e9f036218d22b715c89d6b8b8ac8e3604d7592'
context:
  - '{project-root}/docs/collected-product-requirements.md'
  - '{project-root}/_bmad-output/planning-artifacts/2026-09-03-pr5-product-conformance-audit-and-plan.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** Reportable confirmation summaries can currently move from AI-generated candidate text into employee confirmation and manager reporting without a typed TypeScript de-identification acceptance decision. That violates REQ-013, REQ-016, REQ-020, REQ-025, and REQ-044 because prompt wording alone is treated as a privacy boundary.

**Approach:** Keep AI as the candidate generator, then run one pure TypeScript de-identification policy at the existing confirmation/reportable boundary. Persist the typed accepted/rejected decision with policy version and machine-readable reasons on the existing group-state/confirmation candidate path, and require accepted proof before staging confirmation, confirming the employee-cycle insight, or feeding `GroupReportUseCase`.

## Boundaries & Constraints

**Always:** TypeScript owns accepted/rejected, policy version, rejection reasons, persistence transitions, and reporting eligibility. A candidate with names, Slack handles, emails, phone numbers, URLs, exact dates/times, source message IDs, or known available identifiers must fail closed. Rejected candidates stay in working/pending state and do not create confirmation prompts or reporting inputs.

**Ask First:** Commit, push, PR conflict resolution, merge, production reset, Railway deploy, Railway setting changes, real Slack writes, schema choices that require destructive migration, or scope expansion beyond this de-identification gate.

**Never:** Do not touch MAF or `agent-service`. Do not create a parallel insight pipeline. Do not fold in correction/rewrite, exclusion/withdrawal, tenant/team/cycle cohort scope, lifecycle cleanup, dashboard isolation, or numeric engagement unless compilation or persistence invariants make a tiny supporting change inseparable.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Accepted candidate | Confirmation summary is generalized and the TS policy returns `accepted` with a policy version | Candidate can be staged for confirmation; after employee agreement, reporting can consume the exact accepted summary | N/A |
| Rejected candidate | Confirmation summary contains identifying data or known forbidden identifiers | No confirmation prompt is staged; no report input is produced; state records `rejected`, policy version, and reasons | Fail closed and continue ordinary reply without reporting eligibility |
| Legacy confirmed row | Row has `confirmed` status and summary but no accepted decision | Reporting ignores it and does not call the group-report model | Return `shouldSend: false` if the cohort drops below threshold |

</frozen-after-approval>

## Code Map

- `packages/application/src/use-cases/conversation-orchestrator.ts` -- Creates confirmation candidates, stages delivered prompts, confirms employee agreement, and enqueues group reports.
- `packages/application/src/use-cases/group-report.use-case.ts` -- Last application boundary before report summaries are sent to the report model.
- `packages/application/src/ports/survey.repository.port.ts` -- Existing shared state/transition contract for pending, staged, confirmed, and reportable group state.
- `packages/application/src/types/records.ts` -- `SurveyGroupStateRecord` is the current employee-cycle insight/read model crossing application boundaries.
- `apps/worker/src/survey/repositories/group-state.repository.ts` -- SQL transition guard for staging, delivery activation, confirmation, and reportable projection.
- `packages/database/src/schema/survey-group-states.ts` -- Existing persistence row for the group candidate/confirmed insight; add only the smallest needed decision storage if message metadata alone is insufficient.
- `packages/application/src/use-cases/group-report.use-case.test.ts` -- Focused RED reporting-boundary test already reproduces the missing gate.
- `apps/worker/src/survey/repositories/group-state.repository.test.ts` -- Focused SQL guard checks for staging/reportable projection.

## Tasks & Acceptance

**Execution:**
- [x] `packages/application/src/use-cases/group-report.use-case.test.ts` -- Keep the RED test that proves legacy confirmed summaries without accepted de-identification are not reportable.
- [x] `packages/application/src/utils/deidentification-policy.ts` -- Add the smallest pure TS policy and reason codes needed by REQ-013/025.
- [x] `packages/application/src/types/records.ts` and `packages/application/src/ports/survey.repository.port.ts` -- Add typed decision shape to existing group-state transitions, without a new pipeline.
- [x] `packages/application/src/use-cases/conversation-orchestrator.ts` -- Evaluate generated confirmation summaries before staging; persist accepted/rejected decision and attach accepted proof to the outbound candidate identity.
- [x] `apps/worker/src/survey/repositories/group-state.repository.ts` -- Require accepted decision in stage/confirm/reportable SQL guards and map reportable rows with typed proof.
- [x] `packages/database/src/schema/survey-group-states.ts` plus migration if needed -- Persist the decision only if existing message metadata cannot record both accepted and rejected states durably.
- [x] `docs/agent-failures.md` and `docs/agent-task-log.md` -- Update only for real failure findings/task completion.

**Acceptance Criteria:**
- Given an identifying candidate, when the mentor generates a confirmation candidate, then TypeScript rejects it with a policy version and machine-readable reasons, and no candidate enters confirmation or reporting.
- Given a generalized accepted candidate, when the employee confirms after disclosure, then the exact accepted summary can become the employee-cycle insight and later report input.
- Given a legacy confirmed row without accepted de-identification proof, when a report is generated, then the report model is not called with that summary.
- Given the code compiles, no MAF or `agent-service` files are changed.

## Spec Change Log

- 2026-09-06: Review patch resolved delivery activation without de-identification proof, malformed accepted decisions, missing day-month date detection, and available team identifiers. Kept the existing group-state/message candidate path; no MAF, agent-service, parallel pipeline, or live Slack changes.

## Design Notes

The minimal shared boundary is the existing group-state/confirmation path. Reuse `confirmationPromptMessageId` and message metadata as the candidate identity, and add group-state decision storage only for rejected candidates or SQL/report projection proof that cannot be recovered from that message.

## Verification

**Commands:**
- `pnpm --filter @entalent/application test -- src/use-cases/group-report.use-case.test.ts` -- focused RED becomes green.
- `pnpm --filter @entalent/application test -- src/use-cases/conversation-orchestrator.test.ts src/use-cases/group-report.use-case.test.ts` -- confirmation/reporting application behavior passes.
- `pnpm --filter @entalent/worker test -- src/survey/repositories/group-state.repository.test.ts` -- SQL guards pass.
- `pnpm --filter @entalent/application typecheck && pnpm --filter @entalent/application lint` -- application package is typed/linted.
- `pnpm --filter @entalent/worker typecheck && pnpm --filter @entalent/worker lint` -- worker adapter is typed/linted.
- `pnpm test:integration` -- run if schema/migration changes are needed and local DB env is available.
- `pnpm prepush` -- final deterministic repository gate.

**Actual:** Focused application and worker tests passed; application/worker/database typecheck/lint/build passed; database integration passed outside sandbox after local Postgres `EPERM`; `pnpm prepush` passed typecheck/lint/unit tests and only hit known sandbox `tsx` IPC, then `pnpm test:scripts` passed outside sandbox.

## Suggested Review Order

**Policy Boundary**

- TypeScript owns accepted/rejected decision before candidate staging.
  [`conversation-orchestrator.ts:417`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L417)

- Rejected candidates are recorded and regenerated without confirmation metadata.
  [`conversation-orchestrator.ts:437`](../../packages/application/src/use-cases/conversation-orchestrator.ts#L437)

- Acceptance means exact policy version and empty reasons.
  [`deidentification-policy.ts:62`](../../packages/application/src/utils/deidentification-policy.ts#L62)

**Persistence Guards**

- Delivery activation now requires row and message accepted proof.
  [`group-state.repository.ts:194`](../../apps/worker/src/survey/repositories/group-state.repository.ts#L194)

- Confirmation and report projection reuse the same SQL accepted proof.
  [`group-state.repository.ts:441`](../../apps/worker/src/survey/repositories/group-state.repository.ts#L441)

- Confirmed rows have a database-level accepted proof check.
  [`survey-group-states.ts:48`](../../packages/database/src/schema/survey-group-states.ts#L48)

**Tests**

- RED/review cases cover malformed acceptance and known identifiers.
  [`conversation-orchestrator.test.ts:738`](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L738)

- SQL tests cover activation/reportable proof and malformed JSON parsing.
  [`group-state.repository.test.ts:113`](../../apps/worker/src/survey/repositories/group-state.repository.test.ts#L113)

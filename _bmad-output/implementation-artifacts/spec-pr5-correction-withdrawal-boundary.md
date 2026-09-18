---
title: 'PR5 Correction And Withdrawal Boundary'
type: 'feature'
created: '2026-09-06'
status: 'done'
review_loop_iteration: 0
baseline_commit: '95e9f036218d22b715c89d6b8b8ac8e3604d7592'
context:
  - '{project-root}/docs/collected-product-requirements.md'
  - '{project-root}/_bmad-output/planning-artifacts/2026-09-03-pr5-product-conformance-audit-and-plan.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-pr5-typed-deidentification-acceptance-gate.md'
---

<frozen-after-approval reason="human-owned intent - do not modify unless human renegotiates">

## Intent

**Problem:** A confirmed or awaiting reportable insight can be corrected or excluded by the employee only partially today: `correct` reopens the group but leaves no explicit replacement boundary, and exclusion/withdrawal has no typed persisted state. That violates REQ-012, REQ-017, REQ-020, REQ-021, and REQ-044 because reporting eligibility is not explicitly limited to confirmed, de-identified, non-withdrawn insights.

**Approach:** Reuse the existing `survey_group_states` lifecycle and confirmation interpreter. Treat correction/rewrite as returning the current candidate to working state with all reportability proof cleared; treat exclusion during confirmation as a typed withdrawal recorded on the same row with timestamp/message proof; make report generation read current state and ignore withdrawn rows.

## Boundaries & Constraints

**Always:** TypeScript owns correction/exclusion state transitions, persisted withdrawal proof, and reportability filtering. A corrected candidate must require fresh evidence/display/de-identification/confirmation before reporting. A withdrawn row must not feed future group reports, including queued group-report jobs that run after withdrawal.

**Ask First:** Commit, push, PR conflict resolution, merge, production reset, Railway deploy, Railway setting changes, real Slack writes, destructive migrations, or broad report snapshot/job redesign.

**Never:** Do not touch MAF or `agent-service`. Do not add a parallel reportable-insight pipeline. Do not expand into tenant/team/cycle cohort scope, lifecycle cleanup, dashboard isolation, numeric engagement scoring, or delivered Slack report mutation. Do not claim broad ordinary-conversation withdrawal for arbitrary old facts unless the current row can be identified without a new product decision.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Correction | Employee answers an awaiting confirmation with a correction/rewrite | Current candidate returns to `in_progress`, reportability proof is cleared, no report is enqueued | Fail closed if prompt/inbound proof does not match |
| Exclusion at confirmation | Employee answers an awaiting confirmation with "do not include/report this" | Same row becomes `withdrawn` with withdrawal timestamp/message id; no confirmation/report occurs | Treat unclear language as `unclear`, not withdrawal |
| Queued report after withdrawal | Group-report job runs after a row was withdrawn | `GroupReportUseCase` re-reads current rows and omits withdrawn input | Return `shouldSend: false` if threshold falls below required |
| Legacy confirmed row | Row is `confirmed` but has withdrawn marker/status | Report model never receives its summary | Ignore row rather than trying to repair history |

</frozen-after-approval>

## Code Map

- `packages/contracts/src/ai.ts` -- Current confirmation interpreter schema only supports `agree`, `correct`, `unclear`; add typed exclusion verdict if needed.
- `packages/ai-openai/src/prompts/confirm-interpret.ts` -- Prompt maps employee confirmation replies into the typed interpreter contract.
- `packages/application/src/use-cases/conversation-orchestrator.ts` -- Handles awaiting confirmation, correction, confirmation, and group-report enqueue.
- `packages/application/src/ports/survey.repository.port.ts` -- Existing shared contract for group-state transitions; add withdrawal params here.
- `packages/application/src/types/records.ts` -- `SurveyGroupStateRecord` crosses application/reporting boundary.
- `apps/worker/src/survey/repositories/group-state.repository.ts` -- SQL transition guards and reportable confirmed-row projection.
- `apps/worker/src/survey/repositories/survey.repository.ts` -- Delegates the port to `GroupStateRepository`.
- `packages/application/src/use-cases/group-report.use-case.ts` -- Last application revalidation before manager report generation.
- `packages/database/src/schema/survey-group-states.ts` -- Existing row should carry minimal withdrawal proof if status alone is insufficient.
- `packages/application/src/use-cases/conversation-orchestrator.test.ts` -- RED tests for correction proof clearing and exclusion during confirmation.
- `apps/worker/src/survey/repositories/group-state.repository.test.ts` -- SQL tests for withdrawal transition and reportable projection.
- `packages/application/src/use-cases/group-report.use-case.test.ts` -- Boundary test that withdrawn rows never reach report model.

## Tasks & Acceptance

**Execution:**
- [x] `packages/application/src/use-cases/conversation-orchestrator.test.ts` -- Add focused RED tests for correction clearing reportability proof and exclusion not confirming/reporting.
- [x] `packages/application/src/use-cases/group-report.use-case.test.ts` -- Add RED test that withdrawn current state is omitted from report model input.
- [x] `packages/contracts/src/ai.ts` and `packages/ai-openai/src/prompts/confirm-interpret.ts` -- Represent explicit exclusion in the existing confirmation interpreter contract.
- [x] `packages/application/src/ports/survey.repository.port.ts` and `packages/application/src/types/records.ts` -- Add only minimal withdrawal state/proof to existing group-state types.
- [x] `packages/application/src/use-cases/conversation-orchestrator.ts` -- Route `correct` to working state with proof cleared, and explicit exclusion to withdrawal without report enqueue.
- [x] `apps/worker/src/survey/repositories/group-state.repository.ts` and `apps/worker/src/survey/repositories/survey.repository.ts` -- Implement guarded SQL transitions and exclude withdrawn rows from reportable projection.
- [x] `packages/database/src/schema/survey-group-states.ts` plus migration if needed -- Persist withdrawal timestamp/message proof without changing existing applied migrations.
- [x] `docs/agent-failures.md` and `docs/agent-task-log.md` -- Update only for real failures and final task row.

**Acceptance Criteria:**
- Given an awaiting confirmation, when employee corrects or rewrites it, then the prior candidate cannot be confirmed or reported without a fresh accepted/displayed/confirmed version.
- Given an awaiting confirmation, when employee explicitly excludes it from reporting, then TypeScript persists withdrawal proof and does not confirm or enqueue a report.
- Given a queued group-report job runs after withdrawal, then the report model receives only confirmed, de-identified, non-withdrawn summaries.
- Given the implementation is complete, no MAF or `agent-service` files changed.

## Spec Change Log

## Design Notes

Use `survey_group_states.status = 'withdrawn'` plus explicit withdrawal proof rather than a new table unless implementation proves a row cannot represent the lifecycle. In the current queue shape, group-report jobs carry no summaries, so revalidation belongs in the existing report use case/repository read.

## Verification

**Commands:**
- `pnpm --filter @entalent/application test -- src/use-cases/conversation-orchestrator.test.ts src/use-cases/group-report.use-case.test.ts` -- correction/withdrawal application behavior passes.
- `pnpm --filter @entalent/ai-openai test -- src/openai-provider.test.ts` -- interpreter contract parsing still passes.
- `pnpm --filter @entalent/worker test -- src/survey/repositories/group-state.repository.test.ts` -- SQL lifecycle guards pass.
- `pnpm --filter @entalent/application typecheck && pnpm --filter @entalent/application lint` -- application package is typed/linted.
- `pnpm --filter @entalent/worker typecheck && pnpm --filter @entalent/worker lint` -- worker adapter is typed/linted.
- `pnpm --filter @entalent/database typecheck && pnpm --filter @entalent/database lint && pnpm --filter @entalent/database build` -- schema package is valid.
- `pnpm exec dotenv -e .env -- pnpm --filter @entalent/database test:integration` -- migration/integration passes when local Postgres is accessible.
- `pnpm prepush` -- final repository gate; rerun `pnpm test:scripts` outside sandbox only if the known `tsx` IPC sandbox failure recurs.

## Suggested Review Order

**Application Boundary**

- Confirmation replies route through typed TS decisions before side effects.
  [conversation-orchestrator.ts:616](../../packages/application/src/use-cases/conversation-orchestrator.ts#L616)

- Reports re-read current scoped state and exclude withdrawn rows.
  [group-report.use-case.ts:31](../../packages/application/src/use-cases/group-report.use-case.ts#L31)

**Persistence Boundary**

- Withdrawal is one guarded transition on existing group state.
  [group-state.repository.ts:286](../../apps/worker/src/survey/repositories/group-state.repository.ts#L286)

- Confirmed projection is window-scoped, de-identified, and non-withdrawn.
  [group-state.repository.ts:391](../../apps/worker/src/survey/repositories/group-state.repository.ts#L391)

- Forward migration preserves already-applied 0012 environments.
  [0013_withdrawn_mercury.sql:1](../../packages/database/migrations/0013_withdrawn_mercury.sql#L1)

**Contract And Tests**

- Interpreter contract exposes explicit exclusion verdict.
  [ai.ts:203](../../packages/contracts/src/ai.ts#L203)

- Prompt semantics and parser behavior are both covered.
  [confirm-interpret.test.ts:4](../../packages/ai-openai/src/prompts/confirm-interpret.test.ts#L4)

- Orchestrator regressions cover malformed proof, correction, and exclusion.
  [conversation-orchestrator.test.ts:1268](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L1268)

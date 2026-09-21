# Handoff: PR #5 Grill Phase 2 Correction/Withdrawal Boundary

Date: 2026-09-06
Branch: `codex/grill-session-docs`
Baseline HEAD: `95e9f036218d22b715c89d6b8b8ac8e3604d7592`
Status: local implementation complete; not committed, not pushed

## Read First

- `_bmad-output/implementation-artifacts/spec-pr5-correction-withdrawal-boundary.md`
- `_bmad-output/implementation-artifacts/spec-pr5-typed-deidentification-acceptance-gate.md`
- `_bmad-output/implementation-artifacts/handoff-2026-09-06-grill-phase-2.md`
- `_bmad-output/planning-artifacts/2026-09-03-pr5-product-conformance-audit-and-plan.md`
- `docs/collected-product-requirements.md`
- `docs/agent-failures.md`
- `docs/agent-task-log.md`

Use BMad and Ponytail full. Use CodeGraph before grep for code exploration.

## Current Product Grounding

The implementation should continue to follow the grill/product contract, not generic SaaS assumptions. The relevant product truths are:

- Confirmation approves the exact displayed de-identified text for reporting only after disclosure.
- Correction returns the current candidate to working state; it is not reportable until fresh de-identification, display, and confirmation happen again.
- Withdrawal/exclusion must be persisted and block all later report snapshots/jobs.
- Only confirmed, de-identified, non-withdrawn permanent employee-cycle insights may feed team reports.
- Product policy must be typed TypeScript/DB behavior, not prompt-only.

## Completed In This Session

Correction/withdrawal boundary is done locally.

Implemented:

- `ConfirmationResponseSchema` now accepts typed `exclude`.
- `confirm-interpret` prompt now defines `exclude` semantics, with a prompt-rendering regression test.
- `SurveyRepositoryPort` and `SurveyGroupStateRecord` carry withdrawal state.
- `correct` on an awaiting confirmation reopens the candidate to `in_progress` and clears reportability/de-identification proof.
- `exclude` on an awaiting confirmation calls a TypeScript-owned `withdrawGroupState` transition.
- `withdrawGroupState` persists `status = 'withdrawn'`, `withdrawn_at`, and `withdrawal_message_id`, guarded by exact delivered outbound prompt plus exact inbound withdrawal message proof.
- `GroupReportUseCase` re-reads current state and filters out withdrawn rows.
- Group-report payload/use-case/repository now carry `surveyWindowId` so a queued report cannot count another window.
- Confirmed projection is `surveyWindowId` scoped, accepted de-id scoped, and `withdrawn_at IS NULL`.
- New forward migration `0013_withdrawn_mercury.sql` adds withdrawal columns because local DB had already applied `0012`.
- BMad review ran with Blind Hunter and Edge Case Hunter. Real findings were patched.
- `docs/agent-failures.md` and `docs/agent-task-log.md` were updated.
- Spec is marked `done` and includes Suggested Review Order:
  `_bmad-output/implementation-artifacts/spec-pr5-correction-withdrawal-boundary.md`

Important review findings already handled:

- Prompt schema accepted `exclude` before prompt semantics described it.
- Malformed/legacy awaiting confirmation without accepted de-id proof could hold the one-active-confirmation slot.
- Report job needed `surveyWindowId` scope to avoid cross-window counting.

## Verification Receipts

Passed:

- `pnpm --filter @entalent/contracts test -- src/ai.test.ts`
- `pnpm --filter @entalent/ai-openai test -- src/openai-provider.test.ts src/prompts/confirm-interpret.test.ts`
- `pnpm --filter @entalent/application test -- src/use-cases/conversation-orchestrator.test.ts src/use-cases/group-report.use-case.test.ts`
- `pnpm --filter @entalent/worker test -- src/survey/repositories/group-state.repository.test.ts`
- `pnpm --filter @entalent/contracts typecheck`
- `pnpm --filter @entalent/application typecheck`
- `pnpm --filter @entalent/ai-openai typecheck`
- `pnpm --filter @entalent/database typecheck`
- `pnpm --filter @entalent/conversation-sim typecheck`
- `pnpm --filter @entalent/worker typecheck`
- `pnpm --filter @entalent/contracts lint`
- `pnpm --filter @entalent/application lint`
- `pnpm --filter @entalent/ai-openai lint`
- `pnpm --filter @entalent/database lint`
- `pnpm --filter @entalent/worker lint`
- `pnpm --filter @entalent/conversation-sim lint`
- Sequential builds:
  - `pnpm --filter @entalent/contracts build`
  - `pnpm --filter @entalent/database build`
  - `pnpm --filter @entalent/application build`
  - `pnpm --filter @entalent/ai-openai build`
  - `pnpm --filter @entalent/worker build`
- `pnpm exec dotenv -e .env -- pnpm --filter @entalent/database test:integration` outside sandbox
- `pnpm test:scripts` outside sandbox
- `git diff --check`
- `git diff --name-only -- agent-service` returned empty

`pnpm prepush` result:

- Passed typecheck, lint, and unit test stages.
- Failed only at known sandbox `tsx` IPC with `listen EPERM .../tsx-501/*.pipe`.
- Covered by rerunning `pnpm test:scripts` outside sandbox, which passed.

## Dirty Tree Notes

The tree intentionally contains prior uncommitted docs and Phase 2 artifacts. Do not delete or overwrite them.

New/changed files from this latest slice include:

- `apps/worker/src/survey/group-report.processor.ts`
- `apps/worker/src/survey/repositories/group-state.repository.ts`
- `apps/worker/src/survey/repositories/group-state.repository.test.ts`
- `apps/worker/src/survey/repositories/survey.repository.ts`
- `packages/ai-openai/src/prompts/confirm-interpret.ts`
- `packages/ai-openai/src/prompts/confirm-interpret.test.ts`
- `packages/ai-openai/src/openai-provider.test.ts`
- `packages/application/src/ports/outbox.port.ts`
- `packages/application/src/ports/survey.repository.port.ts`
- `packages/application/src/types/records.ts`
- `packages/application/src/index.ts`
- `packages/application/src/use-cases/conversation-orchestrator.ts`
- `packages/application/src/use-cases/conversation-orchestrator.test.ts`
- `packages/application/src/use-cases/group-report.use-case.ts`
- `packages/application/src/use-cases/group-report.use-case.test.ts`
- `packages/contracts/src/ai.ts`
- `packages/contracts/src/ai.test.ts`
- `packages/database/src/schema/survey-group-states.ts`
- `packages/database/migrations/0013_withdrawn_mercury.sql`
- `packages/database/migrations/meta/0013_snapshot.json`
- `packages/database/migrations/meta/_journal.json`
- `docs/agent-failures.md`
- `docs/agent-task-log.md`
- `_bmad-output/implementation-artifacts/spec-pr5-correction-withdrawal-boundary.md`

Also keep the previous de-identification slice files:

- `packages/application/src/utils/deidentification-policy.ts`
- `packages/application/src/utils/deidentification-policy.test.ts`
- `packages/database/migrations/0012_odd_exodus.sql`
- `packages/database/migrations/meta/0012_snapshot.json`
- `_bmad-output/implementation-artifacts/spec-pr5-typed-deidentification-acceptance-gate.md`

## Constraints For The Next Session

- Do not commit, push, merge, resolve PR conflicts, deploy, reset production, or write real Slack without fresh explicit approval.
- Do not change Railway variables/settings/volumes/domains.
- Do not touch MAF or `agent-service`.
- Do not return to the old disclosure-only blocker unless there is new evidence.
- Build dependent packages sequentially when `dist` artifacts are involved; parallel build races were observed.
- Use a forward migration if any environment may already have applied the previous migration.

## Recommended Next Slice

Next product slice should start Phase 3 from the grill plan, but keep it narrow:

**Typed tenant/team/cycle cohort scope gate for group reporting.**

Why this next:

- Phase 2 now blocks unconfirmed, non-deidentified, and withdrawn data.
- The next highest grill risk is cohort/report scope: tenant, team, cycle, frozen roster, and distinct employee counting.
- Current code is improved with `surveyWindowId`, but still relies on current `team.memberUserIds` and does not yet model frozen tenant/team/cycle roster or distinct employee update policy.

Suggested first RED test:

- A group report job for `tenant A / team A / cycle window A` must not count:
  - confirmed rows from another tenant,
  - confirmed rows from another team,
  - confirmed rows from another survey window/cycle,
  - duplicate rows for the same employee,
  - transferred employees outside the frozen roster.

Suggested minimal implementation boundary:

1. Trace `team -> group report job -> GroupReportUseCase -> findConfirmedGroupStates -> Slack manager payload`.
2. Add a small shared reporting policy helper for anonymity floor and distinct employee count only if existing inline logic cannot safely express the invariant.
3. Carry tenant/team/cycle scope through existing group-report payload/repository ports.
4. Reuse `survey_group_states` and existing `teams/team_memberships` first; add a roster snapshot table only if the RED test proves current schema cannot represent frozen roster semantics.
5. Keep final reports, transfer lifecycle, retention cleanup, dashboard isolation, and numeric engagement out of this slice unless a compile-time or persistence invariant makes one inseparable.

Expected BMad spec name:

- `_bmad-output/implementation-artifacts/spec-pr5-tenant-team-cycle-cohort-reporting-boundary.md`

Expected verification:

- Focused RED/green tests for application group report and worker repositories.
- Affected package typecheck/lint/build.
- Database integration if schema/migration changes.
- `pnpm prepush`; if sandbox `tsx` IPC repeats, run `pnpm test:scripts` outside sandbox.

## Start Prompt For New Session

```text
Continue in /Users/serzh/Documents/enTalentNew on branch codex/grill-session-docs.

Read first:
- _bmad-output/implementation-artifacts/handoff-2026-09-06-correction-withdrawal-boundary.md
- _bmad-output/implementation-artifacts/spec-pr5-correction-withdrawal-boundary.md
- _bmad-output/implementation-artifacts/spec-pr5-typed-deidentification-acceptance-gate.md
- _bmad-output/planning-artifacts/2026-09-03-pr5-product-conformance-audit-and-plan.md
- docs/collected-product-requirements.md, especially REQ-024, REQ-027, REQ-028, REQ-029, REQ-032, REQ-037, REQ-044
- docs/agent-failures.md
- docs/agent-task-log.md

Use BMad and Ponytail full. Use CodeGraph before grep when exploring code.

Current status:
- Grill discovery and product contract are complete.
- Phase 0 and Phase 1 are complete.
- Phase 2 reportable-insight boundary is locally complete: typed de-identification gate plus correction/withdrawal boundary are implemented and verified locally.
- PR #5 is still OPEN and CONFLICTING; GitHub checks are absent.
- The working tree contains intentional uncommitted documentation/spec/handoff changes plus local implementation changes. Do not delete or overwrite them.
- Do not touch MAF or agent-service.

Do not commit, push, resolve conflicts, merge, deploy, reset production, change Railway settings, or write real Slack without separate explicit permission.

Next implementation slice:
Typed tenant/team/cycle cohort scope gate for group reporting.

First trace existing flow:
team -> group report job -> GroupReportUseCase -> findConfirmedGroupStates -> manager Slack payload.

Then:
1. Create a BMad spec for the slice.
2. Add one focused RED test showing cross-tenant/window/team or duplicate-employee data can affect a report.
3. Show the minimal shared-boundary fix before changing production code.
4. Keep AI out of the decision; TypeScript must own cohort eligibility, anonymity floor, distinct employee count, and scope rejection.
5. Reuse existing state, ports, and group-report payload where possible.
6. Do not expand into final report generation, transfer lifecycle cleanup, dashboard isolation, retention, numeric engagement, or customer manager auth unless a compile-time or persistence invariant makes it inseparable.
7. Run focused tests, affected package typecheck/lint/build, database integration if schema changes, and pnpm prepush.
8. Update docs/agent-failures.md for any new failure and add one row to docs/agent-task-log.md.
```

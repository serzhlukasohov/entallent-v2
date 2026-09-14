# Handoff: PR #5 First Immutable Report Snapshot Delivery

Date: 2026-09-07
Repository: `/Users/serzh/Documents/enTalentNew`
Branch: `codex/grill-session-docs`
Baseline HEAD: `95e9f036218d22b715c89d6b8b8ac8e3604d7592`
Status: local implementation complete; not committed, not pushed

## Read First

- `docs/grill-session-handoff.md`
- `docs/current-project-grill.md`
- `docs/collected-product-requirements.md`, especially REQ-024, REQ-027, REQ-028, REQ-029, REQ-032, REQ-037, REQ-044
- `_bmad-output/planning-artifacts/2026-09-03-pr5-product-conformance-audit-and-plan.md`
- `_bmad-output/specs/spec-pr5-persisted-reporting-cohort-lifecycle/SPEC.md`
- `_bmad-output/specs/spec-pr5-first-immutable-report-snapshot-delivery/SPEC.md`
- `_bmad-output/specs/spec-pr5-first-immutable-report-snapshot-delivery/brownfield.md`
- `docs/agent-failures.md`
- `docs/agent-task-log.md`

Use BMad and Ponytail full. Use CodeGraph before grep for code exploration.

## Boundaries

- The working tree is intentionally dirty. Preserve existing uncommitted docs, specs, migrations, tests, and implementation changes.
- Do not commit, push, merge, resolve PR conflicts, deploy, reset production, change Railway settings, or write real Slack without separate explicit permission.
- Do not touch MAF or `agent-service`.
- PR #5 is still open/conflicting; do not spend the next slice resolving PR conflicts.

## Current Program State

- Grill discovery and the 47-requirement product contract are complete.
- Phase 0 and Phase 1 are complete.
- Phase 2 is complete locally; earlier disclosure/confirmation behavior was production-verified.
- Phase 3 is in progress.
- Persisted tenant/team/cycle reporting cohort lifecycle is complete locally.
- First immutable report snapshot/delivery lifecycle is complete locally.
- Later intermediate-report versions, final report generation, transfer lifecycle cleanup, dashboard isolation, retention, numeric engagement, and customer manager auth remain out of scope unless a compile-time or persistence invariant makes one inseparable.

## Completed In This Slice

Created the BMad snapshot spec:

- `_bmad-output/specs/spec-pr5-first-immutable-report-snapshot-delivery/SPEC.md`
- `_bmad-output/specs/spec-pr5-first-immutable-report-snapshot-delivery/brownfield.md`
- `_bmad-output/specs/spec-pr5-first-immutable-report-snapshot-delivery/.memlog.md`

Implemented the first immutable snapshot lifecycle:

- Added `survey_report_snapshots` to `packages/database/src/schema/survey.ts`.
- Generated forward migration `packages/database/migrations/0016_fast_vision.sql` and `packages/database/migrations/meta/0016_snapshot.json`.
- Enforced the accepted uniqueness rule for first snapshots: `(tenantId, reportingCohortId, pulseIndex/questionGroup, snapshotVersion = 1)` for non-cancelled rows.
- `cancelled` releases the slot; `delivered` and `delivery_unknown` occupy it.
- Added `apps/worker/src/survey/repositories/group-report-snapshot.repository.ts`.
- Updated `GroupReportUseCase` to return contributor user IDs, source group-state IDs, and snapshot policy version.
- `GroupReportUseCase` now revalidates reportable contributors after AI returns; changed contributor set fails closed before a sendable candidate leaves TypeScript.
- `GroupReportProcessor` now creates a `pending_delivery` snapshot before Slack; only the insertion winner may call Slack.
- Duplicate/retried jobs stop before Slack when a non-cancelled first snapshot already exists.
- Before Slack delivery, the processor revalidates the workspace connection and manager Slack binding; changed binding marks the pending snapshot `cancelled`.
- Slack receipt with a valid external message ID marks `delivered`.
- Any exception after Slack send begins marks `delivery_unknown`.
- No Slack provider-specific error taxonomy was added.
- No pre-AI `generating` state was added.
- MAF and `agent-service` were not changed.

Updated required harness docs:

- `docs/agent-failures.md`
- `docs/agent-task-log.md`
- `docs/grill-session-handoff.md`

## RED Test

Added a focused worker RED test in `apps/worker/src/survey/group-report.processor.test.ts`:

- Test: `does not send the same first immutable snapshot twice`
- Initial failure: expected Slack `sendMessage` once, actual calls were `2`.
- This proved the old worker boundary could resend the same scoped report and had no durable delivery state.

## Verification Receipts

Passed:

- `pnpm --filter @entalent/application test -- src/use-cases/group-report.use-case.test.ts` -> 9/9
- `pnpm --filter @entalent/worker test -- src/survey/group-report.processor.test.ts` -> 5/5
- `pnpm --filter @entalent/database build`
- `pnpm --filter @entalent/database typecheck`
- `pnpm --filter @entalent/database lint`
- `pnpm --filter @entalent/application build`
- `pnpm --filter @entalent/application typecheck`
- `pnpm --filter @entalent/application lint`
- `pnpm --filter @entalent/worker build`
- `pnpm --filter @entalent/worker typecheck`
- `pnpm --filter @entalent/worker lint`
- `pnpm exec dotenv -e .env -- pnpm --filter @entalent/database test:integration` outside sandbox -> 24/24
- `git diff --check`

`pnpm prepush` status:

- Fresh run passed root typecheck, lint, and package tests.
- It stopped at `test:scripts` because sandboxed TSX cannot create its IPC pipe: `listen EPERM .../tsx-501/*.pipe`.
- Rerunning aggregate `pnpm test:scripts` outside sandbox was rejected because it includes `scripts/live-maf-primary-app-smoke.test.ts`, and this task explicitly prohibited MAF/agent-service work.
- Non-MAF script tests were run individually outside sandbox and passed:
  - `pnpm exec tsx scripts/backfill-slack-display-names.test.ts`
  - `pnpm exec tsx scripts/typescript-conversation-decision-report.test.ts`
  - `pnpm exec tsx scripts/open-survey-reporting-cycle.test.ts`

## Known Harness Issues

- BMad `uv run` may fail in the sandbox if it tries to use `/Users/serzh/.cache/uv`; use `UV_CACHE_DIR=/tmp/entalent-bmad-uv-cache`.
- Do not run multiple `memlog.py append` calls against the same spec workspace in parallel; they race on `.memlog.md.tmp`.
- `project-context.md` is referenced by BMad customization but does not exist. It is already logged; do not invent it unless ownership is confirmed.
- Full `pnpm prepush` cannot be completed under a no-MAF boundary until script gates are split or the user explicitly authorizes the MAF script.

## Changed Files From This Slice

Core implementation:

- `apps/worker/src/survey/group-report.processor.ts`
- `apps/worker/src/survey/group-report.processor.test.ts`
- `apps/worker/src/survey/repositories/group-report-snapshot.repository.ts`
- `apps/worker/src/survey/survey.module.ts`
- `packages/application/src/use-cases/group-report.use-case.ts`
- `packages/application/src/use-cases/group-report.use-case.test.ts`
- `packages/database/src/schema/survey.ts`
- `packages/database/src/__tests__/survey-reporting-cohort.integration.test.ts`
- `packages/database/migrations/0016_fast_vision.sql`
- `packages/database/migrations/meta/0016_snapshot.json`
- `packages/database/migrations/meta/_journal.json`

Spec and status docs:

- `_bmad-output/specs/spec-pr5-first-immutable-report-snapshot-delivery/SPEC.md`
- `_bmad-output/specs/spec-pr5-first-immutable-report-snapshot-delivery/brownfield.md`
- `_bmad-output/specs/spec-pr5-first-immutable-report-snapshot-delivery/.memlog.md`
- `docs/grill-session-handoff.md`
- `docs/agent-failures.md`
- `docs/agent-task-log.md`

The broader tree contains many intentional changes from earlier Phase 2/3 slices. Do not use `git diff --stat` as a proxy for this slice without filtering paths.

## Recommended Next Move

First, decide whether the next session should close the remaining verification-harness gap or continue product implementation.

Recommended lazy order:

1. If the goal is to make this slice fully handoff-green, split the root script gate into non-MAF and MAF script groups so a no-MAF slice can run a complete deterministic gate without touching MAF.
2. If the goal is the next product slice, pick one of the deferred items explicitly. The most adjacent Phase 3 slice is later intermediate-report versions with the five-distinct-changed-input rule, but it should start with a fresh grill question before coding.

Do not start final reports, transfer cleanup, dashboard isolation, retention, numeric engagement, or customer manager auth without a scoped decision.

## Start Prompt For New Session

```text
Continue in /Users/serzh/Documents/enTalentNew on branch codex/grill-session-docs.

Use BMad and Ponytail full. Use CodeGraph before grep when exploring code.

Important boundaries:

- The working tree is intentionally dirty. Preserve all existing uncommitted docs, specs, migrations, tests, and implementation changes.
- Do not commit, push, merge, resolve PR conflicts, deploy, reset production, change Railway settings, or write real Slack without separate explicit permission.
- Do not touch MAF or agent-service.
- PR #5 is still open/conflicting; do not spend this slice resolving PR conflicts.

Read first:

- /Users/serzh/Documents/enTalentNew/_bmad-output/implementation-artifacts/handoff-2026-09-07-first-immutable-report-snapshot-delivery.md
- /Users/serzh/Documents/enTalentNew/docs/grill-session-handoff.md
- /Users/serzh/Documents/enTalentNew/docs/current-project-grill.md
- /Users/serzh/Documents/enTalentNew/docs/collected-product-requirements.md, especially REQ-024, REQ-027, REQ-028, REQ-029, REQ-032, REQ-037, REQ-044
- /Users/serzh/Documents/enTalentNew/_bmad-output/planning-artifacts/2026-09-03-pr5-product-conformance-audit-and-plan.md
- /Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-pr5-persisted-reporting-cohort-lifecycle/SPEC.md
- /Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-pr5-first-immutable-report-snapshot-delivery/SPEC.md
- /Users/serzh/Documents/enTalentNew/_bmad-output/specs/spec-pr5-first-immutable-report-snapshot-delivery/brownfield.md
- /Users/serzh/Documents/enTalentNew/docs/agent-failures.md
- /Users/serzh/Documents/enTalentNew/docs/agent-task-log.md

Current verified status:

- Grill discovery and the 47-requirement product contract are complete.
- Phase 0 and Phase 1 are complete.
- Phase 2 is complete locally; earlier disclosure/confirmation behavior was production-verified.
- Phase 3 is in progress.
- Persisted tenant/team/cycle reporting cohort lifecycle is locally complete and verified.
- First immutable report snapshot/delivery lifecycle is locally complete and verified except for the aggregate `pnpm test:scripts` gate limitation.
- The RED duplicate-send worker test initially failed because Slack was called twice, then passed after adding persisted snapshot idempotency.
- Application focused tests passed: 9/9.
- Worker focused tests passed: 5/5.
- Database integration passed outside sandbox: 24/24.
- Affected database/application/worker typecheck/lint/build passed.
- `pnpm prepush` passed typecheck/lint/package tests but stopped at sandbox TSX IPC before `test:scripts`.
- Aggregate `pnpm test:scripts` outside sandbox was rejected because it includes a MAF smoke script and this work forbids MAF/agent-service.
- Non-MAF script tests passed individually outside sandbox.
- `git diff --check` passed.

Implemented snapshot contract:

- First snapshot uniqueness is `(tenantId, reportingCohortId, pulseIndex/questionGroup, snapshotVersion=1)` for non-cancelled rows.
- `cancelled` releases the slot; `delivered` and `delivery_unknown` occupy it.
- Snapshot freezes exact `(workspaceConnectionId, managerSlackUserId)`.
- Binding is revalidated before delivery.
- Changed binding cancels the snapshot; snapshots are never retargeted.
- Snapshot is persisted only after AI returns complete manager payload.
- TypeScript revalidates contributors/target and atomically inserts immutable payload plus provenance.
- Only the insertion winner may call Slack.
- No pre-AI `generating` state was added.
- Pre-send TypeScript scope/target validation failure -> `cancelled`.
- Slack receipt with valid external message ID -> `delivered`.
- Any exception after Slack send begins -> `delivery_unknown`.
- No Slack provider-specific error taxonomy was added.
- `delivery_unknown` must not be retried automatically and blocks later snapshots for the same tenant/cohort/Pulse Index until explicit reconciliation.

Files to inspect for this slice:

- apps/worker/src/survey/group-report.processor.ts
- apps/worker/src/survey/group-report.processor.test.ts
- apps/worker/src/survey/repositories/group-report-snapshot.repository.ts
- apps/worker/src/survey/survey.module.ts
- packages/application/src/use-cases/group-report.use-case.ts
- packages/application/src/use-cases/group-report.use-case.test.ts
- packages/database/src/schema/survey.ts
- packages/database/src/__tests__/survey-reporting-cohort.integration.test.ts
- packages/database/migrations/0016_fast_vision.sql
- packages/database/migrations/meta/0016_snapshot.json

Recommended next move:

Option A, if the goal is to make the current slice fully handoff-green: split script gates so non-MAF slices can run a complete deterministic prepush-equivalent without executing `scripts/live-maf-primary-app-smoke.test.ts`. Keep the change minimal and do not touch MAF or agent-service.

Option B, if the goal is product work: ask one grill question before coding the next Phase 3 slice. The most adjacent slice is later intermediate-report versions with the five-distinct-changed-input rule. Do not start final reports, transfer cleanup, dashboard isolation, retention, numeric engagement, or customer manager auth without a scoped decision.

Before any new code, show the minimal shared-boundary fix plan. Keep AI out of decisions; TypeScript/PostgreSQL own policy, proof, persistence, delivery state, idempotency, and scope rejection.
```

---
title: 'RPT-02: Frozen report scopes and permission state'
type: 'feature'
created: '2026-10-22'
status: 'done'
baseline_commit: '237d7075ff08f262ccf3cbe2bf7c36cb390d204e'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/pulse-check-reports/RPT-02-DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/pulse-check-reports/FUNCTIONAL-REQUIREMENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Legacy cohorts lack org-native Manager/TL audiences and safe lifecycle/withdrawal state.

**Approach:** Freeze scopes at opening, bind windows, persist atomic stops and lineage exclusions. The required design defines transactions; later reporting consumers remain separate.

## Boundaries & Constraints

**Always:** Tenant isolation; frozen affiliation; deduplicated Manager overall, own-TL exclusion per team. Departure preserves denominator; full withdrawal adjusts unpublished intermediate denominator; partial does not. Use durable server receipt proof. Preserve delivered reports, retention/erasure duties and completed RPT-01.

**Ask First:** Historical hierarchy reconstruction, permission grants, public rights routes, live opening, production migration/activation, model/Slack egress.

**Never:** Guess legacy/org identity, equate onboarding/admin status with consent, move old insights into destination scopes, retarget snapshots, revive withdrawn/private/expired data, or modify MAF/unrelated work.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Open/replay | Two teams of five plus TLs | Twelve overall, five/team; identical replay | Invalid graph/conflicts roll back |
| Window | Frozen org participant, no legacy mapping | Atomic V2 binding | No fallback/rebinding |
| Departure | Confirmation receipt before stop | Delayed finalization retains origin | Late/missing proof excluded |
| Full/partial | Two full withdrawals; one topic exclusion | N=8/threshold7; partial keeps N | Idempotent; no resurrection |
| Race/privacy | Concurrent mutations; wrong tenant/subject | Durable exclusions prevail | No coaching failure |

</frozen-after-approval>

## Code Map

- `apps/worker/src/survey/repositories/survey.repository.ts` — opening/window path.
- Required RPT-02 design maps the remaining transaction surfaces.

## Tasks & Acceptance

**Execution:**
- [x] `packages/application/src/ports/pulse-report-scope.repository.port.ts`, `use-cases/pulse-report-scope-policy.ts`, `open-survey-reporting-cycle.use-case.ts`, `index.ts` — typed scope/opening and receipt/denominator policies.
- [x] `packages/application/src/ports/reporting-permission.repository.port.ts`, `use-cases/withdraw-reporting-permission.use-case.ts` — verified request, full/lineage targets, idempotency; no public route/grant.
- [x] `packages/database/src/schema/survey-report-scopes.ts`, `schema/index.ts`, `src/index.ts`, `migrations/` — tenant-safe freeze, lineage/exclusion/revision/receipt state and forward migration/metadata.
- [x] `apps/worker/src/survey/repositories/pulse-report-scope.repository.ts`, `reporting-permission.repository.ts`, `survey.repository.ts`, `survey.module.ts`, `scripts/open-survey-reporting-cycle.ts` — actual org-native open/window branch; legacy default preserved.
- [x] `apps/api/src/hierarchy/hierarchy-mutation.service.ts`, `hierarchy-deactivation.service.ts` — earliest stops inside mutation transactions.
- [x] `apps/worker/src/survey/repositories/question-insight.repository.ts`, application `finalize-question-insight.use-case.ts`, `conversation-orchestrator.ts`, `proactive-check-in.use-case.ts`, `survey-evidence.use-case.ts`, `services/pulse-backlog.service.ts` — admission/commit proof and safe collection-unavailable handling per design.
- [x] `apps/worker/src/retention/retention.repository.ts` — metadata cleanup without restoring suppressed sources.
- [x] Colocated tests plus `packages/database/src/__tests__/pulse-report-scopes.integration.test.ts` — matrix, opening/window atomicity, lineage backfill, mutation races and legacy/retention regressions.
- [x] `docs/agent-task-log.md`, `docs/agent-failures.md`, Reports implementation plan — actual evidence and remaining consumers.

**Acceptance Criteria:**
- Given the product branch, when legacy/RPT-01 regressions run, then old opening/snapshot contracts and metric behavior remain intact; all new matrix outcomes hold through actual transactions.

## Spec Change Log

## Design Notes

FR-004–007 policy/state and opening integration only. RPT-05/07 own report consumption/delivery; RPT-08 must supply verified employee-request integration before activation. Stable history excludes roster/recipient identity; opening owner is audit metadata, not a new delivery policy.

## Verification

- `pnpm db:generate`, `pnpm --filter @entalent/database db:migrate` — forward migration reviewed/applied to a fresh isolated local DB.
- `pnpm --filter './packages/*' build` — rebuild changed outputs before consumers.
- Application/worker/API package tests and `pnpm --filter @entalent/database test:integration` — migrated invariants/races and legacy behavior pass.
- `pnpm typecheck`, `pnpm lint`, `pnpm harness:check -- --base 237d7075ff08f262ccf3cbe2bf7c36cb390d204e` — structured receipt, isolated local DB/Redis where needed. Final evidence below supersedes the initial pre-review checks. No live model, Slack or production acceptance was attempted.

## Implementation Evidence

- Local criteria: immutable org-native audiences/window binding, legacy default, half-open trusted receipt admission, atomic lifecycle stops, permanent full/lineage exclusions and safe concurrency without changing private coaching or delivery evidence.
- Migrations 0054–0059 applied on clean task-owned PostgreSQL databases. Actual membership constraints have both short tenant/cycle FKs; historical backfill uses existing metadata only.
- GREEN after review: application 1,245; API 358; database 51 (23 RPT-02); worker 443, including explicitly enabled deterministic queue (7/7 separately). Workspace typecheck and lint: 24/24 each. Unrelated optional worker checks remain skipped.
- Behavioral RED covers prepared-evidence withdrawal, pending-work exclusions, late staging and trusted-clock correction/reopen. A real DatabaseService UnitOfWork regression verifies outbound/prior-write rollback, one persisted coaching fallback and no repeated generation.
- Both fresh independent BMad reviewers rechecked the corrections with no remaining concrete blockers. Their evidence is source review; the suite counts above record separate test execution.
- Final root harness passed: [structured receipt](../../runs/harness/receipt-1792678607317-65e808d4.json). Live model/Slack, public rights ingress, grants and production activation remain outside this foundation's acceptance.
- RPT-01 source/tests and frozen approved intent remain unchanged. No commit, push or deployment.

## Suggested Review Order

**Opening and immutable identity**

- Follow explicit org-native opening while preserving the legacy default.
  [open-survey-reporting-cycle.use-case.ts:11](../../packages/application/src/use-cases/open-survey-reporting-cycle.use-case.ts#L11)

- Freeze validated hierarchy once under the shared cycle lock.
  [pulse-report-scope.repository.ts:12](../../apps/worker/src/survey/repositories/pulse-report-scope.repository.ts#L12)

- Inspect durable scope, lineage and receipt boundaries.
  [0054_melted_doctor_doom.sql:1](../../packages/database/migrations/0054_melted_doctor_doom.sql#L1)

**Permission and lifecycle boundaries**

- Serialize withdrawal and settle only excluded reporting work.
  [reporting-permission.repository.ts:10](../../apps/worker/src/survey/repositories/reporting-permission.repository.ts#L10)

- Keep stops inside the hierarchy mutation transaction.
  [hierarchy-mutation.service.ts:124](../../apps/api/src/hierarchy/hierarchy-mutation.service.ts#L124)

- Check short composite foreign keys before the erasure guard.
  [0058_public_mole_man.sql:1](../../packages/database/migrations/0058_public_mole_man.sql#L1)

**Safe collection and confirmation**

- Apply surviving components while preserving original displayed identity.
  [question-insight.repository.ts:619](../../apps/worker/src/survey/repositories/question-insight.repository.ts#L619)

- Rollback denied staging and persist one coaching-only response.
  [conversation-orchestrator.ts:1347](../../packages/application/src/use-cases/conversation-orchestrator.ts#L1347)

- Permit only permission-related shrinkage of prepared evidence.
  [survey-evidence.use-case.ts:100](../../packages/application/src/use-cases/survey-evidence.use-case.ts#L100)

**Proof and supporting changes**

- Inspect migrated races, clocks, erasure and actual transaction rollback.
  [pulse-report-scopes.integration.test.ts:21](../../packages/database/src/__tests__/pulse-report-scopes.integration.test.ts#L21)

- Verify staging fallback leaves no invalid survey metadata.
  [conversation-orchestrator.test.ts:7161](../../packages/application/src/use-cases/conversation-orchestrator.test.ts#L7161)

- Complete dependency rebuilds before consumer tests read dist.
  [AGENTS.md:321](../../AGENTS.md#L321)

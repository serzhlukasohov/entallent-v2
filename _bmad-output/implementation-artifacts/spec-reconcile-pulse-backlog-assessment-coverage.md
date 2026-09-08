---
title: 'Reconcile Pulse Backlog with Assessment Coverage'
type: 'bugfix'
created: '2026-08-30'
status: 'done'
baseline_commit: '60c3a7c30d277d858234abd0584d2b897edcec16'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-engagement-window-numeric-index-focus.md'
  - '{project-root}/docs/adr/ADR-007-survey-evidence-state-machine.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The qualitative survey evidence path marks a pulse backlog question `done` even when the resulting assessment is `insufficient_evidence`. Production now contains stale `done` rows without completed assessments, so the focused-index selector can see a group at 2/3 while having no pending question left to reach 3/3.

**Approach:** Align backlog closure with the same assessment statuses used by index progress, and lazily reconcile existing regular backlog rows whenever the backlog is initialized. Reopen only stale `done` rows whose question is not in the current covered-assessment set; avoid a migration or manual production rewrite.

## Boundaries & Constraints

**Always:** Keep the active runtime TypeScript-only. Preserve question IDs, positions, `ignore_count`, tenant/user/window scoping, active probes, existing evidence, and assessment history. Treat qualitative `partially_covered`, `covered`, and `scored` as complete; treat `insufficient_evidence` as incomplete. Keep numeric completion restricted to `scored` with a stored explicit score.

**Ask First:** Any manual production data update, historical evidence/assessment rewrite, schema migration, deployment, commit/push, or change to the accepted meaning of `partially_covered`.

**Never:** Touch, invoke, test, deploy, or extend MAF/`agent-service`; reopen active probes; delete evidence or assessments; add a new table, queue, feature flag, or background repair job.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Weak qualitative evidence | Assessment resolves to `insufficient_evidence` | Persist assessment/evidence but do not close the backlog question | Question remains selectable for a later probe |
| Usable qualitative evidence | Assessment resolves to `partially_covered`, `covered`, or `scored` | Mark the corresponding backlog question `done` | Existing idempotency remains |
| Stale legacy closure | Regular backlog row is `done`, but its question is absent from `coveredQuestionIds` | Reopen it as `pending`, clear stale closure/probe outcome fields, preserve position and ignore count | Update is scoped to `done` rows for supplied question IDs only |
| In-flight probe | Uncovered row is `active` | Leave it active | Existing ignore-resolution policy remains responsible |
| Valid closure | `done` row belongs to a covered question | Leave it unchanged | No-op |
| Missing rows | Some or all supplied regular questions have no backlog row | Insert missing rows idempotently with status derived from coverage | Unique constraint absorbs concurrent/repeated initialization |

</frozen-after-approval>

## Code Map

- `packages/application/src/use-cases/survey-evidence.use-case.ts` -- decides when saved evidence closes a backlog question.
- `packages/application/src/use-cases/survey-evidence.use-case.test.ts` -- regression for insufficient qualitative evidence.
- `apps/worker/src/survey/repositories/pulse-backlog.repository.ts` -- idempotent initialization and lazy stale-row reconciliation.
- `apps/worker/src/survey/repositories/pulse-backlog.repository.test.ts` -- repository boundary regression for reopen state.
- `packages/application/src/ports/pulse-backlog.repository.port.ts` -- documents the strengthened initialization contract.

## Tasks & Acceptance

**Execution:**
- [x] `packages/application/src/use-cases/survey-evidence.use-case.test.ts` -- add a failing regression proving insufficient qualitative evidence does not close backlog.
- [x] `packages/application/src/use-cases/survey-evidence.use-case.ts` -- gate qualitative closure on completed assessment statuses.
- [x] `apps/worker/src/survey/repositories/pulse-backlog.repository.test.ts` -- add a failing repository regression for lazy reopening and field reset.
- [x] `apps/worker/src/survey/repositories/pulse-backlog.repository.ts` -- idempotently insert missing questions and reopen only stale uncovered `done` rows.
- [x] `packages/application/src/ports/pulse-backlog.repository.port.ts` -- update contract documentation without adding a new interface.
- [x] `docs/agent-task-log.md` -- append concise verification evidence while preserving existing edits.

**Acceptance Criteria:**
- Given an incomplete focused group with a stale `done` question, when the next probe is selected, then that question is pending again and the group can progress to 3/3.
- Given new insufficient qualitative evidence, when extraction persists its assessment, then backlog state is not transitioned to `done`.
- Given an active or validly completed backlog row, when reconciliation runs, then its state is unchanged.
- Given the fix is exercised, when runtime dependencies are traced, then no MAF/`agent-service` path is registered or called.

## Spec Change Log

## Design Notes

Reusing `initializeIfNeeded` as an idempotent initialize-and-reconcile boundary is the smallest durable repair. The method already receives the complete regular question set and the assessment-derived `coveredQuestionIds` on every selection attempt, so no new port, table, job, or migration is needed.

## Verification

**Commands:**
- `pnpm --filter @entalent/application test -- survey-evidence.use-case.test.ts pulse-backlog.service.test.ts` -- insufficient evidence remains open and focused selection stays green.
- `pnpm --filter @entalent/worker test -- pulse-backlog.repository.test.ts` -- stale `done` rows are reconciled without disturbing valid states.
- `pnpm --filter @entalent/application build` -- refresh the application package contract consumed by worker.
- `pnpm --filter @entalent/application typecheck && pnpm --filter @entalent/application lint` -- application contract and implementation checks.
- `pnpm --filter @entalent/worker typecheck && pnpm --filter @entalent/worker lint` -- worker adapter contract and implementation checks.
- `pnpm harness:check -- --base 60c3a7c` -- deterministic receipt with changed active tests only.

**Results:**
- RED: application regression failed because `insufficient_evidence` called `markQuestionCovered`; repository regression failed because an existing row caused early return before reconciliation.
- Review RED: snapshot propagation failed 1/25 service tests; concurrency cutoff and tie-break ordering failed 2/7 repository tests.
- GREEN: focused application tests 45/45 and worker repository tests 7/7 passed; application build plus application/worker typecheck and lint passed; targeted `git diff --check` passed.
- Harness GREEN: diff-check, typecheck, lint, and changed active tests passed; receipt `runs/harness/receipt-1788101841890-66e721c2.json`. No retired override was supplied and no retired test was selected.

## Suggested Review Order

**Completion semantics**

- Align backlog closure with the assessment statuses used by group progress.
  [`survey-evidence.use-case.ts:222`](../../packages/application/src/use-cases/survey-evidence.use-case.ts#L222)

- Prove weak qualitative evidence persists without closing its backlog row.
  [`survey-evidence.use-case.test.ts:169`](../../packages/application/src/use-cases/survey-evidence.use-case.test.ts#L169)

**Lazy reconciliation**

- Capture the assessment snapshot at the read boundary for race-safe repair.
  [`pulse-backlog.service.ts:52`](../../packages/application/src/services/pulse-backlog.service.ts#L52)

- Reopen only stale uncovered closures while preserving queue history.
  [`pulse-backlog.repository.ts:21`](../../apps/worker/src/survey/repositories/pulse-backlog.repository.ts#L21)

- Keep the snapshot cutoff explicit in the repository contract.
  [`pulse-backlog.repository.port.ts:35`](../../packages/application/src/ports/pulse-backlog.repository.port.ts#L35)

- Verify snapshot timing before exercising repository reconciliation.
  [`pulse-backlog.service.test.ts:144`](../../packages/application/src/services/pulse-backlog.service.test.ts#L144)

- Verify idempotent insert, scoped reset, and concurrent-closure protection.
  [`pulse-backlog.repository.test.ts:52`](../../apps/worker/src/survey/repositories/pulse-backlog.repository.test.ts#L52)

**Deterministic selection**

- Break legacy duplicate-position ties with canonical question display order.
  [`pulse-backlog.repository.ts:185`](../../apps/worker/src/survey/repositories/pulse-backlog.repository.ts#L185)

- Lock the tie-break behavior with a focused SQL-order regression.
  [`pulse-backlog.repository.test.ts:151`](../../apps/worker/src/survey/repositories/pulse-backlog.repository.test.ts#L151)

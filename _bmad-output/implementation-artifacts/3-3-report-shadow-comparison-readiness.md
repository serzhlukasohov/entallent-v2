---
baseline_commit: 8cacbfe089f8784ad3da34d3c370eb70a9a39c10
---

# Story 3.3: Report Shadow Comparison Readiness

Status: review
Epic: 3 - Baseline And Shadow Comparison
Story ID: 3.3

## Story

As a product reviewer,
I want a summarized shadow comparison report,
so that the team can decide when MAF is ready for canary.

## Acceptance Criteria

1. Given shadow diagnostics exist for baseline scenarios, when the report is generated, then it summarizes quality, risk parity, memory/action differences, latency, model-call count, tool-call count, estimated cost, and validation failures.
2. Given critical risk false negatives or duplicate action proposals are detected, when the report is evaluated, then canary readiness is blocked.
3. Given baseline gate output requires manual review or baseline scenario coverage is incomplete, when the report is evaluated, then canary readiness is not `ready` and the blocking/manual-review reasons are machine-readable.
4. Given this story is complete, when the diff is inspected, then no `agent-service`, FastAPI route, MAF workflow, `MafAgentRuntimeClient`, production shadow execution branch, canary routing behavior, user-facing runtime behavior, or dashboard/admin UI has been added.

## Tasks / Subtasks

- [x] Define the shadow readiness report contract. (AC: 1, 2, 3)
  - [x] Add a stable TypeScript report model near the worker conversation runtime code, not in shared domain contracts.
  - [x] Include report metadata: generated time, tenant ID, optional time window, diagnostic count, runtime versions, scenario IDs, migration case IDs, and trace IDs.
  - [x] Include status values such as `ready`, `blocked`, `manual_review_required`, and `insufficient_data`; do not reuse `passed` when manual review remains open.
  - [x] Include machine-readable reason codes for all blockers and warnings.
- [x] Add a read-only reporter over existing diagnostics. (AC: 1, 2, 3)
  - [x] Read from `runtime_shadow_diagnostics`; do not create a new diagnostics table.
  - [x] Group records by baseline scenario/case identifiers from redacted diagnostic metadata, for example `validationDetails.scenarioId` and `validationDetails.migrationCaseIds`.
  - [x] Treat missing or unmapped baseline case coverage as `insufficient_data` or `blocked`, not as ready.
  - [x] Summarize quality and validation using existing stable fields: `validationStatus`, `validationDetails.reasonCodes`, redaction status, and runtime version.
  - [x] Summarize risk parity from `riskComparison`, with critical risk false negatives as a hard blocker.
  - [x] Summarize memory/action differences from `memoryComparison` and `actionComparison`, with duplicate action proposals as a hard blocker.
  - [x] Summarize latency, model-call count, tool-call count, retry count, and estimated cost with count, mean, max, and p95 where enough samples exist.
- [x] Integrate conversation-sim gate summary as rollout context. (AC: 2, 3)
  - [x] Reuse `packages/conversation-sim` gate summary shape instead of inventing a second baseline gate format.
  - [x] Accept a parsed `summary.json` object or path as input to the reporter if file access is needed.
  - [x] Preserve Story 3.1 semantics: `manual_review_required` is not canary-ready even when automated thresholds pass.
  - [x] Surface `manualReview.requiredScenarioIds` and `manualReview.requiredCaseIds` in the readiness report.
- [x] Keep reports privacy-safe. (AC: 1, 4)
  - [x] Never include raw response text, raw model prompts, provider responses, risk evidence snippets, memory content, action payload contents, tenant/workspace/user names, or provider stack traces.
  - [x] Report only redacted diagnostics, stable digests, IDs, counts, reason codes, statuses, and aggregate metrics.
  - [x] Treat `redactionStatus = rejected` or unsafe/unexpected diagnostic payload shape as a readiness blocker.
- [x] Add focused tests. (AC: 1, 2, 3, 4)
  - [x] Unit-test aggregation from synthetic diagnostics records.
  - [x] Unit-test `ready`, `blocked`, `manual_review_required`, and `insufficient_data` status precedence.
  - [x] Unit-test blockers for critical risk false negatives, duplicate action proposals, validation failures, redaction rejection, and missing baseline case coverage.
  - [x] Unit-test that report serialization does not include raw diagnostic text.
  - [x] Add a scope regression assertion that no `agent-service`, `MafAgentRuntimeClient`, production shadow execution, canary routing, or UI files were introduced.
- [x] Update implementation docs and sprint tracking. (AC: 1-4)
  - [x] Document the report shape, status precedence, blocker reason codes, and out-of-scope runtime wiring in this story's Dev Agent Record.
  - [x] Update `_bmad-output/specs/spec-maf-runtime-migration/validation-baseline.md` only if report semantics clarify the baseline gate; do not rewrite Story 3.1 coverage.
  - [x] Update `sprint-status.yaml` from `ready-for-dev` to `in-progress` during dev-story and to `review` when complete.
- [x] Run and record verification. (AC: 1-4)
  - [x] Run targeted unit tests for the new readiness reporter.
  - [x] Run `pnpm --filter @entalent/worker test`.
  - [x] Run `pnpm test`.
  - [x] Run `git diff --check`.

## Dev Notes

### Current Architecture Context

- AD-6 requires shadow mode to record current and candidate results with trace IDs, runtime versions, validation status, latency, model-call count, tool-call count, cost, risk, memory candidates, and proposed actions.
- AD-9 says evaluation gates block rollout. This story reports readiness; it must not enable canary routing.
- AD-10 says deterministic policy outranks agent output. Critical risk false negatives and duplicate side-effect proposals are hard blockers even if prose quality looks good.
- AD-18 says shadow diagnostics have a canonical TypeScript-owned store. Use `runtime_shadow_diagnostics`; do not create an alternate report input store.
- AD-19 says `agent-service` is later work. Do not scaffold Python service, FastAPI route, MAF workflow, runtime client, or production shadow execution here.

### Existing Code To Reuse

- `packages/database/src/schema/runtime-shadow-diagnostics.ts` defines the canonical diagnostics table with query indexes on tenant/date, trace ID, message ID, runtime attempt ID, validation status, and redaction status.
- `apps/worker/src/conversation/shadow-diagnostics.repository.ts` owns redaction-before-write and idempotent diagnostics persistence.
- `packages/conversation-sim/src/gate/run-gate.ts` defines the current `summary.json` shape, including `status`, `manualReview.requiredScenarioIds`, `manualReview.requiredCaseIds`, scenario thresholds, sample logs, and report file references.
- `packages/conversation-sim/src/scenarios/migration-baseline.ts` defines the independent required migration case ID list. Use this list to detect missing coverage instead of deriving coverage from observed diagnostics.
- `packages/conversation-sim/src/harness/report.ts` writes local scenario reports that still contain raw response text; do not copy raw `turns.responseText` into the readiness report.
- `apps/worker/src/conversation/runtime-ledger.repository.ts` and `runtime-ledger.repository.test.ts` show the local mocked Drizzle repository test style.

### Recommended Report Semantics

Use deterministic status precedence:

1. `blocked` if any hard blocker is present.
2. `manual_review_required` if no hard blockers exist but baseline gate summary or sensitive scenarios require human review.
3. `insufficient_data` if no hard blockers/manual-review blockers exist but required baseline cases have no mapped diagnostics.
4. `ready` only when blockers are absent, manual review is cleared, and required baseline case coverage is complete.

Hard blocker reason codes should include at least:

- `critical_risk_false_negative`
- `duplicate_action_proposal`
- `validation_failure`
- `comparison_failed`
- `redaction_rejected`
- `missing_baseline_coverage`

Warnings can include non-blocking differences such as higher latency, higher model/tool call count, higher estimated cost, memory differences, or action differences that are not duplicates.

### Diagnostics Metadata Guidance

Story 3.2 intentionally stores comparison details as redacted JSONB. For Story 3.3, do not add schema columns unless unavoidable. Prefer stable metadata inside existing JSON fields:

- `validationDetails.scenarioId`
- `validationDetails.migrationCaseIds`
- `validationDetails.reasonCodes`
- `riskComparison.currentSeverity`
- `riskComparison.candidateSeverity`
- `riskComparison.falseNegative`
- `riskComparison.criticalFalseNegative`
- `memoryComparison.status`
- `memoryComparison.falsePositiveCount`
- `actionComparison.status`
- `actionComparison.duplicateProposalCount`

If existing rows lack these fields, report them as unmapped or insufficient rather than assuming success.

### Previous Story Intelligence

Story 3.2 completed at commit `8cacbfe089f8784ad3da34d3c370eb70a9a39c10` after BMAD review fixes.

Relevant learnings:

- Redaction must be fail-closed. Reports must not rehydrate or copy raw strings from diagnostics, simulation reports, provider errors, memory contents, or action payloads.
- Drizzle metadata must include snapshots when journal entries are added. This story should avoid migrations unless a schema change is truly required.
- Repository writes validate attempt trace/runtime metadata; reporting should preserve trace linkage without mutating attempts.
- Sequential verification matters when one package build cleans another package's `dist` directory; avoid running `@entalent/database build` in parallel with `@entalent/worker test`.

Story 3.1 completed at commit `c14a9e35c3f3e8a18d94d3aa723146bca9e939e6`.

Relevant learnings:

- Manual review is a blocking/reportable state, not advisory metadata.
- Deterministic-only artifacts must not pretend an LLM judge ran.
- Baseline coverage checks must use `REQUIRED_MIGRATION_BASELINE_CASE_IDS`, not a self-referential observed list.
- Live simulation gates may be unavailable locally because model/LangWatch endpoints can fail with DNS errors; record exact skip reasons instead of claiming green live gates.

### Out Of Scope

- `agent-service/`
- `MafAgentRuntimeClient`
- FastAPI routes
- MAF workflow code
- Python service code
- production shadow execution branch
- canary routing or rollout flag changes
- dashboard/admin UI
- Slack adapter, BullMQ queue, or worker processor behavior changes
- real candidate MAF execution
- user-facing runtime behavior changes
- new model calls, LLM-as-judge calls, or live simulation runs in root tests

### Testing Requirements

- Use synthetic diagnostics fixtures; do not require a live Python service, live model call, Slack, Redis, BullMQ, or Postgres for unit tests.
- If database integration is added, skip only when `DATABASE_URL` is absent and record the exact reason.
- Keep root `pnpm test` green. Do not add `conversation-sim` live runs to root tests.
- Add negative serialization tests that prove raw response text, evidence, memory content, action payloads, and provider errors are absent from generated report JSON/Markdown.

## References

- `_bmad-output/planning-artifacts/epics.md` - Epic 3 Story 3.3 requirements and FR16/FR17/FR18 mapping.
- `_bmad-output/specs/spec-maf-runtime-migration/SPEC.md` - CAP-3 and CAP-4 shadow/regression goals.
- `_bmad-output/specs/spec-maf-runtime-migration/validation-baseline.md` - required baseline cases, metrics, safety gate, and manual review rule.
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md` - AD-6, AD-9, AD-10, AD-18, AD-19.
- `_bmad-output/implementation-artifacts/3-1-expand-migration-baseline-scenarios.md` - baseline gate semantics and review lessons.
- `_bmad-output/implementation-artifacts/3-2-add-shadow-diagnostics-record.md` - diagnostics table, redaction policy, and review lessons.
- `packages/database/src/schema/runtime-shadow-diagnostics.ts` - canonical diagnostics schema.
- `apps/worker/src/conversation/shadow-diagnostics.repository.ts` - diagnostics persistence and redaction guard.
- `packages/conversation-sim/src/gate/run-gate.ts` - gate summary shape and manual review status semantics.
- `packages/conversation-sim/src/scenarios/migration-baseline.ts` - independent required migration case list.
- `packages/conversation-sim/src/harness/report.ts` - local scenario report shape and raw-text warning.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story created from sprint backlog after Story 3.2 was completed and reviewed at commit `8cacbfe089f8784ad3da34d3c370eb70a9a39c10`.
- Loaded BMAD create-story workflow, config, sprint status, Epic 3 Story 3.3 requirements, architecture spine, SPEC, validation baseline, Story 3.1, Story 3.2, conversation-sim gate/report code, diagnostics schema, and recent git history.
- No `project-context.md` or UX artifact was found; this story is backend/runtime evaluation reporting work.
- Started dev-story implementation from baseline `8cacbfe089f8784ad3da34d3c370eb70a9a39c10`.
- RED: `pnpm --filter @entalent/worker test -- shadow-readiness-report.service.test.ts` failed because `shadow-readiness-report.service` did not exist.
- GREEN: `pnpm --filter @entalent/worker test -- shadow-readiness-report.service.test.ts` passed with 7 tests after adding the readiness report builder/service.
- Verification: `pnpm --filter @entalent/worker build` passed.
- Verification: `pnpm --filter @entalent/worker test -- conversation.module.test.ts` passed with 5 tests.
- Verification: `pnpm --filter @entalent/worker test` passed with 62 tests.
- Verification: `pnpm --filter @entalent/worker lint` passed with one existing warning in `apps/worker/src/main.ts`.
- Verification: `pnpm test` passed with 15 successful turbo tasks.
- Verification: `git diff --check` passed.
- Verification: scope check found no `agent-service`, MAF client, FastAPI, or production shadow execution wiring.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Guardrails explicitly prevent early `agent-service`, `MafAgentRuntimeClient`, FastAPI route, MAF workflow, production shadow execution, canary routing, UI work, and user-facing runtime behavior changes.
- Added a read-only `ShadowReadinessReportService` that selects tenant-scoped diagnostics from `runtime_shadow_diagnostics` and builds a privacy-safe readiness report.
- Added a pure `buildShadowReadinessReport` contract with status precedence for `blocked`, `manual_review_required`, `insufficient_data`, and `ready`.
- Added hard blockers for baseline gate failure, critical risk false negatives, duplicate action proposals, validation failure, comparison failure, and redaction rejection.
- Added report summaries for quality, risk parity, memory/action differences, latency, model-call count, tool-call count, retry count, estimated cost, runtime versions, scenario IDs, migration case IDs, and trace IDs.
- Added synthetic unit tests proving status precedence, blocker reason codes, missing baseline coverage, manual review handling, privacy-safe serialization, and read-only diagnostics loading.

### File List

- `_bmad-output/implementation-artifacts/3-3-report-shadow-comparison-readiness.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/worker/src/conversation/conversation.module.ts`
- `apps/worker/src/conversation/shadow-readiness-report.service.ts`
- `apps/worker/src/conversation/shadow-readiness-report.service.test.ts`

### Change Log

- 2026-08-05: Created Story 3.3 developer context from Epic 3, architecture spine, SPEC, validation baseline, Story 3.1 lessons, Story 3.2 diagnostics/redaction lessons, and existing conversation-sim gate/report formats.
- 2026-08-05: Implemented read-only shadow readiness report service, privacy-safe aggregation contract, status/blocker semantics, tests, and verification for Story 3.3.

---
baseline_commit: dce563c
---

# Story 6.1: Add Canary Gate Evaluation

Status: done
Epic: 6 - Canary Readiness And Rollout Gates
Story ID: 6.1

## Story

As a release owner,
I want canary readiness computed from baseline and shadow results,
so that MAF cannot be exposed before safety and quality thresholds pass.

## Acceptance Criteria

1. Given baseline and shadow diagnostics exist, when canary readiness is evaluated, then the gate checks critical risk false negatives, duplicate scheduled actions, sensitive memory false positives, validation failures, latency, and cost.
2. Given any blocking metric fails, when the gate result is produced, then canary mode remains disabled.
3. Given this story is complete, when the diff is inspected, then it adds only canary gate evaluation and report/decision data; it must not enable `maf_canary` execution, staged rollout cohorts, Python-owned writes, Python command tools, dashboard/admin UI, deployment mutation, or user-facing MAF replies.
4. Given gate results, blockers, warnings, or diagnostics are serialized, logged, or tested, then raw Slack/user text, prompts, bearer tokens, service secrets, full request/candidate payloads, risk evidence snippets, memory content, action payloads, provider errors, and stack traces are not exposed.

## Tasks / Subtasks

- [x] Reuse and extend the existing shadow readiness report as the canary gate input. (AC: 1, 2, 3, 4)
  - [x] Use `apps/worker/src/conversation/shadow-readiness-report.service.ts`; do not create a second diagnostics store or duplicate baseline coverage logic.
  - [x] Keep reading from `runtime_shadow_diagnostics` through the existing tenant-scoped read-only service path.
  - [x] Preserve existing blockers: `baseline_gate_failed`, `critical_risk_false_negative`, `duplicate_action_proposal`, `validation_failure`, `comparison_failed`, `redaction_rejected`, `diagnostic_payload_malformed`, and missing baseline gate/coverage insufficient-data states.
  - [x] Ensure all default required case IDs continue to come from `REQUIRED_MIGRATION_BASELINE_CASE_IDS` in `@entalent/contracts`.
- [x] Add explicit canary gate thresholds and decision output. (AC: 1, 2, 4)
  - [x] Introduce a small gate config/type near the shadow readiness service for latency and cost thresholds; keep defaults deterministic and local-test friendly.
  - [x] Evaluate latency using existing metric summaries. If p95 is `null` due sparse samples, use max/mean according to a documented fail-closed rule rather than treating sparse p95 as passing.
  - [x] Evaluate estimated cost using existing metric summaries; do not introduce provider billing calls.
  - [x] Add a gate decision shape that makes exposure explicit, for example `canaryEnabled: false` unless report status is `ready` and threshold blockers are absent.
  - [x] Include machine-readable blocker/warning reason codes for latency and cost regressions.
- [x] Add sensitive memory false-positive gating. (AC: 1, 2, 4)
  - [x] Treat positive `memoryComparison.falsePositiveCount` as a blocker when the diagnostic maps to a sensitive migration case.
  - [x] Add a distinct stable reason code such as `sensitive_memory_false_positive`.
  - [x] Keep non-sensitive memory differences as warnings unless the configured threshold says otherwise.
  - [x] Do not inspect or serialize raw memory candidate content.
- [x] Keep canary mode disabled in runtime routing for this story. (AC: 2, 3)
  - [x] Do not make `AgentRuntimeRouter` call `MafAgentRuntimeClient.processCandidate` or return MAF output for `maf_canary`.
  - [x] Do not add staged rollout cohorts, percentage buckets, internal-user targeting, workspace targeting, or feature-flag mutation; Story 6.2 owns rollout controls.
  - [x] If a reusable gate evaluator is added to application code, make it a pure decision helper and do not wire it into runtime routing yet.
- [x] Update scope-regression guardrails. (AC: 3)
  - [x] Replace any stale Story 3.3 assertions that expect `agent-service` or `MafAgentRuntimeClient` to be absent; those are now valid Epic 4/5 surfaces.
  - [x] Assert Story 6.1 does not enable `maf_canary` execution, staged rollout code, dashboard/admin UI, deployment mutation, Python command tools, or Python-owned writes.
  - [x] Keep guardrails that the gate reads TypeScript-owned diagnostics and does not write runtime attempts/actions or mutate feature flags.
- [x] Add focused tests. (AC: 1-4)
  - [x] Unit-test gate decision `canaryEnabled: false` for validation failures, comparison failures, redaction rejection, malformed payloads, missing baseline gate summary, missing required baseline coverage, critical risk false negatives, duplicate action proposals, sensitive memory false positives, latency threshold failures, and cost threshold failures.
  - [x] Unit-test a clean, fully covered, non-sensitive, threshold-compliant report produces a ready gate decision.
  - [x] Unit-test `manual_review_required` and `insufficient_data` remain non-enabled states, even without hard blockers.
  - [x] Unit-test serialization does not include raw current/candidate text, risk evidence, memory content, action payloads, provider errors, bearer tokens, secrets, stack traces, or full payloads.
  - [x] Unit-test `AgentRuntimeRouter` still does not invoke MAF candidates for `maf_canary` in this story.
- [x] Update docs and tracking. (AC: 1-4)
  - [x] Document canary gate status precedence, threshold defaults, reason codes, and non-enablement boundary in `docs/maf-runtime-client.md` or a focused runtime gate doc.
  - [x] Update this story's Dev Agent Record during implementation.
  - [x] Move sprint status from `ready-for-dev` to `in-progress` during dev-story and to `review` when implementation is complete.
- [x] Run and record verification. (AC: 1-4)
  - [x] Run focused worker tests for `shadow-readiness-report.service`.
  - [x] Run focused application router tests proving `maf_canary` remains TypeScript-only.
  - [x] Run `pnpm --filter @entalent/worker typecheck`.
  - [x] Run `pnpm --filter @entalent/worker lint`.
  - [x] Run `pnpm --filter @entalent/application test -- src/use-cases/agent-runtime-router.test.ts`.
  - [x] Run `pnpm --filter @entalent/application typecheck`.
  - [x] Run `pnpm --filter @entalent/contracts test` if shared baseline case IDs or contract exports change.
  - [x] Run `git diff --check`.

### Review Findings

- [x] [Review][Patch] Invalid or missing metric evidence could fail open in canary gate evaluation.
- [x] [Review][Patch] Stale shadow diagnostics were not treated as canary blockers.
- [x] [Review][Patch] Latency and cost threshold gating used p95 when the configured threshold names required max values.
- [x] [Review][Patch] Token-like lowercase validation reason codes could pass stable-code serialization.
- [x] [Review][Patch] Invalid baseline gate summary status could count as sufficient baseline evidence.
- [x] [Review][Patch] Negative memory false-positive counts could offset sensitive memory positives.
- [x] [Review][Patch] Required canary blocker paths lacked direct gate-decision regression tests.
- [x] [Review][Dismissed] Sprint status includes historical Epic 4/5 tracking changes from earlier BMAD work; not a Story 6.1 code regression.

## Dev Notes

### Current Architecture Context

- AD-6 makes shadow mode first-class and requires current/candidate diagnostics with trace IDs, runtime versions, validation status, latency, model/tool/retry counts, cost, risk, memory candidates, and proposed actions.
- AD-9 says evaluation gates block rollout. Story 6.1 must compute a canary gate decision; it must not expose MAF to users.
- AD-10 says deterministic policy outranks agent output. Critical risk false negatives, duplicate side-effect proposals, sensitive memory false positives, validation failures, privacy/redaction failures, and missing evidence are non-negotiable blockers.
- AD-13 says runtime router owns mode selection, but Story 6.1 must not change runtime selection behavior beyond preserving fail-closed tests. Story 6.2 owns rollout controls.
- AD-17 requires coherent retry/tool/model counters. Use existing diagnostics summaries; do not infer hidden retries.
- AD-18 says shadow diagnostics have a canonical TypeScript-owned store. Use `runtime_shadow_diagnostics` and the existing `ShadowReadinessReportService`.
- AD-19 says deployment evidence is required before non-local shadow/canary. Story 6.1 may report deployment readiness as outside-scope/open, but must not mutate Railway or deploy services.

### Existing Code To Reuse

- `apps/worker/src/conversation/shadow-readiness-report.service.ts` already builds a privacy-safe readiness report from tenant-scoped diagnostics.
- `apps/worker/src/conversation/shadow-readiness-report.service.test.ts` already covers ready/blocked/manual-review/insufficient-data status precedence, validation failures, malformed payloads, redaction rejection, critical risk false negatives, duplicate actions, missing baseline coverage, and baseline gate summary.
- `apps/worker/src/conversation/shadow-diagnostics.repository.ts` owns redaction before persistence. Do not bypass or duplicate it.
- `packages/database/src/schema/runtime-shadow-diagnostics.ts` defines the canonical diagnostics table and indexes.
- `packages/contracts/src/migration-baseline.ts` exports `REQUIRED_MIGRATION_BASELINE_CASE_IDS` and `SENSITIVE_MIGRATION_BASELINE_CASE_IDS`.
- `packages/conversation-sim/src/gate/run-gate.ts` defines the baseline gate summary shape and manual-review semantics.
- `packages/application/src/use-cases/agent-runtime-router.ts` currently invokes MAF only for `maf_shadow`; `maf_canary` records configuration diagnostics but returns TypeScript output.
- `packages/application/src/use-cases/agent-runtime-router.test.ts` already asserts `maf_canary` does not invoke MAF candidates.

### Recommended Implementation Shape

Prefer a small pure helper over a new infrastructure layer:

```text
apps/worker/src/conversation/
  shadow-readiness-report.service.ts
  shadow-readiness-report.service.test.ts
```

Possible public shape:

```ts
export interface CanaryGateConfig {
  maxLatencyMs?: number;
  maxEstimatedCost?: number;
  blockOnAnyMemoryFalsePositiveForSensitiveCases?: boolean;
}

export interface CanaryGateDecision {
  schemaVersion: 1;
  canaryEnabled: false;
  status: ShadowReadinessStatus;
  blockers: ShadowReadinessReason[];
  warnings: ShadowReadinessReason[];
  report: ShadowReadinessReport;
}

export function buildCanaryGateDecision(args: {
  report: ShadowReadinessReport;
  config?: CanaryGateConfig;
}): CanaryGateDecision
```

The exact names can change to match local style. Keep the helper pure and unit-testable. It should not mutate feature flags, call `AgentRuntimeRouter`, call Python, run simulations, or read files.

### Status And Blocking Semantics

Use deterministic precedence:

1. Existing hard blockers in `ShadowReadinessReport.blockers` keep canary disabled.
2. `manual_review_required` keeps canary disabled until manual review is cleared.
3. `insufficient_data` keeps canary disabled.
4. Threshold blockers for latency/cost keep canary disabled.
5. Sensitive memory false positives keep canary disabled.
6. `canaryEnabled` is `false` unless the report is `ready` and no gate-specific blockers exist.

Suggested new reason codes:

- `latency_threshold_exceeded`
- `cost_threshold_exceeded`
- `sensitive_memory_false_positive`
- `manual_review_required`
- `insufficient_shadow_data`

Keep reason codes stable and syntax-safe: lowercase letters, digits, underscores, colon, or dash only.

### Previous Story Intelligence

- Story 5.5 opened only shadow candidate execution and explicitly kept `maf_canary` TypeScript-only. Preserve that until Epic 6 Story 6.2.
- Story 5.5 review fixed missing default fetch, missing default timeout, candidate idempotency collisions, soft-deleted/cross-thread context leakage, and malformed timestamp handling. Canary gate tests should assume invalid diagnostics are possible and must block exposure.
- Epic 5 retro action E5-A1 requires invalid, missing, unsafe, or stale shadow diagnostics to be hard canary blockers.
- Epic 5 retro action E5-A2 requires MAF candidate execution to remain shadow-only until canary gates, staged rollout controls, privacy/consent checks, and rollback rules are implemented and verified.
- Story 3.3 created the original shadow readiness report before `agent-service` and `MafAgentRuntimeClient` existed. Some scope tests from that era are now stale and must be updated, not preserved.

### Out Of Scope

- `maf_canary` execution or user-facing MAF replies.
- Staged rollout cohorts, internal-user targeting, workspace targeting, percentage rollout, or feature-flag mutation.
- Python command tools, Python-owned persistence, action execution, memory/goal/follow-up writes, ledger action commits, Slack sends, or TypeScript side-effect validation beyond diagnostics.
- Dashboard/admin UI.
- Railway/deployment mutation, Docker build verification, or non-local service registration.
- New model provider calls, LLM-as-judge calls, or live simulation gate runs in unit tests.
- Runtime OpenAPI schema changes unless a failing contract fixture proves the existing schema cannot express required diagnostics.

### Testing Requirements

- Tests must be local and deterministic with synthetic diagnostics/report inputs.
- Do not require a running Python service, Postgres, Redis, Slack, Docker, Railway, OpenAI, Azure, LangWatch, or live `conversation-sim` run.
- Use existing Vitest patterns in `apps/worker/src/conversation/shadow-readiness-report.service.test.ts`.
- Keep serialization tests strict: raw response text, risk evidence, memory content, action payloads, provider errors, tokens, secrets, stack traces, and full payloads must not appear in `JSON.stringify(decision)`.
- If shared contracts exports change, run contracts tests before dependent worker verification.
- Run upstream package builds sequentially when a package build cleans shared `dist` output.

### References

- `_bmad-output/planning-artifacts/epics.md` - Epic 6 Story 6.1 requirements.
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md` - AD-6, AD-9, AD-10, AD-13, AD-17, AD-18, AD-19.
- `_bmad-output/implementation-artifacts/epic-5-retro-2026-08-06.md` - Epic 5 action items E5-A1 through E5-A6.
- `_bmad-output/implementation-artifacts/5-5-integrate-maf-candidate-into-shadow-mode.md` - shadow-only MAF candidate integration and review lessons.
- `_bmad-output/implementation-artifacts/3-3-report-shadow-comparison-readiness.md` - existing readiness report semantics and stale scope-test context.
- `apps/worker/src/conversation/shadow-readiness-report.service.ts` - primary implementation target.
- `apps/worker/src/conversation/shadow-readiness-report.service.test.ts` - existing test target and scope guardrails to update.
- `apps/worker/src/conversation/shadow-diagnostics.repository.ts` - diagnostics redaction and persistence boundary.
- `packages/contracts/src/migration-baseline.ts` - required and sensitive migration case IDs.
- `packages/conversation-sim/src/gate/run-gate.ts` - baseline gate summary shape.
- `packages/application/src/use-cases/agent-runtime-router.ts` - runtime router behavior to preserve.
- `packages/application/src/use-cases/agent-runtime-router.test.ts` - `maf_canary` non-execution test to preserve.
- `docs/maf-runtime-client.md` - current shadow-only MAF runtime documentation.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story created after Epic 5 was marked done and Epic 5 retrospective was completed.
- Loaded BMAD create-story workflow, config, sprint status, Epic 6 Story 6.1 requirements, architecture spine, Epic 5 retrospective, Story 5.5 record, Story 3.3 readiness-report record, current `ShadowReadinessReportService`, current readiness tests, migration baseline exports, conversation-sim gate summary code, runtime router, runtime mode resolver, feature flag constants, and worker module wiring.
- No `project-context.md` or UX artifact was found; this story is backend/runtime gate work.
- CodeGraph status reported an up-to-date index before story creation.
- Started dev-story implementation; status moved to in-progress.
- RED: `pnpm --filter @entalent/worker test -- src/conversation/shadow-readiness-report.service.test.ts` failed with 9 expected failures because `buildCanaryGateDecision` was not implemented.
- GREEN: added canary gate decision helper, threshold blockers, sensitive-case memory false-positive aggregation, updated scope guardrails, and focused tests.
- Verification completed; story moved to review.
- Code review found fail-open gaps around malformed metric evidence, stale diagnostics, invalid gate summaries, max-threshold semantics, token-like reason codes, negative memory false-positive counts, and missing direct blocker tests.
- Review patches were applied and verified; story moved to done.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Story 6.1 is intentionally limited to canary gate evaluation. It does not enable canary routing, staged rollout controls, Python writes, command tools, deployment mutation, UI, or user-facing MAF replies.
- Added `buildCanaryGateDecision` as a pure helper over `ShadowReadinessReport`.
- Added canary gate blockers for latency threshold, cost threshold, sensitive memory false positives, manual review, and insufficient shadow data.
- Added fail-closed blockers for stale shadow diagnostics and invalid/missing metric evidence.
- Extended per-migration-case readiness summaries with `memoryFalsePositiveCount` so sensitive-case memory regressions can block canary without inspecting raw memory content.
- Hardened reason-code serialization against token-like values and clamped memory false-positive counts to non-negative values.
- Evaluated latency and cost thresholds against max values, so outliers cannot pass behind aggregate p95 behavior.
- Updated stale Story 3.3-era scope guardrails to reflect current Epic 4/5 surfaces while still blocking canary rollout/UI/deployment/write-tool surfaces.
- Documented canary gate semantics and non-enablement boundary.

### File List

- `_bmad-output/implementation-artifacts/6-1-add-canary-gate-evaluation.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/worker/src/conversation/shadow-readiness-report.service.ts`
- `apps/worker/src/conversation/shadow-readiness-report.service.test.ts`
- `docs/maf-runtime-client.md`

### Verification

- `pnpm --filter @entalent/worker test -- src/conversation/shadow-readiness-report.service.test.ts` - passed (34 tests).
- `pnpm --filter @entalent/application test -- src/use-cases/agent-runtime-router.test.ts` - passed (37 tests, existing Vite CJS deprecation warning).
- `pnpm --filter @entalent/worker typecheck` - passed.
- `pnpm --filter @entalent/worker lint` - passed with existing `apps/worker/src/main.ts:27` no-console warning.
- `pnpm --filter @entalent/application typecheck` - passed.
- `pnpm --filter @entalent/worker test` - passed (97 tests, transient MaxListenersExceededWarning from existing test process listeners).
- `git diff --check` - passed.
- `ruby -e "require 'yaml'; YAML.load_file('_bmad-output/implementation-artifacts/sprint-status.yaml'); puts 'yaml ok'"` - passed.
- `codegraph status` - passed; index is up to date.

### Change Log

- 2026-08-06: Created Story 6.1 as ready for development.
- 2026-08-06: Implemented canary gate evaluation and moved Story 6.1 to review.
- 2026-08-06: Applied code-review fixes, re-ran verification, and moved Story 6.1 to done.

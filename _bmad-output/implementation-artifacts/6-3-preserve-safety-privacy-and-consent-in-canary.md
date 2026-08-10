---
baseline_commit: dce563c
---

# Story 6.3: Preserve Safety, Privacy, And Consent In Canary

Status: done
Epic: 6 - Canary Readiness And Rollout Gates
Story ID: 6.3

## Story

As a safety and privacy reviewer,
I want canary rollout to prove existing safety, privacy, and consent behavior is preserved,
so that MAF does not weaken product guarantees.

## Acceptance Criteria

1. Given canary scenarios include risk, survey, proactive messaging, manager analytics, and GDPR-sensitive cases, when MAF behavior is compared to TypeScript baseline, then risk suppression, escalation triggers, manager privacy, cohort minimums, user consent, and deletion/export ownership remain intact.
2. Given a privacy or consent regression is detected, when the gate is evaluated, then rollout is blocked and the finding is recorded with traceable evidence that excludes raw sensitive text when possible.

## Tasks / Subtasks

- [x] Extend canary gate evidence for safety, privacy, and consent preservation. (AC: 1, 2)
  - [x] Reuse `apps/worker/src/conversation/shadow-readiness-report.service.ts`; do not create a second diagnostics store.
  - [x] Detect stable validation reason codes for risk suppression, escalation trigger, manager privacy, cohort minimum, survey consent, proactive consent, and GDPR deletion/export ownership regressions.
  - [x] Treat those policy regression codes as hard canary blockers while preserving diagnostic ID, trace ID, scenario ID, and migration case IDs.
  - [x] Keep evidence machine-readable and privacy-safe; do not include raw Slack/user text, prompts, risk evidence, memory content, action payloads, provider errors, stack traces, tokens, or full payloads.
- [x] Add focused tests for policy-regression blocking. (AC: 1, 2)
  - [x] Unit-test safety regression blockers for risk suppression and escalation trigger regressions.
  - [x] Unit-test privacy regression blockers for manager privacy, cohort minimum, and GDPR deletion/export ownership regressions.
  - [x] Unit-test consent regression blockers for survey and proactive messaging regressions.
  - [x] Unit-test `buildCanaryGateDecision` keeps `canaryEnabled: false` when any policy regression blocker exists.
  - [x] Unit-test serialized report/decision evidence excludes raw sensitive text and unstable reason codes.
- [x] Preserve Story 6 scope boundaries. (AC: 1, 2)
  - [x] Do not enable user-facing `maf_canary` replies or MAF candidate execution for canary.
  - [x] Do not mutate feature flags, rollout cohorts, runtime routing, Python writes, command tools, dashboard/admin UI, deployment envelopes, or rollback/ownership-transfer runbooks.
  - [x] Keep TypeScript as side-effect owner; Python/MAF remains proposal-only and shadow-only for execution.
- [x] Update docs and tracking. (AC: 1, 2)
  - [x] Document the policy regression reason codes and privacy-safe evidence semantics in `docs/maf-runtime-client.md`.
  - [x] Update this story's Dev Agent Record during implementation.
  - [x] Move sprint status to `in-progress` during implementation and `review` when complete.
- [x] Run and record verification. (AC: 1, 2)
  - [x] Run focused worker tests for `shadow-readiness-report.service`.
  - [x] Run focused application router tests proving `maf_canary` remains TypeScript-only.
  - [x] Run `pnpm --filter @entalent/worker typecheck`.
  - [x] Run `pnpm --filter @entalent/worker lint`.
  - [x] Run `pnpm --filter @entalent/application typecheck`.
  - [x] Run `pnpm --filter @entalent/worker test`.
  - [x] Run `git diff --check`.

### Review Findings

- [x] [Review][Patch] Policy-regression evidence can serialize raw text through `scenarioId` or `migrationCaseIds` [apps/worker/src/conversation/shadow-readiness-report.service.ts:310]
- [x] [Review][Patch] Broad stable reason-code acceptance can serialize unrecognized user-derived strings [apps/worker/src/conversation/shadow-readiness-report.service.ts:319]

## Dev Notes

### Current Architecture Context

- AD-9 says evaluation gates block rollout; this story adds safety/privacy/consent policy blockers to the existing canary gate rather than adding a new gate store.
- AD-10 says deterministic policy outranks agent output. Gate logic must rely on stable structured reason codes and recorded comparison fields, not generated prose.
- AD-13 says runtime router owns mode selection. This story must not change mode precedence or make `maf_canary` user-facing.
- AD-18 says shadow diagnostics are TypeScript-owned canonical records. Reuse existing diagnostics and readiness report logic.
- AD-19 says deployment evidence is required before non-local exposure. This story must not mutate Railway, Docker, or deployment envelopes.

### Existing Code To Reuse

- `apps/worker/src/conversation/shadow-readiness-report.service.ts` already builds privacy-safe shadow readiness reports and pure `buildCanaryGateDecision` output.
- `apps/worker/src/conversation/shadow-readiness-report.service.test.ts` already covers readiness status precedence, privacy-safe serialization, sensitive memory false positives, stale diagnostics, and metric blockers.
- `apps/worker/src/conversation/shadow-diagnostics.repository.ts` owns redaction before persistence; this story should not bypass or duplicate persistence redaction.
- `packages/application/src/use-cases/agent-runtime-router.ts` still returns TypeScript output for `maf_canary`; preserve that behavior.
- `packages/application/src/use-cases/agent-runtime-router.test.ts` already asserts `maf_canary` does not invoke MAF candidates.
- `docs/maf-runtime-client.md` documents the current shadow-only and canary-gate boundaries.

### Recommended Implementation Shape

Add a small deterministic mapping inside `shadow-readiness-report.service.ts` from stable validation reason codes to hard `ShadowReadinessReasonCode` blockers. Suggested blocker codes:

- `risk_suppression_regression`
- `escalation_trigger_regression`
- `manager_privacy_regression`
- `cohort_minimum_regression`
- `survey_consent_regression`
- `proactive_consent_regression`
- `gdpr_deletion_export_regression`

Use existing `validationDetails.reasonCodes` as the evidence carrier because the report already validates them as stable and excludes unstable or token-like values. When a mapped code is present, add a blocker with only stable IDs and case/scenario references.

### Previous Story Intelligence

- Story 6.1 added `buildCanaryGateDecision` and hardened canary readiness against invalid metrics, stale diagnostics, token-like reason codes, invalid baseline summaries, sensitive memory false positives, and missing blocker tests.
- Story 6.2 added staged canary targeting but kept `maf_canary` non-user-facing. Story 6.3 must keep that boundary and only strengthen gate evidence.
- Epic 5 retro action E5-A2 remains open until canary gates, rollout controls, privacy/consent checks, and rollback rules are implemented and verified.

### Out Of Scope

- User-facing MAF replies or MAF candidate execution for `maf_canary`.
- New runtime routes, Python workflow/tool changes, Python-owned writes, command tools, action execution, memory/goal/follow-up writes, ledger commits, or Slack sends.
- Dashboard/admin UI, new feature-flag APIs, rollout mutations, deployment changes, or rollback runbooks.
- New model calls, LLM-as-judge calls, live simulation runs, database migrations, or schema/table changes.

### Testing Requirements

- Tests must be deterministic and local with synthetic diagnostics/report inputs.
- Prefer extending `apps/worker/src/conversation/shadow-readiness-report.service.test.ts`.
- Serialization tests must prove raw Slack/user text, prompts, bearer tokens, secrets, full payloads, risk evidence, memory content, action payloads, provider errors, and stack traces are absent.
- Run upstream package verification sequentially when needed because package builds can clean shared `dist` output.

### References

- `_bmad-output/planning-artifacts/epics.md` - Epic 6 Story 6.3 requirements.
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md` - AD-9, AD-10, AD-13, AD-18, AD-19.
- `_bmad-output/implementation-artifacts/6-1-add-canary-gate-evaluation.md` - canary gate helper and hardening lessons.
- `_bmad-output/implementation-artifacts/6-2-add-staged-rollout-controls.md` - staged rollout controls and canary non-user-facing boundary.
- `_bmad-output/implementation-artifacts/epic-5-retro-2026-08-06.md` - open Epic 6 preparation actions.
- `apps/worker/src/conversation/shadow-readiness-report.service.ts` - primary implementation target.
- `apps/worker/src/conversation/shadow-readiness-report.service.test.ts` - primary test target.
- `packages/application/src/use-cases/agent-runtime-router.test.ts` - canary non-execution guardrail.
- `docs/maf-runtime-client.md` - MAF runtime and canary documentation.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story created after Story 6.2 BMAD code review was completed and marked done.
- Loaded BMAD create-story/dev-story workflows, BMM config, sprint status, Epic 6 Story 6.3 requirements, architecture spine, Story 6.1, Story 6.2, Epic 5 retrospective, current readiness report service/tests, and canary runtime documentation.
- No `project-context.md` or UX artifact was found; this story is backend/runtime gate work.
- CodeGraph index was used for current source inspection before implementation.
- 2026-08-07: Started dev-story implementation; status moved to in-progress.
- 2026-08-07: RED focused worker tests failed for missing policy-regression canary blockers.
- 2026-08-07: GREEN implementation added safety/privacy/consent policy blocker mapping from stable validation reason codes.
- 2026-08-07: Verification completed; story moved to review.
- 2026-08-07: BMAD code review found privacy evidence hardening gaps; patches applied and verified.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Story 6.3 is intentionally limited to privacy-safe canary gate hardening. It does not enable user-facing canary execution, mutate rollout controls, change runtime routing, or add Python writes/tools/UI/deployment surfaces.
- Added hard canary blockers for risk suppression, escalation trigger, manager privacy, cohort minimum, survey consent, proactive consent, and GDPR deletion/export ownership regressions.
- Kept blocker evidence limited to stable reason codes plus diagnostic ID, trace ID, scenario ID, and migration case IDs.
- Narrowed token-like reason-code detection so `risk_suppression_regression` remains valid while bearer/token/secret-like codes still fail closed as `redaction_rejected`.
- Review fixes now sanitize scenario IDs, allowlist migration case IDs, reject unrecognized validation reason codes, and fail closed when policy-regression evidence is missing or unsafe.

### File List

- `_bmad-output/implementation-artifacts/6-3-preserve-safety-privacy-and-consent-in-canary.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `apps/worker/src/conversation/shadow-readiness-report.service.ts`
- `apps/worker/src/conversation/shadow-readiness-report.service.test.ts`
- `docs/maf-runtime-client.md`

### Verification

- `pnpm --filter @entalent/worker test -- src/conversation/shadow-readiness-report.service.test.ts` - RED failed as expected before implementation, then passed (36 tests); after review fixes passed (38 tests).
- `pnpm --filter @entalent/application test -- src/use-cases/agent-runtime-router.test.ts` - passed (37 tests, existing Vite CJS deprecation warning).
- `pnpm --filter @entalent/worker typecheck` - passed.
- `pnpm --filter @entalent/worker lint` - passed with existing `apps/worker/src/main.ts:27` no-console warning.
- `pnpm --filter @entalent/application typecheck` - passed.
- `pnpm --filter @entalent/worker test` - passed (109 tests before review fixes, 111 tests after review fixes; transient MaxListenersExceededWarning from existing test process listeners).
- `git diff --check` - passed.
- `ruby -e "require 'yaml'; YAML.load_file('_bmad-output/implementation-artifacts/sprint-status.yaml'); puts 'yaml ok'"` - passed.
- `codegraph status` - passed; index is up to date.

### Change Log

- 2026-08-07: Created Story 6.3 as ready for development and started implementation.
- 2026-08-07: Implemented safety/privacy/consent policy blockers and moved Story 6.3 to review.
- 2026-08-07: Addressed BMAD code review findings and moved Story 6.3 to done.

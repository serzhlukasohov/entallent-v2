---
baseline_commit: dce563c
---

# Story 6.4: Document Rollback And Ownership Transfer Rules

Status: done
Epic: 6 - Canary Readiness And Rollout Gates
Story ID: 6.4

## Story

As an operator,
I want rollback and ownership-transfer rules documented with the implementation,
so that future migration steps do not accidentally introduce dual writers.

## Acceptance Criteria

1. Given MAF canary is ready, when the runbook is reviewed, then it documents kill switch use, runtime mode precedence, fallback barrier behavior, shadow/canary gate interpretation, and emergency rollback.
2. Given a future story proposes moving aggregate ownership to Python, when the architecture rules are applied, then it requires an explicit ownership-transfer AD before Python writes that aggregate.

## Tasks / Subtasks

- [x] Create the rollback and ownership-transfer runbook. (AC: 1, 2)
  - [x] Document immediate rollback order: global kill switch, tenant/user denylist, staged canary row disablement, shadow disablement, and operational confirmation.
  - [x] Document runtime mode precedence exactly: global kill switch, tenant/user denylist, shadow, canary, then TypeScript default.
  - [x] Document flag-evaluation failure behavior as fail-closed to TypeScript-only.
  - [x] Document fallback barrier behavior and the point where fallback is forbidden after committed actions or replies.
  - [x] Document shadow/canary gate interpretation, including non-enabled states and hard blockers from Stories 6.1 and 6.3.
  - [x] Document emergency rollback evidence requirements without raw Slack/user text, prompts, tokens, secrets, payloads, risk evidence, memory content, action payloads, provider errors, or stack traces.
- [x] Document ownership-transfer rules. (AC: 2)
  - [x] State that TypeScript remains first-slice owner for messages, risk signals, memory, goals, follow-ups, survey evidence, scheduled actions, ledgers, and Slack sends.
  - [x] Require an explicit ownership-transfer architecture decision before Python writes any aggregate.
  - [x] Require migration prerequisites for ownership transfer: source of truth, rollback/fallback barrier, idempotency, tenancy authorization, audit trail, privacy/safety gates, and backout plan.
  - [x] State that proposal-only Python output is allowed only when TypeScript validates and executes side effects.
- [x] Add focused tests. (AC: 1, 2)
  - [x] Add a deterministic test that the runbook contains rollback controls, mode precedence, gate interpretation, fallback barrier behavior, and emergency evidence rules.
  - [x] Add a deterministic test that the runbook requires explicit ownership-transfer AD before Python writes protected aggregates.
  - [x] Add scope guardrails proving this story does not add deployment mutation, dashboard/admin UI, Python command tools, or user-facing canary execution.
- [x] Update docs and tracking. (AC: 1, 2)
  - [x] Link the runbook from `docs/maf-runtime-client.md`.
  - [x] Update this story's Dev Agent Record during implementation.
  - [x] Move sprint status to `in-progress` during implementation and `review` when complete.
- [x] Run and record verification. (AC: 1, 2)
  - [x] Run focused worker tests for the runbook.
  - [x] Run focused application router tests proving `maf_canary` remains TypeScript-only.
  - [x] Run `pnpm --filter @entalent/worker typecheck`.
  - [x] Run `pnpm --filter @entalent/worker lint`.
  - [x] Run `pnpm --filter @entalent/application typecheck`.
  - [x] Run `pnpm --filter @entalent/worker test`.
  - [x] Run `git diff --check`.

### Review Findings

- [x] [Review][Patch] Runbook should separate canary-only rollback from full all-MAF rollback and clarify shadow disablement [docs/maf-runtime-rollout-runbook.md:11]
- [x] [Review][Patch] Runbook should qualify failed fallback phase by absence of committed action/reply evidence [docs/maf-runtime-rollout-runbook.md:51]
- [x] [Review][Patch] Runbook should require canary gate evidence to match rollout scope and config [docs/maf-runtime-rollout-runbook.md:28]
- [x] [Review][Patch] Runbook should state missing, unknown, unrecognized, or contradictory gate states are non-enabling [docs/maf-runtime-rollout-runbook.md:41]
- [x] [Review][Patch] Ownership rule should include runtime-control flags, shadow diagnostics, canary gate reports, and baseline evidence as protected TypeScript-owned surfaces [docs/maf-runtime-rollout-runbook.md:59]
- [x] [Review][Patch] Ownership transfer prerequisites should include cutover drain, writer lock, reader compatibility, and dual-write prevention [docs/maf-runtime-rollout-runbook.md:71]
- [x] [Review][Patch] Runbook tests should assert must-not-include evidence wording and exact protected aggregate bullets [apps/worker/src/conversation/maf-runtime-rollout-runbook.test.ts:31]
- [x] [Review][Patch] Runbook link should be a Markdown link for link checkers [docs/maf-runtime-client.md:93]

## Dev Notes

### Current Architecture Context

- AD-2 says TypeScript owns first-slice side effects. Python/MAF may return proposals or commands only until a later ownership-transfer AD exists.
- AD-5 and AD-15 say fallback stops after side effects and the persisted runtime-attempt/action ledgers define the barrier.
- AD-9 says evaluation gates block rollout.
- AD-10 says deterministic policy outranks agent output.
- AD-13 says runtime precedence is global kill switch, tenant/user denylist, shadow mode, canary mode, then TypeScript default.
- AD-18 says shadow diagnostics are the canonical TypeScript-owned comparison store.
- AD-19 says deployment evidence is required before non-local shadow/canary; this story documents rollback but must not mutate deployment.

### Existing Code To Reference

- `packages/application/src/use-cases/agent-runtime-mode-resolver.ts` implements runtime precedence.
- `packages/application/src/use-cases/runtime-fallback-barrier.ts` implements fallback barrier decisions: open before side effects, closed after `actions_committed` or `reply_committed`, unknown when evidence is invalid.
- `apps/worker/src/conversation/shadow-readiness-report.service.ts` implements canary gate decision semantics and blocker reason codes.
- `apps/worker/src/feature-flags/runtime-control-flag.repository.ts` implements staged canary controls, kill switch, and user denylist behavior.
- `packages/application/src/use-cases/agent-runtime-router.ts` keeps `maf_canary` TypeScript-only in the current migration slice.

### Previous Story Intelligence

- Story 6.1 added canary gate evaluation and hard blockers for invalid/stale diagnostics, safety regressions, latency/cost, and sensitive memory false positives.
- Story 6.2 added staged rollout targeting while preserving global kill switch and denylist precedence.
- Story 6.3 added safety/privacy/consent policy regression blockers and hardened evidence serialization to allowlisted stable reason codes and sanitized IDs.

### Out Of Scope

- Enabling user-facing MAF canary replies.
- Mutating runtime routing, feature flags, database schema, Railway/Docker deployment, Python workflow/tools, command tools, or aggregate writers.
- Adding dashboard/admin UI or live deployment automation.
- Implementing the actual future ownership transfer; this story documents the rule and guardrails.

### Testing Requirements

- Tests should be deterministic and local, preferably scanning the runbook for required operator-critical terms.
- Keep tests focused on documentation completeness and scope guardrails.
- Re-run existing router guardrail tests to prove `maf_canary` remains TypeScript-only.

### References

- `_bmad-output/planning-artifacts/epics.md` - Epic 6 Story 6.4 requirements.
- `_bmad-output/planning-artifacts/architecture/architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md` - AD-2, AD-5, AD-9, AD-10, AD-13, AD-15, AD-18, AD-19.
- `_bmad-output/implementation-artifacts/6-1-add-canary-gate-evaluation.md` - canary gate semantics.
- `_bmad-output/implementation-artifacts/6-2-add-staged-rollout-controls.md` - staged rollout and rollback controls.
- `_bmad-output/implementation-artifacts/6-3-preserve-safety-privacy-and-consent-in-canary.md` - safety/privacy/consent gate blockers.
- `docs/maf-runtime-client.md` - existing MAF runtime documentation.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Story created after Story 6.3 BMAD code review was completed and marked done.
- Loaded BMAD context from sprint status, Epic 6 Story 6.4 requirements, architecture spine, Story 6.3, and CodeGraph exploration of runtime precedence, fallback barrier, and canary gate code.
- No `project-context.md` or UX artifact was found; this story is operator/runtime documentation work.
- 2026-08-07: Started dev-story implementation; status moved to in-progress.
- 2026-08-07: RED focused worker test failed for missing rollout runbook.
- 2026-08-07: GREEN implementation added rollout/ownership runbook, linked it from MAF runtime docs, and added documentation guardrail tests.
- 2026-08-07: Verification completed; story moved to review.
- 2026-08-07: BMAD code review found runbook precision/test-strengthening findings; patches applied and verified.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.
- Story 6.4 is intentionally documentation and guardrail-test only. It does not enable user-facing canary execution, mutate rollout controls, change runtime routing, add Python writers/tools, add UI, or mutate deployment.
- Added `docs/maf-runtime-rollout-runbook.md` covering rollback order, runtime precedence, fail-closed flag behavior, gate interpretation, fallback barrier behavior, emergency rollback evidence, and ownership-transfer prerequisites.
- Linked the runbook from `docs/maf-runtime-client.md`.
- Added worker tests that keep the runbook's operator-critical content and scope guardrails explicit.
- Review fixes split canary-only rollback from all-MAF rollback, scoped gate evidence to rollout/config, clarified `failed` fallback phase safety, added unknown-state non-enablement, expanded protected TypeScript-owned surfaces, and strengthened ownership-transfer prerequisites.

### File List

- `_bmad-output/implementation-artifacts/6-4-document-rollback-and-ownership-transfer-rules.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `docs/maf-runtime-rollout-runbook.md`
- `docs/maf-runtime-client.md`
- `apps/worker/src/conversation/maf-runtime-rollout-runbook.test.ts`

### Verification

- `pnpm --filter @entalent/worker test -- src/conversation/maf-runtime-rollout-runbook.test.ts` - RED failed as expected before runbook creation, then passed (3 tests); after review fixes passed (3 tests).
- `pnpm --filter @entalent/application test -- src/use-cases/agent-runtime-router.test.ts` - passed (37 tests, existing Vite CJS deprecation warning).
- `pnpm --filter @entalent/worker typecheck` - passed.
- `pnpm --filter @entalent/worker lint` - passed with existing `apps/worker/src/main.ts:27` no-console warning.
- `pnpm --filter @entalent/application typecheck` - passed.
- `pnpm --filter @entalent/worker test` - passed (114 tests, transient MaxListenersExceededWarning from existing test process listeners).
- `git diff --check` - passed.
- `ruby -e "require 'yaml'; YAML.load_file('_bmad-output/implementation-artifacts/sprint-status.yaml'); puts 'yaml ok'"` - passed.
- `codegraph status` - passed; index is up to date.

### Change Log

- 2026-08-07: Created Story 6.4 as ready for development and started implementation.
- 2026-08-07: Implemented rollback/ownership-transfer runbook and moved Story 6.4 to review.
- 2026-08-07: Addressed BMAD code review findings and moved Story 6.4 to done.

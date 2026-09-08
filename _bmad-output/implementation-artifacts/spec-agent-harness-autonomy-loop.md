---
title: 'Agent Harness Autonomy Loop'
type: 'feature'
created: '2026-08-29T00:00:00+02:00'
status: 'done'
review_loop_iteration: 0
baseline_commit: '60c3a7c'
context:
  - '../../../AGENTS.md'
  - '../../../docs/agent-failures.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** enTalent has strong instructions, BMad execution, deterministic checks, model-backed simulations, and diagnostic logs, but they are separate. Runs are manually started and recorded, repeated failures are not mechanically retrieved, and CI failures or harness retrospectives cannot produce reviewable repair PRs.

**Approach:** Make existing mechanisms one bounded control loop: a shared diff-aware harness command writes safe receipts and enforces scope, local hooks and CI call it, conversation simulations run on a guarded schedule, and Codex automation may prepare draft PRs for approved specs, CI repairs, or one evidence-backed harness improvement. Human review remains the merge and production boundary.

## Boundaries & Constraints

**Always:** Reuse `pnpm`, Node stdlib, BMad specs, current logs, conversation-sim, and GitHub Actions. Default to deterministic checks; record skipped model checks and residual risk. Run Codex with read-only repository permission, transfer only a patch to a separate PR-writing job, cap repair/reflection work to one change, and create draft PRs only. Keep receipts free of environment values, command output, transcripts, and hidden reasoning. Treat the TypeScript-only/retired-MAF boundary as an executable policy.

**Ask First:** Enabling scheduled model egress, enabling Codex GitHub workflows, adding their secrets/variables, committing or pushing this implementation, activating automatic spec execution, merging PRs, or changing production/Railway state.

**Never:** Auto-merge, push to `main`, deploy, mutate production data, modify or invoke retired MAF/`agent-service`, expose model credentials to repository-controlled commands, add another agent framework or persistence service, or send LangWatch telemetry from scheduled transcript evals.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Local/CI change | Base revision and changed files | Select minimum valid checks and write redacted JSON receipt | Missing base falls back to full deterministic gate |
| Retired surface changed | MAF or `agent-service` path | Stop before commands | Exit blocked unless an explicit audited override is supplied |
| Connector preflight | PostgreSQL/Redis reachable or unavailable | Report named endpoints without credentials | Unreachable dependency exits blocked with remediation |
| Failed simulation | Assertion text also contains timeout/network wording | Classify as product failure when a scenario report/assertion exists | Retry only transport failures with no report |
| Scheduled simulation | Healthy gate needs manual sensitive-case review | Upload reports and mark warning, not infrastructure failure | Product/infra failure fails workflow; no credentials means explicit skip |
| Codex automation | CI failure, approved spec, or weekly reflection | Produce one patch and open a draft `codex/*` PR | No patch is a no-op; action never merges or deploys |

</frozen-after-approval>

## Code Map

- `scripts/agent-harness.ts` -- shared check, preflight, receipt, reflection, and spec-validation CLI.
- `scripts/agent-harness.test.ts` -- assert-based policy and receipt regression checks.
- `packages/conversation-sim/src/gate/run-gate.ts` -- gate execution and retry decision.
- `packages/conversation-sim/src/gate/failure-classifier.ts` -- pure product-versus-infrastructure classifier.
- `package.json`, `.github/workflows/ci.yml` -- one local/CI deterministic entrypoint.
- `.github/workflows/conversation-sim.yml` -- guarded nightly/weekly model evaluation.
- `.github/workflows/codex-ci-autofix.yml` -- CI-failure patch isolation and draft PR.
- `.github/workflows/codex-agent-harness.yml` -- manual ready-spec execution and weekly one-fix reflection.
- `AGENTS.md`, `docs/agent-task-log.md`, `docs/agent-failures.md` -- durable policy and feedback state.
- `evals/` -- unused Promptfoo duplicate to remove; conversation-sim remains canonical.

## Tasks & Acceptance

**Execution:**
- [x] Add the tested stdlib harness CLI with diff selection, retired-scope guard, TCP preflight, redacted receipts under ignored `runs/harness/`, reflection context, and ready-spec validation.
- [x] Fix simulation failure classification test-first so reports/assertions outrank transport words.
- [x] Route pre-push and CI quality through `pnpm harness:check`, retaining integration tests separately and uploading receipts on all outcomes.
- [x] Add guarded conversation-sim scheduling with no LangWatch secret and correct `manual_review_required` handling.
- [x] Add official Codex Action workflows that isolate model credentials from PR write permission, cap work, and create draft PRs only when explicitly enabled or dispatched.
- [x] Make relevant failure retrieval and final harness evidence mandatory in `AGENTS.md`; remove dormant Promptfoo files; update task/failure logs from verified results.

**Acceptance Criteria:**
- Given docs-only, active TypeScript, unknown/root, dashboard, and retired-MAF diffs, when the harness selects work, then it chooses the documented minimum checks or blocks before execution.
- Given successful, failed, and blocked runs, when they finish, then each leaves a schema-versioned receipt without environment values, raw output, or secrets.
- Given unavailable DB/Redis, when preflight runs, then it exits before any connector payload and names only the safe host/port target.
- Given a report-backed assertion containing `timeout`, when the sim gate classifies it, then it is a hard product failure without infrastructure retry.
- Given scheduled/manual automation with required opt-ins, when it runs, then model work cannot write the repository directly and any resulting branch is a human-reviewed draft PR.
- Given no opt-in variable or no eligible spec/fix, when automation runs, then it is a safe no-op.

## Spec Change Log

## Design Notes

Git remains the durable source of truth. Human-readable logs and BMad specs store decisions; local/CI JSON receipts store operational evidence. Reflection promotes a lesson only by proposing a small test, validator, instruction, or workflow change in a draft PR. It does not retrain a model or edit product behavior autonomously.

## Verification

**Commands:**
- `pnpm exec tsx scripts/agent-harness.test.ts` -- harness policies and receipt redaction pass.
- `pnpm --filter @entalent/conversation-sim test -- src/gate/failure-classifier.test.ts` -- failure classification passes.
- `pnpm harness:check -- --base HEAD` -- shared local gate writes a successful receipt.
- `pnpm typecheck && pnpm lint && pnpm test` -- repository deterministic baseline passes.
- `git diff --check` -- all tracked edits are clean.

**Manual checks:**
- Inspect GitHub workflow permissions, secret placement, opt-in guards, patch transfer, draft status, and absence of deploy/merge commands.

## Review Log

- 2026-08-29: Blind Hunter and Edge Case Hunter completed independent reviews from baseline `60c3a7c`.
- Confirmed findings were patched test-first: complete diff bases, rename-safe retired guards, audited overrides, spec/preflight boundaries, precise sim classification, pinned workflow revisions, trusted validation, non-recursive CI repair, and current eval documentation.
- No frozen-intent changes, deferred findings, MAF execution, model evals, commits, pushes, workflow enabling, or deployment occurred.

## Suggested Review Order

**Deterministic control plane**

- Start with scope selection, receipts, preflight, spec validation, and retired-boundary enforcement.
  [`agent-harness.ts:115`](../../scripts/agent-harness.ts#L115)

- Merge-base and rename-safe discovery prevent multi-commit and retired-path omissions.
  [`agent-harness.ts:263`](../../scripts/agent-harness.ts#L263)

- Base-aware diff checks cover committed and staged changes in CI and pre-push.
  [`agent-harness.ts:529`](../../scripts/agent-harness.ts#L529)

**Automation boundaries**

- Approved-spec and reflection jobs pin revisions and validate through preserved trusted code.
  [`codex-agent-harness.yml:25`](../../.github/workflows/codex-agent-harness.yml#L25)

- CI repair consumes failed logs, blocks recursion, and transfers only an isolated patch.
  [`codex-ci-autofix.yml:16`](../../.github/workflows/codex-ci-autofix.yml#L16)

- Simulation scheduling stays opt-in, credential-complete, report-driven, and telemetry-free.
  [`conversation-sim.yml:20`](../../.github/workflows/conversation-sim.yml#L20)

**Evaluation and feedback**

- Report-first classification prevents product assertions from being retried as infrastructure.
  [`failure-classifier.ts:3`](../../packages/conversation-sim/src/gate/failure-classifier.ts#L3)

- Canonical evaluation instructions now point only to production-shaped conversation-sim.
  [`EVALS.md:3`](../../EVALS.md#L3)

- Durable instructions require failure retrieval, safe receipts, and human production boundaries.
  [`AGENTS.md:30`](../../AGENTS.md#L30)

**Regression evidence**

- Assert-based tests cover base selection, retired renames, receipts, preflight, and symlink escape.
  [`agent-harness.test.ts:73`](../../scripts/agent-harness.test.ts#L73)

- Failure-classifier tests distinguish assertion wording from genuine transport evidence.
  [`failure-classifier.test.ts:4`](../../packages/conversation-sim/src/gate/failure-classifier.test.ts#L4)

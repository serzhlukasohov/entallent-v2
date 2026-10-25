---
title: 'Story 12.10: L0 Gate in CI and Baseline Governance'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: 'e22197ad5a59b95ec65e64ba9530465aa16f1268'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-conversation-eval-regression-2026-10-17/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred:
  - summary: >-
      CODEOWNERS line for `packages/conversation-sim/baselines/**` is not written: the QA owner handle is an open product question.
    evidence: |-
      Story 12.10 AC 2 requires the QA owner as a required reviewer. The user decided (2026-10-25) not to invent a handle or a placeholder owner. The `baseline-change` label guard is implemented; once the handle is known, add `/packages/conversation-sim/baselines/** @<qa-handle>` to `.github/CODEOWNERS` and enable "Require review from Code Owners" on `main` (a repository setting, needs explicit approval).
    location: .github/CODEOWNERS (absent)
    severity: medium
  - summary: >-
      `suite:ci` skips a suite with zero tests even when its merge-base baseline has entries, so deleting every test of a baselined suite passes instead of reporting `lost-coverage`.
    evidence: |-
      Blind hunter (Story 12.10). `ciCommand` skips on `suite.tests.length === 0` before any diff. The frozen user decision ("runs every registered suite that has tests") defines the skip, and no baseline is committed, so it is unreachable today. Settle before the first baseline lands: run the merge-base diff for an empty suite whenever a baseline exists at the merge-base (all entries become lost-coverage, exit 1).
    location: >-
      packages/conversation-sim/src/suite/cli.ts (ciCommand)
    severity: medium
---

<intent-contract>

## Intent

**Problem:** `suite:run` and `suite:diff --merge-base` exist (12.8, 12.9) but nothing runs them on a pull request, there are no root `pnpm suite:*` aliases, no docs, and a baseline file can be changed without anyone noticing.

**Approach:** A new `suite:ci --level L0 [--summary <path>]` command runs every registered suite that has tests through the same run + merge-base diff paths, appends a GitHub step summary, and exits with the gate code; a `suite-l0` job in `ci.yml` calls it without secrets and uploads the run folders. A separate PR workflow runs a small `suite:baseline:guard` that fails when `baselines/**` changed without the `baseline-change` label. Root aliases and README docs complete the surface.

**User decisions (2026-10-25, recorded as intent):** `p-v1` (Story 12.4) is out of scope and empty; our smoke scenarios live in `smoke-v1` (registered empty) and come after the framework. The CI L0 job runs every registered suite that has tests — today none, so it must pass and say so — and no baseline is committed. The QA CODEOWNERS handle is unknown: no CODEOWNERS line and no placeholder owner; the gap is a deferred item.

## Boundaries & Constraints

**Always:**
- `suite:ci` iterates `suite.config.json` `suites` in order; a suite whose loaded `tests` is empty is skipped with `[suite] ci: <id> skipped (no tests)`; a load error is exit 1 for that suite. Each suite with tests is run at the given level with n=1 and diffed with `--merge-base`, reusing the existing run/diff code paths (no copied logic). When no suite has tests it logs `[suite] ci: no registered suite has tests; L0 gate passes with nothing to check`, writes that to the summary, and exits 0.
- `suite:ci` exit code: over all suites, the first present by precedence 2 > 3 > 4 > 1 (same precedence as `suite:diff`); a run or load failure counts as 1; otherwise 0. All suites are attempted even after a failure.
- Step summary (`--summary <path>`, appended, file created if missing): per suite the layer table, verdict (with provisional/INCOMPLETE marks), diff outcome and exit code, baseline source, per-section category counts and every non-`unchanged` entry (key, category, layer, check kind, gating). No evidence, reason text from replies, or transcript text; skipped suites listed as skipped.
- `suite:baseline:guard --base <rev> --head <rev> --labels <json-array>`: changed paths = `git diff --name-only <base>...<head>` restricted to the repo path of `packages/conversation-sim/baselines/`; exit 1 listing the paths when any changed and the labels lack `baseline-change`; exit 0 otherwise. Git failure, missing flags or unparseable labels exit 1 (fail closed). It is a standalone module importing only Node builtins, so the guard workflow needs no package build.
- `suite:calibrate` exists (package and root) and exits 1 with `[suite] calibrate lands in Epic 13`.
- Root `package.json` aliases `suite:run`, `suite:diff`, `suite:baseline:accept`, `suite:calibrate`, `suite:ci` delegate via `pnpm --filter @entalent/conversation-sim <script>`, and flags pass through (`pnpm suite:run --suite smoke-v1 --level L0` works).
- `ci.yml` job `suite-l0` ("Suite L0 gate"): `permissions: contents: read`, `actions/checkout@v6` with `fetch-depth: 0` (so `origin/main` resolves under the detached PR merge checkout), pnpm/node setup as the other jobs, `pnpm install --frozen-lockfile`, build only conversation-sim's dependencies, then `pnpm suite:ci --level L0 --summary "$GITHUB_STEP_SUMMARY"`; upload `packages/conversation-sim/runs/suites/**` with `if: always()` and `if-no-files-found: ignore`. No `secrets.*`, no model env vars, no services. The job fails when `suite:ci` exits non-zero. Existing `quality` and `integration` jobs are unchanged.
- Guard workflow `.github/workflows/suite-baseline-governance.yml`: `pull_request` to `main`/`develop` with types `opened, synchronize, reopened, labeled, unlabeled`, `permissions: contents: read`, full-history checkout, passes `github.event.pull_request.base.sha`, `head.sha` and `toJSON(github.event.pull_request.labels.*.name)` through `env:` (never interpolated into the script body).
- `packages/conversation-sim/README.md` gains a suite section: commands (run, diff, baseline:accept, ci, baseline:guard, calibrate), exit codes, the six statuses and their precedence, scoring/verdict, how to read a diff (categories, gating, lost-coverage first, no-baseline), baseline governance (label; CODEOWNERS pending).
- Workflow YAML is parse-checked locally; the guard and the merge-base reader are tested in real temp git repos including a detached-HEAD clone with `refs/remotes/origin/main`.

**Never:**
- Live model calls, reading or printing secrets, adding secrets or model env vars to workflows; changes in `packages/application` or `apps/*`; database migrations.
- A CODEOWNERS file or placeholder owner; committing a baseline; writing p-v1/smoke-v1 cases; implementing calibration.
- Adding `labeled`/`unlabeled` triggers to `ci.yml` or weakening its existing jobs; changing `ScenarioRunReport`, `gate.config.json`, `run-gate.ts`, or `conversation-sim.yml`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Today | every suite empty | skip lines, "nothing to check" summary, exit 0, no run folder | N/A |
| Clean suite | suite with tests, no baseline at merge-base | run + diff no-baseline, summary with layers/verdict/diff, exit 0 | N/A |
| Regression | diff exits 1 | summary shows gating entries, exit 1 | N/A |
| Mixed | suite A diff 1, suite B diff 2 | both attempted, exit 2 | N/A |
| Run failure | a suite fails to load/run | other suites still run, exit ≥ 1 per precedence | message logged |
| Guard clean | no baselines change | exit 0 | N/A |
| Guard unlabeled | `baselines/smoke-v1/L0.json` changed, labels `[]` | exit 1, path listed | N/A |
| Guard labeled | same, labels `["baseline-change"]` | exit 0 | N/A |
| Guard bad input | git fails / labels not a JSON string array | exit 1 | fail closed |
| Calibrate | `suite:calibrate` | message, exit 1 | N/A |

</intent-contract>

## Code Map

- `packages/conversation-sim/src/suite/cli.ts` -- `parseArgs` (add `ci`, `calibrate`), `HELP`, `main` dispatch, `runCommand` (returns 0 after writing; needs to expose the run id/report for `ci`), `diffCommand` (returns the diff exit code; `readMergeBaseFile` is its default merge-base reader), `summaryLines`, `CliDeps` (inject everything; reuse for `ci`), `unsupportedLevel`. Exit-code doc comment at top.
- `packages/conversation-sim/src/suite/report.ts:125-245` -- `renderSuiteReportMarkdown`, `pushDiff`, `rate`, `cell`: reuse for the step-summary renderer; `report.md` contains rule evidence, so the summary must not include it.
- `packages/conversation-sim/src/suite/schema.ts` -- `SuiteRunReport` (`layers`, `verdict`, `provisional`, `complete`, `diff`), `SuiteDiff`, `DiffCategorySchema`.
- `packages/conversation-sim/src/suite/loader.ts:69-81` -- `SUITES` registry, `loadSuite`.
- `packages/conversation-sim/src/suite/config.ts` -- `loadSuiteConfig`; `suite.config.json` lists `p-v1`, `smoke-v1`.
- `packages/conversation-sim/src/suite/cases/{p-v1,smoke-v1}/index.ts` -- both `tests: []` today.
- `packages/conversation-sim/src/suite/cli.test.ts:16-65,481-600` -- `harness()` fake deps with `x-suite`/`x-live` (`RUNNER_CONFIG.suites` = `p-v1, smoke-v1, x-suite, x-live`); real temp git repo helper that strips `GIT_*` env — reuse for guard and detached-HEAD tests.
- `packages/conversation-sim/package.json` -- add `suite:ci`, `suite:calibrate`, `suite:baseline:guard` scripts.
- `package.json` (root) -- scripts block next to `sim`/`sim:gate`.
- `.github/workflows/ci.yml` -- jobs `quality`, `integration`; reuse their checkout/pnpm/node steps; `quality` already uses `fetch-depth: 0`.
- `packages/conversation-sim/README.md` -- existing sim/gate docs; add a suite section.
- `node_modules/.pnpm/yaml@2.9.0` -- available for a local YAML parse check (no new dependency).

## Tasks & Acceptance

**Execution:**
- [x] `packages/conversation-sim/src/suite/report.ts` -- export `renderCiSummary` for one suite report (layers, verdict, diff counts and non-unchanged entries, no evidence) -- step summary source.
- [x] `packages/conversation-sim/src/suite/cli.ts` -- `ci` command (`--level`, `--summary`), `calibrate` stub, HELP and exit-code docs -- CI entry point over existing paths.
- [x] `packages/conversation-sim/src/suite/baseline-guard.ts` (new) -- pure `baselineGuardViolations(changedPaths, labels)` plus a Node-builtins-only CLI entry -- label governance.
- [x] `packages/conversation-sim/package.json`, `package.json` -- package scripts and root aliases.
- [x] `.github/workflows/ci.yml` -- add `suite-l0` job; `.github/workflows/suite-baseline-governance.yml` (new) -- guard job.
- [x] Tests -- `cli.test.ts` (ci: all-empty exit 0 and summary text, suite with tests writes summary with layers/verdict/diff, regression exit 1, precedence across suites, load failure continues, calibrate, parse errors; merge-base under a detached-HEAD full clone with `origin/main`), `baseline-guard.test.ts` (pure cases + real temp git repo, labeled/unlabeled/bad labels/git failure), `report.test.ts` (summary has no evidence text).
- [x] `packages/conversation-sim/README.md` -- suite section.
- [x] `docs/agent-task-log.md` (one row), `_bmad-output/implementation-artifacts/sprint-status.yaml` (12-10 `review` with a done comment, as 12.8/12.9).

**Acceptance Criteria:**
- Given this repository today, when `pnpm suite:ci --level L0 --summary <tmp>` runs from the root in a plain shell, then it exits 0, logs that p-v1 and smoke-v1 were skipped with no tests, and `<tmp>` says the gate passed with nothing to check.
- Given `ci.yml` and the guard workflow, when parsed with the `yaml` package, then they parse, `suite-l0` has no `secrets.` reference, checks out with `fetch-depth: 0`, runs `pnpm suite:ci --level L0`, and uploads `packages/conversation-sim/runs/suites/**`; `quality`/`integration` are byte-identical to before.
- Given root scripts, when `pnpm suite:run --suite smoke-v1 --level L0` and `pnpm suite:calibrate` run, then the first exits 0 and the second exits 1 with the Epic 13 message.
- Given `pnpm --filter @entalent/conversation-sim test`, when it runs offline, then all suites pass.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 27 findings — high 2, medium 1, low 20, false 4, maybe-false 0
- findings:
  - `[low]` `[patch]` (edge) `git diff --name-only` quotes non-ASCII/special paths (core.quotePath), so such a file under `baselines/` misses the prefix check and passes unlabeled — patched: `git -c core.quotePath=false diff --name-only -z --no-renames`, split on NUL; real-git test commits `baselines/smoke-v1/звіт é.json` and asserts exit 1.
  - `[low]` `[patch]` (edge) `readRunReport` after `diffCommand` in one try, so a re-read failure replaces a diff exit 2/3/4 with 1 — patched: separate try; the suite keeps the diff exit code, only its summary section is dropped.
  - `[low]` `[reject]` (edge) merge-base hard-coded to `origin/main` though workflows also trigger for `develop` — no `develop` branch exists on origin (`git ls-remote --heads origin develop` empty); `origin/main` is frozen by 12.9; fix adds a public flag.
  - `[low]` `[reject]` (edge, claim) a run/load failure message in the summary could carry text — messages are loader/Zod/executor errors on synthetic L0 fixtures; reducing them to a fixed label adds a branch and loses the debugging signal; unlikely in practice.
  - `[low]` `[reject]` (edge) a baseline pushed directly to main bypasses the PR guard — AC 2 scopes the guard to pull requests; direct pushes are a branch-protection setting (README now says the checks block only once required).
  - `[low]` `[reject]` (blind) merge-base `origin/main` vs `develop` — same as the edge row.
  - `[medium]` `[defer]` (blind) `suite:ci` skips a suite with zero tests even when its merge-base baseline has entries, so deleting every test of a baselined suite would pass instead of `lost-coverage` — the frozen user decision says "runs every registered suite that has tests"; unreachable today (no baseline committed). Deferred, medium.
  - `[low]` `[reject]` (blind) the guard does not cover `suite.config.json` or gating code — AC 2 names `baselines/**` only; config/code changes are ordinary reviewed diffs.
  - `[low]` `[patch]` (blind) governance is label-only and nothing documents making the checks required — patched: README sentence that both checks block merges only once they are required status checks (repository setting, pending approval); CODEOWNERS already deferred.
  - `[low]` `[reject]` (blind) the artifact uploads `report.md` evidence and `case-runs.json` transcripts — AC 1 requires uploading `runs/suites/**`; L0 data is synthetic; noted for Epic 13 (L1 transcripts) in the result.
  - `[low]` `[patch]` (blind) a failure after the diff hides the diff exit code — same root as the edge row; same patch.
  - `[low]` `[reject]` (blind) missing tests for levels-excluding-L0, ci credential scrub, `|` escaping, workflow YAML — the scrub and level checks are the shared `performRun` paths already tested for `run` (`refuses a non-L0 level and a bad config` covers ci); YAML is parse-checked locally (no YAML test dependency); summary-append failure split out below.
  - `[low]` `[reject]` (blind) `firstLine(outcome.error)` in the summary is unsanitized — same as the edge claim row.
  - `[low]` `[patch]` (blind) new jobs have no `timeout-minutes` — patched: `timeout-minutes: 15` on `suite-l0` and `baseline-guard` only. Lighter guard install rejected: `tsx` still needs the workspace install.
  - `[low]` `[patch]` (blind) README says the gate runs on every pull request and push — patched: main/develop wording.
  - `[false]` `[reject]` (blind) the spec is missing from the reviewed diff — deliberately kept out (claims file for the edge layer only); Finalize commits it.
  - `[false]` `[reject]` (blind) `uniqueRunId` can loop forever — each iteration increments the offset, producing a new id; it stops at the first id with no folder, and folders are finite.
  - `[high]` `[patch]` (verification) pnpm 9.12 re-quotes the multi-line `toJSON(labels)` argument, so `--labels` fails to parse and every labeled PR fails the guard (reviewer reproduced it) — patched: the workflow runs `node --import tsx src/suite/baseline-guard.ts` from `packages/conversation-sim`; a test spawns that exact command with multi-line labels (exit 0 with the label, 1 without). Recorded in `docs/agent-failures.md` (fixed).
  - `[low]` `[patch]` (verification) the summary-append failure path is untested — patched: test with `--summary` under a regular file asserts exit 1 and the error line.
  - `[high]` `[patch]` (verification, other) the pnpm relay is a live defect — same root as the verification row; same patch.
  - `[low]` `[reject]` (intent) one `suite:ci` wrapper instead of two literal commands — settled in Design Notes under the user decision; it performs run then `--merge-base` diff per suite.
  - `[low]` `[reject]` (intent) the job fails on more than a non-zero `suite:diff` (load/run/summary failures) — a gate that cannot run must fail; spec-settled.
  - `[low]` `[reject]` (intent) today the summary has no layers/verdict/diff and the artifact is empty — the user decision (no suite has tests) makes that the expected output; rendering is tested on fixture suites.
  - `[false]` `[reject]` (intent) a push to main diffs against its own commit's baseline — on push, `merge-base HEAD origin/main` is HEAD, so the run is checked against the baseline committed with it; correct and harmless.
  - `[low]` `[reject]` (intent) workflow inputs (`toJSON`, sha resolution) not exercised on GitHub — cannot run before push; the multi-line `toJSON` shape is now tested through the exact command; the residual risk is recorded in the result.
  - `[low]` `[reject]` (intent) `calibrate` exits 1 — spec-settled: honest "not implemented" stub.
  - `[false]` `[reject]` (intent) not finalized (uncommitted, in-review) — review runs before Finalize by design.

## Design Notes

**Why `suite:ci` instead of two shell calls:** the user decision is "every registered suite that has tests", which needs suite discovery, per-suite run ids and an aggregated exit code; in TypeScript it reuses the CLI paths and is unit-testable, while a bash loop in YAML cannot be tested before push. It still performs exactly `suite:run --suite <id> --level L0` then `suite:diff --run <id> --merge-base` per suite.

**Why a separate guard workflow:** adding the label later must re-run the check; `labeled`/`unlabeled` triggers on `ci.yml` would re-run Postgres-backed jobs and cancel in-flight runs through its concurrency group.

**Merge-base under `actions/checkout`:** with `fetch-depth: 0` the PR merge commit is checked out detached and `refs/remotes/origin/main` exists, so `git merge-base HEAD origin/main` is the base-branch tip the PR merges into. A shallow checkout would make the diff exit 2, so the job pins full history.

## Verification

**Commands:**
- `pnpm --filter @entalent/conversation-sim test` -- expected: pass offline.
- `pnpm --filter @entalent/conversation-sim typecheck` and `pnpm --filter @entalent/conversation-sim lint` -- expected: no errors.
- `pnpm suite:ci --level L0 --summary <scratch file>`, `pnpm suite:run --suite smoke-v1 --level L0`, `pnpm suite:calibrate` -- expected: exit 0, 0, 1.
- YAML parse of both workflows with the workspace `yaml` package -- expected: parses, assertions above hold.
- `pnpm typecheck` -- expected: no errors.
- `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` -- expected: passing receipt.

## Auto Run Result

**Summary:** `suite:ci --level L0 [--summary <path>]` runs `suite:run` (n=1) then `suite:diff --merge-base` for every suite in `suite.config.json` that has tests, skips empty suites, attempts all suites after a failure, exits by precedence 2 > 3 > 4 > 1, and appends an evidence-free GitHub step summary (`renderCiSummary`: layers, verdict, diff outcome, baseline source, category counts, changed entries). Today both suites are empty, so it logs and writes "no registered suite has tests; L0 gate passes with nothing to check" and exits 0. `ci.yml` gains a `suite-l0` job (no secrets, `contents: read`, `fetch-depth: 0`, 15 min timeout, uploads `runs/suites/**`); a separate `suite-baseline-governance.yml` runs a Node-builtins-only `baseline-guard.ts` that fails a PR changing `packages/conversation-sim/baselines/**` without the `baseline-change` label. Root aliases `suite:run|diff|baseline:accept|calibrate|ci`; `suite:calibrate` exits 1 ("lands in Epic 13"). README documents commands, exit codes, statuses, verdict, diff reading and governance.

**Files changed:**
- `.github/workflows/ci.yml` -- new `suite-l0` job; `quality`/`integration` byte-identical.
- `.github/workflows/suite-baseline-governance.yml` (new) -- label guard on PR opened/synchronize/reopened/labeled/unlabeled; calls the guard with `node --import tsx` directly.
- `package.json` -- root `suite:*` aliases.
- `packages/conversation-sim/package.json` -- `suite:ci`, `suite:calibrate`, `suite:baseline:guard`.
- `packages/conversation-sim/src/suite/cli.ts` -- `ci` and `calibrate` commands, shared `performRun`, `aggregateCiExitCode`, HELP/exit docs.
- `packages/conversation-sim/src/suite/report.ts` -- `renderCiSummary`.
- `packages/conversation-sim/src/suite/baseline-guard.ts` (new) -- guard logic and CLI.
- Tests: `cli.test.ts`, `report.test.ts`, `baseline-guard.test.ts` (new; real git repos, detached-HEAD merge-commit clone, exact workflow command line with multi-line labels).
- `packages/conversation-sim/README.md`, `docs/agent-task-log.md`, `docs/agent-failures.md` (fixed entry: pnpm relay of multi-line arguments), `_bmad-output/implementation-artifacts/sprint-status.yaml`.

**Review:** one pass, 27 findings (high 2, medium 1, low 20, false 4). Patched 9 rows (6 fixes): pnpm re-quoting broke the multi-line `toJSON` labels argument so every labeled PR would fail (high, 2 rows; guard now called via node, tested through the exact command); `core.quotePath` path quoting could hide a baseline change (low); a report re-read failure masked the diff exit code (low, 2 rows); summary-append failure test (low); `timeout-minutes: 15` on both new jobs (low); README trigger wording and required-status-check note (low, 2 rows). Deferred 1: empty-but-baselined suites are skipped by `suite:ci` (medium; frozen user decision, unreachable until a baseline exists). Rejected 17 with reasons in the triage log (notably: `develop` merge-base has no `develop` branch; guard scope and artifact contents are set by the AC; wrapper command, calibrate exit 1 and broader job failure are spec-settled).

**Deferred for the user:** the QA CODEOWNERS line for `packages/conversation-sim/baselines/**` (AC 2 required reviewer) is not written because the QA handle is an open product question; no placeholder owner. Once known: add `/packages/conversation-sim/baselines/** @<qa-handle>` to `.github/CODEOWNERS`, and in branch protection for `main` enable "Require review from Code Owners" and make `Suite L0 gate` and `Baseline change label` required checks (repository settings, need explicit approval).

**Follow-up review recommended: true** -- a high entry was patched. The unverified risk is the workflows on GitHub: the direct-node guard with real `toJSON` labels and `pull_request` shas, and `origin/main` resolving under the real `actions/checkout` PR merge checkout (proven only in local temp repos). Patched counts by entry verdict: high 1, medium 0, low 5.

**Verification:** `pnpm --filter @entalent/conversation-sim test` 40 files / 663 tests offline; package typecheck and lint clean; root `pnpm typecheck` clean; `yaml@2.9.0` parse of both workflows (suite-l0 has no `secrets.`, `fetch-depth: 0`; `ci.yml` has no removed lines); plain-shell root `pnpm suite:ci --level L0 --summary <scratch>` exit 0 with both skip lines and the "nothing to check" summary, `pnpm suite:run --suite smoke-v1 --level L0` exit 0, `pnpm suite:calibrate` exit 1; guard via `node --import tsx` with multi-line labels on this repo exit 0; `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` passed (receipt `runs/harness/receipt-1792952869541-e268ddec.json`).

**Residual risks:** neither workflow has run on GitHub; the uploaded artifact will carry transcripts once L1/L2 run in CI (Epic 13 must decide what to upload); the epic-12 context cache was reused although two unrelated onboarding-v2 planning files have newer worktree-checkout mtimes (their content predates the cache).

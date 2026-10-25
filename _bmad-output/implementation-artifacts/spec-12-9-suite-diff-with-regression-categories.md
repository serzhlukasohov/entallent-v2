---
title: 'Story 12.9: suite:diff with Regression Categories'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: '9d7bc246ecb9b3902ff013e4bc24783098edd030'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-conversation-eval-regression-2026-10-17/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred:
  - summary: >-
      At L1 a rule+meaning criterion is classified `checkKind: meaning` once the judge runs, so a rule regression on it could become `inconclusive` under an uncalibrated (advisory) judge and not gate the PR.
    evidence: |-
      Intent auditor (Story 12.9). `score.ts` sets checkKind meaning when any sample did not skip meaning; `diff.ts` makes advisory meaning criteria inconclusive. Invisible at L0 (no judge). Settled by how Epic 13's judge sets `meaningSkipped` when a rule check already failed (AD-9: meaning applies only when no rule check failed); if it does not, classify a rule-failed sample as rule-decided or gate rule FAILs on mixed criteria.
    location: >-
      packages/conversation-sim/src/suite/score.ts (aggregate checkKind), packages/conversation-sim/src/suite/diff.ts (categorize)
    severity: medium (unverified)
---

<intent-contract>

## Intent

**Problem:** A run report and a committed baseline exist (12.8), but nothing compares them, so a broken job, a flaky sample and a real regression all look the same and nothing can gate a pull request.

**Approach:** A pure `suite/diff.ts` classifies every `<testId>/<criterionId>` pair of a run against a baseline into the AD-13 categories, decides the exit code, and the CLI gains `suite:diff --run <runId> [--baseline <path> | --merge-base]`, which prints the diff (`lost-coverage` first) and writes it into the run's `report.json`/`report.md`.

**User decisions (2026-10-25, recorded as intent):** The QA suite `p-v1` (Story 12.4) is out of scope and empty; our own smoke scenarios live in `smoke-v1` (registered empty in 12.8) and are written after the framework is done. 12.9 is proven on synthetic run/baseline pairs in tests; no baseline is committed by this story.

## Boundaries & Constraints

**Always:**
- Baseline entries are extended additively (no schema version bump) to `{ status, passCount, n, layer, testKind, checkKind }` (`testKind`/`checkKind` null for manifest NOT TESTABLE rows); `ScoredCriterion` gains `checkKind: 'rule' | 'meaning' | null` (meaning when a meaning check decided it, as `score` already uses for `minPasses`); `baseline:accept` copies them. The diff uses the run's layer/kinds when the key is in the run, else the baseline's.
- Only in-scope run results take part; an out-of-scope or absent key is "missing". A run narrowed with `--case` is compared only with baseline keys of that test id or source case.
- Categories (precedence top-down; "decided" = PASS/FAIL, "undecided" = NOT_RUN/ERROR/INVALID):
  - key not in baseline → `new`; key in baseline, missing from run → `lost-coverage` if baseline decided, else `retired`;
  - run NOT_TESTABLE → `unchanged` if baseline NOT_TESTABLE, else `retired`; baseline NOT_TESTABLE and run not decided → `unchanged`, run decided → `gained-coverage`;
  - baseline decided, run undecided → `lost-coverage`; baseline undecided, run decided → `gained-coverage`; both undecided → `unchanged`;
  - both decided, meaning criterion with run `n < diff.minSamples[level]` (every meaning criterion at L0, which has no judge) or advisory → `inconclusive`;
  - baseline PASS and `passCount < minPasses(n, checkKind === 'meaning')` → `regressed`; baseline FAIL and `passCount ≥ minPasses` → `fixed`; else `unchanged`.
- Atomic and observation pairs are one section, journey pairs (`testKind: 'journey'`) another, both with the same categories. Gating: `regressed` or `lost-coverage` with layer S or `checkKind: 'rule'` in either section; plus `regressed` meaning criteria in the non-journey section (journey meaning criteria are reported only). `new`, `inconclusive` never gate.
- Exit codes (first match wins): 2 `baseline-invalid` (baseline suite/level differ from the run, judge fingerprint or coach model differ by stable JSON, explicit `--baseline` file missing, or any baseline file unparseable/schema-invalid; nothing is classified); 3 judge infrastructure (`report.judgeErrors` non-empty); 4 budget (any in-scope result or sample reason `budget-exceeded`); 1 any gating entry; 0 otherwise. Usage errors and an unreadable/invalid run report exit 1 with a `[suite] diff:` message and write nothing.
- Baseline source: `--baseline <path>` (resolved against the package dir); `--merge-base` reads `git show <git merge-base HEAD origin/main>:<package prefix>baselines/<suite>/<level>.json` (prefix from `git rev-parse --show-prefix`, i.e. `packages/conversation-sim/`) and never the working tree; default: the working-tree `baselines/<suite>/<level>.json`. A baseline absent at the merge-base or the default path is "no baseline": every pair is `new`, exit 0, with a `[suite] diff: no baseline at …` line. A failing `git merge-base`/`git rev-parse` is exit 2.
- The diff (`schemaVersion: 1`, baseline source/ref/path/missing, `acceptedFrom`, `provisional`, outcome, exit code, reasons, per-section entries and category counts) is stored as optional `diff` on `SuiteRunReport` (replacing an earlier one), rendered in `report.md`, and printed with `[suite]` lines, `lost-coverage` first, then `regressed`, `fixed`, `gained-coverage`, `new`, `retired`, `inconclusive`, `unchanged` (counts only for `unchanged`). Entries carry key, ids, layer, kinds, category, gating, baseline `{status, passCount, n}` and current `{status, passCount, n, minPasses}`; no evidence or transcript text.
- Each category and each exit code (0-4) has at least one test on synthetic run/baseline pairs.

**Never:**
- Live model calls, reading or printing secrets; changes in `packages/application` or `apps/*`; database migrations.
- Committing any baseline file, writing p-v1/smoke-v1 cases, CI jobs, root `pnpm suite:*` aliases, README docs (12.10).
- Reading the baseline from the working tree when `--merge-base` is given; changing `ScenarioRunReport`, `gate.config.json`, `run-gate.ts`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Clean | run equals baseline | all `unchanged`, exit 0 | N/A |
| Rule regression | baseline PASS 1/1, run FAIL 0/1, rule | `regressed`, gating, exit 1 | N/A |
| Meaning regression | L1 n 3, baseline PASS, run 1/3 (min 3), trusted | `regressed`, exit 1 | N/A |
| Meaning low n / advisory | L1 n 2 (< 3), or advisory | `inconclusive`, exit 0 | N/A |
| Journey meaning regression | journey, meaning, regressed | reported in journeys, exit 0 | N/A |
| Journey rule lost | journey rule PASS → ERROR | `lost-coverage`, exit 1 | N/A |
| Fingerprint / coach differ | baseline coach `gpt-4o`, run `null` | outcome `baseline-invalid`, exit 2, diff written | N/A |
| Merge-base | `--merge-base`, working tree baseline differs | merge-base content used | git failure → exit 2 |
| No baseline | none at merge-base / default path | all `new`, exit 0 | explicit missing `--baseline` → exit 2 |
| Judge errors / budget | `judgeErrors` non-empty / reason `budget-exceeded` | exit 3 / exit 4 | N/A |
| Bad usage | missing `--run`, both `--baseline` and `--merge-base`, unknown run | message, exit 1, nothing written | N/A |

</intent-contract>

## Code Map

- `packages/conversation-sim/src/suite/schema.ts:640-660,739-763,840-850` -- `ScoredCriterionSchema` (add `checkKind`), `SuiteRunReportSchema` (strict; add optional `diff`), `BaselineResultSchema` (add `layer`, `testKind`, `checkKind`); new `SuiteDiffSchema`/`DiffEntrySchema` here (single type source). `TestKindSchema`, `LayerSchema`, `CriterionStatusSchema` exist.
- `packages/conversation-sim/src/suite/score.ts:44,103-150,152-172` -- `minPasses(n, meaningDecided)` (reuse in diff), `aggregate` computes `meaningDecided` (set `checkKind`), `manifestNotTestable` (checkKind null).
- `packages/conversation-sim/src/suite/baseline.ts:69-97,122-140,143` -- `buildBaseline` (copy the new fields), `readRunReport(packageDir, runId)` (reuse), `stableJson` (reuse for fingerprint/coach compare), `baselinePath`, `isSafeId`.
- `packages/conversation-sim/src/suite/report.ts:139-190,193-205` -- `renderSuiteReportMarkdown` (add a Diff section), `writeSuiteReport(report, packageDir)` (reuse to write the report back with `diff`).
- `packages/conversation-sim/src/suite/cli.ts` -- `CliDeps` (add injectable merge-base reader), `HELP`, `parseArgs` (add `diff`), `main` dispatch, `readGitState` spawnSync pattern; exit-code doc comment says 0/1 today.
- `packages/conversation-sim/src/suite/config.ts` -- `loadSuiteConfig`; `diff.minSamples` has L1/L2 only.
- `packages/conversation-sim/src/suite/__fixtures__/runner.ts` -- `RUNNER_CONFIG`, `liveSuite()` (atomic with rule and rule+meaning criteria, journey, observation, a NOT TESTABLE row); reuse to build real reports for diff tests.
- `packages/conversation-sim/src/suite/baseline.test.ts:141-170`, `cli.test.ts` -- expectations on baseline `results` shape; temp package dir pattern for CLI tests.
- `packages/conversation-sim/package.json` -- add `suite:diff` script (`node --import tsx src/suite/cli.ts diff`).

## Tasks & Acceptance

**Execution:**
- [x] `src/suite/schema.ts` -- add `CheckKindSchema`, `checkKind` on `ScoredCriterionSchema`, `layer`/`testKind`/`checkKind` on `BaselineResultSchema`, `DiffCategorySchema`, `DiffEntrySchema`, `SuiteDiffSchema`, optional `diff` on `SuiteRunReportSchema`.
- [x] `src/suite/score.ts` -- set `checkKind` per aggregated result and null on manifest NOT TESTABLE rows.
- [x] `src/suite/baseline.ts` -- `buildBaseline` copies `layer`, `testKind`, `checkKind`.
- [x] `src/suite/diff.ts` (new) -- pure `baselineInvalidReasons(report, baseline)`, `diffRun(report, baseline | null, config, source)` returning `SuiteDiff` with entries, sections, counts, outcome and exit code; `parseBaselineJson(text, origin)`; `diffSummaryLines(diff)`.
- [x] `src/suite/report.ts` -- render the diff section (lost-coverage first, journeys separate).
- [x] `src/suite/cli.ts`, `package.json` -- `diff` command with `--run`, `--baseline`, `--merge-base`; default merge-base reader via `git`; write the report back; print summary; exit per the frozen rules; HELP lists exit codes 0-4.
- [x] Tests -- `src/suite/diff.test.ts` (every category, both sections, every exit code, `--case` narrowing, no baseline), `cli.test.ts` (diff command: write-back, usage errors, explicit missing baseline, real temp git repo for `--merge-base` with a differing working-tree file), `baseline.test.ts`/`score.test.ts` updated for the new fields.
- [x] `docs/agent-task-log.md` (one row), `_bmad-output/implementation-artifacts/sprint-status.yaml` (12-9 status).

**Acceptance Criteria:**
- Given a synthetic run and baseline written to a temp package dir, when `main(['diff', '--run', id])` runs, then `report.json` parses with `SuiteRunReportSchema`, carries `diff` with the categories, and the printed lines list `lost-coverage` before any other category.
- Given a temp git repo whose `origin/main` holds baseline A and whose working tree holds baseline B, when `diff --merge-base` runs, then the result reflects A.
- Given `pnpm --filter @entalent/conversation-sim test`, when it runs offline, then all suites pass.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 38 findings — high 0, medium 6, low 22, false 9, maybe-false 1
- findings:
  - `[low]` `[reject]` (edge) a directory or unreadable `--baseline` escapes as exit 1 instead of 2 — real but an operator has to point `--baseline` at a directory; the fix adds a guard branch.
  - `[low]` `[reject]` (edge) a baseline key whose criterion part fails `CRITERION_ID` makes `SuiteDiffSchema.parse` throw (exit 1) — keys are written only by `baseline:accept` from schema-valid results; needs a hand-edited file.
  - `[low]` `[reject]` (edge) a baseline key without `/` is silently dropped — same: only a hand-edited baseline can carry one.
  - `[medium]` `[patch]` (edge) any `git cat-file -e` failure is read as "absent at the merge-base", so a git error passes the gate as no-baseline/exit 0 — patched: absence is decided with `git ls-tree --name-only`; a non-zero exit throws (exit 2).
  - `[low]` `[reject]` (edge) `git show` under the 1 MiB default `maxBuffer` — a baseline needs thousands of criteria to reach it (p-suite has 37); not met in practice.
  - `[low]` `[reject]` (edge) decided → NOT_TESTABLE is a non-gating `retired`, a possible gate bypass — the frozen intent defines it (AD-2 retires criteria as not-testable); the manifest change shows in the PR; fix would edit the spec's intent.
  - `[false]` `[reject]` (edge) stable meaning pairs (PASS→PASS) counted `inconclusive` — AD-13 defines `inconclusive` for meaning criteria with low n or advisory regardless of the status change.
  - `[low]` `[reject]` (edge) 12.8-era run reports lack `checkKind` and fail to load — runs are local and gitignored, no baseline is committed; re-running `suite:run` regenerates them.
  - `[low]` `[patch]` (edge) `localeCompare` makes entry order locale-dependent — patched: code-point comparison.
  - `[false]` `[reject]` (edge, claim) spec names `diffSummaryLines(diff)`, code takes `(diff, runId)` — the only caller passes both; the fix would edit the spec.
  - `[medium]` `[patch]` (verification) the real `readMergeBaseFile` failure path (no `origin/main`) is never exercised — patched: real-git case without `origin/main` asserts exit 2 / `baseline-invalid` and the `git merge-base` reason.
  - `[medium]` `[patch]` (verification, other) `cat-file -e` failure taken as absence — same root as the edge `cat-file` row.
  - `[low]` `[reject]` (verification, other) required `checkKind` breaks old local run reports — same as the edge schema-drift row.
  - `[low]` `[patch]` (blind) `current.minPasses` is recomputed and contradicts the stored value (NOT_TESTABLE row shows `min n`) — patched: the diff uses `run.minPasses`.
  - `[medium]` `[patch]` (blind) the real-git test inherits `GIT_*` from the caller, so run from a git hook it could commit into the real repository — patched: the test's git helper strips every `GIT_*` variable.
  - `[low]` `[reject]` (blind) baseline/report schema change is not backward-compatible under `schemaVersion: 1` — no baseline is committed and runs are local; same as the edge schema-drift row.
  - `[low]` `[reject]` (blind) usage errors exit 1 like a gating regression — the spec settles it (the diff did not pass; CI fails either way and the `[suite] diff:` message names the cause).
  - `[medium]` `[patch]` (blind) `cat-file -e` failure taken as absence — same root as the edge `cat-file` row.
  - `[low]` `[reject]` (blind) 1 MiB `maxBuffer` — same as the edge row.
  - `[low]` `[reject]` (blind) run `n` vs baseline `n` not reported — classification uses the run's `n` by design (minPasses and minSamples are per-run); adds a branch for an informational line.
  - `[low]` `[reject]` (blind) `origin/main` hard-coded, shallow clones fail with exit 2 — the AC fixes `origin/main`; failing loudly is correct. Note for 12.10: checkout with `fetch-depth: 0` (or fetch `origin/main`).
  - `[low]` `[reject]` (blind) the no-baseline line is suppressed by a string prefix match — both strings live in `diff.ts` and the CLI test asserts the line; dev-only fragility, fix restructures the reasons.
  - `[false]` `[reject]` (blind) `selected()` lets out-of-scope rows outside a `--case` selection gate — a narrowed run holds only the selected tests' results plus in-scope manifest NOT TESTABLE rows, so no such row exists.
  - `[low]` `[reject]` (blind) non-atomic rewrite of `report.json` — an interrupted write leaves a run that can be re-run in seconds; not met in practice.
  - `[medium]` `[patch]` (blind) default git reader failure paths untested — same root as the verification gap row.
  - `[false]` `[reject]` (blind) the spec is missing from the diff — deliberately kept out of the reviewed diff (claims file for the edge layer only); Finalize commits it.
  - `[low]` `[reject]` (blind) whitespace `--run` gets "unsafe run id" instead of a usage error — still exit 1 with a clear `[suite] diff:` message; cosmetic.
  - `[false]` `[reject]` (intent) workflow not finished (no review, no commit) — the diff was staged for this review; Finalize sets done and commits.
  - `[low]` `[reject]` (intent) exit 2 broadened beyond fingerprint/coach mismatch — settled in the frozen intent (suite/level mismatch, missing explicit or unparseable baseline, git failure are baseline-invalid).
  - `[low]` `[reject]` (intent) exit 1 overloaded with usage errors — same as the blind row.
  - `[false]` `[reject]` (intent) precedence 2 > 3 > 4 > 1 is not in the AC — recorded in the frozen intent and Design Notes; entries are still classified and printed.
  - `[low]` `[reject]` (intent) out-of-scope run keys treated as missing vs AD-9 "excluded" — settled in the frozen intent; excluding them would hide a criterion narrowed out of scope.
  - `[maybe-false]` `[defer]` (intent) at L1 a rule+meaning criterion is `checkKind: meaning` when the judge ran, so its rule regression could be `inconclusive` under an uncalibrated judge and not gate (AD-15) — depends on how Epic 13 sets `meaningSkipped` when a rule check fails (AD-9: meaning applies only when no rule failed). Deferred, medium (unverified).
  - `[false]` `[reject]` (intent) journey S meaning criteria gate through the S clause — the AC gates "rule and S criteria" in journeys; consistent.
  - `[false]` `[reject]` (intent) the report is rewritten, not "appended" — the diff is appended to the report as its `diff` field.
  - `[low]` `[patch]` (intent) the real-git test only covers merge-base == HEAD — patched: a later HEAD commit changes the baseline and the diff still reflects the merge-base content.
  - `[low]` `[reject]` (intent) no mixed rule+meaning criterion through evaluate → score → diff — at L0 such criteria are rule-decided (`score.test.ts`); the L1 path is the deferred row.
  - `[false]` `[reject]` (intent) the 12.8 spec whitespace fix is bundled — required for `git diff --check` in `harness:check`; no behavior change.

## Design Notes

**Why the baseline carries layer and kinds:** `lost-coverage` and the S/rule gate must judge a criterion that vanished from the run; the manifest at HEAD may no longer describe it, so the baseline is the only reliable record. Reading them from the run when present keeps a re-layered criterion judged by its current definition.

**Exit precedence 2 > 3 > 4 > 1:** infrastructure outcomes explain an unreliable run (budget aborts turn cases into ERROR, i.e. `lost-coverage`), so they are reported as such rather than as regressions; the entries are still printed.

**No baseline is exit 0:** no baseline exists yet (user decision); 12.10 runs `--merge-base` in CI before the first baseline is committed, and the first baseline PR must not fail on its own absence at the merge-base. An explicit `--baseline` that does not exist is an operator error (exit 2).

## Verification

**Commands:**
- `pnpm --filter @entalent/conversation-sim test` -- expected: pass offline.
- `pnpm --filter @entalent/conversation-sim typecheck` and `pnpm --filter @entalent/conversation-sim lint` -- expected: no errors.
- `pnpm --filter @entalent/conversation-sim suite:run --suite smoke-v1 --level L0`, then `pnpm --filter @entalent/conversation-sim suite:diff --run <id>` -- expected: "no baseline" line, exit 0.
- `pnpm typecheck` -- expected: no errors.
- `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` -- expected: passing receipt.

## Auto Run Result

**Summary:** `suite/diff.ts` (pure) classifies every in-scope `<testId>/<criterionId>` pair of a run against a baseline into the eight AD-13 categories, in two sections (atomic/observation/NOT TESTABLE rows, and journeys), marks gating entries (regressed/lost-coverage S or rule; regressed meaning outside journeys) and decides the exit code (2 baseline-invalid > 3 judge errors > 4 budget > 1 gating > 0). `suite:diff --run <id> [--baseline <path> | --merge-base]` reads the baseline (explicit path, working tree by default, or `git show` at `git merge-base HEAD origin/main`, never the working tree), writes the diff into `report.json` (`diff` field) and `report.md`, and prints `[suite]` lines with `lost-coverage` first. A baseline absent at the merge-base or default path is "no baseline": every pair `new`, exit 0. Baseline entries now carry `layer`, `testKind`, `checkKind`; `ScoredCriterion` carries `checkKind` (no schema version bump).

**Files changed** (under `packages/conversation-sim/` unless noted):
- `src/suite/schema.ts` -- `CheckKindSchema`, `checkKind` on scored criteria, extended `BaselineResultSchema`, `AcceptedFromSchema`, diff schemas, optional report `diff`.
- `src/suite/score.ts` -- sets `checkKind` (meaning only when a meaning check decided it; null for manifest NOT TESTABLE rows).
- `src/suite/baseline.ts` -- `buildBaseline` copies layer and kinds.
- `src/suite/diff.ts` (new) -- `parseBaselineJson`, `baselineInvalidReasons`, `diffRun`, `diffSummaryLines`.
- `src/suite/report.ts` -- Diff section in `report.md`.
- `src/suite/cli.ts`, `package.json` -- `diff` command, `readMergeBaseFile` (`ls-tree --full-tree` for absence, `git show` for content), `suite:diff` script, HELP exit codes 0-4.
- Tests: `src/suite/diff.test.ts` (new), `cli.test.ts` (diff command, real temp git repo: merge-base A vs HEAD C vs working tree B, missing `origin/main`), `baseline.test.ts`, `score.test.ts`.
- `docs/agent-task-log.md`, `_bmad-output/implementation-artifacts/sprint-status.yaml`, and a trailing blank line removed from the 12.8 spec (`git diff --check`).

**Review:** one pass, 38 findings (high 0, medium 6, low 22, false 9, maybe-false 1). Patched 6 rows (4 fixes): `cat-file -e` failure no longer reads as "absent" (medium, 3 rows), real `readMergeBaseFile` failure path tested (medium, 2 rows), test git helper strips `GIT_*` (medium), diff uses the stored `run.minPasses` (low), code-point entry order (low), merge-base ≠ HEAD test (low). Deferred 1: mixed rule+meaning gating at L1 under an uncalibrated judge (medium, unverified; settles with Epic 13's judge). Rejected 31 with reasons in the triage log (notably: exit-2 breadth, exit-1 overload and precedence are frozen intent; `origin/main` hard-coded per AC, so 12.10 needs a full-history checkout; old local run reports lack `checkKind`, no baseline committed; 1 MiB `maxBuffer` and hand-edited baseline keys not met in practice).

**Follow-up review recommended: true** -- three medium entries were patched without another review pass. The unverified risk is `readMergeBaseFile` on real CI checkouts: the `ls-tree --full-tree` absence check and the merge-base failure path are proven only in a single-branch temp repo, not under `actions/checkout` (shallow or detached HEAD). Patched counts by entry verdict: high 0, medium 3, low 3.

**Verification:** `pnpm --filter @entalent/conversation-sim test` 39 files / 636 tests offline; package typecheck and lint clean; root `pnpm typecheck` clean; plain shell `suite:run --suite smoke-v1 --level L0` then `suite:diff --run <id>` and `--merge-base` (real `origin/main` of this repo) both `no-baseline (exit 0)`; `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` passed (receipt `runs/harness/receipt-1792949420487-2a40244e.json`).

**Residual risks:** exits 3 and 4 are proven only on synthetic reports (nothing emits judge errors or `budget-exceeded` yet); a 12.8-shape baseline or run report no longer validates (none committed); usage errors share exit 1 with gating failures.

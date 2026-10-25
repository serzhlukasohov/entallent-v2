---
title: 'Story 13.6: Pull-Request Gate for Prompt and Orchestrator Changes'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: 'd659517d68d80b58db89b272e09d86d0452e0322'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-conversation-eval-regression-2026-10-17/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Pull requests to develop read the L1 baseline and diff at git merge-base HEAD origin/main, not the PR base branch.
    evidence: |-
      readMergeBaseFile hard-codes origin/main (pre-existing, shared with the L0 suite-l0 job); the L1 workflow triggers on main and develop, so a develop PR is gated against main's baseline. Fix needs a base-ref option for every level.
    location: >-
      packages/conversation-sim/src/suite/cli.ts readMergeBaseFile
    severity: medium
  - summary: >-
      The L1 workflow's shell glue (Decide exit handling, Gate decision mapping) is asserted only as source text, never executed.
    evidence: |-
      l1-gate-workflow.test.ts matches substrings; no workflow-shell harness exists. Moving the mapping into a tested l1-gate.ts subcommand would close it.
    location: >-
      .github/workflows/conversation-suite-l1-pr.yml
    severity: low
---

<intent-contract>

## Intent

**Problem:** Pull requests that change prompts, the orchestrator, policies or the suite have no meaning-level regression check: L1 runs only by hand, `suite:ci` refuses every level but L0, and nothing decides which pull requests are relevant, so a conversation regression can merge unnoticed.

**Approach:** Add `.github/workflows/conversation-suite-l1-pr.yml` (no `paths` filter) with a `changes` job that runs a tested path filter and a tested run decision, and an `l1` job with a fixed name that either emits a `::notice::` and passes, or checks the `baseline-change` label and runs `suite:ci --level L1` through the live entry (`run-live.ts`), which runs `suite:run --level L1 --runs diff.minSamples.L1` and `suite:diff --merge-base` per suite. The gate is opt-in and inert by default.

**User decisions (2026-10-25, recorded as intent):** The QA suite `p-v1` (12.4) is out of scope and empty; smoke scenarios will live in `smoke-v1` after the framework; no L1 baseline exists yet. The epic-context "L1 is not wired into CI" note was a Story 13.1 scope limit, not a user decision: this story builds the L1 PR gate. Scheduled simulations are opt-in and model egress is a human boundary (AGENTS.md), so the gate runs live models only when the repository variable `CONVERSATION_SUITE_L1_PR_GATE_ENABLED` is `true`; it reuses only secret names existing workflows already reference and adds none; fork pull requests always take the notice path and never receive secrets; it passes with a clear notice when disabled, when no gated path changed, or when no suite has an L1 baseline at the merge-base. Nothing in this story runs a live model (workflows cannot run before push; tests use fakes; `--live-model` is never invoked locally). Uploaded artifacts are the run reports only (`report.json`, `report.md`), never `case-runs.json` (transcripts and model request/response events).

## Boundaries & Constraints

**Always:**
- Gated paths (exact list, repo-relative, matched with `**` = any depth, `*` = one segment): `packages/ai-openai/src/prompts/**`, `packages/ai-openai/src/openai-provider.ts`, `packages/application/src/use-cases/conversation-orchestrator.ts`, `packages/application/src/use-cases/proactive-*.ts`, `packages/application/src/policies/**`, `packages/application/src/utils/quiet-hours.ts`, `packages/conversation-sim/**`.
- New `src/suite/l1-gate.ts` (Node builtins plus `loadSuiteConfig` only; log prefix `[suite]`; never prints env values): pure `isL1GatePath(path)` / `l1GateChangedPaths(paths)`; pure `decideL1Gate(input) -> { decision: 'run' | 'skip' | 'error'; message }`; CLI `changes --base <sha> --head <sha> [--output <file>]` (`git -c core.quotePath=false diff --name-only -z --no-renames base...head`, appends `changed=true|false` to `--output`, git failure exits 1) and `decide --changed <true|false> [--output <file>]` reading `L1_GATE_FORK`, `L1_GATE_ENABLED` and presence booleans `HAS_OPENAI_API_KEY`, `HAS_AZURE_OPENAI_ENDPOINT`, `HAS_AZURE_OPENAI_API_KEY`, `HAS_AZURE_OPENAI_API_VERSION`, `HAS_AZURE_OPENAI_TESTING_DEPLOYMENT` (`'true'` means present), appending `decision=` and `message=` (single line). Decision order: not changed -> skip; fork -> skip; enabled is not exactly `true` -> skip naming the variable; missing credentials -> error (opted in but misconfigured fails closed). Credentials: the judge needs `OPENAI_API_KEY` when `suite.config.json` `judge.provider` is `openai`, the full Azure trio when `azure_openai`; the coach needs the full Azure set including `AZURE_OPENAI_TESTING_DEPLOYMENT` when `AZURE_OPENAI_ENDPOINT` is present, else `OPENAI_API_KEY`. Exit 0 for skip/run, 1 for error and usage errors.
- `cli.ts` `ci`: accepts `--level L1` (L2 still refused). At L1 it refuses up front with the existing `unsupportedLevel` message when `deps.createRunJudge` is absent (default entry). Per registered suite in config order: skipped `no L1 tests` when no test declares L1; reads `baselines/<suite>/L1.json` at the merge-base through `deps.mergeBase ?? readMergeBaseFile` and, when missing, skips `no L1 baseline at merge-base <ref>` without running; a merge-base read error is a `failed` outcome (exit 1, nothing run); otherwise `performRun` with `runs = config.diff.minSamples.L1` then `diffCommand(--merge-base)`. Nothing-to-check at L1 logs and summarizes `no registered suite has L1 tests and an L1 baseline at the merge-base; L1 gate passes with nothing to check`. When any ran report has `judgeTrust.trusted === false`, the summary states `Meaning checks are advisory (judge uncalibrated): this gate fails only on rule and S regressions or lost coverage.` L0 behavior, output and summary are unchanged.
- `run-live.ts`: also accepts `ci --level L1` (same `--live-model` refusal, same executor and judge wiring); still refuses other commands and levels; doc comment and `HELP` say the only automated caller is the opt-in L1 PR gate.
- Workflow: `on: pull_request` (branches `main`, `develop`, default types, no `paths`), `permissions: contents: read`, concurrency per PR number with `cancel-in-progress: true`. `changes` job (name `Suite L1 changes`): checkout `fetch-depth: 0`, `persist-credentials: false`, pnpm + node 24 + `pnpm install --frozen-lockfile`, then `l1-gate.ts changes` and `l1-gate.ts decide`; secrets reach it only as `${{ secrets.X != '' }}` booleans; outputs `changed`, `decision`, `message`. `l1` job: `name: Suite L1 gate`, `needs: changes`, `if: always()`, `timeout-minutes: 120`, `permissions: contents: read, pull-requests: read`. First step fails when `needs.changes.result != 'success'`; on `skip` prints `::notice::<message>` plus a step-summary line and exits 0; on `error` prints `::error::<message>` and exits 1. Only on `run`: checkout (`fetch-depth: 0`, no persisted credentials), install, `pnpm turbo run build --filter=@entalent/conversation-sim^...`, baseline guard with current labels from `gh pr view <n> --json labels --jq '[.labels[].name]'` (`GH_TOKEN: github.token`) into `baseline-guard.ts --base --head --labels`, then `node --import tsx src/suite/run-live.ts ci --level L1 --live-model --summary "$GITHUB_STEP_SUMMARY"` with env `OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_API_VERSION`, `AZURE_OPENAI_TESTING_DEPLOYMENT`, `OPENAI_MODEL_BALANCED: ${{ secrets.AZURE_OPENAI_TESTING_DEPLOYMENT }}`, `LANGWATCH_API_KEY: ''`; `if: always()` upload of `packages/conversation-sim/runs/suites/*/report.json` and `report.md` (retention 14 days, `if-no-files-found: ignore`) and a step appending the `artifact-url` link to the step summary when present.
- Tests use fakes only; README documents the gate, the variable, the secrets, the required check, and artifact contents.

**Never:**
- No live model call, no local `--live-model` invocation, no new secret, no secret value in logs or outputs, no secrets for fork pull requests.
- No change to `packages/application`, `apps/*`, `agent-service`, `ci.yml`, `conversation-sim.yml`, `suite-baseline-governance.yml`, `ScenarioRunReport`, `gate.config.json`, `run-gate.ts`, diff gating semantics, or the default `suite:run` L1 refusal.
- No upload of `case-runs.json`; no committed `baselines/**`, `calibration/**` or case content.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unrelated PR | only `apps/api/x.ts` changed | `changed=false`; `l1` notice, exit 0 | none |
| Gated paths | `proactive-check-in.ts`, `policies/a/b.ts`, `prompts/x.md` | each `changed=true`; `proactive/x.ts`, `use-cases/other.ts` not | none |
| Fork | changed, fork true, enabled | skip, fork notice | none |
| Disabled | changed, variable unset or `TRUE` | skip naming `CONVERSATION_SUITE_L1_PR_GATE_ENABLED` | none |
| Missing creds | enabled, no `OPENAI_API_KEY` | `decision=error`; `l1` fails | fail closed |
| Azure partial | endpoint set, deployment missing | error | fail closed |
| Git failure | bad base sha | `changes` exits 1; `l1` fails | fail closed |
| Empty suites | `ci --level L1`, both suites empty | skipped `no L1 tests`, nothing-to-check line, exit 0, no run folder | none |
| No baseline | L1 tests, no merge-base `L1.json` | skipped `no L1 baseline at merge-base <ref>`, executor never called, exit 0 | none |
| Gated run | fake executor and judge, merge-base baseline | run with n = `diff.minSamples.L1` (3), merge-base diff, untrusted -> advisory line, exit = diff code | none |
| Default entry | `main(['ci','--level','L1'])` without judge | exit 1, `suite:run:live` hint, nothing run | refusal |
| run-live | `ci --level L1` without `--live-model` / `ci --level L0` with it | exit 1 / exit 1 | refusal |

</intent-contract>

## Code Map

- `packages/conversation-sim/src/suite/cli.ts` -- `ciCommand` (~505, refuses non-L0 at ~512; L0 skip on `suite.tests.length === 0`; `performRun(..., runs: 1)` ~545), `ciSummaryMarkdown` (~575), `unsupportedLevel` (~768), `readMergeBaseFile` (~717), `diffCommand` merge-base branch (~690), `HELP` (~110-155), header doc (~43).
- `packages/conversation-sim/src/suite/run-live.ts` -- `runLive` command/level checks (~55-70), doc comment (~10-16, "No test, script or CI step runs it").
- `packages/conversation-sim/src/suite/baseline-guard.ts` -- reuse `runBaselineGuard` CLI and its git-diff pattern (`-z --no-renames`, `isEntryPoint`) as the model for `l1-gate.ts`.
- `packages/conversation-sim/src/suite/config.ts` `loadSuiteConfig`; `suite.config.json` (`diff.minSamples.L1` = 3, `judge.provider` = `openai`).
- `packages/conversation-sim/src/suite/baseline.ts` `baselinePath` -- relative `baselines/<suite>/<level>.json` used by the merge-base read.
- `LoadedTest.levels` (schema ~441, loader ~254) -- L1 test detection.
- `packages/conversation-sim/src/suite/report.ts` `renderCiSummary` (~280) -- already prints the trust line and usage; unchanged.
- `.github/workflows/conversation-sim.yml` (secret names and the `OPENAI_MODEL_BALANCED` mapping), `suite-baseline-governance.yml` (guard invocation), `ci.yml` `suite-l0` (build and upload pattern) -- read-only references.
- Tests: `cli.test.ts` `describe('suite:ci')` (~1093, `ciHarness` with `mergeBase` stub), `run-live.test.ts`, `baseline-guard.test.ts` (style for git-backed CLI tests); new `l1-gate.test.ts`, `l1-gate-workflow.test.ts`.
- `packages/conversation-sim/README.md` -- `### Baseline governance` (~446): add `### L1 pull-request gate`.

## Tasks & Acceptance

**Execution:**
- `packages/conversation-sim/src/suite/l1-gate.ts` -- path filter, decision, `changes`/`decide` CLI -- the workflow's only decision logic, testable.
- `packages/conversation-sim/src/suite/cli.ts` -- `ci --level L1` with judge refusal, L1 test and merge-base baseline skips, `minSamples` runs, advisory summary line, help -- reuses the L0 ci machinery.
- `packages/conversation-sim/src/suite/run-live.ts` -- allow `ci --level L1`, doc comment -- the live entry the job calls.
- `.github/workflows/conversation-suite-l1-pr.yml` -- workflow per Boundaries -- the gate.
- `packages/conversation-sim/src/suite/l1-gate.test.ts` -- every path and decision matrix row, `changes` against a temp git repo, `--output` format, git failure, usage errors.
- `packages/conversation-sim/src/suite/cli.test.ts`, `run-live.test.ts` -- L1 ci rows of the matrix, L0 ci unchanged, run-live ci acceptance and refusals.
- `packages/conversation-sim/src/suite/l1-gate-workflow.test.ts` -- reads the workflow text: no `paths:` key, job names `Suite L1 changes` / `Suite L1 gate`, `if: always()` on `l1`, every `secrets.<NAME>` within the allowed five, `--live-model` and secret values only in the `l1` run step, variable name present, `case-runs` never uploaded.
- `packages/conversation-sim/README.md` -- gate section; `docs/agent-task-log.md` -- one row.

**Acceptance Criteria:**
- Given the workflow file, when parsed as YAML, then it has `on.pull_request` without `paths`, jobs `changes` and `l1`, and `l1` named `Suite L1 gate` with `if: always()` and `needs: changes`.
- Given a gated run with fakes and an untrusted judge, when `ci --level L1 --summary <f>` finishes, then the summary contains the advisory line and the per-suite diff, and only rule or S regressions or lost coverage produce a non-zero code.
- Given the default `suite:ci --level L0`, when it runs on the empty suites, then its logs and summary are byte-identical to before.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 39 findings — high 0, medium 5, low 20, false 11, maybe-false 3
- findings:
  - `[medium]` `[defer]` (blind) PRs to `develop` read the L1 baseline and diff at `git merge-base HEAD origin/main` — pre-existing `readMergeBaseFile` behavior shared with the L0 `suite-l0` job (12.10); fixing it changes the merge-base contract for every level; deferred.
  - `[low]` `[patch]` (blind) Docs claim transcripts are never uploaded, but `report.md` carries rule evidence and QA review replies — README and workflow comment reworded: reports can include reply excerpts and evidence; `case-runs.json` (full transcripts, model events) is never uploaded.
  - `[low]` `[reject]` (blind) The gate's own workflow and lockfile are not gated paths — the gated path list is the AC's exact list (intent); widening it is an intent change.
  - `[low]` `[reject]` (blind) The path list misses other code the L1 executor runs (domain, contracts, other use cases) — same: the AC fixes the list.
  - `[maybe-false]` `[reject]` (blind) Dependabot PRs get no secrets and would fail an enabled gate — the repo has no `.github/dependabot.yml`; settling it needs the repo's security-update setting; if true only low (documented opt-in fails closed).
  - `[low]` `[reject]` (blind) One untrusted suite makes the advisory line cover all suites — trust is per suite and only matters with several L1 suites of mixed trust; `p-v1` is out of scope, so no second L1 suite exists; the per-suite sections already print each suite's trust.
  - `[low]` `[patch]` (blind) No total cost cap per gate run — README now states budgets apply per suite run and the worst case per push; a gate-wide cap would be new surface.
  - `[medium]` `[patch]` (blind) `if: always()` on `l1` also fires on cancellation and posts a failing check for superseded runs — changed to `!cancelled()`; a failed `changes` job still fails closed; test updated.
  - `[false]` `[reject]` (blind) No `merge_group` trigger — no workflow in the repo uses merge queues (`ci.yml` has none); the README claim concerns PRs.
  - `[low]` `[reject]` (blind) No package scripts for the new entries — README and HELP document the direct `node --import tsx` calls, like the governance workflow's guard call; cosmetic.
  - `[false]` `[reject]` (blind) The `suite:ci` usage line still says L0 — `pnpm suite:ci` is the default entry, which accepts only L0; the L1 form is listed separately in HELP and README.
  - `[false]` `[reject]` (blind) The spec's harness base is stale — the user mandates `3af7d0e...` for the whole PR's harness check.
  - `[low]` `[patch]` (blind) Task-log row has no harness receipt path — row updated with the final receipt.
  - `[low]` `[patch]` (blind) The YAML draft failure is not in `docs/agent-failures.md` — fixed entry added.
  - `[low]` `[reject]` (blind) Unrelated trailing blank line removed from the 13.5 spec — required: the mandated `--base 3af7d0e` harness whitespace check failed on it; a one-line whitespace fix in this PR's own artifact.
  - `[low]` `[reject]` (blind) Actions pinned by tag, not SHA — consistent with every workflow in the repo; repo-wide policy change.
  - `[low]` `[patch]` (blind) Workflow test gaps (fail-closed glue not asserted, fork/presence names in `l1`) — assertions added for `run=true`, the `*)` branch, the decide `grep -qx`, and no `L1_GATE_FORK`/`HAS_` in `l1`.
  - `[low]` `[reject]` (blind) The `changes` job does a full install — same pattern as `suite-baseline-governance.yml`; an optimization.
  - `[low]` `[defer]` (verification-gap) Workflow shell glue is checked only as source text, never executed — filed disposition defer: no workflow-shell harness exists; text assertions for the demonstrated regressions were added; moving the mapping into a tested subcommand is a follow-up.
  - `[medium]` `[defer]` (verification-gap other) `develop` PRs use `origin/main` merge-base — same root cause as the first row; deferred.
  - `[medium]` `[defer]` (edge) merge-base hard-coded to `origin/main` — same root cause; deferred.
  - `[maybe-false]` `[reject]` (edge) Same-repo bot PRs fail closed — same as the Dependabot row.
  - `[low]` `[patch]` (edge) `report.md` reply and evidence text land in the artifact — same root cause as the docs row; docs corrected (the intent accepts reports without full transcripts).
  - `[false]` `[reject]` (edge) `decide` fails on an unrelated PR when `suite.config.json` is invalid — on an unrelated PR the config is the base branch's, which every suite test already validates; a config change is itself a gated change.
  - `[low]` `[reject]` (edge) `spawnSync` 1 MiB buffer on huge diffs — needs about 15k changed paths; same as the existing baseline guard; unlikely.
  - `[low]` `[reject]` (edge) Advisory line omitted when the report re-read fails — the re-read failure is already logged as an error and drops that suite section; rare.
  - `[low]` `[reject]` (edge) Mixed trust across suites — same as the blind advisory row.
  - `[medium]` `[patch]` (edge) Cancelled run posts a failing check — same root cause as the blind cancellation row; patched.
  - `[maybe-false]` `[reject]` (edge, claim) The advisory line reads as if exits 2/3/4 were rule regressions — the line is the AC wording about gating categories; infrastructure exits are reported per suite with their codes; if true only low.
  - `[low]` `[patch]` (edge, claim) No `::notice::` when nothing is checked for lack of a baseline — the live step now emits a notice when the gate passes with nothing to check.
  - `[low]` `[reject]` (intent) The label guard runs only on a run decision — AC3 says "when the gate runs"; while disabled the governance workflow enforces the label (12.10), matching the intent's inert-by-default rule.
  - `[false]` `[reject]` (intent) No artifact link when the guard fails — no run happened, so no artifact exists to link; with the label, the run uploads and the link is added.
  - `[low]` `[patch]` (intent) The no-baseline pass is a log and summary line, not a notice — same root cause as the edge notice row; patched.
  - `[false]` `[reject]` (intent) "Lost coverage" has no L1 ci test — lost-coverage gating is the 12.x/13.5 diff code, unchanged here and covered by `diff.test.ts`; the L1 ci tests prove the diff exit code passes through.
  - `[false]` `[reject]` (intent) Three-dot diff versus "the base sha" — `base...head` is GitHub's own PR diff semantics and the baseline guard's; it ignores base-only commits, which is the intended comparison.
  - `[false]` `[reject]` (intent) The spine omits `policies/**` — the diff follows the epics AC, which includes it; the AC governs.
  - `[false]` `[reject]` (intent) Tests exercise text, not GitHub runtime — workflows cannot run before push (user decision); covered by the verification-gap defer.
  - `[false]` `[reject]` (intent) Spec not done, tree uncommitted — the audit read the tree before Finalize.
  - `[false]` `[reject]` (intent) Reports-only upload departs from the spine — it follows the intent's stated preference; not a defect.

## Design Notes

Skipping suites without a merge-base L1 baseline (instead of running and reporting `no baseline`) avoids live spend that cannot gate anything; the first baseline is human-accepted (13.5). Missing credentials with the gate enabled fail closed, because a required check that silently passes when misconfigured hides the opt-in. Labels are read live with `gh pr view` (not the event payload) so re-running the `l1` job after adding `baseline-change` sees the label; the workflow does not trigger on `labeled`, because that would rerun live L1 and let a label event replace a failed check. `if: always()` on `l1` stops a failed `changes` job from turning the required check into a passing skip.

## Verification

**Commands:**
- `pnpm --filter @entalent/conversation-sim test` -- expected: pass offline.
- `pnpm --filter @entalent/conversation-sim typecheck` and `pnpm --filter @entalent/conversation-sim lint` -- expected: clean.
- `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/conversation-suite-l1-pr.yml'))"` -- expected: parses.
- `pnpm suite:ci --level L0` -- expected: exit 0, unchanged output.
- `pnpm --filter @entalent/conversation-sim exec node --import tsx src/suite/run-live.ts ci --level L1` (no flag) -- expected: exit 1 refusal.
- `pnpm typecheck` and `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` -- expected: pass, receipt path.

## Auto Run Result

**Summary:** Opt-in L1 pull-request gate. `.github/workflows/conversation-suite-l1-pr.yml` (no `paths` filter) has `Suite L1 changes`, which runs the tested `l1-gate.ts changes` path filter (the AC's seven gated paths, `base...head`, `--no-renames`) and `decide` (not changed / fork / variable `CONVERSATION_SUITE_L1_PR_GATE_ENABLED` not exactly `true` -> skip; enabled with missing credentials -> error; else run; secrets reach it only as presence booleans). It also has `Suite L1 gate` (`if: !cancelled()`), which fails closed on a failed changes job or an error decision, and prints `::notice::` and passes on skip. On run it builds, runs the `baseline-change` guard with live labels (`gh pr view`), then `run-live.ts ci --level L1 --live-model --summary`, prints a notice when nothing was checked, uploads `report.json`/`report.md` only (14 days) and links the artifact. `suite:ci --level L1` needs an injected judge (the default entry refuses). It skips suites without L1 tests or without an L1 baseline at the merge-base, with no run and no spend, runs `diff.minSamples.L1` (3) samples plus the merge-base diff, and adds the advisory line while the judge is untrusted. L0 output is byte-identical. `run-live.ts` accepts `ci --level L1`. No live model call, no new secret.

**Files changed:**
- `.github/workflows/conversation-suite-l1-pr.yml` -- the gate workflow.
- `packages/conversation-sim/src/suite/l1-gate.ts` -- path filter, decision, `changes`/`decide` CLI.
- `packages/conversation-sim/src/suite/cli.ts` -- `ci --level L1`, skips, advisory summary line, help.
- `packages/conversation-sim/src/suite/run-live.ts` -- accepts `ci --level L1`; doc comment.
- Tests: `l1-gate.test.ts`, `l1-gate-workflow.test.ts` (new), `cli.test.ts`, `run-live.test.ts`.
- `packages/conversation-sim/README.md` -- `### L1 pull-request gate` (variable, secrets, required check, artifacts, cost).
- `docs/agent-task-log.md` (row), `docs/agent-failures.md` (fixed YAML-draft entry).
- `_bmad-output/implementation-artifacts/spec-13-5-*.md` -- trailing blank line removed (the mandated harness whitespace check failed on it).

**Review:** 39 findings (high 0, medium 5, low 20, false 11, maybe-false 3). Patched 5 entries: medium 1 (`!cancelled()` instead of `always()`, from 2 findings); low 4 (artifact-content wording and cost note in the docs; a `::notice::` when nothing is checked; workflow-test assertions for the fail-closed glue; agent-failures entry and receipt path in the task log). Deferred 2: medium, the `origin/main` merge-base for PRs to `develop` (pre-existing, from 3 findings); low, the workflow shell is tested only as text. Rejected, with reasons in the triage log: the gated path list is the AC's exact list (2); Dependabot and bot PRs (no dependabot config; maybe-false); a global advisory line with mixed trust (no second L1 suite); merge_group (no merge queue in the repo); package scripts, `suite:ci` usage, SHA pinning and full install (consistency or cosmetic); harness base (user-mandated); the 13.5 whitespace edit (required for the harness); config-invalid decide, maxBuffer and re-read edge cases (unlikely); advisory wording (the AC's own); intent-audit items (guard only on run per AC3 and the inert default, no artifact when the guard fails, lost coverage covered by the diff tests, three-dot semantics, policies in the AC, runtime untestable before push, pre-finalize snapshot, reports-only by intent).

**Follow-up review recommended:** false -- one medium and four low entries patched on a first pass.

**Verification:** `pnpm --filter @entalent/conversation-sim test` 55 files / 1032 tests pass offline (fakes only). Package typecheck clean. Lint clean after fixing one `no-regex-spaces` error the patch introduced. Root `pnpm typecheck` 24/24. `yaml.safe_load` parses the workflow. `pnpm suite:ci --level L0` exits 0 with unchanged output. `run-live.ts ci --level L1` without `--live-model` exits 1. `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` passed, receipt `runs/harness/receipt-1792966841743-01d77b23.json`.

**Residual risks:** the workflow has never run on GitHub (fork detection, `gh pr view` with the job token, `artifact-url`, `!cancelled()` semantics are unverified until the first PR after push). PRs to `develop` diff against `origin/main`'s baseline. With both suites empty and no L1 baseline, an enabled gate passes with nothing to check. Budgets are per suite run, so the worst case per push scales with the number of eligible suites. An opted-in gate fails closed for any PR whose run lacks secrets (for example bot PRs). Human steps: set `CONVERSATION_SUITE_L1_PR_GATE_ENABLED=true`, provide `OPENAI_API_KEY` (the pinned judge is OpenAI), plus the full Azure set only if the coach should use Azure, and make `Suite L1 gate` a required check.

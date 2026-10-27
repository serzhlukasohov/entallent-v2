---
title: 'Story 13.7: Scheduled Nightly and Weekly L1 Runs'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: '651401d3319f7af44cc77655a6fee51345f6c04f'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-conversation-eval-regression-2026-10-17/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** L1 runs only on gated pull requests (13.6), so conversation-quality drift between releases (model, provider or judge behavior changing under unchanged code) is never observed, and there is no automated five-sample run whose report could become the first L1 baseline.

**Approach:** Add a `suite-l1` job to `.github/workflows/conversation-sim.yml` behind the existing `authorize` job. It runs `run-live.ts ci --level L1 --runs <authorize runs> --include-unbaselined` (per suite: `suite:run --level L1 --runs N` then `suite:diff --merge-base`): nightly n = 1 (meaning diffs `inconclusive`, below `diff.minSamples.L1` = 3), weekly n = 5 (authoritative meaning diff). It uploads `runs/suites/**` and appends the per-suite summary.

**User decisions (2026-10-25, recorded as intent):** QA suite `p-v1` (12.4) is out of scope and empty; smoke scenarios come later in `smoke-v1`; no L1 baseline exists yet, so today the job is a clean no-op (every suite skipped `no L1 tests`). Scheduled simulations are opt-in and model egress is a human boundary (AGENTS.md). Scheduled L1 reuses `authorize` and `CONVERSATION_SIM_SCHEDULED_ENABLED` unchanged (scheduled runs need the variable; `workflow_dispatch` is manual and runs as it does today). Only secret names the workflow already references; no new secret. Nothing in this story runs a live model (workflows cannot run before push; tests use fakes; `--live-model` is never invoked locally).

**Planning decisions:** (1) Scheduled runs also run suites that have L1 tests but no merge-base L1 baseline, and their diff reports `no baseline` (exit 0). Drift monitoring needs reports regardless, and a weekly n = 5 report is the candidate for the first `baseline:accept`. The PR gate keeps skipping such suites. (2) Artifacts are `packages/conversation-sim/runs/suites/**` (reports plus `case-runs.json`) with 14-day retention. The AC and spine AD-15 and the Logging row say exactly that, and QA needs the transcripts. This departs deliberately from 13.6's reports-only PR gate, which stays unchanged. (3) Budgets stay at 600/150 per suite run. Weekly n = 5 is the same size as the baseline run 13.5 already bounds, so no deliberate raise is made.

## Boundaries & Constraints

**Always:**
- `cli.ts` `ci` gains `--runs <N>` (positive integer, same validation as `run`) and `--include-unbaselined`. Both are accepted only at L1/L2 (at L0 they are a `CliUsageError`, so L0 parse, logs and summary stay byte-identical). At L1, `--runs` overrides `diff.minSamples.L1`. `--include-unbaselined` makes a suite with L1 tests and no merge-base baseline run anyway, logging `[suite] ci: <id> has no L1 baseline at merge-base <ref>; running without a baseline (diff reports no baseline)`. A merge-base read error stays `failed`, and a suite with no L1 tests stays skipped `no L1 tests`. With `--include-unbaselined`, the nothing-to-check text becomes `no registered suite has L1 tests; L1 run passes with nothing to check` (13.6's wording is otherwise unchanged). When `--runs` is given, the summary adds `Samples per suite: n = N`. When N < `diff.minSamples.L1`, it also adds `With n = N below diff.minSamples.L1 (M), meaning criteria diff as inconclusive; only rule and S regressions or lost coverage can fail this run.`, and the same line is logged with the `[suite] ci:` prefix. Without the new flags, L1 `ci` behaves exactly as in 13.6.
- `run-live.ts`: no logic change (it already delegates `ci` parsing); doc comment and `HELP` name both automated callers (the opt-in PR gate and the opt-in scheduled `conversation-sim.yml` `suite-l1` job).
- `l1-gate.ts` gains a `credentials` command that reads the `HAS_*` presence booleans and `suite.config.json` `judge.provider` and reuses `missingL1Credentials`. When names are missing, it prints `[suite] l1-gate: model credentials missing for the L1 run: <names>` to stderr and exits 1; otherwise it logs `[suite] l1-gate: L1 credentials present` and exits 0. No `--output`, never values.
- Workflow job `suite-l1` (`name: Suite L1 scheduled run`, `needs: authorize`, `if: needs.authorize.outputs.should_run == 'true'`, `timeout-minutes: 180`), steps in this order:
  1. Checkout with `fetch-depth: 0` and `persist-credentials: false`.
  2. pnpm, node `'24'` with pnpm cache, `pnpm install --frozen-lockfile`, and `pnpm turbo run build --filter=@entalent/conversation-sim^...`.
  3. The `credentials` check with `HAS_X: ${{ secrets.X != '' }}` for the five names. On failure, `::error::` and the job fails closed.
  4. `node --import tsx src/suite/run-live.ts ci --level L1 --runs "$RUNS" --include-unbaselined --live-model --summary "$GITHUB_STEP_SUMMARY"` in `packages/conversation-sim`. `RUNS` comes from `needs.authorize.outputs.runs`. The env has the five secrets, `OPENAI_MODEL_BALANCED: ${{ secrets.AZURE_OPENAI_TESTING_DEPLOYMENT }}` and `LANGWATCH_API_KEY: ''`. The step exits with the ci code.
  5. Upload with `if: always()`: `packages/conversation-sim/runs/suites/**`, name `suite-l1-scheduled-${{ github.run_id }}-${{ github.run_attempt }}`, `if-no-files-found: ignore`, `retention-days: 14`.
  6. A step that appends the `artifact-url` to the step summary when it is present.
- Tests use fakes only. README documents the scheduled job, the variable, the secrets, n per schedule, artifact contents and the budget note.

**Never:**
- No change to the `on:` block, `authorize`, `simulate`, `permissions`, `pnpm sim:gate`, `ci.yml`, `conversation-suite-l1-pr.yml` or `suite-baseline-governance.yml`, and none to `packages/application`, `apps/*`, `agent-service`, `ScenarioRunReport`, `gate.config.json`, `run-gate.ts`, diff gating semantics, budgets or the default-entry L1 refusal.
- No live model call, no local `--live-model`, no new secret, no secret value in logs or outputs, no committed `baselines/**`, `calibration/**` or case content.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Empty suites | `ci --level L1 --runs 1 --include-unbaselined`, both suites empty | both skipped `no L1 tests`, new nothing-to-check line, exit 0, no run folder | none |
| Nightly, no baseline | L1 tests, merge-base `L1.json` missing, `--runs 1 --include-unbaselined` | runs n = 1, diff `no baseline` exit 0, summary has n line and inconclusive line | none |
| Nightly, baseline | fake run n = 1, meaning criterion fails vs a passing baseline | meaning entry `inconclusive`, exit 0 | none |
| Nightly, rule regression | n = 1, rule criterion fails vs a passing baseline | exit 1 | gating |
| Weekly | `--runs 5`, baseline present | executor called for 5 samples, no inconclusive-n line | none |
| Gate unchanged | `ci --level L1` without new flags, no baseline | skipped `no L1 baseline at merge-base <ref>` (13.6) | none |
| L0 refusal | `ci --level L0 --runs 3` or `--include-unbaselined` | usage error, exit 1 | refusal |
| Bad runs | `ci --level L1 --runs 0` / `abc` | usage error, exit 1 | refusal |
| Default entry | `main(['ci','--level','L1','--runs','1'])` without judge | exit 1 refusal, nothing run | refusal |
| Credentials | openai judge, Azure set only / OpenAI key present | exit 1 naming `OPENAI_API_KEY` / exit 0 | fail closed |

</intent-contract>

## Code Map

- `packages/conversation-sim/src/suite/cli.ts`:
  - `parseArgs` `ci` branch (~262-276): add the options. `ParsedCommand` `ci` (~166): add `runs?` and `includeUnbaselined?`. Copy the `run` branch's runs validation (~195).
  - `ciCommand` (~488): `runs` at ~537, skip handling ~521-534. `ciLevelSkip` (~586) returns `skip` with the merge-base ref; return a distinct `missing-baseline` kind so ci can decide.
  - `nothingToCheckText` (~578), `ciSummaryMarkdown` (~598), `HELP` (~110-155), header doc (~43-60).
- `packages/conversation-sim/src/suite/l1-gate.ts`: `missingL1Credentials`, `CREDENTIAL_NAMES`, `runL1Gate` dispatch, `decideCommand` (the `HAS_` read pattern), `USAGE`.
- `packages/conversation-sim/src/suite/run-live.ts`: doc comment (~10-20).
- `packages/conversation-sim/src/suite/diff.ts` `categorize` (~229): meaning is `inconclusive` when `run.n < minSamples`. Read-only; this is what makes nightly unable to fail on meaning.
- `packages/conversation-sim/src/suite/report.ts` `renderCiSummary` (~280): already prints verdict, n, trust, usage, layer table and diff. Unchanged.
- `.github/workflows/conversation-sim.yml`: `authorize` outputs `should_run` and `runs` (nightly cron `17 2 * * *` gives 1, weekly `23 3 * * 0` gives 5, dispatch gives the input). Append the new job after `simulate`.
- `.github/workflows/conversation-suite-l1-pr.yml`: step patterns to copy (build, live step env, upload, link).
- Tests:
  - `cli.test.ts` `describe('suite:ci')` (~1093): `ciHarness` serves merge-base files per suite; the L1 cases from 13.6 show fake executor and judge wiring.
  - `run-live.test.ts`, `l1-gate.test.ts`, and `l1-gate-workflow.test.ts` (indent-based block helpers; no YAML dependency).
- `packages/conversation-sim/README.md`: the `### L1 pull-request gate` section. Add `### Scheduled L1 runs` after it.

## Tasks & Acceptance

**Execution:**
- `packages/conversation-sim/src/suite/cli.ts`: ci flags, the unbaselined run path, summary and log lines, help and doc. Scheduled runs reuse the gate's run and diff machinery.
- `packages/conversation-sim/src/suite/l1-gate.ts`: the `credentials` command. It fails closed before any spend.
- `packages/conversation-sim/src/suite/run-live.ts`: the doc comment.
- `.github/workflows/conversation-sim.yml`: the `suite-l1` job per Boundaries, appended after `simulate`.
- `packages/conversation-sim/src/suite/cli.test.ts`, `l1-gate.test.ts`, `run-live.test.ts`: every matrix row. `run-live` passes `ci --level L1 --runs 1 --include-unbaselined --live-model` through to `run` without the flag.
- `packages/conversation-sim/src/suite/conversation-sim-workflow.test.ts` (new) reads the workflow text and asserts:
  - The `on:` block still has `workflow_dispatch`, both crons and no `pull_request`.
  - The `authorize` and `simulate` blocks are byte-identical to the pre-story text (compare against a sha256 of each extracted block, computed once from commit `651401d3319f7af44cc77655a6fee51345f6c04f`).
  - `suite-l1` has `needs: authorize` and the `should_run` condition.
  - The run step has `--runs "$RUNS"`, `--include-unbaselined` and `--live-model`, and only that step carries secret values.
  - Every `secrets.<NAME>` is within the allowed five.
  - The upload has `runs/suites/**` with retention 14 and `if: always()`.
- `packages/conversation-sim/README.md`: the scheduled section. `docs/agent-task-log.md`: one row.

**Acceptance Criteria:**
- Given the workflow file, when it is parsed as YAML, then the jobs are `authorize`, `simulate` and `suite-l1`, and `suite-l1` depends on `authorize` and runs only when `should_run` is `true`, so scheduled runs need `CONVERSATION_SIM_SCHEDULED_ENABLED=true`.
- Given a fake nightly ci run (`--runs 1 --include-unbaselined --summary f`) with a merge-base baseline, when it finishes, then the summary contains the layer table, verdict, diff, `Samples per suite: n = 1` and the inconclusive-n line, and a meaning-only regression exits 0.
- Given `pnpm suite:ci --level L0`, when it runs on the empty suites, then its output is unchanged.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 29 findings — high 0, medium 0, low 19, false 7, maybe-false 3
- findings:
  - `[low]` `[reject]` (blind) Sunday runs both the nightly n = 1 and the weekly n = 5, with no concurrency group: the two crons and their mapping are the pre-existing `authorize` job, which the intent keeps unchanged. The AC asks for both "every night" and weekly, the extra Sunday n = 1 is bounded by the per-run budgets, and suppressing it would mean changing `authorize`.
  - `[maybe-false]` `[reject]` (blind) `suite-l1` and `simulate` share one model quota at the same time: settling it needs the real deployment's rate limits. If true it is only low, because a coach timeout is reported as infrastructure (exit 3/4), not as drift.
  - `[low]` `[reject]` (blind) No alert path or owner for scheduled failures: GitHub's standard failed-workflow notifications apply. An alerting integration is new surface outside the story.
  - `[low]` `[reject]` (blind) The inconclusive-n line is printed even when nothing ran or there is no baseline: its wording is the intent-contract's unconditional rule, and the statement holds as a rule about meaning diffs at that n. Making it conditional adds state for a cosmetic line.
  - `[low]` `[reject]` (blind) The scheduled run is still labelled "gate" in the heading and exit line: cosmetic. The spec keeps the 13.6 wording except for the nothing-to-check text, and renaming adds branches.
  - `[low]` `[patch]` (blind) No test shows weekly n = 5 gating on meaning: added a `--runs 5` test where a P-layer meaning regression against a passing baseline with a trusted judge is `regressed` and exits 1.
  - `[low]` `[patch]` (blind) How to turn a weekly artifact into the first baseline is undocumented: README now gives the download/unpack/`suite:baseline:accept --run --ci-run-url` steps, the preconditions accept enforces, and the 14-day window.
  - `[low]` `[patch]` (blind) The sha256 pins give no hint how to refresh them: a comment now says a deliberate `authorize`/`simulate` edit must update the pins, and how to recompute them.
  - `[low]` `[patch]` (blind) The task-log row has no harness receipt path: the row now names the final receipt.
  - `[low]` `[patch]` (blind) `ALLOWED_SECRETS = CREDENTIAL_NAMES` lets a future credential name silently widen the "no new secret" check: pinned to a literal five-name array.
  - `[low]` `[reject]` (blind) The `ranRun()` helper selects by `n !== 5`: a test-only fragility that would surface as a loud test failure, not a silent pass. Unlikely in everyday use.
  - `[low]` `[reject]` (blind) Flags not tested at L2, `--runs 007`, no upper bound: `ci --level L2` is refused before running (`ciCommand`). `007` is a valid positive integer, and spend is capped by the per-run budgets (exit 4).
  - `[low]` `[reject]` (edge) Sunday double run: same as the first blind row.
  - `[maybe-false]` `[reject]` (edge) The 180-minute timeout kills a long weekly run before any report: settling it needs real suite sizes. No suite has L1 tests today. If true it is only low: the upload is `if: always()`, so finished runs still upload.
  - `[false]` `[reject]` (edge) `if-no-files-found: ignore` hides a crash: a crash fails the run step, so the job is red. `ignore` is required because the empty-suite run legitimately writes nothing.
  - `[low]` `[reject]` (edge) `--runs` with a huge digit string: same as the blind L2/upper-bound row. Budgets end the run with exit 4.
  - `[false]` `[reject]` (edge) CRLF checkout breaks the sha256 assertions: CI runs on ubuntu and the repo's workflows are LF. The 13.6 workflow test reads the same way.
  - `[low]` `[reject]` (edge) The inconclusive line appears when every suite was skipped: same as the blind inconclusive row.
  - `[low]` `[reject]` (edge, claim) The inconclusive line says only rule/S regressions or lost coverage can fail, but exits 2/3/4 also fail: the wording is the intent-contract's (fix = editing the spec). It describes diff gating categories. Infrastructure exits are printed per suite with their codes. Same disposition as 13.6's advisory line.
  - `[low]` `[patch]` (edge, claim) The README says drift is observed when the model, provider or judge changes, but a changed coach model or judge fingerprint is baseline-invalid (exit 2): reworded the README and the workflow comment.
  - `[low]` `[reject]` (intent) Weekly n = 5 depends on the unchanged `authorize` cron mapping and is not tested end to end: `authorize` is kept byte-identical by intent and hash-pinned. The ci `--runs 5` path is tested.
  - `[false]` `[reject]` (intent) "The opt-in applies to scheduled runs only" holds only through the reused `authorize`: that reuse is the intent itself.
  - `[low]` `[reject]` (intent) An Azure-only opted-in repo now has a red workflow from `suite-l1`: deliberate fail-closed choice (Design Notes), consistent with the reused 13.6 credential rule. `simulate` itself is unchanged.
  - `[false]` `[reject]` (intent) The AC's literal `--suite p-v1` becomes a loop over all registered suites: `p-v1` is in the loop. This is the same aggregate `ci` 13.6 used for its literal per-suite AC.
  - `[false]` `[reject]` (intent) Nightly reports `no-baseline`, not `inconclusive`, until a baseline exists: this is inherent until a human accepts a baseline (intent: no L1 baseline yet). It is tested both ways.
  - `[low]` `[reject]` (intent) The usage lines are not asserted in the scheduled path: `renderCiSummary` is unchanged and its usage lines are covered by the 13.5 report tests.
  - `[false]` `[reject]` (intent) The artifact effect and runtime are unverified: workflows cannot run before push (user decision). The text and YAML structure are checked.
  - `[maybe-false]` `[reject]` (intent) The epic-context "no L1 workflows" note is not reconciled in the spec: the intent-contract records the user's 2026-10-25 decisions to build the scheduled runs. Whether the note needs a context-file edit is a planning-artifact question. If true it is only low.
  - `[false]` `[reject]` (intent) Weekly n = 5 is asserted to fit the budgets by analogy: the intent allows "fit or document", and the README documents it.

## Design Notes

The scheduled path is the PR gate's `ci` with two opt-in flags, not a second runner, so run and diff, exit precedence and summary rendering stay single-sourced. Credentials fail closed: the pinned judge needs `OPENAI_API_KEY`, which the legacy `authorize` check does not require (it accepts Azure-only). An opted-in schedule that could never judge should fail visibly instead of passing silently. The `simulate` job is untouched, so the legacy gate's result is independent of the suite job.

## Verification

**Commands:**
- `pnpm --filter @entalent/conversation-sim test`: passes offline.
- `pnpm --filter @entalent/conversation-sim typecheck` and `pnpm --filter @entalent/conversation-sim lint`: clean.
- `python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/conversation-sim.yml')); print(list(d['jobs']))"`: prints `['authorize', 'simulate', 'suite-l1']`.
- `pnpm suite:ci --level L0`: exit 0 with unchanged output.
- `pnpm --filter @entalent/conversation-sim exec node --import tsx src/suite/run-live.ts ci --level L1 --runs 1 --include-unbaselined` (no flag): exit 1 refusal.
- `pnpm typecheck` and `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5`: pass, and the receipt path is reported.

## Auto Run Result

**Summary:** Opt-in scheduled L1 runs. `.github/workflows/conversation-sim.yml` gains a `suite-l1` job (`Suite L1 scheduled run`) behind the unchanged `authorize` job. Scheduled runs need `CONVERSATION_SIM_SCHEDULED_ENABLED=true`, and `workflow_dispatch` is manual. The job runs only on `should_run == 'true'`, with `runs` from `authorize`: nightly 1, weekly 5, dispatch from its input. It builds and runs a fail-closed `l1-gate.ts credentials` presence check: the pinned openai judge needs `OPENAI_API_KEY` even when `authorize` accepts an Azure-only set. It then runs `run-live.ts ci --level L1 --runs "$RUNS" --include-unbaselined --live-model --summary`, uploads `runs/suites/**` (reports plus `case-runs.json`, 14 days, `if: always()`) and links the artifact. `suite:ci` gains `--runs N` (overrides `diff.minSamples.L1`) and `--include-unbaselined` (suites with L1 tests but no merge-base baseline run, and the diff reports `no-baseline`). Both flags are a usage error at L0, so L0 is byte-identical and the PR gate is unchanged. The summary adds `Samples per suite: n = N`, plus an inconclusive line below the minimum. Nightly n = 1 cannot fail on meaning; rule and S regressions still fail. Weekly n = 5 gates on meaning. `authorize`, `simulate`, `on:` and `permissions` are byte-identical (hash-pinned). No live model call, no new secret, budgets unchanged.

**Files changed:**
- `.github/workflows/conversation-sim.yml`: the `suite-l1` job.
- `packages/conversation-sim/src/suite/cli.ts`: ci `--runs` / `--include-unbaselined`, missing-baseline handling, samples and inconclusive lines, help and doc.
- `packages/conversation-sim/src/suite/l1-gate.ts`: `credentials` command, plus a shared `credentialPresence` helper.
- `packages/conversation-sim/src/suite/run-live.ts`: doc comment naming both automated callers.
- Tests: `cli.test.ts`, `l1-gate.test.ts` and `run-live.test.ts` (matrix rows), and the new `conversation-sim-workflow.test.ts` (structure, secret allowlist, authorize/simulate sha256 pins).
- `packages/conversation-sim/README.md`: the `### Scheduled L1 runs` section (opt-in, n per schedule, credentials, artifacts, accepting the first baseline, budgets, drift scope).
- `docs/agent-task-log.md`: one row.

**Review:** 29 findings: high 0, medium 0, low 19, false 7, maybe-false 3.
- **Patched (6 low entries):**
  - a weekly n = 5 meaning-regression test that exits 1
  - README steps for accepting a weekly artifact as the first baseline
  - README drift wording (a coach model or judge change is baseline-invalid, exit 2)
  - a refresh comment on the sha256 pins
  - a literal five-name secret allowlist
  - the receipt path in the task-log row
- **Deferred:** none.
- **Rejected, with reasons in the triage log:**
  - The Sunday double run (twice): the pre-existing `authorize` crons, unchanged by intent.
  - The shared model quota: maybe-false.
  - No alert path: GitHub's standard notifications apply.
  - The inconclusive line printed unconditionally (twice), and its exits 2/3/4 wording: the intent-contract's text.
  - "Gate" labels: cosmetic.
  - The `ranRun` helper and the L2, `007` and upper-bound edge cases: L2 ci is refused, and budgets cap spend.
  - The 180-minute timeout: maybe-false, and the upload runs `always()`.
  - `if-no-files-found: ignore`: false, because a crash fails the step.
  - CRLF: false.
  - The intent-audit items:
    - reuse of `authorize`, and the n = 5 mapping inherited from it;
    - the Azure-only red workflow, which is the deliberate fail-closed choice;
    - the `p-v1` loop;
    - `no-baseline` before the first baseline exists;
    - usage lines, which are covered by the 13.5 tests;
    - runtime that cannot run before push;
    - the epic-context note, superseded by the recorded user decision;
    - the budgets, which are documented.

**Follow-up review recommended:** false. Patched counts are high 0, medium 0, low 6.

**Verification:**
- `pnpm --filter @entalent/conversation-sim test`: 56 files and 1068 tests pass offline, with fakes only.
- Package typecheck and lint are clean, and root `pnpm typecheck` is 24/24.
- `yaml.safe_load` prints the jobs `['authorize', 'simulate', 'suite-l1']`.
- `pnpm suite:ci --level L0` exits 0 with unchanged output.
- `run-live.ts ci --level L1 --runs 1 --include-unbaselined` without `--live-model` exits 1.
- `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` passed, receipt `runs/harness/receipt-1792967910682-d34dd1f0.json`.

**Residual risks:**
- The job has never run on GitHub: the `secrets.X != ''` expressions, `artifact-url` and real artifact contents are unverified until the first opted-in run.
- Today both suites are empty, so an opted-in run is a no-op.
- Sunday runs n = 1 and n = 5. The pre-existing crons are unchanged.
- Opting in with Azure-only secrets turns the workflow red through `suite-l1`, by design.
- `case-runs.json` (synthetic transcripts and model request/response events) is in the 14-day artifact.
- Non-main refs still diff against `origin/main`'s merge-base (deferred in 13.6).

Human steps:
- Set `CONVERSATION_SIM_SCHEDULED_ENABLED=true`, which also enables the legacy `simulate` schedule.
- Provide `OPENAI_API_KEY` (the pinned judge), plus the full Azure set only if the coach should use Azure.
- Accept the first weekly n = 5 report once `smoke-v1` has L1 tests.

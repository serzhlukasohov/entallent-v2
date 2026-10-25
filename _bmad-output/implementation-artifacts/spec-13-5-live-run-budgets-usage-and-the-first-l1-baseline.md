---
title: 'Story 13.5: Live Run Budgets, Usage and the First L1 Baseline'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: 'ef31ff2642a8f8b9b6cf8f4b210eb8a863d45645'
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

**Problem:** `suite.config.json` budgets (600 coach / 150 judge calls) are validated but never enforced, `usage.coachModelCalls` is always 0, there is no per-model usage, a stalled live coach or judge call has no timeout (deferred from 13.1/13.4), `suite:run` never exits 4, and an untrusted L1 run can be accepted as a baseline whose entries carry no advisory flag, so after calibration a trusted FAIL vs an uncalibrated baseline PASS gates as a regression (13.3 deferral).

**Approach:** The runner owns a per-invocation call budget: coach calls are reserved through a budget hook the L1 executor calls before every coach model call, judge calls through a runner-side judge guard; once spent, remaining cases become `ERROR budget-exceeded` without executing, the run is provisional and `suite:run` exits 4. Coach calls get a per-call timeout in the L1 executor and the judge a `generateText` timeout, both from config. Baselines store `advisory` per entry and the diff treats meaning pairs with an advisory baseline side as `inconclusive` (AD-13).

**User decisions (2026-10-25, recorded as intent):** The QA suite `p-v1` (12.4) is out of scope and empty; smoke scenarios will live in `smoke-v1` and are written after the framework is done. No live model calls in this story; model egress and cost are a human boundary (AGENTS.md). The AC "the first L1 baseline is committed" is replaced by: everything needed to produce and accept an L1 baseline is built and proven offline with fake providers and judges; the first real L1 baseline is produced later by a human-run `suite:run:live` once `smoke-v1` has scenarios and QA calibration exists. No baseline is committed. The 13.3 deferral is settled by storing advisory per baseline entry (not by refusing untrusted accepts), consistent with AD-13 "inconclusive when advisory".

## Boundaries & Constraints

**Always:**
- Config: `budgets` becomes `{ maxCoachCallsPerRun: 600, maxJudgeCallsPerRun: 150, coachCallTimeoutMs: 120000, judgeCallTimeoutMs: 60000 }` (all positive ints, strict). Budgets are absolute per invocation (all `--runs` samples together, retries included); the judge timeout lives outside `judge` so the fingerprint (AD-8) is unchanged.
- `executors/types.ts`: `CallBudget { tryCoachCall(): boolean }` (true reserves one call; false means the call must not be made). `ExecutorOptions` gains optional `budget?: CallBudget` and `coachCallTimeoutMs?: number`. The runner passes both on every attempt.
- L1 executor: the per-attempt provider is wrapped (inside `record()`, so refused and timed-out calls still appear as error events) so every method call first asks `budget.tryCoachCall()` (refused -> flag `budgetExceeded`, throw without calling) and races the call with a `coachCallTimeoutMs` timer (cleared on settle, `unref`; timeout -> flag `timedOut`, reject with a message containing `request timed out`). After each conversation step's turn (and after the observation window) a set flag ends the case: `budgetExceeded` -> `ExecutionError { kind: 'product', step, reason: 'budget-exceeded' }`, else `timedOut` -> `{ kind: 'infrastructure', step, reason: 'coach-timeout' }` (retried once as usual), even when the orchestrator swallowed the failure and produced a fallback reply; no step observation is recorded for that step. Without `budget` the executor behaves as today. The L0 executor ignores both options.
- Runner: one `RunBudget` per `runSuite` counts reserved coach calls per `executor.coachModel` label and judge calls. Before each case attempt, if coach calls >= max or judge calls >= max, the attempt is not executed: a synthetic run with `{ kind: 'product', step: 0, reason: 'budget-exceeded', message: '<coach|judge> call budget <max> spent' }`. `budget-exceeded` is never retried. Judging is wrapped: when judge calls >= max the wrapper returns `{ status: 'ERROR', reason: 'budget-exceeded', message, usage: empty }` without calling; otherwise it calls and adds `outcome.usage.calls` and tokens (one invocation may overshoot by its single transport retry). `JudgeErrorReason` gains `budget-exceeded`; `collectJudgeErrors` keeps listing only `judge-transport`/`judge-invalid-output`.
- Report (`SuiteRunReport`, optional fields so older reports parse): `budget: { maxCoachCalls, maxJudgeCalls, coachCalls, judgeCalls, exceeded: Array<'coach' | 'judge'> }` and `modelUsage: Array<{ role: 'coach' | 'judge'; model: string; calls; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null }>` (coach tokens `null`: not observable through `AiProviderPort`; judge row only when a judge is configured, model = `models.judge`). `usage.coachModelCalls` = reserved coach calls. `exceeded` names a budget whenever any call or case was refused for it; then `provisional: true` with reason `budget exceeded: <coach|judge>` appended.
- `report.md` `## Usage`: a per-model table (role, model, calls, tokens or `n/a`) and a budget line `coach x/600, judge y/150`; `renderCiSummary` adds one usage line per model row only when `modelUsage` has calls (L0 CI summary unchanged). Console `summaryLines` adds `[suite] budget exceeded: ...` when exceeded.
- `suite:run` exits 4 when `report.budget.exceeded` is non-empty (report, case runs still written); help and the header doc comment updated. `ci` keeps its current precedence (its diff already exits 4).
- Judge timeout: `CriterionJudgeDeps.timeoutMs?` passed as `generateText({ timeout })`; a timeout is a transport failure (retried once, then `judge-transport`). `CliDeps.createRunJudge` and `createCalibrationJudge` receive `(judge, { callTimeoutMs })`; `run-live.ts` and `calibrate-live.ts` pass it into `createCriterionJudge`.
- Baseline: `BaselineResult.advisory?: boolean` (optional, absent = false, so merge-base baselines from before this story parse); `buildBaseline` always writes `advisory: result.advisory`. Accept of an untrusted L1/L2 run still succeeds and logs `[suite] baseline: meaning results are advisory (<trust reason>); they diff as inconclusive until re-accepted from a trusted run`. Diff `categorize`: a meaning pair with both sides decided is `inconclusive` when `run.n < minSamples || run.advisory || base.advisory === true`.
- Offline only: fakes (`ScriptedAiProvider`, fake judges, mock language model), log prefix `[suite]`.

**Never:**
- No live model call, network, or run of `suite:run:live --live-model`; no committed `baselines/**`, `calibration/**` or P-case content; no CI workflow change.
- No change to `packages/application`, `apps/*`, `agent-service`, `ScenarioRunReport`, `gate.config.json`, `run-gate.ts`, the judge fingerprint fields, or L0 executor behavior.
- No refusal of untrusted accepts; no budget scaling by `--runs`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Under budget | L1, fake executor, 3 coach calls/case | `coachCalls` counted, `exceeded: []`, exit 0 | none |
| Coach budget hit mid-case | max 4, case 2 needs call 5 | case 2 ERROR `budget-exceeded` from that step; cases 3+ ERROR `budget-exceeded` without execution; provisional; `suite:run` exit 4 | no retry |
| Judge budget spent | max 2, 3 meaning criteria | third criterion ERROR `budget-exceeded`, later cases skipped, not in `judgeErrors`; exit 4 | no retry |
| Orchestrator swallows refused call | fallback reply produced | case still ERROR `budget-exceeded` | none |
| Coach call stalls | provider never resolves, timeout 20 ms | ERROR infrastructure `coach-timeout`, retried once | retry |
| Judge stalls | mock model awaits abort, timeout 20 ms | ERROR `judge-transport` after one retry | retry once |
| L0 run | smoke-v1 L0 | `coachCalls 0`, no judge row, exit 0, CI summary unchanged | none |
| Advisory baseline | untrusted baseline PASS, trusted run FAIL n=5 | `inconclusive`, not gating | none |
| Old baseline | entries without `advisory` | parses; treated as non-advisory | none |
| Five-sample accept | L1 n=5 via `main`, fake executor and judge | every result `n: 5`, `samples` length 5; accept writes `baselines/<suite>/L1.json` with judge and coach provenance and `advisory` per entry | n=4 refused |

</intent-contract>

## Code Map

- `packages/conversation-sim/suite.config.json`, `src/suite/schema.ts` ~921 (`budgets`), ~752 (`UsageSchema`), ~860-895 (`SuiteRunReportSchema`), ~1085 (`BaselineResultSchema`) -- config, report and baseline shapes.
- `src/suite/runner.ts` -- `runSuite` sample loop (~150-180), `execute` (~240), `caseRunFailureKind`, report meta (`usage: { coachModelCalls: 0, ... }` ~205); add `RunBudget`, judge guard, `budget`/`modelUsage`, provisional reason.
- `src/suite/executors/types.ts` -- `ExecutorOptions`, `SuiteExecutor`; add `CallBudget`.
- `src/suite/executors/l1-orchestrator-executor.ts` -- `run()` (~151-245), `driveConversation` turn check (~305-330 in the after-agent script step), observation window (~215), `createL1World` (`record(provider, 'aiProvider', ...)` ~401) -- wrap the provider before `record`.
- `src/suite/judge/criterion-judge.ts` -- `JudgeErrorReason`, `CriterionJudgeDeps`, `generateText` call; `judge/decide-meaning.ts` (~7, ~22) consumes the reason type.
- `src/suite/report.ts` -- `SuiteReportMeta`, `buildSuiteReport`, `renderSuiteReportMarkdown` `## Usage`, `renderCiSummary`; `collectJudgeErrors` unchanged.
- `src/suite/baseline.ts` -- `buildBaseline`; `src/suite/diff.ts` `categorize` (~200-225); `budgetExceededKeys` already exits 4.
- `src/suite/cli.ts` -- `CliDeps.createRunJudge`/`createCalibrationJudge` (~81-86), `performRun`/`runCommand` (~340-420), `acceptCommand` (~615), `summaryLines`, `HELP`; `src/suite/run-live.ts` (~81), `src/suite/judge/calibrate-live.ts` (~47).
- `src/gate/failure-kind.ts` `isTransportFailureMessage` -- the timeout message must match it.
- Tests: `config.test.ts` ~23, `__fixtures__/runner.ts` ~18, `runner.test.ts`, `l1-orchestrator-executor.test.ts`, `criterion-judge.test.ts`, `report.test.ts`, `baseline.test.ts`, `diff.test.ts`, `cli.test.ts`, `run-live.test.ts`, `calibrate-live.test.ts`; `README.md`.

## Tasks & Acceptance

**Execution:**
- `suite.config.json`, `src/suite/schema.ts` -- timeouts in `budgets`, report `budget`/`modelUsage`, `BaselineResult.advisory?` -- shapes first.
- `src/suite/executors/types.ts`, `src/suite/executors/l1-orchestrator-executor.ts` -- `CallBudget`, guarded and timed provider, flag checks after each turn and the window.
- `src/suite/judge/criterion-judge.ts`, `judge/decide-meaning.ts` -- `timeoutMs`, `budget-exceeded` reason.
- `src/suite/runner.ts`, `src/suite/report.ts` -- run budget, judge guard, skipped cases, usage per model, provisional reason, markdown and CI lines.
- `src/suite/baseline.ts`, `src/suite/diff.ts` -- advisory per entry, inconclusive on advisory baseline.
- `src/suite/cli.ts`, `src/suite/run-live.ts`, `src/suite/judge/calibrate-live.ts`, `README.md` -- exit 4, judge timeout wiring, accept advisory log, help/docs (including the human steps for the first L1 baseline).
- Tests for every matrix row: runner (coach and judge budget, skip, no retry, counts per model, L0 zeros), L1 executor (refused call with swallowed failure, timeout -> `coach-timeout`, no budget = unchanged), judge (timeout via a mock model that rejects on abort), report (usage table, budget line, CI line only with calls), baseline/diff (advisory written, advisory baseline inconclusive, old baseline parses), cli (exit 4 with report written, n=5 L1 run then accept writes `L1.json`, n=4 refused, untrusted accept logs advisory line), run-live/calibrate-live (timeout passed).

**Acceptance Criteria:**
- Given an injected L1 executor whose cases exceed `maxCoachCallsPerRun`, when `main(['run', ...'--level', 'L1'])` runs, then `report.json` has remaining criteria `ERROR budget-exceeded`, `provisional: true`, `budget.exceeded: ['coach']`, and the exit code is 4.
- Given any L1 run, when the report is written, then `report.md` shows coach and judge usage per model and the budget line.
- Given `main(['run', '--suite', <s>, '--level', 'L1', '--runs', '5'])` with fakes, when it completes and `baseline:accept --run <id>` runs, then every `results[key]` has `n: 5` and five `samples`, and `baselines/<s>/L1.json` carries `judge.fingerprint`, `coach.model` and per-entry `advisory`; with `--runs 4` accept refuses.
- Given the default entry, when `suite:run --suite smoke-v1 --level L0` runs, then it exits 0 with `coachModelCalls: 0` and the CI summary text unchanged.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 26 findings — high 0, medium 1, low 18, false 5, maybe-false 2
- findings:
  - `[low]` `[patch]` (verification-gap) `suite:calibrate` judge-timeout wiring not asserted at the CLI boundary — calibrate CLI test with a non-default `judgeCallTimeoutMs` asserts the options passed to `createCalibrationJudge`.
  - `[low]` `[patch]` (verification-gap, other) The run-path timeout test asserts the default 60000, so a hard-coded constant would pass — test now uses a non-default value.
  - `[medium]` `[patch]` (blind) After a coach call times out, later calls in the same turn or window still wait the full timeout and reserve budget (a P-06 window can stall for ~96 minutes) — once a guard trips, later calls reject immediately without calling or reserving; test added.
  - `[false]` `[reject]` (blind) The proxy guards every function property, so helper methods would reserve calls — methods run against the unwrapped target, so the provider's internal calls bypass the proxy, and callers use only `AiProviderPort` methods (same contract as `record()`).
  - `[low]` `[reject]` (blind) A retry refused by the budget replaces the executed attempt's error with a synthetic `budget-exceeded` run — the refusal is the accurate final outcome, and the attempt-1 reason is still in the "retrying" log line; keeping both needs a new branch for a rare path.
  - `[low]` `[reject]` (blind) Cases that need no judge calls are skipped once the judge budget is spent, and the coach budget counts as exceeded when it is used up exactly — the AC says the remaining cases are marked ERROR `budget-exceeded`; every L1 case makes coach calls, so it would be refused anyway.
  - `[false]` `[reject]` (blind) A budget-exceeded run can be accepted as a baseline — such a run is INCOMPLETE, so accepting it needs `--allow-incomplete` and records it as provisional (existing AD-11 rule); the README wording "cannot be accepted as complete" is accurate.
  - `[low]` `[patch]` (blind) `suite:run` exit 4 and the diff's budget signal are decided from different sources — the diff budget branch also fires on `report.budget.exceeded`; test added.
  - `[maybe-false]` `[reject]` (blind) `usage.judge*` (from results) and `budget.judgeCalls` (from the guard) can disagree — they could differ only when the judge throws, where the guard counts one call; settling it means comparing a throwing judge's result usage. If true it would only be low.
  - `[low]` `[reject]` (blind) Inconclusive diff entries do not say whether the baseline was advisory or the samples too few — needs new diff entry surface; the accept log names the advisory state.
  - `[low]` `[patch]` (blind) The accept advisory line is keyed on run trust rather than on the written entries — now printed only when some entry is advisory, with the count.
  - `[false]` `[reject]` (blind) The harness base `3af7d0e...` differs from `baseline_revision` — the user mandates that base for the whole PR's harness check; `baseline_revision` is this story's review base.
  - `[low]` `[reject]` (blind) Per-model coach usage is one row per executor label (two tiers merged, no tokens) — a recorded limitation: `AiProviderPort` exposes neither tier nor tokens.
  - `[low]` `[reject]` (blind) The CI step summary shows no budget state — L1 is not in CI (user decision), and the diff outcome already shows `budget-exceeded`.
  - `[low]` `[reject]` (blind) Several paths have no tests (ci over a budget run, journey refused at step 2, re-ask refusal, timeout message regex, two coach labels) — `coach-timeout` is set directly as kind infrastructure, so the message regex does not decide it; the diff exit 4 and the guard paths are covered at component level.
  - `[low]` `[reject]` (edge) Rule/S-only cases skipped once the judge budget is spent — same as the blind skip row (AC behavior).
  - `[low]` `[reject]` (edge) Coach budget used up exactly marks the next case exceeded — same as the blind skip row.
  - `[low]` `[reject]` (edge) The log says "retrying" when the retry is refused by the budget — cosmetic log line; the result reason states `budget-exceeded`.
  - `[maybe-false]` `[reject]` (edge, claim) `suite:calibrate` judge calls ignore `maxJudgeCallsPerRun` — budgets bind `suite:run` (AD-15); calibration is bounded by the labels file. Settling it needs a decision on whether calibration is a run; if true it would only be low.
  - `[false]` `[reject]` (intent) The baseline path is proven with a fake executor, not through the live entry — the user decision forbids live calls; the real L1 executor is exercised with the budget hook and timeout.
  - `[low]` `[reject]` (intent) The round-3 expected-red clause is not represented — no baseline is committed and `p-v1` is empty (user decision); expected reds are recorded when a human accepts the first real baseline.
  - `[low]` `[reject]` (intent) A per-invocation budget is untested against a realistic suite size — budget numbers are AD-15 assumptions in config; the Design Notes record the per-invocation reading.
  - `[low]` `[reject]` (intent) Coach usage per executor label and calls only — same as the blind per-model row.
  - `[low]` `[reject]` (intent) Enforcement relies on each executor calling the budget hook — L0 makes no model calls; the L2 executor (Epic 14) must call the hook, noted in the Auto Run Result.
  - `[low]` `[reject]` (intent) Exit 4 is not exercised through `ci` — `ci` takes the diff exit code, and the diff exit 4 is tested.
  - `[false]` `[reject]` (intent) The finalize state is not met — the audit read the tree before Finalize.

## Design Notes

Budgets are per invocation, not per sample: the key is `...PerRun` and the purpose is that a misconfigured run (for example a large `--runs`) cannot burn the budget, so raising `--runs` needs a deliberate config change. Counting coach calls through the budget hook (not from events) makes the count authoritative and includes discarded retry attempts. Checking flags after each turn matters because the orchestrator swallows some provider errors and returns a fallback reply; without it a refused or timed-out call would be scored as product behavior. Coach timeouts cannot abort the underlying HTTP request (`AiProviderPort` has no signal), so a timed-out request may still finish in the background; the live entry already force-exits after completion.

Advisory per baseline entry instead of refusing untrusted accepts: rule and S entries of an uncalibrated L1 baseline stay useful for the gate (AD-15 "fails only on rule and S regressions while untrusted"), and meaning entries become comparable only after a trusted re-accept.

## Verification

**Commands:**
- `pnpm --filter @entalent/conversation-sim test` -- expected: pass offline.
- `pnpm --filter @entalent/conversation-sim typecheck` and `pnpm --filter @entalent/conversation-sim lint` -- expected: no errors.
- `pnpm --filter @entalent/conversation-sim suite:run --suite smoke-v1 --level L0` -- expected: exit 0.
- `pnpm --filter @entalent/conversation-sim suite:run:live --suite smoke-v1 --level L1` (no flag) -- expected: exit 1 refusal, no model built.
- `pnpm typecheck` -- expected: no errors.
- `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` -- expected: passing receipt.

## Auto Run Result

**Summary:** Live-run budgets, usage and the offline L1 baseline path. `suite.config.json` budgets gain `coachCallTimeoutMs` (120000) and `judgeCallTimeoutMs` (60000). The runner's `RunBudget` (absolute per invocation) reserves every coach call through a `CallBudget` hook in `ExecutorOptions` and counts judge calls through a judge guard; once a budget is spent the remaining cases are ERROR `budget-exceeded` without executing or retrying, the run is provisional (`budget exceeded: <kind>`), and `suite:run` exits 4 (report and case runs still written; `suite:diff` also exits 4 on `report.budget.exceeded`). The L1 executor wraps the coach provider inside the recording proxy with the budget check and a per-call timeout; a tripped guard ends the case (`budget-exceeded` product, `coach-timeout` infrastructure, retried once) even when the orchestrator swallowed the failure, and later calls in the attempt reject at once. The judge passes `timeout` to `generateText` (a timeout is a transport failure). Reports carry `budget` and `modelUsage` (coach per label with null tokens, judge with tokens), rendered under `## Usage` and as CI lines only when calls were made. Baselines store `advisory` per entry; a meaning pair with an advisory baseline side diffs `inconclusive` (13.3 deferral settled per AD-13; untrusted accepts allowed and logged with the advisory count). No live model call; no baseline committed.

**Files changed** (under `packages/conversation-sim/` unless noted):
- `suite.config.json`, `src/suite/schema.ts` -- timeouts, report `budget`/`modelUsage`, `BaselineResult.advisory?`.
- `src/suite/executors/types.ts`, `src/suite/executors/l1-orchestrator-executor.ts` -- `CallBudget`, `guardCoachProvider`, guard checks after fixtures, each turn and the window.
- `src/suite/runner.ts` -- `RunBudget`, judge guard, skipped cases, usage and provisional reason.
- `src/suite/judge/criterion-judge.ts`, `judge/decide-meaning.ts` -- `timeoutMs`, `budget-exceeded` reason.
- `src/suite/report.ts` -- usage table, budget line, CI usage lines.
- `src/suite/baseline.ts`, `src/suite/diff.ts` -- advisory per entry, inconclusive on advisory baseline, exit 4 on recorded budget.
- `src/suite/cli.ts`, `src/suite/run-live.ts`, `src/suite/judge/calibrate-live.ts` -- exit 4, `{ callTimeoutMs }` to judge factories, accept advisory log, help.
- `README.md` -- budgets and usage, human steps for the first L1 baseline.
- Tests: runner, L1 executor, criterion-judge, report, baseline, diff, cli, run-live, calibrate-live, config; fixtures `__fixtures__/runner.ts` (`budgetedExecutor`), `judge/__fixtures__/mock-model.ts` (stalling model).
- `docs/agent-task-log.md` (repo root).

**Review:** 26 findings (high 0, medium 1, low 18, false 5, maybe-false 2). Patched 5 entries (medium 1: guard fails fast after a timeout or refusal; low 4: calibrate CLI timeout test, non-default timeout in the run test, diff exit 4 on recorded budget, accept advisory log keyed on written entries with count). Deferred: none. Rejected: proxy over every method (false: internal calls bypass the proxy); refused retry replacing attempt-1 error (low, rare); skipping judge-free cases once a budget is spent and exact-use exhaustion (AC behavior, twice plus edge duplicates); accepting a budget-exceeded run (false: needs `--allow-incomplete`, provisional); usage double source (maybe-false, low); inconclusive reason surface (low); harness base vs baseline_revision (false: user-mandated base); one coach row per label (documented port limit, twice); CI summary budget state (L1 not in CI); untested ci/journey/re-ask/regex paths (covered at component level; coach-timeout set directly); retry log wording (cosmetic); calibrate unbudgeted (maybe-false, low; AD-15 binds suite:run); intent audit items (live entry forbidden by user decision; expected reds await the first human baseline; per-invocation budget reading recorded; L2 executor must call the hook in Epic 14; ci exit via diff tested; pre-finalize snapshot).

**Follow-up review recommended:** false -- one medium and four low entries patched on this first pass.

**Verification:** `pnpm --filter @entalent/conversation-sim test` 53 files / 935 tests pass offline (fakes and mock models only); package typecheck and lint clean; root `pnpm typecheck` 24/24; plain-env `suite:run --suite smoke-v1 --level L0` exit 0; `suite:run:live --suite smoke-v1 --level L1` without `--live-model` exit 1; `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` passed, receipt `runs/harness/receipt-1792965303471-70aaf793.json`.

**Residual risks:** the real L1 baseline awaits a human-run `suite:run:live --runs 5` once `smoke-v1` has L1 scenarios and QA calibration exists; coach tokens are not observable through `AiProviderPort`; a timed-out coach request keeps running in the background (no abort through the port); one judge invocation may overshoot the judge budget by its transport retry; budgets are per invocation, so a five-sample run must fit 600/150 in total; the L2 executor (Epic 14) must call the budget hook.


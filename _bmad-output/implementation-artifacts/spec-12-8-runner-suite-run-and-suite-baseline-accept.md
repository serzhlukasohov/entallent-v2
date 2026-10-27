---
title: 'Story 12.8: Runner, suite:run and suite:baseline:accept'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: '22e49b97c948655f875a7528cc9eaf69b96d3097'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-conversation-eval-regression-2026-10-17/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The test-failure hook falls back to Vitest's private `globalThis.__vitest_index__` for spawned fixture configs that lack `setupFiles`.
    evidence: |-
      Blind Hunter (Story 12.8). Works on Vitest 3.2.7; failure-classifier.test.ts and coach-harness.test.ts fixture runs fail loudly if a Vitest upgrade removes it. Fix: add setupFiles to those fixture configs and drop the fallback. Open entry in docs/agent-failures.md.
    location: >-
      packages/conversation-sim/src/harness/test-failure-hook.ts
    severity: medium
  - summary: >-
      `budgets.maxCoachCallsPerRun` / `maxJudgeCallsPerRun` are validated in suite.config.json but not enforced by the runner.
    evidence: |-
      Blind Hunter (Story 12.8). No cost at L0 (no model calls); enforce with `budget-exceeded` (AD-15) when the L1/L2 executors land in Epics 13/14.
    location: >-
      packages/conversation-sim/src/suite/runner.ts
    severity: medium (unverified)
---

<intent-contract>

## Intent

**Problem:** The suite core (load, L0 executor, evaluate, score, report) has no entry point: nobody can run a suite at a level, get a scored report, or make a run the committed reference. `CoachHarness` also cannot load outside Vitest, which blocks any CLI.

**Approach:** A runner (`suite/runner.ts`) drives load → executor per case per sample (one infrastructure retry) → `JudgeTrust` → `evaluate` → `score` → report; a CLI (`suite/cli.ts`) exposes `suite:run` and `suite:baseline:accept`, reads `suite.config.json` through Zod, scrubs model credentials for L0, and writes reports under `runs/suites/<runId>/` and baselines under `baselines/<suite>/<level>.json`.

**User decisions (2026-10-25, recorded as intent):** The QA P-suite `p-v1` (Story 12.4) is out of scope and stays empty. A new suite `smoke-v1` is registered empty now, next to `p-v1`, with its own `cases/smoke-v1/index.ts` and `sources.ts`; its scenarios are written after the framework is done. The AC item "an initial L0 baseline for p-v1 is committed with the story" is replaced by: runner, CLI and baseline acceptance work for any registered suite and are proven on synthetic suites in tests; the first committed baseline will be for `smoke-v1` once its scenarios exist. An empty suite must run without crashing and produce an empty, INCOMPLETE report with a clear message.

## Boundaries & Constraints

**Always:**
- `pnpm --filter @entalent/conversation-sim suite:run --suite <id> --level L0 [--runs N] [--case <id>]`: load the suite, run the executor per case per sample (the L0 executor applies and verifies fixtures inside `run()`, per 12.7), compute `JudgeTrust` once (`trusted: false`, reason `no-judge-at-level`, `pin: null`, `agreement: null` at L0), evaluate, score, write `report.json`/`report.md` under `runs/suites/<runId>/` with run id `<ISO timestamp, : and . as ->-<short sha>`, print the layer table and verdict, exit 0.
- Retry unit is the case: a `CaseRun` whose errors are all infrastructure (after reclassification through `gate/failure-kind.ts`) is discarded and re-run once with a fresh executor run and `attempt` incremented; product errors never retry.
- `gate/failure-kind.ts` holds the pure predicates extracted from `failure-classifier.ts`; `classifyFailure` and `buildFailureReason` behavior is unchanged (existing `failure-classifier.test.ts` passes untouched).
- The CLI deletes `OPENAI_API_KEY` and every `AZURE_OPENAI_*` key from its environment for L0 runs before running, and never prints env values; it does not load `.env`.
- `packages/conversation-sim/suite.config.json` is read and validated by a Zod schema in `suite/schema.ts` at CLI start: suites, levels, `interMessageGapMs` (60000), `baseline.minSamples` (L0 1, L1 5, L2 3), `diff.minSamples` (L1 3, L2 3), `retries`, budgets and the judge pin.
- `suite:baseline:accept --run <runId>` writes `baselines/<suiteId>/<level>.json` with `schemaVersion`, suite, level, judge fingerprint (none at L0), coach provenance, `acceptedFrom { runId, gitSha, ciRunUrl? }`, `acceptedAt`, `provisional`, and `results['<testId>/<criterionId>'] = { status, passCount, n }` for every in-scope criterion; it refuses `n < baseline.minSamples[level]`, an INCOMPLETE run without `--allow-incomplete` (allowed ones record `provisional: true`), a dirty run without `--allow-dirty`, and a judge fingerprint differing from the current one.
- `harness/report.ts` and everything reachable from the executor, runner and CLI load in plain Node/tsx with no runtime `vitest` import; the import-graph test enforces it.
- `smoke-v1` and `p-v1` are both registered and both run (empty) without crashing.

**Never:**
- Live model calls, reading or printing secrets, or any level other than L0 executing (L1/L2 are refused with a clear message until Epics 13/14).
- Changes in `packages/application` or `apps/*`; database migrations; `ScenarioRunReport`, `gate.config.json`, `run-gate.ts` behavior changes.
- Writing p-v1 or smoke-v1 cases, or committing any baseline file.
- `suite:diff` (12.9), CI jobs, root `pnpm suite:*` aliases and README docs (12.10).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy run | synthetic suite (atomic + journey + observation), L0, `--runs 2` | report with n 2, every in-scope criterion present, layer table and verdict printed, exit 0 | N/A |
| Empty suite | `--suite smoke-v1 --level L0` | report written, `complete: false`, `provisional: true`, reason names the empty suite; log line `[suite] smoke-v1 has no tests` ; exit 0 | no crash |
| Infra retry | executor returns an infrastructure error on attempt 1, clean run on attempt 2 | attempt-2 run is kept, `attempt: 2`; usage counts one retry | N/A |
| Transport agent error | product `agent-turn-error` whose message is a transport failure (`ECONNRESET`) | treated as infrastructure and retried once | after the retry the final run is evaluated (ERROR) |
| Product error | `scripted-output-missing:1` (product) | no retry; criteria ERROR | N/A |
| Unsupported fixture | `unsupported-fixture:pulseCycle` | no retry (deterministic); criteria NOT_RUN | N/A |
| Executor throws | `run()` rejects with a non-suite error | synthesized `CaseRun` with error `executor-error` (kind by `isTransportFailureMessage`) | retried once if infrastructure |
| Case filter | `--case X-01` | only tests whose `sourceCase` or `id` equals `X-01`; report records `selection` | unknown id → exit 1 with known ids |
| Non-L0 level | `--level L1` | nothing runs | exit 1, "L1 executor lands in Epic 13" |
| Unknown suite / bad config | `--suite nope` or invalid JSON | nothing runs | exit 1, Zod path or known suites listed |
| Credential scrub | env holds `OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT` | both removed before the run | values never printed |
| Accept refusals | n below min / INCOMPLETE / dirty / fingerprint differs / `selection` present / no in-scope criteria / no git sha | no file written; every reason printed | exit 1 |
| Accept allowed incomplete | INCOMPLETE run with `--allow-incomplete` | baseline written with `provisional: true` | N/A |
| Accept missing run | `--run` not under `runs/suites/` or unsafe id | no file written | exit 1 |

</intent-contract>

## Code Map

- `packages/conversation-sim/src/harness/report.ts:3` -- static `import { onTestFailed } from 'vitest'`, used in `reportRun` (88) and `registerFallbackReport` (100-117, already try/catch). `coach-harness.ts:50,242` imports `registerFallbackReport`, so the executor reaches vitest. `docs/agent-failures.md` 2026-10-25 "Conversation-sim harness cannot load outside Vitest" (open) names the fix and regression check.
- `packages/conversation-sim/vitest.config.ts` -- no `setupFiles` yet; all suites (sims, gate, harness, suite) use this config; `run-gate.ts` spawns `vitest run` with it.
- `packages/conversation-sim/src/gate/failure-classifier.ts` -- `looksLikeTransportFailure` (21-25), `isTransportOnlyAgentFailure` (33-46), `hasDeterministicFailure` (48-50, exported; `run-gate.ts:6` imports it from here). Extract to `failure-kind.ts` as `isTransportFailureMessage`, `isTransportOnlyAgentFailure`, `hasDeterministicFailure`; keep re-export.
- `packages/conversation-sim/src/gate/run-gate.ts:94,349-363` -- run id pattern `new Date().toISOString().replace(/[:.]/g, '-')` + `-<sha>`; `readGitState` via `spawnSync('git', ['rev-parse','--short','HEAD'])` and `status --porcelain` (copy the pattern, do not import run-gate).
- `packages/conversation-sim/src/suite/loader.ts:66-78` -- static `SUITES` registry (`p-v1` only) and `loadSuite`; `validateSuite(suiteId, modules, rules)` for synthetic suites; `SuiteLoadError` messages are already `[suite]`-prefixed.
- `packages/conversation-sim/src/suite/cases/p-v1/{index,sources}.ts` -- empty arrays; mirror for `smoke-v1`.
- `packages/conversation-sim/src/suite/executors/types.ts` -- `SuiteExecutor`, `ExecutorOptions { attempt, interMessageGapMs, clockStart? }`, `SuiteExecutionError`.
- `packages/conversation-sim/src/suite/executors/l0-deterministic-executor.ts:93-305` -- `new L0DeterministicExecutor()`; `run()` returns a `CaseRun` with `errors[]` (kinds set by the executor: `unsupported-fixture:*` and `fixture-apply:*` infrastructure, `agent-turn-error` product) and rethrows non-suite errors (293).
- `packages/conversation-sim/src/suite/evaluate.ts:32` -- `evaluate(test, run, null, trust, rules)` returns one `CriterionResult` per test criterion.
- `packages/conversation-sim/src/suite/score.ts:56-97` -- `journeysOnly` is true when no in-scope non-journey result exists, so an empty run reads `n/a (journeys only)` with `complete: true` (deferred-work 12.2 entry: "settle in 12.8"). `decideVerdict` already returns NOT ADEQUATE with reason `no decided P/D/C criterion` when nothing is decided.
- `packages/conversation-sim/src/suite/report.ts` -- `buildSuiteReport(score, meta)`, `renderSuiteReportMarkdown`, `writeSuiteReport(report, baseDir)` (writes `<baseDir>/runs/suites/<runId>/report.{json,md}`, validates the run id).
- `packages/conversation-sim/src/suite/schema.ts:624-632,739-763` -- `JudgeTrustSchema`, strict `SuiteRunReportSchema` (needs the optional `selection` field), single type source for new `SuiteConfigSchema` and `BaselineSchema`.
- `packages/conversation-sim/src/suite/__fixtures__/suite.ts` -- `validSources()`, synthetic tests, `TEST_RULES` with `events-only`; reuse for runner tests.
- `packages/conversation-sim/src/suite/executors/import-graph.test.ts` -- `forbiddenImports(entry, read, root)` walks relative value imports; extend to more entries and a `vitest` ban.
- `packages/conversation-sim/src/scenarios/config.ts:16` -- judge model default `gpt-4o` (copy into the config pin; do not import).
- Root `.gitignore:16` -- `runs/` already ignored.

## Tasks & Acceptance

**Execution:**
- [x] `src/harness/test-failure-hook.ts` (new), `src/harness/vitest-setup.ts` (new), `vitest.config.ts`, `src/harness/report.ts` -- a vitest-free module holds an installable `onTestFailed` hook; the setup file (listed in `setupFiles`) installs Vitest's; `report.ts` uses the hook and registers nothing when none is installed. Rationale: synchronous registration inside tests stays identical; plain Node loads the harness.
- [x] `src/gate/failure-kind.ts` (new), `src/gate/failure-classifier.ts` -- move the predicates; classifier imports them; `hasDeterministicFailure` stays importable from the classifier.
- [x] `src/suite/cases/smoke-v1/index.ts`, `sources.ts` (new), `src/suite/loader.ts` -- register `smoke-v1` (empty) in `SUITES`.
- [x] `src/suite/score.ts` -- with no in-scope test result (empty suite or every test filtered out of scope), `complete: false`, `provisional: true`, reason `incomplete: no in-scope test criteria`, and the verdict goes through `decideVerdict` (not `n/a (journeys only)`); `journeysOnly` requires at least one in-scope journey result. Update the `report.test.ts` "journeys-only" test to use a journey result and add an empty-run test.
- [x] `src/suite/schema.ts` -- `SuiteConfigSchema` (strict: `schemaVersion: 1`, `suites: string[]`, `levels: Level[]`, `interMessageGapMs`, `baseline.minSamples` per level, `diff.minSamples` for L1/L2, `retries.infrastructure` int 0..3, `budgets { maxCoachCallsPerRun, maxJudgeCallsPerRun }`, `judge { provider, model, decoding { temperature, reasoningEffort, maxOutputTokens }, agreementThreshold { overall, kappa }, minLabels }`); `BaselineSchema` (strict, per the frozen block; `judge { fingerprint, agreement }` nullable, `coach { model }` nullable); optional `selection: { case }` on `SuiteRunReportSchema`.
- [x] `suite.config.json` (new) -- values above (`retries.infrastructure` 1, budgets 600/150, judge `openai`/`gpt-4o`, temperature 0, reasoningEffort null, maxOutputTokens 1024, agreement 0.85/0.6, minLabels 40), suites `p-v1`, `smoke-v1`.
- [x] `src/suite/config.ts` (new) -- `loadSuiteConfig(path)`: JSON parse + Zod, errors `[suite] config: <path>: <message>`.
- [x] `src/suite/runner.ts` (new) -- `computeJudgeTrust(level)`; `caseRunFailureKind(run)` via `failure-kind.ts`; `runSuite({ suite, level, n, executor, config, runId, git, caseFilter?, rules?, log? })` returning `{ report, caseRuns }` with no file I/O: executor level must match, `--case` selection, per sample per test run + retry, CaseRun validated with `CaseRunSchema`, asserts one result per criterion per sample before scoring, one `[suite]` status line per case per sample (no transcript text), `usage` `{ coachModelCalls: 0, judgeCalls: 0, caseAttempts, infrastructureRetries }`, `models { coach: null, judge: null }` at L0.
- [x] `src/suite/baseline.ts` (new) -- `baselineRefusals(report, { config, currentFingerprint, allowIncomplete, allowDirty })` (all reasons), `buildBaseline(report, { acceptedAt, ciRunUrl? })` (in-scope results only, keys sorted), `writeBaseline(baseline, packageDir)`, `readRunReport(packageDir, runId)` (safe id, `SuiteRunReportSchema`).
- [x] `src/suite/cli.ts` (new) + `package.json` scripts `suite:run` / `suite:baseline:accept` (`node --import tsx src/suite/cli.ts run|baseline:accept`) -- `main(argv, deps)` with injectable env, package dir, clock, git state and log; `parseArgs`; `scrubModelCredentials(env)`; refuse non-L0 levels; write the report, `case-runs.json` beside it, print layer table + verdict + paths; accept: `--run`, `--allow-incomplete`, `--allow-dirty`, `--ci-run-url` (else from `GITHUB_SERVER_URL`/`GITHUB_REPOSITORY`/`GITHUB_RUN_ID` when all set); exit 0/1; `--help`.
- [x] Tests -- `runner.test.ts`, `baseline.test.ts`, `cli.test.ts`, `config.test.ts`, `gate/failure-kind.test.ts`: every matrix row; synthetic suites via `validateSuite` + `TEST_RULES`, real L0 executor for the happy path, fake executors for retries; CLI tests use a temp package dir. `import-graph.test.ts`: walk from executor, runner and cli; flag any value import of `vitest`/`vitest/*`; one test spawns `node --import tsx src/suite/cli.ts --help` and expects exit 0.
- [x] `docs/agent-failures.md` (close the 2026-10-25 vitest entry: Status fixed, regression check = the spawn test), `_bmad-output/implementation-artifacts/deferred-work.md` (mark the 12.2 empty-run and 12.7 vitest entries resolved), `docs/agent-task-log.md` (one row).

**Acceptance Criteria:**
- Given a synthetic suite with atomic, journey and observation tests, when `runSuite` runs it at L0 with the real executor, then the report parses with `SuiteRunReportSchema`, `judgeTrust` is `{ trusted: false, reason: 'no-judge-at-level', pin: null, agreement: null }`, and every in-scope `<testId>/<criterionId>` key is present.
- Given `pnpm --filter @entalent/conversation-sim suite:run --suite smoke-v1 --level L0` in a plain shell, when it runs, then it exits 0, writes `runs/suites/<runId>/report.{json,md}`, and prints an INCOMPLETE/provisional verdict with the empty-suite message.
- Given an accepted synthetic run, when `suite:baseline:accept` writes the baseline, then it parses with `BaselineSchema` and running accept twice on the same run yields byte-identical results apart from `acceptedAt`.
- Given `pnpm --filter @entalent/conversation-sim test`, when it runs offline, then all suites (including unchanged `failure-classifier.test.ts`) pass.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 40 findings — high 0, medium 4, low 21, false 11, maybe-false 4
- findings:
  - `[low]` `[patch]` (edge) a throwing `currentJudgeFingerprint` (L1/L2 report) replaces every other refusal reason — patched: the throw becomes one reason and `baselineRefusals` still runs.
  - `[low]` `[patch]` (edge) a non-URL `--ci-run-url` surfaces as a raw ZodError — patched: `parseArgs` rejects it (`URL.canParse`) with a usage error.
  - `[low]` `[patch]` (edge) `--case ''` is silently dropped and the full suite runs — patched: empty `--case` / `--ci-run-url` are usage errors.
  - `[low]` `[reject]` (edge) no upper bound on `--runs` — L0 costs nothing and an operator must type the number; budgets land with L1 (deferred below).
  - `[low]` `[patch]` (edge) self-invocation misses a symlinked `argv[1]` — patched: compares `realpathSync` of both paths.
  - `[low]` `[reject]` (edge) two runs in the same millisecond on the same sha overwrite each other — not met in practice (one CLI process per run, ms resolution).
  - `[low]` `[patch]` (edge) runs synthesized from a throw skip `CaseRunSchema` — patched: synthesized runs are parsed too.
  - `[low]` `[patch]` (edge) a run of only manifest NOT_TESTABLE in-scope rows can be accepted with `--allow-incomplete` — patched: refused when no executed test criterion is in scope.
  - `[low]` `[patch]` (edge, claim) "CaseRun validated with CaseRunSchema" not true for synthesized runs — same root as the synthesized-run row.
  - `[low]` `[patch]` (edge, claim) "every reason printed" broken by the fingerprint throw — same root as the first row.
  - `[false]` `[reject]` (blind) the Tests task is unticked while status is in-review — the box is ticked at Finalize; editing the spec is not a code fix.
  - `[false]` `[reject]` (blind) the harness:check base differs from `baseline_revision` — the user mandated `--base 3af7d0ed02bbe34e7178f4be8755f56f373162c5`; `baseline_revision` is the story's own diff base.
  - `[low]` `[reject]` (blind) no test ties `suite.config.json` suites to `SUITES` — a mismatch already fails loudly (`unknown-suite` from the loader, or the config check); both lists change together.
  - `[low]` `[reject]` (blind) `writeBaseline` overwrites without warning — by design: the baseline is a committed file, the change shows in the PR diff and 12.10 adds the label/CODEOWNERS guard.
  - `[low]` `[reject]` (blind) discarded retry attempts leave no trace in `case-runs.json` — AD-18 discards them; the `[suite]` log line names the reasons and usage counts the retries.
  - `[low]` `[patch]` (blind) level-not-declared tests appear in `case-runs.json` as executed runs — patched: they are left out of `caseRuns` (still evaluated as `level-not-declared`).
  - `[low]` `[reject]` (blind) `case-runs.json` has no Zod schema — a debug artifact; 12.9 diffs reports and baselines, which are schema-validated.
  - `[medium]` `[defer]` (blind) the hook falls back to Vitest's private `globalThis.__vitest_index__` for fixture configs without `setupFiles` — works on Vitest 3.2.7 and the two fixture tests fail loudly if it breaks; the clean fix edits the classifier test the spec froze. Deferred + open agent-failures entry added.
  - `[low]` `[reject]` (blind) `BaselineSchema.judge.agreement` is `unknown` and fingerprint `provider` is a free string — mirrors `JudgeTrustSchema`; the fingerprint shape is settled with the judge in Epic 13.
  - `[low]` `[patch]` (blind) `--ci-run-url` validated too late — same root as the edge URL row.
  - `[low]` `[patch]` (blind) empty flag values dropped — same root as the edge `--case ''` row.
  - `[maybe-false]` `[defer]` (blind) budgets are validated but never enforced — no cost at L0; matters when L1/L2 executors land (Epic 13/14). Deferred, medium (unverified).
  - `[low]` `[patch]` (blind) the hook test's `afterEach` re-implements `vitest-setup.ts` — patched: `installTestFailedHook` returns the previous hook and the test restores it.
  - `[low]` `[patch]` (blind) the task-log failure layer has no agent-failures entry — patched: open entry for the fixture-config `setupFiles` gap.
  - `[medium]` `[patch]` (verification) an all-out-of-scope (non-empty) run's INCOMPLETE rule is untested — patched: `score.test.ts` case with only `inScope: false` results.
  - `[medium]` `[patch]` (verification) the real CLI wiring (`defaultDeps`, `PACKAGE_DIR`, `readGitState`) never runs in a test — patched: spawn test runs `cli.ts run --suite smoke-v1 --level L0` and checks the written report.
  - `[medium]` `[patch]` (verification) the `vitest-setup.ts` wrapper path is never exercised (fixtures reach only the fallback) — patched: spawned fixture with `setupFiles` asserts the appended `test-failure` violation.
  - `[low]` `[patch]` (verification, other) non-URL `--ci-run-url` raw ZodError — same root as the edge URL row.
  - `[false]` `[reject]` (intent) lifecycle not met (in-review, empty triage, uncommitted) — the diff was staged for this review; Finalize sets done and commits.
  - `[false]` `[reject]` (intent) plain-shell `suite:run` proven only in-process — now covered by the spawn-run patch above.
  - `[false]` `[reject]` (intent) credential scrub tested on an injected env and after static imports — `defaultDeps` passes `process.env`; the import-graph test keeps credential readers out of the loaded graph.
  - `[false]` `[reject]` (intent) retry reclassification (R3b) vs literal labels — AD-18/Conventions take the kind from `failure-kind.ts` predicates; recorded in Design Notes.
  - `[false]` `[reject]` (intent) dirty-tree refusal reads the run's flag, not the accept-time tree — AD-11 names `git.dirty` of the run.
  - `[maybe-false]` `[reject]` (intent) non-null fingerprint comparison only reachable by hand-edited reports — L1/L2 cannot run yet; the comparison is unit-tested; would only be low.
  - `[false]` `[reject]` (intent) `score.ts` change affects any zero-in-scope run — intended: settles the deferred 12.2 entry for every caller.
  - `[false]` `[reject]` (intent) extra accept refusals (unregistered suite, no sha, `--case`, empty) — guard the baseline's provenance; empty-suite refusal matches the user decision that the first baseline waits for smoke-v1 scenarios.
  - `[false]` `[reject]` (intent) baseline uses `suiteId` not `suite`, always carries `provisional` — AD-11 shape (`suiteId`); `provisional: false` is explicit for accepted complete runs.
  - `[maybe-false]` `[reject]` (intent) the import walker does not descend into workspace packages — the CLI spawn tests load the full runtime graph; would only be low.
  - `[false]` `[reject]` (intent) no evidence of the reflection command — it ran before planning (`runs/harness/reflection.md`, eligible=true).
  - `[maybe-false]` `[reject]` (intent) R5/R7: no root `pnpm suite:*` alias; config not read for `--help` — root aliases are 12.10 AC; config is now read before the level refusal (patched with the edge rows); `--help` needs no config. Would only be low.

## Design Notes

**Failure kind for a `CaseRun` error:** infrastructure when `error.kind === 'infrastructure'` and the reason is not `unsupported-fixture:*`, or when `reason === 'agent-turn-error'` and `isTransportFailureMessage(message)`; otherwise product. Retry only when the run has errors and all are infrastructure — the same "transport only" rule `isTransportOnlyAgentFailure` applies to gate reports.

**Fingerprint comparison:** the current fingerprint is `null` at L0 (no judge). `baselineRefusals` compares `report.judgeTrust.pin` with it by stable JSON; asking for the current fingerprint of L1/L2 refuses with "judge fingerprint for <level> lands in Epic 13".

**Git:** the report records the full sha (`git rev-parse HEAD`) and dirty flag; only the run id uses the short sha. The baseline copies `report.git.sha` into `acceptedFrom.gitSha`.

**Exit codes:** `suite:run` exits 0 whenever a report was written, whatever the verdict (gating is `suite:diff`, 12.9); usage, config, load and refusal errors exit 1. The diff's 0-4 codes stay reserved for `suite:diff`.

## Verification

**Commands:**
- `pnpm --filter @entalent/conversation-sim test` -- expected: pass offline.
- `pnpm --filter @entalent/conversation-sim typecheck` and `pnpm --filter @entalent/conversation-sim lint` -- expected: no errors.
- `pnpm --filter @entalent/conversation-sim exec node --import tsx -e "import('./src/suite/executors/l0-deterministic-executor.ts')"` -- expected: exit 0.
- `env -u OPENAI_API_KEY pnpm --filter @entalent/conversation-sim suite:run --suite smoke-v1 --level L0` and the same for `p-v1` -- expected: exit 0, INCOMPLETE report under `runs/suites/`.
- `pnpm typecheck` -- expected: no errors.
- `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` -- expected: passing receipt.

## Auto Run Result

**Summary:** `suite/runner.ts` drives load -> L0 executor per case per sample (one infrastructure retry, kind reclassified through `gate/failure-kind.ts`) -> `JudgeTrust` (`no-judge-at-level`) -> `evaluate` -> `score` -> `SuiteRunReport`; `suite/cli.ts` exposes `suite:run` (writes `runs/suites/<runId>/report.{json,md}` + `case-runs.json`, prints layer table and verdict, scrubs `OPENAI_API_KEY`/`AZURE_OPENAI_*`) and `suite:baseline:accept` (refusal rules, deterministic `baselines/<suite>/<level>.json`). `smoke-v1` is registered empty next to `p-v1`; empty suites run to an INCOMPLETE, provisional report. The harness no longer imports `vitest` at load. No baseline is committed (user decision).

**Files changed** (under `packages/conversation-sim/` unless noted):
- `src/harness/test-failure-hook.ts` (new), `src/harness/vitest-setup.ts` (new), `vitest.config.ts`, `src/harness/report.ts` -- vitest-free failure hook installed by a setup file.
- `src/gate/failure-kind.ts` (new), `src/gate/failure-classifier.ts` -- extracted predicates; `classifyFailure` unchanged.
- `src/suite/cases/smoke-v1/{index,sources}.ts` (new), `src/suite/loader.ts` -- `smoke-v1` registered.
- `src/suite/score.ts` -- zero in-scope test results is INCOMPLETE, not journeys-only.
- `src/suite/schema.ts`, `src/suite/report.ts` -- `SuiteConfigSchema`, `JudgeFingerprintSchema`, `BaselineSchema`, optional report `selection`.
- `suite.config.json`, `src/suite/config.ts` (new) -- validated config.
- `src/suite/runner.ts`, `src/suite/baseline.ts`, `src/suite/cli.ts` (new), `package.json` scripts -- runner, baseline acceptance, CLI.
- Tests: `runner`, `baseline`, `cli`, `config`, `gate/failure-kind`, `harness/test-failure-hook` (new), `__fixtures__/runner.ts`; `report`, `loader`, `score`, `executors/import-graph` updated (vitest ban, CLI spawn `--help` and real `run --suite smoke-v1`).
- `docs/agent-failures.md` (vitest entry fixed; new open entry for the fixture-config fallback), `docs/agent-task-log.md`, `_bmad-output/implementation-artifacts/deferred-work.md`, `sprint-status.yaml`.

**Review:** one pass, 40 findings (high 0, medium 4, low 21, false 11, maybe-false 4). Patched 13 rows (11 fixes; 3 medium: all-out-of-scope score test, real CLI spawn run, setup-file hook path; 10 low: refusal list survives a fingerprint throw, URL/empty flag validation, config read before level refusal, realpath entry check, synthesized runs schema-parsed, skipped tests out of `case-runs.json`, NOT_TESTABLE-only baseline refused, hook restore, open agent-failures entry). Deferred 2: the `__vitest_index__` fallback (medium) and budget enforcement for L1/L2 (medium, unverified). Rejected 25 with reasons in the triage log (notably: mandated harness base, AD-11 `git.dirty`/`suiteId`, retry reclassification per AD-18, overwrite-by-design, no `--runs` cap at L0).

**Follow-up review recommended: true** -- three medium entries were patched without another review pass; the unverified risk is the two new spawned-process tests (CLI `run` cleanup of `runs/suites/<id>` and the child Vitest fixture with `setupFiles`), which could be flaky or leave artifacts in CI. Patched counts by verdict: high 0, medium 3, low 10.

**Verification:** `pnpm --filter @entalent/conversation-sim test` 38 files / 600 tests offline; package typecheck and lint clean; root `pnpm typecheck` exit 0; `node --import tsx` load of the L0 executor exit 0; `suite:run --suite smoke-v1|p-v1 --level L0` exit 0 with INCOMPLETE reports; `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` passed (receipt `runs/harness/receipt-1792947495569-be0bc2eb.json`).

**Residual risks:** the hook fallback depends on an undocumented Vitest global for two spawned fixture configs; budgets are validated but not enforced (no cost at L0); no real suite cases exist yet, so the runner is proven on synthetic suites only.

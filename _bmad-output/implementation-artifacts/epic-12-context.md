# Epic 12 Context: Rule-Based Regression Gate on Every Pull Request (L0)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

QA runs the Framework v2.1.1 P-suite (10 cases, 37 criteria) by hand in Slack, so it can't be repeated per commit and regressions ship unnoticed. This epic builds the framework core in `packages/conversation-sim/src/suite/`: typed test records and a source manifest, a rule registry, one pure evaluation/scoring module, versioned reports, committed baselines, a per-criterion diff, and an offline deterministic executor (L0). Every pull request then gets a framework-scored P-suite verdict for rule- and time-based criteria, diffed against the merge-base baseline, in seconds and with no model credentials. It also lands the only two product changes the framework needs for L0: an injectable `ClockPort` and a pure cadence policy extracted from worker SQL. Without these, P-06 (proactive initiation, 48 h spacing, working hours) can't be tested.

## Stories

- Story 12.1: Case Schema, Loader and Rule Registry Contract
- Story 12.2: Evaluation, Scoring and Report Core
- Story 12.3: Suite Rule Implementations
- Story 12.4: P-Suite Atomic Tests and Smoke Journeys
- Story 12.5: ClockPort in the Application Layer
- Story 12.6: Cadence Policy Extracted from Worker SQL
- Story 12.7: L0 Deterministic Executor and Fixtures
- Story 12.8: Runner, suite:run and suite:baseline:accept
- Story 12.9: suite:diff with Regression Categories
- Story 12.10: L0 Gate in CI and Baseline Governance

## Requirements & Constraints

- **Test kinds:** The primary unit is the **atomic** test: seeded state and history, exactly one turn, and criteria evaluated on that reply or on that step's effects. **Journeys** replay the Confluence sequence verbatim as smoke tests. P-06 is an **observation** test over a 7-day window. Every testable criterion of a conversation source case must be covered by an atomic test. Loading fails on the first invalid test and reports the case id and Zod path.
- **Source manifest:** `cases/<suite>/sources.ts` lists each source case with its requirement ids, expected behavior, criteria (layer P/D/C/S, verbatim pass condition, NOT TESTABLE reason) and, for change-type state criteria, a `stateEffect`. The loader joins `layer` and `passCondition` into each test criterion from the manifest.
- **Statuses:** Every in-scope criterion gets exactly one status: PASS, FAIL, NOT_TESTABLE, INVALID, ERROR or NOT_RUN. The precedence order is fixed. A failed precondition or fixture verify is INVALID. A change-type state criterion that already holds before the step is INVALID (`precondition:already-satisfied`). An executor error is ERROR. An unsupported fixture or an unobservable field is NOT_RUN and never FAIL. Product silence is `reply: null` with an outcome and is evaluated, not treated as ERROR.
- **Scoring:** Pass rate per layer is PASS/(PASS+FAIL) over non-advisory statuses. Only atomic and observation tests count toward pass rates and the verdict; journeys are reported and diffed separately. The verdict is decided as follows:
  - Any S FAIL makes the run NOT ADEQUATE.
  - Otherwise, a combined P+D+C pass rate of at least 0.90 is ADEQUATE, 0.75–0.89 is ACCEPTABLE WITH ISSUES, and anything lower is NOT ADEQUATE.
  - An INCOMPLETE run carries a provisional verdict.

  Quote the thresholds in code comments with the framework page version.
- **L0 scope:** L0 evaluates only rules over inputs the orchestrator produced (time, cadence, message metadata, state, events). It never evaluates reply text that the test itself scripted. P-02 therefore has no L0 tests. Every L0 test carries its `scripted` model outputs.
- **Vacuous-pass guards:** Each change-type state criterion is paired with a synthesized `effect-count` check, built from the manifest's `stateEffect`, whenever the run declares `events`. Invariant criteria get no such pairing. Every rule ships synthetic `pass` and `fail` fixtures, and a test fails if the rule doesn't FAIL on its `fail` fixture.
- **Offline:** L0 needs no Postgres, Redis or model credentials. The `conversation-sim` `test` script stays offline and includes `src/suite/**/*.test.ts`.
- **Isolation:** No lexical heuristic or term list migrates into product code. Nothing outside `conversation-sim` imports `suite/`. The project is TypeScript-only and the retired MAF/agent-service code stays untouched.
- **Backward compatibility:** `ScenarioRunReport`, `gate.config.json` and `run-gate.ts` stay unchanged. Suite artifacts are new, versioned types.
- **Known reds:** The P-06 working-hours criterion (quiet hours are 22–08, the suite expects 09–18) and P-07/P-08/P-09 (pending round-3 CAPs) are expected to fail. Record them as FAIL. Don't change product behavior to turn them green.
- **Case data:** User texts are sent verbatim and the user simulator is not used. Seeded coach texts must be QA-approved and must never satisfy a criterion of their own test. The two NOT TESTABLE criteria (P-05 opening, P-09 progress content) carry the suite's reason text. The coverage table must list CF-002/003/004/005/006/008.

## Technical Decisions

- **Pipeline:** case → executor (the only side-effecting stage) → `CaseRun` observations → `evaluate` (pure, the only producer of `CriterionResult`) → `score` → report and diff. Executors never compute statuses.
- **Ids:** Ids are stable and never reused. The suite is `p-v1`. Test ids are `P-09.A<n>` (atomic), `P-09.J` (journey) and `P-06` (observation). Criterion ids are `<sourceCase>.C<n>` (the Confluence ids). Results, baselines and diffs are keyed `<testId>/<criterionId>`. Retired criteria stay as `not-testable` with the reason `retired: ...`.
- **Schema:** All types come from Zod schemas in `suite/schema.ts`, the single type source. Use `zod ^3.25.76` as a devDependency. Steps carry an optional `advanceClock`. Checkpoints are allowed in journeys only, must be rule-only, and use `onFail: continue | stop`. When a checkpoint fails at step k, later criteria and dependent `conversation`/`state` criteria become INVALID with reason `checkpoint:<k>`.
- **Rule registry:** Each entry is `{ requires: ObservationField[], run, fixtures }` and returns PASS, FAIL or NOT_OBSERVABLE with evidence. A missing declared field makes the criterion NOT_RUN `unobservable:<field>@<level>`. Rules never branch on level. The legacy rules `too-many-questions`, `repeated-question` and `reflective-opener` are wrapped, not copied. Each new rule gets its own file under `suite/rules/`, with its term lists as data.
- **Executor port:** `SuiteExecutor { level, supports(fixture), observes(), run() }`. Named fixtures return `{ apply, verify }`: an apply failure is ERROR `fixture-apply:<name>` and a false verify is INVALID `precondition:<name>`. At L0, `pulseCycle` is unsupported.
- **L0 executor:** Builds a fresh `CoachHarness` per test with `ScriptedAiProvider` and `FixedClock`/`AdvancingClock`, and never uses Vitest fake timers. The between-message gap (`interMessageGapMs`, 60000) is realized by advancing the clock. In atomic tests the gap comes from the last seed `atOffsetMs`. Replies are attributed by `traceId` with 1-based step indices. The executor must never import `scenarios/config.ts` or `OpenAiProvider`; an import-graph test enforces this. The CLI scrubs `OPENAI_API_KEY`/`AZURE_OPENAI_*`. The `clock-leak` rule must pass.
- **Event log:** Recording proxies wrap every harness port and add one `RunEvent` per call, in order (`stepIndex` 0 covers fixtures and seed). Events go only to run artifacts. `CoachHarness` is extended to accept injected ports, defaulting to its current in-memory implementations.
- **ClockPort:** `packages/application/src/ports/clock.port.ts` defines `ClockPort { now(): Date }` and `systemClock`, injected as the last parameter, defaulting to `systemClock`. It is used by `ConversationOrchestrator`, `ProactiveSchedulerUseCase`, `ProactiveCheckInUseCase`, `FollowUpExecutionUseCase`, `isInQuietHours(now, …)` and `getLocalHour(now, …)`. A scoped ESLint `no-restricted-syntax` rule bans `new Date()`/`Date.now()` in those files. The harness and its fakes stamp timestamps from the same clock.
- **Cadence policy:** `checkInCadencePolicy(facts, config, now)` in `packages/application` reproduces every branch of the current SQL predicate. The repository returns per-user facts plus coarse filters. The use case applies the policy before the quiet-hours guard and reports `skippedCadence`. Production behavior must not change, and scheduler tests are extended, never weakened.
- **Authorized product changes:** Only ClockPort, the cadence extraction, additive read-only `/dev` GETs (Epic 14), and moving the failure-kind predicates into `gate/failure-kind.ts` (`classifyFailure` stays unchanged).
- **Retries:** The retry unit is the case: one retry on an infrastructure `SuiteExecutionError`, with fresh fixtures and `attempt` incremented. Product errors never retry.
- **Reports:** `SuiteRunReport` (`schemaVersion: 1`) is written as JSON and Markdown under `runs/suites/<runId>/`, which is gitignored. The run id is `<ISO timestamp>-<short sha>`. Log lines are prefixed `[suite]`, with no transcript text in CI logs.
- **Baselines:** Stored at `baselines/<suite>/<level>.json` with provenance. `accept` refuses a run if `n` is below `minSamples` (1 for L0), the run is INCOMPLETE (unless `--allow-incomplete`), the tree is dirty (unless `--allow-dirty`) or the judge fingerprint has changed.
- **Diff categories:** regressed, fixed, unchanged, lost-coverage, gained-coverage, new, retired, inconclusive. `minPasses` is n/n for rules and ceil(0.8n) for meaning. CI reads the baseline from the merge-base via `git show`, never from the working tree. `lost-coverage` is listed first.
- **Diff exit codes:**
  - 0: clean.
  - 1: a regressed or lost-coverage S or rule criterion, including in journeys.
  - 2: `baseline-invalid` (provenance differs).
  - 3: judge infrastructure failure.
  - 4: budget exceeded.
- **Config:** `packages/conversation-sim/suite.config.json`, validated by Zod. Commands: `suite:run`, `suite:diff`, `suite:baseline:accept`, plus `suite:calibrate`, which is aliased here and implemented in Epic 13. Root `pnpm suite:*` aliases delegate to `conversation-sim`.
- **CI:** A `ci.yml` job runs L0 and the merge-base diff without secrets, uploads artifacts and writes the step summary. A pull request that changes `baselines/**` needs the `baseline-change` label and a QA CODEOWNERS review.

## Cross-Story Dependencies

- 12.1 (schema, loader, registry contract) comes first. 12.2, 12.3 and 12.4 build on it, and 12.4 relies on 12.3's rule names passing registry validation.
- 12.5 (ClockPort) comes before 12.6 (the cadence policy uses `clock.now()`) and before 12.7 (L0 clocks and the clock-leak check). 12.7 also needs 12.6 to drive P-06 through an in-memory scheduler repository fake.
- 12.8 needs 12.2, 12.4 and 12.7, and commits the initial L0 baseline. 12.9 needs 12.8's reports and baselines. 12.10 needs 12.8 and 12.9.
- Epic 13 reuses this core for the L1 executor, the structured judge and calibration (meaning checks are NOT_RUN `no-judge-at-level` at L0), L1 recording proxies and pairing, and the meaning-diff thresholds. Epic 14 adds the L2 executor, the state-query routes and the additive `/dev` reads.

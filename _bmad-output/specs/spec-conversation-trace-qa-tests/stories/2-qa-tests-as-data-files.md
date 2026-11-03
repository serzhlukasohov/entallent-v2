---
title: 'QA tests as data files with expected results and hard checks'
type: 'feature'
created: '2026-11-01'
status: 'done'
baseline_commit: '04a72313fa7e9c9a299fb6e9891efa1eeb3b3fd4' # HEAD; the tree was already dirty, pre-change copies of touched tracked-dirty files are in the session scratchpad baseline folder
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-conversation-trace-qa-tests/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-conversation-trace-qa-tests/precondition-format.md'
  - '{project-root}/_bmad-output/specs/spec-conversation-trace-qa-tests/stories/1-precondition-files-and-state-presets.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** QA can describe a precondition (story 1) but still needs a developer to write a Vitest scenario before a conversation is tested, and the suite report has no place for a Jira key, a BMad story or QA's own expected results.

**Approach:** A versioned JSON QA test file (precondition reference, employee replies, plain-language expected results, optional hard checks from a fixed menu, optional Jira key, story id and tags) dropped into `packages/conversation-sim/qa-tests/` becomes one test of the next `pnpm sim`; the judge checks the expectations, deterministic code checks the hard checks, and the existing suite report shows Jira/story/tags in the description block and one met / not met row per expectation and hard check (SPEC CAP-2, CAP-3).

## Boundaries & Constraints

**Always:**
- QA test files are JSON with `schemaVersion: 1`, validated with zod (strict: unknown keys fail); an unknown version, bad field or missing precondition file fails with the file name and field path.
- Fields: `title`, `precondition` (path relative to `packages/conversation-sim/preconditions/`), `replies` (≥ 1, sent in order), `expected` (plain-language lines for the judge), `hardChecks`, `jira`, `story`, `tags`; at least one expectation or hard check.
- Hard-check menu v1: `no-question`, `no-pulse-question`, `memory-contains` (`text`), `escalation` (`raised: true | false`), `reply-under` (`chars`); the reply checks take an optional 1-based `turn`, otherwise apply to every reply. Unknown check names fail with the menu listed.
- Hard checks are deterministic code over the harness run data (reply text, outbound metadata, memory, escalations); no LLM.
- Results are written into the per-scenario run JSON before any assertion, so a failing test's report shows them (open failure "deterministic checks clear before post-report assertions").
- Every top-level `qa-tests/*.json` becomes one test of `pnpm sim` through one runner scenario; a file that fails validation shows as a failing test with the load error, not a collection crash.
- Description block: `Jira`, `сторі`, `теги` from the file; missing values show `—`. Non-QA tests get the `Jira` row as `—`.
- Expected-vs-actual: one row per expectation (source `суддя`, met / not met / not evaluated → not met) and one row per hard check (source `жорстка перевірка`); the runner file's own `expect` lines are not listed for QA tests.
- Extend `from-sim-run.mjs`, `suite-report.schema.json` and `README.md`; no new report pipeline.
- Unit tests use `ScriptedAiProvider` and a scripted judge; the live judge path (`@langwatch/scenario` `judgeAgent`) is exercised only by real `pnpm sim` runs.

**Never:**
- No product-code changes outside `packages/conversation-sim`; no MAF or `agent-service`.
- No live LLM calls in framework tests; do not run `pnpm sim`, `sim:gate` or `harness:check`.
- No recording or approval of preconditions (story 3); no hard checks beyond menu v1.
- No example QA test in the top-level `qa-tests/` folder (it would run live on every `pnpm sim`); examples live in `qa-tests/examples/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Full file | precondition, 2 replies, 2 expectations, 5 hard checks, Jira, story, tags | harness built from the precondition, both replies sent, run JSON `qa` section holds every expectation and check with its outcome | N/A |
| Judge miss | scripted judge marks one expectation unmet | that row `met: false`, test result failed | N/A |
| Hard check fails | reply contains `?` with `no-question` | row `met: false` with the offending text | N/A |
| Turn throws | provider throws on reply 2 | run JSON still written with `qa`, expectations not evaluated (not met), hard checks over completed turns; error rethrown | N/A |
| No Jira/story/tags | file omits them | description rows show `—` | N/A |
| Bad version | `schemaVersion: 2` | load fails | error names file and `schemaVersion` |
| Unknown check | `{ "check": "tone" }` | load fails | error lists the menu |
| Missing precondition | path does not exist | load fails | error names the QA file and the resolved path |
| Hard checks only | `expected: []`, one hard check | judge not called; report rows only for hard checks | N/A |

</frozen-after-approval>

## Code Map

- `packages/conversation-sim/src/preconditions/load.ts` -- `loadPrecondition`, `harnessFromPrecondition(p, overrides)`, `PreconditionError` + `formatIssues` pattern to mirror for QA errors.
- `packages/conversation-sim/src/harness/coach-harness.ts` -- `send`, `replies`, `turnEffects[].outboundMetadata/escalations`, `memoryItems`, `failures`; add a public `qa` field the report copies.
- `packages/conversation-sim/src/harness/assertions.ts` -- `countQuestions` for `no-question`.
- `packages/application/src/use-cases/conversation-orchestrator.ts:1453,1480` -- outbound metadata `containsSurveyProbe` and `topicQuestion` mark a pulse question (read only).
- `packages/conversation-sim/src/harness/report.ts` -- `ScenarioRunReport`, `buildReportData`, `reportRun`, `renderVerdict`; add optional `qa` section.
- `packages/conversation-sim/src/harness/judge-verdict.ts` -- `expectJudgeVerdict` (gate-aware) for the judge assertion.
- `packages/conversation-sim/src/scenarios/data-use-mixed-disclosure.sim.test.ts`, `config.ts` -- live judge pattern: `run({ agents: [agent, userSimulatorAgent, judgeAgent({ criteria })], script: [user(), agent(), judge()] })`.
- `packages/conversation-sim/report/from-sim-run.mjs` -- `descriptionRows` (:365), `actual` (:489), test `descriptionSummary` (:567).
- `packages/conversation-sim/src/preconditions/load.test.ts:253-320` -- pattern for driving `from-sim-run.mjs` from a unit test with a fake Vitest JSON.
- `packages/conversation-sim/package.json` `test` script and `vitest.config.ts` `include` list folders explicitly.

## Tasks & Acceptance

**Execution:**
- [x] `src/qa/schema.ts` -- zod schema v1 for QA test files and the hard-check menu -- one validated format.
- [x] `src/qa/hard-checks.ts` -- `evaluateHardChecks(checks, runView)` returning `{ label, met, actual }` per check -- deterministic checks.
- [x] `src/qa/load.ts` -- `loadQaTest(path)`, `listQaTests(dir)`, `QaTestError` -- validates the file and its precondition.
- [x] `src/qa/run.ts` -- `runQaTest(test, { driver, aiProvider? })`: build harness, drive replies via a `QaDriver`, compute expectations and hard checks, set `harness.qa`, `reportRun`, rethrow a turn error; `scriptedQaDriver` for tests -- one runner for live and scripted.
- [x] `src/qa/live-driver.ts` -- `liveQaDriver()` using `@langwatch/scenario` `run` with `judgeAgent` -- the judge path for `pnpm sim`.
- [x] `src/scenarios/qa-tests.sim.test.ts` -- one `it` per `qa-tests/*.json`; asserts the judge with `expectJudgeVerdict` and each hard check with its label -- files become tests.
- [x] `src/harness/coach-harness.ts`, `src/harness/report.ts` -- `qa` field and `ScenarioRunReport.qa`, Markdown verdict lines -- report carries results.
- [x] `report/from-sim-run.mjs`, `report/suite-report.schema.json` -- Jira/story/tags rows, QA comparison rows -- suite report shows them.
- [x] `qa-tests/README.md`, `qa-tests/examples/release-week-no-pulse-question.json`, `report/README.md` -- format and how to add a test.
- [x] `src/qa/qa.test.ts`, `package.json`, `vitest.config.ts` -- unit tests for every matrix row plus the suite report rows; add `src/qa` to `test` and `include`.

**Acceptance Criteria:**
- Given the example QA file copied into a temp QA folder, when the scripted runner and `from-sim-run.mjs` run, then the suite test shows Jira, story and tags in its description and one row per expectation and hard check with met / not met.
- Given existing scenarios, when `pnpm --filter @entalent/conversation-sim test` runs, then they pass unchanged.

## Implementation Notes

- Implemented directly by the build agent instead of a fresh subagent: story 1's implementation subagent ran `pnpm harness:check`, which executed untracked live scenarios; this story forbids live runs, so the risk was kept in one place.
- Baseline: the tree was already dirty, so `baseline_commit` is HEAD and the review diff compared pre-change copies of the touched tracked files plus the new files (no temp-index commit; that command was held by the sandbox).
- Added `src/qa/{schema,hard-checks,load,run,live-driver}.ts`, `src/qa/qa.test.ts` (23 tests), runner `src/scenarios/qa-tests.sim.test.ts`, `qa-tests/README.md`, `qa-tests/examples/release-week-no-pulse-question.json`; extended `coach-harness.ts` (`QaRunSummary`, `harness.qa`), `report.ts` (`qa` section, Markdown verdict and header, `reportRun` takes a judge result), `from-sim-run.mjs`, `suite-report.schema.json`, `report/README.md`, `package.json` and `vitest.config.ts` (`src/qa`).
- The runner's assertions live in `assertQaRun` (src/qa/run.ts) so they are unit tested without a model; hard-check failures are asserted together in one `expect` so the message lists all of them.
- A judge pass covers an expectation whose wording the judge did not echo back (a pass means every criterion held); otherwise an unechoed line stays unjudged and counts as not met.
- The live judge gets the title, onboarding, pulse cycle, memory, goals, pending actions and the last six seeded messages as the scenario description, since it only sees the scripted turns.
- Not exercised: `liveQaDriver` and the runner scenario (live only; no `pnpm sim` run by rule).

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | blind | Example `memory-contains "release checklist"` is satisfied by precondition memory | low | patch | Seed holds "Leads the release checklist"; example now checks "QA handoff", README warns |
| 2 | blind | Optional `newOnly` for memory-contains | low | reject | Adds format surface; README guidance covers the common mistake |
| 3 | blind, verification | Failed QA test whose error no row explains loses the error (unjudged rows count as `met: false`) | medium | patch | `qaComparisons` keyed on any `met: false`; now keys on judged-unmet or failed hard checks; test added for a load failure with no run report |
| 4 | blind, edge | Paraphrased judge echo leaves expectations unjudged and red on a passing test | medium | patch | `verdictFor` exact-normalized match; a judge pass now covers unechoed lines; normalization test added |
| 5 | blind | Runner's "every turn completes" assert unreachable | maybe-false | reject | Unreachable for scripted throws (send rethrows), but `@langwatch/scenario` may swallow agent errors in live runs; kept as a guard |
| 6 | blind | Live judge lacks precondition state (cycle, memory, goals) | medium | patch | `judgeDescription` now includes onboarding, cycle, memory, goals, pending actions |
| 7 | blind | README does not say which checks take `turn` | low | patch | Direct doc correction |
| 8 | blind, edge | Markdown header gives no reason for FAIL from hard checks / unjudged expectations | low | patch | Header shows `hard checks: x/y met`; `passed` also fails on an expectation not met |
| 9 | blind | JSON `deterministic.passed` ignores hard checks | low | reject | Gate counts Vitest failures, which `assertQaRun` produces; `qa.hardChecks` holds the outcome |
| 10 | blind | `liveQaDriver` untested; turn counter could drift | maybe-false | defer | Needs a fake `run`; settles with a mocked `@langwatch/scenario` test or one approved live run |
| 11 | blind, edge | Precondition path may escape `preconditions/` | low | patch | Direct guard in `loadQaTest`; test added |
| 12 | blind | Vitest name vs `QA <id>` scenario name not tested | false | reject | Link uses `testName` from `expect.getState()`, normalized by `from-sim-run`; scenario name is not used for matching |
| 13 | blind | `turn: 0` untested | low | reject | Schema `min(1)`; trivial |
| 14 | blind | `listQaTests()` default-folder assertion vacuous | low | patch | Replaced with an uppercase `.JSON` discovery assertion |
| 15 | verification | Markdown QA verdict and PASS/FAIL untested | gap | patch | Test added on `buildMarkdownReport` with a failed hard check and unjudged expectation |
| 16 | verification | `no-pulse-question` fixture uses a string `topicQuestion`; real metadata is an object, printed `[object Object]` | medium | patch | conversation-orchestrator.ts:1480 shape; check prints the group and probe id; fixture uses real shape |
| 17 | verification | Runner assertions only run live | gap | patch | Extracted `assertQaRun`, unit tested for hard-check failure, hard-checks-only, judge miss |
| 18 | verification | Criterion normalization untested | gap | patch | Covered by the test for #4 |
| 19 | edge | Escalation raised in a turn that then throws is missed | low | reject | Needs escalation-to-turn mapping; a thrown turn already fails the test |
| 20 | edge | `harnessFromPrecondition` throw leaves no QA report | low | reject | Precondition validated at load; the Vitest failure still shows in the suite via the harness row |
| 21 | edge | `reportRun` error masks a turn error | low | reject | Report write failing is unlikely; adds try/finally branching |
| 22 | edge | `reply-under` counts UTF-16 units | low | patch | Direct correction to code points; test added |
| 23 | edge | `.JSON` files silently skipped | low | patch | Case-insensitive extension |
| 24 | edge | AC copy-into-temp-folder path not exercised | low | patch | Suite test now discovers the example via `listQaTests` on a temp folder |

## Design Notes

Decisions taken without a human (checkpoints auto-approved by Illia): precondition paths resolve against `preconditions/` so QA writes `examples/cycle-open-with-history.json`; `memory-contains` checks all active memory after the run, including precondition memory (case-insensitive substring); a missing per-expectation verdict counts as not met; only top-level `qa-tests/*.json` run, so examples never run live by accident.

```json
{ "schemaVersion": 1, "title": "No pulse question right after a release-week vent",
  "precondition": "examples/cycle-open-with-history.json",
  "replies": ["Release slipped again, I'm exhausted."],
  "expected": ["The reply acknowledges the exhaustion before anything else"],
  "hardChecks": [{ "check": "no-pulse-question" }, { "check": "reply-under", "chars": 600 }],
  "jira": "ENT-123", "story": "2", "tags": ["pulse"] }
```

## Verification

**Commands:**
- `pnpm --filter @entalent/conversation-sim test` -- expected: all pass, including `src/qa/qa.test.ts`.
- `pnpm --filter @entalent/conversation-sim typecheck` -- expected: no errors.
- `pnpm --filter @entalent/conversation-sim lint` -- expected: no errors.

---
title: 'Story 12.2: Evaluation, Scoring and Report Core'
type: 'feature'
created: '2026-10-25'
status: 'ready-for-dev'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-conversation-eval-regression-2026-10-17/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 12.1 gives typed tests, `CaseRun` and a rule registry, but nothing turns a run into framework statuses, a layer table and a verdict, so each level would invent its own "passed".

**Approach:** Add three pure modules under `packages/conversation-sim/src/suite/`: `evaluate.ts` (one `CriterionResult` per test criterion), `score.ts` (scope, aggregation, layer table, verdict per Framework v2.1.1 sections 5 and 6) and `report.ts` (`SuiteRunReport` v1 as JSON and Markdown). Offline, tested with synthetic `CaseRun` fixtures.

## Boundaries & Constraints

**Always:**
- New types (`SuiteRunReport`, `JudgeTrust`, layer and coverage rows) go in `schema.ts`; 12.1 types are extended additively, never redefined.
- `evaluate` and `score` are pure and deterministic; only `writeSuiteReport` does I/O.
- `evaluate` throws on `run.steps[i].index !== i + 1`, on `run.testId !== test.id`, and on a rule name absent from the registry.
- `evaluate` takes the registry as an optional last parameter (default `RULES`), as `validateSuite` does.
- Verdict thresholds are quoted in `score.ts` doc comments with "Framework v2.1.1".

**Never:**
- No executors, fixtures, runner, CLI, `suite.config.json`, judge implementation, diff or baselines.
- No new registry rules (`effect-count`, `state-*` arrive in 12.3); tests use test-local registry entries.
- No change to `ScenarioRunReport`, `gate.config.json`, `run-gate.ts` or any product package.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|----------|--------------|----------|
| Rule PASS/FAIL | in-scope criterion, all rule checks run | PASS if all PASS; any FAIL → FAIL with evidence |
| Meaning only, `judge: null` | all checks `meaning` | NOT_RUN `no-judge-at-level`, out of scope |
| Rule + meaning, `judge: null` | mixed checks | decided by rules, `meaningSkipped: true` |
| Level narrowed | test or criterion lacks the run level | NOT_RUN `level-not-declared`, out of scope |
| Unobservable | rule `requires` a field not in `run.observed` | NOT_RUN `unobservable:<field>@<level>` |
| Rule NOT_OBSERVABLE | e.g. conversation scope over an all-silent run | NOT_RUN reason = rule evidence (`no-replies`) |
| Precondition | `run.preconditions` has `satisfied: false` | INVALID `precondition:<name>` for every criterion |
| Already satisfied | `change` state criterion whose rule checks PASS with `state.before` substituted | INVALID `precondition:already-satisfied` |
| Checkpoint | journey, checkpoint rule FAILs at step k | INVALID `checkpoint:<k>` for criteria at n > k and `conversation`/`state` criteria without `independentOfCheckpoints` |
| Executor error | `run.errors` entry with `step` ≤ criterion step (0 = fixtures) | ERROR with the error's `reason` (e.g. `fixture-apply:<name>`) |
| Unsupported fixture | `run.errors` entry with reason `unsupported-fixture:<name>` | NOT_RUN with that reason, never ERROR |
| Step not reached | criterion step > `run.steps.length` or > `stoppedAtStep` | NOT_RUN `step-not-reached:<n>` |
| effect-count pairing | `change` criterion, manifest `stateEffect`, `events` observed, level ≠ L2 | extra `effect-count` rule check `{ ...stateEffect, step }` |
| Verdict | any non-advisory S FAIL / P+D+C rate ≥ 0.90 / 0.75–0.89 / lower | NOT ADEQUATE / ADEQUATE / ACCEPTABLE WITH ISSUES / NOT ADEQUATE |
| Incomplete | any in-scope status outside PASS, FAIL, NOT_TESTABLE | `complete: false`, `provisional: true` with reason |
| Journeys only | no atomic/observation result in scope | verdict `n/a (journeys only)`, no layer table |
| Bad run | step index mismatch | `evaluate` throws |

## Decisions

- **Multi-sample status (n > 1):** a criterion is PASS when `passCount >= minPasses` (n/n for rule checks, ceil(0.8n) for meaning checks), matching the 12.9 diff; `passCount` and `n` are reported per key.
- **Manifest NOT TESTABLE criteria:** `score` emits one NOT_TESTABLE row per such criterion keyed `<sourceCase>/<criterionId>` (no collision: tests never reference them); the rows flow into baselines and diffs.
- **Seed for rules:** rules receive the test's seed history through the optional 4th argument `RuleContext { seedHistory }`; `repeated-question` and Story 12.3a's `no-two-replies-without-cause-question` rely on it.

</frozen-after-approval>

## Code Map

- `packages/conversation-sim/src/suite/schema.ts` -- extend: `CriterionResultSchema` gains `testKind`, `inScope`, optional `step`; add `JudgeTrustSchema { trusted, reason, pin: unknown|null, agreement: unknown|null }`, `SuiteRunReportSchema` (AD-11 fields). `LoadedCriterion` adds optional `stateEffect`. `CriterionStatus`, `CaseRun`, `ObservationField`, `fieldObserved`, `parseEvaluatedAt`, `stateAtStep` are reused as is.
- `packages/conversation-sim/src/suite/loader.ts:195` -- join site; add `stateEffect: entry.stateEffect` (only loader change).
- `packages/conversation-sim/src/suite/rules/registry.ts` -- `RuleEntry.run(run, criterion, params)`; extend with optional 4th `context: RuleContext` (`{ seedHistory: SeedTurn[] }`). Existing entries stay valid.
- `packages/conversation-sim/src/suite/rules/reply-selection.ts` -- `selectReplies` already returns NOT_OBSERVABLE `no-replies` / `step-not-reached:<n>` / `unobservable:<field>@<level>`; `missingField` is reused by `evaluate` for the requires check. Do not change semantics.
- `packages/conversation-sim/src/suite/rules/repeated-question.ts` -- closes deferred-work item: prefix the transcript with seeded coach turns from `context`, still report only selected turns.
- `packages/conversation-sim/src/suite/rules/synthetic-run.ts` -- base for `CaseRun` fixtures in new tests.
- `packages/conversation-sim/src/gate/run-gate.ts:94,350` -- run-id and git format to mirror in the report type; do not import or modify.
- `packages/conversation-sim/src/harness/report.ts:16` -- `ScenarioRunReport`; untouched.
- `.gitignore:16` -- `runs/` already ignores `packages/conversation-sim/runs/suites/`.

## Tasks & Acceptance

**Execution:**
- [ ] `src/suite/schema.ts` -- add the schema extensions from the Code Map -- single type source.
- [ ] `src/suite/loader.ts`, `src/suite/rules/registry.ts`, `src/suite/rules/repeated-question.ts` -- join `stateEffect`; add `RuleContext`; consume seed in `repeated-question` plus a fail fixture test where the reply re-asks a seeded coach question.
- [ ] `src/suite/evaluate.ts` -- `evaluate(test: LoadedTest, run: CaseRun, judge: null, trust: JudgeTrust, rules = RULES): CriterionResult[]` -- scope, effect-count synthesis, checkpoint evaluation, precedence, rule calls with `RuleContext`; `advisory` is `!trust.trusted` only on meaning-derived results; `method: 'n/a'` until 13/14 set it.
- [ ] `src/suite/score.ts` -- `score({ suite, level, n, results }): SuiteScore` -- aggregate per key by `minPasses`, add manifest NOT_TESTABLE rows (see Decisions), layer table P/D/C/S over atomic+observation non-advisory, journeys section, COMPLETE, verdict, provisional reason.
- [ ] `src/suite/report.ts` -- `buildSuiteReport(score, meta)` (meta: runId, suiteId, level, n, git `{ sha, dirty }`, models, judgeTrust, judgeErrors, usage), `renderSuiteReportMarkdown(report)`, `writeSuiteReport(report, baseDir)` → `<baseDir>/runs/suites/<runId>/report.{json,md}`; coverage table requirement → source → test → criterion, NOT TESTABLE reasons, judge-only criteria, unobservable fields.
- [ ] `src/suite/evaluate.test.ts`, `score.test.ts`, `report.test.ts` -- one test per matrix row, each verdict band boundary (0.90, 0.75), each precedence branch, journey checkpoint propagation, scope exclusion; report JSON parses with `SuiteRunReportSchema`; writer test uses a temp dir.

**Acceptance Criteria:**
- Given the same `(test, run, trust)`, when `evaluate` runs twice, then results are deep-equal and inputs are not mutated (deep-frozen fixture).
- Given an atomic test whose single reply repeats a seeded coach question, when evaluated with `repeated-question`, then the criterion is FAIL.
- Given the package test command, when it runs, then the existing `gate`, `harness` and 12.1 suite tests stay green and nothing outside `conversation-sim` imports `src/suite`.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

- **Seed context (deferred-work 12.1):** `evaluate` already holds the test, so it passes `{ seedHistory }` to rules rather than copying the seed into `CaseRun`; the executor contract stays unchanged.
- **Precedence is literal:** NOT_RUN (unobservable, rule NOT_OBSERVABLE) outranks a FAIL from another rule check of the same criterion, as Framework section 5 orders it.
- **Already satisfied:** re-run the criterion's own rule checks (not the synthesized `effect-count`) on a copy of the run where the queried snapshot (`after` or `afterStep[n]`) is replaced by `state.before`; all PASS → INVALID.
- **Checkpoint:** evaluated with `evaluatedAt: 'after-step:<k>'`; only FAIL fails it; the earliest failing k wins.
- **Criterion step:** `reply:n`/`after-step:n` → n; `state` → `stateAtStep(at)` or last step; `conversation`/`observation-window` → last step.
- **Judge:** typed `null` here; Epic 13 widens it (and makes `evaluate` async) at the single runner call site.

## Verification

**Commands:**
- `pnpm --filter @entalent/conversation-sim test` -- expected: new and existing offline tests pass.
- `pnpm --filter @entalent/conversation-sim typecheck` -- expected: clean.
- `pnpm --filter @entalent/conversation-sim lint` -- expected: clean.
- `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` -- expected: receipt path reported.

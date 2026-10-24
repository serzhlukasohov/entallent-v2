---
title: 'Story 12.1: Case Schema, Loader and Rule Registry Contract'
type: 'feature'
created: '2026-10-24'
status: 'ready-for-dev'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-conversation-eval-regression-2026-10-17/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The conversation evaluation framework has no data contract yet. Later stories need typed suite tests, a source manifest, observation records and a rule registry, and they need a malformed test or a dangling rule name to fail before any run.

**Approach:** Add Zod schemas for the amended AD-1/AD-3 model (atomic, journey and observation tests; source manifest; `CaseRun` with `events`), a loader that validates and joins tests against the manifest, and a rule registry that wraps the three legacy rules. Everything lives under `packages/conversation-sim/src/suite/` and runs offline.

## Boundaries & Constraints

**Always:**
- `schema.ts` imports only `zod`, and it is the single type source. Schemas use the `Schema` suffix and inferred types drop it.
- The loader parses every module as `unknown`, stops at the first invalid test, never mutates its input, and throws `SuiteLoadError` with code, suite id, test id and Zod path.
- NOT TESTABLE and retirement live only in the manifest (`notTestableReason`). Test checks are `rule` or `meaning` only.
- Legacy rules are wrapped, never copied. `hasReflectiveOpener` stays in `@entalent/ai-openai`.
- `validateSuite` takes the rule registry as a parameter (default `RULES`), so 12.3 and the tests can supply other entries.

**Never:**
- No P-01..P-10 data (12.4), no evaluate/score/report (12.2), no new rules (12.3), no executors, fixtures or accessors (12.7, 13.4), no CLI or `suite.config.json` (12.8).
- No product package or app changes. Nothing outside `src/suite/` imports it.
- No live model calls. `pnpm sim` is not run.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected |
|----------|-------|----------|
| Valid suite | manifest + atomic, journey and observation tests | `LoadedSuite { id, sources, tests }`; each test criterion has `layer` and `passCondition` joined from the manifest; a test with `advanceClock` gets `clock` in `setup` |
| Empty p-v1 | `loadSuite('p-v1')` | `{ id: 'p-v1', sources: [], tests: [] }` |
| Unknown suite | `loadSuite('nope')` | `SuiteLoadError` `unknown-suite` |
| Shape error | any test failing Zod | `invalid-test` with the Zod path |
| Atomic misuse | step count ≠ 1, no `seed`, a checkpoint, or `L2` in levels | `invalid-test` |
| Journey or observation misuse | journey with 0 steps or a `seed`; observation with steps, a `seed` or a `reply:<n>` criterion, or without `observationWindow` | `invalid-test` |
| Index and state misuse | `reply:<n>`/`after-step:<n>`/`stateQuery.at` index outside `1..steps.length`; `state` criterion without `stateQuery` or `stateQuery` elsewhere | `invalid-test` |
| Level subset | `criterion.levels` ⊄ test `levels` | `invalid-test` |
| L0 text-only | an L0-scoped criterion with no rule check whose `requires` excludes `reply.text`, or an L0 test without `scripted` | `invalid-l0` |
| Ids | duplicate test id; duplicate criterion id in one test; test id not `<sourceCase>.A<n>` / `<sourceCase>.J` / `<sourceCase>` (observation); unknown `sourceCase` | `duplicate-test-id`, `duplicate-criterion-id`, `test-id-format`, `unknown-source` |
| Manifest link | criterion id absent from its source, or pointing at a NOT TESTABLE criterion | `unknown-criterion`, `not-testable-criterion` |
| Coverage | testable criterion of a `conversation` source not covered by an atomic test; `observation` source without its observation test | `uncovered-criterion` |
| Rules | rule name absent from the registry (criteria, preconditions, checkpoints) | `unknown-rule` |

</frozen-after-approval>

## Code Map

- `packages/conversation-sim/package.json` -- add `zod ^3.25.76` (already resolved in the workspace for config/contracts; `ai` 6 peers on it) and `src/suite` to the `test` script path list. Keep the existing `--exclude` flags.
- `packages/conversation-sim/vitest.config.ts:13` -- `include` lacks `src/suite/**/*.test.ts`. Without it the new tests never run.
- `packages/conversation-sim/src/harness/fidelity-checks.ts` -- deterministic fidelity checks from main; not wrapped here, candidate for reuse in Story 12.3.
- `packages/conversation-sim/src/harness/assertions.ts:131,151,169` -- `findRepeatedQuestions`, `extractQuestions` and `firstSentence` are private. Add `export` only; no body changes; `findViolations`, `describeViolations` and `normalizeQuestion` stay untouched.
- `packages/ai-openai/src/prompts/style-antipatterns.ts:19` -- `hasReflectiveOpener`, the product-shared definition the wrapper calls.
- `packages/conversation-sim/src/fakes/scripted-ai.ts:33` -- `ScriptedAiOptions` takes functions, so `scripted` is plain data that 12.7 converts. Do not import fakes into `schema.ts`.
- `packages/application/src/use-cases/conversation-orchestrator.ts` (`OrchestrateResult`) -- producer of `TurnTrace` values (`outcome`: `input_filtered`/`processing_failed`; `bundleReply`: `answer_then_bundle`/`bundle_without_reply`). Keep them as plain strings.
- `packages/conversation-sim/tsconfig.json` -- CommonJS, ES2022 lib: no `findLast`, `toSorted` or `Object.groupBy`; use `__dirname`, not `import.meta`.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/conversation-sim/package.json`, `pnpm-lock.yaml` -- add zod devDependency; run `pnpm install --offline`, then `--frozen-lockfile`; lockfile diff limited to the importer entry.
- [ ] `src/suite/schema.ts` -- enums `Level`, `Layer`, `CriterionStatus`, `TestKind` (`atomic|journey|observation`), `SourceKind` (`conversation|observation`), `FixtureName` (`clock, seededHistory, confirmationState, pulseCycle, pendingBotQuestion, freshPersona, disclosureDelivered, proactiveUsers`), `StateQueryName` (`questionProgress, stagedBundleCount, surveyEvidenceCount, outboundCount`) with per-query value schemas (`{ answered, total }` ints for `questionProgress`, non-negative ints for the counts). Also `ObservationField` (`reply.text`, `reply.messages`, `reply.messages[].metadata.<key>`, `turn.(mode|intent|outcome|bundleReply|replyPlan)`, `state.<query>`, `window.outbound`, `steps.gapMs`, `events`) with `fieldObserved` (exact or prefix match). Shapes: `FixtureRef { name, params?: Record<string, unknown> }` (each fixture validates its own params in its story); `RuleCheck { type: 'rule', rule: kebab, params? }`; `MeaningCheck`; `SeedTurn { role, text, atOffsetMs: int ≥ 0, metadata? }` with offsets non-increasing; `ScriptedStep { step: int ≥ 1, classification?, risk?, memoryProposal?: Record<string, unknown>, response?: { text, bundleText? } }`; `SourceCriterion`, `SourceCase`, `Criterion` (manifest id, `evaluatedAt`, `checks` min 1, `levels?`, `stateQuery? { name, at, kind: change|invariant }`, `independentOfCheckpoints?`, `judgeGuidance?`), `Step`, `SuiteTest`, `ReplyMessage`, `TurnTrace`, `StepObservation` (with the `reply.text` join invariant), `RunEvent`, `StateSnapshot` (partial object of the per-query schemas), `PreconditionResult`, `ExecutionError`, `CaseRun { testId, …, events }` and `CriterionResult { testId, criterionId, sourceCase, level, layer, status, advisory, method: observed|substituted|n/a, reason?, evidence?, meaningSkipped? }`. Add `parseEvaluatedAt`.
- [ ] `src/suite/rules/registry.ts`, `reply-selection.ts`, `too-many-questions.ts`, `repeated-question.ts`, `reflective-opener.ts` -- `RuleEntry { requires, run, fixtures: { pass: CaseRun, fail: CaseRun } }` and `RULES`, `RuleName`, `RULE_NAMES`, `RuleNameSchema`. Wrapper semantics: NOT_OBSERVABLE when a required field is undeclared or the criterion is `state`/`observation-window`; a null reply at `reply:<n>` is FAIL `no-reply (turn n)`; `conversation` scope checks every reply. Evidence reads `turn <n> — <detail>`.
- [ ] `src/suite/loader.ts`, `cases/p-v1/index.ts` (`tests: unknown[] = []`), `cases/p-v1/sources.ts` (`sources: unknown[] = []`) -- `SuiteLoadError`, `validateSuite(suiteId, { sources, tests }, rules = RULES)`, `SUITES` explicit map, `loadSuite`; all matrix rows.
- [ ] `src/suite/__fixtures__/suite.ts`, `schema.test.ts`, `loader.test.ts`, `rules/registry.test.ts` -- one test per matrix row; deep-frozen input; drift guard that every `*.case.ts` in `cases/p-v1` is listed in `index.ts`; every rule FAILs on its `fail` fixture and PASSes on `pass`; `CaseRun` round trip; `fieldObserved` and `parseEvaluatedAt` cases.

**Acceptance Criteria:**
- Given the offline package test command, when it runs, then `src/suite/**/*.test.ts` executes, every matrix row has a passing test, and the existing `gate`/`harness` tests stay green.
- Given `rg "from '.*suite" packages apps --glob '!packages/conversation-sim/**'`, when run, then nothing outside `conversation-sim` imports `src/suite`.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

L0 refinement uses the registry passed to `validateSuite`: a criterion is L0-valid only if some rule check names an entry whose `requires` lacks `reply.text`. The three legacy rules all need `reply.text`, so the loader tests use a test-local registry entry (for example `requires: ['events']`) instead of waiting for 12.3.

## Verification

**Commands:**
- `pnpm --filter @entalent/conversation-sim test` -- expected: all suite and existing offline tests pass.
- `pnpm --filter @entalent/conversation-sim typecheck` and `lint` -- expected: clean.
- `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` -- expected: receipt path reported.

---
title: 'Story 13.4: L1 Orchestrator Executor, Live Fixtures and State Queries'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: '55b3b224c71095201e423b883233481aafea7923'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-conversation-eval-regression-2026-10-17/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred:
  - summary: >-
      A stalled live coach model call has no per-turn timeout, so a live L1 run could wait indefinitely on one test and write no report.
    evidence: |-
      Edge Case Hunter (Story 13.4 review), maybe-false: L1OrchestratorExecutor awaits harness.sendTurn without a timeout; whether OpenAiProvider/AI SDK already bound each request was not checked. Settle by reading packages/ai-openai/src/openai-provider.ts request options. Belongs with Story 13.5 live run budgets (per-call timeouts and budget-exceeded handling).
    location: >-
      packages/conversation-sim/src/suite/executors/l1-orchestrator-executor.ts (coachAgent.call)
    severity: medium (unverified)
---

<intent-contract>

## Intent

**Problem:** Only L0 can execute a suite test. There is no L1 executor running the real orchestrator and prompts with a coach model, no `pulseCycle` fixture, no `surveyEvidenceCount` observation, no L1 state-query table, no `substituted` method label, `models.coach` is always null, and `suite:run` cannot run L1 at all.

**Approach:** Add `L1OrchestratorExecutor` (fresh `CoachHarness` per test over in-memory fakes, coach `AiProviderPort` and coach model label injected, every port recorded, steps driven by Scenario `run()`), the `pulseCycle` fixture with an in-memory survey repository and inline survey-evidence extraction, the L1 state-query table, `method: 'substituted'` for L1 state criteria, and `models.coach` from the executor. Live wiring lives only in a new gated entry `suite:run:live` (`--live-model`), mirroring `judge/calibrate-live.ts`.

**User decisions (2026-10-25, recorded as intent):** The QA suite `p-v1` (12.4) is out of scope and empty; smoke scenarios live in `smoke-v1` after the framework. No live model calls in this story: the L1 executor takes its coach provider and the run judge by injection, and every test uses fakes (`ScriptedAiProvider`, fake judges). The live wiring (`harness/live-provider.ts`, `judge/live-judge-model.ts`) sits behind an explicit live gate (separate entry and flag), is never run by tests, scripts or CI, and the default `suite:run` keeps refusing L1 without that gate. Model egress and cost are a human boundary. Budgets, coach usage counting and the first L1 baseline are Story 13.5.

## Boundaries & Constraints

**Always:**
- `src/suite/executors/l1-orchestrator-executor.ts`: `class L1OrchestratorExecutor implements SuiteExecutor`, `level: 'L1'`, constructor `{ createAiProvider: () => AiProviderPort; coachModel: string; langwatch?: { apiKey?: string; endpoint?: string }; fixtures?; runScenario?: typeof run }` (`runScenario` defaults to `@langwatch/scenario` `run`; test seam only). It never reads `process.env`.
- Per test (and per retry attempt) a fresh world: `FixedClock`, event sink, in-memory conversation/memory/goal/style/question-confirmation repositories, a new `InMemorySurveyRepository`, a new provider from `createAiProvider()`, all wrapped by `record()`; the AI provider is recorded with model info so each AI event carries `model: { name: coachModel, settings: {}, request: <args>, response: <result> }` untruncated (the `RunEvent.model` field already exists). `CoachHarness` gets the recorded ports plus `surveyRepo` and `pulseBacklogService`, `fallbackReport: false`. The `InlineOutbox` runs `SurveyEvidenceExtractionUseCase` inline over the same recorded AI provider, conversation repo and survey repo (new optional `InlineOutboxOptions.surveyEvidence`; default no-op unchanged).
- Conversation tests are driven by one `runScenario({ name: test.id, description, setId: 'entalent-suite-<suiteId>', agents: [coachAgent], script, maxTurns: >= steps + 1, langwatch: { apiKey: options.langwatch?.apiKey ?? '', endpoint } })`. `script` = per step a custom `ScriptStep` (realize gap/`advanceClock`, set `sink.stepIndex`), `user(step.text)`, `agent()`, a custom step that records the `StepObservation` (or the error) and runs a `stop` checkpoint, then `succeed()`. No judge agent, no user simulator. The coach agent calls `harness.sendTurn` and returns the reply text (empty array when no outbound under the trace); replies are attributed by the turn's `traceId` exactly as at L0. A turn error or stop checkpoint ends the script early via `executor.succeed()`; the `CaseRun` is built from harness, sink and clock only, never from the Scenario result, so it is identical with or without a LangWatch key. Gap semantics, journey `interMessageGapMs`, checkpoints, `stoppedAtStep`, error kinds and fixture/precondition handling match the L0 executor; share the code (move L0's pure helpers into a shared module) and keep L0 behavior and tests unchanged.
- `observes()` and `CaseRun.observed`: conversation tests `reply.text`, `reply.messages`, `turn.mode`, `turn.intent`, `turn.outcome`, `turn.bundleReply`, `steps.gapMs`, all four `state.*`, `events`; observation tests `window.outbound`, all four `state.*`, `events`. `subject.externalUserId` is `l1-<testId>`.
- Observation tests (P-06): reuse `driveObservationWindow` from `proactive-l0.ts` with the L1 world's recorded ports, so `ProactiveCheckInUseCase` runs on the injected coach provider over the fixture clock and fills `window.outbound`; same `proactive-users-missing` / `observation-window-missing` errors as L0.
- `supports()` is true for all eight fixtures: L1 registry = the L0 fixtures plus `pulseCycle`. Fixtures stay level-agnostic over `FixtureContext`; add an optional `FixtureContext.survey?: { port: InMemorySurveyRepository; state: InMemorySurveyRepository }` (recorded and raw), absent at L0. `L0_FIXTURES` keeps `pulseCycle` absent.
- `src/suite/fixtures/pulse-cycle.ts`: params (strict) `{ surveyWindowId, questions: [{ surveyQuestionId, questionVersion, questionGroup, workingSummary, title, status: pending|ready|confirmed|disputed|declined }] (min 1), uncoveredTopics: [{ topic, canonicalQuestions: string[] (min 1) }] (min 1) }`, refined so every `uncoveredTopics[].topic` names a `questionGroup` with at least one question not `confirmed`/`declined`. `apply()` throws when a V2 window is already seeded (e.g. with `confirmationState`) or `context.survey` is absent; otherwise seeds the question-confirmation window and the survey repository window and questions. `verify()` reads `findCycleProgress` back through the raw fake and `predictCycleProgress(...).openTopics`; satisfied only when it is non-empty and contains every declared uncovered topic (false -> `INVALID precondition:pulseCycle` via existing evaluate). `judge-input.ts` `fixtureContext` keeps reading `uncoveredTopics` unchanged.
- `disclosureDelivered` at L1 is the existing fixture (verify reads the delivered disclosure back); a false verify yields INVALID.
- `src/fakes/survey-repository.ts`: `InMemorySurveyRepository implements SurveyRepositoryPort` for one tenant/user: `seedWindow`, `findOrCreateActiveWindow` (null without a seeded window), `findQuestionsForWindow`, `saveEvidence`/`markEvidenceSuperseded`/`findEvidenceForQuestion`/`upsertAssessment`/`findAssessmentsForWindow`/`findGroupState`/`upsertGroupState` stored in memory, every other method a safe empty (`[]`, `null`, `false`, `0`); `evidenceCount()` = saved, non-superseded evidence; `pulseBacklog()` returns a `getNextProbeQuestion` that yields the first open question of the first uncovered topic group (`focus: 'open'`) or null. It stamps time from an injected clock.
- `src/suite/fixtures/state-queries.ts`: `L1_STATE_QUERIES: Record<StateQueryName, { l1: (sources, args: { group: string | null }) => unknown }>` (the `l2` column is added in Epic 14) and `readL1Snapshot(sources, { group })`, validated per query with `STATE_QUERY_VALUE_SCHEMAS` (invalid -> `SuiteExecutionError` `state-query:<name>`). `questionProgress(group)` counts confirmed/total over the `pulseCycle` fixture's first uncovered topic group when the test applies `pulseCycle`, else over the whole window; `stagedBundleCount`, `outboundCount` as at L0; `surveyEvidenceCount` from `evidenceCount()`. Snapshots at `before`, `after` and every named `after-step:<n>`. `state-queries-l0.ts` stays as is.
- `evaluate`: `method` is `'substituted'` for `evaluatedAt: 'state'` criteria when `run.level === 'L1'`, else `'n/a'` as before. Effect-count pairing is unchanged (runs already declare `events`).
- `ExecutorOptions` gains optional `suiteId?: string` (the runner passes `suite.id`; the L1 `setId` is `entalent-suite-<suiteId>`, `entalent-suite-unknown` when absent). `SuiteExecutor` gains optional `readonly coachModel?: string | null`; `runSuite` sets `models.coach = executor.coachModel ?? null` (L0 stays null).
- Default CLI: `createExecutor` still refuses L1 and L2; the L1 message becomes `[suite] L1 runs call live models; run suite:run:live with --live-model (model egress and cost are a human boundary)`; L2 message unchanged. The CLI and runner never import the L1 executor or the live entry. Help and README document the live entry.
- `src/suite/run-live.ts` + script `suite:run:live` (`node --import tsx src/suite/run-live.ts run`): refuses (exit 1, nothing built) without `--live-model`; runs only the `run` command at `--level L1`; strips the flag and calls `main` with `defaultDeps()` overridden by `createExecutor` (L1 -> `new L1OrchestratorExecutor({ createAiProvider: createLiveProvider, coachModel: liveCoachModel(env), langwatch: { apiKey: env.LANGWATCH_API_KEY } })`) and `createRunJudge` (`createCriterionJudge({ model: createLiveJudgeModel(judge, env), decoding })`). `liveCoachModel(env)`: `azure:<OPENAI_MODEL_BALANCED or gpt-4o>` when `AZURE_OPENAI_ENDPOINT` is set, else `openai:gpt-4o`. Injectable deps like `calibrateLive`; its tests never build a model.
- Import graph: the L1 executor, runner and CLI reach no `live-provider`, `live-judge-model`, `calibrate-live`, `run-live`, `scenarios/config.ts`, `@ai-sdk/*` value import or runtime `vitest`; `run-live.ts` is the only entry that reaches `live-provider` and `live-judge-model` (assert it does).
- All tests offline with `ScriptedAiProvider` / fake judges and `langwatch.apiKey: ''`; log prefix `[suite]`.

**Never:**
- No live model call, network, or run of `suite:run:live --live-model`; no committed `baselines/**`, `calibration/**` or P-case content; no CI workflow changes.
- No change to `packages/application`, `apps/*`, `agent-service`, `ScenarioRunReport`, `gate.config.json`, `run-gate.ts`, the fingerprint (AD-8) or L0 report output.
- No budgets, coach call counting or L1 baseline (13.5); no meaning judging over `window.outbound` (evaluate keeps `judge-unsupported:observation-window`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Atomic happy | seed + one turn, scripted provider | one step, reply attributed by traceId, `reply.text` observed, AI events with `model` info | none |
| Journey gaps | 3 steps, `advanceClock` on 2 | `gapMs` 0, 60000+adv, 60000 | none |
| Stop checkpoint | rule FAIL at step 1, `onFail: stop` | `stoppedAtStep: 1`, step 2 not sent | none |
| Turn throws | provider throws at step 1 | `ERROR` product `agent-turn-error`, no step 2 | no retry |
| Silence | no outbound under trace | `reply: null`, `turn.outcome` set | evaluated, not ERROR |
| pulseCycle ok | open topic `autonomy` | precondition satisfied; `questionProgress` over the group | none |
| pulseCycle false | fixture test closes the topic in the raw fake (all its questions confirmed) after apply, then calls verify | `satisfied: false`; in a run, `INVALID precondition:pulseCycle` | none |
| pulseCycle + confirmationState | both in setup | `fixture-apply:pulseCycle` | infra retry once |
| Survey evidence | pulseCycle, orchestrator enqueues evidence, scripted evaluation | `surveyEvidenceCount` after > before | none |
| State criterion L1 | `evaluatedAt: state` | `method: substituted`; change kind paired with effect-count | none |
| P-06 L1 | `proactiveUsers`, window | `window.outbound` filled by check-in on injected provider | none |
| LangWatch | apiKey passed vs `''` | same `CaseRun`; key reaches `runScenario` cfg | none |
| Default CLI L1 | `suite:run --level L1` | refuses with the live-entry message | exit 1, nothing written |
| Live entry no flag | `run-live.ts run ...` | refusal, no provider or model built | exit 1 |

</intent-contract>

## Code Map

- `packages/conversation-sim/src/suite/executors/l0-deterministic-executor.ts` -- template: `run()` flow (fixtures ~140-175, observation ~180-215, step loop ~217-270), `fixtureRefs`, `fixtureContext`, `createL0World`, `observeStep`, `replyMessage`, `turnTrace`, `clockRange`, `rulePrecondition`, `runRule`, `executionError`; move shared pure helpers to a shared module, L0 behavior unchanged.
- `packages/conversation-sim/src/suite/executors/types.ts` -- `SuiteExecutor`, `ExecutorOptions`, `SuiteExecutionError`; add `coachModel?`.
- `packages/conversation-sim/src/suite/executors/recording-proxy.ts` -- `record(port, label, sink)`; add an optional model-info argument that fills `RunEvent.model` (schema.ts ~501-518).
- `packages/conversation-sim/src/suite/executors/proactive-l0.ts` -- `driveObservationWindow`, `ObservationPorts`; reuse at L1.
- `packages/conversation-sim/src/suite/executors/state-queries-l0.ts` -- L0 table and `afterStepsNamed` (reuse).
- `packages/conversation-sim/src/suite/fixtures/{index,types,confirmation-state,disclosure-delivered,seeded-history}.ts` -- registry, `FixtureContext`, window seeding pattern (`seedWindow`), disclosure verify.
- `packages/conversation-sim/src/fakes/question-confirmation.ts` -- `seedWindow`, `findCycleProgress`, `questionProgress()` (add a group filter), `stagedBundleCount()`.
- `packages/conversation-sim/src/fakes/inline-outbox.ts` -- `enqueueSurveyEvidence` no-op (~71); add the optional runner.
- `packages/conversation-sim/src/harness/coach-harness.ts` -- options `surveyRepo`, `pulseBacklogService`, `questionConfirmationRepo`, `clock`; `sendTurn` returns `{ result, traceId, inboundMessageId }`. No change expected.
- `packages/conversation-sim/src/harness/coach-agent.ts`, `src/scenarios/pulse-capture-exact-message.sim.test.ts` (~70-78) -- Scenario `run()` usage with `langwatch: { apiKey: '' }`; `ScriptStep = (state, executor) => ...`, `executor.succeed()` in `node_modules/@langwatch/scenario/dist/index.d.ts` (~763-834).
- `packages/application` exports (read-only): `SurveyRepositoryPort` (`ports/survey.repository.port.ts` ~172-221), `SurveyEvidenceExtractionUseCase(ai, conversationRepo, surveyRepo)` (v1 mode without `questionCapture` writes `saveEvidence`), `predictCycleProgress`, `PulseBacklogService.getNextProbeQuestion` shape `{ question: SurveyQuestionRecord, windowId, focus } | null`, `SurveyQuestionRecord`/`SurveyWindowRecord`/`SurveyEvidenceRecord` (`types/records.ts` ~149-210). Full record literal example: `src/scenarios/topic-steering.sim.test.ts` ~14-22.
- `packages/conversation-sim/src/suite/evaluate.ts` -- `base.method: 'n/a'` (~231).
- `packages/conversation-sim/src/suite/runner.ts` -- `models: { coach: null, ... }` (~196).
- `packages/conversation-sim/src/suite/cli.ts` -- `defaultDeps().createExecutor` (~310), `unsupportedLevel` (~740), `HELP` (~100), `CliDeps.createRunJudge` doc (~83).
- `packages/conversation-sim/src/suite/judge/calibrate-live.ts` (+ test) -- the gated-entry pattern to copy; `judge/criterion-judge.ts` `createCriterionJudge`; `judge/live-judge-model.ts`; `harness/live-provider.ts`.
- `packages/conversation-sim/src/suite/executors/import-graph.test.ts` -- `forbiddenImports`, entries list.
- Tests to update: `cli.test.ts` ~233 (L1 message), `runner.test.ts` (`models.coach`), `evaluate.test.ts` (method), `__fixtures__/runner.ts`.
- `packages/conversation-sim/package.json`, `README.md`.

## Tasks & Acceptance

**Execution:**
- `src/fakes/survey-repository.ts` (new) -- in-memory survey port, evidence count, pulse backlog -- L1 survey state.
- `src/fakes/inline-outbox.ts`, `src/fakes/question-confirmation.ts` -- optional inline survey-evidence runner; `questionProgress(group?)` -- additive.
- `src/suite/executors/recording-proxy.ts` -- optional model info on events -- AD-17 model requests/responses.
- `src/suite/executors/<shared>.ts` (new) + `l0-deterministic-executor.ts` -- extract shared helpers -- one step/observation code path.
- `src/suite/fixtures/pulse-cycle.ts` (new), `fixtures/types.ts`, `fixtures/index.ts` (`L1_FIXTURES`) -- pulseCycle -- AD-4.
- `src/suite/fixtures/state-queries.ts` (new) -- L1 table and snapshot -- AD-10.
- `src/suite/executors/l1-orchestrator-executor.ts` (new), `executors/types.ts` -- the executor -- AD-4/14/16/17.
- `src/suite/evaluate.ts`, `src/suite/runner.ts` -- `substituted`, `models.coach`.
- `src/suite/cli.ts`, `src/suite/run-live.ts` (new), `package.json` (`suite:run:live`), `README.md` -- refusal text, gated live entry, docs.
- Tests: `executors/l1-orchestrator-executor.test.ts` (every matrix row except CLI ones, scripted provider, real Scenario `run()` offline plus a `runScenario` spy for the LangWatch row and cfg shape), `fixtures/pulse-cycle.test.ts` (params refine, apply/verify, conflict), `fixtures/state-queries.test.ts`, `fakes` survey repo test, `recording-proxy.test.ts` (model info), `evaluate.test.ts` (method L0 vs L1), `runner.test.ts` (`models.coach`, an L1 run end-to-end with the L1 executor and a fake judge), `cli.test.ts` (L1 refusal text), `run-live.test.ts` (refusal, `run`-only, wiring with stubbed factories, no model built), `import-graph.test.ts` (new entries).

**Acceptance Criteria:**
- Given an injected L1 executor with a `ScriptedAiProvider` factory and a fake judge, when `main(['run', '--suite', 'x-suite', '--level', 'L1'])` runs, then `report.json` has `level: 'L1'`, `models.coach` equal to the injected label, meaning criteria judged on the attributed replies, state criteria with `method: substituted`, and `case-runs.json` events carrying AI `model` records.
- Given the default entry, when `suite:run --suite smoke-v1 --level L0` runs, then the output is unchanged; with `--level L1` it refuses with the live-entry message, writes nothing and builds no provider.
- Given `run-live.ts` without `--live-model`, when invoked, then it exits 1 and constructs neither a provider nor a judge model.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 35 findings — high 0, medium 8, low 22, false 3, maybe-false 2
- findings:
  - `[medium]` `[patch]` (blind) `liveCoachModel` labels every AI call `openai:gpt-4o` although OpenAiProvider uses gpt-4o-mini for analysis — label now `openai:analysis=gpt-4o-mini,generation=gpt-4o`.
  - `[low]` `[patch]` (blind) Label and provider read `OPENAI_MODEL_BALANCED` differently (trim, `||`) — label now uses the provider's exact `?? 'gpt-4o'` expression; empty-value test added.
  - `[medium]` `[patch]` (blind) Scenario ending the script early without throwing silently drops steps — post-run completeness check pushes infrastructure `scenario-incomplete`; test with a truncating stub.
  - `[low]` `[reject]` (blind) A non-`SuiteExecutionError` thrown inside a script step aborts the whole suite — same contract as L0 (`run()` rethrows unknown errors so executor bugs surface loudly); rule and state-query failures are already `SuiteExecutionError`s.
  - `[false]` `[reject]` (blind) The forced exit in `run-live.ts` can cut off the LangWatch upload — Scenario `run()` awaits `eventBus.drain()` in its `finally` before returning; the exit timer starts only after every run and report is written.
  - `[low]` `[reject]` (blind) `LANGWATCH_API_KEY` streams without a separate gate and `apiKey: ''` network silence is unverified — AD-16 makes the key the opt-in; offline tests now clear the env (see the edge-case row) and pass with no network.
  - `[low]` `[reject]` (blind) `substituted` keys on `evaluatedAt: 'state'` rather than on state rules — the spec defines dashboard-origin criteria as `state` criteria (AD-10 rows); widening it changes the method contract.
  - `[low]` `[reject]` (blind) `pulseCycle` seeds the survey window through the raw fake, leaving no step-0 event — `seedWindow` is a fixture helper, not a port method, and `confirmationState` seeds its window the same way.
  - `[low]` `[reject]` (blind) `pulseCycle` params accept duplicate ids/topics; `pulseCycle` + `freshPersona` fails only at run time — case-author mistakes caught by review; more refine branches for an unlikely input.
  - `[false]` `[reject]` (blind) `InMemorySurveyRepository.seedWindow` keeps prior evidence and assessments on re-seed — every test attempt builds a fresh repository and `pulseCycle.apply` refuses an already seeded window, so a re-seed never happens.
  - `[low]` `[reject]` (blind) The fake topic backlog ignores cooldown, probes and thresholds — a recorded substitution (Design Notes), labeled `substituted`.
  - `[low]` `[patch]` (blind) `plain()` turns non-serialisable model records into `[object Object]` — now `{ unserializable: <summary> }`; circular test added. Size cap rejected: the AC asks for untruncated requests and responses in the local run folder.
  - `[low]` `[patch]` (blind) The outbox `backfill` branch is untested — test added.
  - `[low]` `[reject]` (blind) The passive User-role adapter deviates from the spec's `agents: [coachAgent]` — Scenario 0.4.15 requires a User-role agent for fixed `user(text)`; the adapter never generates text (no simulator), the deviation is recorded in agent-failures.md and the Auto Run Result; the fix would be a spec edit.
  - `[medium]` `[patch]` (edge) A throwing inline survey-evidence extraction turns a persisted reply into `agent-turn-error` — the outbox now catches and records it in `surveyEvidenceFailures`, mirroring the worker's isolation; test added.
  - `[low]` `[reject]` (edge) `--live-model` without credentials fails every test with a product error — no egress or cost; the report names the missing variable; an extra guard adds a branch for a human-run path.
  - `[maybe-false]` `[defer]` (edge) A stalled live coach call has no timeout — unverified whether the provider bounds requests; deferred to 13.5 budgets (frontmatter `deferred`).
  - `[medium]` `[patch]` (edge) Scenario tracing reads `LANGWATCH_API_KEY` from `process.env`, so offline tests in a keyed shell could export spans — `withoutLangwatchEnv()` clears and restores both variables for every offline L1 test; a test asserts they are unset when `runScenario` is called.
  - `[maybe-false]` `[reject]` (edge) The fake backlog ignores V2 confirmations mid-journey — production `PulseBacklogService` also reads survey assessments, not question-confirmation state, and the orchestrator gates topic questions on cycle progress; if true it would only be low.
  - `[low]` `[patch]` (edge) Label vs provider `OPENAI_MODEL_BALANCED` mismatch — same fix as the blind row.
  - `[low]` `[patch]` (edge) Circular or BigInt model records lost silently — same fix as the blind `plain()` row.
  - `[low]` `[reject]` (edge) A rejected first dynamic import of Scenario stays cached — an import failure is deterministic (resolution or syntax), so retrying cannot succeed.
  - `[medium]` `[patch]` (edge, claim) Every AI event is stamped `openai:gpt-4o` while analysis calls use gpt-4o-mini — same fix as the blind label row.
  - `[medium]` `[patch]` (verification-gap) L1 in-script error paths (fatal rethrow, checkpoint error, state-query) have no L1 test — four tests added (`rule-error:state-equals`, `checkpoint-not-observable:proactive-initiated`, `state-query:stagedBundleCount` at before and in-script).
  - `[medium]` `[patch]` (verification-gap) The plain-Node Scenario fix is not exercised by the cited regression check — plain-Node spawn of `__fixtures__/l1-plain-node-probe.ts` (one scripted L1 case through real Scenario `run()`), agent-failures regression line corrected.
  - `[medium]` `[patch]` (verification-gap, other) Ignored Scenario result can truncate steps silently — same fix as the blind completeness row.
  - `[low]` `[reject]` (verification-gap, other) The reviewer could not run a plain-Node probe — no defect claimed; the added spawn test now runs it.
  - `[false]` `[reject]` (intent) The keyed LangWatch streaming path is not exercised — the user decision forbids network and live runs; the CaseRun equality is structural (built from harness, sink and clock).
  - `[low]` `[patch]` (intent) The coach label is computed apart from the provider — same fix as the blind label row.
  - `[low]` `[reject]` (intent) `model.settings` is always `{}` — the provider's decoding is internal to OpenAiProvider and not observable through `AiProviderPort`; the label names the models; settings can be filled when 13.5 counts usage.
  - `[low]` `[reject]` (intent) The extra User-role adapter differs from the AC/spec letter — as the blind adapter row.
  - `[low]` `[reject]` (intent) `setId` is suite-derived, not the constant `entalent-suite-p-v1` — follows the AD-14 rule `entalent-suite-<suiteId>` and the user's p-v1/smoke-v1 decision.
  - `[low]` `[reject]` (intent) P-06 C4/C5 run only on a scripted provider — the user decision forbids live calls; the live path is the same injected provider seam.
  - `[low]` `[patch]` (intent) No L1 test for a false `disclosureDelivered` verify — test added (`INVALID precondition:disclosureDelivered`).
  - `[low]` `[reject]` (intent) The diff builds the live entry instead of deferring it — the intent asks for the gated entry now.

## Design Notes

L1 survey evidence runs the real `SurveyEvidenceExtractionUseCase` without a `questionCapture` port, so it takes the v1 path (`saveEvidence`); production V2 windows capture non-numeric questions through `captureMeaning` instead. `surveyEvidenceCount` therefore counts saved evidence rows, a substitution labeled `substituted`; Epic 14 observes the real path. `pulseBacklog()` is a minimal stand-in for `PulseBacklogService` (first open question of the first uncovered topic) because the real service needs the pulse-backlog repository the harness does not have.

`CaseRun` never reads the Scenario result: Scenario is only the driver and the optional LangWatch stream (AD-16), which makes the "identical with or without a key" property structural.

## Verification

**Commands:**
- `pnpm --filter @entalent/conversation-sim test` -- expected: pass offline.
- `pnpm --filter @entalent/conversation-sim typecheck` and `pnpm --filter @entalent/conversation-sim lint` -- expected: no errors.
- `pnpm --filter @entalent/conversation-sim suite:run --suite smoke-v1 --level L0` -- expected: exit 0, unchanged output.
- `pnpm --filter @entalent/conversation-sim suite:run --suite smoke-v1 --level L1` -- expected: exit 1 with the live-entry message, nothing written.
- `pnpm --filter @entalent/conversation-sim suite:run:live --suite smoke-v1 --level L1` (no flag) -- expected: exit 1 refusal, no model built.
- `pnpm typecheck` -- expected: no errors.
- `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` -- expected: passing receipt.

## Auto Run Result

**Summary:** L1 executor for the suite. `L1OrchestratorExecutor` runs each test (fresh world per attempt) through the real `ConversationOrchestrator` with an injected coach `AiProviderPort` and coach model label, in-memory repositories (new `InMemorySurveyRepository` with a minimal pulse backlog), inline `SurveyEvidenceExtractionUseCase` (failures isolated from the reply), every port recorded and AI events carrying untruncated model requests and responses. Conversation tests are driven by one Scenario `run()` (`setId: entalent-suite-<suiteId>`, `user()`/`agent()` steps, `succeed()`, a passive User-role adapter, no simulator or judge agent); replies are attributed by traceId and the `CaseRun` never reads the Scenario result; early truncation is `scenario-incomplete`. P-06 drives `ProactiveCheckInUseCase` on the injected provider. `pulseCycle` fixture (L1 only), L1 state-query table (`questionProgress(group)`, `stagedBundleCount`, `surveyEvidenceCount`, `outboundCount`), `method: 'substituted'` for L1 state criteria, `models.coach` from the executor. The default `suite:run` still refuses L1 (message points to the live entry); `suite:run:live` (`run-live.ts`) refuses without `--live-model` and is the only module reaching `live-provider` and `live-judge-model`. No live model call was made.

**Files changed** (under `packages/conversation-sim/` unless noted):
- `src/suite/executors/l1-orchestrator-executor.ts` (new) -- the L1 executor.
- `src/suite/executors/shared.ts` (new), `l0-deterministic-executor.ts` -- shared step/fixture helpers; L0 behavior unchanged.
- `src/suite/executors/recording-proxy.ts`, `types.ts` -- model records on events, unserialisable marker; `suiteId`, `coachModel`.
- `src/fakes/survey-repository.ts` (new), `src/fakes/inline-outbox.ts`, `src/fakes/question-confirmation.ts` -- survey fake, inline survey evidence, group progress.
- `src/suite/fixtures/pulse-cycle.ts` (new), `state-queries.ts` (new), `index.ts`, `types.ts`, `fresh-persona.ts` -- pulseCycle, L1 table, survey context.
- `src/suite/evaluate.ts`, `src/suite/runner.ts` -- `substituted`, `models.coach`, `suiteId`.
- `src/suite/cli.ts`, `src/suite/run-live.ts` (new), `package.json`, root `package.json` -- refusal text, help, gated live entry and scripts.
- Tests: `l1-orchestrator-executor.test.ts`, `pulse-cycle.test.ts`, `state-queries.test.ts`, `survey-repository-fake.test.ts`, `inline-outbox-survey.test.ts`, `run-live.test.ts`, `__fixtures__/offline-scenario-env.ts`, `__fixtures__/l1-plain-node-probe.ts` (new); `recording-proxy`, `evaluate`, `runner`, `cli`, `import-graph` tests updated.
- `README.md`; `docs/agent-task-log.md`, `docs/agent-failures.md` (repo root).

**Review:** 35 findings (high 0, medium 8, low 22, false 3, maybe-false 2). Patched entries: 9 (medium 6: coach label tiers/resolver, scenario completeness check, survey-evidence isolation, LangWatch env cleared in offline tests, L1 in-script error tests, plain-Node probe; low 3: unserialisable marker, backfill test, disclosureDelivered INVALID test). Deferred 1: live coach call timeout (maybe-false, to 13.5). Rejected: non-SuiteExecutionError rethrow (L0 parity); forced exit cutting LangWatch (false: drain awaited); LangWatch opt-in by key (AD-16); substituted keyed on state criteria (spec); pulseCycle raw seeding (same as confirmationState); params duplicates; seedWindow carry-over (false: fresh world); simplified backlog (Design Notes); passive User-role adapter (Scenario 0.4.15 requirement, recorded); missing-credential guard; backlog vs V2 closure (maybe-false, low); cached import rejection; reviewer probe note; keyed LangWatch untested (false: user decision); settings `{}` (not observable through the port); suite-derived setId (AD-14); scripted-only P-06 (user decision); live entry built now (intent).

**Deviation from spec:** Scenario 0.4.15 needs a User-role adapter for fixed `user(text)`, so `agents` is `[passive user adapter, coachAgent]` (it throws if asked to generate; no simulator). Scenario is loaded with a dynamic import because its CommonJS build crashes under plain Node with tsx. Spine owner should confirm the adapter.

**Follow-up review recommended:** true -- six medium entries were patched on this first pass; the unverified risk is the in-script control flow of `driveConversation` (fatal rethrow, `scenario-incomplete`, checkpoint `succeed()` early exits) against Scenario 0.4.15 turn accounting, which is pinned only by offline scripted tests.

**Verification:** `pnpm --filter @entalent/conversation-sim test` 53 files / 899 tests pass offline (scripted providers and fake judges only); package typecheck and lint clean; root `pnpm typecheck` clean; plain-env `suite:run --suite smoke-v1 --level L0` exit 0; `--level L1` exit 1 with the live-entry message and nothing written; `run-live.ts run --suite smoke-v1 --level L1` without `--live-model` exit 1; `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` passed, receipt `runs/harness/receipt-1792962389345-462bd05d.json`. `suite:run:live --live-model` was never run.

**Residual risks:** the live path (real provider, judge, LangWatch key) is untested by design; `run-live.ts` forces exit one second after completion because Scenario leaves a five-minute timer; survey evidence uses the v1 `saveEvidence` path and a minimal backlog (substitutions); coach call counting, budgets, per-call timeouts and the first L1 baseline are 13.5.

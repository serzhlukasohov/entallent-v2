---
title: 'Story 12.7: L0 Deterministic Executor and Fixtures'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: 'c15e6e547dd8a97606f0c1aa8d1a0e9247cc4fb1'
route: 'dispatch'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-conversation-eval-regression-2026-10-17/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/specs/spec-conversation-eval-regression/case-mapping.md'
warnings: ['oversized', 'multiple-goals']
deferred:
  - summary: >-
      Real P-suite cases do not yet run offline in the PR gate; the executor is proven on synthetic tests only.
    evidence: |-
      Intent Alignment (Story 12.7). Needs 12.4 cases, the 12.8 runner and the 12.10 CI job.
    severity: medium
  - summary: >-
      `harness/report.ts` imports `vitest` at module load, so `CoachHarness` cannot load under tsx outside Vitest; `suite:run` (12.8) is blocked until that import is lazy.
    evidence: |-
      Implementer probe and Blind Hunter (Story 12.7); logged in docs/agent-failures.md.
    location: >-
      packages/conversation-sim/src/harness/report.ts:3
    severity: medium
  - summary: >-
      The in-memory question-confirmation fake has no contract test against the PostgreSQL repository's semantics.
    evidence: |-
      Blind Hunter (Story 12.7). A shared port contract test would catch drift once P-09/P-10 L0 cases exist.
    location: >-
      packages/conversation-sim/src/fakes/question-confirmation.ts
    severity: medium (unverified)
  - summary: >-
      `disclosureDelivered` seeds a copied disclosure version literal; the product constant is not exported.
    evidence: |-
      Blind Hunter (Story 12.7). Settle when P-07/P-09/P-10 cases run.
    location: >-
      packages/conversation-sim/src/suite/fixtures/disclosure-delivered.ts
    severity: medium (unverified)
---

<frozen-after-approval reason="human-owned intent (epics.md Story 12.7 AC) — do not modify unless human renegotiates">

## Intent

**Problem:** The P-suite cannot run offline, so rule-based and time-based criteria are not checked on every pull request.

**Approach:** An L0 `SuiteExecutor` runs atomic, journey and observation tests on `CoachHarness` with a scripted model and a controlled clock, records every port call as `RunEvent`s through a recording proxy, applies named fixtures with `{ apply, verify }`, and drives P-06 through `ProactiveSchedulerUseCase` and `ProactiveCheckInUseCase` over in-memory fakes.

## Boundaries & Constraints

**Always:**
- `src/suite/executors/l0-deterministic-executor.ts` implements `SuiteExecutor` with `level: 'L0'`; a fresh `CoachHarness` per test with `aiProvider: ScriptedAiProvider` fed by the test's `scripted` outputs and a `FixedClock` / `AdvancingClock`.
- Journeys: advance the clock by `interMessageGapMs` plus `advanceClock` before each step after the first and record `gapMs`; attribute the reply by the orchestrator result with 1-based `index`; `reply: null` with `turn.outcome` on silence; evaluate a `stop` checkpoint inline with the pure rule and record `stoppedAtStep`.
- Atomic: apply `seededHistory`, realize the gap from the last `SeedTurn.atOffsetMs`, send the single turn.
- `observed` includes `events`; `supports()` is true for `clock`, `seededHistory`, `confirmationState`, `freshPersona`, `pendingBotQuestion`, `disclosureDelivered`, `proactiveUsers`; `pulseCycle` is reported unsupported.
- `src/suite/executors/recording-proxy.ts` wraps every port the executor passes in (scripted AI, conversation, memory, goal and style repositories, outbox, scheduler-facing ports); `CoachHarness` is extended to accept these injected, defaulting to its current in-memory implementations; `CaseRun.events` holds one `RunEvent` per call in order, `stepIndex` 0 for fixtures and seed; product code is unchanged.
- P-06 (`observation`): seed users with timezones from `proactiveUsers`, advance the clock across the window at `scanEveryMs`, drive `ProactiveSchedulerUseCase` through an in-memory `ProactiveSchedulerRepositoryPort` fake that returns cadence facts from the recorded messages, drive `ProactiveCheckInUseCase` with the scripted model, fill `window.outbound` with bot-initiated messages carrying `occurredAt`.
- Fixtures in `src/suite/fixtures/` return `{ apply, verify }`; an `apply` failure ends the case `ERROR` reason `fixture-apply:<name>`; a false `verify` yields `INVALID` reason `precondition:<name>`.
- A colocated import-graph test fails if the executor's static imports reach `scenarios/config.ts` or `OpenAiProvider`; `clock-leak` passes on every L0 run.

**Never:**
- Change product behavior (`packages/application`, `apps/*`).
- Make model calls or read model credentials at L0.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Journey gap | 3 steps, `interMessageGapMs` 60000, step 3 `advanceClock` 300000 | `gapMs` 0 / 60000 / 360000; each reply `occurredAt` at the advanced clock | N/A |
| Atomic gap | seed last `atOffsetMs` 120000 | turn sent 120000 ms after the last seed turn; `gapMs` 120000 | N/A |
| Stop checkpoint | checkpoint after step 1 FAILs with `onFail: 'stop'` | steps 2..n not sent; `stoppedAtStep` 1 | N/A |
| Unsupported fixture | test `setup` lists `pulseCycle` | no turn sent; error reason `unsupported-fixture:pulseCycle` | NOT_RUN via evaluate |
| Fixture apply throws | a fixture's `apply` throws | case ends; error `fixture-apply:<name>` at step 0 | ERROR via evaluate |
| Verify false | a fixture's `verify` returns false | `preconditions` has `{ source: 'fixture', name, satisfied: false }` | INVALID `precondition:<name>` |
| Events | one atomic turn | `events` holds the seed writes at `stepIndex` 0 and the turn's calls at `stepIndex` 1, in call order | N/A |
| P-06 window | 7-day window, `scanEveryMs` 1 h, one user | `window.outbound` holds only in-window `proactive_check_in` messages with `metadata.messageType` | N/A |
| Missing scripted output | a step has no `scripted` entry the model call needs | the case fails loudly, not with a default reply | ERROR `scripted-output-missing:<step>` |

</frozen-after-approval>

## Code Map

- `packages/conversation-sim/src/harness/coach-harness.ts` -- `CoachHarnessOptions` (57-81) builds repos, outbox and `RecordingAiProvider(options.aiProvider ?? createLiveProvider())` internally (135-202); `send(text)` (209-243) returns only `responseText`. Line 43 statically imports `OpenAiProvider` for `createLiveProvider` (372-388).
- `packages/conversation-sim/src/fakes/repositories.ts:101-118` -- `InMemoryConversationRepository.saveMessage` drops `traceId` and `messageType`; module-global `sequence` ids (24-25).
- `packages/conversation-sim/src/fakes/inline-outbox.ts` -- builds memory-extraction / style use cases from the repos it is given; survey evidence is a no-op.
- `packages/conversation-sim/src/fakes/scripted-ai.ts` -- `ScriptedAiOptions` entries are values or `(input, callIndex) => value`; `generateResponse` falls back to `"${mode}: noted"`; bundle/clarification methods are hardcoded.
- `packages/conversation-sim/src/suite/schema.ts` -- `FixtureNameSchema` 27-37, `SeedTurn` 193-218, `ScriptedStep` 222-234, steps/checkpoint 316-331, `observationWindow` 333-336, `ExecutionError` 529-538, `PreconditionResult` 519-527, `RunEvent` 500-517, `CaseRun` 540-588, `STATE_QUERY_VALUE_SCHEMAS` 64-69.
- `packages/conversation-sim/src/suite/evaluate.ts` -- consumes `errors` (ERROR at `step <= criterionStep`, 174; `unsupported-fixture:` prefix → NOT_RUN, 178, 205-207) and builds `precondition:${name}` itself (164-165).
- `packages/conversation-sim/src/suite/rules/registry.ts` (`RULES`), `rules/effect-count.ts` (port label contract), `rules/clock-leak.ts`, `rules/proactive.ts` (`messageType` contract; `initiations` does not filter by window).
- `packages/conversation-sim/src/suite/isolation.test.ts` -- textual import-scan pattern to extend transitively.
- `packages/application/src/use-cases/proactive-scheduler.use-case.ts`, `policies/check-in-cadence.ts`, `ports/proactive-scheduler.repository.port.ts` (12.6), `use-cases/proactive-check-in.use-case.ts` (~224 writes `messageType: 'proactive_check_in'`). Read only.
- `packages/application/src/ports/question-confirmation.port.ts` -- port for the stateful `confirmationState` fake.

## Tasks & Acceptance

**Execution:**
- [x] `harness/live-provider.ts` + `harness/coach-harness.ts` -- move `createLiveProvider` (and the `OpenAiProvider` import) to `live-provider.ts`; `CoachHarness` requires `aiProvider` only through options and live call sites (`*.sim.test.ts`, scripts) import `createLiveProvider`. Add optional injected `conversationRepo`, `memoryRepo`, `goalRepo`, `styleRepo`, `outbox`, `questionConfirmationRepo` defaulting to today's; add `sendTurn(text)` returning `{ result, traceId, inboundMessageId }` (keep `send`).
- [x] `fakes/repositories.ts` -- store `traceId` and `messageType` on saved messages (side fields readable by the executor; `MessageRecord` type unchanged); per-instance id sequence.
- [x] `fakes/question-confirmation.ts` -- stateful in-memory `QuestionConfirmationPort` (staged bundles, applied verdicts, pending clarification) with `stagedBundleCount()` and `questionProgress()`.
- [x] `suite/executors/types.ts` -- `SuiteExecutor { level; supports(name); observes(); run(test, options): Promise<CaseRun> }`, `ExecutorOptions { attempt; interMessageGapMs; clockStart?: Date }`, `SuiteExecutionError { kind: 'product' | 'infrastructure'; step; cause }`.
- [x] `suite/executors/clock.ts` -- `FixedClock` / `AdvancingClock` implementing `ClockPort` with `advance(ms)`.
- [x] `suite/executors/recording-proxy.ts` -- `record(port, label, sink)` wraps every method; one `RunEvent` per call with the sink's current `stepIndex`, `seq`, `outcome`, short summaries; `durationMs` from the controlled clock (0 when it does not advance) so events are deterministic.
- [x] `suite/fixtures/*.ts` -- one module per fixture with a Zod params schema and `{ apply, verify }`: `clock`, `seededHistory` (writes `SeedTurn`s at `start − atOffsetMs`), `confirmationState`, `freshPersona`, `pendingBotQuestion`, `disclosureDelivered` (outbound with `reportingDisclosureVersion`, delivered), `proactiveUsers`; `index.ts` registry; `pulseCycle` absent.
- [x] `suite/executors/l0-scripted.ts` -- maps `ScriptedStep` to `ScriptedAiOptions` functions keyed by the current step; a needed but missing output throws `SuiteExecutionError` (`product`, reason `scripted-output-missing:<step>`).
- [x] `suite/executors/state-queries-l0.ts` -- L0 accessors: `outboundCount` (conversation fake), `stagedBundleCount` and `questionProgress` (question-confirmation fake); `surveyEvidenceCount` is not observed at L0. Read `before` after fixtures, `after` at the end, `afterStep[n]` for steps named by the test's state criteria; validate with `STATE_QUERY_VALUE_SCHEMAS`.
- [x] `suite/executors/proactive-l0.ts` -- in-memory scheduler repository fake (facts from recorded messages per 12.6 semantics) and a queue fake that runs `ProactiveCheckInUseCase` synchronously; drives P-06 per Design Notes.
- [x] `suite/executors/l0-deterministic-executor.ts` -- the executor per the frozen block and Design Notes; fills every `CaseRun` field, `clock { from, to }`, copies `messageType` into `metadata.messageType` for reply, unsolicited and window messages.
- [x] Tests -- `l0-deterministic-executor.test.ts` covers every matrix row with synthetic tests built in the test file (no p-v1 cases exist yet); each `CaseRun` parses with `CaseRunSchema` and `clock-leak` PASSes on it; `recording-proxy.test.ts`; one test per fixture; `executors/import-graph.test.ts` (transitive relative-import walk from the executor, skips `import type`, flags `scenarios/config.ts` and any value import of `OpenAiProvider` or `live-provider`); existing harness and sim tests still pass.

**Acceptance Criteria:**
- Given a journey, an atomic and an observation synthetic test, when the L0 executor runs them and `evaluate` scores the runs, then rule criteria are decided (not NOT_RUN for executor reasons) and every run passes `CaseRunSchema`.
- Given the executor module, when the import-graph test runs, then it passes, and it fails on a fixture file that imports `scenarios/config.ts`.
- Given `pnpm --filter @entalent/conversation-sim test`, when it runs, then all existing suites still pass.

## Implementation Notes

- Each L0 conversation step must script risk, classification, response and memory proposal; a missing one is ERROR `scripted-output-missing:<step>` even when product code would catch it.
- Observation scans and check-ins are recorded at `stepIndex` 0; the scheduler fake applies no SQL-style prefilter and treats the QA cohort as absent.
- Fixture params: `clock { start? }`, `pendingBotQuestion { text, atOffsetMs, messageType? }`, `disclosureDelivered { text, atOffsetMs > 0, version }`, `confirmationState { surveyWindowId, questions[], stagedBundle?, pendingClarification? }`, `proactiveUsers { timezone, quietHours, scan }`.
- Executor errors: `checkpoint-not-observable:<rule>`, `rule-error:<rule>`, `state-query:<name>`, `proactive-users-missing`, `agent-turn-error` (product); `run()` always returns a CaseRun.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 41 findings — high 0, medium 13, low 22, false 3, maybe-false 3
- findings:
  - `[medium]` `[defer]` (intent) real P-suite cases do not yet run offline in the PR gate — needs 12.4 cases and the 12.8 runner/CI (12.10); deferred-work.
  - `[low]` `[reject]` (intent) P-06 uses the scripted model's default check-in text — Design Notes decision; C4–C5 (text) are L1.
  - `[low]` `[patch]` (intent) `window.outbound` not filtered by message type — patched: proactive types only.
  - `[low]` `[reject]` (intent) `AdvancingClock` unused — a `FixedClock` with explicit `advance` realizes every gap deterministically.
  - `[low]` `[patch]` (intent) `clock-leak` not asserted on error runs — patched tests.
  - `[medium]` `[patch]` (intent) import guard skips package import forms — patched: namespace/default/export-star/dynamic imports of `@entalent/ai-openai` flagged.
  - `[false]` `[reject]` (intent) recording-proxy scope — wraps every port the executor passes in, as stated.
  - `[low]` `[reject]` (intent) `CoachHarness` surface reshaped (required `aiProvider`, `sendTurn`, ids) — every caller updated; `pnpm typecheck` and all sims pass.
  - `[low]` `[reject]` (intent) L0 observes no `reply.text` / `surveyEvidenceCount` — AD-14 and the outbox no-op, per Design Notes.
  - `[low]` `[reject]` (intent) P-06 C3 decided FAIL — the documented known red (12.3b).
  - `[medium]` `[patch]` (blind) atomic gap ignores fixture messages and seed order — patched: gap from the latest pre-start message.
  - `[low]` `[reject]` (blind) failed precondition does not short-circuit steps — evaluation already marks INVALID; short-circuit is an L1/L2 cost concern.
  - `[medium]` `[patch]` (blind) checkpoints: NOT_OBSERVABLE or unknown rule counts as pass — patched: `checkpoint-not-observable:<rule>` error and stop; `continue` checkpoints are read by `evaluate`'s own checkpoint logic.
  - `[medium]` `[patch]` (blind) observation without `proactiveUsers` runs silently — patched: `proactive-users-missing`.
  - `[false]` `[reject]` (blind) `proactive_check_in_request` treated as user activity — mirrors the worker SQL, whose silence and reply clauses count any inbound except `__init__`.
  - `[low]` `[patch]` (blind) `confirmationState` staging can fail its own verify — patched schema refinement.
  - `[medium]` `[patch]` (blind) question-confirmation fake verdicts untested; no contract check vs PostgreSQL — patched unit tests; contract test deferred.
  - `[medium]` `[patch]` (blind) import guard gaps — same as the intent row.
  - `[low]` `[patch]` (blind) 12.8 blocker (`harness/report.ts` imports vitest) only in the task log — added `docs/agent-failures.md` entry; fix belongs to 12.8.
  - `[low]` `[reject]` (blind) `CoachHarness` ignores options that conflict with injected ports — only the executor injects, and it passes consistent ports.
  - `[low]` `[patch]` (blind) `traceId` repeats after a throwing turn — patched: monotonic counter.
  - `[low]` `[reject]` (blind) fixture harness options merge silently — no two fixtures set the same option today.
  - `[maybe-false]` `[defer]` (blind) disclosure version literal duplicates an unexported product constant — exporting it is a product change; settle when P-07/P-09/P-10 cases run (12.4).
  - `[low]` `[reject]` (blind) P-06 unit test pins the known red — comment references it; the suite baseline (12.8) carries it too.
  - `[low]` `[reject]` (blind) `AdvancingClock` dead code — same as the intent row.
  - `[medium]` `[patch]` (edge) stop checkpoint NOT_OBSERVABLE passes — same as blind checkpoint row.
  - `[low]` `[patch]` (edge) rule `run()` throw rejects the run — patched: `rule-error:<rule>`.
  - `[low]` `[patch]` (edge) state-query parse failure rejects the run — patched: `state-query:<name>`.
  - `[medium]` `[patch]` (edge) atomic gap 0 after fixture messages — same as blind gap row.
  - `[medium]` `[patch]` (edge) observation without `proactiveUsers` — same as blind row.
  - `[false]` `[reject]` (edge) observation with steps / window on non-observation ignored — the schema rejects both at load (`schema.ts` 358-385).
  - `[low]` `[patch]` (edge) `quietHours.enabled` without hours accepted — patched refinement.
  - `[low]` `[patch]` (edge) quiet-hours test throws for the wrong reason — patched test.
  - `[low]` `[patch]` (edge) `confirmationState` staged statuses / group — same as blind row.
  - `[medium]` `[patch]` (edge) namespace/default import of `@entalent/ai-openai` passes — same as intent row.
  - `[low]` `[patch]` (edge) claim "flags any value import of OpenAiProvider" — same root.
  - `[maybe-false]` `[reject]` (edge) per-instance `msg-N` ids collide across harnesses sharing a fake — each run builds its own world; no sharing exists.
  - `[medium]` `[patch]` (verification) scheduler fake silence/contact facts untested — patched: seeded-inbound observation test and direct `facts()` test.
  - `[medium]` `[patch]` (verification) question-confirmation verdict paths untested — same as blind row.
  - `[low]` `[patch]` (verification) import guard — same as intent row.
  - `[maybe-false]` `[patch]` (verification) `__fixtures__/suite.ts` observation params invalid under the strict schema — patched params.

## Design Notes

**Observed fields at L0** (AD-14: L0 never evaluates scripted reply text): `reply.messages`, `turn.mode`, `turn.intent`, `turn.outcome`, `turn.bundleReply`, `steps.gapMs`, `state.outboundCount`, `state.stagedBundleCount`, `state.questionProgress`, `events`, and `window.outbound` for observation tests. Not `reply.text`, not `turn.replyPlan` (not on `OrchestrateResult`), not `state.surveyEvidenceCount` (outbox evidence is a no-op).

**`proactiveUsers` params carry every outcome-affecting input; no defaults.** `{ timezone: IANA, quietHours: { enabled, startHour?, endHour? }, scan: { minSilenceDays, minCheckInGapDays, quietHoursEnabled } }`, exactly one user in this story (multi-user deferred). The 12.4 case author sets them with QA; the executor invents nothing. The scripted model's default check-in text is acceptable (C4–C5 are L1).

**Fixture ownership.** The executor applies fixtures inside `run()` because they need the per-test harness; `verify()` runs before step 1. Fixture `apply` failures are `infrastructure`; `unsupported-fixture:` errors are `infrastructure` with step 0 (as `evaluate.test.ts` already uses). Rule `preconditions` are evaluated on a `CaseRun` snapshot after fixtures (no steps).

**Clock.** `clockStart` defaults to `2026-01-05T08:00:00Z`; `run.clock.from` is the earliest instant the run stamped (including seed), `to` the final `clock.now()`. Wall-clock leftovers in product (`MemoryExtractionUseCase.computeExpiry`) stay deferred: product code is out of scope here.

**Silence.** The current orchestrator always persists one outbound, so `reply: null` arises only when no outbound with the turn's `traceId` exists; the executor still handles it.

**Port labels** for `effect-count` equal the harness option names (`conversationRepo`, `questionConfirmationRepo`, ...) and real method names (e.g. `stageQuestionConfirmationBundle`).

## Verification

**Commands:**
- `pnpm --filter @entalent/conversation-sim test` -- expected: pass offline (no model credentials needed).
- `pnpm --filter @entalent/conversation-sim typecheck` and `lint` -- expected: no errors.
- `pnpm typecheck` -- expected: no errors (scripts and sims that used `createLiveProvider`).
- `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` -- expected: a passing receipt.

## Auto Run Result

**Summary:** An offline L0 `SuiteExecutor` (`suite/executors/l0-deterministic-executor.ts`) runs atomic, journey and observation tests on `CoachHarness` with a scripted model and a fixed, explicitly advanced clock; a recording proxy turns every injected port call into `RunEvent`s; seven fixtures (`clock`, `seededHistory`, `confirmationState`, `freshPersona`, `pendingBotQuestion`, `disclosureDelivered`, `proactiveUsers`) apply and verify the world; P-06 runs through `ProactiveSchedulerUseCase` (12.6 policy) and `ProactiveCheckInUseCase` over in-memory fakes. No product code changed.

**Files changed** (under `packages/conversation-sim/src/`): `harness/live-provider.ts` (new), `harness/coach-harness.ts` (injected ports, required `aiProvider`, `sendTurn`), `harness/coach-agent.ts`, `fakes/repositories.ts` (side fields, per-instance ids), `fakes/question-confirmation.ts` (new stateful fake), `suite/executors/*` (types, clock, recording proxy, scripted mapping, L0 state queries, proactive driver, executor, tests incl. import graph), `suite/fixtures/*` (seven fixtures, registry, tests), `suite/__fixtures__/suite.ts`, one live sim import.

**Review:** one pass, 41 findings: 12 patches (checkpoint NOT_OBSERVABLE stops with an error, rule and state-query errors become CaseRun errors, atomic gap from the latest pre-start message, monotonic traceId, `proactive-users-missing`, window filtered to proactive types, scheduler-fake and question-confirmation-fake tests, stricter fixture schemas, import guard for every `@entalent/ai-openai` import form, `clock-leak` on error runs, valid observation fixture params); 4 deferred; the rest rejected with reasons in the triage log.

**Follow-up review recommended: true** -- several medium entries were patched (checkpoint handling, atomic gap, observation guard, import guard) without another review pass over the patched code.

**Verification:** conversation-sim 32 files / 509 tests offline; `pnpm typecheck`, `pnpm lint` 24/24; `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` passed (receipt `runs/harness/receipt-1792925420043-662523f4.json`).

**Residual risks:** no real p-v1 cases yet (12.4 blocked), so the executor is proven on synthetic tests only; `harness/report.ts` imports vitest at load, which blocks the 12.8 CLI until made lazy.

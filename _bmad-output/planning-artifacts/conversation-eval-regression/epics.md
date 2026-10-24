---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
inputDocuments:
  - ../../specs/spec-conversation-eval-regression/SPEC.md
  - ../../specs/spec-conversation-eval-regression/brownfield.md
  - ../../specs/spec-conversation-eval-regression/case-mapping.md
  - ../../specs/spec-conversation-eval-regression/architecture-diagrams.md
  - ../architecture/architecture-conversation-eval-regression-2026-10-17/ARCHITECTURE-SPINE.md
  - ../sprint-change-proposal-2026-10-24.md
  - ../sprint-change-proposal-2026-10-24-b.md
---

# Conversation Evaluation Regression Framework - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the Conversation Evaluation Regression Framework, decomposing the spec (SPEC-conversation-eval-regression, CAP-1..CAP-12) and the architecture spine (AD-1..AD-18) into implementable stories. Epic numbering continues from the project's existing epics (1-11), so this feature starts at Epic 12. No PRD or UX contract exists for this work; the spec package is the requirements source. Amended on 2026-10-24 by `sprint-change-proposal-2026-10-24.md` (atomic tests, per-step event log, judge evidence and fingerprint, vacuous-pass guards) and by `sprint-change-proposal-2026-10-24-b.md` (source manifest, change versus invariant state criteria, mid-flow seeding, injectable harness, L0 scope, journeys outside the verdict).

## Requirements Inventory

### Functional Requirements

FR1: A suite test is a typed record of kind atomic (seeded state and history, one turn), journey (verbatim multi-step Confluence case) or observation, referencing a source case in the suite's source manifest (requirement, expected behavior, criteria with layer and verbatim pass condition, NOT TESTABLE reasons, state effects), with levels, setup fixtures, preconditions, steps with optional clock advance (and checkpoint in journeys), and a criteria table with layer, evaluated reply, verbatim pass condition, optional judge guidance and checks (rule, meaning or not-testable). (CAP-1, AD-1)

FR2: Loading a suite validates every test against the schema and rejects a test whose expected behavior has no criterion, whose criterion lacks layer, evaluatedAt or checks, or whose kind and steps are inconsistent; atomic tests with other than one step, without a seed, with a checkpoint or declaring L2; and conversation source cases whose testable criteria are not all covered by an atomic test (an observation source case is covered by its observation test). (CAP-1, AD-1)

FR3: Test and criterion ids are stable; criterion ids are the Confluence ids; results, baselines and diffs are keyed by suite, level, test and criterion; retired criteria remain as not-testable entries. (CAP-1, CAP-8, AD-2)

FR4: Every in-scope criterion of a run receives exactly one framework status: PASS, FAIL, NOT_TESTABLE, INVALID, ERROR or NOT_RUN, following the precedence and scope rules. (CAP-2, AD-9)

FR5: A run is scored per layer (P, D, C, S) with pass rate PASS/(PASS+FAIL) over non-advisory statuses, is COMPLETE or INCOMPLETE, counts atomic and observation tests only (journeys are reported and diffed separately), and receives the verdict ADEQUATE, ACCEPTABLE WITH ISSUES or NOT ADEQUATE with S as a hard gate and a provisional flag for incomplete runs. (CAP-2, AD-9)

FR6: Rule-based checks are named entries in a registry with declared observation requirements, returning PASS, FAIL or NOT_OBSERVABLE with evidence, deterministic for the same observations; legacy rules are wrapped, new rules keep their term lists as suite data. (CAP-3, AD-6, AD-17)

FR7: Meaning-based checks are decided by a per-criterion structured judge call on the reply named by evaluatedAt, with the transcript up to that reply, the expected behavior, the pass condition, the layer and fixture context; judge failures become per-criterion ERROR; the judge decides by meaning and returns evidence, and a PASS without a verbatim fragment of the evaluated reply is re-asked once, then ERROR. (CAP-4, AD-7)

FR8: Judge trust is measured by a calibration command against a self-contained human-labeled set, written to one agreement file, and computed once per run into a trust record; untrusted meaning statuses are advisory and excluded from pass rate and verdict, and every meaning-based FAIL is listed for QA review; trust is bound to a judge fingerprint of provider, model, decoding settings and prompt, schema and guidance hashes. (CAP-4, AD-8)

FR9: The L0 deterministic executor runs cases with a scripted model and a fixed or advancing clock, with no network, covering P-06 initiation, spacing and working-hours criteria and the time-dependent setups of P-01 and P-04, evaluating at L0 only rules over orchestrator-produced inputs (time, cadence, message metadata, state, events), never over reply text the test scripted. (CAP-5, AD-5, AD-14)

FR10: The L1 orchestrator executor runs cases through the existing harness with a live coach model, in-memory repositories, and fixtures for pulse cycle, pending bot question, fresh persona, delivered disclosure and proactive users; L1 scripts drive Scenario and end with succeed(). (CAP-6, AD-4, AD-14, AD-16)

FR11: The L2 application executor runs the same cases against the local API, worker, Postgres and Redis through /api/v1/dev endpoints with a fresh external user per case, deep reset, traceId-based reply attribution, 500 ms polling up to 60 s and a localhost-only base URL guard; L2 runs journey tests only. (CAP-7, AD-14)

FR12: State criteria are answered from one state-query table (questionProgress, stagedBundleCount, surveyEvidenceCount, outboundCount) with an L1 accessor and an L2 route each, and every result carries method observed or substituted. (CAP-6, CAP-7, CAP-10, AD-10)

FR13: Each executor declares the fixtures it supports and the observation fields it fills; an unsupported fixture yields NOT_RUN with reason and an INCOMPLETE run, never FAIL; fixture apply failures are ERROR and failed verifications are INVALID. (CAP-5..7, AD-4, AD-17)

FR14: Every run writes a versioned SuiteRunReport (JSON and Markdown) with run id, sample count, git sha, models, judge trust, per-criterion results with pass counts and samples, layer table, verdict, coverage table (CF requirement to source case to test to criterion), judge errors and token usage. (CAP-2, CAP-8, CAP-10, AD-11)

FR15: Baselines are committed per suite and level, carry judge and coach provenance, and change only through an accept command that refuses too few samples, incomplete runs, dirty trees or a judge pin mismatch. (CAP-8, AD-11)

FR16: A diff command classifies every criterion as regressed, fixed, unchanged, lost-coverage, gained-coverage, new, retired or inconclusive against the merge-base baseline, fails on regressed or lost-coverage S and rule criteria and on regressed non-advisory meaning criteria, and refuses when provenance differs. (CAP-8, AD-13)

FR17: The CLI exposes suite:run, suite:diff, suite:baseline:accept and suite:calibrate with the documented flags and distinct exit codes. (CAP-9, Conventions)

FR18: L0 runs on every PR in ci.yml without secrets; a PR workflow with change detection and an always-reporting job runs L1 with diff when gated paths change; the scheduled workflow runs L1 nightly (n=1) and weekly (n=5); a weekly L2 workflow runs with database and Redis services; all upload artifacts and write a step summary. (CAP-9, AD-15)

FR19: The report shows which EP1 requirement each case and criterion verifies and the reason for every NOT_TESTABLE criterion; the coverage table also lists judge-only criteria skipped at L0 and unobservable fields per level. (CAP-10, AD-6, AD-7)

FR20: With LANGWATCH_API_KEY set, L1 runs stream to LangWatch cloud under a suite set id; without it, results are identical locally. (CAP-11, AD-16)

FR21: P-01..P-10 exist as atomic tests covering every testable criterion, P-06 as an observation test, and the agreed smoke journeys verbatim, with the fixtures, levels, check types and NOT TESTABLE reasons given in case-mapping.md. (CAP-1, CAP-10)

FR22: The between-message gap and advanceClock are realized uniformly per level and recorded; atomic gaps come from seed offsets; checkpoints exist in journeys only, are rule-only and their failure marks dependent criteria INVALID; infrastructure errors retry once per case, product errors never. (CAP-2, CAP-5..7, AD-18)

FR23: L0 and L1 runs record an ordered event log per step (port, method, arguments summary, outcome, duration, model request and response) through recording proxies on the harness ports, written only to run artifacts. (CAP-12, AD-3, AD-17)

FR24: At L0 and L1, change-type state criteria are paired with a per-step effect check from the manifest's state effect; a change-type state criterion already satisfied before the step is INVALID; invariant state criteria are not; every rule has a synthetic fixture on which it must FAIL. (CAP-12, AD-6, AD-9, AD-10)

### NonFunctional Requirements

NFR1: TypeScript-only; retired MAF and agent-service untouched.

NFR2: LangWatch Scenario remains the only live-simulation driver; no Langfuse integration; LangWatch cloud never a dependency.

NFR3: Rule checks and their term lists live in the test framework; no lexical heuristic migrates into product code (ADR-013 D2); suite/ is importable by nothing outside conversation-sim.

NFR4: L0 and L1 need no Postgres or Redis; L0 needs no model credentials; the conversation-sim test script stays offline.

NFR5: L2 targets only the local docker stack through development-only /dev endpoints with NODE_ENV=test; never Railway production; no level reads SLACK_*.

NFR6: Suite user texts are sent verbatim through scripted steps (the full sequence in journeys; the seeded history and the single turn in atomic tests); the user simulator is not used.

NFR7: The judge is pinned per suite by fingerprint (provider, model, decoding, prompt, schema and guidance hashes); changing any part invalidates agreement and baselines; env overrides cannot silently change the evaluating model or its settings.

NFR8: Existing ScenarioRunReport, gate.config.json and run-gate.ts consumers keep working; suite artifacts are new, versioned types.

NFR9: Case data is canonical in the repository and versioned with the code it tests.

NFR10: Product-side changes are limited to those AD-12 authorizes: ClockPort injection, cadence policy extraction, additive read-only /dev GET fields, failure-kind extraction.

NFR11: Live runs are bounded by per-run coach and judge call budgets; exceeding a budget aborts remaining cases as ERROR with a provisional verdict.

NFR12: Time on the suite paths of product code enters only through ClockPort, enforced by a scoped ESLint rule and an L0 clock-leak check.

NFR13: Baseline changes are reviewable: merge-base comparison in CI, baseline-change label and QA CODEOWNERS review on baselines/**.

NFR14: Statuses, precedence and verdict thresholds match Framework v2.1.1 sections 5 and 6 and are quoted in code comments with the page version.

### Additional Requirements

- Brownfield, no starter template: all suite code lives under packages/conversation-sim/src/suite/ beside the existing harness, fakes, gate and scenarios (AD-12, Structural Seed).
- New ClockPort in packages/application/src/ports/clock.port.ts with SystemClock; last-parameter injection into ConversationOrchestrator, ProactiveSchedulerUseCase, ProactiveCheckInUseCase, FollowUpExecutionUseCase and quiet-hours; harness and fakes stamp persisted timestamps from the same clock (AD-5).
- Cadence policy extraction: silence, gap and QA-cadence predicates move from apps/worker/src/proactive/proactive-scheduler.repository.ts SQL into a pure checkInCadencePolicy in packages/application; the repository returns per-user facts (AD-5). Production behavior must not change; existing scheduler tests must be extended, not weakened.
- Additive read-only development endpoints in dev-simulate.controller.ts: metadata and jobStatus on messages, count on survey-state, a question-confirmation read (AD-10, AD-12).
- Extract isTransportFailureMessage and isTransportOnlyAgentFailure from gate/failure-classifier.ts into gate/failure-kind.ts; classifyFailure unchanged for run-gate.ts (AD-12, AD-18).
- zod ^3.25.76 added as a conversation-sim devDependency; judge uses ai generateText with Output.object and nullable schema fields (AD-7, Stack).
- suite.config.json carries suites, levels, judge pin and thresholds, interMessageGapMs, baseline and diff minSamples, budgets and l2.workerEnv; env SUITE_L2_API_BASE, SUITE_L2_TENANT_ID, ADMIN_API_KEY (Conventions).
- Three workflow changes: L0 job in ci.yml; new conversation-suite-l1-pr.yml with change detection and always-reporting job name; suite jobs added to conversation-sim.yml; new conversation-suite-l2.yml with pgvector/pgvector:pg16 and redis:7-alpine services, api with NODE_ENV=test, worker with proactive scheduling disabled (AD-14, AD-15).
- CODEOWNERS entry for packages/conversation-sim/baselines/** and the baseline-change label check (AD-13).
- Calibration import adapter from QA session exports to the self-contained label format; agreement.json written only by suite:calibrate (AD-8).
- Known expected reds at first run: P-06 working-hours criterion (quiet hours 22-08 vs suite 09-18), P-07/P-08/P-09 pending round-3 CAPs; the framework reports them, stories must not change product behavior to turn them green (spec Non-goals).
- Observation cases at L2, YAML authoring, other suites, Scenario 1.x upgrade and parallel execution are deferred (spine Deferred).

### UX Design Requirements

Not applicable: this feature has no user interface. Outputs are Markdown, JSON and CI step summaries.

### FR Coverage Map

FR1: Epic 12 - Test schema, source manifest and typed test records
FR2: Epic 12 - Loader validation and refinements
FR3: Epic 12 - Stable ids as result and baseline keys
FR4: Epic 12 - Status precedence and scope
FR5: Epic 12 - Layer scoring and verdict
FR6: Epic 12 - Rule registry with declared requirements
FR7: Epic 13 - Per-criterion structured judge
FR8: Epic 13 - Calibration, agreement file, JudgeTrust, QA review list
FR9: Epic 12 - L0 executor, clock fixtures, cadence policy
FR10: Epic 13 - L1 executor and live fixtures
FR11: Epic 14 - L2 executor and dev API client
FR12: Epic 13 (L1 accessors) and Epic 14 (L2 routes) - State-query table
FR13: Epic 12 - Executor port, fixture apply/verify, NOT_RUN and INVALID semantics
FR14: Epic 12 - SuiteRunReport JSON and Markdown
FR15: Epic 12 (accept command, provenance) and Epic 13 (sample minimums, judge pin checks) - Baselines
FR16: Epic 12 (categories, merge-base) and Epic 13 (inconclusive, meaning thresholds) - Diff
FR17: Epic 12 (run, diff, accept) and Epic 13 (calibrate) - CLI
FR18: Epic 12 (ci.yml L0), Epic 13 (L1 PR workflow, nightly, weekly), Epic 14 (L2 workflow) - CI
FR19: Epic 12 - Coverage table, NOT_TESTABLE reasons, judge-only and unobservable listings
FR20: Epic 13 - LangWatch streaming via Scenario set id
FR21: Epic 12 - P-01..P-10 atomic tests and smoke journeys
FR22: Epic 12 - Gap, advanceClock, checkpoints, retry semantics
FR23: Epic 12 (L0 recording proxies) and Epic 13 (L1 recording proxies) - Event log
FR24: Epic 12 (effect-count, already-satisfied, fail fixtures) and Epic 13 (L1 pairing) - Vacuous-pass guards

## Epic List

### Epic 12: Rule-Based Regression Gate on Every Pull Request (L0)
A developer opening any pull request gets a framework-scored P-suite verdict for every rule-based and time-based criterion, diffed against the committed baseline, in seconds and without model credentials. Includes the two authorized product changes (ClockPort and the cadence policy) because P-06 cannot be tested at L0 without them.
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR9, FR13, FR14, FR15, FR16, FR17 (run, diff, accept), FR18 (L0 job), FR19, FR21, FR22, FR23 (L0), FR24

### Epic 13: Calibrated Live Judging and the Prompt-Change Gate (L1)
QA and developers get meaning-based verdicts from a judge whose agreement with human labels is measured and reported; prompt and orchestrator changes are gated on a live L1 run against the merge-base baseline; nightly and weekly runs build the trend, optionally visible in LangWatch.
**FRs covered:** FR7, FR8, FR10, FR12 (L1 accessors), FR15 and FR16 (sample thresholds, inconclusive, judge provenance), FR17 (calibrate), FR18 (PR workflow, nightly, weekly), FR20, FR23 (L1), FR24 (L1 pairing)

### Epic 14: Full-Application Verification on the Real Path (L2)
QA sees the criteria the suite checks on the dashboard and in the database observed on the real API, queue, worker and Postgres path once a week and on demand, with persona isolation and reply attribution that survive an asynchronous worker.
**FRs covered:** FR11, FR12 (L2 routes and additive dev reads), FR18 (L2 workflow)

## Epic 12: Rule-Based Regression Gate on Every Pull Request (L0)

A developer opening any pull request gets a framework-scored P-suite verdict for every rule-based and time-based criterion, diffed against the committed baseline, in seconds and without model credentials. The epic also lands the two product changes the spine authorizes, `ClockPort` and the cadence policy, because P-06 cannot be tested at L0 without them. Governing decisions: AD-1, AD-2, AD-3, AD-4, AD-5, AD-6, AD-9, AD-11, AD-12, AD-13, AD-14 (L0), AD-15 (L0 job), AD-17, AD-18.

### Story 12.1: Case Schema, Loader and Rule Registry Contract

As a case author,
I want suite tests and the source manifest to be typed records validated at load against one schema, with rule references checked against a registry,
So that a malformed test or a dangling rule name fails before any run and every criterion carries a stable id.

**Covers:** FR1, FR2, FR3, FR6, FR24 (fail fixtures); NFR3, NFR9

**Acceptance Criteria:**

**Given** `packages/conversation-sim/src/suite/schema.ts` defines Zod schemas and types for `SuiteCase`, `Step`, `Criterion`, `Check`, `FixtureRef`, `SeedTurn`, `CaseRun`, `RunEvent`, `StepObservation`, `ReplyMessage`, `StateSnapshot`, `StateQueryName` with one schema per query, `ObservationField`, `SourceCase`, `SourceCriterion`, `CriterionResult` and `CriterionStatus` exactly as the amended AD-1 and AD-3 list them (`kind: 'atomic' | 'journey' | 'observation'`, `sourceCase`, `seed` with `SeedTurn.metadata`, `scripted`, `judgeGuidance`, `stateQuery.kind`, `CaseRun.testId`, `CaseRun.events`)
**And** `src/suite/cases/p-v1/sources.ts` exports the source manifest (it may be empty in this story)
**When** `loadSuite('p-v1')` reads `src/suite/cases/p-v1/*.case.ts`
**Then** every case is validated and the first invalid case fails the load with the case id and the Zod path
**And** the loader rejects an `atomic` test with other than one step, without `seed`, with a checkpoint or declaring L2; a `journey` with zero steps; an `observation` test with any step or `reply:<n>` criterion; an `evaluatedAt` index outside `1..steps.length`; a `state` criterion without `stateQuery`; a checkpoint containing a meaning check; a test id not matching `<sourceCase>.A<n>`, `<sourceCase>.J` or the observation case id; a criterion id not matching `<sourceCase>.C<n>`; a criterion id absent from the source manifest; a `conversation` source case whose testable criteria are not all covered by an atomic test (an `observation` source case is covered by its observation test); and a test declaring L0 without `scripted`
**And** the loader joins `layer` and `passCondition` from the manifest into each test criterion
**And** a case with any `advanceClock` step gets the `clock` fixture added to `setup` by the loader

**Given** `src/suite/rules/registry.ts` exports `RuleName` and a registry of `{ requires: ObservationField[], run }` entries
**When** a case references a rule name
**Then** the loader rejects any name absent from the registry
**And** the registry wraps the existing `too-many-questions`, `repeated-question` and `reflective-opener` rules from `harness/assertions.ts` without copying their definitions, each declaring `requires: ['reply.text']`
**And** a rule invoked on a `CaseRun` lacking a required field returns `NOT_OBSERVABLE`
**And** every registry entry, including the wrapped legacy rules, declares synthetic `CaseRun` fixtures `pass` and `fail`, and a colocated test fails when a rule does not FAIL on its `fail` fixture

**Given** the offline test command `pnpm --filter @entalent/conversation-sim test`
**When** it runs
**Then** `src/suite/**/*.test.ts` is included and covers each loader refinement with one failing fixture case
**And** `zod` is a `conversation-sim` devDependency pinned `^3.25.76`

### Story 12.2: Evaluation, Scoring and Report Core

As a QA engineer,
I want every criterion of a run to receive one framework status, a layer table and a verdict computed by one pure module,
So that L0, L1 and L2 cannot disagree on what "passed" means.

**Covers:** FR3, FR4, FR5, FR13, FR14, FR19, FR22, FR24; NFR8, NFR14

**Acceptance Criteria:**

**Given** `evaluate(case, run, judge | null, trust)` in `src/suite/evaluate.ts` is a pure function over a `CaseRun`
**When** it is called with `judge: null`
**Then** it produces exactly one `CriterionResult` per test and criterion in scope, keyed `<testId>/<criterionId>`, rules are evaluated through the registry, a criterion whose checks are all meaning is `NOT_RUN` with reason `no-judge-at-level`, and a rule-plus-meaning criterion is decided by the rule with `meaningSkipped: true`
**And** it asserts `run.steps[i].index === i + 1` and throws on mismatch

**Given** `src/suite/score.ts`
**When** results are scored
**Then** out-of-scope criteria (test or criterion does not declare the level, or all checks are meaning at a level without a judge) are `NOT_RUN` reason `level-not-declared` or `no-judge-at-level` and excluded from COMPLETE, pass rate and verdict
**And** layer pass rates and the verdict count `atomic` and `observation` tests only; `journey` results are reported in a separate section, and a run with only journeys in scope (L2) reports the verdict `n/a (journeys only)`
**And** `evaluate` synthesizes `effect-count { ...stateEffect, step: <evaluated step> }` for each `kind: 'change'` state criterion when the run declares `events`, and never at L2
**And** precedence for in-scope criteria is NOT_TESTABLE, then INVALID (failed precondition, failed fixture verify, a `state` criterion with `stateQuery.kind: 'change'` already satisfied on `state.before` with reason `precondition:already-satisfied`, or, in journeys only, a failed checkpoint at step k for criteria with n > k and for `conversation`/`state` criteria without `independentOfCheckpoints`), then ERROR (executor error at or before the step, fixture apply failure), then NOT_RUN (step not reached, unsupported fixture, unobservable field), then PASS/FAIL where any rule FAIL makes the criterion FAIL
**And** layer pass rate is PASS/(PASS+FAIL) over non-advisory statuses, a run is COMPLETE only when every in-scope status is PASS, FAIL or pre-declared NOT_TESTABLE, any S FAIL yields NOT ADEQUATE, else combined P+D+C pass rate ≥ 0.90 is ADEQUATE, 0.75–0.89 is ACCEPTABLE WITH ISSUES, otherwise NOT ADEQUATE, and INCOMPLETE runs carry `provisional: true` with the reason
**And** the thresholds are quoted from Framework v2.1.1 sections 5 and 6 in doc comments with the page version

**Given** `src/suite/report.ts`
**When** a run is reported
**Then** `SuiteRunReport` (`schemaVersion: 1`) is written as `.json` and `.md` under `packages/conversation-sim/runs/suites/<runId>/` (gitignored) with run id, suite, level, `n`, git sha and dirty flag, models, judge trust, per-criterion results with `status`, `passCount`, `n`, `advisory`, `method`, `reason`, layer table, verdict, provisional flag, coverage table (CF requirement to source case to test to criterion with NOT_TESTABLE reasons, judge-only criteria and unobservable fields), judge errors and usage
**And** `ScenarioRunReport`, `gate.config.json` and `run-gate.ts` are unchanged

**Given** synthetic `CaseRun` fixtures in tests
**When** the test suite runs
**Then** each status, each precedence branch (including `precondition:already-satisfied`), journey checkpoint propagation, scope exclusion and each verdict band has at least one test

### Story 12.3: Suite Rule Implementations

As a QA engineer,
I want the rule-based pass conditions of the P-suite implemented as named, deterministic checks with their phrase lists kept as test data,
So that the same transcript always yields the same status and no heuristic leaks into product code.

**Covers:** FR6, FR24; NFR3

**Acceptance Criteria:**

**Given** one file per rule under `src/suite/rules/`
**When** the registry is loaded
**Then** it contains `single-question` (exactly one question in the reply), `no-internal-terms` (none of topic, index, pulse, cycle as data list), `no-greeting-restart` (greeting and self-introduction phrase list), `cause-question-present` (a question about the cause in the reply), `no-two-replies-without-cause-question` (`conversation` scope), `reply-present` (reply not null), `bundle-staged` (requires `reply.messages[].metadata.v2ConfirmationBundle`), `answer-then-bundle` (requires `turn.bundleReply`), `proactive-spacing` (≥ 48 h between consecutive bot-initiated outbounds in `window.outbound`), `proactive-working-hours` (every bot-initiated first message between 09:00 and 18:00 in the user's timezone), `proactive-initiated` (≥ 1 bot-initiated outbound in the window), `state-equals` and `state-not-greater-than` (parameterized state comparisons), `effect-count` (exactly `expected` successful calls of a port method on the evaluated step; requires `events`) and `clock-leak` (no persisted timestamp outside the fixed clock range)
**And** every rule declares `requires` and returns `PASS`, `FAIL` or `NOT_OBSERVABLE` with evidence text
**And** no rule branches on `level`

**Given** `packages/application`, `packages/ai-openai` and the apps
**When** their import graphs are checked by a colocated test
**Then** nothing under `src/suite/` is imported by them

**Given** each rule
**When** tests run
**Then** each rule has at least one PASS, one FAIL and one NOT_OBSERVABLE case, and its registry `fail` fixture is asserted to FAIL

### Story 12.4: P-Suite Atomic Tests and Smoke Journeys

As a QA engineer,
I want the ten Confluence cases decomposed into atomic tests with their exact texts, fixtures, levels, check types and NOT TESTABLE reasons, plus the agreed cases as verbatim smoke journeys,
So that every criterion is checked on one isolated moment and an automated run stays traceable row by row to the suite I run by hand.

**Covers:** FR1, FR3, FR19, FR21; NFR6, NFR9

**Acceptance Criteria:**

**Given** `src/suite/cases/p-v1/sources.ts` lists P-01..P-10 with requirement, expected behavior, every criterion id, layer, verbatim pass condition, NOT TESTABLE reason and, for change-type state criteria, `stateEffect { port, method, expected }`
**And** `case-mapping.md` section 5 is extended with the per-case decomposition table (source case, test id, seed summary, seed approved by QA, evaluated turn, criteria, levels)
**And** `src/suite/cases/p-v1/` contains one `*.case.ts` per atomic test, per journey and for the P-06 observation test
**When** `loadSuite('p-v1')` runs
**Then** every test loads, the evaluated turn and seeded user messages match the suite verbatim, `requirement` lists the CF ids, `kind`, `levels`, `setup`, `seed`, `preconditions`, `steps`, `observationWindow` and `criteria` follow `case-mapping.md` sections 1, 4 and 5, and every testable criterion is covered by an atomic test
**And** no seeded coach turn satisfies a criterion of its own test, and every seeded coach text is marked QA-approved in the table
**And** only criteria decided by rules over orchestrator-produced inputs (time, cadence, message metadata, state, events), never over reply text the test scripted declare L0 (P-02 has none and does not run at L0), and each L0 test carries its `scripted` model outputs
**And** the agreed journeys (proposed P-09, P-10, pending QA) send the full Confluence sequence verbatim at L1 and L2
**And** P-06 is `kind: 'observation'` with `observationWindow: { durationMs: 7 days }`, criteria C1–C3 at `levels: ['L0']` and C4–C5 at `levels: ['L1']`
**And** the P-09 journey has a rule-only checkpoint after step 3 (`bundle-staged`, `onFail: 'stop'`), and the P-09 `state` criteria use `stateQuery` names `questionProgress`, `stagedBundleCount` and `surveyEvidenceCount` at `before` and `after`, with `kind: 'change'` for progress, staged bundles and evidence and `kind: 'invariant'` for "summaries count not greater than seen"; later P-09 and P-10 moments are seeded with `confirmationState` and `SeedTurn.metadata`
**And** the two NOT TESTABLE criteria (P-05 opening, P-09 progress content) carry the suite's reason text
**And** every criterion has a `passCondition` equal to the suite's pass condition text and a `layer` from P, D, C, S

**Given** the coverage table produced by the report
**When** the suite is loaded
**Then** it lists CF-002, CF-003, CF-004, CF-005, CF-006 and CF-008 with their source cases, tests and criteria, matching the suite's requirements coverage table

### Story 12.5: ClockPort in the Application Layer

As a developer,
I want business time on the conversation and proactive paths to come from an injectable clock,
So that working-hours, gap and cadence behavior can be tested at a chosen moment without changing production behavior.

**Covers:** FR9; NFR10, NFR12

**Acceptance Criteria:**

**Given** `packages/application/src/ports/clock.port.ts` exports `ClockPort { now(): Date }` and `systemClock`
**When** `ConversationOrchestrator`, `ProactiveSchedulerUseCase`, `ProactiveCheckInUseCase` and `FollowUpExecutionUseCase` are constructed
**Then** each accepts `clock: ClockPort = systemClock` as its last constructor parameter and uses it for every business-time decision and persisted timestamp on its path
**And** `isInQuietHours(now: Date, timezone, quietHours)` takes the instant explicitly and `getLocalHour(now, timezone)` likewise; call sites pass `clock.now()`
**And** no `new Date()` or `Date.now()` remains in those files, enforced by a scoped ESLint `no-restricted-syntax` rule that fails `pnpm lint` on reintroduction

**Given** `CoachHarness`, `InMemoryConversationRepository` and `InlineOutbox` in `conversation-sim`
**When** a harness is created with a clock option
**Then** every `occurredAt`, delivery timestamp and `traceId` suffix they stamp derives from that clock, defaulting to `systemClock`

**Given** the existing test suites
**When** `pnpm --filter @entalent/application test`, `pnpm --filter @entalent/worker test` and `pnpm --filter @entalent/conversation-sim test` run
**Then** they pass with no behavior change, and `apps/worker` wiring passes `systemClock` explicitly

### Story 12.6: Cadence Policy Extracted from Worker SQL

As a developer,
I want the proactive cadence decision (silence, gap between proactive messages, QA cadence) to be a pure application policy fed by repository facts,
So that the 48-hour rule is testable at L0 and a cadence regression cannot hide in SQL.

**Covers:** FR9; NFR1, NFR10

**Acceptance Criteria:**

**Given** `packages/application/src/policies/check-in-cadence.ts` exports `checkInCadencePolicy(facts, config, now)` returning an eligibility decision with a reason
**When** called with facts `{ lastInboundAt, lastProactiveOutboundAt, recentProactiveCount, hasUnansweredProactive }` and config `{ minSilenceDays, minCheckInGapDays, qaCadence }`
**Then** it reproduces every branch of the current SQL predicate in `apps/worker/src/proactive/proactive-scheduler.repository.ts`, including the QA cadence intervals and the unanswered-proactive guard, and unit tests cover each branch at boundary instants

**Given** `ProactiveSchedulerRepositoryPort`
**When** candidates are fetched
**Then** the repository returns per-user facts and coarse eligibility filters only (active user, proactive enabled, active conversation, tenant), and `ProactiveSchedulerUseCase` applies `checkInCadencePolicy` with `clock.now()` before the quiet-hours guard
**And** the use case result reports `skippedCadence` alongside `skippedQuietHours`

**Given** the existing scheduler tests and the worker integration path
**When** `pnpm --filter @entalent/application test` and `pnpm --filter @entalent/worker test` run
**Then** they pass with tests extended, not weakened, and the set of users selected for a check-in is unchanged for the fixtures in `proactive-scheduler.test.ts`
**And** `pnpm harness:check -- --base <base>` produces a receipt for the change

### Story 12.7: L0 Deterministic Executor and Fixtures

As a developer,
I want the P-suite to run offline with a scripted model and a controlled clock,
So that rule-based and time-based criteria are checked on every pull request without tokens.

**Covers:** FR9, FR13, FR22, FR23 (L0); NFR4

**Acceptance Criteria:**

**Given** `src/suite/executors/l0-deterministic-executor.ts` implements `SuiteExecutor` with `level: 'L0'`
**When** it runs an atomic or journey test
**Then** it creates a fresh `CoachHarness` per test with `aiProvider: ScriptedAiProvider` fed by the test's `scripted` outputs and a `FixedClock`/`AdvancingClock`, realizes `interMessageGapMs` and `advanceClock` by advancing the clock before each step after the first and records `gapMs`, attributes the reply by the orchestrator result with 1-based `index`, sets `reply: null` with `turn.outcome` on silence, declares `observed` fields including `events` and `supports()` for `clock`, `seededHistory`, `confirmationState`, `freshPersona`, `pendingBotQuestion`, `disclosureDelivered` and `proactiveUsers`
**And** it evaluates a journey `stop` checkpoint inline with the pure rule and records `stoppedAtStep`
**And** for an `atomic` test it applies `seededHistory`, realizes the gap from the last `SeedTurn.atOffsetMs`, and sends the single turn

**Given** `src/suite/executors/recording-proxy.ts`
**When** the L0 executor wires the harness
**Then** every port it passes in (scripted AI provider, conversation, memory, goal and style repositories, outbox, scheduler-facing ports; `CoachHarness` is extended to accept these injected, defaulting to its current in-memory implementations) is wrapped, `CaseRun.events` holds one `RunEvent` per call in order with `stepIndex` 0 for fixtures and seed, and product code is unchanged

**Given** an `observation` case (P-06)
**When** it runs
**Then** the executor seeds users with timezones from `proactiveUsers`, advances the clock across the window at `scanEveryMs`, drives `ProactiveSchedulerUseCase` through an in-memory `ProactiveSchedulerRepositoryPort` fake that returns cadence facts from the recorded messages, drives `ProactiveCheckInUseCase` with the scripted model, and fills `window.outbound` with bot-initiated messages carrying `occurredAt`

**Given** fixtures in `src/suite/fixtures/`
**When** applied at L0
**Then** each returns `{ apply, verify }`; an `apply` failure ends the case `ERROR` reason `fixture-apply:<name>` and a false `verify` yields `INVALID` reason `precondition:<name>`; `pulseCycle` is reported unsupported at L0

**Given** the L0 executor module
**When** a colocated import-graph test runs
**Then** it fails if the executor's static imports reach `scenarios/config.ts` or `OpenAiProvider`
**And** the `clock-leak` rule passes on every L0 run

### Story 12.8: Runner, suite:run and suite:baseline:accept

As a developer,
I want one command to run a suite at a level and another to accept a run as the baseline,
So that I can produce a scored report locally and make its results the reference in a reviewable commit.

**Covers:** FR14, FR15, FR17, FR22; NFR8

**Acceptance Criteria:**

**Given** `src/suite/runner.ts` and `src/suite/cli.ts`
**When** `pnpm suite:run --suite p-v1 --level L0 [--runs N] [--case P-07]` runs
**Then** the runner loads the suite, applies and verifies fixtures, runs the executor per case per sample, computes `JudgeTrust` (`trusted: false`, reason `no-judge-at-level` at L0), evaluates, scores, writes the report under `runs/suites/<runId>/` with `<ISO timestamp>-<short sha>` as run id, prints the layer table and verdict, and exits 0
**And** infrastructure `SuiteExecutionError`s retry the case once with fresh fixtures and increment `attempt`; product errors never retry; the kind comes from `gate/failure-kind.ts` extracted from `failure-classifier.ts` without changing `classifyFailure`
**And** the CLI scrubs `OPENAI_API_KEY` and `AZURE_OPENAI_*` from the environment for L0 runs

**Given** `packages/conversation-sim/suite.config.json`
**When** the CLI starts
**Then** it reads suites, levels, `interMessageGapMs` (60000), `baseline.minSamples` (L0 1, L1 5, L2 3), `diff.minSamples` (L1 3, L2 3), `retries`, budgets and the judge pin, validated by Zod

**Given** `pnpm suite:baseline:accept --run <runId>`
**When** invoked
**Then** it writes `packages/conversation-sim/baselines/p-v1/L0.json` with `schemaVersion`, suite, level, judge fingerprint (none at L0) and coach provenance, `acceptedFrom { runId, gitSha, ciRunUrl? }`, `acceptedAt` and `results['<testId>/<criterionId>'] = { status, passCount, n }` for every in-scope criterion
**And** it refuses a run with `n` below `baseline.minSamples[level]`, an INCOMPLETE run without `--allow-incomplete` (which records `provisional: true`), a dirty tree without `--allow-dirty`, or a judge fingerprint differing from the current one
**And** an initial L0 baseline for `p-v1` is committed with the story, with the expected-red criteria (P-06 working hours) recorded as FAIL

### Story 12.9: suite:diff with Regression Categories

As a release owner,
I want a run compared with the baseline per criterion and classified into regression categories,
So that a broken job, a flaky sample and a real regression are reported differently.

**Covers:** FR16, FR17; NFR13

**Acceptance Criteria:**

**Given** `pnpm suite:diff --run <runId> [--baseline <path>]`
**When** invoked
**Then** every test and criterion pair is classified as `regressed`, `fixed`, `unchanged`, `lost-coverage`, `gained-coverage`, `new`, `retired` or `inconclusive` per AD-13, with `minPasses` of `n/n` for rule checks and `ceil(0.8 n)` for meaning checks, and `inconclusive` for meaning criteria with `n < diff.minSamples[level]` or advisory
**And** journey results are diffed in a separate section, where `regressed` or `lost-coverage` rule and S criteria also exit 1 and meaning criteria are reported only
**And** the command exits 1 on any `regressed` or `lost-coverage` S or rule criterion and on `regressed` non-advisory meaning criteria, exits 2 (`baseline-invalid`) when the baseline's judge fingerprint or coach model differ from the run's, and exits 0 otherwise
**And** the diff is appended to the run's `SuiteRunReport` and printed with `lost-coverage` first

**Given** the `--merge-base` flag
**When** the command runs inside a git checkout
**Then** it reads the baseline from `git show $(git merge-base HEAD origin/main):packages/conversation-sim/baselines/<suite>/<level>.json` and never from the working tree

**Given** synthetic run and baseline pairs in tests
**When** tests run
**Then** each category and each exit code has at least one test

### Story 12.10: L0 Gate in CI and Baseline Governance

As a developer,
I want every pull request to run the L0 suite and diff it against the merge-base baseline, with baseline changes guarded,
So that a rule-criterion regression blocks merge and nobody can accept a baseline unnoticed.

**Covers:** FR18 (L0); NFR13

**Acceptance Criteria:**

**Given** `.github/workflows/ci.yml`
**When** a pull request or a push to `main` runs
**Then** a job runs `pnpm suite:run --suite p-v1 --level L0` and `pnpm suite:diff --run <id> --merge-base` without model secrets, uploads `packages/conversation-sim/runs/suites/**` as an artifact, and appends the layer table, verdict and diff to the step summary
**And** the job fails when `suite:diff` exits non-zero

**Given** `CODEOWNERS` and the workflow
**When** a pull request changes `packages/conversation-sim/baselines/**`
**Then** the QA owner is a required reviewer and the workflow fails unless the pull request carries the `baseline-change` label

**Given** the root `package.json`
**When** scripts are listed
**Then** `suite:run`, `suite:diff`, `suite:baseline:accept` and `suite:calibrate` aliases exist and delegate to `conversation-sim`
**And** `packages/conversation-sim/README.md` documents the suite commands, the status model and how to read a diff

## Epic 13: Calibrated Live Judging and the Prompt-Change Gate (L1)

QA and developers get meaning-based verdicts from a judge whose agreement with human labels is measured and reported; prompt and orchestrator changes are gated on a live L1 run against the merge-base baseline; nightly and weekly runs build the trend, optionally visible in LangWatch. Governing decisions: AD-7, AD-8, AD-10, AD-11, AD-13, AD-14 (L1), AD-15, AD-16, AD-17.

### Story 13.1: Per-Criterion Structured Judge

As a QA engineer,
I want each meaning-based criterion judged on the exact reply it names with a structured PASS or FAIL and a reason,
So that a judge verdict maps to one row of the suite instead of one opinion about the whole conversation.

**Covers:** FR7; NFR7

**Acceptance Criteria:**

**Given** `src/suite/judge/criterion-judge.ts` exports `judgeCriterion(input: JudgeInput): Promise<MeaningOutcome>` and `src/suite/judge/prompt.ts` exports the prompt template (identified by its content hash in the judge fingerprint)
**When** called with the transcript up to the evaluated reply (in atomic tests, the seeded history plus the single turn), the expected behavior, the criterion `passCondition`, `judgeGuidance` and `layer`, and `fixtureContext`
**Then** it calls `generateText` on the configured judge model with `output: Output.object({ schema })`, where the schema has only nullable fields (`status`, `reason`, `evidence`), and returns `{ status: 'PASS' | 'FAIL', reason, evidence }`, deciding by meaning, never by wording
**And** the prompt states that `fixtureContext` is reference material, not evidence of what the coach said
**And** `evaluate` checks that a PASS `evidence` is a substring of the evaluated `reply.text` after whitespace normalization, re-asks once on a missing or non-matching fragment, and then records `ERROR` reason `judge-invalid-output`; FAIL may carry `evidence: null`
**And** `conversation`-scoped criteria receive the whole transcript, and a `reply: null` is judged `FAIL` with evidence `no-reply` without a model call
**And** `fixtureContext` for P-07 carries the canonical questions of the uncovered topics from the `pulseCycle` fixture

**Given** a transport failure after one retry or schema-invalid output
**When** the judge is called from `evaluate`
**Then** only that criterion becomes `ERROR` with reason `judge-transport` or `judge-invalid-output`, the run is INCOMPLETE, and judge errors are listed separately in the report

**Given** a mock language model in tests
**When** the judge tests run
**Then** they cover PASS, FAIL, null reply, invalid output, PASS without evidence, PASS with evidence not found in the reply, and transport failure, and `usage` tokens from each call are recorded on the outcome

### Story 13.2: Calibration Labels, Import Adapter and Agreement File

As a QA engineer,
I want to turn my manual-run results into a labeled set and measure how often the judge agrees with me,
So that we know whether the judge can be trusted before its verdicts count.

**Covers:** FR8; NFR7

**Acceptance Criteria:**

**Given** `calibration/p-v1/labels.json` follows the self-contained label schema `{ criterionId, status, transcript: { turns: [{ role, text }], evaluatedReplyIndex }, source: { kind, ref }, labeler, labeledAt }` validated by Zod
**When** `pnpm suite:calibrate --suite p-v1 --import <qa-export.json>` runs
**Then** the adapter converts a QA session export (full dialogue plus per-criterion statuses) into label entries, appends them without duplicating `(criterionId, transcript hash)`, and `ref` is stored as provenance only

**Given** `pnpm suite:calibrate --suite p-v1`
**When** it runs with the pinned judge
**Then** it builds `JudgeInput` for each label exactly as `evaluate` would, calls `judgeCriterion`, and writes `calibration/p-v1/agreement.json` with `{ schemaVersion, fingerprint, labelsSha256, n, overall, kappa, perLayer, computedAt }`, where `fingerprint` is the `JudgeFingerprint` (provider, model, decoding, prompt, schema and guidance hashes)
**And** `suite:calibrate` is the only writer of `agreement.json`, and the command prints the per-layer table and the disagreements for QA review
**And** label statuses are never edited after import; a disagreement is resolved by the criterion's `judgeGuidance` or a proposal to QA to change the Confluence text

**Given** fewer labels than `minLabels` in config
**When** calibration runs
**Then** it still writes the file and prints a warning that the set is below the minimum

### Story 13.3: Judge Trust, Advisory Statuses and the QA Review List

As a release owner,
I want meaning-based statuses to count toward the verdict only when the pinned judge is calibrated, and to see every meaning FAIL listed for review,
So that an uncalibrated or swapped judge cannot fail or pass a release on its own.

**Covers:** FR8, FR15, FR16; NFR7

**Acceptance Criteria:**

**Given** `suite.config.json` carries the judge `provider`, `judgeModel` and `decoding` (temperature, reasoning effort, max output tokens), `agreementThreshold` (overall 0.85, kappa 0.6) and `minLabels` (40)
**When** the runner starts an L1 run
**Then** it computes `JudgeTrust = { trusted, reason, pin, agreement | null }` once from config, the run-time prompt, schema and guidance hashes, and `agreement.json` (every fingerprint field must match, otherwise `trusted = false` reason `fingerprint-mismatch:<field>`; `labelsSha256` must match the current labels), passes it to `evaluate`, and `evaluate` sets `advisory = !trust.trusted` on every meaning-derived result
**And** `score` and `report` copy `trust` verbatim and never recompute it; advisory statuses are excluded from pass rate and verdict; the report header reads `meaning checks: advisory (uncalibrated)` when untrusted and every report prints the effective judge fingerprint

**Given** `SIM_JUDGE_MODEL` is set to a value different from the pin
**When** `suite:run` starts
**Then** it refuses unless `--allow-unpinned-judge` is passed, in which case `trusted = false` with reason `unpinned-judge`, `models.judge` records the model actually called and `judgeTrust.pin` the configured one

**Given** a completed run
**When** the report is written
**Then** it contains a QA review section listing every meaning-based FAIL with case, criterion, reply text and judge reason
**And** `suite:diff` treats advisory meaning criteria as `inconclusive`, and `suite:baseline:accept` refuses a run whose judge fingerprint differs from the current one

### Story 13.4: L1 Orchestrator Executor, Live Fixtures and State Queries

As a QA engineer,
I want the P-suite to run against the real orchestration and prompts with a live model in the exact state each setup describes,
So that meaning-based criteria are judged on what actually ships.

**Covers:** FR10, FR12 (L1), FR20, FR23 (L1), FR24 (L1 pairing); NFR2, NFR4, NFR6

**Acceptance Criteria:**

**Given** `src/suite/executors/l1-orchestrator-executor.ts` implements `SuiteExecutor` with `level: 'L1'`
**When** it runs an atomic or journey test
**Then** it creates a fresh `CoachHarness` per test with the production coach provider wiring and in-memory repositories, drives Scenario `run()` with `user(text)` and `agent()` steps ending in `succeed()`, `setId: 'entalent-suite-p-v1'`, no judge agent and no user simulator, realizes `interMessageGapMs` and `advanceClock` through the harness clock, attributes replies by the orchestrator result, declares `observed` fields including `turn.*` and `reply.messages[].metadata.*`, and `supports()` all eight fixtures including `seededHistory` and `confirmationState`, each implemented against the in-memory repositories
**And** atomic tests apply `seededHistory` and send the single turn; every port passed into the harness, including the live AI provider, is wrapped by `recording-proxy.ts` so `CaseRun.events` records model requests, responses and settings
**And** with `LANGWATCH_API_KEY` set the run streams to LangWatch, and without it the `CaseRun` is identical

**Given** `src/suite/fixtures/state-queries.ts` holding only the L1 accessors (the query names and schemas come from `schema.ts`, Story 12.1)
**When** a `state` criterion is evaluated at L1
**Then** `questionProgress(group)`, `stagedBundleCount`, `surveyEvidenceCount` and `outboundCount` are answered from the repository fakes against the shared Zod schema per query, snapshots are taken at `before`, `after` and named `afterStep`, and `CriterionResult.method` is `substituted` for dashboard-origin criteria
**And** each `state` criterion with `kind: 'change'` in an atomic test is paired with an `effect-count` check on the evaluated step synthesized by `evaluate` from the manifest's `stateEffect` (Story 12.2)

**Given** fixtures `pulseCycle` (survey window, question group, per-question progress, uncovered topics with canonical questions) and `disclosureDelivered`
**When** applied at L1
**Then** `verify()` confirms the staged state (at least one uncovered topic; disclosure outbound delivered) and a false result yields `INVALID`

**Given** P-06 criteria C4 and C5 at L1
**When** the observation case runs
**Then** the executor wires `ProactiveCheckInUseCase` to the harness repositories (the harness does not wire it today), drives check-in generation with the live model over the fixture clock, and fills `window.outbound` for the restatement and S criteria

### Story 13.5: Live Run Budgets, Usage and the First L1 Baseline

As a release owner,
I want live runs bounded in cost and the first L1 baseline accepted from enough samples,
So that a misconfigured run cannot burn the budget and a coin-flip sample cannot become the reference.

**Covers:** FR15, FR16; NFR11

**Acceptance Criteria:**

**Given** `suite.config.json` carries `maxCoachCallsPerRun` (600) and `maxJudgeCallsPerRun` (150) per sample set
**When** a run exceeds either budget
**Then** remaining cases are marked `ERROR` reason `budget-exceeded`, the run is `provisional: true`, and the CLI exits 4

**Given** every coach and judge call
**When** the report is written
**Then** `usage` totals per model are recorded and shown in the Markdown summary

**Given** `pnpm suite:run --suite p-v1 --level L1 --runs 5`
**When** the run completes
**Then** `results['<testId>/<criterionId>'].passCount` and `samples` are filled for all five samples, and `pnpm suite:baseline:accept` writes `baselines/p-v1/L1.json` with judge and coach provenance, refusing `n < 5`
**And** the initial L1 baseline is committed with the story, with the round-3 expected-red criteria recorded as they are

### Story 13.6: Pull-Request Gate for Prompt and Orchestrator Changes

As a developer,
I want pull requests that touch prompts, the orchestrator or the suite to run the L1 suite and diff it against the merge-base baseline, while other pull requests report a skipped check,
So that a conversation regression blocks merge without stalling unrelated work.

**Covers:** FR18 (L1 gate); NFR13

**Acceptance Criteria:**

**Given** `.github/workflows/conversation-suite-l1-pr.yml` with `on: pull_request` and no `paths` filter
**When** a pull request opens or updates
**Then** a `changes` job diffs against the base sha for `packages/ai-openai/src/prompts/**`, `packages/ai-openai/src/openai-provider.ts`, `packages/application/src/use-cases/conversation-orchestrator.ts`, `packages/application/src/use-cases/proactive-*.ts`, `packages/application/src/policies/**`, `packages/application/src/utils/quiet-hours.ts` and `packages/conversation-sim/**`
**And** the `l1` job (fixed name, eligible as a required check) runs `suite:run --level L1 --runs <diff.minSamples.L1>` and `suite:diff --merge-base` when changed, otherwise emits a `::notice` and exits 0; fork pull requests always take the notice path

**Given** `JudgeTrust.trusted` is false
**When** the diff runs in the gate
**Then** it fails only on rule and S regressions or lost coverage, and the step summary states that meaning checks are advisory

**Given** a pull request changing `baselines/**`
**When** the gate runs
**Then** it fails unless the `baseline-change` label is present, and the step summary links the run artifact

### Story 13.7: Scheduled Nightly and Weekly L1 Runs

As a QA engineer,
I want the L1 suite to run every night and a five-sample run every week with artifacts I can open,
So that drift shows up between releases, not only on gated pull requests.

**Covers:** FR18 (nightly, weekly)

**Acceptance Criteria:**

**Given** `.github/workflows/conversation-sim.yml`
**When** the nightly schedule fires with the opt-in variable enabled
**Then** it runs `suite:run --suite p-v1 --level L1 --runs 1` and `suite:diff --merge-base`, uploads `runs/suites/**`, and the diff reports meaning criteria as `inconclusive` so a single sample cannot fail the job
**And** the weekly schedule runs with `--runs 5`, producing the authoritative meaning diff

**Given** the existing `authorize` job
**When** the workflow runs
**Then** the opt-in variable applies to scheduled runs only and the existing scenario gate continues to run unchanged beside the suite jobs
**And** the step summary shows the layer table, verdict, diff and usage for each suite job

## Epic 14: Full-Application Verification on the Real Path (L2)

QA sees the criteria the suite checks on the dashboard and in the database observed on the real API, queue, worker and Postgres path once a week and on demand, with persona isolation and reply attribution that survive an asynchronous worker. Governing decisions: AD-10, AD-12, AD-14 (L2), AD-15, AD-17, AD-18.

### Story 14.1: Additive Development Read Endpoints

As a QA engineer,
I want the development API to expose message metadata, job status and question-confirmation progress read-only,
So that the application-level run can observe what the dashboard shows without touching the database directly.

**Covers:** FR12 (L2 routes); NFR10

**Acceptance Criteria:**

**Given** `apps/api/src/dev/dev-simulate.controller.ts`
**When** `GET /api/v1/dev/conversation/:id/messages?after=` is called
**Then** each row additionally carries `metadata` and `jobStatus` (`queued`, `processing`, `completed`, `failed`, or `null` for outbound) where `jobStatus` is resolved by looking up the conversation queue job whose payload `messageId` equals the inbound row id, and the response for an unknown `after` id is `400` instead of the full history

**Given** `GET /api/v1/dev/user/:userId/question-confirmation?group=<questionGroup>`
**When** called
**Then** it returns applied verdicts per question, staged bundle count and pending clarification state from the existing question-confirmation repository, tenant-scoped

**Given** `GET /api/v1/dev/user/:userId/survey-state`
**When** called
**Then** the response additionally carries `count`

**Given** the development module gating
**When** `NODE_ENV=production`
**Then** none of these routes exist; API tests cover each new read and the `400` behavior, and no write path is added

### Story 14.2: L2 Application Executor with Isolation and Reply Attribution

As a QA engineer,
I want the same case records to run through the local API, queue, worker and Postgres with a fresh persona per case and replies attributed by trace,
So that P-09's dashboard criteria are observed on the real path and an asynchronous check-in cannot be mistaken for a reply.

**Covers:** FR11, FR12 (L2); NFR5

**Acceptance Criteria:**

**Given** `src/suite/executors/dev-api-client.ts` and `l2-application-executor.ts` with `level: 'L2'`
**When** a run starts
**Then** the executor reads `SUITE_L2_API_BASE`, `SUITE_L2_TENANT_ID` and `ADMIN_API_KEY`, refuses a base URL whose host is not `localhost`, `127.0.0.1` or `[::1]`, and sends `X-Api-Key` on every call under `/api/v1`

**Given** a `journey` test (L2 runs journeys only; atomic tests never declare L2)
**When** it runs
**Then** the executor creates external user `suite-<runId>-<testId>` through `GET /dev/find-conversation`, calls `POST /dev/reset-user { userId, tenantId, deep: true }`, verifies the conversation is empty, records the ids in `CaseRun.subject`, applies and verifies fixtures through the development endpoints, waits `interMessageGapMs` for real between steps, sends each step with `POST /dev/simulate-message`, polls `GET /dev/conversation/:id/messages?after=<inboundMessageId>` every 500 ms up to 60 s, attributes replies by `traceId` from the `simulate-message` response, records foreign-trace outbounds in `unsolicited`, ends polling when the trace has at least one outbound and the next poll adds none, and treats a `400` on `after` as an infrastructure error
**And** a foreign-trace outbound before the reply fails the run `ERROR kind: infrastructure` reason `unsolicited-outbound`
**And** a timeout with `jobStatus: completed` and no outbound is `reply: null`; a timeout with any other job status is `ERROR`

**Given** `state` criteria
**When** evaluated at L2
**Then** `questionProgress`, `stagedBundleCount`, `surveyEvidenceCount` and `outboundCount` are answered from the development endpoints against the shared schema, and `CriterionResult.method` is `observed`
**And** `observation` tests do not declare L2, so their criteria are `NOT_RUN` reason `level-not-declared` there

**Given** a local docker stack with API and worker running
**When** `pnpm suite:run --suite p-v1 --level L2 --case P-10.J` runs
**Then** a report is produced with the P-10 journey criteria evaluated and `pulseCycle`, `disclosureDelivered` and `freshPersona` supported at L2

### Story 14.3: Weekly L2 Workflow and the First L2 Baseline

As a release owner,
I want the application-level suite to run weekly and on demand in CI against a disposable stack,
So that the real path is verified regularly without anyone running docker by hand.

**Covers:** FR18 (L2 workflow); NFR5

**Acceptance Criteria:**

**Given** `.github/workflows/conversation-suite-l2.yml` with `schedule` and `workflow_dispatch`
**When** it runs
**Then** it starts `pgvector/pgvector:pg16` and `redis:7-alpine` services, applies migrations and seed, starts `api` with `NODE_ENV=test` and `ADMIN_API_KEY` set, starts `worker` with proactive scheduling disabled through the environment named in `suite.config.json.l2.workerEnv`, waits for health, runs `pnpm suite:run --suite p-v1 --level L2 --runs 3` and `suite:diff --merge-base`, uploads `runs/suites/**` and the API and worker logs, and appends the journey results, the verdict `n/a (journeys only)` and the journey diff to the step summary

**Given** the first successful workflow run
**When** its artifact is reviewed
**Then** `pnpm suite:baseline:accept` writes `baselines/p-v1/L2.json` from a run with `n = 3`, committed with the `baseline-change` label

**Given** the worker environment flag for disabling proactive scheduling
**When** the story completes
**Then** its name is recorded in `suite.config.json` and in `packages/conversation-sim/README.md`, and the L2 executor refuses to start when `l2.workerEnv` is absent

---
name: Conversation Evaluation Regression Framework
type: architecture-spine
purpose: build-substrate
altitude: feature
paradigm: pipes-and-filters over a hexagonal test harness (case -> executor -> observations -> evaluation -> scoring -> baseline diff)
scope: Suite runner, executors L0/L1/L2, per-criterion evaluation and scoring, baseline storage and CI schedule for Framework v2.1.1 suites, P-suite first
status: final
created: 2026-10-17
updated: 2026-10-17
binds:
  - CAP-1
  - CAP-2
  - CAP-3
  - CAP-4
  - CAP-5
  - CAP-6
  - CAP-7
  - CAP-8
  - CAP-9
  - CAP-10
  - CAP-11
  - AD-2 (parent)
  - AD-9 (parent)
  - AD-10 (parent)
sources:
  - ../../../specs/spec-conversation-eval-regression/SPEC.md
  - ../../../specs/spec-conversation-eval-regression/brownfield.md
  - ../../../specs/spec-conversation-eval-regression/case-mapping.md
  - ../architecture-enTalentNew-2026-08-05/ARCHITECTURE-SPINE.md
  - ../../../../packages/conversation-sim/src/harness/coach-harness.ts
  - ../../../../packages/conversation-sim/src/gate/run-gate.ts
  - ../../../../apps/api/src/dev/dev-simulate.controller.ts
  - ../../../../apps/worker/src/proactive/proactive-scheduler.repository.ts
companions:
  - ../../../specs/spec-conversation-eval-regression/case-mapping.md
  - ../../../specs/spec-conversation-eval-regression/architecture-diagrams.md
---

# Architecture Spine — Conversation Evaluation Regression Framework

## Design Paradigm

Pipes-and-filters inside the existing hexagonal test harness. A suite run is a fixed pipeline of pure stages over immutable records: **case** (data) → **executor** (the only stage with side effects: model calls, HTTP, clock) → **observations** (`CaseRun`) → **evaluation** (rule registry and criterion judge, per criterion) → **scoring** (framework statuses, layer pass rates, verdict) → **baseline diff**. Executors are adapters behind one port; everything after observations is deterministic given the observations plus judge outputs.

```mermaid
flowchart LR
  subgraph suite [packages/conversation-sim/src/suite]
    Cases[cases/*.case.ts] --> Loader[loader + Zod schema]
    Loader --> Runner
    Runner --> Exec[SuiteExecutor port]
    Exec --> Obs[CaseRun observations]
    Obs --> Eval[evaluate: rules + criterionJudge + JudgeTrust]
    Eval --> Score[score: statuses, pass rate, verdict]
    Score --> Diff[diff vs merge-base baseline]
    Score --> Rep[SuiteRunReport md/json]
  end
  Exec --> L0[L0 DeterministicExecutor]
  Exec --> L1[L1 OrchestratorExecutor]
  Exec --> L2[L2 ApplicationExecutor]
  L0 --> H[harness + fakes + ClockPort]
  L1 --> H
  L1 --> Sc[@langwatch/scenario run]
  L2 --> Dev[/api/v1/dev endpoints, local stack/]
```

Dependency direction (a rule, AD-12):

```mermaid
flowchart TD
  Suite[conversation-sim/src/suite] --> Harness[conversation-sim/src/harness, fakes, gate/failure-kind, scenarios/config]
  Harness --> App[@entalent/application]
  Harness --> AI[@entalent/ai-openai]
  Harness --> Contracts[@entalent/contracts]
  Suite --> Scenario[@langwatch/scenario]
  Suite --> AiSdk[ai + zod]
  Suite -. HTTP only .-> DevApi[apps/api /dev]
  App --> Clock[ClockPort + cadence policy in application]
```

## Inherited Invariants

| Inherited | From parent | Binds here |
| --- | --- | --- |
| AD-2 TypeScript owns side effects | architecture-enTalentNew-2026-08-05 | The framework observes product side effects through the product's own code path or its development read endpoints; it never writes memory, survey, outbound or audit state itself |
| AD-9 Evaluation gates block rollout | architecture-enTalentNew-2026-08-05 | A failing suite diff on a gated path blocks merge (AD-15); the gate decides on rule and S criteria until the judge is trusted (AD-8) |
| AD-10 Deterministic policy outranks agent output | architecture-enTalentNew-2026-08-05 | Rule statuses are never overridden by judge statuses; S criteria are decided before any pass rate; only rule checks may gate later steps (AD-18) |

## Invariants & Rules

### AD-1 — Case records are typed TypeScript modules validated at load [ADOPTED]

- **Binds:** CAP-1, CAP-10
- **Prevents:** Two authors inventing different case shapes, criteria without stable ids, rule references that drift from the registry, cases that are silently unrunnable at a level.
- **Rule:** A case is a `*.case.ts` module exporting one `SuiteCase`; `loadSuite(suiteId)` validates every case with the Zod `SuiteCaseSchema` and fails the suite on the first invalid case. `SuiteCase = { id, requirement: string[], kind: 'conversation' | 'observation', levels: Level[], runProfile: 'isolated', setup: FixtureRef[], preconditions: RuleCheck[], steps: Step[], observationWindow?: { durationMs, scanEveryMs }, criteria: Criterion[] }`. `Step = { text, advanceClock?: durationMs, checkpoint?: { checks: RuleCheck[], onFail: 'continue' | 'stop' } }`. `Criterion = { id: '<caseId>.C<n>', layer: 'P'|'D'|'C'|'S', evaluatedAt: 'reply:<n>' | 'after-step:<n>' | 'conversation' | 'observation-window' | 'state', passCondition (suite text verbatim), checks: Check[], levels?: Level[], stateQuery?: { name: StateQueryName, at: 'before' | 'after' | 'after-step:<n>' }, independentOfCheckpoints?: boolean }`. `Check = { type: 'rule', rule: RuleName, params? } | { type: 'meaning' } | { type: 'not-testable', reason }`. Loader refinements: `conversation` cases have ≥ 1 step and `observation` cases have none and no `reply:<n>` criterion; `1 ≤ n ≤ steps.length`; `stateQuery` is required when `evaluatedAt === 'state'`; any `advanceClock` adds the `clock` fixture to `setup`; checkpoint checks are rule checks only. Alternative deferred: YAML plus a generator from Confluence.

### AD-2 — Criterion ids are stable and are the key of every result, baseline and diff

- **Binds:** CAP-1, CAP-8, CAP-10
- **Prevents:** A renumbered criterion silently resetting its history or masking a regression.
- **Rule:** `caseId` and `criterionId` are never reused or renumbered; a retired criterion stays in the case with `checks: [{ type: 'not-testable', reason: 'retired: ...' }]`. Results, baselines and diffs are keyed by `(suiteId, level, criterionId)`; no stage keys by array position or by pass-condition text.

### AD-3 — Execution and evaluation are separate stages with a declared observation record

- **Binds:** CAP-3, CAP-4, CAP-5, CAP-6, CAP-7
- **Prevents:** An executor computing statuses, L1 and L2 disagreeing on which message is "reply 3", before/after state being read at different moments, off-by-one on reply indices.
- **Rule:** An executor returns a `CaseRun` and never a status. `CaseRun = { caseId, level, attempt, subject: { externalUserId, userId?, conversationId?, tenantId? }, observed: ObservationField[], preconditions: PreconditionResult[], steps: StepObservation[], window?: { from, to, outbound: ReplyMessage[] }, state: { before: StateSnapshot, after: StateSnapshot, afterStep: Record<number, StateSnapshot> }, stoppedAtStep?: number, errors: ExecutionError[] }`. `StepObservation = { index (1-based, equals position in case.steps), userText, traceId, gapMs, reply: { messages: ReplyMessage[], text } | null, unsolicited: ReplyMessage[], turn?: TurnTrace }` where `ReplyMessage = { id, text, occurredAt, metadata }`, `reply.text = messages.map(m => m.text).join('\n\n')`, and `TurnTrace` carries mode, intent, outcome, replyPlan and bundle metadata when the level exposes them. `state.before` is taken after fixtures are applied and before step 1, `state.after` at the end, `afterStep[n]` only for steps a `state` criterion names. `StateSnapshot` is `Record<StateQueryName, unknown>` with one Zod schema per query in `suite/fixtures/state-queries.ts`, shared by every level. `evaluate(case, run, judge | null, trust)` is a pure function and the only producer of `CriterionResult`.

### AD-4 — One executor port, three adapters, declared fixture and observation support

- **Binds:** CAP-5, CAP-6, CAP-7
- **Prevents:** Each level growing its own setup path; a case passing at L1 and silently unrunnable at L2; fixture failures reported as product failures.
- **Rule:** `SuiteExecutor { level; supports(fixture: FixtureName): boolean; observes(): ObservationField[]; run(case, options): Promise<CaseRun> }`. Fixtures are named builders in `suite/fixtures/` (`clock`, `pulseCycle`, `pendingBotQuestion`, `freshPersona`, `disclosureDelivered`, `proactiveUsers`); each returns `{ apply(): Promise<void>, verify(): Promise<PreconditionResult> }` implemented per level against its substrate. Failure inside `apply()` is an executor error (`ERROR` reason `fixture-apply:<name>`, retried per Conventions); a false `verify()` is `INVALID` reason `precondition:<name>` for every criterion; executors call `verify()` for every fixture in `setup` and for `case.preconditions`. A case needing an unsupported fixture at a declared level yields every in-scope criterion `NOT_RUN` reason `unsupported-fixture:<name>` and makes the run INCOMPLETE (a build defect, never `FAIL`). Isolation is not a fixture (AD-18).

### AD-5 — Business time enters product code only through `ClockPort`, and cadence is an application policy [ADOPTED]

- **Binds:** CAP-5, CAP-6
- **Prevents:** Working-hours, gap and cadence logic reading the wall clock in some paths and the injected clock in others; P-04's gap computed between a fixed clock and real `occurredAt`; P-06's 48-hour rule living only in SQL where L0 cannot reach it.
- **Rule:** `packages/application/src/ports/clock.port.ts` defines `ClockPort { now(): Date }` with `SystemClock`. Every use case and util on the suite paths takes `clock: ClockPort = systemClock` as its last constructor or function parameter: `ConversationOrchestrator`, `ProactiveSchedulerUseCase`, `ProactiveCheckInUseCase`, `FollowUpExecutionUseCase`, `isInQuietHours(now, timezone, quietHours)`. Every timestamp the harness or its fakes persist or compare on those paths (`saveMessage.occurredAt`, delivery, `traceId` suffixes) derives from the same clock. Enforcement: a scoped ESLint `no-restricted-syntax` rule forbids `new Date()` and `Date.now()` in the listed files; the L0 executor asserts no persisted timestamp lies outside the fixed clock's range (`clock-leak` rule). The proactive cadence predicates (silence ≥ N days, gap ≥ N days since the last proactive outbound, the QA cadence branch) move from `proactive-scheduler.repository.ts` SQL into a pure `checkInCadencePolicy(facts, config, now)` in `packages/application`; the repository returns per-user facts (`lastInboundAt`, `lastProactiveOutboundAt`, `recentProactiveCount`, `hasUnansweredProactive`) and the use case decides. Test code uses `FixedClock` / `AdvancingClock` from `suite/fixtures/clock.ts`; Vitest fake timers are not used for suite runs; L2 has no clock fixture.

### AD-6 — Rule checks are registry entries with declared observation requirements

- **Binds:** CAP-3, parent AD-10
- **Prevents:** New phrase lists leaking into product code; the same rule implemented twice; a rule passing vacuously at a level that cannot observe its input.
- **Rule:** `suite/rules/registry.ts` maps `RuleName` to `{ requires: ObservationField[], run(run, criterion, params) => RuleOutcome }` with `RuleOutcome.status: 'PASS' | 'FAIL' | 'NOT_OBSERVABLE'` plus evidence. `evaluate` checks `requires` against `CaseRun.observed` before calling a rule; a missing field yields the criterion `NOT_RUN` reason `unobservable:<field>@<level>` and the coverage table shows it. Rules never branch on `level`. Legacy rules (`too-many-questions`, `repeated-question`, `reflective-opener`) are wrapped and keep their existing definition source, including the product-shared `hasReflectiveOpener`. New rules (`single-question`, `no-internal-terms`, `no-greeting-restart`, `cause-question-present`, `bundle-staged`, `answer-then-bundle`, `proactive-spacing`, `proactive-working-hours`, `clock-leak`) keep their term and phrase lists as data under `suite/rules/`, importable by nothing outside `suite/`.

### AD-7 — Meaning-based checks use a per-criterion structured judge, not the Scenario verdict [ADOPTED]

- **Binds:** CAP-4
- **Prevents:** One aggregated judge verdict per conversation that cannot be mapped to `evaluatedAt`; judge prompts drifting between cases; judge infrastructure failures counted as product regressions.
- **Rule:** `suite/judge/criterion-judge.ts` exposes `judgeCriterion(input: JudgeInput): Promise<MeaningOutcome>`; it calls `generateText` on the pinned judge model with `output: Output.object({ schema })` (`generateObject` is deprecated in `ai` 6) and a versioned prompt template; the schema uses nullable fields, never optional ones, because AI SDK 6 defaults OpenAI to strict JSON schema. `JudgeInput = { transcript up to the evaluated reply, expectedBehavior, passCondition, layer, fixtureContext }` where `fixtureContext` carries what the criterion needs to be judged (for P-07, the canonical questions of the uncovered topics). One call per meaning check per evaluated reply; `conversation`-scoped criteria pass the whole transcript; a `reply: null` is judged `FAIL` with evidence `no-reply`. A transport failure after one retry or schema-invalid output yields the criterion `ERROR` reason `judge-transport` | `judge-invalid-output`, affects only that criterion, makes the run INCOMPLETE and is reported separately. At L0 the runner passes `judge: null`: a criterion whose checks are all meaning is `NOT_RUN` reason `no-judge-at-level` and out of scope; a rule-plus-meaning criterion is decided by the rule with `meaningSkipped: true`. Scenario's `judgeAgent` and `userSimulatorAgent` are not used in suite runs; L1 scripts end with `succeed()`.

### AD-8 — Judge trust is a measured property of a pinned judge, computed in one place

- **Binds:** CAP-4
- **Prevents:** Meaning-based FAILs counted toward the verdict before the judge was checked against humans; agreement computed or copied in several places; an env override silently evaluating with a different model than the one calibrated.
- **Rule:** `calibration/<suiteId>/labels.json` holds self-contained human labels `{ criterionId, status, transcript: { turns: [{ role: 'user' | 'coach', text }], evaluatedReplyIndex }, source: { kind: 'qa-session' | 'suite-run', ref }, labeler, labeledAt }`; `suite:calibrate --import <qa-export.json>` converts QA artifacts to this shape and `ref` is provenance only. `suite:calibrate` is the sole writer of `calibration/<suiteId>/agreement.json` `{ schemaVersion, judgeModel, judgePromptVersion, labelsSha256, n, overall, kappa, perLayer, computedAt }`, computed with the same `judgeCriterion` that `evaluate` uses. The **runner** computes `JudgeTrust = { trusted, reason, pin, agreement | null }` once per run from `suite.config.json` (`judgeModel`, `judgePromptVersion`, `agreementThreshold` [ASSUMPTION: 0.85 overall and kappa ≥ 0.6], `minLabels` [ASSUMPTION: 40]) and `agreement.json` (must match the pin and the current `labelsSha256`), and passes it to `evaluate`, which sets `advisory = !trust.trusted` on every meaning-derived result; `score` and `report` copy `trust` verbatim and never recompute it. The effective judge model is the config pin; `SIM_JUDGE_MODEL` is honored only when equal to the pin or with `--allow-unpinned-judge`, which forces `trusted = false` reason `unpinned-judge`. The report records `models.judge` (called) and `judgeTrust.pin` (configured). Changing the pin or the prompt version invalidates `agreement.json` and every baseline of that suite (AD-11).

### AD-9 — Statuses, precedence, scope and verdict follow Framework v2.1.1 sections 5 and 6

- **Binds:** CAP-2, parent AD-10
- **Prevents:** Each level or report inventing its own notion of "passed"; planned and unplanned NOT RUN indistinguishable; every L0 or L2 run INCOMPLETE because other levels' criteria are counted.
- **Rule:** `CriterionStatus = PASS | FAIL | NOT_TESTABLE | INVALID | ERROR | NOT_RUN`. Scope: a criterion is in scope for a run when its case declares the level and the criterion does not narrow it away; out-of-scope criteria are emitted `NOT_RUN` reason `level-not-declared` and excluded from COMPLETE, pass rate, diff and verdict. Precedence for in-scope criteria: `not-testable` check → NOT_TESTABLE; failed precondition or a failed checkpoint before the criterion (AD-18) → INVALID; executor or judge error at or before the criterion's step → ERROR; step not reached → NOT_RUN; otherwise PASS/FAIL where any rule FAIL makes the criterion FAIL and meaning checks apply only when no rule check failed. `ERROR` is reserved for the executor not knowing what the product did (exception, transport failure after retry, L2 timeout without a terminal job signal); an observed decision not to reply is `reply: null` with `turn.outcome` and is evaluated. Layer pass rate = PASS/(PASS+FAIL) over non-advisory statuses. A run is COMPLETE when every in-scope status is PASS, FAIL or pre-declared NOT_TESTABLE. Verdict: any S FAIL → NOT ADEQUATE; else combined P+D+C pass rate ≥ 0.90 → ADEQUATE, 0.75–0.89 → ACCEPTABLE WITH ISSUES, else NOT ADEQUATE; INCOMPLETE runs carry `provisional: true` with the reason. The framework text these thresholds come from is quoted in `suite/score.ts` doc comments with the page version.

### AD-10 — State criteria are answered by one query table and labeled with their method

- **Binds:** CAP-6, CAP-7, CAP-10
- **Prevents:** A green L1 report implying the dashboard was observed; L2 stories choosing between a new route, an admin route or a direct database read.
- **Rule:** `suite/fixtures/state-queries.ts` is the single table `StateQueryName → { schema, l1: (harness) => value, l2: { method, path } }`. Initial rows: `questionProgress(group)` → `questionConfirmationRepo` applied verdicts → `GET /api/v1/dev/user/:userId/question-confirmation`; `stagedBundleCount` → repository staged bundles → same endpoint; `surveyEvidenceCount` → `surveyRepo` → `GET /api/v1/dev/user/:userId/survey-state` (`count`); `outboundCount` → conversation repository → `GET /api/v1/dev/conversation/:id/messages`. `CriterionResult.method` is `'observed'` at L2 and `'substituted'` at L1 for dashboard-origin criteria; reports render the method next to the status.

### AD-11 — Reports and baselines are new, versioned artifacts with sample counts and provenance

- **Binds:** CAP-2, CAP-8, CAP-10
- **Prevents:** Breaking `ScenarioRunReport`, `run-gate.ts` or CI classification; a single-sample coin flip becoming the baseline; a baseline accepted from a different judge or a dirty tree.
- **Rule:** A run id names one invocation with `n` samples. `SuiteRunReport` (`schemaVersion: 1`) = `{ runId, suiteId, level, n, git: { sha, dirty }, models: { coach, judge }, judgeTrust, results: Record<criterionId, { status, passCount, n, advisory, method, reason?, samples: CriterionSample[] }>, layers, verdict, provisional, coverage (CF → case → criterion), judgeErrors, usage }`. Runs write to `packages/conversation-sim/runs/suites/<runId>/` (gitignored) as `.json` and `.md`. Baselines are committed at `packages/conversation-sim/baselines/<suiteId>/<level>.json` as `{ schemaVersion, suiteId, level, judge: { model, promptVersion, agreement }, coach: { model }, acceptedFrom: { runId, gitSha, ciRunUrl? }, acceptedAt, results: Record<criterionId, { status, passCount, n }> }` for every in-scope criterion. `suite:baseline:accept --run <id>` refuses a run with `n < config.baseline.minSamples[level]` [ASSUMPTION: L0 1, L1 5, L2 3], an INCOMPLETE run (unless `--allow-incomplete`, recorded as `provisional`), `git.dirty` (unless `--allow-dirty`), or a judge pin differing from config. `ScenarioRunReport` and `gate.config.json` are untouched.

### AD-12 — Dependency direction and the authorized product-side changes

- **Binds:** all
- **Prevents:** Product code importing test fixtures, rule lists or report types; stories inventing product changes the framework needs.
- **Rule:** As drawn in the paradigm diagram. `suite/` imports `harness/`, `fakes/`, `scenarios/config.ts` (`judgeModel`), `gate/failure-kind.ts`, `@entalent/*`, `@langwatch/scenario`, `ai`, `zod`. `@entalent/*` packages and the apps import nothing from `conversation-sim`. Product-side changes this spine authorizes, and no others: (1) `ClockPort` and its injection (AD-5); (2) the cadence policy extraction (AD-5); (3) additive read-only `GET` endpoints or fields in `dev-simulate.controller.ts` (`metadata` and `jobStatus` on messages, `count` on `survey-state`, `question-confirmation`), development-module-only, reading existing repositories, adding no write path; (4) extracting the pure predicates of `failure-classifier.ts` into `gate/failure-kind.ts` inside `conversation-sim`.

### AD-13 — Regression is a per-criterion diff against the merge-base baseline over enough samples

- **Binds:** CAP-8
- **Prevents:** Per-scenario thresholds hiding which criterion moved; one flaky judge sample flagged as a regression; a broken L2 job reported as a clean diff; a PR accepting its own baseline.
- **Rule:** `suite:diff --run <id>` compares the run's per-criterion `passCount/n` with the baseline. Categories: `regressed` (baseline PASS, `passCount < minPasses(level, checkType, n)`), `fixed` (baseline FAIL, `passCount ≥ minPasses`), `unchanged`, `lost-coverage` (baseline PASS or FAIL, current NOT_RUN/ERROR/INVALID or missing), `gained-coverage` (the reverse), `new`, `retired`, `inconclusive` (meaning criterion with `n < config.diff.minSamples[level]` [ASSUMPTION: L1 3, L2 3] or advisory). `minPasses` [ASSUMPTION: rule checks `n/n`; meaning checks `ceil(0.8 n)`]. The diff fails on any `regressed` or `lost-coverage` S or rule criterion, and on `regressed` non-advisory meaning criteria; `inconclusive` and `new` never fail it. The diff refuses (`baseline-invalid`) when the baseline's judge pin, prompt version or coach model differ from the run's. In CI the baseline is read from the merge-base (`git show $(git merge-base HEAD origin/main):…/baselines/<suite>/<level>.json`), never from the PR checkout; a PR that changes `baselines/**` must carry the `baseline-change` label and a QA CODEOWNERS review, and the workflow fails otherwise. Diff output is part of `SuiteRunReport` and the CI step summary, `lost-coverage` listed first.

### AD-14 — Determinism and isolation contract per level

- **Binds:** CAP-5, CAP-6, CAP-7
- **Prevents:** L0 tests that quietly need credentials; L1 runs touching the local database; L2 attributing a proactive check-in or stale history to a step; L2 pointed at a non-local host.
- **Rule:** **L0** constructs `CoachHarness` with `aiProvider: ScriptedAiProvider` always, never imports `scenarios/config.ts` or `OpenAiProvider` (enforced by a colocated import-graph test), and the CLI scrubs `OPENAI_API_KEY` and `AZURE_OPENAI_*` from its environment. **L1** uses the production coach provider wiring, the pinned judge, in-memory repositories only, and Scenario `run()` with `setId: 'entalent-suite-<suiteId>'`. **L2** reads `SUITE_L2_API_BASE`, `SUITE_L2_TENANT_ID` and `ADMIN_API_KEY`; refuses any base URL whose host is not `localhost`, `127.0.0.1` or `[::1]`; all paths carry the global prefix `/api/v1`; per case it creates a fresh external user `suite-<runId>-<caseId>` via `GET /dev/find-conversation`, calls `POST /dev/reset-user { userId, tenantId, deep: true }`, verifies the conversation is empty, records the ids in `CaseRun.subject`; sends each step with `POST /dev/simulate-message` and attributes replies by `traceId` from its response, polling `GET /dev/conversation/:id/messages?after=<inboundMessageId>` every 500 ms up to 60 s and ending when the trace has ≥ 1 outbound and the next poll adds none for it; a response not starting strictly after `after` (unknown-id fallback) is an infrastructure error; outbounds with a foreign `traceId` before the reply fail the run `ERROR kind: infrastructure` reason `unsolicited-outbound`. The L2 API runs with `NODE_ENV=test` so `DevModule` mounts and `ApiKeyGuard` is active; the L2 worker runs with proactive scheduling disabled (`suite.config.json.l2.workerEnv`, named in the first L2 story). `observation` cases at L2 are deferred. No level reads `SLACK_*`.

### AD-15 — CI placement, gating and cost envelope by level

- **Binds:** CAP-9, parent AD-9
- **Prevents:** Live runs on every PR or never; a required check stuck at "Expected" on PRs that do not touch gated paths; epics assuming meaning criteria gate from day one; unbounded token spend.
- **Rule:** `ci.yml` runs `pnpm suite:run --suite p-v1 --level L0` on every PR and on `main`, no secrets. A new `conversation-suite-l1-pr.yml` runs on `pull_request` without a `paths` filter: a `changes` job diffs against the base sha for `packages/ai-openai/src/prompts/**`, `packages/ai-openai/src/openai-provider.ts`, `packages/application/src/use-cases/conversation-orchestrator.ts`, `packages/application/src/use-cases/proactive-*.ts`, `packages/application/src/utils/quiet-hours.ts`, `packages/conversation-sim/**`; the `l1` job (always the same name, so it can be a required check) runs `suite:run --level L1 --runs config.diff.minSamples.L1` plus `suite:diff` when changed, otherwise emits a notice and exits 0; fork PRs get the skipped notice. Until `JudgeTrust.trusted` is true, the PR check fails only on rule and S regressions, and the report header reads `meaning checks: advisory (uncalibrated)`. `conversation-sim.yml` keeps its opt-in variable for scheduled runs only and adds `suite:run --level L1` nightly (`n = 1`, reports but cannot fail on meaning criteria) and weekly (`n = 5`, authoritative meaning diff). A new `conversation-suite-l2.yml` runs weekly and on dispatch with `pgvector/pgvector:pg16` and `redis:7-alpine` services, starts `api` (`NODE_ENV=test`) and `worker` from the checkout, and runs `suite:run --level L2 --runs 3`. `suite.config.json` carries `maxCoachCallsPerRun` and `maxJudgeCallsPerRun` [ASSUMPTION: 600 and 150 per sample set]; exceeding either aborts remaining cases as `ERROR` reason `budget-exceeded` with `provisional: true`. All jobs upload `runs/suites/**` as artifacts and append the layer table, verdict, diff and `usage` to the step summary.

### AD-16 — LangWatch cloud is an optional sink, never a dependency

- **Binds:** CAP-11
- **Prevents:** Suite results or statuses living only in a vendor UI.
- **Rule:** L1 drives the coach through Scenario `run()` so `LANGWATCH_API_KEY` streams the conversation when set. Statuses, reports and baselines are computed and stored locally regardless; no code path reads from LangWatch.

### AD-17 — Observation attribution and completeness are declared by the executor

- **Binds:** CAP-3, CAP-6, CAP-7
- **Prevents:** Rules passing vacuously where a level cannot observe their input; silence and failure conflated; observation cases without a home in the record.
- **Rule:** Every executor returns `CaseRun.observed` listing the `ObservationField`s it filled (`reply.text`, `reply.messages[].metadata.*`, `turn.mode`, `turn.outcome`, `turn.bundleReply`, `state.<query>`, `window.outbound`); `evaluate` trusts only declared fields (AD-6). Replies are attributed by `traceId` at every level (L0/L1 from `OrchestrateResult`, L2 from the message list). Product silence is `reply: null` with `turn.outcome`, never ERROR. `observation` cases populate `window` by driving the scheduler and check-in generation over the fixture clock (L0/L1) and `observation-window` criteria evaluate over `window.outbound`. `StepObservation.index` is 1-based and `evaluate` asserts `run.steps[i].index === i + 1`.

### AD-18 — Scope, isolation, gaps, checkpoints and retries are declared in the case and owned by the runner

- **Binds:** CAP-1, CAP-2, CAP-5, CAP-6, CAP-7
- **Prevents:** Isolation modeled as a fixture that one level cannot support; the suite's 60-second gap realized differently per level; checkpoints implemented by the executor at one level and the evaluator at another; a step re-sent inside one attempt.
- **Rule:** Isolation is an executor obligation implied by `runProfile: 'isolated'`: L0/L1 create a new harness and repositories per case, L2 follows AD-14; `freshPersona` means only "no seeded memory, style or survey state". `suite.config.json.interMessageGapMs` (default 60000) is realized uniformly before every step after the first (L0/L1 `clock.advance`, L2 real wait) and recorded as `gapMs`; `advanceClock` is in addition. Checkpoints are rule-only: executors send every step unless `onFail: 'stop'`, in which case the executor runs the pure checkpoint rule inline and records `stoppedAtStep`; the evaluator decides checkpoint outcomes, and on failure at step k criteria at `n > k`, plus `conversation` and `state` criteria without `independentOfCheckpoints`, are INVALID reason `checkpoint:<k>`. The retry unit is the case: an infrastructure `SuiteExecutionError` discards the `CaseRun`, re-applies fixtures and re-runs once, incrementing `attempt`; product errors never retry; judge retries happen inside `evaluate` (AD-7).

## Consistency Conventions

| Concern | Convention |
| --- | --- |
| Ids | Suite `p-v1`; case `P-07`; criterion `P-07.C3`; rule names kebab-case; fixture and state-query names camelCase; run id `<ISO timestamp with - for : and .>-<short sha>` as in `run-gate.ts`; L2 external user `suite-<runId>-<caseId>` |
| Files | `src/suite/cases/<suite>/p-07-steers-uncovered-topics.case.ts`; executors `src/suite/executors/<level>-executor.ts`; one rule per file under `src/suite/rules/`; offline tests `*.test.ts`, live `*.sim.test.ts` |
| Data & formats | ISO-8601 UTC timestamps; durations in milliseconds as integers; statuses as uppercase snake-case literals (AD-9); every suite JSON carries `schemaVersion`; Zod schemas in `suite/schema.ts` are the single type source |
| Errors | `SuiteExecutionError { kind: 'product' \| 'infrastructure', step, cause }`; kind from `gate/failure-kind.ts` (`isTransportFailureMessage`, `isTransportOnlyAgentFailure`); exit codes: 0 clean, 1 diff failed, 2 baseline invalid, 3 judge infrastructure, 4 budget exceeded |
| Config | `packages/conversation-sim/suite.config.json` (suites, levels, judge pin and thresholds, `interMessageGapMs`, `baseline.minSamples`, `diff.minSamples`, budgets, `l2.workerEnv`); env `SUITE_L2_API_BASE`, `SUITE_L2_TENANT_ID`, `ADMIN_API_KEY`; `SIM_JUDGE_MODEL` per AD-8 |
| Logging | Prefix `[suite]`; one line per case per level with statuses summary; no transcript text in CI logs; per-call `usage` tokens recorded in the report |
| Commands | `suite:run --suite <id> --level <L0\|L1\|L2> [--runs N] [--case P-07]`, `suite:diff --run <id>`, `suite:baseline:accept --run <id>`, `suite:calibrate --suite <id> [--import <file>]`; root aliases `pnpm suite:*` |
| Package scripts | `conversation-sim` `test` stays offline and includes `src/suite/**/*.test.ts`; live suite execution only via `suite:run` |

## Stack

| Name | Version |
| --- | --- |
| Node | 24 (CI `NODE_VERSION`; Maintenance LTS from 2026-10-20) |
| pnpm | 9.12.0 |
| TypeScript | 5.9.3 |
| Vitest (conversation-sim) | 3.2.7 |
| @langwatch/scenario | 0.4.15 (repo pin; current line 1.7.x, no breaking change to `run`/`user`/`agent`/`succeed`/`setId`; upgrade Deferred) |
| ai | 6.0.240 (`generateText` + `Output.object`) |
| zod (conversation-sim devDependency) | ^3.25.76, deliberately on the `ai` peer range to keep one zod instance; not zod 4 |
| tsx | 4.23.1 |
| GitHub Actions services | `pgvector/pgvector:pg16`, `redis:7-alpine` (as in `ci.yml`) |

## Structural Seed

```text
packages/conversation-sim/
  suite.config.json              # suites, levels, judge pin/thresholds, gap, minSamples, budgets, l2.workerEnv
  baselines/p-v1/{L0,L1,L2}.json # committed, changed only by suite:baseline:accept (AD-11)
  calibration/p-v1/labels.json   # self-contained human labels (AD-8)
  calibration/p-v1/agreement.json# written only by suite:calibrate (AD-8)
  runs/suites/<runId>/           # gitignored run output
  src/suite/
    schema.ts                    # SuiteCase, Criterion, Check, CaseRun, CriterionResult, SuiteRunReport, Baseline (Zod + types)
    loader.ts                    # loadSuite(suiteId) + refinements (AD-1)
    runner.ts                    # fixtures -> executor -> JudgeTrust -> evaluate -> score -> report -> diff
    evaluate.ts                  # pure (case, run, judge | null, trust) -> CriterionResult[]
    score.ts                     # scope, precedence, layer table, verdict (AD-9)
    diff.ts                      # categories, minSamples, merge-base baseline (AD-13)
    report.ts                    # SuiteRunReport md/json
    cli.ts                       # suite:run / suite:diff / suite:baseline:accept / suite:calibrate
    cases/p-v1/*.case.ts         # P-01..P-10
    fixtures/                    # clock.ts, pulse-cycle.ts, pending-bot-question.ts, fresh-persona.ts, disclosure-delivered.ts, proactive-users.ts, state-queries.ts
    executors/                   # l0-deterministic-executor.ts, l1-orchestrator-executor.ts, l2-application-executor.ts, dev-api-client.ts
    rules/                       # registry.ts + one rule per file, term lists as data
    judge/                       # criterion-judge.ts, prompt.ts (versioned), calibrate.ts
  src/gate/failure-kind.ts       # pure predicates extracted from failure-classifier.ts (AD-12)
packages/application/src/ports/clock.port.ts           # ClockPort, SystemClock (AD-5)
packages/application/src/policies/check-in-cadence.ts  # checkInCadencePolicy (AD-5)
apps/api/src/dev/dev-simulate.controller.ts            # additive read-only GETs (AD-12)
.github/workflows/conversation-suite-l1-pr.yml         # PR gate with change detection (AD-15)
.github/workflows/conversation-suite-l2.yml            # weekly L2 (AD-15)
```

## Capability → Architecture Map

| Capability | Lives in | Governed by |
| --- | --- | --- |
| CAP-1 Case as data | `suite/schema.ts`, `suite/loader.ts`, `suite/cases/` | AD-1, AD-2, AD-18 |
| CAP-2 Statuses and verdict | `suite/score.ts` | AD-9, AD-10, AD-18 |
| CAP-3 Rule checks | `suite/rules/` | AD-3, AD-6, AD-17 |
| CAP-4 Meaning checks and calibration | `suite/judge/`, `calibration/` | AD-7, AD-8 |
| CAP-5 L0 | `suite/executors/l0-*`, `fixtures/clock.ts`, `application/ports/clock.port.ts`, cadence policy | AD-4, AD-5, AD-14, AD-17 |
| CAP-6 L1 | `suite/executors/l1-*`, `harness/`, `fixtures/` | AD-4, AD-10, AD-14, AD-16, AD-17 |
| CAP-7 L2 | `suite/executors/l2-*`, `dev-api-client.ts`, `/dev` additive reads | AD-4, AD-10, AD-12, AD-14, AD-17 |
| CAP-8 Baseline and diff | `suite/diff.ts`, `baselines/` | AD-2, AD-11, AD-13 |
| CAP-9 CI schedule | `.github/workflows/*` | AD-15 |
| CAP-10 Coverage | `suite/report.ts` | AD-1, AD-6, AD-10, AD-11 |
| CAP-11 Observability | `suite/executors/l1-*` | AD-16 |

## Deferred

| Decision | Revisit condition |
| --- | --- |
| YAML authoring or a generator from Confluence | When QA starts editing cases directly; AD-1's Zod schema is the contract either way |
| Conversation Quality, Safety & Trust and D suites | After `p-v1` runs green at L0 and L1 for two weekly cycles; schema already carries `layer`, `kind`, `levels`, `runProfile` |
| Sequential and Anytime run profiles | First suite that needs state carried across cases |
| `@langwatch/scenario` upgrade from 0.4.15 to the 1.x line | When a 1.x feature is needed; verified no breaking change to the APIs this spine uses |
| L2 CI service topology details (seeding, worker boot, the proactive-disable flag name) | First L2 story; AD-14/AD-15 fix the trigger, env contract and artifact contract |
| `observation` cases at L2 (a `/dev` scheduler driver with controllable time) | After the working-hours decision |
| Parallel case execution | When an L1 suite run exceeds the nightly window; budgets are decided (AD-15) |
| HTML report or LangWatch dataset export | When QA asks for review tooling beyond Markdown and LangWatch traces |
| Observation-window realism for P-06 (many users, DST) | After the working-hours open question is answered |
| Slack smoke of the suite path | Only if a production incident shows a Slack-only divergence the L2 path missed |

## Open Questions

- Working hours 09:00-18:00 (suite) vs `DEFAULT_QUIET_HOURS` 22:00-08:00 (code): the P-06 rule needs the product answer; until then the L0 rule encodes the suite and the criterion is expected FAIL.
- Confluence open items 1-4 and 7 (bot-initiated vs continuation, weekends, reactive effect on the 48-hour timer, P-05 opening, progress statement).
- Agreement threshold, kappa floor and minimum label count for judge trust (AD-8 assumptions).
- Budget numbers (AD-15 assumptions) and whether a QA CODEOWNERS entry for `baselines/**` exists or must be created.
- LangWatch cloud account for QA review, or local only.

## Verification Notes

- `@langwatch/scenario` 0.4.15 exports `succeed()`, `user()`, `agent()`, `run()`, `ScenarioConfig.setId`; `run()` requires only one agent-role adapter; verified in `packages/conversation-sim/node_modules` on 2026-10-17. Current upstream line is 1.7.x (1.0.0 released 2026-07-24).
- `ai` 6.0.240 marks `generateObject` `@deprecated` in its typings; `generateText` with `Output.object` is the supported path; peer range `zod ^3.25.76 || ^4.1.8`; `zod` 3.25.76 is resolved in the workspace but not yet a `conversation-sim` dependency.
- Vitest resolves to 3.2.7 inside `conversation-sim` and 2.1.9 elsewhere; the suite uses the package-local version.
- `conversation-orchestrator.ts` has seven direct `Date` usages (three in module-level functions); `proactive-check-in.use-case.ts` has three; `quiet-hours.ts` reads `new Date()`; `proactive-scheduler.repository.ts` computes silence and gap in SQL against Postgres `now()` with a `qaCadence` branch. All are the AD-5 change surface.
- `DevModule` mounts via `shouldMountDevModule()` whenever `NODE_ENV !== 'production'`; `ENABLE_DEV_ENDPOINTS=true` in production throws. Global prefix `/api/v1` in `main.ts`. `GET /dev/conversation/:id/messages` selects `id, direction, text, occurredAt, traceId` only; `POST /dev/reset-user` takes internal `userId` + `tenantId` and defaults `deep: false`; `GET /dev/user/:id/survey-state` returns evidence rows, not confirmation progress.
- `ci.yml` already runs `pgvector/pgvector:pg16` and `redis:7-alpine` as services and sets a placeholder `OPENAI_API_KEY`, hence the L0 env scrub in AD-14.

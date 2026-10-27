# Epic 13 Context: Calibrated Live Judging and the Prompt-Change Gate (L1)

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 12 gave every pull request an offline, rule-only verdict (L0). This epic adds meaning-based verdicts. A per-criterion structured judge decides each meaning check on the exact reply it names. Its agreement with human labels is measured against a pinned fingerprint, and its statuses count toward the verdict only when that judge is calibrated. An L1 executor runs tests through the real orchestrator and prompts with in-memory repositories, live-style fixtures, state queries and a per-step event log. Live runs are bounded by budgets, and the epic defines how L1 results become baselines and gate prompt and orchestrator changes. The point is that conversation-quality regressions surface per criterion, while an uncalibrated or swapped judge can never pass or fail a release on its own.

## Stories

- Story 13.1: Per-Criterion Structured Judge
- Story 13.2: Calibration Labels, Import Adapter and Agreement File
- Story 13.3: Judge Trust, Advisory Statuses and the QA Review List
- Story 13.4: L1 Orchestrator Executor, Live Fixtures and State Queries
- Story 13.5: Live Run Budgets, Usage and the First L1 Baseline
- Story 13.6: Pull-Request Gate for Prompt and Orchestrator Changes
- Story 13.7: Scheduled Nightly and Weekly L1 Runs

## Requirements & Constraints

**User decisions for this run (they override the epics where they conflict):**

- **No live model calls.** No story in this run may make a live model call.
  - The judge and the L1 coach take an injected transport or provider, and all tests use fakes or mock language models.
  - Model egress and cost are a human boundary.
  - Story 13.5's live five-sample run and committed `L1.json`, and any live calibration, stay as code paths exercised with fakes. A human runs them.
- **CI.** The L0 CI job stays secret-free, and L1 is not wired into CI. Stories 13.6 and 13.7, which add the L1 pull-request workflow and the nightly and weekly runs, conflict with this decision. Don't add or alter workflows that run L1 unless a human reverses it.
- **Suites.** The QA suite `p-v1` (Story 12.4) is out of scope and empty. Smoke scenarios will live in a later `smoke-v1` suite. Don't author P-case content. Commands and paths that name `p-v1` must work on an empty suite.

**Judge (meaning checks):**

- **One call per check.** Make one call per meaning check per evaluated reply. The input is:
  - the transcript up to that reply (in atomic tests, the seeded history plus the single turn; `conversation`-scoped criteria get the whole transcript)
  - the expected behavior, the verbatim pass condition, the judge guidance and the layer
  - the fixture context
- **Fixture context is reference only.** The prompt must say it is never evidence of what the coach said. For P-07 it carries the canonical questions of the uncovered topics.
- **Output.** The judge returns `{ status, reason, evidence }` and decides by meaning, never by wording.
  - A PASS must carry a verbatim fragment of the evaluated reply, matched as a substring after whitespace normalization.
  - If the fragment is missing or doesn't match, re-ask once, then record ERROR `judge-invalid-output`.
  - A FAIL may carry `evidence: null`.
- **Silence.** `reply: null` is FAIL with evidence `no-reply`, without a model call.
- **Errors.** A transport failure after one retry is ERROR `judge-transport`. Schema-invalid output is ERROR `judge-invalid-output`. Either affects only that criterion, makes the run INCOMPLETE, and is listed separately in the report. Record per-call `usage` tokens.
- **L0.** At L0 the judge is `null`. A meaning-only criterion is NOT_RUN `no-judge-at-level`. A rule-plus-meaning criterion is decided by the rule, with `meaningSkipped: true`.

**Calibration and trust:**

- **Labels.** Labels are self-contained records: criterion id, status, a transcript with the evaluated reply index, provenance source, labeler and date.
  - The import adapter converts QA session exports into labels. It appends them, deduplicating on `(criterionId, transcript hash)`.
  - Label statuses are never edited after import. A disagreement is fixed through the criterion's judge guidance or a proposal to QA to change the Confluence wording.
- **Agreement file.** `suite:calibrate` is the only writer of `agreement.json`.
  - It builds judge inputs exactly as `evaluate` does.
  - It prints the per-layer table and the disagreements.
  - Below `minLabels` it still writes the file, with a warning.
- **Trust record.** The runner computes `JudgeTrust` once per run and passes it to `evaluate`.
  - `evaluate` sets `advisory = !trusted` on every meaning-derived result. `score` and `report` copy the record verbatim.
  - Advisory statuses are excluded from pass rates and the verdict.
  - An untrusted report header reads `meaning checks: advisory (uncalibrated)`. Every report prints the effective fingerprint.
  - Every report has a QA review section listing each meaning FAIL with its case, criterion, reply and reason.
- **Thresholds.** These are assumptions: agreement 0.85 overall, kappa 0.6, at least 40 labels.
- **Unpinned judge.** If `SIM_JUDGE_MODEL` differs from the pin, `suite:run` refuses unless `--allow-unpinned-judge` is passed. With the flag, the run is untrusted with reason `unpinned-judge`, records the model actually called, and keeps the configured pin.

**Baselines, diff and budgets:**

- **Minimum samples.** These are assumptions: baseline minimum samples L1 = 5; diff minimum samples L1 = 3.
- **Diff.**
  - A meaning criterion is `inconclusive` when it has too few samples or is advisory.
  - A meaning criterion regresses when `passCount < ceil(0.8 n)`. Rule criteria need `n/n`.
  - The diff refuses with `baseline-invalid` when the judge fingerprint or the coach model differs from the baseline's.
  - Accept refuses a run whose judge fingerprint differs from the current one.
- **Budgets.** These are assumptions: `maxCoachCallsPerRun` 600 and `maxJudgeCallsPerRun` 150 per sample set.
  - Exceeding a budget marks the remaining cases ERROR `budget-exceeded`, sets `provisional: true`, and exits with code 4.
  - Report usage totals per model in the Markdown summary.

**Invariants:**

- The project stays TypeScript-only, and the retired MAF and agent-service code stays untouched.
- L1 needs no Postgres or Redis. The `conversation-sim` `test` script stays offline.
- Nothing outside `conversation-sim` imports `suite/`.
- `ScenarioRunReport`, `gate.config.json` and `run-gate.ts` stay unchanged.
- Expected reds (the P-06 working-hours criterion, P-07/P-08/P-09) are recorded as FAIL and never fixed by changing product behavior.

## Technical Decisions

- **Judge module.** `src/suite/judge/criterion-judge.ts` exports `judgeCriterion(input: JudgeInput): Promise<MeaningOutcome>`, and `src/suite/judge/prompt.ts` holds the prompt template.
  - It uses `ai` 6 `generateText` with `output: Output.object({ schema })`. `generateObject` is deprecated.
  - Schema fields are nullable, never optional, because OpenAI uses strict JSON schema.
  - Use zod ^3.25.76, which is in the `ai` peer range. Don't use zod 4.
  - Inject the model or provider so tests can pass a mock language model.
- **Fingerprint.** `JudgeFingerprint` is `{ provider, model, decoding: { temperature, reasoningEffort, maxOutputTokens }, promptSha256, schemaSha256, guidanceSha256 }`.
  - Provider, model and decoding come from `suite.config.json`.
  - The three hashes are computed at run time from the prompt, the output schema and all `judgeGuidance` texts. There is no hand-maintained version number.
  - Any field mismatch gives `trusted = false` with reason `fingerprint-mismatch:<field>`. The labels hash must also match.
  - Changing any fingerprint field invalidates `agreement.json` and every baseline of that suite.
- **Agreement file.** `calibration/<suite>/agreement.json` is `{ schemaVersion, fingerprint, labelsSha256, n, overall, kappa, perLayer, computedAt }`. Labels live in `calibration/<suite>/labels.json`, validated by Zod.
- **L1 executor.** `src/suite/executors/l1-orchestrator-executor.ts` implements `SuiteExecutor` with `level: 'L1'`.
  - It creates a fresh `CoachHarness` per test with the coach provider and in-memory repositories.
  - It drives Scenario `run()` with `user()` and `agent()` steps ending in `succeed()`, `setId: 'entalent-suite-<suiteId>'`, no judge agent and no user simulator.
  - It realizes `interMessageGapMs` and `advanceClock` through the harness clock and attributes replies by the orchestrator result's `traceId`.
  - It declares observed fields, including `turn.*`, `reply.messages[].metadata.*` and `events`.
  - `supports()` covers all eight fixtures, including `seededHistory`, `confirmationState`, `pulseCycle` and `disclosureDelivered`. A failed `verify()` gives INVALID.
- **Event log.** Every port passed into the harness, including the AI provider, is wrapped by `recording-proxy.ts`, so `CaseRun.events` records model requests, responses and settings. Events are written only to `runs/suites/<runId>/`, never to CI logs.
- **State queries.** `src/suite/fixtures/state-queries.ts` holds only the L1 accessors. Query names and schemas come from `schema.ts`.
  - The accessors are `questionProgress(group)`, `stagedBundleCount`, `surveyEvidenceCount` and `outboundCount`.
  - Snapshots are taken at `before`, `after` and `afterStep`.
  - `method` is `substituted` for dashboard-origin criteria at L1.
  - Each `kind: 'change'` state criterion in an atomic test is paired with an `effect-count` check that `evaluate` synthesizes from the manifest's `stateEffect`.
- **P-06 at L1.** The executor wires `ProactiveCheckInUseCase` to the harness repositories (the harness doesn't wire it today). It drives check-in generation over the fixture clock to fill `window.outbound`.
- **LangWatch.** LangWatch is an optional sink. With `LANGWATCH_API_KEY` set, the run streams, and the `CaseRun` stays identical either way. No code reads from LangWatch.
- **Conventions:**
  - CLI: `suite:calibrate --suite <id> [--import <file>]`.
  - Exit codes: 0 clean, 1 diff failed, 2 baseline invalid, 3 judge infrastructure, 4 budget exceeded.
  - Log prefix: `[suite]`.
  - Offline tests are named `*.test.ts`, live ones `*.sim.test.ts`.
  - Every suite JSON carries `schemaVersion`.
- **CI design (for reference only; not wired in this run).**
  - The pull-request gate has a `changes` job that diffs against the base sha over the prompt, provider, orchestrator, proactive, policy, quiet-hours and `conversation-sim` paths.
  - Its `l1` job has a fixed name so it can be a required check, emits a notice when skipped, and fails only on rule and S regressions while the judge is untrusted.
  - It reads the baseline from the merge-base, and a change under `baselines/**` needs the `baseline-change` label.
  - The nightly run is n=1 and can't fail on meaning criteria; the weekly run is n=5.

## Cross-Story Dependencies

- **Epic 12 (done).** This epic builds on Epic 12's schema, loader, source manifest, `evaluate`/`score`/`report`, rule registry, `effect-count` synthesis, L0 executor and recording proxy, runner, `suite:run`, `suite:baseline:accept`, `suite:diff` and `suite.config.json`. Extend them; don't fork them.
- **Within this epic:**
  - 13.1 comes before 13.2, because calibration reuses `judgeCriterion` and input building.
  - 13.2 comes before 13.3, because trust reads `agreement.json`.
  - 13.3 comes before 13.5, 13.6 and 13.7, because advisory handling, inconclusive diffs and the accept fingerprint check are needed first.
  - 13.4 comes before 13.5, because budgets, usage and the L1 baseline need the executor.
  - 13.5 comes before 13.6 and 13.7, which depend on an L1 baseline and budgets. Both are constrained by the no-L1-in-CI decision.
- **Epic 14.** L2 reuses the state-query table, adding L2 routes there, and the same diff and trust semantics.

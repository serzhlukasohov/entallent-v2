---
title: 'Story 13.3: Judge Trust, Advisory Statuses and the QA Review List'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: '03b5c0a5ce2d7611d5d6ab85e3503f64fa1d613f'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-conversation-eval-regression-2026-10-17/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The judge fingerprint does not cover passCondition, expectedBehavior or fixtureContext, so editing manifest text keeps an existing agreement trusted although the judge now sees a different prompt.
    evidence: |-
      Carried from Story 13.2 and re-decided in 13.3: kept deferred. AD-8 and NFR7 fix the fingerprint fields (provider, model, decoding, prompt, schema and guidance hashes); folding manifest text into guidanceSha256 or adding a field would silently change the AD-8 contract, which the user forbade. No agreement file exists today (pending QA labels), so nothing is trusted and the hole has no current exposure. Needs a spine-owner decision before the first real agreement file is committed.
    location: >-
      packages/conversation-sim/src/suite/judge/fingerprint.ts (computeJudgeFingerprint)
    severity: medium
  - summary: >-
      An untrusted L1 run can become a baseline whose meaning results carry no advisory flag or compared agreement, so after calibration a trusted FAIL against an uncalibrated PASS diffs as a gating regression.
    evidence: |-
      Blind Hunter (Story 13.3 review). BaselineResultSchema has no advisory field; diff.ts categorize checks only run.advisory; baselineInvalidReasons and baselineRefusals compare fingerprint and coach model but not judge.agreement, so a re-calibration under the same fingerprint keeps the old baseline valid. The baseline and diff contracts come from AD-11/AD-13 (Stories 12.8/12.9); decide in 13.5 (first L1 baseline), e.g. refuse accepting untrusted L1 runs or mark their meaning results inconclusive in the diff.
    location: >-
      packages/conversation-sim/src/suite/diff.ts (categorize), packages/conversation-sim/src/suite/baseline.ts (baselineRefusals, buildBaseline)
    severity: medium
---

<intent-contract>

## Intent

**Problem:** `computeJudgeTrust` and `currentJudgeFingerprint` still throw for L1/L2, so no run can carry a real trust record, an env override of the judge model is not policed, accept cannot compare a real fingerprint, and the report has no QA review list or effective fingerprint.

**Approach:** Compute `JudgeTrust` once per non-L0 run from `suite.config.json`, the run-time `JudgeFingerprint`, the current labels hash and `agreement.json`; police `SIM_JUDGE_MODEL` with `--allow-unpinned-judge`; let the runner pass an injected judge to `evaluate`; add the effective fingerprint and a QA review section (every meaning-based FAIL with case, criterion, reply text and judge reason) to the report; build `currentJudgeFingerprint` on `computeJudgeFingerprint` for accept.

**User decisions (2026-10-25, recorded as intent):** The QA suite `p-v1` (12.4) is out of scope and empty; smoke scenarios live in `smoke-v1` after the framework. No live model calls: tests use fake judges and fake executors; nothing runs the live judge. No real QA labels or agreement files exist (pending QA), so the absent-agreement path is the normal state today and must yield untrusted, advisory meaning results. The default CLI entry still refuses L1/L2 runs until the L1 executor (13.4) exists; this story only makes the non-L0 path reachable with injected executor and judge.

## Boundaries & Constraints

**Always:**
- Trust (`src/suite/judge/trust.ts`, new, pure): `computeJudgeTrust(level, inputs?)` in `runner.ts` keeps L0 exactly `{ trusted: false, reason: 'no-judge-at-level', pin: null, agreement: null }`; for L1/L2 it requires `inputs = { judge: SuiteConfig['judge'], suite, agreement: AgreementFile | null, labelsSha256, unpinned: boolean }` (throw `[suite]` without them) and delegates to `trust.ts`. `pin = computeJudgeFingerprint(judge, suite)` (the configured pin, always set at L1/L2); `agreement` = the file when present, else `null`. The first failing check gives the reason, in this order:
  1. `unpinned` -> `unpinned-judge`
  2. agreement `null` -> `no-agreement`
  3. first differing fingerprint field, in the order `provider, model, decoding, promptSha256, schemaSha256, guidanceSha256` (compared with `stableJson`) -> `fingerprint-mismatch:<field>`
  4. `agreement.labelsSha256 !== labelsSha256` -> `labels-mismatch`
  5. `agreement.n < judge.minLabels` -> `below-min-labels`
  6. `overall` null or `< agreementThreshold.overall` -> `below-threshold:overall`
  7. `kappa` null or `< agreementThreshold.kappa` -> `below-threshold:kappa`
  8. otherwise `trusted: true`, reason `calibrated`.
- `JudgeTrustSchema`: `pin: z.lazy(() => JudgeFingerprintSchema).nullable()`, `agreement: z.lazy(() => AgreementFileSchema).nullable()`, and the `JudgeTrust` type becomes `z.infer` with those types (drop the `& { pin: unknown; agreement: unknown }` widening; keep `BaselineSchema.judge.agreement` compatible, typed as `AgreementFile | null`). Pre-13.3 L0 reports (pin and agreement null) still parse.
- Runner: `RunSuiteInput.judging?: { judge: CriterionJudge; model: string; unpinned: boolean; agreement: AgreementFile | null; labelsSha256: string }`. Required for L1/L2 (`SuiteRunError` without it), rejected at L0. Trust is computed once before the first sample; each test uses `await evaluate(test, run, judging.judge, trust, rules)` at L1/L2 and the unchanged sync call at L0. `models.judge = judging.model` (the model actually called), `models.coach` stays `null` (13.4). `judgeTrust.pin` stays the configured fingerprint even when unpinned.
- CLI `suite:run`: add the `--allow-unpinned-judge` flag. For L1/L2 only, after the config/suite/level checks: `SIM_JUDGE_MODEL` unset, empty or equal to `config.judge.model` -> called model = pin, `unpinned: false`; different without the flag -> refuse (exit 1, nothing written) with `[suite] SIM_JUDGE_MODEL differs from the pinned judge model <pin>; pass --allow-unpinned-judge for an untrusted run` (never print the env value); different with the flag -> called model = the env value, `unpinned: true`. At L0 `SIM_JUDGE_MODEL` and the flag have no effect. Remove the early `level !== 'L0'` throw in `performRun`; the default `createExecutor` keeps refusing L1/L2 with the same message, so the default entry is unchanged. Add `CliDeps.createRunJudge?: (judge: SuiteConfig['judge']) => CriterionJudge`, called with `{ ...config.judge, model: calledModel }`; when absent at L1/L2, refuse `[suite] <level> run needs a judge; this entry wires none (lands with the L1 executor, Story 13.4)`. Read labels with `readLabelsFile` + `labelsSha256(labels.labels)` and the agreement with `readAgreementFile`. `suite:ci` keeps its L0-only guard.
- Console (`summaryLines`): add `[suite] meaning checks: trusted (<reason>)` or `[suite] meaning checks: advisory (uncalibrated) (<reason>)`, and `[suite] QA review: <k> meaning FAIL(s) listed in report.md` when k > 0. Never reply text on the console.
- Report: `SuiteRunReportSchema.qaReview: z.array(QaReviewEntrySchema).optional()` (optional only so pre-13.3 reports parse; `buildSuiteReport` always writes it). `QaReviewEntry = { key, testId, sourceCase, criterionId, layer, sample, advisory, replies: string[], reason: string }`, one per meaning-based FAIL sample: an in-scope `FAIL` result carrying `judgeUsage` (judge FAIL and `no-reply`). It excludes rule FAILs, including `meaningSkipped` ones. `replies` = `buildJudgeInput(test, run, criterion).replyTexts`, empty for `no-reply`. `reason` = the judge reason, or `no-reply`. The runner collects these through a pure `collectQaReview(test, run, sample, results)` in `report.ts`, in sample then test then criterion order, and passes them to `buildSuiteReport` via `SuiteReportMeta.qaReview`.
- `report.md`: after the meaning-checks header line, add `- Judge fingerprint: none (no judge at <level>)` or `- Judge fingerprint: <provider> <model> · temperature <t> · reasoningEffort <r|null> · maxOutputTokens <m> · prompt <sha> · schema <sha> · guidance <sha>` from `judgeTrust.pin`. A `## QA review` section, always present (`None.` when empty), is a table `| Case | Test | Criterion | Layer | Sample | Advisory | Reply | Judge reason |`; replies are joined with ` // ` and every cell goes through `cell()`. `renderCiSummary` gets neither QA review nor reply text (AD-15); it may show the fingerprint line.
- Accept: `currentJudgeFingerprint(level, config, suite)` returns null at L0 and `computeJudgeFingerprint(config.judge, suite)` otherwise; `acceptCommand` loads the suite with `deps.loadSuite(report.suiteId)` for non-L0 only. `baselineRefusals` keeps the fingerprint refusal and also refuses a non-L0 run whose `models.judge` differs from `judgeTrust.pin.model`: `run called judge model <x>, not the pinned <pin>`.
- Diff: keep the existing rule that advisory meaning criteria are `inconclusive`; add an L1 test proving it with a real untrusted trust.
- Log prefix `[suite]`; exit codes unchanged; `agreement.json` literal only in `judge/calibrate.ts`.

**Never:**
- No live model call, network, or `suite:calibrate:live`; no committed `calibration/**` or `baselines/**` files.
- No change to `packages/application`, `apps/*`, `agent-service`, CI workflows, `ScenarioRunReport`, `gate.config.json`, `run-gate.ts`, or the fingerprint fields (AD-8). No P-case content.
- Never default-wire an L1 executor or live judge (13.4); never recompute trust in `score`/`report`; never put reply text in CI summaries or console lines.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Absent agreement (today) | L1, no agreement file | `trusted: false`, `no-agreement`, pin set; meaning results advisory; header advisory | run completes |
| Calibrated | matching fingerprint and labels, n >= 40, overall 0.9, kappa 0.7 | `trusted: true`, `calibrated`; meaning statuses count | none |
| Swapped judge | agreement fingerprint model differs | `fingerprint-mismatch:model` | untrusted |
| Edited guidance | guidance hash differs | `fingerprint-mismatch:guidanceSha256` | untrusted |
| New labels | labels hash differs | `labels-mismatch` | untrusted |
| Few labels / low kappa / null kappa | n 3, or kappa 0.4 or null | `below-min-labels`, or `below-threshold:kappa` | untrusted |
| Env override | `SIM_JUDGE_MODEL=other`, L1, no flag | refusal naming the pin, nothing written | exit 1 |
| Env override allowed | same plus `--allow-unpinned-judge` | `unpinned-judge`, `models.judge: other`, `pin.model: gpt-4o` | exit 0 |
| L0 untouched | `SIM_JUDGE_MODEL=other`, L0 | same report as before plus fingerprint `none` line | exit 0 |
| Meaning FAIL | fake judge FAILs a reply | QA review row with case, criterion, reply text, judge reason | none |
| Silent reply | reply null | QA row with empty replies, reason `no-reply` | none |
| Rule FAIL | rule check FAILs | no QA row | none |
| No judge wired | injected L1 executor, no `createRunJudge` | refusal | exit 1 |
| Accept swapped | L1 run pin differs from current | refused, fingerprint reason | exit 1 |

</intent-contract>

## Code Map

- `packages/conversation-sim/src/suite/runner.ts` -- `computeJudgeTrust(level)` (~30, throws for L1/L2); `runSuite` calls `evaluate(test, run, null, trust, rules)` (~135) and `buildSuiteReport` with `models: { coach: null, judge: null }` (~160); add `judging`, the async branch and QA collection.
- `packages/conversation-sim/src/suite/baseline.ts` -- `currentJudgeFingerprint(level)` (~26, throws); `baselineRefusals` fingerprint check via `stableJson(report.judgeTrust.pin)` (~60); `buildBaseline` copies `judgeTrust.pin/agreement`.
- `packages/conversation-sim/src/suite/judge/fingerprint.ts` -- `computeJudgeFingerprint(judge, suite)`; reuse, do not change.
- `packages/conversation-sim/src/suite/judge/calibrate.ts` -- `readAgreementFile` (null when absent, throws on invalid), `readLabelsFile`, `labelsSha256`; the only `agreement.json` literal.
- `packages/conversation-sim/src/suite/evaluate.ts` -- overloads `judge: null` (sync) / `CriterionJudge` (Promise); already sets `advisory: !trust.trusted` on meaning-decided results and `judgeUsage` on every meaning-decided one, including `no-reply`.
- `packages/conversation-sim/src/suite/judge/judge-input.ts` -- `buildJudgeInput(test, run, criterion).replyTexts` for QA replies.
- `packages/conversation-sim/src/suite/score.ts` -- advisory exclusion already in `countsTowardVerdict` (~190) and aggregate `advisory` (~156); no change expected.
- `packages/conversation-sim/src/suite/diff.ts` -- `categorize` already returns `inconclusive` for advisory meaning (~225); `baselineInvalidReasons` compares fingerprints.
- `packages/conversation-sim/src/suite/report.ts` -- `SuiteReportMeta`, `buildSuiteReport`, `renderSuiteReportMarkdown` (meaning-checks line ~180), `renderCiSummary` (must stay evidence-free), `cell()`, `pushList`.
- `packages/conversation-sim/src/suite/schema.ts` -- `JudgeTrustSchema` (~633, with the `unknown` widening), `SuiteRunReportSchema` (~845), `JudgeFingerprintSchema` (~920), `AgreementFileSchema` (~1043), `BaselineSchema.judge` (~1077).
- `packages/conversation-sim/src/suite/cli.ts` -- `parseArgs` run options (~143), `defaultDeps().createExecutor` (refuses non-L0), `performRun` (~330, early non-L0 throw to remove; L0 `scrubModelCredentials`), `acceptCommand` (~550), `summaryLines` (~660), `HELP`, `CliDeps`.
- Tests and fixtures: `runner.test.ts` (~34 `computeJudgeTrust` throw tests to replace), `baseline.test.ts` (~132), `cli.test.ts` (~221, ~366, ~986 "lands in Epic 13" expectations: keep the default-entry ones and update accept), `report.test.ts`, `diff.test.ts`, `__fixtures__/runner.ts` (`RUNNER_CONFIG`, `fakeSuite`, `fakeExecutor`, `cleanRun`), `judge/__fixtures__/calibration.ts` (`fakeJudge`, `calibrationSuite`, `label`), `executors/import-graph.test.ts` (runner/CLI must not reach `live-judge-model.ts`).
- `packages/conversation-sim/README.md` -- suite commands and trust docs.

## Tasks & Acceptance

**Execution:**
- `packages/conversation-sim/src/suite/schema.ts` -- typed lazy `pin`/`agreement` in `JudgeTrustSchema`, `QaReviewEntrySchema`, optional `qaReview` on the report -- one Zod source.
- `packages/conversation-sim/src/suite/judge/trust.ts` (new) -- the pure trust decision with the reason order -- AD-8 in one place.
- `packages/conversation-sim/src/suite/runner.ts` -- `computeJudgeTrust(level, inputs?)`, `judging`, async evaluate at L1/L2, `models.judge`, QA collection -- runner owns trust.
- `packages/conversation-sim/src/suite/report.ts` -- `collectQaReview`, meta `qaReview`, fingerprint line, `## QA review` section -- report surface.
- `packages/conversation-sim/src/suite/baseline.ts` -- `currentJudgeFingerprint(level, config, suite)`, unpinned-model refusal -- accept check.
- `packages/conversation-sim/src/suite/cli.ts` -- `--allow-unpinned-judge`, `createRunJudge`, non-L0 run path, accept suite loading, console trust/QA lines, help -- CLI surface.
- `packages/conversation-sim/README.md` -- trust reasons, the unpinned flag, the QA review section.
- Tests: `judge/trust.test.ts` (every reason in the matrix, order precedence, null overall/kappa), `runner.test.ts` (L1 with fake executor + `fakeJudge`: trust computed once, advisory results excluded from layers and verdict, `models.judge`, QA review rows incl. `no-reply` and no row for rule FAILs; `judging` required/rejected by level), `report.test.ts` (fingerprint lines L0/L1, QA table escaping, CI summary without reply text), `baseline.test.ts` (`currentJudgeFingerprint`, unpinned-model refusal), `cli.test.ts` (every CLI matrix row through `main` with injected L1 `createExecutor` and `createRunJudge`, tmp dir, synthetic agreement written through `writeAgreementFile`; default entry still refuses L1 with the same message), `diff.test.ts` (untrusted L1 meaning criterion is `inconclusive`, never `regressed`).

**Acceptance Criteria:**
- Given an injected L1 executor and fake judge and no agreement file, when `main(['run', '--suite', 'x-suite', '--level', 'L1'])` runs, then `report.json` has `judgeTrust.trusted: false`, reason `no-agreement`, `pin` equal to `computeJudgeFingerprint(config.judge, suite)`, every meaning-decided result `advisory: true` and outside the layer counts, and `report.md` shows `advisory (uncalibrated)`, the fingerprint line and the QA review rows.
- Given a synthetic agreement file that matches the fingerprint and labels and meets the thresholds, when the same run executes, then `trusted: true` with reason `calibrated` and the meaning statuses count toward pass rate and verdict.
- Given the default CLI entry, when `suite:run --suite smoke-v1 --level L0` and `--level L1` run, then L0 behaves as before (plus the fingerprint `none` line) and L1 still refuses with the 13.4 executor message, and no model is constructed.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 29 findings — high 0, medium 1, low 19, false 9, maybe-false 0
- findings:
  - `[medium]` `[defer]` (blind) An untrusted L1 run can be accepted as a baseline, and `BaselineResult` records no advisory flag, so once the judge becomes calibrated a trusted FAIL against an uncalibrated PASS shows as a gating `regressed` — real, but the baseline shape and `categorize` (only `run.advisory`) come from Stories 12.8/12.9 and AD-11/AD-13; fixing it changes the baseline contract; deferred to 13.5 (first L1 baseline).
  - `[low]` `[defer]` (blind) The agreement stored in a baseline is never compared by accept or diff, so re-calibration under the same fingerprint keeps an old baseline valid — same root as the advisory-baseline finding (AD-13 provenance checks name fingerprint and coach model only); deferred with it.
  - `[low]` `[patch]` (blind) `FINGERPRINT_FIELDS` is not checked for completeness, so a new fingerprint field would be skipped — compile-time exhaustiveness assertion added.
  - `[low]` `[reject]` (blind) Trust reasons are an untyped string — adds public type surface; reasons are fixed in one module and tested.
  - `[false]` `[reject]` (blind) `below-min-labels` reads the agreement's own `n` — `labelsSha256` must match the current labels first, and `n` is computed by `suite:calibrate` over exactly those labels; only a hand-edited file could differ (fixture inconsistency is test-only).
  - `[false]` `[reject]` (blind) Per-layer agreement is ignored — the AC and AD-8 define the thresholds as overall 0.85 and kappa 0.6 only.
  - `[low]` `[patch]` (blind) `SIM_JUDGE_MODEL` is not trimmed — value trimmed, whitespace-only treated as unset; tests added.
  - `[low]` `[reject]` (blind) `--allow-unpinned-judge` at L0 is silent — documented as having no effect; a log line adds a branch for no behavior.
  - `[low]` `[reject]` (blind) QA review has no cap — the AC asks for every meaning FAIL with its reply text; report.md is a local, gitignored artifact.
  - `[low]` `[patch]` (blind) `cell()` does not escape `\r` or a backslash before a pipe — backslashes escaped and every line break replaced; test added. Markdown/HTML in replies rejected (cosmetic, local report).
  - `[low]` `[reject]` (blind) The "trust decided once" test is weak — trust is one statement before the sample loop and the shared object is passed to every evaluate; a stronger spy adds machinery.
  - `[low]` `[reject]` (blind) No test for corrupt agreement/labels files at run time, L2 judging or a missing `regressed` counter — a corrupt file throws before anything is written (exit 1, readers covered by 13.2 tests); L2 shares the non-L0 branch; the counter is always present.
  - `[low]` `[patch]` (blind) README "(a null agreement or kappa is below)" is ambiguous — reworded to null `overall` or `kappa`.
  - `[low]` `[reject]` (edge) `maxJudgeCallsPerRun` is not enforced — budgets are Story 13.5 per the epic; the default entry cannot reach L1.
  - `[low]` `[patch]` (edge) `SIM_JUDGE_MODEL` with padding or whitespace only — grouped with the blind trim finding; fixed there.
  - `[low]` `[reject]` (edge) The default entry with a non-pin `SIM_JUDGE_MODEL` at L1 refuses with the model message instead of the executor message — both are exit-1 refusals writing nothing; the AC places the model refusal at run start.
  - `[low]` `[reject]` (edge) A corrupt agreement or labels file aborts with a `[suite] calibrate:` prefix — the message names the suite and file and the problem; rewording is cosmetic.
  - `[low]` `[patch]` (edge) A `\r` in a reply breaks the QA table row — grouped with the blind `cell()` finding; fixed there.
  - `[false]` `[reject]` (edge, claim) The printed "effective" fingerprint is the configured pin even on an unpinned run — AD-8 says the effective judge model is the config pin and the report records `models.judge` (called) and `judgeTrust.pin` (configured); the Models line shows the called model.
  - `[low]` `[reject]` (edge, claim) L0 output gains more than the fingerprint line (console trust line, empty QA section) — all are spec'd additions; no committed golden L0 outputs exist.
  - `[low]` `[patch]` (verification-gap) No L1 run test has a labels file on disk, so the run-side labels hash is unverified — test added (calibrated with matching labels, then `labels-mismatch` after editing them).
  - `[low]` `[patch]` (verification-gap) A baseline with a non-null agreement is never written or read back — accept test of a calibrated L1 run added, asserting the stored agreement and a non-invalid diff.
  - `[false]` `[reject]` (intent) The default `suite:run` cannot run L1 — the user decision keeps L1 refused until 13.4; the AC surface is exercised through `main` with injected fakes.
  - `[false]` `[reject]` (intent) `advisory`, score exclusion and diff `inconclusive` were not newly implemented — they pre-exist from 12.x/13.1 and are now proven on the L1 path by new tests.
  - `[low]` `[reject]` (intent) report.md header is capitalized with a reason suffix rather than the literal `meaning checks: advisory (uncalibrated)` — the console line is the exact literal; the md line keeps the 12.x style.
  - `[false]` `[reject]` (intent) The fingerprint printed is the pin, not the called model — AD-8 as above.
  - `[false]` `[reject]` (intent) Accept adds a called-model refusal beyond the fingerprint check — spec'd, closes the unpinned-baseline hole (Design Notes).
  - `[false]` `[reject]` (intent) QA review rows are per sample — "every meaning-based FAIL" is per evaluated FAIL; per-sample is the only reading that lists every one.
  - `[false]` `[reject]` (intent) Finalize (status done, commit) is not in the diff — finalization follows review.

## Design Notes

Reasons are single and ordered so the report names the most actionable cause first: an unpinned model makes any agreement irrelevant, an absent file is today's normal state, and fingerprint drift comes before label drift because a re-pin invalidates labels' agreement too. Null `overall`/`kappa` (n = 0 or chance agreement 1) are treated as below threshold.

The CLI's L1 path is opened only through dependency injection: the default `createExecutor` still throws, so the user decision "no L1 runs until 13.4" holds, while the AC's `suite:run` surface (refusal, unpinned run, report contents) becomes testable end to end with fakes.

`judgeTrust.pin` stays the configured fingerprint even for unpinned runs (AD-8), so accept also compares `models.judge` with `pin.model`; otherwise an unpinned run could become a baseline whose fingerprint claims the pin.

## Verification

**Commands:**
- `pnpm --filter @entalent/conversation-sim test` -- expected: pass offline.
- `pnpm --filter @entalent/conversation-sim typecheck` and `pnpm --filter @entalent/conversation-sim lint` -- expected: no errors.
- `pnpm --filter @entalent/conversation-sim suite:run --suite smoke-v1 --level L0` -- expected: exit 0, report.md has the fingerprint `none` line and an empty QA review section.
- `pnpm --filter @entalent/conversation-sim suite:run --suite smoke-v1 --level L1` -- expected: exit 1 with the 13.4 executor message, nothing written.
- `pnpm typecheck` -- expected: no errors.
- `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` -- expected: passing receipt.

## Auto Run Result

**Summary:** Judge trust for L1/L2. `judge/trust.ts` (new, pure) decides `JudgeTrust` once per run from the judge config, the run-time `computeJudgeFingerprint` pin, the current labels hash and the agreement file, with one ordered reason: `unpinned-judge` > `no-agreement` > `fingerprint-mismatch:<field>` (provider, model, decoding, promptSha256, schemaSha256, guidanceSha256; compile-time exhaustive) > `labels-mismatch` > `below-min-labels` > `below-threshold:overall` > `below-threshold:kappa` (null counts as below) > trusted `calibrated`. `pin` is always the configured fingerprint. The runner takes a `judging` input (required at L1/L2, rejected at L0), evaluates with the injected judge, records `models.judge` (the model called) and collects QA review entries. Reports gain `qaReview` (every meaning-based FAIL sample, judge FAIL or `no-reply`, with case, test, criterion, layer, sample, advisory, reply texts and judge reason; never rule FAILs), a `## QA review` table in report.md and the effective fingerprint line in report.md and the CI summary (no reply text in CI or console). `suite:run` polices a trimmed `SIM_JUDGE_MODEL` at L1/L2 (refuses without `--allow-unpinned-judge`, never printing the value) and takes an injectable `createRunJudge`; the default entry still wires no L1 executor or judge, so L1 stays refused until 13.4. Accept computes the current fingerprint from config and suite and refuses a run whose called judge model is not the pin. Absent agreement (today's state) yields `no-agreement`, advisory meaning results excluded from pass rate and verdict, and `inconclusive` meaning diffs. No live model call anywhere.

**Files changed** (under `packages/conversation-sim/` unless noted):
- `src/suite/judge/trust.ts` (new) -- the single trust decision.
- `src/suite/schema.ts` -- typed `JudgeTrust.pin`/`agreement` (lazy), `QaReviewEntrySchema`, optional `qaReview` on the report, typed `Baseline.judge.agreement`.
- `src/suite/runner.ts` -- `computeJudgeTrust(level, inputs?)`, `judging`, async evaluate at L1/L2, `models.judge`, QA collection.
- `src/suite/report.ts` -- `collectQaReview`, `fingerprintLine`, QA review section, stronger `cell()` escaping.
- `src/suite/baseline.ts` -- `currentJudgeFingerprint(level, config, suite)`, called-model refusal.
- `src/suite/cli.ts` -- `--allow-unpinned-judge`, `judgeModelToCall`, `createRunJudge`, non-L0 run path, accept suite loading, console trust and QA lines, help.
- `src/suite/judge/trust.test.ts` (new), `runner.test.ts`, `cli.test.ts`, `report.test.ts`, `baseline.test.ts`, `diff.test.ts`, `__fixtures__/runner.ts` -- tests and L1 fixtures (fake executors and judges only).
- `README.md` -- trust reasons, unpinned flag, QA review.
- `docs/agent-task-log.md` (repo root) -- task row.

**Review:** 29 findings (high 0, medium 1, low 19, false 9). Patches applied (8 rows, 6 fixes, all low): fingerprint-field exhaustiveness check; trimmed `SIM_JUDGE_MODEL`; `cell()` escapes backslashes and every line break; README null-threshold wording; L1 run test with a labels file on disk (calibrated, then `labels-mismatch`); calibrated L1 accept test storing the agreement and diffing as valid. Deferred (1 new, medium): untrusted L1 runs can become baselines without an advisory flag or agreement comparison, so after calibration a trusted FAIL vs an uncalibrated PASS gates (AD-11/AD-13 contract; decide in 13.5). Carried deferred: manifest text not in the fingerprint (AD-8 contract; spine-owner decision before the first real agreement file). Rejected: untyped trust reasons (adds surface); `below-min-labels` from the agreement's own n (false: labels hash binds it); per-layer thresholds (false: AC defines overall and kappa only); silent `--allow-unpinned-judge` at L0; uncapped QA list (AC asks for every FAIL); weak trust-once test; missing corrupt-file/L2/counter tests; budget enforcement (13.5); model-refusal before executor message on the default entry; `[suite] calibrate:` prefix on corrupt files; pin as effective fingerprint (false: AD-8); extra L0 output (spec'd); intent-audit divergences (L1 only via injection per the user decision, pre-existing advisory/score/diff behavior now proven on L1, capitalized md header with the exact literal on the console, called-model accept check, per-sample QA rows, finalization timing).

**Follow-up review recommended:** false -- every patched entry was low; no high or medium patched.

**Verification:** `pnpm --filter @entalent/conversation-sim test` 47 files / 838 tests pass offline; package typecheck and lint clean; root `pnpm typecheck` 24/24; plain-env `suite:run --suite smoke-v1 --level L0` exit 0 (fingerprint `none` line, empty QA review); `suite:run --suite smoke-v1 --level L1` exit 1 with the executor message, nothing written; `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` passed, receipt `runs/harness/receipt-1792958248025-231c7af7.json`. No live judge or model was run.

**Residual risks:** trust has never seen a real agreement file (QA labels pending); the two deferred contract questions (manifest text in the fingerprint; advisory baselines) must be settled before the first real agreement and L1 baseline; the L1 CLI path is exercised only with injected fakes until 13.4 wires the executor and run judge.

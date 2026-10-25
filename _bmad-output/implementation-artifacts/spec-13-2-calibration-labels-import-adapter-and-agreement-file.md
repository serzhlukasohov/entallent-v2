---
title: 'Story 13.2: Calibration Labels, Import Adapter and Agreement File'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: 'f150153f529aad8ef1bac30c7f50b57cf36565ae'
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
      Blind Hunter (Story 13.2 review). computeJudgeFingerprint hashes the prompt template, output schema and judgeGuidance only, as AC 13.2 and AD-8 define; labelJudgeInput and buildJudgeInput also send passCondition, expectedBehavior and fixtureContext. Widening the fingerprint (for example a hash of the resolved manifest criteria and source cases) changes the AD-8 contract; decide in 13.3 or with the spine owner.
    location: >-
      packages/conversation-sim/src/suite/judge/fingerprint.ts (computeJudgeFingerprint)
    severity: medium
---

<intent-contract>

## Intent

**Problem:** The judge (13.1) exists, but there is no way to turn QA's manual-run results into labels, no measured agreement between the judge and humans, and `suite:calibrate` is a stub, so 13.3 has nothing to compute trust from.

**Approach:** Add a Zod label schema and labels file, a QA-export import adapter that appends deduplicated labels, a run-time `JudgeFingerprint` (prompt, output-schema and guidance hashes), and a `suite:calibrate` command that judges every label through an injected `CriterionJudge` with the same input building and evidence rules as `evaluate`, then writes `calibration/<suite>/agreement.json` and prints the per-layer table and the disagreements.

**User decisions (2026-10-25, recorded as intent):** The QA suite `p-v1` (12.4) is out of scope and empty; smoke scenarios live in `smoke-v1` after the framework. No live model call anywhere in this story: `suite:calibrate` judges through an injected `CriterionJudge`; tests use a fake judge; a live path built on `createLiveJudgeModel` may exist behind an explicit flag for a human-run calibration but no test, script or CI step runs it. QA owns the real labels: build the adapter, schema, agreement computation and file against synthetic fixtures; commit no labels and no agreement file (the committed state is "absent, pending QA labels").

## Boundaries & Constraints

**Always:**
- Schemas live in `schema.ts` (strict, `schemaVersion: 1`):
  - `Label = { criterionId, status: 'PASS'|'FAIL', transcript: { turns: [{ role: 'user'|'coach', text }] (min 1), evaluatedReplyIndex: number|null }, source: { kind: 'qa-session'|'suite-run', ref: string }, labeler: string, labeledAt: ISO }`. Refinement: a non-null `evaluatedReplyIndex` is the last turn's index and that turn is `coach`; a null one needs at least one `coach` turn.
  - `LabelsFile = { schemaVersion: 1, labels: Label[] }` at `packages/conversation-sim/calibration/<suiteId>/labels.json`; an absent file means zero labels.
  - `QaSessionExport = { schemaVersion: 1, sessions: [{ ref, labeler, labeledAt, dialogue: Turn[] (min 1), statuses: [{ criterionId, status: 'PASS'|'FAIL', replyIndex: number|null }] (min 1) }] }`. `replyIndex` indexes `dialogue` and must be a `coach` turn; `null` means the whole conversation. This format is our assumption until QA confirms theirs; keep the converter one function so a format change stays local.
  - `AgreementFile = { schemaVersion: 1, fingerprint: JudgeFingerprint, labelsSha256, n, overall: number|null, kappa: number|null, perLayer: { P|D|C|S: { n, overall, kappa } }, computedAt }` (exactly these keys; all four layers always present, nulls when `n = 0`).
- Import (`suite:calibrate --suite <id> --import <file>`): each status becomes one label: transcript = `dialogue` up to and including `replyIndex` (whole dialogue when null), `evaluatedReplyIndex` = `replyIndex`, `source = { kind: 'qa-session', ref: session.ref }` (provenance only, never read for judging), `labeler`/`labeledAt` from the session. Dedup key `(criterionId, transcriptSha256)` where `transcriptSha256 = sha256(stableJson(transcript))`, against existing labels and within the import; the first label wins, a duplicate is skipped with a warning (and the differing status named when it differs). Existing labels are never rewritten, reordered or re-statused; new ones are appended in export order. Any invalid export entry (schema, unknown or not-judgeable criterion, scope mismatch) rejects the whole import and writes nothing. `--import` resolves against `INIT_CWD ?? cwd`.
- Label context resolution (shared by import validation and calibration): the criterion must be in the suite manifest and not NOT TESTABLE. Its judged contexts are the tests where it has a `meaning` check and `evaluatedAt` is `reply:<n>`, `after-step:<n>` or `conversation`. Zero contexts is `not-judgeable`; contexts that differ in `judgeGuidance`, `fixtureContext(test)` or scope (`conversation` vs reply) are `ambiguous-context`. The scope must match the label (`conversation` ⇔ `evaluatedReplyIndex: null`).
- Calibration (`suite:calibrate --suite <id>`, with a judge): per label in file order, `JudgeInput = { transcript: label.transcript, expectedBehavior (source case), passCondition, layer (manifest), judgeGuidance, fixtureContext (resolved context) }`; evidence reply texts = the evaluated turn's text, or every coach turn for a null index. The call, single re-ask and evidence verification are the same code `evaluate` uses: extract `evaluate`'s meaning-phase call logic into `judge/decide-meaning.ts` and call it from both, with `evaluate`'s observable behavior unchanged. Judge ERROR counts as a disagreement (its own category in kappa) and makes the exit code 3; the file is still written.
- Agreement: `overall = agreeing / n`; Cohen's kappa over categories PASS/FAIL/ERROR, `kappa = (po - pe) / (1 - pe)`, `null` when `n = 0` or `pe = 1`; per layer the same over that layer's labels. `labelsSha256 = sha256(stableJson(labels))` over the parsed labels array, exported for 13.3. `computedAt = deps.now()`.
- Fingerprint (`judge/fingerprint.ts`): `computeJudgeFingerprint(judgeConfig, suite)` = `{ provider, model, decoding }` from config + `promptSha256: JUDGE_PROMPT_SHA256` + `schemaSha256 = sha256(stableJson(zodSchema(JudgeOutputSchema).jsonSchema))` (throw `[suite]` if it is not synchronous) + `guidanceSha256 = sha256(stableJson({ "<testId>/<criterionId>": judgeGuidance }))` over every criterion that has guidance (empty object when none). Do not change `currentJudgeFingerprint` or `computeJudgeTrust` (13.3 wires them).
- Output: per-layer table `[suite] layer  n  agree  kappa` plus an `all` row; one `[suite] disagreement:` line per disagreeing label with criterion, label status, judge status, `source.ref`, `labeledAt` and the judge reason (or error code); judge usage totals; when `n < config.judge.minLabels`, `[suite] warning: <n> labels is below minLabels <m>`, and the file is still written. Only `judge/calibrate.ts` names `agreement.json`; 13.3 reads it through its exported path/read helper.
- Judge injection: `CliDeps.createCalibrationJudge?: (judge: SuiteConfig['judge']) => CriterionJudge`. Without it, `calibrate` without `--import` exits 1 with a hint naming `suite:calibrate:live`; with `--import` it imports and prints that calibration was skipped (exit 0). With it, `--import` imports and then calibrates.
- Live entry `src/suite/judge/calibrate-live.ts` (package script `suite:calibrate:live`, root alias): refuses (exit 1, no model built) unless `--live-judge` is passed; with it, strips the flag and calls `main` with `createCalibrationJudge` built from `createLiveJudgeModel(judge, process.env)` and `createCriterionJudge`. The CLI, runner and executor graphs never reach it (import-graph test updated).
- Exit codes: 0 written / import done; 1 usage, config, unknown suite, load, invalid labels or export, unresolvable label; 3 any judge ERROR. Log prefix `[suite]`; never print environment values.

**Never:**
- No live model call or network access in any test or script; never read or print real secrets; never run `suite:calibrate:live`.
- No committed `calibration/**` files, no invented labels, no agreement file from fake data.
- No change to `packages/application`, `apps/*`, `agent-service`, CI workflows, `computeJudgeTrust`, `currentJudgeFingerprint`, the trust/advisory wiring or the report (13.3), and no P-case content.
- Never edit a stored label status; never decide by wording.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Import new | export with 2 statuses, no labels file | file created with 2 labels, truncated transcripts, `source.kind: qa-session` | exit 0 |
| Import duplicate | same export imported again | file unchanged, 2 skip warnings | exit 0 |
| Conflicting duplicate | same transcript and criterion, other status | existing label kept, warning names both statuses | exit 0 |
| Bad export | `replyIndex` on a user turn, or unknown criterion | nothing written, error names session ref and criterion | exit 1 |
| Calibrate agree | fake judge matches every label | `overall: 1`, perLayer filled, file written | exit 0 |
| Disagreement | fake judge FAILs a PASS label | disagreement line printed, `overall < 1` | exit 0 |
| Judge error | fake judge rejects for one label | counted as disagreement, listed with `judge-transport` | file written, exit 3 |
| Below minimum | 3 labels, `minLabels: 40` | warning printed, file still written | exit 0 |
| No labels | absent labels file | `n: 0`, `overall`/`kappa` null, warning | exit 0 |
| Ambiguous context | criterion with different guidance in two tests | refuses before any judge call | exit 1 |
| No judge | `suite:calibrate --suite x` via the default entry | hint naming `suite:calibrate:live`, nothing written | exit 1 |
| Live without flag | `calibrate-live.ts calibrate --suite x` | refuses, no model built | exit 1 |

</intent-contract>

## Code Map

- `packages/conversation-sim/src/suite/cli.ts` -- `ParsedCommand` `calibrate` (no flags today), stub in `main` ("lands in Epic 13"), `HELP` text, `CliDeps` (add `createCalibrationJudge`), `--summary` path resolution via `INIT_CWD` (reuse for `--import`), `loadSuiteConfig` + `config.suites` check as in `performRun`.
- `packages/conversation-sim/src/suite/evaluate.ts` -- `meaningPhase` (~120) and `callJudge` (~159): the call, re-ask, evidence verification and FAIL-evidence drop to extract into `judge/decide-meaning.ts`; keep the `no-reply` branch and result mapping in `evaluate`.
- `packages/conversation-sim/src/suite/judge/criterion-judge.ts` -- `JudgeOutputSchema`, `CriterionJudge`, `MeaningOutcome`, `evidenceMatches`, `addJudgeUsage`, `emptyJudgeUsage`, `createCriterionJudge`.
- `packages/conversation-sim/src/suite/judge/judge-input.ts` -- `fixtureContext(test)` (reuse for label context), `buildJudgeInput` (reference for the input shape).
- `packages/conversation-sim/src/suite/judge/prompt.ts` -- `JUDGE_PROMPT_SHA256`.
- `packages/conversation-sim/src/suite/judge/live-judge-model.ts` -- `createLiveJudgeModel(judge, env)`; only `calibrate-live.ts` may import it.
- `packages/conversation-sim/src/suite/schema.ts` -- `JudgeFingerprintSchema` (~920, already complete), `SuiteConfigSchema.judge` (`minLabels`, `agreementThreshold`), `parseEvaluatedAt`, `LayerSchema`, `IsoTimestampSchema` (~451, local const), `LoadedSuite.sources`.
- `packages/conversation-sim/src/suite/baseline.ts` -- `stableJson` (~142) for hashing.
- `ai` 6: `zodSchema(schema).jsonSchema` is synchronous for zod 3 (probed).
- `packages/conversation-sim/src/suite/executors/import-graph.test.ts` -- `forbiddenImports`, entries `EXECUTOR`/`RUNNER`/`CLI`; dynamic `import('...')` literals are walked as whole imports.
- `packages/conversation-sim/src/suite/cli.test.ts` -- `harness()` with tmp `packageDir`, injected `loadSuite` (`x-suite` = `fakeSuite`), calibrate stub test (~584) to replace.
- `packages/conversation-sim/src/suite/__fixtures__/suite.ts`, `__fixtures__/runner.ts` -- `validSources`, `atomicTest`, `journeyTest`, `RUNNER_CONFIG` (suites include `x-suite`); `X-01.C1` is meaning-judged only in `X-01.J` (`reply:2`).
- `package.json` (repo root) -- `suite:calibrate` alias; add `suite:calibrate:live`. `packages/conversation-sim/README.md` ~254 documents the stub.

## Tasks & Acceptance

**Execution:**
- `packages/conversation-sim/src/suite/schema.ts` -- add `LabelSchema`, `LabelsFileSchema`, `QaSessionExportSchema`, `AgreementFileSchema` and types -- one Zod source for 13.3.
- `packages/conversation-sim/src/suite/judge/decide-meaning.ts` (new) + `evaluate.ts` -- extract the meaning call logic; `evaluate` uses it unchanged -- "exactly as evaluate would".
- `packages/conversation-sim/src/suite/judge/fingerprint.ts` (new) -- schema and guidance hashes, `computeJudgeFingerprint` -- AD-8 fingerprint.
- `packages/conversation-sim/src/suite/judge/calibrate.ts` (new) -- paths and read/write helpers, `transcriptSha256`, `labelsSha256`, label context resolution, `importQaExport`, `computeAgreement`, `calibrate`, console lines -- the sole agreement writer.
- `packages/conversation-sim/src/suite/judge/calibrate-live.ts` (new) -- live entry behind `--live-judge`.
- `packages/conversation-sim/src/suite/cli.ts` -- parse `--suite`/`--import`, calibrate command, help and exit codes.
- `packages/conversation-sim/package.json`, root `package.json`, `packages/conversation-sim/README.md` -- `suite:calibrate:live` script/alias and command docs.
- Tests: `judge/calibrate.test.ts` (import, dedup, conflicts, invalid export, context resolution, kappa and per-layer math incl. nulls, fake-judge calibration, ERROR as disagreement), `judge/fingerprint.test.ts` (hash stability and sensitivity to guidance, schema, config), `judge/decide-meaning.test.ts` or existing `evaluate.test.ts` passing unchanged, `cli.test.ts` (every I/O row through `main` with a fake `createCalibrationJudge`, tmp dir), `judge/calibrate-live.test.ts` (refusal without the flag; with it, a stubbed judge factory receives the stripped argv; no model built), `executors/import-graph.test.ts` (CLI/runner/executor never reach `calibrate-live.ts`; spawn `calibrate-live.ts` without the flag in plain Node exits 1), a test that no `src/` file except `judge/calibrate.ts` and tests contains `agreement.json`.

**Acceptance Criteria:**
- Given a labels file and a QA export, when `main(['calibrate', '--suite', 'x-suite', '--import', <file>])` runs, then labels are appended without duplicating `(criterionId, transcript hash)`, statuses of existing labels are unchanged and `ref` is stored only as provenance.
- Given labels and a fake judge, when `main(['calibrate', '--suite', 'x-suite'])` runs, then the judge received inputs equal to what `buildJudgeInput` produces for an equivalent run, and `calibration/x-suite/agreement.json` parses with `AgreementFileSchema`, its `fingerprint` equals `computeJudgeFingerprint(config.judge, suite)` and its `labelsSha256` matches the labels file.
- Given the default CLI and `suite:run --suite smoke-v1 --level L0`, when run, then results and exit codes are unchanged and no model is constructed.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 33 findings — high 0, medium 2, low 17, false 12, maybe-false 2
- findings:
  - `[medium]` `[defer]` (blind) The fingerprint does not hash `passCondition`, `expectedBehavior` or `fixtureContext`, so a manifest text edit keeps an agreement trusted — real, but the AC and AD-8 fix the fingerprint fields (provider, model, decoding, prompt, schema, guidance); widening it is an architecture decision for 13.3/the spine owner; deferred.
  - `[false]` `[reject]` (blind) The agreement file lacks error and confusion counts, so 13.3 cannot tell an outage from disagreement or spot degenerate kappa — the AC fixes the file's keys; ERROR lowers agreement and degenerate kappa is null or low, both of which leave the judge untrusted, so no unsafe trust results.
  - `[low]` `[reject]` (blind) A degraded run (many judge ERRORs) overwrites a good agreement file — the spec mandates writing with exit 3; the effect is conservative (lower trust) and the committed file is restorable from git; a guard adds branching.
  - `[low]` `[reject]` (blind) Conflicting human labels on one transcript are settled first-wins with a warning — the AC dedups on `(criterionId, transcript hash)` and forbids editing statuses; the warning names both statuses for QA; exclusion policy would be new behavior.
  - `[low]` `[reject]` (blind) Label and agreement writes are not atomic — interruption mid-write is unlikely and both files live in git; temp-and-rename adds code for an edge nobody meets in practice.
  - `[low]` `[patch]` (blind) `after-step:<n>` contexts are accepted but never tested against `buildJudgeInput` — grouped with the verification-gap after-step finding; test added.
  - `[false]` `[reject]` (blind) Disagreement lines print the judge's free-text reason — the AC requires printing disagreements for QA review; calibration is human-run and never in CI, where the evidence-free summary policy applies.
  - `[low]` `[reject]` (blind) The live calibration has no budget, timeout or progress output — the per-call timeout is already deferred from 13.1 to 13.4/13.5; budgets land in 13.5; the run is human-started.
  - `[false]` `[reject]` (blind) The harness base `3af7d0e` differs from `baseline_revision` — the user mandated that base (the epic base); the receipt covering a larger diff is intended.
  - `[low]` `[patch]` (blind) `perLayer` is built from `LayerSchema.options` and cast to the strict `{ P, D, C, S }` type — replaced with an explicit literal so drift fails at compile time.
  - `[low]` `[reject]` (blind) The "only calibrate.ts names agreement.json" test is a bypassable grep — it is a cheap tripwire; an import-graph ownership check adds machinery for a rule reviewers also enforce.
  - `[false]` `[reject]` (blind) The live entry's `.then` without `.catch` yields an unhandled rejection — `defaultDeps` only builds objects and `main` catches every error inside its try, including the judge factory; no reachable throw escapes.
  - `[low]` `[patch]` (blind) `calibrate-live.test.ts` never checks that the model gets `cliDeps.env` and the pin or that decoding is passed — assertions added.
  - `[low]` `[patch]` (blind) The wrong-schemaVersion import test checks only `ok === false`; fallback branches of `describeExportIssue` untested — error-text assertion added; fallback branches rejected as low (cosmetic message wording).
  - `[low]` `[reject]` (edge) Conversation labels accept PASS evidence from seed coach turns, unlike `buildJudgeInput` — QA session exports (the only label producer) carry no seed history, so every coach turn is the coach under test; matching evaluate for future `suite-run` labels needs a schema seed boundary (spec change); noted for whoever adds a `suite-run` producer.
  - `[low]` `[patch]` (edge) An export status with `replyIndex: null` on a dialogue without a coach turn passes import validation and then fails in `writeLabelsFile` with a raw ZodError — each converted label is now validated with `LabelSchema` inside `importQaExport`, rejecting the import with session ref and criterion; test added.
  - `[low]` `[patch]` (edge) `--import` with a judge factory that throws writes labels and then exits 1 — the judge is now built before the import; test added.
  - `[medium]` `[patch]` (edge) The import-graph spawn test asserts `calibration/` does not exist under the package, which breaks once QA commits labels — now asserts the run changed nothing under `calibration/`.
  - `[low]` `[reject]` (edge) `--live-judge` given as another option's value is stripped and changes argv meaning — contrived input; the result is a usage error, not a wrong run.
  - `[false]` `[reject]` (edge) A `replyIndex` naming a coach turn with no preceding user turn makes a transcript no run can produce — seeded history can open with a coach turn (the suite fixtures do), so such transcripts are valid.
  - `[low]` `[reject]` (edge, claim) "Same input building and evidence rules as evaluate" is overstated for conversation labels — same root as the seed-turn finding above; rejected with it.
  - `[low]` `[patch]` (verification-gap) Ambiguity refusal is tested only for differing guidance, not fixture context or scope — tests for both added.
  - `[low]` `[patch]` (verification-gap) No calibration test exercises an `after-step:<n>` judged context — test added (grouped with the blind after-step finding).
  - `[low]` `[reject]` (verification-gap, other) Conversation-scope evidence includes seed coach turns and the equality test hides it — same root as the edge seed-turn finding; rejected with it.
  - `[false]` `[reject]` (intent) The real `suite:calibrate` command never calibrates; writes are tested only through `main` with a fake judge — this is the user's decision (no live calls; injected judge; live path human-run).
  - `[false]` `[reject]` (intent) The live path is a separate entry plus flag rather than a flag on `suite:calibrate` — the intent names "a separate entry or dynamic import"; both readings are allowed.
  - `[maybe-false]` `[reject]` (intent) `--suite p-v1` is not exercised for this command — p-v1 is empty by user decision; settled by running `suite:calibrate --suite p-v1` in verification (exit 1 with the hint, nothing written); would only be low.
  - `[false]` `[reject]` (intent) Conversation-scope equality with `buildJudgeInput` is unconfirmed — `calibrate.test.ts` compares inputs for the `Y-01.C3` conversation label.
  - `[false]` `[reject]` (intent) The QA export format is invented — the intent says build against synthetic fixtures; recorded as pending QA confirmation.
  - `[false]` `[reject]` (intent) The fingerprint is assembled in 13.2 and the guidance hash is suite-wide — the AC requires `agreement.json` to carry the full fingerprint and the spine hashes "all judgeGuidance texts".
  - `[maybe-false]` `[reject]` (intent) "Never edit statuses" and "only writer" are enforced on the import path and by a grep, and `writeLabelsFile` is exported — no caller rewrites statuses; settled by a callers check of `writeLabelsFile` (only the CLI import path); would only be low.
  - `[false]` `[reject]` (intent) Status, commit and clean tree are missing from the diff — finalization follows review.
  - `[false]` `[reject]` (intent) Import and calibration run in one invocation when a judge is wired — the spec's chosen reading; the default entry only imports.

## Design Notes

Labels are keyed only by criterion id, but guidance and fixture context live on test criteria, so one criterion can be judged in several tests. Calibration refuses ambiguity instead of guessing: the spine treats guidance as "the criterion's" text, so a suite whose tests disagree must be fixed in the suite, and a label never silently calibrates a different prompt than the suite runs.

ERROR is counted rather than excluded so a flaky or broken judge can only lower agreement, never raise it by dropping hard labels.

## Verification

**Commands:**
- `pnpm --filter @entalent/conversation-sim test` -- expected: pass offline.
- `pnpm --filter @entalent/conversation-sim typecheck` and `pnpm --filter @entalent/conversation-sim lint` -- expected: no errors.
- `pnpm --filter @entalent/conversation-sim suite:run --suite smoke-v1 --level L0` -- expected: exit 0.
- `pnpm --filter @entalent/conversation-sim suite:calibrate --suite smoke-v1` -- expected: exit 1 with the `suite:calibrate:live` hint, nothing written.
- `pnpm typecheck` -- expected: no errors.
- `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` -- expected: passing receipt.

## Auto Run Result

**Summary:** Calibration for the per-criterion judge. `schema.ts` gains strict `Label`, `LabelsFile`, `QaSessionExport` (assumed format, pending QA confirmation) and `AgreementFile` schemas. `judge/decide-meaning.ts` holds the judge call, single re-ask and evidence verification extracted from `evaluate` (behavior unchanged, `evaluate.test.ts` untouched), so labels and runs share one meaning decision. `judge/fingerprint.ts` computes `JudgeFingerprint` at run time (config pin + `JUDGE_PROMPT_SHA256` + output JSON-schema hash + suite guidance hash keyed `<testId>/<criterionId>`). `judge/calibrate.ts` holds label paths and I/O, `transcriptSha256`/`labelsSha256`, label context resolution (refuses unknown, NOT TESTABLE, not-judgeable and ambiguous criteria and scope mismatches), the QA-export import adapter (append-only, dedup on `(criterionId, transcript hash)`, first wins, whole import rejected on any invalid entry), Cohen's kappa over PASS/FAIL/ERROR overall and per layer, `calibrate()` and the console lines; it is the only module naming `agreement.json` and exports `readAgreementFile` for 13.3. `suite:calibrate --suite <id> [--import <file>]` takes an injected `CriterionJudge` (`CliDeps.createCalibrationJudge`); the default entry wires none, so it imports only and otherwise exits 1 with a hint. The live judge is reachable only through `judge/calibrate-live.ts` (`suite:calibrate:live`, refuses without `--live-judge`), which the CLI, runner and executor graphs never reach. No calibration files are committed: the state is "absent, pending QA labels". No live model call anywhere.

**Files changed** (under `packages/conversation-sim/` unless noted):
- `src/suite/schema.ts` -- label, labels-file, QA-export and agreement schemas.
- `src/suite/judge/decide-meaning.ts` (new) -- shared meaning decision.
- `src/suite/evaluate.ts` -- uses `decideMeaning`.
- `src/suite/judge/fingerprint.ts` (new) -- `computeJudgeFingerprint` and hashes.
- `src/suite/judge/calibrate.ts` (new) -- import adapter, context resolution, agreement math, sole agreement writer.
- `src/suite/judge/calibrate-live.ts` (new) -- live entry behind `--live-judge`.
- `src/suite/cli.ts` -- `calibrate` command, judge injection, help and exit codes.
- `src/suite/judge/__fixtures__/calibration.ts`, `judge/calibrate.test.ts`, `judge/fingerprint.test.ts`, `judge/calibrate-live.test.ts` (new), `cli.test.ts`, `executors/import-graph.test.ts` -- tests (fake judges only).
- `package.json`, root `package.json`, `README.md` -- `suite:calibrate:live` script, alias and docs.
- `docs/agent-task-log.md` (repo root) -- task row.

**Review:** 33 findings (high 0, medium 2, low 17, false 12, maybe-false 2). Patches applied (9 rows, 7 fixes): ambiguity tests for fixture-context and scope differences; after-step context test with `buildJudgeInput` equality; converted labels validated with `LabelSchema` in the import (no raw ZodError); judge built before import; import-graph spawn test compares the `calibration/` listing instead of asserting absence (medium); explicit `perLayer` literal; live-entry test asserts env, pin and decoding; schema-version error text asserted. Deferred (1): the fingerprint does not cover `passCondition`/`expectedBehavior`/`fixtureContext` (medium; AD-8 contract question for 13.3). Rejected: missing error/confusion counts in the agreement file (AC fixes keys; conservative); overwrite on a degraded run (spec-mandated, conservative, git-restorable); first-wins label conflicts (AC dedup rule, warned); non-atomic writes; free-text judge reasons in console (AC asks for disagreements, human-run only); no budget or timeout (13.1 deferred item, 13.5 budgets); harness base mismatch (user-mandated base); bypassable grep guard; unreachable unhandled rejection; `--live-judge` as an option value; coach-first transcripts (valid with seeded history); seed coach turns accepted as conversation evidence (no seed-bearing label producer exists; needs a schema seed boundary if `suite-run` labels are added); intent-audit divergences (no-judge default entry and separate live entry per the user decision, p-v1 empty, assumed QA format, fingerprint assembled in 13.2 as the AC requires, enforcement surfaces, finalization timing, combined import+calibrate).

**Follow-up review recommended:** false -- one medium entry patched (a test-only fix to the import-graph spawn assertion), no high; the rest were low.

**Verification:** `pnpm --filter @entalent/conversation-sim test` 46 files / 786 tests pass offline; package typecheck and lint clean; root `pnpm typecheck` 24/24; plain-env `suite:run --suite smoke-v1 --level L0` exit 0; `suite:calibrate --suite smoke-v1` and `--suite p-v1` exit 1 with the live hint and write nothing; `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` passed, receipt `runs/harness/receipt-1792956863769-8e6110d3.json`. `suite:calibrate:live` was never run.

**Residual risks:** the QA export format is assumed until QA confirms it (one converter and schema to change); calibration has no real labels, so agreement and kappa are unmeasured; any guidance edit anywhere in a suite invalidates its agreement (suite-wide guidance hash, by design); the live path has only been exercised with stubbed models.

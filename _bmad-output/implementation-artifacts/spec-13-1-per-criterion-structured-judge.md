---
title: 'Story 13.1: Per-Criterion Structured Judge'
type: 'feature'
created: '2026-10-25'
status: 'done'
baseline_revision: '2bb5424933229aa39a0ac5c89226847f1c9af968'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-conversation-eval-regression-2026-10-17/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Judge calls have no timeout or abort signal, so one hung judge request can stall a whole suite run.
    evidence: |-
      Blind Hunter (Story 13.1 review). `judgeCriterion` calls `generateText` with `maxRetries: 0` and no `abortSignal`; whether the OpenAI/Azure provider fetch has its own timeout is unverified. No live call runs in 13.1. Settle in 13.4/13.5 (live executor and budgets) with a per-call timeout mapped to `judge-transport`.
    location: >-
      packages/conversation-sim/src/suite/judge/criterion-judge.ts (judgeCriterion)
    severity: medium (unverified)
---

<intent-contract>

## Intent

**Problem:** Meaning checks have no judge: `evaluate` accepts only `judge: null`, so every meaning-only criterion is NOT_RUN `no-judge-at-level` and no criterion can be decided by meaning at L1/L2.

**Approach:** Add `suite/judge/` with a prompt template (content-hashed), a structured per-criterion judge over an injected AI SDK `LanguageModel`, and judge-input building; let `evaluate` accept a judge and, asynchronously, decide meaning checks per AD-7/AD-9 (evidence substring check, one re-ask, judge ERRORs isolated to the criterion), with usage recorded per result.

**User decisions (2026-10-25, recorded as intent):** The QA suite `p-v1` (12.4) is out of scope and empty; smoke scenarios live in `smoke-v1` later. Nothing in this story makes a live model call: the judge takes an injected model and every test uses `MockLanguageModelV3` from `ai/test`. A live adapter may exist (provider from `suite.config.json` judge pin, `gpt-4o`) but no test, script or CI step invokes it. L1 is not wired into CI or the runner here (13.3/13.4); `suite:ci` stays L0-only and secret-free. Model egress and cost are a human boundary.

## Boundaries & Constraints

**Always:**
- `judgeCriterion(input: JudgeInput, deps: { model: LanguageModel; decoding }): Promise<MeaningOutcome>` calls `generateText({ model, output: Output.object({ schema }), temperature, maxOutputTokens, maxRetries: 0, ... })`; schema `{ status: 'PASS'|'FAIL' nullable, reason: string nullable, evidence: string nullable }` (nullable, never optional). `createCriterionJudge(deps)` returns `CriterionJudge = (input) => Promise<MeaningOutcome>`, the value `evaluate` takes.
- `MeaningOutcome` = `{ status: 'PASS'|'FAIL', reason, evidence: string|null, usage }` | `{ status: 'ERROR', reason: 'judge-transport'|'judge-invalid-output', message, usage }`; `usage = { calls, inputTokens, outputTokens, totalTokens }` summed over every call made (missing token counts count as 0).
- Transport: a thrown non-output error is retried once inside `judgeCriterion`, then ERROR `judge-transport`. Output errors (`NoObjectGeneratedError`, schema-invalid, null `status` or null `reason`) are ERROR `judge-invalid-output` with no retry.
- Prompt (`judge/prompt.ts`): exports the template text, `renderJudgePrompt(input)` and `JUDGE_PROMPT_SHA256` (sha256 of the template). It tells the judge to decide by meaning, never wording; to quote for PASS a verbatim fragment of the evaluated reply; and that `fixtureContext` is reference material, never evidence of what the coach said. The re-ask adds a fixed reminder line that is part of the template.
- `JudgeInput = { transcript: { turns: [{ role: 'user'|'coach', text }], evaluatedReplyIndex: number|null }, expectedBehavior, passCondition, judgeGuidance: string|null, layer, fixtureContext: unknown|null }` (label-compatible transcript for 13.2). Transcript = seed history (in order) + per step the user text and, when non-null, `reply.text`. `reply:<n>`/`after-step:<n>`: steps 1..n, evaluated reply = step n's reply. `conversation`: all steps, `evaluatedReplyIndex: null`, evidence is checked against every run coach reply (not seed turns).
- `fixtureContext`: `null` unless the test's `setup` has `pulseCycle` whose `params.uncoveredTopics` (array of `{ topic: string, canonicalQuestions: string[] }`, other params ignored) parses; then `{ pulseCycle: { uncoveredTopics } }`. 13.4's fixture must use this key.
- `evaluate` overloads: `judge: null` returns `CriterionResult[]` synchronously with today's behavior unchanged; `judge: CriterionJudge` returns `Promise<CriterionResult[]>`. With a judge, meaning-only criteria are in scope and follow the full precedence; a criterion's meaning checks cost one judge call per evaluated reply (not one per check object). Meaning applies only when every rule check PASSed; a rule FAIL gives FAIL with `meaningSkipped: true` and no call.
- Meaning-decided statuses: evaluated reply `null` (or `conversation` with no coach reply) → FAIL evidence `no-reply`, no call. PASS evidence must be a substring of the evaluated reply text (any run coach reply for `conversation`) after collapsing whitespace runs to one space and trimming both; missing/empty/non-matching → re-ask once (same input plus reminder); still invalid → ERROR `judge-invalid-output`. FAIL may carry `evidence: null`. Judge PASS/FAIL sets `reason` to the judge reason and `evidence` to the fragment (omitted when null); judge ERROR sets `reason` to the code and `evidence` to the message; a rejecting `CriterionJudge` is ERROR `judge-transport`. Every meaning-decided result (including `no-reply` and judge ERROR) has `advisory: !trust.trusted` and `judgeUsage`.
- `state` or `observation-window` criteria with a meaning check and a judge → NOT_RUN in scope, reason `judge-unsupported:<kind>`.
- Loader joins the source case `expectedBehavior` onto every `LoadedTest` (optional field); `evaluate` with a judge throws `[suite]` when it is missing.
- `score`: when a criterion has a rule-FAIL sample (`FAIL` with `meaningSkipped: true`) among meaning-decided samples, it is rule-decided: `checkKind: 'rule'`, `minPasses = n`, `advisory: false` (AD-10: rule statuses are never overridden; settles the 12.9 deferred item).
- Runner: `judgeErrors` come from `collectJudgeErrors(results)` (in-scope results with reason `judge-transport`/`judge-invalid-output`, key `<testId>/<criterionId>`, message = evidence) instead of `[]`; `usage` adds `judgeCalls`, `judgeInputTokens`, `judgeOutputTokens` summed from `judgeUsage` (zeros at L0). The runner still passes `judge: null`.
- Live adapter `judge/live-judge-model.ts`: `createLiveJudgeModel(judgeConfig, env)` builds an `@ai-sdk/openai` or `@ai-sdk/azure` model for the pinned model; it reads only the passed `env`; nothing in runner/CLI/executors imports it, enforced by the import-graph test.

**Never:**
- No live model call or network access in any test or script; never read or print real secrets.
- No change to `packages/application`, `apps/*`, `agent-service`, CI workflows, `ScenarioRunReport`, `gate.config.json`, `run-gate.ts`, `computeJudgeTrust`, or `suite:ci`'s L0-only refusal.
- No calibration, agreement file, trust computation, fingerprint assembly or schema hash (13.2/13.3); no P-case content.
- Never decide by wording (no regex/keyword judge), never let a judge status override a rule FAIL.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| PASS | mock returns PASS + fragment present in reply | PASS, evidence fragment, usage calls 1 | none |
| FAIL | mock returns FAIL, evidence null | FAIL, reason = judge reason | none |
| Null reply | step reply `null` | FAIL evidence `no-reply`, mock never called | none |
| Invalid output | mock returns non-JSON / null status | ERROR `judge-invalid-output`; run INCOMPLETE; listed in `judgeErrors` | no retry |
| PASS no evidence | PASS, evidence null twice | ERROR `judge-invalid-output`, calls 2 | one re-ask |
| PASS bad evidence then fixed | first fragment absent, re-ask fragment present | PASS, calls 2, usage summed | one re-ask |
| Transport | mock throws twice | ERROR `judge-transport`, calls 2; other criteria of the test unaffected | one retry |
| Rule FAIL + meaning | rule check FAILs | FAIL `meaningSkipped: true`, no call | none |

</intent-contract>

## Code Map

- `packages/conversation-sim/src/suite/evaluate.ts` -- `evaluate` (judge typed `null`, line ~31), `evaluateCriterion` (meaning-only NOT_RUN at ~148; rule checks then PASS at ~185). Split into a sync rule phase that yields final results or "needs meaning" slots, then an async meaning phase.
- `packages/conversation-sim/src/suite/schema.ts` -- `CriterionResultSchema` (~600, strict: add optional `judgeUsage`), `LoadedTest` (~439: add optional `expectedBehavior`), `JudgeErrorSchema`, `UsageSchema`, `FixtureRefSchema` (params free-form).
- `packages/conversation-sim/src/suite/loader.ts` -- join at ~199 (`layer`, `passCondition`); add test-level `expectedBehavior` from the source case.
- `packages/conversation-sim/src/suite/score.ts` -- `aggregate` (`meaningDecided`, `checkKind`, `advisory` ~115-160).
- `packages/conversation-sim/src/suite/runner.ts` -- `judgeErrors: []` and `usage` at ~162; `evaluate(test, run, null, trust, rules)` at ~136 stays sync.
- `packages/conversation-sim/src/suite/report.ts` -- already renders `judgeErrors` and `usage` (~178); no change expected.
- `packages/conversation-sim/src/suite/diff.ts` -- `categorize` advisory meaning → inconclusive (~225); read-only, behavior follows from score.
- `packages/conversation-sim/src/suite/executors/import-graph.test.ts` -- `forbiddenImports`; add `suite/judge/live-judge-model.ts` and whole/value `@ai-sdk/*` imports as forbidden for executor, runner and CLI.
- `packages/conversation-sim/src/suite/__fixtures__/evaluation.ts` -- `criterion`, `atomic`, `journey`, `TRUSTED`/`UNTRUSTED` helpers for tests.
- `packages/conversation-sim/src/harness/live-provider.ts` -- pattern for env-reading live wiring (read-only reference).
- `node_modules/ai` 6.0.240: `generateText`, `Output`, `NoObjectGeneratedError`; `ai/test` `MockLanguageModelV3`. zod 3.25.76.

## Tasks & Acceptance

**Execution:**
- `packages/conversation-sim/src/suite/judge/prompt.ts` -- template, `renderJudgePrompt`, `JUDGE_PROMPT_SHA256` -- hashed prompt (AD-8).
- `packages/conversation-sim/src/suite/judge/criterion-judge.ts` -- output schema, `JudgeInput`/`MeaningOutcome`/`JudgeUsage`/`CriterionJudge` types, `judgeCriterion`, `createCriterionJudge`, evidence normalization helper -- AD-7 judge.
- `packages/conversation-sim/src/suite/judge/judge-input.ts` -- `buildJudgeInput(test, run, criterion)` (transcript, evaluated reply texts for evidence, fixtureContext) -- shared with 13.2 calibrate.
- `packages/conversation-sim/src/suite/judge/live-judge-model.ts` -- `createLiveJudgeModel(judgeConfig, env)` -- optional live adapter, never invoked.
- `packages/conversation-sim/src/suite/schema.ts`, `loader.ts` -- `judgeUsage`, `expectedBehavior` -- data shapes.
- `packages/conversation-sim/src/suite/evaluate.ts` -- overloads and async meaning phase per Boundaries -- the only producer of results.
- `packages/conversation-sim/src/suite/score.ts` -- rule-FAIL sample makes the criterion rule-decided -- AD-10.
- `packages/conversation-sim/src/suite/runner.ts` (+ `collectJudgeErrors` in `report.ts` or `evaluate.ts`) -- judge errors and usage into the report.
- Tests: `judge/criterion-judge.test.ts` (mock model: PASS, FAIL, invalid output, transport retry, usage, prompt content incl. fixtureContext disclaimer, request settings), `judge/judge-input.test.ts` (atomic seed+turn, journey `reply:n`, `conversation`, pulseCycle context), `evaluate.test.ts` additions (every I/O row, sync path unchanged, advisory follows trust, other criteria unaffected), `score.test.ts`/`diff.test.ts` (mixed rule-FAIL samples gate as `regressed` under an untrusted judge), `report.test.ts` (judge errors listed, run INCOMPLETE), `import-graph.test.ts` additions, `judge/live-judge-model.test.ts` (fake env only, no call).

**Acceptance Criteria:**
- Given an atomic test with a meaning-only criterion and a mock judge model, when `evaluate` runs with a judge, then the criterion is in scope and the model received the seeded history plus the single turn, the expected behavior, the verbatim pass condition, the guidance, the layer and the fixture context.
- Given one criterion's judge fails, when the test is evaluated and scored, then only that criterion is ERROR, the report is INCOMPLETE and `judgeErrors` lists it.
- Given `judge: null`, when the existing suite tests and `suite:run --suite smoke-v1 --level L0` run, then results and exit codes are unchanged and no model is constructed.

## Spec Change Log

## Review Triage Log

### 2026-10-25 — Review pass
- verdicts: 35 findings — high 0, medium 8, low 13, false 12, maybe-false 2
- findings:
  - `[false]` `[reject]` (edge) Mixed rule-FAIL and ERROR/NOT_RUN samples report the undecided status — undecided-over-decided sample precedence is pre-existing 12.2 scoring; the diff only changes checkKind/minPasses/advisory, not status precedence.
  - `[low]` `[reject]` (edge) A judge plus a test without `expectedBehavior` rejects even with no meaning criteria — the spec mandates the throw and `loadSuite` always joins `expectedBehavior`; only hand-built tests can hit it.
  - `[false]` `[reject]` (edge) A silent `after-step:n` step makes a meaning criterion FAIL `no-reply` — the AC requires `reply: null` judged FAIL `no-reply` without a model call.
  - `[medium]` `[patch]` (edge) Judge FAIL evidence is recorded unchecked, so an invented quote can look like coach output — FAIL evidence is now kept only when it matches the reply texts; test added.
  - `[low]` `[reject]` (edge) Non-retryable API errors (401/400) and programming errors are retried once and reported as `judge-transport` — costs one extra call; the spec requires one retry of any non-output error and only two reason codes; changing it adds branching outside the intent.
  - `[low]` `[patch]` (edge) A blank or whitespace-only judge reason is accepted — treated like a null reason (ERROR `judge-invalid-output`); test added.
  - `[low]` `[reject]` (edge) A caller holding `CriterionJudge | null` matches neither `evaluate` overload — no such caller exists; 13.3 adds the union overload when it wires the runner (noted in the handoff).
  - `[maybe-false]` `[reject]` (edge) An Azure endpoint with several trailing slashes or ending in `/openai` builds a bad base URL — would need the repo's `AZURE_OPENAI_ENDPOINT` convention checked against a real deployment; the adapter is never invoked in this story and the impact would be low.
  - `[low]` `[reject]` (edge) `mockJudgeModel([])` throws a TypeError — test-only helper, never called empty.
  - `[low]` `[reject]` (edge) `judge-unsupported` NOT_RUN is not advisory — NOT_RUN never counts toward pass rate or diff categories, so the flag has no effect; the rule-plus-meaning downgrade is the blind finding below.
  - `[medium]` `[patch]` (edge) The prompt hash misses text produced by `renderJudgePrompt` — grouped with the blind finding below; all fixed prompt text moved into the hashed template.
  - `[medium]` `[patch]` (blind) `JUDGE_PROMPT_SHA256` hashes only the template while evaluation-target sentences, turn format and defaults live in code — moved into template blocks; hash test kept.
  - `[low]` `[reject]` (blind) Evidence matching has no minimum length, so a one-word fragment passes — the AC defines the guard as a whitespace-normalized substring; a threshold is new policy and a judge asked for a supporting fragment rarely quotes one word.
  - `[medium]` `[patch]` (blind) FAIL evidence is never checked — same root as the edge finding above; fixed there.
  - `[low]` `[reject]` (blind) Every non-output error is retried immediately without backoff and reported as transport — same as the edge retry finding; backoff adds complexity the spec does not ask for.
  - `[maybe-false]` `[defer]` (blind) No timeout or abort signal on judge calls, so a hung connection stalls the run — whether the provider's fetch has its own timeout is unverified; no live call runs in this story; deferred to the L1 executor/budget stories (13.4/13.5).
  - `[low]` `[reject]` (blind) Meaning checks do not check that the level observes `reply.text` — only L1/L2 get a judge and both observe reply text; the guard would cover an unreachable state.
  - `[low]` `[reject]` (blind) With a judge, a rule-plus-meaning `state`/`observation-window` criterion whose rules passed becomes NOT_RUN `judge-unsupported` instead of the rule PASS — spec-mandated; no such criterion exists (p-v1 and smoke-v1 are empty); recorded for 13.4 in the handoff.
  - `[false]` `[reject]` (blind) A null reply always FAILs — the AC requires FAIL `no-reply` for `reply: null`.
  - `[low]` `[reject]` (blind) `collectJudgeErrors` repeats a key across samples — the list is per sample by design; the diff only counts errors; a sample index would add schema surface.
  - `[low]` `[reject]` (blind) Usage totals omit total and reasoning tokens and the keys are untyped — the spec names exactly the added keys; cosmetic.
  - `[medium]` `[patch]` (blind) Transcript turns are not delimited, so coach text can read as judge instructions — turns are wrapped in tagged blocks in the template with an instruction that turn text is content, not instructions; test adjusted.
  - `[medium]` `[patch]` (blind) Re-ask paths with a non-PASS second answer are untested — grouped with the verification-gap finding; tests added. Its Azure `providerOptions` and temperature-with-reasoning-effort sub-points are rejected: the pin has no reasoning effort and the adapter is never invoked.
  - `[false]` `[reject]` (blind) The rule-FAIL scoring rule makes `checkKind` flip between runs — a flip to `rule` happens only when a rule check failed, which AD-10 says must gate; the diff classifies with the run's kind, so no spurious category arises.
  - `[low]` `[patch]` (blind) Doc and type nits: JSDoc says one call per evaluated reply; the synthesized ERROR object carries only the second call's usage — JSDoc corrected and summed usage used; `unknown | null` left as is (no effect).
  - `[medium]` `[patch]` (verification-gap) The re-ask branch is untested when the second answer is FAIL or a transport error — two tests added (FAIL after re-ask, transport after re-ask with summed calls).
  - `[medium]` `[patch]` (verification-gap, other) `CriterionJudgeDeps.model` accepts a string, which `ai` resolves through the global gateway provider, an egress route the import-graph guard does not see — narrowed to `Exclude<LanguageModel, string>`.
  - `[false]` `[reject]` (intent) The run-level INCOMPLETE/judge-error claim is not exercised through `runSuite` — the AC's surface is "the judge is called from `evaluate`"; the report test uses the same `collectJudgeErrors` and `buildSuiteReport` the runner calls; runner wiring needs 13.3 trust.
  - `[false]` `[reject]` (intent) `judgeCriterion` takes `(input, deps, options)` rather than one argument — the injected-model decision requires the deps; `createCriterionJudge` yields the one-argument form.
  - `[false]` `[reject]` (intent) `conversation` evidence is accepted from any run coach reply — the spec settles this reading; there is no single evaluated reply for that scope.
  - `[false]` `[reject]` (intent) P-07 `fixtureContext` is met as a contract on synthetic tests only — p-v1 is empty by user decision and `pulseCycle` lands in 13.4; the key shape is fixed for it.
  - `[false]` `[reject]` (intent) The prompt hash is not yet part of a fingerprint — fingerprint assembly is 13.3 by the epic order.
  - `[false]` `[reject]` (intent) No path turns the configured pin into a model — no live call is allowed in this story; the adapter builds from the pin when a human wires it.
  - `[false]` `[reject]` (intent) Mock tests cannot prove judging by meaning — inherent limit; the prompt states it and calibration (13.2) measures it.
  - `[false]` `[reject]` (intent) The score change goes beyond reporting on the deferred item — it applies the deferred item's own recorded fix and AD-10; covered by score and diff tests.

## Design Notes

Two-phase evaluate keeps L0 synchronous and pure: phase one computes every status except judge calls; phase two awaits judge calls (sequentially, deterministic order) only for slots that reached the meaning step. The 12.9 deferred item ("rule regression on a rule+meaning criterion inconclusive under an uncalibrated judge") is settled by two pieces: rule-failed samples carry `meaningSkipped: true` (so an all-rule-failed criterion stays `checkKind: rule`), and the score change covers mixed samples.

## Verification

**Commands:**
- `pnpm --filter @entalent/conversation-sim test` -- expected: pass offline.
- `pnpm --filter @entalent/conversation-sim typecheck` and `pnpm --filter @entalent/conversation-sim lint` -- expected: no errors.
- `pnpm --filter @entalent/conversation-sim suite:run --suite smoke-v1 --level L0` -- expected: exit 0, report written.
- `pnpm typecheck` -- expected: no errors.
- `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` -- expected: passing receipt.

## Auto Run Result

**Summary:** `suite/judge/` adds a content-hashed prompt template (`JUDGE_PROMPT_SHA256` covers every fixed string the judge sees, including the re-ask reminder, evaluation targets and the tagged `<turn>` transcript format), a structured per-criterion judge (`judgeCriterion`/`createCriterionJudge`) that calls `generateText` with `Output.object` over an injected non-string `JudgeModel` (one transport retry, no retry on output errors, usage summed per call), `buildJudgeInput` (seed history plus steps, label-compatible transcript, `pulseCycle` uncovered topics as `fixtureContext`) and a live OpenAI/Azure adapter that nothing imports. `evaluate` keeps its synchronous `judge: null` path and gains an async judge overload: meaning checks run only after every rule check PASSed, null reply is FAIL `no-reply` without a call, PASS evidence must be a whitespace-normalized substring of the evaluated reply (one re-ask, then ERROR `judge-invalid-output`), FAIL evidence is kept only when verbatim, judge errors stay on their criterion, and every meaning-decided result is `advisory: !trust.trusted` with `judgeUsage`. `score` treats a criterion with any rule-FAIL sample as rule-decided (n/n, not advisory), which settles the 12.9 deferred item. The runner fills `judgeErrors` and judge usage from results (still `judge: null`). No live model call anywhere.

**Files changed** (under `packages/conversation-sim/src/suite/` unless noted):
- `judge/prompt.ts` (new) -- template with named blocks, `renderJudgePrompt`, `JUDGE_PROMPT_SHA256`.
- `judge/criterion-judge.ts` (new) -- output schema, judge types, `judgeCriterion`, `createCriterionJudge`, evidence helpers.
- `judge/judge-input.ts` (new) -- `buildJudgeInput`, `fixtureContext`.
- `judge/live-judge-model.ts` (new) -- `createLiveJudgeModel(judgeConfig, env)`, never invoked.
- `judge/__fixtures__/mock-model.ts` (new) -- `MockLanguageModelV3` helpers.
- `judge/*.test.ts` (new) -- judge, input, prompt and adapter tests (fake env only).
- `schema.ts` -- `JudgeUsageSchema`, `judgeUsage` on results, `expectedBehavior` on `LoadedTest`.
- `loader.ts` -- joins `expectedBehavior`.
- `evaluate.ts` -- overloads, rule phase plus async meaning phase.
- `score.ts` -- rule-FAIL sample makes a criterion rule-decided.
- `report.ts` -- `collectJudgeErrors`, `judgeUsageTotals`.
- `runner.ts` -- judge errors and usage into the report.
- `evaluate.test.ts`, `score.test.ts`, `diff.test.ts`, `report.test.ts`, `runner.test.ts`, `executors/import-graph.test.ts` -- coverage incl. live adapter and `@ai-sdk/*` banned from executor/runner/CLI graphs.
- `docs/agent-task-log.md` (repo root) -- task row.

**Review:** 35 findings (high 0, medium 8, low 13, false 12, maybe-false 2). Patches applied (7 entries): prompt hash covers all rendered text; transcript turns delimited and `</turn>` escaped; non-verbatim FAIL evidence dropped; blank judge reason is `judge-invalid-output`; judge model narrowed to `Exclude<LanguageModel, string>` (closes the global-gateway egress route); re-ask FAIL and re-ask transport tests; summed usage on the synthesized ERROR and JSDoc wording. Deferred (1): no per-call judge timeout (medium, unverified; 13.4/13.5). Rejected: pre-existing sample precedence; spec-mandated `expectedBehavior` throw, `no-reply` FAIL and `judge-unsupported` NOT_RUN (no such criteria exist yet); retry of non-retryable API errors and missing backoff (one extra call, spec requires one retry); missing `CriterionJudge | null` overload (no caller; 13.3); Azure endpoint normalization (adapter never invoked); empty mock steps; advisory flag on NOT_RUN (no effect); evidence minimum length (new policy outside the AC); unenforced `reply.text` observability (unreachable); per-sample duplicate judge errors; untyped/omitted usage keys; Azure provider option and temperature with reasoning effort (pin has none); `checkKind` flip (intended AD-10 gating); intent-audit divergences (runner wiring, `judgeCriterion` deps argument, `conversation` evidence, P-07 contract only, fingerprint in 13.3, no live model, meaning-by-wording unprovable with mocks, score change applies the deferred item's own fix).

**Follow-up review recommended:** true -- 5 medium entries were patched (0 high, 5 medium, 2 low). Specific unverified risk: the prompt template was restructured into named blocks with `<turn>` escaping after the review pass, and only targeted tests have exercised the new renderer; how a real judge model responds to the delimited format is unmeasured until 13.2 calibration.

**Verification:** `pnpm --filter @entalent/conversation-sim test` 43 files / 722 tests pass offline; package typecheck and lint clean; root `pnpm typecheck` 24/24; plain-shell `suite:run --suite smoke-v1 --level L0` exit 0 (empty suite, INCOMPLETE as before); `pnpm harness:check -- --base 3af7d0ed02bbe34e7178f4be8755f56f373162c5` passed, receipt `runs/harness/receipt-1792954557806-f6037449.json`.

**Residual risks:** the live adapter has only been constructed with fake env values; `reasoningEffort` provider-option keys are unverified; a judge quoting seeded coach text in a `conversation` criterion fails the evidence check; rule-plus-meaning `state`/`observation-window` criteria become NOT_RUN `judge-unsupported` once a judge is given (revisit when such a criterion is authored); `JUDGE_PROMPT_SHA256` changed during review (nothing depends on it yet).

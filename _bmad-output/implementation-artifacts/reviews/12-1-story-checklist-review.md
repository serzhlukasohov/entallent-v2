# Story 12.1 Checklist Review — Case Schema, Loader and Rule Registry Contract

Reviewed: `_bmad-output/implementation-artifacts/12-1-case-schema-loader-and-rule-registry-contract.md` (baseline `9814b7cf`)
Reviewer context: fresh, independent; sources re-read (epics.md Epic 12, ARCHITECTURE-SPINE.md AD-1/2/3/6/7/9/12/17/18, Conventions, Stack, Structural Seed; SPEC.md; case-mapping.md) and code verified (`harness/assertions.ts`, `vitest.config.ts`, `package.json`, `tsconfig.json`, `.eslintrc.cjs`, root `.eslintrc.cjs`, `packages/eslint-config/index.cjs`, `packages/typescript-config/base.json`, `tsconfig.base.json`, `style-antipatterns.ts`, `pnpm-lock.yaml`, `ai` 6.0.240 peer range, `@ai-sdk/provider-utils` zod imports, resolved Vitest/TS/tsx versions, `docs/agent-failures.md`).

Verified-true claims in the story (no action needed): `extractQuestions`, `findRepeatedQuestions`, `normalizeQuestion`, `firstSentence` are module-private in `assertions.ts` (lines 131-171); the only exports are `findViolations`, `countQuestions`, `describeViolations`, `findBaselineCoverageGaps`, `describeBaselineCoverageGaps`. `vitest.config.ts` `include` is exactly `src/scenarios/**/*.sim.test.ts`, `src/gate/**/*.test.ts`, `src/harness/**/*.test.ts` (new `src/suite` tests would silently not run). `tsconfig.json` sets `module: CommonJS`, `noEmit`, `include: src/**/*.ts`. `tsconfig.base.json` has `strict`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `useUnknownInCatchVariables`; it does NOT set `exactOptionalPropertyTypes` or `noUncheckedIndexedAccess`, so `z.infer` optional fields (`T | undefined`) are assignable without friction. Vitest resolves to 3.2.7, TypeScript 5.9.3, tsx 4.23.1, `ai` 6.0.240 with peer `zod ^3.25.76 || ^4.1.8`. `zod@3.25.76` is resolved in the lockfile for `packages/config` and `packages/contracts` (both declare `^3.23.8`, no catalog, no `.npmrc`); `zod@4.4.3` is present only transitively under the `@langwatch/scenario` CLI dependency. `hasReflectiveOpener` is exported from `@entalent/ai-openai` index. `node_modules/.pnpm/zod@3.25.76` exists, so an `--offline` install can resolve it from the store. The cited `docs/agent-failures.md` entries (2026-09-03 "Focused simulation command ran the full live suite", 2026-08-20 "Targeted conversation sim command ran the full suite") exist.

---

## Critical (must fix)

### C1. `schema.ts` ↔ `registry.ts` circular dependency built into the task list
**Targets:** Tasks "Create `src/suite/schema.ts`" bullet `RuleCheck = { type: 'rule', rule: RuleName, ... }`; Tasks "Create `src/suite/rules/registry.ts`" bullet `RuleNameSchema ... re-exported for the loader`; Dev Notes bullet "schema.ts ... must stay dependency-free apart from zod".
**Problem:** `RuleCheckSchema` in `schema.ts` needs the runtime `RuleNameSchema` (a Zod enum) from `registry.ts`, while `registry.ts` needs `CaseRun`, `Criterion`, `ObservationField` from `schema.ts`. That is a runtime import cycle (Zod enums are values, `import type` does not help) and contradicts the "dependency-free" rule. A dev agent will either create the cycle or pick a resolution on its own.
**Replacement text (schema.ts bullet):**
`RuleCheck = { type: 'rule', rule: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/), params?: Record<string, unknown> }` — `schema.ts` only checks the kebab-case shape; membership in the registry is checked by the loader (see loader task). The inferred `Check['rule']` type is `string`; `registry.ts` narrows with `RuleName` at call time.
**Replacement text (registry.ts bullet):** `RuleNameSchema = z.enum(RULE_NAMES)` where `const RULE_NAMES = Object.keys(RULES) as [RuleName, ...RuleName[]]` (Zod 3 `z.enum` requires a non-empty tuple, not `string[]`). `registry.ts` imports from `../schema`; `schema.ts` imports nothing from `rules/`.
**Replacement text (loader task):** "Validate every `rule` name in `preconditions[].rule`, `steps[].checkpoint.checks[].rule` and `criteria[].checks[].rule` against `RuleNameSchema` from `./rules/registry`; failure throws `SuiteLoadError` code `unknown-rule` with `caseId` and the issue path."

### C2. `RULES: Record<RuleName, RuleEntry>` with `RuleName = keyof typeof RULES` does not compile
**Targets:** Tasks "Create `src/suite/rules/registry.ts`" first bullet.
**Problem:** Annotating `RULES` with a type derived from `typeof RULES` is TS7022 ("implicitly has type 'any' because it ... is referenced directly or indirectly in its own initializer").
**Replacement text:** "`export const RULES = { 'too-many-questions': tooManyQuestions, 'repeated-question': repeatedQuestion, 'reflective-opener': reflectiveOpener } satisfies Record<string, RuleEntry>; export type RuleName = keyof typeof RULES; export const RULE_NAMES = Object.keys(RULES) as [RuleName, ...RuleName[]]; export const RuleNameSchema = z.enum(RULE_NAMES);`. Story 12.3 adds entries to the object literal only."

### C3. `ObservationField` as a closed `z.enum` cannot express the spine's parameterized fields and blocks Story 12.3
**Targets:** Tasks "Create `src/suite/schema.ts`" bullet `ObservationField = z.enum([...])`.
**Problem:** AD-17 lists `reply.messages[].metadata.*` and `state.<query>`; AD-6 reasons are `unobservable:<field>@<level>`; Story 12.3 requires `bundle-staged` to declare `requires: ['reply.messages[].metadata.v2ConfirmationBundle']` and `state-equals` to depend on a named query. The story's enum has only `reply.messages[].metadata` and `state`, so 12.3 and 13.4 would have to widen the enum (renegotiating the contract the story says must not be renegotiated) or lie about requirements. The story also adds `turn.intent`, `turn.replyPlan`, `reply.messages` and `steps.gapMs`, which are not in AD-17; these are harmless additions but must be marked as deliberate.
**Replacement text:** "`ObservationField = z.string().regex(/^(reply\.text|reply\.messages|reply\.messages\[\]\.metadata(\.[A-Za-z0-9_]+)?|turn\.(mode|intent|outcome|bundleReply|replyPlan)|state(\.[a-z][A-Za-z0-9]*)?|window\.outbound|steps\.gapMs)$/)` with the inferred type `ObservationField = string`. Export `OBSERVATION_FIELDS` (the base names, for docs and the coverage table) and `fieldObserved(observed: ObservationField[], required: ObservationField): boolean`: exact match, or `required` starts with `observed + '.'` (an executor that declares `state` or `reply.messages[].metadata` covers every sub-field). `hasObservations` in the registry uses `fieldObserved`. Fields added beyond AD-17 on purpose: `reply.messages`, `turn.intent`, `turn.replyPlan`, `steps.gapMs`."

### C4. Loader tests have no way to feed fixture cases through `loadSuite`
**Targets:** Tasks "Create `src/suite/loader.ts`" and "Wire tests" (`loader.test.ts` bullet); AC 1.
**Problem:** `SUITES` is a hard-coded map with `'p-v1'` → empty array, and the story says fixtures live in `__fixtures__/cases.ts`. Nothing says how `loader.test.ts` gets a fixture case into the validation path. A dev agent will invent either a test-only suite id in `SUITES` (pollutes production map), module mocking, or a hidden parameter.
**Replacement text (loader task):** "Export a pure `validateSuite(suiteId: string, modules: unknown[]): LoadedSuite` that performs schema parse, refinements, cross-case checks and `clock` normalization; `loadSuite(suiteId, suites: SuitesMap = SUITES)` resolves the module list and delegates to `validateSuite`. Parse each module as `unknown` (`SuiteCaseSchema.safeParse`), never trust the TS type of the case module."
**Replacement text (loader.test.ts bullet):** "All refinement tests call `validateSuite('test', [fixture])`; one test asserts `await loadSuite('p-v1')` resolves `{ id: 'p-v1', cases: [] }`; one test asserts `loadSuite('nope')` rejects with `SuiteLoadError` code `unknown-suite`. Invalid fixtures are typed `unknown` (not `SuiteCase`) so TypeScript does not reject the test file before Zod does; this matters for the 'checkpoint with meaning check' case, which the discriminated union already rejects at the type level."

### C5. AC 7 / install sequencing: `--frozen-lockfile` fails until the lockfile is regenerated
**Targets:** AC 7; Tasks first bullet.
**Problem:** With pnpm 9, `pnpm install --frozen-lockfile` errors with `ERR_PNPM_OUTDATED_LOCKFILE` whenever `package.json` specifiers differ from the lockfile importer section. After adding `zod` to `devDependencies`, the frozen install fails by design until a non-frozen install updates `pnpm-lock.yaml`. As written, AC 7 reads as a single command that "succeeds".
**Replacement text (AC 7):** "Given `packages/conversation-sim/package.json` declares `zod` as a devDependency at `^3.25.76`, when `pnpm install --offline` is run once to update the `packages/conversation-sim` importer entry in `pnpm-lock.yaml` (the version resolves to the already-present `zod@3.25.76`; no new tarball is fetched), then a subsequent `pnpm install --offline --frozen-lockfile` succeeds and the lockfile diff is limited to that importer entry. If the content-addressable store was pruned and `--offline` cannot resolve, run `pnpm install --frozen-lockfile=false` without `--offline` and record it in the Dev Agent Record."

### C6. Story contradicts itself on `SuiteCase.expectedBehavior` ("exactly as AD-1" vs an added field)
**Targets:** AC 1 ("exactly as spine AD-1 and AD-3 list them"); Tasks `SuiteCase` bullet (`expectedBehavior: string`); Dev Notes first bullet.
**Analysis:** AD-1's `SuiteCase` has no `expectedBehavior`. AD-7's `JudgeInput = { transcript, expectedBehavior, passCondition, layer, fixtureContext }` needs a per-case expected-behavior text, and CAP-1 ("loading rejects a case whose expected behavior has no criterion") assumes the case carries it. The addition is justified and should stay, but the story must say so, or a dev agent reading AC 1 literally will drop it (and 13.1 will have nowhere to read it from).
**Replacement text (AC 1):** "...exactly as spine AD-1 and AD-3 list them, plus `SuiteCase.expectedBehavior: string (min 1)` (the suite's Expected behavior text verbatim, required by AD-7 `JudgeInput`), ..."
**Addition (Dev Notes):** "Deliberate extensions beyond the spine's literal field lists, all additive: `SuiteCase.expectedBehavior` (AD-7), `ObservationField` values `reply.messages`, `turn.intent`, `turn.replyPlan`, `steps.gapMs`, `CriterionResult.method: 'n/a'` for non-dashboard criteria, `CaseRun.state.afterStep` keyed by the step index as a decimal string (JSON keys). Story 12.2 and 13.1 consume these names; do not rename."

### C7. `rules/legacy.ts` breaks the "one rule per file" convention 12.3 will follow
**Targets:** Project Structure Notes "New files: ... `rules/legacy.ts` (the three wrappers)"; Tasks registry bullets.
**Problem:** Consistency Conventions: "one rule per file under `src/suite/rules/`"; Story 12.3: "one file per rule". A single `legacy.ts` makes `rules/` inconsistent from the first commit.
**Replacement text:** "New files under `src/suite/rules/`: `registry.ts`, `too-many-questions.ts`, `repeated-question.ts`, `reflective-opener.ts`, `reply-selection.ts` (`replyForCriterion`, `hasObservations`), `registry.test.ts`. Each rule file exports one `RuleEntry` named in camelCase (`tooManyQuestions`)."

---

## Enhancements (should add)

### E1. `replyForCriterion` semantics are under-specified for three of the five `evaluatedAt` kinds and for null replies inside `conversation` scope
**Targets:** Tasks registry bullet "Reply selection helper".
**Addition:** "`replyForCriterion(run, criterion)` returns `{ kind: 'single', turn: n, reply }` for `reply:<n>` and `after-step:<n>` (same reply), `{ kind: 'all', replies: Array<{ turn, reply }> }` for `conversation`, and `{ kind: 'none' }` for `observation-window` and `state`. Wrappers: on `none` return `NOT_OBSERVABLE` with evidence `rule requires reply text; criterion evaluatedAt=<kind>`; on a `single` null reply return `FAIL` evidence `no-reply (turn n)`; on `all`, `too-many-questions` and `reflective-opener` run per non-null reply and FAIL on the first violation naming the turn, `repeated-question` builds `replies.map(r => r.reply?.text ?? '')` so null turns keep their index (mirrors `findRepeatedQuestions`) and never FAIL solely because of a null. Evidence strings follow `turn <n> — <detail>` as in `describeViolations`."

### E2. Missing loader refinements that the schema alone cannot express
**Targets:** AC 2; Tasks loader bullet "Validate each case with `SuiteCaseSchema.superRefine`".
**Addition:** "(h) `stateQuery.at === 'after-step:<n>'` requires `1 ≤ n ≤ steps.length`; (i) `evaluatedAt: 'observation-window'` only in `observation` cases and `observation` cases must declare `observationWindow`; (j) `criterion.levels`, when present, must be a subset of the case `levels` (AD-9: a criterion may narrow, never widen); (k) a criterion containing a `not-testable` check has exactly that one check (AD-2 retired form, AD-9 precedence); (l) `stateQuery` present only when `evaluatedAt === 'state'`." Add one failing fixture per new refinement to `loader.test.ts`.

### E3. `SuiteLoadError` shape
**Targets:** Tasks loader bullets.
**Addition:** "`export class SuiteLoadError extends Error { readonly code: 'unknown-suite' | 'invalid-case' | 'duplicate-case-id' | 'duplicate-criterion-id' | 'criterion-id-prefix' | 'unknown-rule'; readonly suiteId: string; readonly caseId?: string; readonly path?: (string | number)[] }`; `message` is `[suite] <suiteId> <caseId ?? '-'}: <code> at <path.join('.')>: <zod message>` (Conventions: `[suite]` log prefix)."

### E4. Enforce AD-3's `reply.text` invariant in the schema
**Targets:** Tasks `StepObservation` bullet.
**Addition:** "`StepObservationSchema.superRefine`: when `reply` is non-null, `reply.text === reply.messages.map(m => m.text).join('\n\n')` (AD-3); issue path `['reply', 'text']`. `schema.test.ts` has one failing case for it."

### E5. `TurnTrace` field types and the known literal values
**Targets:** Tasks `StepObservation`/`TurnTrace` bullet ("all nullable-friendly").
**Addition:** "`TurnTrace = { mode?: string | null, intent?: string | null, outcome?: string | null, bundleReply?: string | null, replyPlan?: unknown }` as plain strings (schema.ts imports nothing from `@entalent/application`). Known producer values, for 12.3 and executors: `outcome` ∈ `'input_filtered' | 'processing_failed'` (absent on a normal turn), `bundleReply` ∈ `'answer_then_bundle' | 'bundle_without_reply'` (`OrchestrateResult` in `packages/application/src/use-cases/conversation-orchestrator.ts:78-90`)."

### E6. `occurredAt` / timestamp validation
**Targets:** Tasks `ReplyMessage` bullet, `CaseRun.window` bullet.
**Addition:** "`occurredAt`, `window.from`, `window.to`: `z.string().datetime({ offset: true })` (ISO-8601, Conventions); executors emit UTC `Z` strings."

### E7. Fresh-worktree build prerequisite
**Targets:** Testing Requirements.
**Addition:** "In a fresh worktree run `pnpm install --offline --frozen-lockfile` then `pnpm --filter './packages/*' build` before any Vitest run: `registry.ts` resolves `@entalent/ai-openai` through its `dist` entry (AGENTS.md Testing Policy). In the main checkout the dist already exists."

### E8. `p-v1/index.ts` contract for Story 12.4 and a drift guard
**Targets:** Tasks loader bullet (`SUITES` / `cases/p-v1/index.ts`).
**Addition:** "`cases/p-v1/index.ts` exports `export const cases: unknown[] = []` (typed `unknown[]` so the loader, not TS, is the gate). Story 12.4 appends one import per `*.case.ts`. Add `loader.test.ts` case 'every `*.case.ts` under `cases/p-v1/` is listed in `index.ts`' using `fs.readdirSync` on `path.join(__dirname, 'cases/p-v1')` (CommonJS `__dirname` is available under the package tsconfig; do not use `import.meta`), so a case file that is never imported cannot silently drop out of the suite."

### E9. `hasObservations` placement vs AD-6
**Targets:** Tasks registry bullet `hasObservations`.
**Addition:** "AD-6 makes `evaluate` (Story 12.2) the authoritative gate that turns a missing field into `NOT_RUN unobservable:<field>@<level>`; the in-rule `hasObservations` guard is defense in depth so a rule called directly (tests, future CLI) can never pass vacuously. Both read the same `fieldObserved` helper."

### E10. Correct the ESLint description
**Targets:** Dev Notes bullet "ESLint: `import/order` alphabetized ...".
**Problem:** `packages/conversation-sim/.eslintrc.cjs` does not extend `@entalent/eslint-config`; the effective config (verified with `eslint --print-config`) is the root `.eslintrc.cjs`: `eslint:recommended`, `plugin:@typescript-eslint/recommended`, `prettier`, `no-explicit-any: error`, `no-unused-vars` with `^_` ignore, `no-console: off` (package override). No `import/order`, no type-aware rules, no `parserOptions.project`.
**Replacement text:** "ESLint for this package is the root config: `no-explicit-any` (use `unknown`), `no-unused-vars` (`_` prefix), no `import/order` rule (keep imports grouped builtin / external / parent / sibling anyway, matching `assertions.ts`), `no-console` off. Do not add `extends` to the package `.eslintrc.cjs` in this story. The loader throws rather than logs because the runner (12.8) owns output, not because of lint."

### E11. Lib/target constraints
**Targets:** Dev Notes.
**Addition:** "`target`/`lib` are ES2022: no `Array.prototype.findLast`, `toSorted`, `Object.groupBy`, `Set.prototype.union` (docs/agent-failures.md 2026-09-03 'Simulation TypeScript target lacks Array.findLast'). `useUnknownInCatchVariables` is on: narrow caught errors before reading `.message`."

### E12. Export the private helpers with explicit intent
**Targets:** Tasks registry bullet "exporting the currently private helpers".
**Addition:** "Export exactly `extractQuestions`, `findRepeatedQuestions`, `firstSentence` (lines 131, 151, 169) by prefixing `export`; leave `normalizeQuestion` private; no body or signature changes; `countQuestions` and `findViolations` unchanged. Consumers of `assertions.ts` that must stay green: `harness/report.ts`, `scenarios/baseline-test-helpers.ts`, `scenarios/{burnout,memory-recall,terse-user,annna-intent-fidelity,resolved-detail-question-planning,migration-baseline}.sim.test.ts` (live; not run here) and `harness/coach-harness.test.ts` (offline)."

---

## Optimizations (nice to have)

### O1. `parseEvaluatedAt` return type
**Targets:** Tasks `EvaluatedAt` bullet.
**Text:** "`parseEvaluatedAt(value): { kind: 'reply' | 'after-step', index: number } | { kind: 'conversation' | 'observation-window' | 'state' }` as a discriminated union so callers cannot read `index` on the unindexed kinds. Same helper for `stateQuery.at`: `parseStateAt(value): { kind: 'before' | 'after' } | { kind: 'after-step', index }`."

### O2. Normalized-case immutability test
**Targets:** Tasks loader bullet "never mutate the input module object".
**Text:** "Implement normalization as `{ ...parsed, setup: [...parsed.setup, { name: 'clock' }] }`; test with `Object.freeze` on the fixture (deep-freeze `setup`) and assert no throw plus `toEqual` on the original."

### O3. Fixture builder for tests
**Targets:** Tasks "Test fixtures live in `src/suite/__fixtures__/cases.ts`".
**Text:** "Expose `validConversationCase(overrides?)`, `validObservationCase(overrides?)`, `caseRun(overrides?)` builders returning fresh objects per call; refinement tests spread one invalid field over a valid builder so each test shows only its delta. Story 12.2 reuses `caseRun()`."

### O4. Vitest filtering reminder
**Targets:** Dev Notes harness bullet.
**Text:** "Focused run: `pnpm --filter @entalent/conversation-sim exec vitest run src/suite` (the `include` change makes the path filter effective)."

### O5. Sprint status
**Targets:** Tasks "Verify and record".
**Text:** "Set `12-1-case-schema-loader-and-rule-registry-contract` to `in-progress` at start and `review` at hand-off in `_bmad-output/implementation-artifacts/sprint-status.yaml` (it is dirty in the worktree; edit only this key)."

---

## LLM-optimization (verbosity / ambiguity)

### L1. Zod rationale is inaccurate; shorten to the true reason
**Targets:** Dev Notes bullet "Zod 3.25.x is what `ai` 6.0.240 peers on ... two zod instances would break `Output.object`".
**Problem:** `ai` 6.0.240 peers on `zod ^3.25.76 || ^4.1.8` and `@ai-sdk/provider-utils` imports `zod/v3` and `zod/v4` subpaths (both exist in zod 3.25.x). pnpm resolves peers per importer, so a zod 4 in `conversation-sim` would not create a second instance for `ai`; the real reasons are workspace consistency (`config`, `contracts` on 3.25.76) and the spine's Stack pin.
**Replacement text:** "zod: `^3.25.76` devDependency, the version already resolved for `packages/config` and `packages/contracts` and inside the `ai` 6 peer range (`^3.25.76 || ^4.1.8`). Not zod 4 (spine Stack). Use `z.discriminatedUnion`, `.superRefine` + `ctx.addIssue({ code: z.ZodIssueCode.custom, path, message })`, `.int().nonnegative()`; import `z` from `'zod'` (not `'zod/v4'`)."

### L2. AC 4/5 and the registry task restate the same contract three times
**Targets:** AC 4, AC 5, Tasks registry bullets, Dev Notes bullets 5-7.
**Text:** Keep the `RuleEntry` / `RuleOutcome` definition once in the Tasks and reference it from AC 4/5 ("per the `RuleEntry` contract in Tasks"); drop the duplicate "without copying their definitions" sentence from Dev Notes (already in AC 5 and the README bullet).

### L3. `Record<string, StateSnapshot>` vs spine `Record<number, ...>` needs one clause, not silence
**Targets:** Tasks `CaseRun` bullet.
**Text:** "`afterStep: z.record(z.string().regex(/^\d+$/), StateSnapshotSchema)` — keys are step indices as decimal strings (JSON); spine writes `Record<number, …>`."

### L4. "Status semantics are defined in Story 12.2; this story only produces `RuleOutcome`" is buried
**Targets:** Dev Notes bullet 8.
**Text:** Move to the top of Dev Notes as the first boundary statement: "Scope boundary: this story never produces a `CriterionStatus`; rules return `RuleOutcome`, the loader returns `LoadedSuite`. `evaluate`/`score`/`report` are 12.2."

### L5. AC 3 and loader task duplicate; AC 6 mixes test scope with config wiring
**Targets:** AC 3, AC 6.
**Text:** AC 6 split: "6a. `vitest.config.ts` `include` and the `test` script both cover `src/suite`; 6b. coverage: each refinement one failing + one valid fixture; each wrapper PASS/FAIL/NOT_OBSERVABLE + `no-reply`; `parseEvaluatedAt` all five kinds; `CaseRun`/`CriterionResult` round-trip."

### L6. Dependency-direction note mentions a test it then forbids
**Targets:** Dev Notes bullet "Story 12.3 adds the import-graph test; do not pre-empt it here."
**Text:** Fine as scope control; add the one-line positive rule the dev needs now: "`src/suite/**` may import `../harness/*`, `../fakes/*`, `../gate/failure-kind`, `@entalent/*`, `zod`; nothing outside `src/suite/` imports from `src/suite/` in this story."

---

## Cross-story scope check

- No pre-emption found: no `evaluate`/`score`/`report`, no new rules, no `ClockPort`, no CLI, no `suite.config.json`, no `fixtures/state-queries.ts`.
- Gaps 12.2 would need from 12.1 and the story does not provide: (1) a parameterized `ObservationField` + `fieldObserved` (C3) for `unobservable:<field>@<level>`; (2) a reusable `caseRun()` fixture builder (O3); (3) `CriterionResult.method: 'n/a'` must be named as deliberate (C6) because 12.2's precedence table has to emit it for non-dashboard criteria; (4) `fieldObserved` shared by `evaluate` and the rules (E9).
- Gap 12.4 would need: `cases/p-v1/index.ts` contract and the `expectedBehavior` requirement (C6, E8).
- Gap 12.3 would need: one-rule-per-file layout and the `RULES` object-literal registration pattern (C2, C7).

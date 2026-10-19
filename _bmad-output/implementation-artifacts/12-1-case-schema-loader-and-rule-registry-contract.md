---
baseline_commit: 9814b7cf48c9be064d082253e8e4675436d83c05
---

# Story 12.1: Case Schema, Loader and Rule Registry Contract

Status: ready-for-dev
Epic: 12 - Rule-Based Regression Gate on Every Pull Request (L0)
Story ID: 12.1

## Story

As a case author,
I want suite cases to be typed records validated at load against one schema, with rule references checked against a registry,
so that a malformed case or a dangling rule name fails before any run and every criterion carries a stable id.

## Acceptance Criteria

1. Given `packages/conversation-sim/src/suite/schema.ts` defines Zod schemas and inferred types for `SuiteCase`, `Step`, `Criterion`, `Check`, `FixtureRef`, `CaseRun`, `StepObservation`, `ReplyMessage`, `StateSnapshot`, `CriterionResult` and `CriterionStatus` as spine AD-1 and AD-3 list them, plus the deliberate extensions named in Dev Notes (`SuiteCase.expectedBehavior` and others), when a suite is validated, then every case module is parsed as `unknown` and the first invalid case fails the load with the case id and the Zod issue path.
2. Given the loader refinements, then it rejects: (a) a `conversation` case with zero steps; (b) an `observation` case with any step, any `reply:<n>` or `after-step:<n>` criterion, or no `observationWindow`; (c) an `evaluatedAt` or `stateQuery.at` index outside `1..steps.length`; (d) a `state` criterion without `stateQuery`, or `stateQuery` on a non-`state` criterion; (e) a checkpoint containing a meaning check; (f) a criterion id not matching `<caseId>.C<n>`; (g) duplicate case ids or criterion ids within a suite; (h) `evaluatedAt: 'observation-window'` outside an `observation` case; (i) `criterion.levels` not a subset of the case `levels`; (j) a criterion with a `not-testable` check and any other check; (k) any rule name absent from the registry.
3. Given a case with any `advanceClock` step, then the normalized case has the `clock` fixture in `setup` (added when absent) and the input module object is not mutated.
4. Given `src/suite/rules/registry.ts` exports `RULES`, `RuleName`, `RULE_NAMES` and `RuleNameSchema`, then it contains `too-many-questions`, `repeated-question` and `reflective-opener`, each wrapping the existing definitions from `harness/assertions.ts` and `@entalent/ai-openai` without copying them, each declaring `requires: ['reply.text']`, and each returning `NOT_OBSERVABLE` when the `CaseRun` does not declare a required field.
5. Given `pnpm --filter @entalent/conversation-sim test`, then `src/suite/**/*.test.ts` runs and covers: one valid conversation case and one valid observation case; one failing fixture per refinement in AC 2; `clock` normalization and input immutability; `loadSuite('p-v1')` resolving to an empty suite and an unknown suite id rejecting; for each wrapper a PASS, FAIL, `no-reply` FAIL and NOT_OBSERVABLE case; `reply.text` invariant and `parseEvaluatedAt` round trips; every `*.case.ts` under `cases/p-v1/` listed in `index.ts`.
6. Given `packages/conversation-sim/package.json` declares `zod` as a devDependency at `^3.25.76`, when `pnpm install --offline` is run once to update the importer entry in `pnpm-lock.yaml` (resolves to the already-present `zod@3.25.76`, no new tarball), then a subsequent `pnpm install --offline --frozen-lockfile` succeeds and the lockfile diff is limited to that importer entry.

## Tasks / Subtasks

- [ ] Add `zod` `^3.25.76` to `packages/conversation-sim` devDependencies; run `pnpm install --offline`, then `pnpm install --offline --frozen-lockfile`; confirm the lockfile diff is the importer entry only. If the store was pruned and `--offline` cannot resolve, run `pnpm install --frozen-lockfile=false` without `--offline` and note it in the Dev Agent Record. (AC: 6)
- [ ] Create `src/suite/schema.ts`: Zod schemas with the `Schema` suffix and `z.infer` types without it (`SuiteCaseSchema` / `SuiteCase`). `schema.ts` imports only `zod`. (AC: 1)
  - [ ] `LevelSchema = z.enum(['L0','L1','L2'])`; `LayerSchema = z.enum(['P','D','C','S'])`; `CriterionStatusSchema = z.enum(['PASS','FAIL','NOT_TESTABLE','INVALID','ERROR','NOT_RUN'])`.
  - [ ] `FixtureNameSchema = z.enum(['clock','pulseCycle','pendingBotQuestion','freshPersona','disclosureDelivered','proactiveUsers'])`; `FixtureRefSchema = { name: FixtureName, params?: Record<string, unknown> }`.
  - [ ] `ObservationFieldSchema = z.string().regex(/^(reply\.text|reply\.messages|reply\.messages\[\]\.metadata(\.[A-Za-z0-9_]+)?|turn\.(mode|intent|outcome|bundleReply|replyPlan)|state(\.[a-z][A-Za-z0-9]*)?|window\.outbound|steps\.gapMs)$/)`, inferred type `string`. Export `OBSERVATION_FIELDS` (base names, for docs and the coverage table) and `fieldObserved(observed: ObservationField[], required: ObservationField): boolean`: exact match, or `required` starts with `observed + '.'` (declaring `state` or `reply.messages[].metadata` covers every sub-field).
  - [ ] `RuleCheckSchema = { type: 'rule', rule: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/), params?: Record<string, unknown> }` (kebab-case shape only; registry membership is the loader's job); `MeaningCheckSchema = { type: 'meaning' }`; `NotTestableCheckSchema = { type: 'not-testable', reason: string (min 1) }`; `CheckSchema = z.discriminatedUnion('type', [...])`.
  - [ ] `EvaluatedAtSchema = z.string().regex(/^(reply:\d+|after-step:\d+|conversation|observation-window|state)$/)` and `parseEvaluatedAt(value): { kind: 'reply' | 'after-step', index: number } | { kind: 'conversation' | 'observation-window' | 'state' }`.
  - [ ] `CriterionSchema = { id: /^[A-Z]+-\d{2}\.C\d+$/, layer, evaluatedAt, passCondition: string (min 1), checks: Check[] (min 1), levels?: Level[] (min 1), stateQuery?: { name: /^[a-z][A-Za-z0-9]*$/, at: /^(before|after|after-step:\d+)$/ }, independentOfCheckpoints?: boolean }`.
  - [ ] `StepSchema = { text: string (min 1), advanceClock?: int >= 0 (ms), checkpoint?: { checks: RuleCheck[] (min 1), onFail: 'continue' | 'stop' } }` (the `RuleCheck`-only type already rejects meaning checks at the type level; the loader still reports it for `unknown` input).
  - [ ] `SuiteCaseSchema = { id: /^[A-Z]+-\d{2}$/, requirement: string[] (min 1), kind: 'conversation' | 'observation', levels: Level[] (min 1), runProfile: z.literal('isolated'), setup: FixtureRef[], preconditions: RuleCheck[], steps: Step[], observationWindow?: { durationMs: int > 0, scanEveryMs: int > 0 }, expectedBehavior: string (min 1), criteria: Criterion[] (min 1) }`.
  - [ ] `ReplyMessageSchema = { id, text, occurredAt: z.string().datetime({ offset: true }), metadata: Record<string, unknown> }`; `TurnTraceSchema = { mode?: string | null, intent?: string | null, outcome?: string | null, bundleReply?: string | null, replyPlan?: unknown }` (plain strings; known producer values: `outcome` in `'input_filtered' | 'processing_failed'`, `bundleReply` in `'answer_then_bundle' | 'bundle_without_reply'`, from `OrchestrateResult` in `packages/application/src/use-cases/conversation-orchestrator.ts`).
  - [ ] `StepObservationSchema = { index: int >= 1, userText, traceId, gapMs: int >= 0, reply: { messages: ReplyMessage[], text } | null, unsolicited: ReplyMessage[], turn?: TurnTrace }` with a `superRefine` that, when `reply` is non-null, requires `reply.text === reply.messages.map(m => m.text).join('\n\n')` (issue path `['reply','text']`).
  - [ ] `StateSnapshotSchema = z.record(z.string(), z.unknown())`; `PreconditionResultSchema = { fixture: string, ok: boolean, detail?: string }`; `ExecutionErrorSchema = { kind: 'product' | 'infrastructure', step?: int, name, message, stack?: string | null }`.
  - [ ] `CaseRunSchema = { caseId, level, attempt: int >= 1, subject: { externalUserId, userId?, conversationId?, tenantId? }, observed: ObservationField[], preconditions: PreconditionResult[], steps: StepObservation[], window?: { from: datetime, to: datetime, outbound: ReplyMessage[] }, state: { before: StateSnapshot, after: StateSnapshot, afterStep: Record<string, StateSnapshot> }, stoppedAtStep?: int, errors: ExecutionError[] }`.
  - [ ] `CriterionResultSchema = { criterionId, caseId, level, layer, status: CriterionStatus, advisory: boolean, method: 'observed' | 'substituted' | 'n/a', reason?: string, evidence?: string, meaningSkipped?: boolean }`.
- [ ] Create `src/suite/rules/` with one rule per file plus shared helpers. `registry.ts` imports from `../schema`; `schema.ts` never imports from `rules/`. (AC: 4)
  - [ ] `registry.ts`: `RuleOutcome = { status: 'PASS' | 'FAIL' | 'NOT_OBSERVABLE', evidence: string }`; `RuleEntry = { requires: ObservationField[], run(run: CaseRun, criterion: Criterion, params: Record<string, unknown>) => RuleOutcome }`; `export const RULES = { 'too-many-questions': tooManyQuestions, 'repeated-question': repeatedQuestion, 'reflective-opener': reflectiveOpener } satisfies Record<string, RuleEntry>; export type RuleName = keyof typeof RULES; export const RULE_NAMES = Object.keys(RULES) as [RuleName, ...RuleName[]]; export const RuleNameSchema = z.enum(RULE_NAMES);` (Zod 3 `z.enum` needs a non-empty tuple). Story 12.3 adds entries to the object literal only.
  - [ ] `reply-selection.ts`: `hasObservations(run, requires)` returning a `NOT_OBSERVABLE` outcome listing missing fields via `fieldObserved` (defense in depth; `evaluate` in 12.2 is the authoritative gate), and `replyForCriterion(run, criterion)` returning `{ kind: 'single', turn, reply }` for `reply:<n>` and `after-step:<n>`, `{ kind: 'all', replies: Array<{ turn, reply }> }` for `conversation`, `{ kind: 'none' }` for `observation-window` and `state`.
  - [ ] Wrapper semantics: on `none` return `NOT_OBSERVABLE` with evidence `rule requires reply text; criterion evaluatedAt=<kind>`; on a `single` null reply return `FAIL` with evidence `no-reply (turn n)` (an observed empty reply is a product observation, not a missing field); on `all`, `too-many-questions` and `reflective-opener` run per non-null reply and FAIL on the first violation naming the turn; `repeated-question` builds `replies.map(r => r.reply?.text ?? '')` so null turns keep their index and never FAIL solely because of a null. Evidence strings follow `turn <n> — <detail>` as in `describeViolations`.
  - [ ] `reflective-opener.ts` calls `hasReflectiveOpener` from `@entalent/ai-openai`; `too-many-questions.ts` and `repeated-question.ts` call `extractQuestions` / `findRepeatedQuestions` / `firstSentence` from `../../harness/assertions`.
  - [ ] In `harness/assertions.ts` prefix `export` on exactly `extractQuestions`, `findRepeatedQuestions` and `firstSentence`; leave `normalizeQuestion` private; no body or signature changes; `findViolations`, `countQuestions`, `describeViolations` untouched.
- [ ] Create `src/suite/loader.ts`. (AC: 1, 2, 3)
  - [ ] `export class SuiteLoadError extends Error { readonly code: 'unknown-suite' | 'invalid-case' | 'duplicate-case-id' | 'duplicate-criterion-id' | 'criterion-id-prefix' | 'unknown-rule'; readonly suiteId: string; readonly caseId?: string; readonly path?: (string | number)[] }`; message `[suite] <suiteId> <caseId ?? '-'>: <code> at <path.join('.')>: <zod message>`.
  - [ ] `export function validateSuite(suiteId: string, modules: unknown[]): LoadedSuite` (`LoadedSuite = { id, cases: SuiteCase[] }`): `SuiteCaseSchema.safeParse` per module, `superRefine` refinements (a)–(j) of AC 2, cross-case checks (g), `clock` normalization, rule membership (k) for `preconditions[].rule`, `steps[].checkpoint.checks[].rule` and `criteria[].checks[].rule` against `RuleNameSchema`; stops at the first invalid case; returns new objects, never mutates input.
  - [ ] `SUITES: Record<string, () => Promise<unknown[]>>` with `'p-v1'` → `import('./cases/p-v1')`; `export async function loadSuite(suiteId, suites = SUITES): Promise<LoadedSuite>` resolves the modules and delegates to `validateSuite`; unknown id throws `SuiteLoadError('unknown-suite')`. Explicit map, not `import.meta.glob`, so the same code runs under tsx (CLI, 12.8), Vitest and CommonJS.
  - [ ] `cases/p-v1/index.ts`: `export const cases: unknown[] = []` (12.4 appends one import per `*.case.ts`).
- [ ] Wire tests and scripts. (AC: 5)
  - [ ] Add `'src/suite/**/*.test.ts'` to `include` in `vitest.config.ts` and `src/suite` to the package `test` script path list; keep the live-scenario `--exclude` flags intact.
  - [ ] `src/suite/__fixtures__/cases.ts`: a `validConversationCase()` and `validObservationCase()` builder plus invalid variants typed `unknown` (TypeScript must not reject the file before Zod does).
  - [ ] `src/suite/loader.test.ts`: refinement tests call `validateSuite('test', [fixture])`; `loadSuite('p-v1')` resolves `{ id: 'p-v1', cases: [] }`; `loadSuite('nope')` rejects with code `unknown-suite`; `advanceClock` adds `clock`; input not mutated (deep-freeze the fixture); drift guard: every `*.case.ts` found with `fs.readdirSync(path.join(__dirname, 'cases/p-v1'))` is imported by `index.ts` (CommonJS `__dirname`; no `import.meta`).
  - [ ] `src/suite/rules/registry.test.ts`: per wrapper PASS, FAIL, `no-reply` FAIL and NOT_OBSERVABLE (`observed: []`); `conversation` scope cases for all three; `none` kind returns NOT_OBSERVABLE.
  - [ ] `src/suite/schema.test.ts`: round trip of a full `CaseRun` and `CriterionResult`; `reply.text` invariant failure; `parseEvaluatedAt` for each kind; `fieldObserved` prefix cases.
- [ ] Verify and record. (AC: 1-6)
  - [ ] `pnpm --filter @entalent/conversation-sim test`, `typecheck`, `lint`; `pnpm harness:check -- --base 9814b7cf48c9be064d082253e8e4675436d83c05` and report the receipt path; add a row to `docs/agent-task-log.md`.

## Dev Notes

- Foundation story: 12.2 (evaluate/score/report) consumes `CaseRun` and `CriterionResult`, 12.3 adds rules to `RULES`, 12.4 feeds case records through `validateSuite`. Keep names exactly as written here and in the spine; later stories do not renegotiate them. [Source: _bmad-output/planning-artifacts/architecture/architecture-conversation-eval-regression-2026-10-17/ARCHITECTURE-SPINE.md#AD-1, #AD-2, #AD-3, #AD-6]
- Deliberate extensions beyond the spine's literal field lists, all additive: `SuiteCase.expectedBehavior` (AD-7 `JudgeInput.expectedBehavior`, CAP-1); `ObservationField` values `reply.messages`, `turn.intent`, `turn.replyPlan`, `steps.gapMs`; `CriterionResult.method: 'n/a'` for non-dashboard criteria; `CaseRun.state.afterStep` keyed by the step index as a decimal string (JSON keys). Stories 12.2 and 13.1 consume these names; do not rename. [Source: ARCHITECTURE-SPINE.md#AD-7, #AD-17]
- This story produces `RuleOutcome` only; `CriterionStatus` is assigned by `evaluate` in 12.2. `NOT_OBSERVABLE` means a required field is absent from `run.observed`; an observed but empty reply is `no-reply`. [Source: ARCHITECTURE-SPINE.md#AD-6, #AD-17]
- `schema.ts` depends only on `zod`; `registry.ts` and the rule files may import `../schema`, `../../harness/assertions` and `@entalent/ai-openai`. Nothing under `src/suite/` is imported by product packages; 12.3 adds the import-graph test. [Source: ARCHITECTURE-SPINE.md#Design-Paradigm, #AD-12]
- Legacy rules keep their product-shared definition on purpose: `hasReflectiveOpener` lives in `packages/ai-openai/src/prompts/style-antipatterns.ts` so the runtime gate and the simulation agree. Do not copy regexes into `suite/`. [Source: packages/conversation-sim/README.md#Reading-a-result; ARCHITECTURE-SPINE.md#AD-6]
- `harness/assertions.ts` consumers that must stay green after the export change: `harness/report.ts`, `scenarios/baseline-test-helpers.ts`, `harness/coach-harness.test.ts` (offline) and the live `*.sim.test.ts` scenarios (not run here). [Source: packages/conversation-sim/src/harness/assertions.ts]
- Ids: suite `p-v1`, case `P-07`, criterion `P-07.C3`; rule names kebab-case; fixture and state-query names camelCase. [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions]
- Zod stays on 3.25.x because `ai` 6.0.240 peers on `^3.25.76 || ^4.1.8` and the workspace already resolves `zod@3.25.76` for `packages/config` and `packages/contracts`; a second zod major in `conversation-sim` alone would give `Output.object` (13.1) two zod instances. `zod@4.4.3` in the lockfile is transitive under `@langwatch/scenario` only. Use `z.discriminatedUnion`, `.superRefine` with `ctx.addIssue({ code: z.ZodIssueCode.custom, path, message })`, `.int().nonnegative()`, `.datetime({ offset: true })`. [Source: ARCHITECTURE-SPINE.md#Stack, #Verification-Notes; pnpm-lock.yaml]
- TypeScript: `tsconfig` is CommonJS with `noEmit`; `target`/`lib` ES2022, so no `Array.prototype.findLast`, `toSorted`, `Object.groupBy`; `useUnknownInCatchVariables` is on, narrow caught errors before reading `.message`. [Source: packages/conversation-sim/tsconfig.json; tsconfig.base.json; docs/agent-failures.md 2026-09-03]
- ESLint for this package is the root config: `no-explicit-any` (use `unknown`), `no-unused-vars` with `_` prefix, no `import/order` rule (keep imports grouped builtin / external / parent / sibling anyway, matching `assertions.ts`), `no-console` off by package override. Do not add `extends` to the package `.eslintrc.cjs`. The loader throws rather than logs because the runner (12.8) owns output. [Source: .eslintrc.cjs; packages/conversation-sim/.eslintrc.cjs]
- Vitest 3.2.7, `globals: false`: import `describe/it/expect` from `vitest`. `vitest.config.ts` includes only `src/scenarios/**/*.sim.test.ts`, `src/gate/**/*.test.ts`, `src/harness/**/*.test.ts`; without the include change the suite tests never run. Run a focused file with `pnpm --filter @entalent/conversation-sim exec vitest run <file>`, never `sim -- <file>` (that runs the full live suite). [Source: packages/conversation-sim/vitest.config.ts; docs/agent-failures.md 2026-08-20, 2026-09-03]
- Harness loop: `node --import tsx scripts/agent-harness.ts reflection --changed-path packages/conversation-sim` before implementing (exit 2 means no open failures); finish with `pnpm harness:check -- --base 9814b7cf48c9be064d082253e8e4675436d83c05`. [Source: AGENTS.md#Diagnostic-Loop]
- Out of scope: P-01..P-10 records (12.4), evaluate/score/report (12.2), new rules (12.3), `ClockPort` (12.5), CLI and `suite.config.json` (12.8).

### Project Structure Notes

- New files under `packages/conversation-sim/src/suite/`: `schema.ts`, `schema.test.ts`, `loader.ts`, `loader.test.ts`, `__fixtures__/cases.ts`, `cases/p-v1/index.ts`, `rules/registry.ts`, `rules/reply-selection.ts`, `rules/too-many-questions.ts`, `rules/repeated-question.ts`, `rules/reflective-opener.ts`, `rules/registry.test.ts`. Each rule file exports one `RuleEntry` named in camelCase (`tooManyQuestions`).
- Modified files: `packages/conversation-sim/package.json` (zod devDependency, `test` script path), `vitest.config.ts` (include), `src/harness/assertions.ts` (three `export` keywords), `pnpm-lock.yaml` (importer entry), `docs/agent-task-log.md`.
- Matches the spine's Structural Seed; no other directories are created.

### Testing Requirements

- Offline only; no `pnpm sim` or `pnpm sim:gate`. In a fresh worktree run `pnpm install --offline --frozen-lockfile` and `pnpm --filter './packages/*' build` first: `registry.ts` resolves `@entalent/ai-openai` through its `dist` entry. In the main checkout `dist` already exists.

```bash
pnpm --filter @entalent/conversation-sim test
pnpm --filter @entalent/conversation-sim typecheck
pnpm --filter @entalent/conversation-sim lint
pnpm harness:check -- --base 9814b7cf48c9be064d082253e8e4675436d83c05
```

### References

- [Source: _bmad-output/planning-artifacts/conversation-eval-regression/epics.md#Story-12.1]
- [Source: _bmad-output/planning-artifacts/architecture/architecture-conversation-eval-regression-2026-10-17/ARCHITECTURE-SPINE.md#AD-1, #AD-2, #AD-3, #AD-6, #AD-7, #AD-12, #AD-17, #Consistency-Conventions, #Stack, #Structural-Seed]
- [Source: _bmad-output/specs/spec-conversation-eval-regression/SPEC.md#CAP-1, #CAP-3; case-mapping.md#4-Fixtures-to-build]
- [Source: packages/conversation-sim/src/harness/assertions.ts; vitest.config.ts; package.json; tsconfig.json; .eslintrc.cjs]
- [Source: packages/application/src/use-cases/conversation-orchestrator.ts (OrchestrateResult)]
- [Source: AGENTS.md#Testing-Policy, #Diagnostic-Loop]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

import type { ZodError, ZodType } from 'zod';
import { tests as pV1Tests } from './cases/p-v1';
import { sources as pV1Sources } from './cases/p-v1/sources';
import { RULES, type RuleRegistry } from './rules/registry';
import {
  SourceCaseSchema,
  SuiteTestSchema,
  type Criterion,
  type FixtureRef,
  type LoadedCriterion,
  type LoadedSuite,
  type LoadedTest,
  type RuleCheck,
  type SourceCase,
  type SourceCriterion,
  type SuiteTest,
} from './schema';

export type SuiteLoadErrorCode =
  | 'unknown-suite'
  | 'invalid-source'
  | 'invalid-test'
  | 'invalid-l0'
  | 'duplicate-test-id'
  | 'duplicate-criterion-id'
  | 'test-id-format'
  | 'unknown-source'
  | 'unknown-criterion'
  | 'not-testable-criterion'
  | 'uncovered-criterion'
  | 'unknown-rule'
  | 'invalid-rule-params';

export type SuiteLoadPath = ReadonlyArray<string | number>;

export class SuiteLoadError extends Error {
  readonly code: SuiteLoadErrorCode;
  readonly suiteId: string;
  /** The offending test, or the source case for manifest and coverage errors. */
  readonly testId: string | undefined;
  /** Path inside the test (or source case), as Zod reports it. */
  readonly path: SuiteLoadPath;

  constructor(
    code: SuiteLoadErrorCode,
    suiteId: string,
    detail: string,
    options: { testId?: string; path?: SuiteLoadPath } = {},
  ) {
    const where = [options.testId, options.path && options.path.length > 0 ? options.path.join('.') : undefined]
      .filter((part) => part !== undefined)
      .join(' at ');
    super(`[suite] ${suiteId}: ${code}${where ? ` (${where})` : ''}: ${detail}`);
    this.name = 'SuiteLoadError';
    this.code = code;
    this.suiteId = suiteId;
    this.testId = options.testId;
    this.path = options.path ?? [];
  }
}

export interface SuiteModules {
  sources: readonly unknown[];
  tests: readonly unknown[];
}

/** Explicit suite registry; no directory scanning. */
export const SUITES: Readonly<Record<string, SuiteModules>> = Object.freeze({
  'p-v1': { sources: pV1Sources, tests: pV1Tests },
});

export function loadSuite(suiteId: string, rules: RuleRegistry = RULES): LoadedSuite {
  const modules = Object.prototype.hasOwnProperty.call(SUITES, suiteId) ? SUITES[suiteId] : undefined;
  if (!modules) {
    throw new SuiteLoadError('unknown-suite', suiteId, `known suites: ${Object.keys(SUITES).join(', ')}`);
  }
  return validateSuite(suiteId, modules, rules);
}

/**
 * Validates a suite's source manifest and tests, stopping at the first invalid record,
 * and joins `layer` and `passCondition` from the manifest into every test criterion.
 * Inputs are parsed as `unknown` and never mutated.
 */
export function validateSuite(suiteId: string, modules: SuiteModules, rules: RuleRegistry = RULES): LoadedSuite {
  const sources = parseSources(suiteId, modules.sources);
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const tests: LoadedTest[] = [];
  const testIds = new Set<string>();

  modules.tests.forEach((raw, index) => {
    const testId = rawId(raw) ?? `#${index}`;
    const parsed = SuiteTestSchema.safeParse(raw);
    if (!parsed.success) throw zodFailure('invalid-test', suiteId, testId, parsed.error);
    const test = parsed.data;

    checkTestIdFormat(suiteId, test);
    if (testIds.has(test.id)) {
      throw new SuiteLoadError('duplicate-test-id', suiteId, `test id ${test.id} is already used`, {
        testId: test.id,
        path: ['id'],
      });
    }
    testIds.add(test.id);

    const source = sourcesById.get(test.sourceCase);
    if (!source) {
      throw new SuiteLoadError('unknown-source', suiteId, `source case ${test.sourceCase} is not in the manifest`, {
        testId: test.id,
        path: ['sourceCase'],
      });
    }
    const expectedSourceKind = test.kind === 'observation' ? 'observation' : 'conversation';
    if (source.kind !== expectedSourceKind) {
      throw new SuiteLoadError(
        'invalid-test',
        suiteId,
        `${test.kind} tests need a ${expectedSourceKind} source case, ${source.id} is ${source.kind}`,
        { testId: test.id, path: ['kind'] },
      );
    }

    const criteria = joinCriteria(suiteId, test, source);
    checkRules(suiteId, test, rules);
    checkL0(suiteId, test, rules);

    tests.push({ ...test, setup: withClockFixture(test), criteria });
  });

  checkCoverage(suiteId, sources, tests);
  return { id: suiteId, sources, tests };
}

function parseSources(suiteId: string, rawSources: readonly unknown[]): SourceCase[] {
  const seen = new Set<string>();
  return rawSources.map((raw, index) => {
    const sourceId = rawId(raw) ?? `#${index}`;
    const parsed = SourceCaseSchema.safeParse(raw);
    if (!parsed.success) throw zodFailure('invalid-source', suiteId, sourceId, parsed.error);
    if (seen.has(parsed.data.id)) {
      throw new SuiteLoadError('invalid-source', suiteId, `duplicate source case ${parsed.data.id}`, {
        testId: parsed.data.id,
        path: ['id'],
      });
    }
    seen.add(parsed.data.id);
    return parsed.data;
  });
}

function checkTestIdFormat(suiteId: string, test: SuiteTest): void {
  const prefix = test.sourceCase.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  const pattern =
    test.kind === 'atomic'
      ? new RegExp(`^${prefix}\\.A[1-9]\\d*$`)
      : test.kind === 'journey'
        ? new RegExp(`^${prefix}\\.J$`)
        : new RegExp(`^${prefix}$`);
  if (!pattern.test(test.id)) {
    const expected =
      test.kind === 'atomic' ? `${test.sourceCase}.A<n>` : test.kind === 'journey' ? `${test.sourceCase}.J` : test.sourceCase;
    throw new SuiteLoadError('test-id-format', suiteId, `${test.kind} test id must be ${expected}`, {
      testId: test.id,
      path: ['id'],
    });
  }
}

function joinCriteria(suiteId: string, test: SuiteTest, source: SourceCase): LoadedCriterion[] {
  const manifest = new Map<string, SourceCriterion>(source.criteria.map((criterion) => [criterion.id, criterion]));
  const seen = new Set<string>();
  return test.criteria.map((criterion, index) => {
    const path = ['criteria', index, 'id'];
    if (seen.has(criterion.id)) {
      throw new SuiteLoadError('duplicate-criterion-id', suiteId, `criterion ${criterion.id} appears twice`, {
        testId: test.id,
        path,
      });
    }
    seen.add(criterion.id);
    const entry = manifest.get(criterion.id);
    if (!entry) {
      throw new SuiteLoadError('unknown-criterion', suiteId, `${criterion.id} is not a criterion of ${source.id}`, {
        testId: test.id,
        path,
      });
    }
    if (entry.notTestableReason !== undefined) {
      throw new SuiteLoadError(
        'not-testable-criterion',
        suiteId,
        `${criterion.id} is NOT TESTABLE in the manifest: ${entry.notTestableReason}`,
        { testId: test.id, path },
      );
    }
    return { ...criterion, layer: entry.layer, passCondition: entry.passCondition, stateEffect: entry.stateEffect };
  });
}

/** Every referenced rule exists and its `params` match the rule's schema (none allowed without one). */
function checkRules(suiteId: string, test: SuiteTest, rules: RuleRegistry): void {
  const references: Array<{ check: RuleCheck; path: Array<string | number> }> = [];
  test.preconditions.forEach((check, index) => references.push({ check, path: ['preconditions', index] }));
  test.steps.forEach((step, stepIndex) =>
    step.checkpoint?.checks.forEach((check, index) =>
      references.push({ check, path: ['steps', stepIndex, 'checkpoint', 'checks', index] }),
    ),
  );
  test.criteria.forEach((criterion, criterionIndex) =>
    criterion.checks.forEach((check, index) => {
      if (check.type === 'rule') references.push({ check, path: ['criteria', criterionIndex, 'checks', index] });
    }),
  );
  for (const { check, path } of references) {
    if (!hasRule(rules, check.rule)) {
      throw new SuiteLoadError('unknown-rule', suiteId, `rule ${check.rule} is not in the registry`, {
        testId: test.id,
        path: [...path, 'rule'],
      });
    }
    checkRuleParams(suiteId, test, check, rules[check.rule]!.params, [...path, 'params']);
  }
}

function checkRuleParams(
  suiteId: string,
  test: SuiteTest,
  check: RuleCheck,
  schema: ZodType | undefined,
  path: Array<string | number>,
): void {
  if (!schema) {
    if (check.params === undefined) return;
    const first = Object.keys(check.params)[0];
    throw new SuiteLoadError('invalid-rule-params', suiteId, `rule ${check.rule} takes no params`, {
      testId: test.id,
      path: first === undefined ? path : [...path, first],
    });
  }
  const parsed = schema.safeParse(check.params);
  if (parsed.success) return;
  const issue = parsed.error.issues[0];
  throw new SuiteLoadError('invalid-rule-params', suiteId, `rule ${check.rule}: ${issue?.message ?? 'invalid params'}`, {
    testId: test.id,
    path: [...path, ...(issue?.path ?? [])],
  });
}

/** L0 decides only rules over orchestrator-produced inputs, never reply text the test scripted. */
function checkL0(suiteId: string, test: SuiteTest, rules: RuleRegistry): void {
  if (!test.levels.includes('L0')) return;
  if (!test.scripted) {
    throw new SuiteLoadError('invalid-l0', suiteId, 'L0 tests carry their scripted model outputs', {
      testId: test.id,
      path: ['scripted'],
    });
  }
  test.criteria.forEach((criterion, index) => {
    if (!inL0Scope(criterion)) return;
    const decidable = criterion.checks.some(
      (check) => check.type === 'rule' && hasRule(rules, check.rule) && !rules[check.rule]!.requires.includes('reply.text'),
    );
    if (!decidable) {
      throw new SuiteLoadError(
        'invalid-l0',
        suiteId,
        `${criterion.id} is L0-scoped but has no rule check independent of reply.text`,
        { testId: test.id, path: ['criteria', index, 'checks'] },
      );
    }
  });
}

function inL0Scope(criterion: Criterion): boolean {
  return criterion.levels === undefined || criterion.levels.includes('L0');
}

function withClockFixture(test: SuiteTest): FixtureRef[] {
  const advancesClock = test.steps.some((step) => step.advanceClock !== undefined);
  if (!advancesClock || test.setup.some((fixture) => fixture.name === 'clock')) return test.setup;
  return [...test.setup, { name: 'clock' }];
}

function checkCoverage(suiteId: string, sources: SourceCase[], tests: LoadedTest[]): void {
  for (const source of sources) {
    if (source.kind === 'observation') {
      if (!tests.some((test) => test.kind === 'observation' && test.sourceCase === source.id)) {
        throw new SuiteLoadError('uncovered-criterion', suiteId, `observation source ${source.id} has no observation test`, {
          testId: source.id,
        });
      }
    }
    const coveringKind = source.kind === 'observation' ? 'observation' : 'atomic';
    const covered = new Set(
      tests
        .filter((test) => test.kind === coveringKind && test.sourceCase === source.id)
        .flatMap((test) => test.criteria.map((criterion) => criterion.id)),
    );
    source.criteria.forEach((criterion, index) => {
      if (criterion.notTestableReason !== undefined || covered.has(criterion.id)) return;
      throw new SuiteLoadError('uncovered-criterion', suiteId, `${criterion.id} is not covered by an ${coveringKind} test`, {
        testId: source.id,
        path: ['criteria', index, 'id'],
      });
    });
  }
}

function hasRule(rules: RuleRegistry, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(rules, name);
}

function rawId(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const id = (raw as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

function zodFailure(code: SuiteLoadErrorCode, suiteId: string, testId: string, error: ZodError): SuiteLoadError {
  const issue = error.issues[0];
  return new SuiteLoadError(code, suiteId, issue?.message ?? 'invalid record', {
    testId,
    path: issue?.path ?? [],
  });
}

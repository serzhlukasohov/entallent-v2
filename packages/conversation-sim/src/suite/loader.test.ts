import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  TEST_RULES,
  atomicTest,
  deepFreeze,
  observationTest,
  validModules,
} from './__fixtures__/suite';
import { SuiteLoadError, loadSuite, validateSuite, type SuiteLoadErrorCode } from './loader';
import type { RuleRegistry } from './rules/registry';

type Modules = { sources: unknown[]; tests: unknown[] };
type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function load(mutate: (modules: { sources: Rec[]; tests: Rec[] }) => void = () => undefined, rules: RuleRegistry = TEST_RULES) {
  const modules = structuredClone(validModules()) as { sources: Rec[]; tests: Rec[] };
  mutate(modules);
  return validateSuite('x-suite', deepFreeze(modules as Modules), rules);
}

function loadError(
  mutate: (modules: { sources: Rec[]; tests: Rec[] }) => void,
  rules: RuleRegistry = TEST_RULES,
): SuiteLoadError {
  try {
    load(mutate, rules);
  } catch (error) {
    expect(error).toBeInstanceOf(SuiteLoadError);
    return error as SuiteLoadError;
  }
  throw new Error('expected a SuiteLoadError');
}

function expectLoadError(
  mutate: (modules: { sources: Rec[]; tests: Rec[] }) => void,
  expected: { code: SuiteLoadErrorCode; testId?: string; path?: Array<string | number> },
  rules: RuleRegistry = TEST_RULES,
): SuiteLoadError {
  const error = loadError(mutate, rules);
  expect(error.code).toBe(expected.code);
  expect(error.suiteId).toBe('x-suite');
  if (expected.testId !== undefined) expect(error.testId).toBe(expected.testId);
  if (expected.path !== undefined) expect(error.path).toEqual(expected.path);
  return error;
}

const atomic = (modules: { tests: Rec[] }): Rec => modules.tests[0]!;
const journey = (modules: { tests: Rec[] }): Rec => modules.tests[1]!;
const observation = (modules: { tests: Rec[] }): Rec => modules.tests[2]!;

describe('validateSuite: valid suite', () => {
  it('loads atomic, journey and observation tests and joins layer and passCondition', () => {
    const suite = load();
    expect(suite.id).toBe('x-suite');
    expect(suite.sources.map((source) => source.id)).toEqual(['X-01', 'X-02']);
    expect(suite.tests.map((test) => test.id)).toEqual(['X-01.A1', 'X-01.J', 'X-02']);

    const [a1, journeyResult, p06] = suite.tests;
    expect(a1!.criteria.map((c) => [c.id, c.layer, c.passCondition])).toEqual([
      ['X-01.C1', 'P', 'The bundle is staged.'],
      ['X-01.C2', 'S', 'Staged bundle count grows by one.'],
    ]);
    expect(a1!.criteria.find((c) => c.id === 'X-01.C2')!.stateEffect).toEqual({
      port: 'questionConfirmationRepo',
      method: 'stageBundle',
      expected: 1,
    });
    expect(journeyResult!.criteria.every((c) => typeof c.layer === 'string' && c.passCondition.length > 0)).toBe(true);
    expect(p06!.criteria[0]).toMatchObject({ layer: 'P', passCondition: 'Check-ins are 48 h apart.' });
  });

  it('adds the clock fixture to setup when a step advances the clock, once', () => {
    const suite = load();
    expect(suite.tests[0]!.setup).toEqual([{ name: 'freshPersona' }, { name: 'clock' }]);
    expect(suite.tests[1]!.setup).toEqual([]);

    const withClock = load((m) => {
      atomic(m).setup = [{ name: 'clock', params: { start: '2026-01-05T09:00:00Z' } }];
    });
    expect(withClock.tests[0]!.setup).toEqual([{ name: 'clock', params: { start: '2026-01-05T09:00:00Z' } }]);
  });

  it('never mutates its (deep-frozen) input', () => {
    const modules = deepFreeze(structuredClone(validModules()));
    const snapshot = structuredClone(modules);
    validateSuite('x-suite', modules, TEST_RULES);
    expect(modules).toEqual(snapshot);
  });

  it('stops at the first invalid test', () => {
    const error = expectLoadError(
      (m) => {
        journey(m).steps = [];
        observation(m).steps = [{ text: 'x' }];
      },
      { code: 'invalid-test' },
    );
    expect(error.testId).toBe('X-01.J');
  });
});

describe('loadSuite', () => {
  it('loads the empty p-v1 suite', () => {
    expect(loadSuite('p-v1')).toEqual({ id: 'p-v1', sources: [], tests: [] });
  });

  it('rejects an unknown suite', () => {
    for (const id of ['nope', 'toString']) {
      expect(() => loadSuite(id)).toThrow(SuiteLoadError);
      try {
        loadSuite(id);
      } catch (error) {
        expect((error as SuiteLoadError).code).toBe('unknown-suite');
        expect((error as SuiteLoadError).suiteId).toBe(id);
      }
    }
  });

  it('loads the empty smoke-v1 suite', () => {
    expect(loadSuite('smoke-v1')).toEqual({ id: 'smoke-v1', sources: [], tests: [] });
  });

  it.each(['p-v1', 'smoke-v1'])('lists every %s *.case.ts module in index.ts', (suiteId) => {
    const dir = join(__dirname, 'cases', suiteId);
    const index = readFileSync(join(dir, 'index.ts'), 'utf8');
    const missing = readdirSync(dir)
      .filter((file) => file.endsWith('.case.ts'))
      .map((file) => `./${file.replace(/\.ts$/, '')}`)
      .filter((specifier) => !index.includes(`'${specifier}'`));
    expect(missing).toEqual([]);
  });
});

describe('validateSuite: shape errors', () => {
  it('reports the Zod path of a malformed test', () => {
    expectLoadError((m) => (atomic(m).criteria[0].evaluatedAt = 'reply:x'), {
      code: 'invalid-test',
      testId: 'X-01.A1',
      path: ['criteria', 0, 'evaluatedAt'],
    });
    expectLoadError((m) => (atomic(m).surprise = true), { code: 'invalid-test', testId: 'X-01.A1' });
    expectLoadError((m) => (atomic(m).criteria[0].checks = [{ type: 'not-testable', reason: 'x' }]), {
      code: 'invalid-test',
      path: ['criteria', 0, 'checks', 0, 'type'],
    });
    expectLoadError((m) => ((m.tests as unknown[])[0] = 'not a test'), { code: 'invalid-test', testId: '#0' });
    expectLoadError((m) => (atomic(m).seed.history[0].atOffsetMs = 10), {
      code: 'invalid-test',
      path: ['seed', 'history', 1, 'atOffsetMs'],
    });
  });

  it('rejects an invalid source manifest', () => {
    expectLoadError((m) => (m.sources[0]!.criteria[0].layer = 'X'), {
      code: 'invalid-source',
      testId: 'X-01',
      path: ['criteria', 0, 'layer'],
    });
    expectLoadError((m) => (m.sources[0]!.criteria[0].id = 'X-02.C1'), { code: 'invalid-source' });
    expectLoadError((m) => m.sources.push(structuredClone(m.sources[0]!)), { code: 'invalid-source', path: ['id'] });
    expectLoadError((m) => (m.sources[0]!.criteria[1].id = 'X-01.C1'), {
      code: 'invalid-source',
      testId: 'X-01',
      path: ['criteria', 1, 'id'],
    });
  });
});

describe('validateSuite: kind refinements', () => {
  it.each([
    ['two steps', (t: Rec) => t.steps.push({ text: 'again' }), ['steps']],
    ['zero steps', (t: Rec) => (t.steps = []), ['steps']],
    ['no seed', (t: Rec) => delete t.seed, ['seed']],
    [
      'a checkpoint',
      (t: Rec) => (t.steps[0].checkpoint = { checks: [{ type: 'rule', rule: 'events-only' }], onFail: 'stop' }),
      ['steps', 0, 'checkpoint'],
    ],
    ['L2 in levels', (t: Rec) => (t.levels = ['L0', 'L1', 'L2']), ['levels']],
    ['a duplicate level', (t: Rec) => (t.levels = ['L0', 'L0']), ['levels']],
    ['a scripted step outside 1..steps.length', (t: Rec) => (t.scripted = [{ step: 2 }]), ['scripted', 0, 'step']],
    ['a duplicate scripted step', (t: Rec) => (t.scripted = [{ step: 1 }, { step: 1 }]), ['scripted', 1, 'step']],
  ])('rejects an atomic test with %s', (_label, mutate, path) => {
    expectLoadError((m) => mutate(atomic(m)), { code: 'invalid-test', testId: 'X-01.A1', path });
  });

  it.each([
    ['journey with 0 steps', (m: Modules & { tests: Rec[] }) => (journey(m).steps = []), 'X-01.J', ['steps']],
    [
      'journey with a seed',
      (m: Modules & { tests: Rec[] }) => (journey(m).seed = { history: [] }),
      'X-01.J',
      ['seed'],
    ],
    [
      'journey with an observationWindow',
      (m: Modules & { tests: Rec[] }) => (journey(m).observationWindow = { durationMs: 1_000, scanEveryMs: 100 }),
      'X-01.J',
      ['observationWindow'],
    ],
    [
      'journey with an observation-window criterion',
      (m: Modules & { tests: Rec[] }) => (journey(m).criteria[1].evaluatedAt = 'observation-window'),
      'X-01.J',
      ['criteria', 1, 'evaluatedAt'],
    ],
    ['observation with steps', (m: Modules & { tests: Rec[] }) => (observation(m).steps = [{ text: 'hi' }]), 'X-02', ['steps']],
    [
      'observation with a seed',
      (m: Modules & { tests: Rec[] }) => (observation(m).seed = { history: [] }),
      'X-02',
      ['seed'],
    ],
    [
      'observation with a reply:<n> criterion',
      (m: Modules & { tests: Rec[] }) => (observation(m).criteria[0].evaluatedAt = 'reply:1'),
      'X-02',
      ['criteria', 0, 'evaluatedAt'],
    ],
    [
      'observation without observationWindow',
      (m: Modules & { tests: Rec[] }) => delete observation(m).observationWindow,
      'X-02',
      ['observationWindow'],
    ],
  ])('rejects %s', (_label, mutate, testId, path) => {
    expectLoadError((m) => mutate(m as Modules & { tests: Rec[] }), { code: 'invalid-test', testId, path });
  });

  it('rejects a test whose kind does not match its source kind', () => {
    expectLoadError(
      (m) => {
        const test = observationTest() as Rec;
        test.sourceCase = 'X-01';
        test.id = 'X-01';
        test.criteria[0].id = 'X-01.C1';
        m.tests.push(test);
      },
      { code: 'invalid-test', testId: 'X-01', path: ['kind'] },
    );
  });
});

describe('validateSuite: index and state refinements', () => {
  it.each([
    ['reply:<n> past the last step', (t: Rec) => (t.criteria[0].evaluatedAt = 'reply:2'), ['criteria', 0, 'evaluatedAt']],
    ['after-step:<n> past the last step', (t: Rec) => (t.criteria[0].evaluatedAt = 'after-step:2'), ['criteria', 0, 'evaluatedAt']],
    ['reply:0', (t: Rec) => (t.criteria[0].evaluatedAt = 'reply:0'), ['criteria', 0, 'evaluatedAt']],
    ['stateQuery.at past the last step', (t: Rec) => (t.criteria[1].stateQuery.at = 'after-step:2'), ['criteria', 1, 'stateQuery', 'at']],
    ['a state criterion without stateQuery', (t: Rec) => delete t.criteria[1].stateQuery, ['criteria', 1, 'stateQuery']],
    [
      'a stateQuery on a reply criterion',
      (t: Rec) => (t.criteria[0].stateQuery = { name: 'outboundCount', at: 'after', kind: 'invariant' }),
      ['criteria', 0, 'stateQuery'],
    ],
  ])('rejects %s', (_label, mutate, path) => {
    expectLoadError((m) => mutate(atomic(m)), { code: 'invalid-test', testId: 'X-01.A1', path });
  });

  it('accepts after-step:<n> and stateQuery.at within 1..steps.length', () => {
    const suite = load((m) => {
      journey(m).criteria[0].evaluatedAt = 'after-step:2';
    });
    expect(suite.tests[1]!.criteria[0]!.evaluatedAt).toBe('after-step:2');
  });
});

describe('validateSuite: levels', () => {
  it('rejects criterion levels that are not a subset of the test levels', () => {
    expectLoadError((m) => (atomic(m).criteria[1].levels = ['L2']), {
      code: 'invalid-test',
      testId: 'X-01.A1',
      path: ['criteria', 1, 'levels', 0],
    });
  });

  it('rejects an L0-scoped criterion whose rule checks all need reply.text', () => {
    expectLoadError((m) => delete atomic(m).criteria[1].levels, {
      code: 'invalid-l0',
      testId: 'X-01.A1',
      path: ['criteria', 1, 'checks'],
    });
  });

  it('rejects an L0-scoped meaning-only criterion', () => {
    expectLoadError((m) => (observation(m).criteria[0].checks = [{ type: 'meaning' }]), {
      code: 'invalid-l0',
      testId: 'X-02',
    });
  });

  it('rejects an L0 test without scripted outputs', () => {
    expectLoadError((m) => delete atomic(m).scripted, { code: 'invalid-l0', testId: 'X-01.A1', path: ['scripted'] });
  });

  it('accepts a reply.text criterion once it is narrowed away from L0', () => {
    expect(load().tests[0]!.criteria[1]!.levels).toEqual(['L1']);
  });
});

describe('validateSuite: ids', () => {
  it('rejects a duplicate test id', () => {
    expectLoadError((m) => m.tests.push(atomicTest()), { code: 'duplicate-test-id', testId: 'X-01.A1', path: ['id'] });
  });

  it('rejects a duplicate criterion id within one test', () => {
    expectLoadError((m) => (journey(m).criteria[1].id = 'X-01.C1'), {
      code: 'duplicate-criterion-id',
      testId: 'X-01.J',
      path: ['criteria', 1, 'id'],
    });
  });

  it.each([
    ['atomic', (m: { tests: Rec[] }) => (atomic(m).id = 'X-01.J1'), 'X-01.J1'],
    ['atomic A0', (m: { tests: Rec[] }) => (atomic(m).id = 'X-01.A0'), 'X-01.A0'],
    ['journey', (m: { tests: Rec[] }) => (journey(m).id = 'X-01.A2'), 'X-01.A2'],
    ['observation', (m: { tests: Rec[] }) => (observation(m).id = 'X-02.O'), 'X-02.O'],
    ['foreign prefix', (m: { tests: Rec[] }) => (atomic(m).id = 'X-03.A1'), 'X-03.A1'],
  ])('rejects a malformed %s test id', (_label, mutate, testId) => {
    expectLoadError(mutate, { code: 'test-id-format', testId, path: ['id'] });
  });

  it('rejects an unknown sourceCase', () => {
    expectLoadError(
      (m) => {
        atomic(m).sourceCase = 'X-09';
        atomic(m).id = 'X-09.A1';
      },
      { code: 'unknown-source', testId: 'X-09.A1', path: ['sourceCase'] },
    );
  });
});

describe('validateSuite: manifest links', () => {
  it('rejects a criterion id absent from its source case', () => {
    expectLoadError((m) => (atomic(m).criteria[0].id = 'X-01.C9'), {
      code: 'unknown-criterion',
      testId: 'X-01.A1',
      path: ['criteria', 0, 'id'],
    });
    expectLoadError((m) => (journey(m).criteria[0].id = 'X-02.C1'), { code: 'unknown-criterion', testId: 'X-01.J' });
  });

  it('rejects a criterion that the manifest marks NOT TESTABLE', () => {
    expectLoadError((m) => (journey(m).criteria[0].id = 'X-01.C3'), {
      code: 'not-testable-criterion',
      testId: 'X-01.J',
      path: ['criteria', 0, 'id'],
    });
  });
});

describe('validateSuite: coverage', () => {
  it('rejects a testable conversation criterion not covered by an atomic test', () => {
    // The journey still covers X-01.C1, which does not count.
    expectLoadError((m) => atomic(m).criteria.splice(0, 1), {
      code: 'uncovered-criterion',
      testId: 'X-01',
      path: ['criteria', 0, 'id'],
    });
  });

  it('does not require NOT TESTABLE criteria to be covered', () => {
    expect(load().sources[0]!.criteria[2]!.notTestableReason).toBe('subjective opening');
  });

  it('rejects a testable observation criterion left out of the observation test', () => {
    expectLoadError(
      (m) => m.sources[1]!.criteria.push({ id: 'X-02.C2', layer: 'P', passCondition: 'Check-ins fall in working hours.' }),
      { code: 'uncovered-criterion', testId: 'X-02', path: ['criteria', 1, 'id'] },
    );
  });

  it('rejects an observation source without its observation test', () => {
    expectLoadError((m) => m.tests.splice(2, 1), { code: 'uncovered-criterion', testId: 'X-02' });
  });
});

describe('validateSuite: rules', () => {
  it('rejects an unknown rule in a criterion, a precondition or a checkpoint', () => {
    expectLoadError((m) => (journey(m).criteria[1].checks = [{ type: 'rule', rule: 'no-such-rule' }]), {
      code: 'unknown-rule',
      testId: 'X-01.J',
      path: ['criteria', 1, 'checks', 0, 'rule'],
    });
    expectLoadError((m) => (journey(m).preconditions = [{ type: 'rule', rule: 'no-such-rule' }]), {
      code: 'unknown-rule',
      path: ['preconditions', 0, 'rule'],
    });
    expectLoadError((m) => (journey(m).steps[0].checkpoint.checks = [{ type: 'rule', rule: 'no-such-rule' }]), {
      code: 'unknown-rule',
      path: ['steps', 0, 'checkpoint', 'checks', 0, 'rule'],
    });
  });

  it('rejects params on a rule without a params schema, naming the test id and path', () => {
    const error = expectLoadError(
      (m) => (journey(m).criteria[1].checks = [{ type: 'rule', rule: 'single-question', params: { max: 2 } }]),
      { code: 'invalid-rule-params', testId: 'X-01.J', path: ['criteria', 1, 'checks', 0, 'params', 'max'] },
    );
    expect(error.message).toMatch(/single-question takes no params/);
    expectLoadError((m) => (journey(m).preconditions = [{ type: 'rule', rule: 'reply-present', params: {} }]), {
      code: 'invalid-rule-params',
      path: ['preconditions', 0, 'params'],
    });
    expectLoadError(
      (m) => (journey(m).steps[0].checkpoint.checks = [{ type: 'rule', rule: 'too-many-questions', params: { x: 1 } }]),
      { code: 'invalid-rule-params', path: ['steps', 0, 'checkpoint', 'checks', 0, 'params', 'x'] },
    );
  });

  it('validates params against the rule schema and reports the Zod path', () => {
    const rules: RuleRegistry = {
      ...TEST_RULES,
      'with-params': { ...TEST_RULES['events-only']!, params: z.object({ step: z.number().int() }).strict() },
    };
    const set = (params?: Record<string, unknown>) => (m: { tests: Rec[] }) =>
      (journey(m).criteria[1].checks = [{ type: 'rule', rule: 'with-params', ...(params ? { params } : {}) }]);
    expect(() => load(set({ step: 1 }), rules)).not.toThrow();
    expectLoadError(set({ step: 'one' }), {
      code: 'invalid-rule-params',
      testId: 'X-01.J',
      path: ['criteria', 1, 'checks', 0, 'params', 'step'],
    }, rules);
    expectLoadError(set(), { code: 'invalid-rule-params', path: ['criteria', 1, 'checks', 0, 'params'] }, rules);
  });

  it('rejects a state-equals expected that does not match the query value schema', () => {
    const set = (expected: unknown) => (m: { tests: Rec[] }) =>
      (journey(m).criteria[1].checks = [
        { type: 'rule', rule: 'state-equals', params: { query: 'questionProgress', at: 'after', expected } },
      ]);
    expect(() => load(set({ answered: 1, total: 3 }))).not.toThrow();
    const error = expectLoadError(set(1), {
      code: 'invalid-rule-params',
      testId: 'X-01.J',
      path: ['criteria', 1, 'checks', 0, 'params', 'expected'],
    });
    expect(error.message).toMatch(/state-equals/);
  });

  it('rejects proactive-working-hours with an unknown time zone', () => {
    const set = (timezone: string) => (m: { tests: Rec[] }) =>
      (journey(m).criteria[1].checks = [{ type: 'rule', rule: 'proactive-working-hours', params: { timezone } }]);
    expect(() => load(set('Europe/Kyiv'))).not.toThrow();
    expectLoadError(set('Mars/Olympus'), {
      code: 'invalid-rule-params',
      testId: 'X-01.J',
      path: ['criteria', 1, 'checks', 0, 'params', 'timezone'],
    });
  });

  it('rejects state-not-greater-than on the non-count query questionProgress and before with delta or repliesWithMetadata', () => {
    const set = (params: Record<string, unknown>) => (m: { tests: Rec[] }) =>
      (journey(m).criteria[1].checks = [{ type: 'rule', rule: 'state-not-greater-than', params }]);
    expect(() => load(set({ query: 'stagedBundleCount', at: 'after', max: { repliesWithMetadata: 'k' }, delta: true }))).not.toThrow();
    expectLoadError(set({ query: 'questionProgress', at: 'after', max: 1 }), {
      code: 'invalid-rule-params',
      testId: 'X-01.J',
      path: ['criteria', 1, 'checks', 0, 'params', 'query'],
    });
    expectLoadError(set({ query: 'stagedBundleCount', at: 'before', max: 1, delta: true }), {
      code: 'invalid-rule-params',
      path: ['criteria', 1, 'checks', 0, 'params', 'delta'],
    });
    expectLoadError(set({ query: 'stagedBundleCount', at: 'before', max: { repliesWithMetadata: 'k' } }), {
      code: 'invalid-rule-params',
      path: ['criteria', 1, 'checks', 0, 'params', 'max'],
    });
  });

  it('uses the default registry when none is passed', () => {
    const modules = deepFreeze(structuredClone(validModules()));
    expect(() => validateSuite('x-suite', modules)).toThrow(/unknown-rule.*events-only/);
  });

  it('rejects a meaning check inside a checkpoint (checkpoints are rule-only)', () => {
    expectLoadError((m) => (journey(m).steps[0].checkpoint.checks = [{ type: 'meaning' }]), {
      code: 'invalid-test',
      path: ['steps', 0, 'checkpoint', 'checks', 0, 'type'],
    });
  });
});

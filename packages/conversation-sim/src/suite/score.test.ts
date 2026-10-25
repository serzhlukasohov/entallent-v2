import { describe, expect, it } from 'vitest';
import { result } from './__fixtures__/evaluation';
import { TEST_RULES, validModules } from './__fixtures__/suite';
import { validateSuite } from './loader';
import { ACCEPTABLE_THRESHOLD, ADEQUATE_THRESHOLD, minPasses, score } from './score';
import { ScoredCriterionSchema, type CriterionResult, type Layer, type LoadedSuite } from './schema';

const suite: LoadedSuite = validateSuite('x-suite', validModules(), TEST_RULES);

/** `pass` PASS and `fail` FAIL atomic results in one layer, each on its own test. */
function band(pass: number, fail: number, layer: Layer = 'P'): CriterionResult[] {
  return Array.from({ length: pass + fail }, (_, index) =>
    result({ testId: `X-09.A${index + 1}`, criterionId: 'X-09.C1', layer, status: index < pass ? 'PASS' : 'FAIL' }),
  );
}

const run = (results: CriterionResult[], n = 1) => score({ suite, level: 'L0', n, results });

describe('score: verdict bands (Framework v2.1.1)', () => {
  it.each([
    [10, 0, 'ADEQUATE'],
    [9, 1, 'ADEQUATE'], // exactly 0.90
    [89, 11, 'ACCEPTABLE WITH ISSUES'],
    [3, 1, 'ACCEPTABLE WITH ISSUES'], // exactly 0.75
    [74, 26, 'NOT ADEQUATE'],
    [0, 4, 'NOT ADEQUATE'],
  ] as const)('%i PASS / %i FAIL is %s', (pass, fail, verdict) => {
    const scored = run(band(pass, fail));
    expect(scored.verdict).toBe(verdict);
    expect(scored.layers!.combinedPdc).toEqual({ pass, fail, passRate: pass / (pass + fail) });
    expect(scored.provisional).toBe(false);
  });

  it('quotes the framework thresholds', () => {
    expect([ADEQUATE_THRESHOLD, ACCEPTABLE_THRESHOLD]).toEqual([0.9, 0.75]);
  });

  it('makes any non-advisory S FAIL NOT ADEQUATE regardless of P+D+C', () => {
    const scored = run([...band(10, 0), result({ testId: 'X-08.A1', criterionId: 'X-08.C1', layer: 'S', status: 'FAIL' })]);
    expect(scored.verdict).toBe('NOT ADEQUATE');
    expect(scored.layers!.rows.find((row) => row.layer === 'S')).toEqual({ layer: 'S', pass: 0, fail: 1, passRate: 0 });
  });

  it('ignores an advisory S FAIL', () => {
    const scored = run([
      ...band(10, 0),
      result({ testId: 'X-08.A1', criterionId: 'X-08.C1', layer: 'S', status: 'FAIL', advisory: true }),
    ]);
    expect(scored.verdict).toBe('ADEQUATE');
  });

  it('makes the verdict NOT ADEQUATE and provisional when no P/D/C criterion is decided', () => {
    const scored = run([result({ testId: 'X-08.A1', criterionId: 'X-08.C1', layer: 'S', status: 'PASS' })]);
    expect(scored.verdict).toBe('NOT ADEQUATE');
    expect(scored.provisional).toBe(true);
    expect(scored.provisionalReason).toMatch(/no decided P\/D\/C/);
  });
});

describe('score: layer table scope', () => {
  it('counts only in-scope, non-advisory atomic and observation PASS/FAIL', () => {
    const scored = run([
      result({ testId: 'X-01.A1', criterionId: 'X-01.C1', status: 'PASS' }),
      result({ testId: 'X-02', criterionId: 'X-02.C1', testKind: 'observation', layer: 'D', status: 'FAIL' }),
      result({ testId: 'X-01.J', criterionId: 'X-01.C1', testKind: 'journey', status: 'FAIL' }),
      result({ testId: 'X-01.A2', criterionId: 'X-01.C1', status: 'FAIL', advisory: true }),
      result({ testId: 'X-01.A3', criterionId: 'X-01.C1', status: 'NOT_RUN', inScope: false, reason: 'level-not-declared' }),
    ]);
    expect(scored.layers!.rows).toEqual([
      { layer: 'P', pass: 1, fail: 0, passRate: 1 },
      { layer: 'D', pass: 0, fail: 1, passRate: 0 },
      { layer: 'C', pass: 0, fail: 0, passRate: null },
      { layer: 'S', pass: 0, fail: 0, passRate: null },
    ]);
    expect(scored.verdict).toBe('NOT ADEQUATE');
    expect(scored.complete).toBe(true);
    expect(scored.journeys).toEqual({ keys: ['X-01.J/X-01.C1'], counts: { FAIL: 1 } });
  });

  it('marks a non-empty run with no in-scope result INCOMPLETE, not journeys-only', () => {
    const scored = run([
      result({ testId: 'X-01.A1', criterionId: 'X-01.C1', status: 'NOT_RUN', inScope: false, reason: 'level-not-declared' }),
    ]);
    expect(scored.complete).toBe(false);
    expect(scored.provisional).toBe(true);
    expect(scored.provisionalReason).toContain('incomplete: no in-scope test criteria');
    expect(scored.verdict).not.toBe('n/a (journeys only)');
  });

  it('reports n/a (journeys only) and no layer table when no atomic or observation result is in scope', () => {
    const scored = run([
      result({ testId: 'X-01.J', criterionId: 'X-01.C2', testKind: 'journey', status: 'PASS' }),
      result({ testId: 'X-01.A1', criterionId: 'X-01.C1', status: 'NOT_RUN', inScope: false, reason: 'level-not-declared' }),
    ]);
    expect(scored.verdict).toBe('n/a (journeys only)');
    expect(scored.layers).toBeNull();
    expect(scored.provisional).toBe(false);
  });
});

describe('score: COMPLETE and provisional', () => {
  it.each(['INVALID', 'ERROR', 'NOT_RUN'] as const)('marks an in-scope %s incomplete and provisional', (status) => {
    const scored = run([...band(10, 0), result({ testId: 'X-07.A1', criterionId: 'X-07.C1', status, reason: 'r' })]);
    expect(scored.complete).toBe(false);
    expect(scored.provisional).toBe(true);
    expect(scored.provisionalReason).toBe(`incomplete: 1 ${status}`);
    expect(scored.verdict).toBe('ADEQUATE');
  });

  it('counts an undecided journey criterion against COMPLETE', () => {
    const scored = run([...band(10, 0), result({ testId: 'X-01.J', criterionId: 'X-01.C1', testKind: 'journey', status: 'ERROR' })]);
    expect(scored.complete).toBe(false);
  });

  it('keeps out-of-scope NOT_RUN out of COMPLETE', () => {
    const scored = run([...band(10, 0), result({ testId: 'X-07.A1', criterionId: 'X-07.C1', status: 'NOT_RUN', inScope: false })]);
    expect(scored.complete).toBe(true);
  });
});

describe('score: rows', () => {
  it('adds one NOT_TESTABLE row per manifest NOT TESTABLE criterion keyed <sourceCase>/<criterionId>', () => {
    const scored = run(band(1, 0), 3);
    const row = scored.results.find((entry) => entry.status === 'NOT_TESTABLE');
    expect(row).toMatchObject({
      testId: 'X-01',
      criterionId: 'X-01.C3',
      testKind: null,
      checkKind: null,
      layer: 'C',
      inScope: true,
      n: 3,
      reason: 'subjective opening',
    });
    expect(scored.results.every((entry) => ScoredCriterionSchema.safeParse(entry).success)).toBe(true);
  });

  it('needs n/n passes for rule-decided criteria', () => {
    const samples = ['PASS', 'PASS', 'FAIL'] as const;
    const scored = run(
      samples.map((status) => result({ testId: 'X-01.A1', criterionId: 'X-01.C1', status, evidence: status === 'FAIL' ? 'turn 1 — x' : undefined })),
      3,
    );
    expect(scored.results[0]).toMatchObject({ status: 'FAIL', passCount: 2, n: 3, minPasses: 3, checkKind: 'rule', evidence: 'turn 1 — x' });
    expect(scored.results[0]!.samples).toHaveLength(3);
  });

  it('names the shortfall when fewer samples than n were produced', () => {
    const scored = run([result({ testId: 'X-01.A1', criterionId: 'X-01.C1', status: 'PASS' })], 3);
    expect(scored.results[0]).toMatchObject({ status: 'FAIL', passCount: 1, minPasses: 3, reason: 'passes-below-min:1/3' });
  });

  it('counts only in-scope journey results', () => {
    const scored = run([
      ...band(1, 0),
      result({ testId: 'X-01.J', criterionId: 'X-01.C1', testKind: 'journey', status: 'NOT_RUN', inScope: false, reason: 'level-not-declared' }),
    ]);
    expect(scored.journeys).toEqual({ keys: [], counts: {} });
  });

  it('needs ceil(0.8 n) passes for meaning-decided criteria', () => {
    // X-01.A1/X-01.C2 has a meaning check; samples were judged (not meaningSkipped).
    const samples = ['PASS', 'PASS', 'PASS', 'PASS', 'FAIL'] as const;
    const scored = run(
      samples.map((status) => result({ testId: 'X-01.A1', criterionId: 'X-01.C2', layer: 'S', status })),
      5,
    );
    expect(scored.results[0]).toMatchObject({ status: 'PASS', passCount: 4, minPasses: 4, checkKind: 'meaning' });
    expect(minPasses(5, true)).toBe(4);
    expect(minPasses(5, false)).toBe(5);
  });

  it('treats a meaning criterion decided by rules only (meaningSkipped) as rule-decided', () => {
    const scored = run(
      ['PASS', 'FAIL'].map((status) =>
        result({ testId: 'X-01.A1', criterionId: 'X-01.C2', status: status as 'PASS' | 'FAIL', meaningSkipped: true }),
      ),
      2,
    );
    expect(scored.results[0]).toMatchObject({ status: 'FAIL', minPasses: 2, checkKind: 'rule' });
  });

  it('lets an undecided sample decide the aggregated status by precedence', () => {
    const scored = run(
      [
        result({ testId: 'X-01.A1', criterionId: 'X-01.C1', status: 'PASS' }),
        result({ testId: 'X-01.A1', criterionId: 'X-01.C1', status: 'NOT_RUN', reason: 'no-replies' }),
        result({ testId: 'X-01.A1', criterionId: 'X-01.C1', status: 'ERROR', reason: 'orchestrator-exception' }),
      ],
      3,
    );
    expect(scored.results[0]).toMatchObject({ status: 'ERROR', reason: 'orchestrator-exception', passCount: 1 });
  });

  it('rejects more samples than n and results from another level', () => {
    expect(() => run(band(1, 0).concat(band(1, 0)), 1)).toThrow(/2 samples/);
    expect(() => run([result({ testId: 'X-01.A1', criterionId: 'X-01.C1', status: 'PASS', level: 'L1' })])).toThrow(/L1/);
    expect(() => run([], 0)).toThrow(/positive integer/);
  });
});

describe('score: rule FAIL among judged samples (AD-10, Story 13.1)', () => {
  const key = { testId: 'X-01.A1', criterionId: 'X-01.C2' } as const;

  it('makes the criterion rule-decided, n/n and not advisory when any sample is a rule FAIL', () => {
    const scored = run(
      [
        result({ ...key, status: 'PASS', advisory: true }),
        result({ ...key, status: 'PASS', advisory: true }),
        result({ ...key, status: 'FAIL', meaningSkipped: true }),
      ],
      3,
    );
    expect(scored.results[0]).toMatchObject({ status: 'FAIL', passCount: 2, minPasses: 3, checkKind: 'rule', advisory: false });
  });

  it('keeps all-judged samples meaning-decided and advisory under an untrusted judge', () => {
    const scored = run(
      [result({ ...key, status: 'PASS', advisory: true }), result({ ...key, status: 'FAIL', advisory: true })],
      2,
    );
    expect(scored.results[0]).toMatchObject({ checkKind: 'meaning', minPasses: 2, advisory: true });
  });
});

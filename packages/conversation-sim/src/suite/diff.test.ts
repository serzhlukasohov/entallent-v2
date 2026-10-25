import { beforeAll, describe, expect, it } from 'vitest';
import { RUNNER_CONFIG, fakeExecutor, fakeSuite } from './__fixtures__/runner';
import { TEST_RULES } from './__fixtures__/suite';
import { buildBaseline } from './baseline';
import { DIFF_CATEGORIES, baselineInvalidReasons, diffRun, diffSummaryLines, parseBaselineJson } from './diff';
import { renderSuiteReportMarkdown } from './report';
import { runSuite } from './runner';
import { minPasses } from './score';
import {
  SuiteDiffSchema,
  SuiteRunReportSchema,
  type Baseline,
  type BaselineResult,
  type DiffBaselineSource,
  type DiffEntry,
  type Level,
  type ScoredCriterion,
  type SuiteDiff,
  type SuiteRunReport,
} from './schema';

const SOURCE: DiffBaselineSource = { kind: 'default', ref: null, path: 'baselines/x-suite/L0.json', missing: false };
const FINGERPRINT = {
  provider: 'openai',
  model: 'gpt-4o',
  decoding: { temperature: 0, reasoningEffort: null, maxOutputTokens: 1024 },
  promptSha256: 'a'.repeat(64),
  schemaSha256: 'b'.repeat(64),
  guidanceSha256: 'c'.repeat(64),
};

let real: SuiteRunReport;

beforeAll(async () => {
  const { report } = await runSuite({
    suite: fakeSuite(),
    level: 'L0',
    n: 1,
    executor: fakeExecutor(),
    config: RUNNER_CONFIG,
    runId: '2026-10-25T10-00-00-000Z-abc1234',
    git: { sha: 'abc1234def5678', dirty: false },
    rules: TEST_RULES,
  });
  real = report;
});

type Kind = 'atomic' | 'journey' | 'observation' | null;

interface Spec {
  status: ScoredCriterion['status'];
  passCount?: number;
  n?: number;
  layer?: ScoredCriterion['layer'];
  testKind?: Kind;
  checkKind?: ScoredCriterion['checkKind'];
  advisory?: boolean;
  inScope?: boolean;
  reason?: string;
  sampleReason?: string;
}

function scored(key: string, spec: Spec): ScoredCriterion {
  const [testId, criterionId] = key.split('/') as [string, string];
  const n = spec.n ?? 1;
  const checkKind = spec.checkKind === undefined ? 'rule' : spec.checkKind;
  const passCount = spec.passCount ?? (spec.status === 'PASS' ? n : 0);
  return {
    testId,
    criterionId,
    sourceCase: criterionId.replace(/\.C\d+$/, ''),
    testKind: spec.testKind === undefined ? 'atomic' : spec.testKind,
    layer: spec.layer ?? 'P',
    inScope: spec.inScope ?? true,
    status: spec.status,
    passCount,
    n,
    minPasses: checkKind === null ? 0 : minPasses(n, checkKind === 'meaning'),
    checkKind,
    advisory: spec.advisory ?? false,
    method: 'observed',
    ...(spec.reason !== undefined ? { reason: spec.reason } : {}),
    samples: Array.from({ length: n }, (_, index) => ({
      status: index < passCount ? 'PASS' : spec.status === 'PASS' ? 'PASS' : spec.status,
      advisory: spec.advisory ?? false,
      ...(spec.sampleReason !== undefined ? { reason: spec.sampleReason } : {}),
    })),
  };
}

function report(
  results: Record<string, Spec>,
  overrides: Partial<SuiteRunReport> & { level?: Level } = {},
): SuiteRunReport {
  const level = overrides.level ?? 'L0';
  const n = Math.max(1, ...Object.values(results).map((spec) => spec.n ?? 1));
  return SuiteRunReportSchema.parse({
    ...real,
    level,
    n,
    results: Object.fromEntries(Object.entries(results).map(([key, spec]) => [key, scored(key, spec)])),
    ...overrides,
  }) as SuiteRunReport;
}

function baseline(results: Record<string, Spec>, overrides: Partial<Baseline> = {}): Baseline {
  const entries: Record<string, BaselineResult> = {};
  for (const [key, spec] of Object.entries(results)) {
    const result = scored(key, spec);
    entries[key] = {
      status: result.status,
      passCount: result.passCount,
      n: result.n,
      layer: result.layer,
      testKind: result.testKind,
      checkKind: result.checkKind,
    };
  }
  return {
    schemaVersion: 1,
    suiteId: real.suiteId,
    level: 'L0',
    judge: { fingerprint: null, agreement: null },
    coach: { model: null },
    acceptedFrom: { runId: 'base-run', gitSha: 'base1234' },
    acceptedAt: '2026-10-24T10:00:00.000Z',
    provisional: false,
    results: entries,
    ...overrides,
  };
}

function only(diff: SuiteDiff, key: string): DiffEntry {
  const match = [...diff.tests.entries, ...diff.journeys.entries].find((entry) => entry.key === key);
  if (!match) throw new Error(`no entry ${key}`);
  return match;
}

const A = 'X-01.A1/X-01.C1';
const B = 'X-01.A2/X-01.C2';
const J = 'X-01.J/X-01.C1';

describe('diffRun: categories', () => {
  it('is all unchanged with exit 0 when the run equals its own baseline', () => {
    const diff = diffRun(real, buildBaseline(real, { acceptedAt: '2026-10-25T11:00:00.000Z' }), RUNNER_CONFIG, SOURCE);
    expect(SuiteDiffSchema.parse(diff)).toEqual(diff);
    expect(diff).toMatchObject({ outcome: 'clean', exitCode: 0, reasons: [], acceptedFrom: { runId: real.runId } });
    const all = [...diff.tests.entries, ...diff.journeys.entries];
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((entry) => entry.category === 'unchanged' && !entry.gating)).toBe(true);
    expect(diff.tests.counts.unchanged).toBe(diff.tests.entries.length);
  });

  it('flags a rule regression as gating (exit 1)', () => {
    const diff = diffRun(report({ [A]: { status: 'FAIL' } }), baseline({ [A]: { status: 'PASS' } }), RUNNER_CONFIG, SOURCE);
    expect(only(diff, A)).toMatchObject({
      category: 'regressed',
      gating: true,
      baseline: { status: 'PASS', passCount: 1, n: 1 },
      current: { status: 'FAIL', passCount: 0, n: 1, minPasses: 1 },
    });
    expect(diff).toMatchObject({ outcome: 'failed', exitCode: 1 });
  });

  it('reports fixed without gating', () => {
    const diff = diffRun(report({ [A]: { status: 'PASS' } }), baseline({ [A]: { status: 'FAIL' } }), RUNNER_CONFIG, SOURCE);
    expect(only(diff, A)).toMatchObject({ category: 'fixed', gating: false });
    expect(diff.exitCode).toBe(0);
  });

  it('flags a trusted L1 meaning regression with n 3 below ceil(0.8n)', () => {
    const run = report({ [A]: { status: 'FAIL', passCount: 1, n: 3, checkKind: 'meaning' } }, { level: 'L1' });
    const base = baseline({ [A]: { status: 'PASS', n: 3, checkKind: 'meaning' } }, { level: 'L1' });
    const diff = diffRun(run, base, RUNNER_CONFIG, SOURCE);
    expect(only(diff, A)).toMatchObject({ category: 'regressed', gating: true, current: { minPasses: 3 } });
    expect(diff.exitCode).toBe(1);
  });

  it.each([
    ['L1 n 2 below diff.minSamples', 'L1' as const, 2, false],
    ['advisory', 'L1' as const, 3, true],
    ['L0 (no judge)', 'L0' as const, 5, false],
  ])('makes a meaning criterion inconclusive: %s', (_, level, n, advisory) => {
    const run = report({ [A]: { status: 'FAIL', passCount: 0, n, checkKind: 'meaning', advisory } }, { level });
    const base = baseline({ [A]: { status: 'PASS', n, checkKind: 'meaning' } }, { level });
    const diff = diffRun(run, base, RUNNER_CONFIG, SOURCE);
    expect(only(diff, A)).toMatchObject({ category: 'inconclusive', gating: false });
    expect(diff.exitCode).toBe(0);
  });

  it('reports a journey meaning regression in the journeys section without gating', () => {
    const run = report({ [J]: { status: 'FAIL', passCount: 1, n: 3, checkKind: 'meaning', testKind: 'journey' } }, { level: 'L1' });
    const base = baseline({ [J]: { status: 'PASS', n: 3, checkKind: 'meaning', testKind: 'journey' } }, { level: 'L1' });
    const diff = diffRun(run, base, RUNNER_CONFIG, SOURCE);
    expect(diff.tests.entries).toEqual([]);
    expect(diff.journeys.entries[0]).toMatchObject({ key: J, category: 'regressed', gating: false });
    expect(diff.journeys.counts.regressed).toBe(1);
    expect(diff.exitCode).toBe(0);
  });

  it('gates a journey rule criterion that lost coverage (PASS -> ERROR)', () => {
    const run = report({ [J]: { status: 'ERROR', testKind: 'journey' } });
    const diff = diffRun(run, baseline({ [J]: { status: 'PASS', testKind: 'journey' } }), RUNNER_CONFIG, SOURCE);
    expect(diff.journeys.entries[0]).toMatchObject({ category: 'lost-coverage', gating: true });
    expect(diff.exitCode).toBe(1);
  });

  it('treats out-of-scope and absent keys as missing: lost-coverage when decided, retired otherwise', () => {
    const run = report({ [A]: { status: 'NOT_RUN', inScope: false, reason: 'level-not-declared' } });
    const base = baseline({
      [A]: { status: 'PASS' },
      [B]: { status: 'NOT_RUN' },
      'X-02/X-02.C1': { status: 'FAIL', testKind: 'observation' },
      'X-01/X-01.C3': { status: 'NOT_TESTABLE', testKind: null, checkKind: null },
    });
    const diff = diffRun(run, base, RUNNER_CONFIG, SOURCE);
    expect(only(diff, A)).toMatchObject({ category: 'lost-coverage', gating: true, current: null });
    expect(only(diff, 'X-02/X-02.C1')).toMatchObject({ category: 'lost-coverage', testKind: 'observation' });
    expect(only(diff, B)).toMatchObject({ category: 'retired', gating: false });
    expect(only(diff, 'X-01/X-01.C3')).toMatchObject({ category: 'retired' });
  });

  it("judges a vanished criterion by the baseline's layer and kinds", () => {
    const base = baseline({
      [A]: { status: 'PASS', layer: 'S', checkKind: 'meaning' },
      [B]: { status: 'PASS', layer: 'P', checkKind: 'meaning' },
    });
    const diff = diffRun(report({}), base, RUNNER_CONFIG, SOURCE);
    expect(only(diff, A)).toMatchObject({ category: 'lost-coverage', layer: 'S', checkKind: 'meaning', gating: true });
    expect(only(diff, B)).toMatchObject({ category: 'lost-coverage', gating: false });
    expect(diff.exitCode).toBe(1);
  });

  it("uses the run's layer when the key is in both", () => {
    const run = report({ [A]: { status: 'ERROR', layer: 'P', checkKind: 'meaning' } });
    const diff = diffRun(run, baseline({ [A]: { status: 'PASS', layer: 'S', checkKind: 'meaning' } }), RUNNER_CONFIG, SOURCE);
    expect(only(diff, A)).toMatchObject({ category: 'lost-coverage', layer: 'P', gating: false });
  });

  it('handles NOT_TESTABLE on either side and undecided transitions', () => {
    const run = report({
      'X-01.A1/X-01.C1': { status: 'NOT_TESTABLE', checkKind: null },
      'X-01.A2/X-01.C1': { status: 'NOT_TESTABLE', checkKind: null },
      'X-01.A3/X-01.C1': { status: 'NOT_RUN' },
      'X-01.A4/X-01.C1': { status: 'PASS' },
      'X-01.A5/X-01.C1': { status: 'PASS' },
      'X-01.A6/X-01.C1': { status: 'INVALID' },
      'X-01.A7/X-01.C1': { status: 'NOT_RUN' },
    });
    const base = baseline({
      'X-01.A1/X-01.C1': { status: 'NOT_TESTABLE', checkKind: null },
      'X-01.A2/X-01.C1': { status: 'PASS' },
      'X-01.A3/X-01.C1': { status: 'NOT_TESTABLE', checkKind: null },
      'X-01.A4/X-01.C1': { status: 'NOT_TESTABLE', checkKind: null },
      'X-01.A5/X-01.C1': { status: 'ERROR' },
      'X-01.A6/X-01.C1': { status: 'ERROR' },
      'X-01.A7/X-01.C1': { status: 'FAIL' },
    });
    const diff = diffRun(run, base, RUNNER_CONFIG, SOURCE);
    const category = (test: string) => only(diff, `${test}/X-01.C1`).category;
    expect(category('X-01.A1')).toBe('unchanged');
    expect(category('X-01.A2')).toBe('retired');
    expect(category('X-01.A3')).toBe('unchanged');
    expect(category('X-01.A4')).toBe('gained-coverage');
    expect(category('X-01.A5')).toBe('gained-coverage');
    expect(category('X-01.A6')).toBe('unchanged');
    expect(category('X-01.A7')).toBe('lost-coverage');
    expect(diff.exitCode).toBe(1);
  });

  it('marks keys absent from the baseline as new and never gates on them', () => {
    const diff = diffRun(report({ [A]: { status: 'FAIL', layer: 'S' } }), baseline({}), RUNNER_CONFIG, SOURCE);
    expect(only(diff, A)).toMatchObject({ category: 'new', gating: false, baseline: null });
    expect(diff.exitCode).toBe(0);
  });

  it('covers every category in the tests section', () => {
    const run = report({
      'X-01.A1/X-01.C1': { status: 'FAIL' },
      'X-01.A2/X-01.C1': { status: 'PASS' },
      'X-01.A3/X-01.C1': { status: 'ERROR' },
      'X-01.A4/X-01.C1': { status: 'PASS' },
      'X-01.A5/X-01.C1': { status: 'PASS' },
      'X-01.A6/X-01.C1': { status: 'NOT_TESTABLE', checkKind: null },
      'X-01.A7/X-01.C1': { status: 'FAIL', checkKind: 'meaning' },
      'X-01.A8/X-01.C1': { status: 'PASS' },
    });
    const base = baseline({
      'X-01.A1/X-01.C1': { status: 'PASS' },
      'X-01.A2/X-01.C1': { status: 'FAIL' },
      'X-01.A3/X-01.C1': { status: 'PASS' },
      'X-01.A4/X-01.C1': { status: 'NOT_RUN' },
      'X-01.A6/X-01.C1': { status: 'PASS' },
      'X-01.A7/X-01.C1': { status: 'PASS', checkKind: 'meaning' },
      'X-01.A8/X-01.C1': { status: 'PASS' },
    });
    const diff = diffRun(run, base, RUNNER_CONFIG, SOURCE);
    expect(diff.tests.counts).toEqual(Object.fromEntries(DIFF_CATEGORIES.map((category) => [category, 1])));
    expect(diff.tests.entries.map((entry) => entry.category)).toEqual([...DIFF_CATEGORIES]);
  });
});

describe('diffRun: exit codes', () => {
  it('exits 2 (baseline-invalid) when the coach model differs, classifying nothing', () => {
    const diff = diffRun(report({ [A]: { status: 'FAIL' } }), baseline({ [A]: { status: 'PASS' } }, { coach: { model: 'gpt-4o' } }), RUNNER_CONFIG, SOURCE);
    expect(diff).toMatchObject({ outcome: 'baseline-invalid', exitCode: 2, reasons: ["baseline coach model gpt-4o differs from the run's null"] });
    expect(diff.tests.entries).toEqual([]);
    expect(diff.journeys.entries).toEqual([]);
  });

  it('compares the judge fingerprint by stable JSON and checks suite and level', () => {
    const reordered = Object.fromEntries(Object.entries(FINGERPRINT).reverse());
    const run = report({ [A]: { status: 'PASS' } }, { judgeTrust: { ...real.judgeTrust, pin: FINGERPRINT } });
    expect(baselineInvalidReasons(run, baseline({}, { judge: { fingerprint: reordered as typeof FINGERPRINT, agreement: null } }))).toEqual([]);
    expect(baselineInvalidReasons(run, baseline({}))).toEqual(['baseline judge fingerprint differs from the run']);
    expect(baselineInvalidReasons(report({}), baseline({}, { suiteId: 'other', level: 'L1' }))).toEqual([
      `baseline suite other differs from the run's ${real.suiteId}`,
      "baseline level L1 differs from the run's L0",
    ]);
  });

  it('exits 2 on load errors', () => {
    const diff = diffRun(report({}), null, RUNNER_CONFIG, { ...SOURCE, kind: 'path', missing: true }, ['baseline file x.json not found']);
    expect(diff).toMatchObject({ outcome: 'baseline-invalid', exitCode: 2, reasons: ['baseline file x.json not found'] });
  });

  it('exits 3 on judge errors, still classifying entries, ahead of budget and gating', () => {
    const run = report({ [A]: { status: 'ERROR', reason: 'budget-exceeded' } }, { judgeErrors: [{ key: A, reason: 'judge-timeout' }] });
    const diff = diffRun(run, baseline({ [A]: { status: 'PASS' } }), RUNNER_CONFIG, SOURCE);
    expect(diff).toMatchObject({ outcome: 'judge-infrastructure', exitCode: 3 });
    expect(only(diff, A).category).toBe('lost-coverage');
  });

  it('exits 4 when an in-scope result or sample reason is budget-exceeded, ahead of gating', () => {
    const byResult = report({ [A]: { status: 'ERROR', reason: 'budget-exceeded' } });
    expect(diffRun(byResult, baseline({ [A]: { status: 'PASS' } }), RUNNER_CONFIG, SOURCE)).toMatchObject({
      outcome: 'budget-exceeded',
      exitCode: 4,
      reasons: [`budget exceeded at ${A}`],
    });
    const bySample = report({ [A]: { status: 'ERROR', sampleReason: 'budget-exceeded' } });
    expect(diffRun(bySample, baseline({ [A]: { status: 'PASS' } }), RUNNER_CONFIG, SOURCE).exitCode).toBe(4);
    const outOfScope = report({ [A]: { status: 'NOT_RUN', inScope: false, reason: 'budget-exceeded' } });
    expect(diffRun(outOfScope, baseline({}), RUNNER_CONFIG, SOURCE).exitCode).toBe(0);
  });

  it('exits 0 with every pair new when there is no baseline', () => {
    const diff = diffRun(real, null, RUNNER_CONFIG, { ...SOURCE, missing: true });
    expect(diff).toMatchObject({ outcome: 'no-baseline', exitCode: 0, acceptedFrom: null, provisional: false });
    expect([...diff.tests.entries, ...diff.journeys.entries].every((entry) => entry.category === 'new')).toBe(true);
    expect(diffSummaryLines(diff, real.runId)).toContain('[suite] diff: no baseline at baselines/x-suite/L0.json; every pair is new');
  });
});

describe('diffRun: --case narrowing', () => {
  it('compares a narrowed run only with baseline keys of that test id or source case', () => {
    const base = baseline({
      'X-01.A1/X-01.C1': { status: 'PASS' },
      'X-01.A2/X-01.C1': { status: 'PASS' },
      'X-01/X-01.C3': { status: 'NOT_TESTABLE', testKind: null, checkKind: null },
      'X-02/X-02.C1': { status: 'PASS', testKind: 'observation' },
    });
    const byTest = report(
      { 'X-01.A1/X-01.C1': { status: 'PASS' }, 'X-01/X-01.C3': { status: 'NOT_TESTABLE', testKind: null, checkKind: null } },
      { selection: { case: 'X-01.A1' } },
    );
    const narrowed = diffRun(byTest, base, RUNNER_CONFIG, SOURCE);
    expect(narrowed.tests.entries.map((entry) => entry.key).sort()).toEqual(['X-01.A1/X-01.C1', 'X-01/X-01.C3']);
    expect(narrowed.exitCode).toBe(0);

    const bySource = report({ 'X-01.A1/X-01.C1': { status: 'PASS' } }, { selection: { case: 'X-01' } });
    const wide = diffRun(bySource, base, RUNNER_CONFIG, SOURCE);
    expect(wide.tests.entries.map((entry) => [entry.key, entry.category])).toEqual([
      ['X-01.A2/X-01.C1', 'lost-coverage'],
      ['X-01/X-01.C3', 'retired'],
      ['X-01.A1/X-01.C1', 'unchanged'],
    ]);
  });
});

describe('parseBaselineJson', () => {
  it('parses a valid baseline and rejects bad JSON or schema', () => {
    const good = baseline({ [A]: { status: 'PASS' } });
    expect(parseBaselineJson(JSON.stringify(good), 'b.json')).toEqual({ ok: true, baseline: good });
    expect(parseBaselineJson('{ nope', 'b.json')).toMatchObject({ ok: false, reason: expect.stringMatching(/^baseline b.json is not valid JSON/) });
    const legacy = { ...good, results: { [A]: { status: 'PASS', passCount: 1, n: 1 } } };
    expect(parseBaselineJson(JSON.stringify(legacy), 'b.json')).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/^baseline b.json is invalid at results\.X-01\.A1\/X-01\.C1\.layer/),
    });
  });
});

describe('diff output', () => {
  function mixed(): SuiteDiff {
    const run = report({
      'X-01.A1/X-01.C1': { status: 'FAIL' },
      'X-01.A2/X-01.C1': { status: 'PASS' },
      'X-01.A3/X-01.C1': { status: 'PASS' },
      [J]: { status: 'ERROR', testKind: 'journey' },
    });
    const base = baseline(
      {
        'X-01.A1/X-01.C1': { status: 'PASS' },
        'X-01.A2/X-01.C1': { status: 'PASS' },
        [J]: { status: 'PASS', testKind: 'journey' },
      },
      { provisional: true },
    );
    return diffRun(run, base, RUNNER_CONFIG, SOURCE);
  }

  it('prints lost-coverage first, then the other categories, unchanged as counts only', () => {
    const lines = diffSummaryLines(mixed(), real.runId);
    expect(lines.every((line) => line.startsWith('[suite] '))).toBe(true);
    const entryLines = lines.filter((line) => /^\[suite\] diff (tests|journeys) [a-z-]+ /.test(line));
    expect(entryLines).toEqual([
      `[suite] diff journeys lost-coverage ${J} P rule: PASS 1/1 -> ERROR 0/1 (min 1) [gating]`,
      '[suite] diff tests regressed X-01.A1/X-01.C1 P rule: PASS 1/1 -> FAIL 0/1 (min 1) [gating]',
      '[suite] diff tests new X-01.A3/X-01.C1 P rule: none -> PASS 1/1 (min 1)',
    ]);
    expect(lines).toContain(
      '[suite] diff tests: lost-coverage 0, regressed 1, fixed 0, gained-coverage 0, new 1, retired 0, inconclusive 0, unchanged 1',
    );
    expect(lines).toContain('[suite] diff: baseline accepted from run base-run (base1234) (provisional)');
    expect(lines).toContain('[suite] diff outcome: failed (exit 1)');
    expect(lines.join('\n')).not.toContain('X-01.A2/X-01.C1 P');
  });

  it('renders the diff in report.md, journeys separate, and only when present', () => {
    const diff = mixed();
    expect(renderSuiteReportMarkdown(real)).not.toContain('## Diff');
    const markdown = renderSuiteReportMarkdown(SuiteRunReportSchema.parse({ ...real, diff }) as SuiteRunReport);
    expect(markdown).toContain('## Diff');
    expect(markdown).toContain('- Outcome: **failed** (exit 1)');
    const tests = markdown.indexOf('### Tests');
    const journeys = markdown.indexOf('### Journeys');
    expect(tests).toBeGreaterThan(0);
    expect(journeys).toBeGreaterThan(tests);
    expect(markdown.indexOf(`| lost-coverage | ${J}`)).toBeGreaterThan(journeys);
    expect(markdown.indexOf('| regressed | X-01.A1/X-01.C1')).toBeLessThan(markdown.indexOf('| new | X-01.A3/X-01.C1'));
  });
});

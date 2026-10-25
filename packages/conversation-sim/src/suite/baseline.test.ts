import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RUNNER_CONFIG, cleanRun, fakeExecutor, fakeSuite } from './__fixtures__/runner';
import { TEST_RULES } from './__fixtures__/suite';
import {
  baselineRefusals,
  buildBaseline,
  currentJudgeFingerprint,
  readRunReport,
  serializeBaseline,
  stableJson,
  writeBaseline,
  type BaselineRefusalOptions,
} from './baseline';
import { computeJudgeFingerprint } from './judge/fingerprint';
import { writeSuiteReport } from './report';
import { runSuite } from './runner';
import { BaselineSchema, type SuiteRunReport } from './schema';

const OPTIONS: BaselineRefusalOptions = {
  config: RUNNER_CONFIG,
  currentFingerprint: null,
  allowIncomplete: false,
  allowDirty: false,
};

const FINGERPRINT = {
  provider: 'openai',
  model: 'gpt-4o',
  decoding: { temperature: 0, reasoningEffort: null, maxOutputTokens: 1024 },
  promptSha256: 'a'.repeat(64),
  schemaSha256: 'b'.repeat(64),
  guidanceSha256: 'c'.repeat(64),
};

async function completeReport(): Promise<SuiteRunReport> {
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
  return report;
}

async function incompleteReport(): Promise<SuiteRunReport> {
  const executor = fakeExecutor((test, attempt) =>
    cleanRun(test, attempt, test.id === 'X-02' ? [{ kind: 'infrastructure', step: 0, reason: 'unsupported-fixture:pulseCycle', message: '' }] : []),
  );
  const { report } = await runSuite({
    suite: fakeSuite(),
    level: 'L0',
    n: 1,
    executor,
    config: RUNNER_CONFIG,
    runId: '2026-10-25T10-00-00-000Z-abc1234',
    git: { sha: 'abc1234def5678', dirty: false },
    rules: TEST_RULES,
  });
  return report;
}

describe('baselineRefusals', () => {
  it('accepts a complete, clean L0 run', async () => {
    const report = await completeReport();
    expect(report.complete).toBe(true);
    expect(baselineRefusals(report, OPTIONS)).toEqual([]);
  });

  it('lists every reason at once', async () => {
    const report = await completeReport();
    const bad: SuiteRunReport = {
      ...report,
      suiteId: 'unregistered',
      complete: false,
      provisional: true,
      provisionalReason: 'incomplete: 1 NOT_RUN',
      git: { sha: null, dirty: true },
      selection: { case: 'X-01' },
      judgeTrust: { ...report.judgeTrust, pin: FINGERPRINT },
      results: Object.fromEntries(Object.entries(report.results).map(([key, value]) => [key, { ...value, inScope: false }])),
    };
    const refusals = baselineRefusals(bad, { ...OPTIONS, config: { ...RUNNER_CONFIG, baseline: { minSamples: { L0: 2, L1: 5, L2: 3 } } } });
    expect(refusals).toEqual([
      'suite unregistered is not registered in suite.config.json',
      'n 1 is below baseline.minSamples.L0 2',
      'run is INCOMPLETE (incomplete: 1 NOT_RUN); pass --allow-incomplete to accept it as provisional',
      'run was made from a dirty working tree; pass --allow-dirty to accept it',
      'run has no git sha',
      'run was narrowed with --case X-01; accept only a full-suite run',
      'judge fingerprint of the run differs from the current one',
      'run has no in-scope test criteria',
    ]);
  });

  it('refuses a run whose only in-scope rows are manifest NOT TESTABLE entries', async () => {
    const report = await completeReport();
    const onlyManifest: SuiteRunReport = {
      ...report,
      complete: false,
      results: Object.fromEntries(
        Object.entries(report.results).map(([key, value]) => [key, value.testKind === null ? value : { ...value, inScope: false }]),
      ),
    };
    expect(Object.values(onlyManifest.results).some((result) => result.inScope)).toBe(true);
    expect(baselineRefusals(onlyManifest, { ...OPTIONS, allowIncomplete: true })).toEqual(['run has no in-scope test criteria']);
  });

  it('lets --allow-incomplete and --allow-dirty through', async () => {
    const report = { ...(await incompleteReport()), git: { sha: 'abc', dirty: true } };
    expect(report.complete).toBe(false);
    expect(baselineRefusals(report, { ...OPTIONS, allowIncomplete: true, allowDirty: true })).toEqual([]);
  });

  it('compares fingerprints by stable JSON', async () => {
    const report = { ...(await completeReport()) };
    const pinned = { ...report, judgeTrust: { ...report.judgeTrust, pin: { ...FINGERPRINT } } };
    const reordered = Object.fromEntries(Object.entries(FINGERPRINT).reverse()) as typeof FINGERPRINT;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(FINGERPRINT));
    expect(baselineRefusals(pinned, { ...OPTIONS, currentFingerprint: reordered })).toEqual([]);
    expect(baselineRefusals(pinned, { ...OPTIONS, currentFingerprint: { ...FINGERPRINT, model: 'gpt-5' } })).toContain(
      'judge fingerprint of the run differs from the current one',
    );
  });
});

describe('currentJudgeFingerprint', () => {
  it('is null at L0 and the configured pin over the suite at L1/L2', () => {
    const suite = fakeSuite();
    expect(currentJudgeFingerprint('L0', RUNNER_CONFIG, null)).toBeNull();
    expect(currentJudgeFingerprint('L0', RUNNER_CONFIG, suite)).toBeNull();
    expect(currentJudgeFingerprint('L1', RUNNER_CONFIG, suite)).toEqual(computeJudgeFingerprint(RUNNER_CONFIG.judge, suite));
    expect(currentJudgeFingerprint('L2', RUNNER_CONFIG, suite)).toEqual(computeJudgeFingerprint(RUNNER_CONFIG.judge, suite));
    expect(() => currentJudgeFingerprint('L1', RUNNER_CONFIG, null)).toThrow('[suite] judge fingerprint for L1 needs the suite');
  });
});

describe('baselineRefusals: unpinned judge model', () => {
  async function l1Report(calledModel: string | null): Promise<SuiteRunReport> {
    const report = await completeReport();
    return {
      ...report,
      level: 'L1',
      n: 5,
      models: { coach: null, judge: calledModel },
      judgeTrust: { trusted: false, reason: calledModel === 'gpt-4o' ? 'no-agreement' : 'unpinned-judge', pin: FINGERPRINT, agreement: null },
    };
  }

  it('refuses a non-L0 run whose called judge model differs from the pin', async () => {
    const options = { ...OPTIONS, currentFingerprint: FINGERPRINT };
    expect(baselineRefusals(await l1Report('gpt-4o'), options)).toEqual([]);
    expect(baselineRefusals(await l1Report('gpt-4o-mini'), options)).toEqual(['run called judge model gpt-4o-mini, not the pinned gpt-4o']);
    expect(baselineRefusals(await l1Report(null), options)).toEqual(['run called judge model none, not the pinned gpt-4o']);
  });

  it('refuses an L1 run whose pin differs from the current fingerprint', async () => {
    const report = await l1Report('gpt-4o');
    expect(baselineRefusals(report, { ...OPTIONS, currentFingerprint: { ...FINGERPRINT, guidanceSha256: 'd'.repeat(64) } })).toEqual([
      'judge fingerprint of the run differs from the current one',
    ]);
  });
});

describe('buildBaseline', () => {
  it('keeps in-scope results only, sorted, with provenance', async () => {
    const report = await completeReport();
    const baseline = buildBaseline(report, { acceptedAt: '2026-10-25T11:00:00.000Z', ciRunUrl: 'https://github.com/o/r/actions/runs/1' });
    expect(BaselineSchema.parse(baseline)).toEqual(baseline);
    expect(baseline).toMatchObject({
      schemaVersion: 1,
      suiteId: 'x-suite',
      level: 'L0',
      judge: { fingerprint: null, agreement: null },
      coach: { model: null },
      acceptedFrom: { runId: report.runId, gitSha: 'abc1234def5678', ciRunUrl: 'https://github.com/o/r/actions/runs/1' },
      provisional: false,
    });
    expect(baseline.results).toEqual({
      'X-01.A1/X-01.C1': { status: 'PASS', passCount: 1, n: 1, layer: 'P', testKind: 'atomic', checkKind: 'rule' },
      'X-01/X-01.C3': { status: 'NOT_TESTABLE', passCount: 0, n: 1, layer: 'C', testKind: null, checkKind: null },
      'X-02/X-02.C1': { status: 'PASS', passCount: 1, n: 1, layer: 'P', testKind: 'observation', checkKind: 'rule' },
    });
    expect(Object.keys(baseline.results)).toEqual([...Object.keys(baseline.results)].sort());
  });

  it('records provisional for an accepted INCOMPLETE run', async () => {
    const baseline = buildBaseline(await incompleteReport(), { acceptedAt: '2026-10-25T11:00:00.000Z' });
    expect(baseline.provisional).toBe(true);
    expect(baseline.acceptedFrom.ciRunUrl).toBeUndefined();
    expect(baseline.results['X-02/X-02.C1']).toEqual({
      status: 'NOT_RUN',
      passCount: 0,
      n: 1,
      layer: 'P',
      testKind: 'observation',
      checkKind: 'rule',
    });
  });

  it('is byte-identical apart from acceptedAt', async () => {
    const report = await completeReport();
    const first = serializeBaseline(buildBaseline(report, { acceptedAt: '2026-10-25T11:00:00.000Z' }));
    const second = serializeBaseline(buildBaseline(report, { acceptedAt: '2026-10-26T09:30:00.000Z' }));
    expect(first).not.toBe(second);
    expect(first.replace(/"acceptedAt": "[^"]+"/, '')).toBe(second.replace(/"acceptedAt": "[^"]+"/, ''));
  });
});

describe('baseline files', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'suite-baseline-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes baselines/<suite>/<level>.json and reads run reports back', async () => {
    const report = await completeReport();
    writeSuiteReport(report, dir);
    expect(readRunReport(dir, report.runId)).toEqual(report);
    const path = writeBaseline(buildBaseline(report, { acceptedAt: '2026-10-25T11:00:00.000Z' }), dir);
    expect(path).toBe(join(dir, 'baselines', 'x-suite', 'L0.json'));
    expect(BaselineSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).suiteId).toBe('x-suite');
  });

  it('refuses unsafe, missing, invalid or mismatched run reports', async () => {
    expect(() => readRunReport(dir, '../escape')).toThrow('[suite] unsafe run id ../escape');
    expect(() => readRunReport(dir, '..')).toThrow(/unsafe run id/);
    expect(() => readRunReport(dir, 'missing-run')).toThrow('[suite] run missing-run not found under runs/suites/');
    mkdirSync(join(dir, 'runs', 'suites', 'broken'), { recursive: true });
    writeFileSync(join(dir, 'runs', 'suites', 'broken', 'report.json'), '{"schemaVersion": 2}');
    expect(() => readRunReport(dir, 'broken')).toThrow(/report.json is invalid at schemaVersion/);
    const report = await completeReport();
    mkdirSync(join(dir, 'runs', 'suites', 'other'), { recursive: true });
    writeFileSync(join(dir, 'runs', 'suites', 'other', 'report.json'), JSON.stringify(report));
    expect(() => readRunReport(dir, 'other')).toThrow(/names run 2026-10-25/);
  });
});

describe('stableJson', () => {
  it('sorts object keys at every level', () => {
    expect(stableJson({ b: 1, a: { d: [{ y: 1, x: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[{"x":2,"y":1}]},"b":1}');
  });
});

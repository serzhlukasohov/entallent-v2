import { describe, expect, it } from 'vitest';
import { RUNNER_CONFIG, cleanRun, fakeExecutor, fakeSuite, liveSuite } from './__fixtures__/runner';
import { TEST_RULES } from './__fixtures__/suite';
import { L0DeterministicExecutor } from './executors/l0-deterministic-executor';
import { SuiteExecutionError } from './executors/types';
import { loadSuite, validateSuite } from './loader';
import { caseRunFailureKind, computeJudgeTrust, executionErrorKind, runSuite, type RunSuiteInput } from './runner';
import { SuiteRunReportSchema, type ExecutionError, type LoadedSuite } from './schema';

const RUN_ID = '2026-10-25T10-00-00-000Z-abc1234';
const GIT = { sha: 'abc1234def', dirty: false };

function input(suite: LoadedSuite, overrides: Partial<RunSuiteInput> = {}): RunSuiteInput & { lines: string[] } {
  const lines: string[] = [];
  return {
    suite,
    level: 'L0',
    n: 1,
    executor: fakeExecutor(),
    config: RUNNER_CONFIG,
    runId: RUN_ID,
    git: GIT,
    rules: TEST_RULES,
    log: (line) => lines.push(line),
    lines,
    ...overrides,
  };
}

function error(overrides: Partial<ExecutionError>): ExecutionError {
  return { kind: 'infrastructure', step: 0, reason: 'fixture-apply:clock', message: 'boom', ...overrides };
}

describe('computeJudgeTrust', () => {
  it('is untrusted with no judge at L0', () => {
    expect(computeJudgeTrust('L0')).toEqual({ trusted: false, reason: 'no-judge-at-level', pin: null, agreement: null });
  });

  it('refuses L1 and L2 until Epic 13', () => {
    expect(() => computeJudgeTrust('L1')).toThrow(/lands in Epic 13/);
    expect(() => computeJudgeTrust('L2')).toThrow(/lands in Epic 13/);
  });
});

describe('caseRunFailureKind', () => {
  it('classifies errors after reclassification', () => {
    expect(caseRunFailureKind({ errors: [] })).toBe('none');
    expect(caseRunFailureKind({ errors: [error({})] })).toBe('infrastructure');
    expect(caseRunFailureKind({ errors: [error({ reason: 'unsupported-fixture:pulseCycle' })] })).toBe('product');
    expect(caseRunFailureKind({ errors: [error({ kind: 'product', reason: 'agent-turn-error', message: 'Error: read ECONNRESET' })] })).toBe(
      'infrastructure',
    );
    expect(caseRunFailureKind({ errors: [error({ kind: 'product', reason: 'agent-turn-error', message: 'TypeError: x is undefined' })] })).toBe(
      'product',
    );
    expect(caseRunFailureKind({ errors: [error({}), error({ kind: 'product', reason: 'scripted-output-missing:1' })] })).toBe('product');
  });

  it('never treats a non-agent product error as transport', () => {
    expect(executionErrorKind(error({ kind: 'product', reason: 'scripted-output-missing:1', message: 'fetch failed' }))).toBe('product');
  });
});

describe('runSuite: happy path with the real L0 executor', () => {
  it('runs atomic, journey and observation tests n times and reports every in-scope criterion', async () => {
    const suite = liveSuite();
    const run = input(suite, { n: 2, executor: new L0DeterministicExecutor() });
    const { report, caseRuns } = await runSuite(run);

    expect(SuiteRunReportSchema.parse(JSON.parse(JSON.stringify(report)))).toEqual(report);
    expect(report.judgeTrust).toEqual({ trusted: false, reason: 'no-judge-at-level', pin: null, agreement: null });
    expect(report.n).toBe(2);
    expect(report.models).toEqual({ coach: null, judge: null });
    expect(report.selection).toBeUndefined();

    const expected = [
      'X-01.A1/X-01.C1',
      'X-01.A1/X-01.C2',
      'X-01.J/X-01.C1',
      'X-02/X-02.C1',
      'X-01/X-01.C3',
    ];
    const inScope = Object.entries(report.results)
      .filter(([, result]) => result.inScope)
      .map(([key]) => key);
    expect(inScope.sort()).toEqual([...expected].sort());
    for (const key of expected.slice(0, 4)) {
      expect(report.results[key]!.n).toBe(2);
      expect(report.results[key]!.samples).toHaveLength(2);
      expect(report.results[key]!.status, key).toBe('PASS');
    }
    expect(report.complete).toBe(true);
    expect(report.layers).not.toBeNull();
    expect(report.verdict).toBe('ADEQUATE');
    expect(report.usage).toEqual({
      coachModelCalls: 0,
      judgeCalls: 0,
      judgeInputTokens: 0,
      judgeOutputTokens: 0,
      caseAttempts: 6,
      infrastructureRetries: 0,
    });
    expect(report.judgeErrors).toEqual([]);
    expect(caseRuns).toHaveLength(6);
    expect(caseRuns.every((record) => record.run.attempt === 1)).toBe(true);

    // One status line per case per sample, no transcript text.
    const statusLines = run.lines.filter((line) => /sample \d\/2/.test(line));
    expect(statusLines).toHaveLength(6);
    expect(run.lines.every((line) => line.startsWith('[suite]'))).toBe(true);
    expect(run.lines.join('\n')).not.toMatch(/Two releases|deadline|riskier/);
  });

  it('emits level-not-declared results without executing tests that do not declare the level', async () => {
    const executor = fakeExecutor();
    const { report, caseRuns } = await runSuite(input(fakeSuite(), { executor }));
    expect(executor.calls).toEqual(['X-01.A1#1', 'X-02#1']);
    expect(caseRuns.map((record) => record.run.testId)).toEqual(['X-01.A1', 'X-02']);
    expect(report.results['X-01.J/X-01.C1']).toMatchObject({ inScope: false, status: 'NOT_RUN', reason: 'level-not-declared' });
    expect(report.results['X-01.A1/X-01.C2']).toMatchObject({ inScope: false, reason: 'level-not-declared' });
  });

  it('refuses an executor of another level', async () => {
    const executor = { ...fakeExecutor(), level: 'L1' as const };
    await expect(runSuite(input(fakeSuite(), { executor }))).rejects.toThrow(/executor is L1, run level is L0/);
  });
});

describe('runSuite: empty suites', () => {
  it.each(['smoke-v1', 'p-v1'])('runs the registered empty suite %s as INCOMPLETE and provisional', async (id) => {
    const run = input(loadSuite(id));
    const { report, caseRuns } = await runSuite(run);
    expect(caseRuns).toEqual([]);
    expect(report.results).toEqual({});
    expect(report.complete).toBe(false);
    expect(report.provisional).toBe(true);
    expect(report.verdict).toBe('NOT ADEQUATE');
    expect(report.provisionalReason).toContain('incomplete: no in-scope test criteria');
    expect(report.provisionalReason).toContain(`suite ${id} has no tests`);
    expect(run.lines).toContain(`[suite] ${id} has no tests`);
  });
});

describe('runSuite: retries', () => {
  it('discards an infrastructure-only run and keeps attempt 2', async () => {
    const executor = fakeExecutor((test, attempt) =>
      test.id === 'X-01.A1' && attempt === 1 ? cleanRun(test, attempt, [error({})]) : cleanRun(test, attempt),
    );
    const { report, caseRuns } = await runSuite(input(fakeSuite(), { executor }));
    expect(executor.calls).toEqual(['X-01.A1#1', 'X-01.A1#2', 'X-02#1']);
    expect(caseRuns.find((record) => record.run.testId === 'X-01.A1')!.run.attempt).toBe(2);
    expect(report.results['X-01.A1/X-01.C1']!.status).toBe('PASS');
    expect(report.usage).toMatchObject({ caseAttempts: 3, infrastructureRetries: 1 });
  });

  it('retries a transport agent-turn-error once, then evaluates the final run as ERROR', async () => {
    const transport = error({ kind: 'product', step: 1, reason: 'agent-turn-error', message: 'Error: read ECONNRESET' });
    const executor = fakeExecutor((test, attempt) => cleanRun(test, attempt, test.id === 'X-01.A1' ? [transport] : []));
    const { report, caseRuns } = await runSuite(input(fakeSuite(), { executor }));
    expect(executor.calls).toEqual(['X-01.A1#1', 'X-01.A1#2', 'X-02#1']);
    expect(caseRuns.find((record) => record.run.testId === 'X-01.A1')!.run.attempt).toBe(2);
    expect(report.results['X-01.A1/X-01.C1']).toMatchObject({ status: 'ERROR', reason: 'agent-turn-error' });
    expect(report.usage).toMatchObject({ infrastructureRetries: 1 });
  });

  it('never retries a product error', async () => {
    const product = error({ kind: 'product', step: 1, reason: 'scripted-output-missing:1', message: 'no scripted output' });
    const executor = fakeExecutor((test, attempt) => cleanRun(test, attempt, test.id === 'X-01.A1' ? [product] : []));
    const { report } = await runSuite(input(fakeSuite(), { executor }));
    expect(executor.calls).toEqual(['X-01.A1#1', 'X-02#1']);
    expect(report.results['X-01.A1/X-01.C1']).toMatchObject({ status: 'ERROR', reason: 'scripted-output-missing:1' });
    expect(report.usage).toMatchObject({ infrastructureRetries: 0 });
  });

  it('never retries an unsupported fixture and reports NOT_RUN', async () => {
    const unsupported = error({ reason: 'unsupported-fixture:pulseCycle', message: 'not supported at L0' });
    const executor = fakeExecutor((test, attempt) => cleanRun(test, attempt, test.id === 'X-01.A1' ? [unsupported] : []));
    const { report } = await runSuite(input(fakeSuite(), { executor }));
    expect(executor.calls).toEqual(['X-01.A1#1', 'X-02#1']);
    expect(report.results['X-01.A1/X-01.C1']).toMatchObject({ status: 'NOT_RUN', reason: 'unsupported-fixture:pulseCycle' });
    expect(report.complete).toBe(false);
  });

  it('synthesizes an executor-error run when run() rejects, retrying only transport failures', async () => {
    const product = fakeExecutor((test, attempt) => {
      if (test.id === 'X-01.A1') throw new Error('boom');
      return cleanRun(test, attempt);
    });
    const productResult = await runSuite(input(fakeSuite(), { executor: product }));
    expect(product.calls).toEqual(['X-01.A1#1', 'X-02#1']);
    const productRun = productResult.caseRuns.find((record) => record.run.testId === 'X-01.A1')!.run;
    expect(productRun.errors).toEqual([{ kind: 'product', step: 0, reason: 'executor-error', message: 'Error: boom' }]);
    expect(productResult.report.results['X-01.A1/X-01.C1']).toMatchObject({ status: 'ERROR', reason: 'executor-error' });

    const transport = fakeExecutor((test, attempt) => {
      if (test.id === 'X-01.A1' && attempt === 1) throw new TypeError('fetch failed');
      return cleanRun(test, attempt);
    });
    const transportResult = await runSuite(input(fakeSuite(), { executor: transport }));
    expect(transport.calls).toEqual(['X-01.A1#1', 'X-01.A1#2', 'X-02#1']);
    expect(transportResult.report.results['X-01.A1/X-01.C1']!.status).toBe('PASS');
  });

  it('keeps the kind and reason of a SuiteExecutionError thrown by run()', async () => {
    const executor = fakeExecutor((test, attempt) => {
      if (test.id === 'X-01.A1') throw new SuiteExecutionError({ kind: 'product', step: 1, reason: 'scripted-output-missing:1' });
      return cleanRun(test, attempt);
    });
    const { caseRuns } = await runSuite(input(fakeSuite(), { executor }));
    expect(executor.calls).toEqual(['X-01.A1#1', 'X-02#1']);
    expect(caseRuns[0]!.run.errors[0]).toMatchObject({ kind: 'product', step: 1, reason: 'scripted-output-missing:1' });
  });

  it('honors retries.infrastructure 0', async () => {
    const executor = fakeExecutor((test, attempt) => cleanRun(test, attempt, [error({})]));
    await runSuite(input(fakeSuite(), { executor, config: { ...RUNNER_CONFIG, retries: { infrastructure: 0 } } }));
    expect(executor.calls).toEqual(['X-01.A1#1', 'X-02#1']);
  });

  it('rejects an invalid CaseRun from the executor', async () => {
    const executor = fakeExecutor((test, attempt) => ({ ...cleanRun(test, attempt), attempt: 0 }));
    await expect(runSuite(input(fakeSuite(), { executor }))).rejects.toThrow(/invalid CaseRun at attempt/);
    const wrong = fakeExecutor((test, attempt) => ({ ...cleanRun(test, attempt), testId: 'X-09.A1' }));
    await expect(runSuite(input(fakeSuite(), { executor: wrong }))).rejects.toThrow(/returned a run for X-09.A1/);
  });
});

describe('runSuite: --case', () => {
  it('runs only tests whose id or source case matches and records the selection', async () => {
    const executor = fakeExecutor();
    const { report } = await runSuite(input(fakeSuite(), { executor, caseFilter: 'X-02' }));
    expect(executor.calls).toEqual(['X-02#1']);
    expect(Object.keys(report.results)).toEqual(['X-02/X-02.C1']);
    expect(report.selection).toEqual({ case: 'X-02' });

    const byTestId = fakeExecutor();
    const narrowed = await runSuite(input(fakeSuite(), { executor: byTestId, caseFilter: 'X-01.A1' }));
    expect(byTestId.calls).toEqual(['X-01.A1#1']);
    expect(Object.keys(narrowed.report.results).sort()).toEqual(['X-01.A1/X-01.C1', 'X-01.A1/X-01.C2', 'X-01/X-01.C3']);
  });

  it('refuses an unknown case and lists the known ids', async () => {
    await expect(runSuite(input(fakeSuite(), { caseFilter: 'X-99' }))).rejects.toThrow(
      /unknown case X-99; known: X-01, X-01\.A1, X-01\.J, X-02/,
    );
    await expect(runSuite(input(validateSuite('empty', { sources: [], tests: [] }), { caseFilter: 'X-01' }))).rejects.toThrow(
      /the suite has no tests/,
    );
  });
});

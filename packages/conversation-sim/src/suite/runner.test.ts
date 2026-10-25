import { run as scenarioRun } from '@langwatch/scenario';
import { describe, expect, it } from 'vitest';
import { withoutLangwatchEnv } from './executors/__fixtures__/offline-scenario-env';
import { ScriptedAiProvider } from '../fakes/scripted-ai';
import {
  RUNNER_CONFIG,
  agreementFor,
  cleanRun,
  fakeExecutor,
  fakeReplyExecutor,
  fakeSuite,
  judgedSuite,
  liveSuite,
} from './__fixtures__/runner';
import { TEST_RULES } from './__fixtures__/suite';
import { L0DeterministicExecutor } from './executors/l0-deterministic-executor';
import { L1OrchestratorExecutor } from './executors/l1-orchestrator-executor';
import { SuiteExecutionError } from './executors/types';
import { loadSuite, validateSuite } from './loader';
import { caseRunFailureKind, computeJudgeTrust, executionErrorKind, runSuite, type RunSuiteInput } from './runner';
import { fakeJudge } from './judge/__fixtures__/calibration';
import { labelsSha256 } from './judge/calibrate';
import { computeJudgeFingerprint } from './judge/fingerprint';
import { SuiteRunReportSchema, type AgreementFile, type ExecutionError, type LoadedSuite } from './schema';

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

  it('needs the trust inputs at L1 and L2', () => {
    expect(() => computeJudgeTrust('L1')).toThrow(/^\[suite\] judge trust for L1 needs/);
    expect(() => computeJudgeTrust('L2')).toThrow(/^\[suite\] judge trust for L2 needs/);
  });

  it('delegates L1/L2 to the trust decision, keeping the configured pin', () => {
    const suite = judgedSuite();
    const trust = computeJudgeTrust('L1', { judge: RUNNER_CONFIG.judge, suite, agreement: null, labelsSha256: labelsSha256([]), unpinned: false });
    expect(trust).toEqual({ trusted: false, reason: 'no-agreement', pin: computeJudgeFingerprint(RUNNER_CONFIG.judge, suite), agreement: null });
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

describe('runSuite: L1 with a fake executor and a fake judge', () => {
  const REPLY = 'Which release deadline comes first?';

  function l1(options: {
    /** The reply for the k-th executor call (1-based); defaults to REPLY. */
    reply?: (call: number) => string | null;
    decide?: Parameters<typeof fakeJudge>[0];
    agreement?: AgreementFile | null;
    model?: string;
    unpinned?: boolean;
    n?: number;
  } = {}) {
    const suite = judgedSuite();
    const fake = fakeJudge(options.decide ?? (() => 'PASS'));
    let agreementReads = 0;
    const agreement = options.agreement ?? null;
    const judging = {
      judge: fake.judge,
      model: options.model ?? 'gpt-4o',
      unpinned: options.unpinned ?? false,
      labelsSha256: labelsSha256([]),
      get agreement() {
        agreementReads += 1;
        return agreement;
      },
    };
    let calls = 0;
    const executor = fakeReplyExecutor(() => {
      calls += 1;
      return options.reply ? options.reply(calls) : REPLY;
    });
    const run = input(suite, { level: 'L1', n: options.n ?? 1, executor, judging });
    return { suite, fake, run, reads: () => agreementReads };
  }

  it('without an agreement: untrusted no-agreement, advisory meaning results outside the layers and verdict', async () => {
    const { suite, fake, run, reads } = l1({ n: 2 });
    const { report } = await runSuite(run);

    expect(SuiteRunReportSchema.parse(JSON.parse(JSON.stringify(report)))).toEqual(report);
    expect(reads()).toBe(1);
    expect(report.judgeTrust).toEqual({
      trusted: false,
      reason: 'no-agreement',
      pin: computeJudgeFingerprint(RUNNER_CONFIG.judge, suite),
      agreement: null,
    });
    expect(report.models).toEqual({ coach: null, judge: 'gpt-4o' });
    // C1, C2 and C4 are meaning-decided (C4's rule passed): 3 judge calls per sample.
    expect(fake.inputs).toHaveLength(6);
    for (const key of ['Z-01.A1/Z-01.C1', 'Z-01.A1/Z-01.C2', 'Z-01.A1/Z-01.C4']) {
      expect(report.results[key], key).toMatchObject({ status: 'PASS', advisory: true, checkKind: 'meaning', passCount: 2, n: 2 });
    }
    expect(report.results['Z-01.A1/Z-01.C3']).toMatchObject({ status: 'PASS', advisory: false, checkKind: 'rule' });
    const layer = (name: string) => report.layers!.rows.find((row) => row.layer === name)!;
    expect(layer('P')).toMatchObject({ pass: 0, fail: 0 });
    expect(layer('D')).toMatchObject({ pass: 0, fail: 0 });
    expect(layer('C')).toMatchObject({ pass: 0, fail: 0 });
    expect(layer('S')).toMatchObject({ pass: 1, fail: 0 });
    expect(report.layers!.combinedPdc).toMatchObject({ pass: 0, fail: 0 });
    expect(report.qaReview).toEqual([]);
    expect(report.usage).toMatchObject({ judgeCalls: 6 });
  });

  it('with a calibrated agreement: trusted and the meaning statuses count toward pass rate and verdict', async () => {
    const agreement = agreementFor(judgedSuite());
    const { run } = l1({ agreement, decide: (judgeInput) => (judgeInput.layer === 'P' ? 'FAIL' : 'PASS') });
    const { report } = await runSuite(run);
    expect(report.judgeTrust).toMatchObject({ trusted: true, reason: 'calibrated', agreement });
    expect(report.results['Z-01.A1/Z-01.C1']).toMatchObject({ status: 'FAIL', advisory: false });
    const layer = (name: string) => report.layers!.rows.find((row) => row.layer === name)!;
    expect(layer('P')).toMatchObject({ pass: 0, fail: 1 });
    expect(layer('D')).toMatchObject({ pass: 1, fail: 0 });
    expect(report.layers!.combinedPdc).toMatchObject({ pass: 2, fail: 1 });
    expect(report.verdict).toBe('NOT ADEQUATE');
    expect(report.qaReview).toEqual([
      expect.objectContaining({ key: 'Z-01.A1/Z-01.C1', advisory: false, replies: [REPLY], reason: 'judged FAIL' }),
    ]);
  });

  it('records the model called on an unpinned run and keeps the pin', async () => {
    const { suite, run } = l1({ model: 'gpt-4o-mini', unpinned: true, agreement: agreementFor(judgedSuite()) });
    const { report } = await runSuite(run);
    expect(report.models.judge).toBe('gpt-4o-mini');
    expect(report.judgeTrust).toMatchObject({ trusted: false, reason: 'unpinned-judge', pin: computeJudgeFingerprint(RUNNER_CONFIG.judge, suite) });
    expect(report.judgeTrust.pin!.model).toBe('gpt-4o');
  });

  it('lists every meaning FAIL for QA review (judge FAIL and no-reply), never rule FAILs', async () => {
    // Sample 1 asks two questions: C4's rule FAILs (meaningSkipped) and the judge FAILs C1.
    // Sample 2 is silent: C3's rule FAILs, C1 and C2 are no-reply meaning FAILs.
    const twoQuestions = 'How is it going? And | the team?';
    const { run } = l1({
      n: 2,
      reply: (call) => (call === 1 ? twoQuestions : null),
      decide: (judgeInput) => (judgeInput.layer === 'P' ? 'FAIL' : 'PASS'),
    });
    const { report } = await runSuite(run);

    expect(report.results['Z-01.A1/Z-01.C4']!.samples[0]).toMatchObject({ status: 'FAIL', meaningSkipped: true });
    expect(report.results['Z-01.A1/Z-01.C3']!.samples[1]).toMatchObject({ status: 'FAIL' });
    expect(report.qaReview).toEqual([
      {
        key: 'Z-01.A1/Z-01.C1',
        testId: 'Z-01.A1',
        sourceCase: 'Z-01',
        criterionId: 'Z-01.C1',
        layer: 'P',
        sample: 1,
        advisory: true,
        replies: [twoQuestions],
        reason: 'judged FAIL',
      },
      {
        key: 'Z-01.A1/Z-01.C1',
        testId: 'Z-01.A1',
        sourceCase: 'Z-01',
        criterionId: 'Z-01.C1',
        layer: 'P',
        sample: 2,
        advisory: true,
        replies: [],
        reason: 'no-reply',
      },
      {
        key: 'Z-01.A1/Z-01.C2',
        testId: 'Z-01.A1',
        sourceCase: 'Z-01',
        criterionId: 'Z-01.C2',
        layer: 'D',
        sample: 2,
        advisory: true,
        replies: [],
        reason: 'no-reply',
      },
    ]);
  });

  it('requires judging at L1/L2 and rejects it at L0', async () => {
    const suite = judgedSuite();
    await expect(runSuite(input(suite, { level: 'L1', executor: fakeReplyExecutor(() => 'Hi?') }))).rejects.toThrow(
      '[suite] L1 run needs judging (a judge and its trust inputs)',
    );
    const judging = { judge: fakeJudge(() => 'PASS').judge, model: 'gpt-4o', unpinned: false, agreement: null, labelsSha256: labelsSha256([]) };
    await expect(runSuite(input(fakeSuite(), { judging }))).rejects.toThrow('[suite] L0 runs have no judge; judging must not be given');
  });
});

describe('runSuite: L1 with the real L1 executor and a fake judge (Story 13.4)', () => {
  withoutLangwatchEnv();
  const REPLY = 'Which release deadline comes first?';
  const COACH = 'openai:gpt-4o-test';

  it('records models.coach, passes the suite id, and judges the reply the orchestrator attributed by traceId', async () => {
    const suite = judgedSuite();
    const fake = fakeJudge(() => 'PASS');
    const setIds: string[] = [];
    const executor = new L1OrchestratorExecutor({
      createAiProvider: () => new ScriptedAiProvider({ responses: [{ text: REPLY, confidence: 0.9, containsSurveyProbe: false }] }),
      coachModel: COACH,
      runScenario: (async (cfg: Parameters<typeof scenarioRun>[0]) => {
        setIds.push(cfg.setId ?? '');
        return scenarioRun(cfg);
      }) as typeof scenarioRun,
    });
    const judging = { judge: fake.judge, model: 'gpt-4o', unpinned: false, agreement: null, labelsSha256: labelsSha256([]) };
    const { report, caseRuns } = await runSuite(input(suite, { level: 'L1', executor, judging }));

    expect(SuiteRunReportSchema.parse(JSON.parse(JSON.stringify(report)))).toEqual(report);
    expect(report.level).toBe('L1');
    expect(report.models).toEqual({ coach: COACH, judge: 'gpt-4o' });
    expect(setIds).toEqual(['entalent-suite-x-judged']);
    expect(caseRuns).toHaveLength(1);
    const [record] = caseRuns;
    expect(record!.run.steps[0]?.reply?.text).toBe(REPLY);
    // Every meaning check was judged on that reply.
    expect(fake.inputs).toHaveLength(3);
    for (const judged of fake.inputs) {
      expect(judged.transcript.turns[judged.transcript.evaluatedReplyIndex!]).toEqual({ role: 'coach', text: REPLY });
    }
    expect(report.results['Z-01.A1/Z-01.C1']).toMatchObject({ status: 'PASS', checkKind: 'meaning', method: 'n/a' });
    expect(report.results['Z-01.A1/Z-01.C3']).toMatchObject({ status: 'PASS', checkKind: 'rule' });
    expect(record!.run.events.filter((event) => event.port === 'aiProvider').every((event) => event.model?.name === COACH)).toBe(true);
  });

  it('keeps models.coach null for an executor without a coach model (L0)', async () => {
    const { report } = await runSuite(input(liveSuite(), { executor: new L0DeterministicExecutor() }));
    expect(report.models.coach).toBeNull();
  });
});

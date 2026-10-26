import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVAL_RULES, UNTRUSTED, runFor } from './__fixtures__/evaluation';
import { TEST_RULES, validModules } from './__fixtures__/suite';
import { evaluate } from './evaluate';
import { validateSuite } from './loader';
import { RUNNER_CONFIG } from './__fixtures__/runner';
import { diffRun } from './diff';
import { createCriterionJudge } from './judge/criterion-judge';
import { mockJudgeModel } from './judge/__fixtures__/mock-model';
import { judgedSuite, replyRun } from './__fixtures__/runner';
import { computeJudgeFingerprint } from './judge/fingerprint';
import {
  budgetLine,
  buildSuiteReport,
  collectJudgeErrors,
  collectQaReview,
  fingerprintLine,
  judgeUsageTotals,
  renderCiSummary,
  renderSuiteReportMarkdown,
  writeSuiteReport,
  type SuiteReportMeta,
} from './report';
import { score } from './score';
import { SuiteRunReportSchema, type CriterionResult, type SuiteRunReport } from './schema';

const suite = validateSuite('x-suite', validModules(), { ...TEST_RULES, ...EVAL_RULES });

const meta: SuiteReportMeta = {
  runId: '2026-10-25T10-00-00-000Z-abc1234',
  suiteId: 'x-suite',
  level: 'L0',
  n: 1,
  git: { sha: 'abc1234', dirty: false },
  models: { coach: null, judge: null },
  judgeTrust: UNTRUSTED,
  judgeErrors: [],
  qaReview: [],
  usage: { coachCalls: 0, judgeCalls: 0 },
};

function l0Report(): SuiteRunReport {
  const results: CriterionResult[] = suite.tests.flatMap((test) => {
    const replies = test.steps.map(() => 'Which deadline is first?');
    const run = runFor(test, replies, {
      observed: test.kind === 'observation' ? ['window.outbound'] : ['reply.text', 'reply.messages', 'events'],
      events:
        test.kind === 'observation'
          ? []
          : [
              {
                stepIndex: 1,
                seq: 0,
                port: 'questionConfirmationRepo',
                method: 'stageBundle',
                argsSummary: '',
                outcome: 'ok',
                resultSummary: '',
                durationMs: 1,
              },
            ],
    });
    return evaluate(test, run, null, UNTRUSTED, { ...TEST_RULES, ...EVAL_RULES });
  });
  return buildSuiteReport(score({ suite, level: 'L0', n: 1, results }), meta);
}

describe('buildSuiteReport', () => {
  it('produces a SuiteRunReport v1 that parses with the schema and round-trips through JSON', () => {
    const report = l0Report();
    expect(SuiteRunReportSchema.parse(JSON.parse(JSON.stringify(report)))).toEqual(report);
    expect(report.schemaVersion).toBe(1);
    expect(report.judgeTrust).toEqual(UNTRUSTED);
    expect(Object.keys(report.results)).toEqual([
      'X-01.A1/X-01.C1',
      'X-01.A1/X-01.C2',
      'X-01.J/X-01.C1',
      'X-01.J/X-01.C2',
      'X-02/X-02.C1',
      'X-01/X-01.C3',
    ]);
  });

  it('builds the coverage table, NOT TESTABLE reasons, judge-only criteria and unobservable fields', () => {
    const report = l0Report();
    expect(report.coverage.rows.map((row) => [row.requirement.join(','), row.sourceCase, row.testId, row.criterionId, row.status])).toEqual([
      ['REQ-1', 'X-01', 'X-01.A1', 'X-01.C1', 'PASS'],
      ['REQ-1', 'X-01', 'X-01.J', 'X-01.C1', 'NOT_RUN'],
      ['REQ-1', 'X-01', 'X-01.A1', 'X-01.C2', 'NOT_RUN'],
      ['REQ-1', 'X-01', 'X-01.J', 'X-01.C2', 'NOT_RUN'],
      ['REQ-1', 'X-01', null, 'X-01.C3', 'NOT_TESTABLE'],
      ['REQ-2', 'X-02', 'X-02', 'X-02.C1', 'NOT_RUN'],
    ]);
    expect(report.coverage.notTestable).toEqual([{ key: 'X-01/X-01.C3', reason: 'subjective opening' }]);
    expect(report.coverage.judgeOnly).toEqual(['X-01.J/X-01.C1']);
    expect(report.coverage.unobservable).toEqual([{ key: 'X-02/X-02.C1', field: 'events' }]);
    // The unobservable observation criterion is in scope and undecided.
    expect(report.complete).toBe(false);
    expect(report.provisional).toBe(true);
  });

  it('refuses meta that does not match the score', () => {
    const scored = score({ suite, level: 'L0', n: 1, results: [] });
    expect(() => buildSuiteReport(scored, { ...meta, level: 'L1' })).toThrow(/does not match/);
  });
});

describe('renderSuiteReportMarkdown', () => {
  it('renders the verdict, judge trust, layer table, journeys and coverage', () => {
    const markdown = renderSuiteReportMarkdown(l0Report());
    expect(markdown).toContain('# Suite x-suite L0 — 2026-10-25T10-00-00-000Z-abc1234');
    expect(markdown).toContain('(provisional)');
    expect(markdown).toContain('Meaning checks: advisory (uncalibrated)');
    expect(markdown).toContain('| P+D+C |');
    expect(markdown).toContain('## Journeys');
    expect(markdown).toContain('| REQ-2 | X-02 | X-02 | X-02.C1 | P | NOT_RUN |');
    expect(markdown).toContain('- X-01/X-01.C3: subjective opening');
    expect(markdown).toContain('- X-02/X-02.C1: events');
  });

  it('shows FAIL evidence in the result table and keeps multi-line list items on one line', () => {
    const report = l0Report();
    const key = 'X-01.A1/X-01.C1';
    const failed: SuiteRunReport = {
      ...report,
      results: { ...report.results, [key]: { ...report.results[key]!, status: 'FAIL', evidence: 'turn 1 — a\nturn 1 — b' } },
      judgeErrors: [{ key, reason: 'judge-invalid-output\nsecond line' }],
    };
    const markdown = renderSuiteReportMarkdown(failed);
    expect(markdown).toContain('| turn 1 — a turn 1 — b |');
    expect(markdown).toContain('- X-01.A1/X-01.C1: judge-invalid-output second line\n');
  });

  it('renders n/a for a journeys-only run', () => {
    const journey: CriterionResult = {
      testId: 'X-01.J',
      criterionId: 'X-01.C2',
      sourceCase: 'X-01',
      level: 'L0',
      layer: 'S',
      testKind: 'journey',
      inScope: true,
      status: 'PASS',
      advisory: false,
      method: 'n/a',
    };
    const scored = score({ suite, level: 'L0', n: 1, results: [journey] });
    const markdown = renderSuiteReportMarkdown(buildSuiteReport(scored, meta));
    expect(markdown).toContain('**n/a (journeys only)**');
    expect(markdown).toContain('n/a (journeys only)\n');
  });

  it('reports an empty run as INCOMPLETE and provisional, not journeys-only', () => {
    const empty = validateSuite('empty', { sources: [], tests: [] });
    const report = buildSuiteReport(score({ suite: empty, level: 'L0', n: 1, results: [] }), { ...meta, suiteId: 'empty' });
    expect(report.complete).toBe(false);
    expect(report.provisional).toBe(true);
    expect(report.verdict).toBe('NOT ADEQUATE');
    expect(report.provisionalReason).toBe('incomplete: no in-scope test criteria; no decided P/D/C criterion');
    expect(report.layers).not.toBeNull();
    const markdown = renderSuiteReportMarkdown(report);
    expect(markdown).toContain('**NOT ADEQUATE** (provisional)');
    expect(markdown).not.toContain('journeys only');
  });

  it('renders the --case selection', () => {
    const report = buildSuiteReport(score({ suite, level: 'L0', n: 1, results: [] }), { ...meta, selection: { case: 'X-01' } });
    expect(report.selection).toEqual({ case: 'X-01' });
    expect(renderSuiteReportMarkdown(report)).toContain('- Selection: case X-01');
  });
});

describe('renderCiSummary', () => {
  it('renders layers, verdict and diff but no reason, evidence or transcript text', () => {
    const report = l0Report();
    const key = 'X-01.A1/X-01.C1';
    const withEvidence: SuiteRunReport = {
      ...report,
      results: {
        ...report.results,
        [key]: { ...report.results[key]!, status: 'FAIL', reason: 'REASON-FROM-REPLY', evidence: 'turn 1 — Which deadline is first?' },
      },
    };
    const diff = diffRun(withEvidence, null, RUNNER_CONFIG, { kind: 'merge-base', ref: 'abc', path: 'packages/conversation-sim/baselines/x-suite/L0.json', missing: true });
    const summary = renderCiSummary({ ...withEvidence, diff });
    expect(summary).toContain('### x-suite L0 — 2026-10-25T10-00-00-000Z-abc1234');
    expect(summary).toContain('- Verdict: **');
    expect(summary).toContain('| P+D+C |');
    expect(summary).toContain('- Diff: **no-baseline** (exit 0)');
    expect(summary).toContain('| new | X-01.A1/X-01.C1 | P |');
    expect(summary).not.toContain('REASON-FROM-REPLY');
    expect(summary).not.toContain('Which deadline is first?');
    expect(summary).not.toContain('subjective opening');
    expect(renderSuiteReportMarkdown({ ...withEvidence, diff })).toContain('Which deadline is first?');
  });

  it('says when no diff ran', () => {
    expect(renderCiSummary(l0Report())).toContain('- Diff: not run');
  });

  it('at L2 adds journey result counts and a key/status table after the layers line, without reasons or text', () => {
    const base = l0Report();
    const key1 = 'X-10.J/X-10.C1';
    const key2 = 'X-10.J/X-10.C2';
    const template = Object.values(base.results)[0]!;
    const l2: SuiteRunReport = {
      ...base,
      level: 'L2',
      layers: null,
      verdict: 'n/a (journeys only)',
      results: {
        ...base.results,
        [key1]: { ...template, testId: 'X-10.J', criterionId: 'X-10.C1', status: 'PASS' },
        [key2]: { ...template, testId: 'X-10.J', criterionId: 'X-10.C2', status: 'FAIL', reason: 'REASON-FROM-REPLY', evidence: 'turn 2 — SECRET-REPLY-TEXT' },
      },
      journeys: { keys: [key1, key2], counts: { PASS: 1, FAIL: 1 } },
    };
    const summary = renderCiSummary(l2);
    expect(summary).toContain(
      ['Layers: n/a (journeys only)', '', '**Journey results:** PASS 1 · FAIL 1', '', '| Key | Status |', '| --- | --- |', `| ${key1} | PASS |`, `| ${key2} | FAIL |`].join('\n'),
    );
    expect(summary).not.toContain('REASON-FROM-REPLY');
    expect(summary).not.toContain('SECRET-REPLY-TEXT');
    expect(renderCiSummary({ ...l2, journeys: { keys: [], counts: {} } })).toContain('**Journey results:** none');
    expect(renderCiSummary({ ...l2, journeys: { keys: [], counts: {} } })).not.toContain('| Key | Status |');

    // L0 and L1 summaries never carry the journey section, whatever the journeys hold.
    expect(renderCiSummary({ ...base, journeys: l2.journeys })).toBe(renderCiSummary(base));
    expect(renderCiSummary(base)).not.toContain('Journey results');
    expect(renderCiSummary({ ...l2, level: 'L1' })).not.toContain('Journey results');
  });
});

describe('writeSuiteReport', () => {
  it('writes report.json and report.md under runs/suites/<runId>/', () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'suite-report-'));
    try {
      const report = l0Report();
      const paths = writeSuiteReport(report, baseDir);
      expect(paths.json).toBe(join(baseDir, 'runs', 'suites', meta.runId, 'report.json'));
      expect(paths.markdown).toBe(join(baseDir, 'runs', 'suites', meta.runId, 'report.md'));
      expect(SuiteRunReportSchema.parse(JSON.parse(readFileSync(paths.json, 'utf8')))).toEqual(report);
      expect(readFileSync(paths.markdown, 'utf8')).toBe(renderSuiteReportMarkdown(report));
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('refuses a run id that would escape the runs directory', () => {
    expect(() => writeSuiteReport({ ...l0Report(), runId: '../escape' }, tmpdir())).toThrow(/unsafe run id/);
    expect(() => writeSuiteReport({ ...l0Report(), runId: '..' }, tmpdir())).toThrow(/unsafe run id/);
    expect(() => writeSuiteReport({ ...l0Report(), runId: '.' }, tmpdir())).toThrow(/unsafe run id/);
  });
});

describe('judge errors in the report (Story 13.1)', () => {
  it('lists judge ERRORs separately, keeps other criteria decided and makes the run INCOMPLETE', async () => {
    const rules = { ...TEST_RULES, ...EVAL_RULES };
    const judge = createCriterionJudge({
      model: mockJudgeModel(['not json']),
      decoding: { temperature: 0, reasoningEffort: null, maxOutputTokens: 64 },
    });
    const results: CriterionResult[] = [];
    for (const test of suite.tests) {
      expect(test.expectedBehavior).toBeDefined();
      const run = runFor(test, test.steps.map(() => 'Which deadline is first?'), {
        level: 'L1',
        observed: ['reply.text', 'reply.messages', 'events'],
      });
      results.push(...(await evaluate(test, run, judge, UNTRUSTED, rules)));
    }
    const judgeErrors = collectJudgeErrors(results);
    expect(judgeErrors).toEqual([
      { key: 'X-01.J/X-01.C1', reason: 'judge-invalid-output', message: expect.stringMatching(/NoObjectGeneratedError/) },
    ]);
    const report = buildSuiteReport(score({ suite, level: 'L1', n: 1, results }), {
      ...meta,
      level: 'L1',
      judgeErrors,
      usage: { ...judgeUsageTotals(results) },
    });
    expect(report.results['X-01.J/X-01.C1']).toMatchObject({ status: 'ERROR', reason: 'judge-invalid-output', checkKind: 'meaning' });
    expect(['PASS', 'FAIL']).toContain(report.results['X-01.J/X-01.C2']!.status);
    expect(['PASS', 'FAIL']).toContain(report.results['X-01.A1/X-01.C1']!.status);
    expect(report.complete).toBe(false);
    expect(report.provisional).toBe(true);
    expect(report.usage).toEqual({ judgeCalls: 1, judgeInputTokens: 100, judgeOutputTokens: 20 });
    const markdown = renderSuiteReportMarkdown(report);
    expect(markdown).toContain('## Judge errors\n\n- X-01.J/X-01.C1: judge-invalid-output');
  });

  it('ignores out-of-scope results and other reasons, and sums zero usage at L0', () => {
    const results: CriterionResult[] = [
      { ...baseResult, reason: 'judge-transport', evidence: 'Error: x' },
      { ...baseResult, criterionId: 'X-01.C2', reason: 'orchestrator-exception' },
      { ...baseResult, criterionId: 'X-01.C3', inScope: false, reason: 'judge-transport' },
    ];
    expect(collectJudgeErrors(results)).toEqual([{ key: 'X-01.A1/X-01.C1', reason: 'judge-transport', message: 'Error: x' }]);
    expect(judgeUsageTotals(results)).toEqual({ judgeCalls: 0, judgeInputTokens: 0, judgeOutputTokens: 0 });
  });
});

const baseResult: CriterionResult = {
  testId: 'X-01.A1',
  criterionId: 'X-01.C1',
  sourceCase: 'X-01',
  level: 'L1',
  layer: 'P',
  testKind: 'atomic',
  inScope: true,
  status: 'ERROR',
  advisory: true,
  method: 'n/a',
};

describe('effective judge fingerprint (Story 13.3)', () => {
  it('prints none at L0 and the full pin at L1 after the meaning-checks line', () => {
    const report = l0Report();
    const markdown = renderSuiteReportMarkdown(report);
    expect(markdown).toContain('- Meaning checks: advisory (uncalibrated) (no-agreement)\n- Judge fingerprint: none (no judge at L0)\n');
    expect(renderCiSummary(report)).toContain('- Judge fingerprint: none (no judge at L0)');

    const pin = computeJudgeFingerprint(RUNNER_CONFIG.judge, judgedSuite());
    const l1 = { ...report, level: 'L1' as const, judgeTrust: { trusted: false, reason: 'no-agreement', pin, agreement: null } };
    const expected = `- Judge fingerprint: openai gpt-4o · temperature 0 · reasoningEffort null · maxOutputTokens 1024 · prompt ${pin.promptSha256} · schema ${pin.schemaSha256} · guidance ${pin.guidanceSha256}`;
    expect(fingerprintLine(l1)).toBe(expected);
    expect(renderSuiteReportMarkdown(l1)).toContain(`- Meaning checks: advisory (uncalibrated) (no-agreement)\n${expected}\n`);
  });
});

describe('QA review (Story 13.3)', () => {
  const judged = judgedSuite();
  const test = judged.tests[0]!;
  const base = { testId: test.id, sourceCase: 'Z-01', level: 'L1' as const, testKind: 'atomic' as const, inScope: true, method: 'n/a' as const };
  const usage = { calls: 1, inputTokens: 1, outputTokens: 1, totalTokens: 2 };

  it('collects judge FAILs and no-reply FAILs, never rule FAILs, PASSes or out-of-scope results', () => {
    const reply = 'Two | three\nquestions?';
    const run = replyRun(test, 1, reply);
    const results: CriterionResult[] = [
      { ...base, criterionId: 'Z-01.C1', layer: 'P', status: 'FAIL', advisory: true, reason: 'misses | the point', judgeUsage: usage },
      { ...base, criterionId: 'Z-01.C2', layer: 'D', status: 'PASS', advisory: true, reason: 'ok', evidence: 'Two', judgeUsage: usage },
      { ...base, criterionId: 'Z-01.C3', layer: 'S', status: 'FAIL', advisory: false, evidence: 'turn 1 — no reply' },
      { ...base, criterionId: 'Z-01.C4', layer: 'C', status: 'FAIL', advisory: false, meaningSkipped: true, evidence: 'turn 1 — 2 questions' },
    ];
    expect(collectQaReview(test, run, 3, results)).toEqual([
      {
        key: 'Z-01.A1/Z-01.C1',
        testId: 'Z-01.A1',
        sourceCase: 'Z-01',
        criterionId: 'Z-01.C1',
        layer: 'P',
        sample: 3,
        advisory: true,
        replies: [reply],
        reason: 'misses | the point',
      },
    ]);
    const silent = replyRun(test, 1, null);
    const noReply: CriterionResult = { ...base, criterionId: 'Z-01.C2', layer: 'D', status: 'FAIL', advisory: true, evidence: 'no-reply', judgeUsage: usage };
    expect(collectQaReview(test, silent, 1, [noReply])).toEqual([expect.objectContaining({ criterionId: 'Z-01.C2', replies: [], reason: 'no-reply' })]);
    expect(collectQaReview(test, silent, 1, [{ ...noReply, inScope: false }])).toEqual([]);
  });

  it('renders the section in report.md with escaped cells, never in the CI summary', () => {
    const report = l0Report();
    expect(renderSuiteReportMarkdown(report)).toContain('## QA review\n\nNone.\n');
    const withQa: SuiteRunReport = {
      ...report,
      qaReview: [
        {
          key: 'Z-01.A1/Z-01.C1',
          testId: 'Z-01.A1',
          sourceCase: 'Z-01',
          criterionId: 'Z-01.C1',
          layer: 'P',
          sample: 1,
          advisory: true,
          replies: ['First | reply\nline two', 'Second reply'],
          reason: 'misses | the point',
        },
        {
          key: 'Z-01.A1/Z-01.C2',
          testId: 'Z-01.A1',
          sourceCase: 'Z-01',
          criterionId: 'Z-01.C2',
          layer: 'D',
          sample: 2,
          advisory: false,
          replies: [],
          reason: 'no-reply',
        },
      ],
    };
    expect(SuiteRunReportSchema.parse(JSON.parse(JSON.stringify(withQa)))).toEqual(withQa);
    const markdown = renderSuiteReportMarkdown(withQa);
    expect(markdown).toContain(
      [
        '## QA review',
        '',
        '| Case | Test | Criterion | Layer | Sample | Advisory | Reply | Judge reason |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
        '| Z-01 | Z-01.A1 | Z-01.C1 | P | 1 | yes | First \\| reply line two // Second reply | misses \\| the point |',
        '| Z-01 | Z-01.A1 | Z-01.C2 | D | 2 | no |  | no-reply |',
      ].join('\n'),
    );
    const tricky: SuiteRunReport = {
      ...withQa,
      qaReview: [{ ...withQa.qaReview![0]!, replies: ['a\\|b\r\nc\rd'], reason: 'x\\|y' }],
    };
    expect(renderSuiteReportMarkdown(tricky)).toContain('| Z-01 | Z-01.A1 | Z-01.C1 | P | 1 | yes | a\\\\\\|b c d | x\\\\\\|y |');
    const summary = renderCiSummary(withQa);
    expect(summary).not.toContain('QA review');
    expect(summary).not.toContain('First');
    expect(summary).not.toContain('misses');
  });

  it('still parses a pre-13.3 report without qaReview', () => {
    const legacy: Partial<SuiteRunReport> = { ...l0Report() };
    delete legacy.qaReview;
    expect(SuiteRunReportSchema.parse(legacy).qaReview).toBeUndefined();
    expect(renderSuiteReportMarkdown(SuiteRunReportSchema.parse(legacy))).toContain('## QA review\n\nNone.');
  });
});

describe('usage per model and budgets (Story 13.5)', () => {
  const l1Usage = {
    budget: { maxCoachCalls: 600, maxJudgeCalls: 150, coachCalls: 12, judgeCalls: 9, exceeded: [] as Array<'coach' | 'judge'> },
    modelUsage: [
      { role: 'coach' as const, model: 'azure:gpt-4o', calls: 12, inputTokens: null, outputTokens: null, totalTokens: null },
      { role: 'judge' as const, model: 'gpt-4o', calls: 9, inputTokens: 900, outputTokens: 120, totalTokens: 1020 },
    ],
  };

  it('renders the per-model table and the budget line under ## Usage', () => {
    const markdown = renderSuiteReportMarkdown({ ...l0Report(), ...l1Usage });
    const usage = markdown.slice(markdown.indexOf('## Usage'));
    expect(usage).toContain('| Role | Model | Calls | Input tokens | Output tokens | Total tokens |');
    expect(usage).toContain('| coach | azure:gpt-4o | 12 | n/a | n/a | n/a |');
    expect(usage).toContain('| judge | gpt-4o | 9 | 900 | 120 | 1020 |');
    expect(usage).toContain('- Budget: coach 12/600, judge 9/150');
    expect(budgetLine({ budget: { ...l1Usage.budget, exceeded: ['coach'] } })).toBe('coach 12/600, judge 9/150 (exceeded: coach)');
  });

  it('adds one CI usage line per model row with calls, and leaves the L0 summary unchanged', () => {
    const l0 = l0Report();
    const withEmpty = { ...l0, budget: { ...l1Usage.budget, coachCalls: 0, judgeCalls: 0 }, modelUsage: [] };
    expect(renderCiSummary(withEmpty)).toBe(renderCiSummary(l0));
    expect(renderCiSummary(withEmpty)).not.toContain('Usage');

    const summary = renderCiSummary({ ...l0, ...l1Usage, modelUsage: [...l1Usage.modelUsage, { ...l1Usage.modelUsage[0]!, model: 'idle', calls: 0 }] });
    expect(summary).toContain('- Usage: coach azure:gpt-4o: 12 call(s), tokens n/a');
    expect(summary).toContain('- Usage: judge gpt-4o: 9 call(s), tokens 900 in / 120 out / 1020 total');
    expect(summary).not.toContain('idle');
  });

  it('says no model calls for an L0 run and still parses a pre-13.5 report without budget or modelUsage', () => {
    const l0 = { ...l0Report(), budget: { ...l1Usage.budget, coachCalls: 0, judgeCalls: 0 }, modelUsage: [] };
    const markdown = renderSuiteReportMarkdown(l0);
    expect(markdown).toContain('## Usage\n\nNo model calls.\n\n- Budget: coach 0/600, judge 0/150');

    const legacy = l0Report();
    expect(legacy.budget).toBeUndefined();
    expect(SuiteRunReportSchema.parse(legacy).modelUsage).toBeUndefined();
    expect(renderSuiteReportMarkdown(legacy)).not.toContain('- Budget:');
    expect(budgetLine(legacy)).toBeNull();
  });
});

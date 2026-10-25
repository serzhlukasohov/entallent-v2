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
import { buildSuiteReport, renderCiSummary, renderSuiteReportMarkdown, writeSuiteReport, type SuiteReportMeta } from './report';
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

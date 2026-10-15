import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ScenarioRunReport } from '../harness/report';
import { describe, expect, it } from 'vitest';
import { buildFailureReason, classifyFailure } from './failure-classifier';

describe('classifyFailure', () => {
  it('keeps a report-backed timeout assertion as a product failure', () => {
    expect(
      classifyFailure({
        exitCode: 1,
        output: 'AssertionError: expected timeout guidance to be absent',
        reportCount: 1,
      }),
    ).toBe('product');
  });

  it('keeps an assertion without a report as a product failure', () => {
    expect(
      classifyFailure({
        exitCode: 1,
        output: 'AssertionError: network wording was repeated',
        reportCount: 0,
      }),
    ).toBe('product');
  });

  it('retries only a report-free transport failure', () => {
    expect(
      classifyFailure({
        exitCode: 1,
        output: 'TypeError: fetch failed caused by ECONNRESET',
        reportCount: 0,
      }),
    ).toBe('infrastructure');
  });

  it('does not treat incidental network and 5xx wording as transport evidence', () => {
    expect(
      classifyFailure({
        exitCode: 1,
        output: 'Error: expected network policy to reject 500 characters',
        reportCount: 0,
      }),
    ).toBe('product');
  });

  it('requires a report even when the subprocess exits successfully', () => {
    expect(classifyFailure({ exitCode: 0, output: '', reportCount: 1 })).toBe('none');
    expect(classifyFailure({ exitCode: 0, output: '', reportCount: 0 })).toBe('product');
  });
});

function report(passed = true, violations: ScenarioRunReport['deterministic']['violations'] = []): ScenarioRunReport {
  return {
    schemaVersion: 1, gateId: null, gateRunId: null, scenarioName: 'fixture', scenarioSlug: 'fixture',
    runAt: '2026-10-06', gitSha: null,
    models: { coachBalanced: null, simulator: null, judge: null, azureTestingDeployment: null },
    judge: { evaluated: true, passed: true, metCriteria: ['preserved'], unmetCriteria: [], reasoning: 'judge passed' },
    deterministic: { passed, violations }, turns: [], memoryItems: [], styleProfile: null,
  };
}

describe('report-backed hard gate', () => {
  it.each([
    report(false),
    report(true, [{ turn: 1, rule: 'max-questions', detail: 'too many questions' }]),
  ])('rejects a deterministic failure despite exit zero', (failedReport) => {
    expect(classifyFailure({ exitCode: 0, output: 'ECONNRESET', reportCount: 2, reports: [report(), failedReport] })).toBe('product');
    expect(buildFailureReason(0, '', [report(), failedReport])).toContain('fixture: deterministic checks failed');
  });

  it('treats an agent-turn-error as a hard failure unless its message is a transport failure', () => {
    const agentError = (detail: string, extra: ScenarioRunReport['deterministic']['violations'] = []) =>
      report(false, [{ turn: 1, rule: 'agent-turn-error', detail }, ...extra]);
    const testFailure = (detail: string) => ({ turn: 0, rule: 'test-failure', detail });

    const invalidBundle = agentError('Error: bundle composition returned 2 statements for 3 questions');
    expect(classifyFailure({ exitCode: 1, output: 'ECONNRESET elsewhere in the log', reportCount: 1, reports: [invalidBundle] })).toBe('product');
    expect(buildFailureReason(1, '', [invalidBundle])).toContain('turn 1 agent-turn-error: Error: bundle composition');

    const transport = agentError('TypeError: fetch failed caused by ECONNRESET', [testFailure('fetch failed caused by ECONNRESET')]);
    expect(classifyFailure({ exitCode: 1, output: '', reportCount: 1, reports: [transport] })).toBe('infrastructure');

    const transportThenProductViolation = agentError('TypeError: fetch failed', [{ turn: 2, rule: 'too-many-questions', detail: 'a? b?' }]);
    expect(classifyFailure({ exitCode: 1, output: '', reportCount: 1, reports: [transportThenProductViolation] })).toBe('product');
  });

  it('keeps judge-only failures separate and retains assertion diagnostics', () => {
    const judgeFailure = report();
    judgeFailure.judge.passed = false;
    expect(classifyFailure({ exitCode: 0, output: '', reportCount: 1, reports: [judgeFailure] })).toBe('none');
    expect(buildFailureReason(1, 'AssertionError: later check failed', [report()])).toBe('AssertionError: later check failed');
  });

  it('captures late assertions and cleanup failures in every report, leaving passing tests clean', () => {
    // Keep generated TypeScript outside src so parallel typechecks cannot discover a deleted fixture.
    const fixtureDir = mkdtempSync(join(process.cwd(), 'report-fixture-'));
    const reportDir = join(fixtureDir, 'reports');
    const fixtureFile = join(fixtureDir, 'late.test.ts');
    const fixtureConfig = join(fixtureDir, 'vitest.config.mjs');
    try {
      writeFileSync(fixtureFile, `
        import { it, expect, onTestFinished } from 'vitest';
        import { writeScenarioRunReport } from ${JSON.stringify(join(process.cwd(), 'src/harness/report.ts'))};
        const base = ${JSON.stringify(report())};
        it('fails after writing two reports', () => {
          writeScenarioRunReport({ ...base, scenarioSlug: 'first' });
          writeScenarioRunReport({ ...base, scenarioSlug: 'second' });
          expect('actual', 'late hard assertion').toBe('expected');
        });
        it('fails in an earlier registered cleanup after writing reports', () => {
          onTestFinished(() => { throw new Error('late cleanup failure'); });
          writeScenarioRunReport({ ...base, scenarioSlug: 'cleanup-first' });
          writeScenarioRunReport({ ...base, scenarioSlug: 'cleanup-second' });
        });
        it('passes after the failed test', () => {
          writeScenarioRunReport({ ...base, scenarioSlug: 'clean' });
          expect(true).toBe(true);
        });
      `);
      writeFileSync(fixtureConfig, `export default { root: ${JSON.stringify(process.cwd())}, test: { include: [${JSON.stringify(relative(process.cwd(), fixtureFile))}] } };`);
      const child = spawnSync('pnpm', ['exec', 'vitest', 'run', '--config', fixtureConfig, fixtureFile], {
        cwd: process.cwd(), encoding: 'utf8', timeout: 60_000,
        env: { ...process.env, SIM_GATE_REPORT_DIR: reportDir, SIM_GATE_RUN_ID: '' },
      });
      expect(child.error).toBeUndefined();
      expect(child.status, `${child.stdout} ${child.stderr}`).toBe(1);
      for (const slug of ['first', 'second']) {
        const finalized = JSON.parse(readFileSync(join(reportDir, `${slug}.json`), 'utf8')) as ScenarioRunReport;
        expect(finalized.deterministic.passed).toBe(false);
        expect(finalized.deterministic.violations).toEqual(expect.arrayContaining([
          expect.objectContaining({ rule: 'test-failure', detail: expect.stringContaining('late hard assertion') }),
        ]));
        expect(finalized.judge).toEqual(report().judge);
        expect(readFileSync(join(reportDir, `${slug}.md`), 'utf8')).not.toContain('all clear');
      }
      for (const slug of ['cleanup-first', 'cleanup-second']) {
        const finalized = JSON.parse(readFileSync(join(reportDir, `${slug}.json`), 'utf8')) as ScenarioRunReport;
        expect(finalized.deterministic.passed).toBe(false);
        expect(finalized.deterministic.violations).toEqual(expect.arrayContaining([
          expect.objectContaining({ rule: 'test-failure', detail: expect.stringContaining('late cleanup failure') }),
        ]));
        expect(finalized.judge).toEqual(report().judge);
        expect(readFileSync(join(reportDir, `${slug}.md`), 'utf8')).not.toContain('all clear');
      }
      const clean = JSON.parse(readFileSync(join(reportDir, 'clean.json'), 'utf8')) as ScenarioRunReport;
      expect(clean.deterministic).toEqual({ passed: true, violations: [] });
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  }, 70_000);
});

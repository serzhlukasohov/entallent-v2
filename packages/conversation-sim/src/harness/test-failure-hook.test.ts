import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ScenarioRunReport } from './report';
import { installTestFailedHook, testFailedHook, type TestFailedHandler, type TestFailedHook } from './test-failure-hook';

describe('testFailedHook', () => {
  let previous: TestFailedHook | null = null;
  beforeEach(() => {
    previous = installTestFailedHook(testFailedHook());
  });
  afterEach(() => {
    installTestFailedHook(previous);
  });

  it('returns the installed hook and hands back the previous one', () => {
    const registered: TestFailedHandler[] = [];
    const hook: TestFailedHook = (handler) => registered.push(handler);
    installTestFailedHook(hook);
    testFailedHook()?.(() => undefined);
    expect(registered).toHaveLength(1);
    expect(installTestFailedHook(null)).toBe(hook);
  });

  // Outside Vitest the hook is null: proven by the plain-Node CLI spawn in import-graph.test.ts.
  it('falls back to the Vitest worker namespace when nothing is installed', () => {
    installTestFailedHook(null);
    expect(typeof testFailedHook()).toBe('function');
  });

  it('vitest-setup.ts installs a hook that finalizes a report when the test fails', () => {
    // Keep generated TypeScript outside src so parallel typechecks cannot discover a deleted fixture.
    const fixtureDir = mkdtempSync(join(process.cwd(), 'hook-fixture-'));
    const reportDir = join(fixtureDir, 'reports');
    const fixtureFile = join(fixtureDir, 'hook.test.ts');
    const fixtureConfig = join(fixtureDir, 'vitest.config.mjs');
    const base: ScenarioRunReport = {
      schemaVersion: 1,
      gateId: null,
      gateRunId: null,
      scenarioName: 'hook fixture',
      scenarioSlug: 'hook-fixture',
      runAt: '2026-10-25T10:00:00.000Z',
      gitSha: null,
      models: { coachBalanced: null, simulator: null, judge: null, azureTestingDeployment: null },
      judge: { evaluated: false, passed: false, metCriteria: [], unmetCriteria: [], reasoning: null },
      deterministic: { passed: true, violations: [] },
      turns: [],
      memoryItems: [],
      styleProfile: null,
    };
    try {
      writeFileSync(fixtureFile, `
        import { it, expect } from 'vitest';
        import { writeScenarioRunReport } from ${JSON.stringify(join(process.cwd(), 'src/harness/report.ts'))};
        import { installTestFailedHook } from ${JSON.stringify(join(process.cwd(), 'src/harness/test-failure-hook.ts'))};
        it('fails after writing a report', () => {
          const installed = installTestFailedHook(null);
          installTestFailedHook(installed);
          expect(installed, 'setup file installed no hook').not.toBeNull();
          writeScenarioRunReport(${JSON.stringify(base)});
          expect('actual', 'hook fixture assertion').toBe('expected');
        });
      `);
      writeFileSync(
        fixtureConfig,
        `export default { root: ${JSON.stringify(process.cwd())}, test: { setupFiles: [${JSON.stringify(join(process.cwd(), 'src/harness/vitest-setup.ts'))}], include: [${JSON.stringify(relative(process.cwd(), fixtureFile))}] } };`,
      );
      const child = spawnSync('pnpm', ['exec', 'vitest', 'run', '--config', fixtureConfig, fixtureFile], {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 60_000,
        env: { ...process.env, SIM_GATE_REPORT_DIR: reportDir, SIM_GATE_RUN_ID: '' },
      });
      expect(child.error).toBeUndefined();
      expect(child.status, `${child.stdout} ${child.stderr}`).toBe(1);
      expect(child.stdout).not.toContain('setup file installed no hook');
      const finalized = JSON.parse(readFileSync(join(reportDir, 'hook-fixture.json'), 'utf8')) as ScenarioRunReport;
      expect(finalized.deterministic.passed).toBe(false);
      expect(finalized.deterministic.violations).toEqual([
        expect.objectContaining({ rule: 'test-failure', detail: expect.stringContaining('hook fixture assertion') }),
      ]);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});

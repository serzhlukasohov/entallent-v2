import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSuiteConfig } from './config';

const PACKAGE_CONFIG = resolve(__dirname, '..', '..', 'suite.config.json');

describe('loadSuiteConfig', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'suite-config-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('loads the committed suite.config.json', () => {
    const config = loadSuiteConfig(PACKAGE_CONFIG);
    expect(config.suites).toEqual(['p-v1', 'smoke-v1']);
    expect(config.interMessageGapMs).toBe(60_000);
    expect(config.baseline.minSamples).toEqual({ L0: 1, L1: 5, L2: 3 });
    expect(config.diff.minSamples).toEqual({ L1: 3, L2: 3 });
    expect(config.retries).toEqual({ infrastructure: 1 });
    expect(config.budgets).toEqual({ maxCoachCallsPerRun: 600, maxJudgeCallsPerRun: 150 });
    expect(config.judge).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
      decoding: { temperature: 0, reasoningEffort: null, maxOutputTokens: 1024 },
      agreementThreshold: { overall: 0.85, kappa: 0.6 },
      minLabels: 40,
    });
  });

  function write(content: string): string {
    const path = join(dir, 'suite.config.json');
    writeFileSync(path, content);
    return path;
  }

  it('reports a missing file, invalid JSON and the Zod path of an invalid value', () => {
    const missing = join(dir, 'absent.json');
    expect(() => loadSuiteConfig(missing)).toThrow(`[suite] config: ${missing}: cannot read (ENOENT)`);
    const broken = write('{');
    expect(() => loadSuiteConfig(broken)).toThrow(new RegExp(`^\\[suite\\] config: ${broken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: invalid JSON`));

    const valid = JSON.parse(readFileSync(PACKAGE_CONFIG, 'utf8'));
    const cases: Array<[unknown, RegExp]> = [
      [{ ...valid, levels: ['L0', 'L7'] }, /: levels\.1: /],
      [{ ...valid, suites: ['p-v1', 'p-v1'] }, /: suites: suite ids must be unique/],
      [{ ...valid, extra: true }, /Unrecognized key/],
      [{ ...valid, baseline: { minSamples: { L0: 0, L1: 5, L2: 3 } } }, /: baseline\.minSamples\.L0: /],
      [{ ...valid, judge: { ...valid.judge, provider: 'anthropic' } }, /: judge\.provider: /],
      [{ ...valid, schemaVersion: 2 }, /: schemaVersion: /],
    ];
    for (const [config, message] of cases) expect(() => loadSuiteConfig(write(JSON.stringify(config)))).toThrow(message);
  });
});

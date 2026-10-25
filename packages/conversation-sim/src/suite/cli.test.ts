import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RUNNER_CONFIG, cleanRun, fakeExecutor, fakeSuite, liveSuite } from './__fixtures__/runner';
import { TEST_RULES } from './__fixtures__/suite';
import { ciRunUrlFromEnv, main, parseArgs, runIdFor, scrubModelCredentials, type CliDeps, type GitState } from './cli';
import { L0DeterministicExecutor } from './executors/l0-deterministic-executor';
import type { SuiteExecutor } from './executors/types';
import { loadSuite } from './loader';
import { BaselineSchema, SuiteRunReportSchema, type LoadedSuite } from './schema';

const SECRET = 'sk-test-not-a-real-key-123';

interface Harness {
  deps: CliDeps;
  out: string[];
  err: string[];
  setNow(iso: string): void;
  setGit(state: GitState): void;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'suite-cli-'));
  writeFileSync(join(dir, 'suite.config.json'), JSON.stringify(RUNNER_CONFIG));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function harness(options: { env?: Record<string, string | undefined>; executor?: () => SuiteExecutor } = {}): Harness {
  const out: string[] = [];
  const err: string[] = [];
  let now = new Date('2026-10-25T10:00:00.000Z');
  let git: GitState = { sha: 'abc1234def5678', shortSha: 'abc1234', dirty: false };
  const suites: Record<string, () => LoadedSuite> = { 'x-suite': fakeSuite, 'x-live': liveSuite };
  const deps: CliDeps = {
    env: options.env ?? {},
    packageDir: dir,
    now: () => now,
    git: () => git,
    log: (line) => out.push(line),
    error: (line) => err.push(line),
    loadSuite: (id) => suites[id]?.() ?? loadSuite(id),
    createExecutor: () => (options.executor ? options.executor() : fakeExecutor()),
    rules: TEST_RULES,
  };
  return {
    deps,
    out,
    err,
    setNow: (iso) => {
      now = new Date(iso);
    },
    setGit: (state) => {
      git = state;
    },
  };
}

function runDirs(): string[] {
  const root = join(dir, 'runs', 'suites');
  return existsSync(root) ? readdirSync(root) : [];
}

describe('parseArgs', () => {
  it('parses run and accept flags', () => {
    expect(parseArgs(['run', '--suite', 'p-v1', '--level', 'L0'])).toEqual({ command: 'run', suite: 'p-v1', level: 'L0', runs: 1 });
    expect(parseArgs(['--', 'run', '--', '--suite', 'p-v1', '--level', 'L0', '--runs', '3', '--case', 'P-06'])).toEqual({
      command: 'run',
      suite: 'p-v1',
      level: 'L0',
      runs: 3,
      case: 'P-06',
    });
    expect(parseArgs(['baseline:accept', '--run', 'r1', '--allow-incomplete', '--ci-run-url', 'https://x/y'])).toEqual({
      command: 'baseline:accept',
      run: 'r1',
      allowIncomplete: true,
      allowDirty: false,
      ciRunUrl: 'https://x/y',
    });
    expect(parseArgs([])).toEqual({ command: 'help' });
    expect(parseArgs(['run', '--help'])).toEqual({ command: 'help' });
  });

  it.each([
    [['run', '--level', 'L0'], /--suite <id> is required/],
    [['run', '--suite', 'p-v1'], /--level <L0\|L1\|L2> is required/],
    [['run', '--suite', 'p-v1', '--level', 'L9'], /--level must be L0, L1 or L2/],
    [['run', '--suite', 'p-v1', '--level', 'L0', '--runs', '0'], /--runs must be a positive integer/],
    [['run', '--suite', 'p-v1', '--level', 'L0', '--runs', '1.5'], /--runs must be a positive integer/],
    [['run', '--suite', 'p-v1', '--level', 'L0', '--bogus'], /Unknown option/],
    [['baseline:accept'], /--run <runId> is required/],
    [['run', '--suite', 'p-v1', '--level', 'L0', '--case', ''], /--case must not be empty/],
    [['baseline:accept', '--run', 'r1', '--ci-run-url', ''], /--ci-run-url must be a URL/],
    [['baseline:accept', '--run', 'r1', '--ci-run-url', 'not a url'], /--ci-run-url must be a URL/],
    [['deploy'], /unknown command deploy/],
  ])('rejects %j', (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });
});

describe('scrubModelCredentials', () => {
  it('removes OPENAI_API_KEY and every AZURE_OPENAI_* key and returns only names', () => {
    const env: Record<string, string | undefined> = {
      OPENAI_API_KEY: SECRET,
      AZURE_OPENAI_ENDPOINT: 'https://secret.example',
      AZURE_OPENAI_API_KEY: SECRET,
      OPENAI_MODEL_BALANCED: 'gpt-x',
      PATH: '/bin',
    };
    expect(scrubModelCredentials(env)).toEqual(['AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT', 'OPENAI_API_KEY']);
    expect(env).toEqual({ OPENAI_MODEL_BALANCED: 'gpt-x', PATH: '/bin' });
  });
});

describe('helpers', () => {
  it('builds the run id like run-gate.ts and the CI run url from GitHub env', () => {
    expect(runIdFor(new Date('2026-10-25T10:00:00.123Z'), 'abc1234')).toBe('2026-10-25T10-00-00-123Z-abc1234');
    expect(runIdFor(new Date('2026-10-25T10:00:00.123Z'), null)).toBe('2026-10-25T10-00-00-123Z-unknown');
    expect(ciRunUrlFromEnv({ GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '42' })).toBe(
      'https://github.com/o/r/actions/runs/42',
    );
    expect(ciRunUrlFromEnv({ GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'o/r' })).toBeUndefined();
  });
});

describe('suite:run', () => {
  it('runs a synthetic suite with the real executor, writes the report and case runs, prints the layer table', async () => {
    const h = harness({ executor: () => new L0DeterministicExecutor() });
    const code = await main(['run', '--suite', 'x-live', '--level', 'L0', '--runs', '2'], h.deps);
    expect(h.err).toEqual([]);
    expect(code).toBe(0);
    const runId = '2026-10-25T10-00-00-000Z-abc1234';
    expect(runDirs()).toEqual([runId]);
    const report = SuiteRunReportSchema.parse(JSON.parse(readFileSync(join(dir, 'runs', 'suites', runId, 'report.json'), 'utf8')));
    expect(report).toMatchObject({ runId, n: 2, git: { sha: 'abc1234def5678', dirty: false }, verdict: 'ADEQUATE' });
    expect(readFileSync(join(dir, 'runs', 'suites', runId, 'report.md'), 'utf8')).toContain('# Suite x-live L0');
    const caseRuns = JSON.parse(readFileSync(join(dir, 'runs', 'suites', runId, 'case-runs.json'), 'utf8'));
    expect(caseRuns.caseRuns).toHaveLength(6);
    expect(h.out).toContain('[suite] layer  PASS  FAIL  rate');
    expect(h.out).toContain('[suite] verdict: ADEQUATE · COMPLETE');
    expect(h.out).toContain(`[suite] report: ${join('runs', 'suites', runId, 'report.json')}`);
  });

  it.each(['smoke-v1', 'p-v1'])('runs the empty registered suite %s and exits 0 with an INCOMPLETE report', async (id) => {
    const h = harness();
    expect(await main(['run', '--suite', id, '--level', 'L0'], h.deps)).toBe(0);
    expect(h.out).toContain(`[suite] ${id} has no tests`);
    expect(h.out.some((line) => line.startsWith('[suite] verdict: NOT ADEQUATE (provisional) · INCOMPLETE'))).toBe(true);
    expect(h.out.some((line) => line.includes(`suite ${id} has no tests`) && line.startsWith('[suite] provisional:'))).toBe(true);
    const [runId] = runDirs();
    const report = SuiteRunReportSchema.parse(JSON.parse(readFileSync(join(dir, 'runs', 'suites', runId!, 'report.json'), 'utf8')));
    expect(report).toMatchObject({ complete: false, provisional: true, results: {} });
  });

  it('scrubs model credentials before running and never prints their values', async () => {
    const env: Record<string, string | undefined> = { OPENAI_API_KEY: SECRET, AZURE_OPENAI_ENDPOINT: 'https://secret.example', HOME: '/h' };
    let seen: Record<string, string | undefined> | null = null;
    const h = harness({
      env,
      executor: () =>
        fakeExecutor((test, attempt) => {
          seen = { ...env };
          return cleanRun(test, attempt);
        }),
    });
    expect(await main(['run', '--suite', 'x-suite', '--level', 'L0'], h.deps)).toBe(0);
    expect(env).toEqual({ HOME: '/h' });
    expect(seen).toEqual({ HOME: '/h' });
    const printed = [...h.out, ...h.err].join('\n');
    expect(printed).not.toContain(SECRET);
    expect(printed).not.toContain('secret.example');
    expect(printed).toContain('removed model credentials from the environment (AZURE_OPENAI_ENDPOINT, OPENAI_API_KEY)');
  });

  it('validates the config before refusing a non-L0 level', async () => {
    writeFileSync(join(dir, 'suite.config.json'), '{ not json');
    const h = harness();
    expect(await main(['run', '--suite', 'x-suite', '--level', 'L1'], h.deps)).toBe(1);
    expect(h.err[0]).toMatch(/^\[suite\] config: .*invalid JSON/);
    expect(await main(['--help'], h.deps)).toBe(0);
  });

  it.each([
    ['L1', '[suite] L1 executor lands in Epic 13'],
    ['L2', '[suite] L2 executor lands in Epic 14'],
  ])('refuses %s and runs nothing', async (level, message) => {
    const h = harness();
    expect(await main(['run', '--suite', 'x-suite', '--level', level], h.deps)).toBe(1);
    expect(h.err).toEqual([message]);
    expect(runDirs()).toEqual([]);
  });

  it('refuses an unknown suite, an unknown case and a bad config', async () => {
    const unknown = harness();
    expect(await main(['run', '--suite', 'nope', '--level', 'L0'], unknown.deps)).toBe(1);
    expect(unknown.err[0]).toBe('[suite] unknown suite nope; known suites: p-v1, smoke-v1, x-suite, x-live');

    const badCase = harness();
    expect(await main(['run', '--suite', 'x-suite', '--level', 'L0', '--case', 'X-99'], badCase.deps)).toBe(1);
    expect(badCase.err[0]).toMatch(/unknown case X-99; known: X-01, X-01\.A1, X-01\.J, X-02/);

    writeFileSync(join(dir, 'suite.config.json'), '{ not json');
    const badJson = harness();
    expect(await main(['run', '--suite', 'x-suite', '--level', 'L0'], badJson.deps)).toBe(1);
    expect(badJson.err[0]).toMatch(/^\[suite\] config: .*suite\.config\.json: invalid JSON/);

    writeFileSync(join(dir, 'suite.config.json'), JSON.stringify({ ...RUNNER_CONFIG, retries: { infrastructure: 9 } }));
    const badValue = harness();
    expect(await main(['run', '--suite', 'x-suite', '--level', 'L0'], badValue.deps)).toBe(1);
    expect(badValue.err[0]).toMatch(/^\[suite\] config: .*suite\.config\.json: retries\.infrastructure: /);
    expect(runDirs()).toEqual([]);
  });

  it('records the --case selection in the report', async () => {
    const h = harness();
    expect(await main(['run', '--suite', 'x-suite', '--level', 'L0', '--case', 'X-02'], h.deps)).toBe(0);
    const [runId] = runDirs();
    const report = SuiteRunReportSchema.parse(JSON.parse(readFileSync(join(dir, 'runs', 'suites', runId!, 'report.json'), 'utf8')));
    expect(report.selection).toEqual({ case: 'X-02' });
  });

  it('prints help and exits 0', async () => {
    const h = harness();
    expect(await main(['--help'], h.deps)).toBe(0);
    expect(h.out[0]).toContain('suite:run --suite <id> --level L0');
  });
});

describe('suite:baseline:accept', () => {
  async function run(h: Harness, extra: string[] = []): Promise<string> {
    const before = new Set(runDirs());
    expect(await main(['run', '--suite', 'x-suite', '--level', 'L0', ...extra], h.deps)).toBe(0);
    return runDirs().find((id) => !before.has(id))!;
  }

  const baselineFile = () => join(dir, 'baselines', 'x-suite', 'L0.json');

  it('writes a baseline that parses and is byte-identical across accepts apart from acceptedAt', async () => {
    const h = harness({ env: { GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '7' } });
    const runId = await run(h);

    h.setNow('2026-10-25T12:00:00.000Z');
    expect(await main(['baseline:accept', '--run', runId], h.deps)).toBe(0);
    const first = readFileSync(baselineFile(), 'utf8');
    const baseline = BaselineSchema.parse(JSON.parse(first));
    expect(baseline).toMatchObject({
      acceptedFrom: { runId, gitSha: 'abc1234def5678', ciRunUrl: 'https://github.com/o/r/actions/runs/7' },
      acceptedAt: '2026-10-25T12:00:00.000Z',
      provisional: false,
    });
    expect(h.out.at(-1)).toBe(`[suite] baseline x-suite L0 from run ${runId}: ${join('baselines', 'x-suite', 'L0.json')}`);

    h.setNow('2026-10-26T08:00:00.000Z');
    expect(await main(['baseline:accept', '--run', runId], h.deps)).toBe(0);
    const second = readFileSync(baselineFile(), 'utf8');
    expect(second).not.toBe(first);
    const strip = (text: string) => text.replace(/"acceptedAt": "[^"]+"/, '');
    expect(strip(second)).toBe(strip(first));
  });

  it('prefers --ci-run-url over the GitHub env', async () => {
    const h = harness({ env: { GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '7' } });
    const runId = await run(h);
    expect(await main(['baseline:accept', '--run', runId, '--ci-run-url', 'https://ci.example/run/1'], h.deps)).toBe(0);
    expect(BaselineSchema.parse(JSON.parse(readFileSync(baselineFile(), 'utf8'))).acceptedFrom.ciRunUrl).toBe('https://ci.example/run/1');
  });

  it('refuses a dirty run unless --allow-dirty, printing every reason and writing nothing', async () => {
    const h = harness();
    h.setGit({ sha: null, shortSha: null, dirty: true });
    const runId = await run(h);
    expect(await main(['baseline:accept', '--run', runId], h.deps)).toBe(1);
    expect(h.err).toEqual([
      `[suite] baseline:accept refused run ${runId}:`,
      '[suite]   - run was made from a dirty working tree; pass --allow-dirty to accept it',
      '[suite]   - run has no git sha',
    ]);
    expect(existsSync(baselineFile())).toBe(false);

    const clean = harness();
    clean.setGit({ sha: 'abc1234def5678', shortSha: 'abc1234', dirty: true });
    clean.setNow('2026-10-25T10:05:00.000Z');
    const dirtyRun = await run(clean);
    expect(await main(['baseline:accept', '--run', dirtyRun, '--allow-dirty'], clean.deps)).toBe(0);
    expect(existsSync(baselineFile())).toBe(true);
  });

  it('refuses an INCOMPLETE run unless --allow-incomplete, which records provisional', async () => {
    const h = harness({
      executor: () =>
        fakeExecutor((test, attempt) =>
          cleanRun(test, attempt, test.id === 'X-02' ? [{ kind: 'product', step: 0, reason: 'scripted-output-missing:1', message: '' }] : []),
        ),
    });
    const runId = await run(h);
    expect(await main(['baseline:accept', '--run', runId], h.deps)).toBe(1);
    expect(h.err[1]).toMatch(/run is INCOMPLETE \(incomplete: 1 ERROR\); pass --allow-incomplete/);
    expect(existsSync(baselineFile())).toBe(false);

    expect(await main(['baseline:accept', '--run', runId, '--allow-incomplete'], h.deps)).toBe(0);
    expect(BaselineSchema.parse(JSON.parse(readFileSync(baselineFile(), 'utf8'))).provisional).toBe(true);
    expect(h.out.at(-1)).toContain('(provisional)');
  });

  it('refuses a --case run and an empty suite run', async () => {
    const h = harness();
    const narrowed = await run(h, ['--case', 'X-02']);
    expect(await main(['baseline:accept', '--run', narrowed, '--allow-incomplete'], h.deps)).toBe(1);
    expect(h.err).toContain('[suite]   - run was narrowed with --case X-02; accept only a full-suite run');

    h.setNow('2026-10-25T10:10:00.000Z');
    expect(await main(['run', '--suite', 'smoke-v1', '--level', 'L0'], h.deps)).toBe(0);
    const empty = runDirs().find((id) => id.startsWith('2026-10-25T10-10'))!;
    expect(await main(['baseline:accept', '--run', empty, '--allow-incomplete'], h.deps)).toBe(1);
    expect(h.err).toContain('[suite]   - run has no in-scope test criteria');
    expect(existsSync(join(dir, 'baselines'))).toBe(false);
  });

  it('prints the judge-fingerprint refusal together with every other reason', async () => {
    const h = harness();
    h.setGit({ sha: 'abc1234def5678', shortSha: 'abc1234', dirty: true });
    const runId = await run(h);
    const path = join(dir, 'runs', 'suites', runId, 'report.json');
    const report = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...report, level: 'L1' }));
    expect(await main(['baseline:accept', '--run', runId], h.deps)).toBe(1);
    expect(h.err).toEqual([
      `[suite] baseline:accept refused run ${runId}:`,
      '[suite]   - judge fingerprint for L1 lands in Epic 13',
      '[suite]   - n 1 is below baseline.minSamples.L1 5',
      '[suite]   - run was made from a dirty working tree; pass --allow-dirty to accept it',
    ]);
    expect(existsSync(baselineFile())).toBe(false);
  });

  it('refuses a missing or unsafe run id', async () => {
    const h = harness();
    expect(await main(['baseline:accept', '--run', 'nope'], h.deps)).toBe(1);
    expect(h.err).toEqual(['[suite] run nope not found under runs/suites/']);
    const unsafe = harness();
    expect(await main(['baseline:accept', '--run', '../../etc'], unsafe.deps)).toBe(1);
    expect(unsafe.err).toEqual(['[suite] unsafe run id ../../etc']);
    expect(existsSync(join(dir, 'baselines'))).toBe(false);
  });
});

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withoutLangwatchEnv } from './executors/__fixtures__/offline-scenario-env';
import {
  RUNNER_CONFIG,
  agreementFor,
  budgetedExecutor,
  cleanRun,
  fakeExecutor,
  fakeReplyExecutor,
  fakeSuite,
  judgedSuite,
  liveSuite,
} from './__fixtures__/runner';
import { TEST_RULES, validModules } from './__fixtures__/suite';
import {
  aggregateCiExitCode,
  ciRunUrlFromEnv,
  defaultDeps,
  judgeModelToCall,
  main,
  parseArgs,
  readMergeBaseFile,
  runIdFor,
  scrubModelCredentials,
  type CliDeps,
  type GitState,
} from './cli';
import { L0DeterministicExecutor } from './executors/l0-deterministic-executor';
import { L1OrchestratorExecutor } from './executors/l1-orchestrator-executor';
import { ScriptedAiProvider } from '../fakes/scripted-ai';
import type { SuiteExecutor } from './executors/types';
import { loadSuite, validateSuite } from './loader';
import { fakeJudge } from './judge/__fixtures__/calibration';
import { labelsSha256, writeAgreementFile, writeLabelsFile } from './judge/calibrate';
import { label } from './judge/__fixtures__/calibration';
import type { JudgeInput } from './judge/criterion-judge';
import { computeJudgeFingerprint } from './judge/fingerprint';
import { buildJudgeInput } from './judge/judge-input';
import { syntheticRun } from './rules/synthetic-run';
import { AgreementFileSchema, BaselineSchema, LabelsFileSchema, SuiteRunReportSchema, type LoadedSuite } from './schema';

const SECRET = 'sk-test-not-a-real-key-123';
const L1_REFUSAL = '[suite] L1 runs call live models; run suite:run:live with --live-model (model egress and cost are a human boundary)';

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
    expect(parseArgs(['diff', '--run', 'r1'])).toEqual({ command: 'diff', run: 'r1', mergeBase: false });
    expect(parseArgs(['diff', '--run', 'r1', '--baseline', 'b.json'])).toEqual({ command: 'diff', run: 'r1', baseline: 'b.json', mergeBase: false });
    expect(parseArgs(['diff', '--run', 'r1', '--merge-base'])).toEqual({ command: 'diff', run: 'r1', mergeBase: true });
    expect(parseArgs(['ci', '--level', 'L0'])).toEqual({ command: 'ci', level: 'L0' });
    expect(parseArgs(['ci', '--', '--level', 'L0', '--summary', 's.md'])).toEqual({ command: 'ci', level: 'L0', summary: 's.md' });
    expect(parseArgs(['ci', '--level', 'L1', '--runs', '5', '--include-unbaselined'])).toEqual({
      command: 'ci',
      level: 'L1',
      runs: 5,
      includeUnbaselined: true,
    });
    expect(parseArgs(['ci', '--level', 'L1', '--runs', '1'])).toEqual({ command: 'ci', level: 'L1', runs: 1 });
    expect(parseArgs(['ci', '--level', 'L1'])).toEqual({ command: 'ci', level: 'L1' });
    expect(parseArgs(['calibrate', '--suite', 'p-v1'])).toEqual({ command: 'calibrate', suite: 'p-v1' });
    expect(parseArgs(['calibrate', '--', '--suite', 'p-v1', '--import', 'qa.json'])).toEqual({ command: 'calibrate', suite: 'p-v1', import: 'qa.json' });
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
    [['diff'], /\[suite\] diff: --run <runId> is required/],
    [['diff', '--run', 'r1', '--baseline', 'b.json', '--merge-base'], /either --baseline <path> or --merge-base, not both/],
    [['diff', '--run', 'r1', '--baseline', ''], /--baseline must not be empty/],
    [['ci'], /\[suite\] ci: --level <L0\|L1\|L2> is required/],
    [['ci', '--level', 'L7'], /--level must be L0, L1 or L2/],
    [['ci', '--level', 'L0', '--summary', ''], /--summary must not be empty/],
    [['ci', '--level', 'L0', '--suite', 'p-v1'], /Unknown option/],
    [['ci', '--level', 'L0', '--runs', '3'], /\[suite\] ci: --runs and --include-unbaselined are accepted only at L1 and L2/],
    [['ci', '--level', 'L0', '--include-unbaselined'], /\[suite\] ci: --runs and --include-unbaselined are accepted only at L1 and L2/],
    [['ci', '--level', 'L1', '--runs', '0'], /\[suite\] ci: --runs must be a positive integer, got 0/],
    [['ci', '--level', 'L1', '--runs', 'abc'], /\[suite\] ci: --runs must be a positive integer, got abc/],
    [['ci', '--level', 'L1', '--runs', '1.5'], /\[suite\] ci: --runs must be a positive integer/],
    [['calibrate'], /\[suite\] calibrate: --suite <id> is required/],
    [['calibrate', '--suite', 'p-v1', '--import', ''], /--import must not be empty/],
    [['calibrate', '--suite', 'p-v1', '--live-judge'], /Unknown option/],
    [['deploy'], /unknown command deploy; expected run, baseline:accept, diff, ci or calibrate/],
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
    ['L1', L1_REFUSAL],
    ['L2', '[suite] L2 runs drive a running local stack and call live models; run suite:run:live --suite <id> --level L2 --live-model --live-app'],
  ])('refuses %s through the default executor factory and runs nothing', async (level, message) => {
    const h = harness();
    h.deps.createExecutor = defaultDeps().createExecutor;
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
      '[suite]   - n 1 is below baseline.minSamples.L1 5',
      '[suite]   - run was made from a dirty working tree; pass --allow-dirty to accept it',
      '[suite]   - judge fingerprint of the run differs from the current one',
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

describe('suite:run at L1 with an injected executor and judge (Story 13.3)', () => {
  const REPLY = 'Which release deadline comes first?';
  const OTHER_MODEL = 'judge-override-model-xyz';

  beforeEach(() => {
    writeFileSync(join(dir, 'suite.config.json'), JSON.stringify({ ...RUNNER_CONFIG, suites: [...RUNNER_CONFIG.suites, 'x-judged'] }));
  });

  function l1Harness(options: { env?: Record<string, string | undefined>; decide?: Parameters<typeof fakeJudge>[0]; judge?: boolean } = {}) {
    const h = harness({ env: options.env ?? {}, executor: () => fakeReplyExecutor(() => REPLY) });
    const fallback = h.deps.loadSuite;
    let suite = judgedSuite();
    h.deps.loadSuite = (id) => (id === 'x-judged' ? suite : fallback(id));
    const configs: Array<{ model: string }> = [];
    const fake = fakeJudge(options.decide ?? ((input) => (input.layer === 'P' ? 'FAIL' : 'PASS')));
    if (options.judge !== false) {
      h.deps.createRunJudge = (judge) => {
        configs.push(judge);
        return fake.judge;
      };
    }
    return { h, configs, fake, setSuite: (next: LoadedSuite) => (suite = next) };
  }

  const readRun = (runId: string) => SuiteRunReportSchema.parse(JSON.parse(readFileSync(join(dir, 'runs', 'suites', runId, 'report.json'), 'utf8')));
  const readMarkdown = (runId: string) => readFileSync(join(dir, 'runs', 'suites', runId, 'report.md'), 'utf8');

  it('without an agreement: untrusted no-agreement, advisory meaning results, fingerprint and QA review in report.md', async () => {
    const { h, configs } = l1Harness();
    expect(await main(['run', '--suite', 'x-judged', '--level', 'L1'], h.deps)).toBe(0);
    expect(h.err).toEqual([]);
    const [runId] = runDirs();
    const report = readRun(runId!);
    const pin = computeJudgeFingerprint(RUNNER_CONFIG.judge, judgedSuite());
    expect(report.judgeTrust).toEqual({ trusted: false, reason: 'no-agreement', pin, agreement: null });
    expect(report.models).toEqual({ coach: null, judge: 'gpt-4o' });
    expect(configs).toEqual([RUNNER_CONFIG.judge]);
    for (const [key, result] of Object.entries(report.results)) {
      if (result.checkKind === 'meaning') expect(result.advisory, key).toBe(true);
    }
    expect(report.layers!.combinedPdc).toMatchObject({ pass: 0, fail: 0 });
    expect(report.qaReview).toEqual([expect.objectContaining({ key: 'Z-01.A1/Z-01.C1', replies: [REPLY], reason: 'judged FAIL', advisory: true })]);

    const markdown = readMarkdown(runId!);
    expect(markdown).toContain('- Meaning checks: advisory (uncalibrated) (no-agreement)');
    expect(markdown).toContain(`- Judge fingerprint: openai gpt-4o · temperature 0 · reasoningEffort null · maxOutputTokens 1024 · prompt ${pin.promptSha256}`);
    expect(markdown).toContain(`| Z-01 | Z-01.A1 | Z-01.C1 | P | 1 | yes | ${REPLY} | judged FAIL |`);
    expect(h.out).toContain('[suite] meaning checks: advisory (uncalibrated) (no-agreement)');
    expect(h.out).toContain('[suite] QA review: 1 meaning FAIL(s) listed in report.md');
    expect(h.out.join('\n')).not.toContain(REPLY);
  });

  it('with a matching calibrated agreement: trusted and meaning statuses count', async () => {
    writeAgreementFile(dir, 'x-judged', agreementFor(judgedSuite()));
    const { h } = l1Harness();
    expect(await main(['run', '--suite', 'x-judged', '--level', 'L1'], h.deps)).toBe(0);
    const report = readRun(runDirs()[0]!);
    expect(report.judgeTrust).toMatchObject({ trusted: true, reason: 'calibrated' });
    expect(report.results['Z-01.A1/Z-01.C1']).toMatchObject({ status: 'FAIL', advisory: false });
    expect(report.layers!.combinedPdc).toMatchObject({ pass: 2, fail: 1 });
    expect(h.out).toContain('[suite] meaning checks: trusted (calibrated)');
  });

  it.each([
    ['a swapped judge model', { fingerprint: { ...computeJudgeFingerprint(RUNNER_CONFIG.judge, judgedSuite()), model: 'gpt-4o-mini' } }, 'fingerprint-mismatch:model'],
    ['new labels', { labelsSha256: 'd'.repeat(64) }, 'labels-mismatch'],
    ['few labels', { n: 3 }, 'below-min-labels'],
    ['a low kappa', { kappa: 0.4 }, 'below-threshold:kappa'],
  ])('is untrusted for %s', async (_name, overrides, reason) => {
    writeAgreementFile(dir, 'x-judged', agreementFor(judgedSuite(), overrides));
    const { h } = l1Harness();
    expect(await main(['run', '--suite', 'x-judged', '--level', 'L1'], h.deps)).toBe(0);
    expect(readRun(runDirs()[0]!).judgeTrust).toMatchObject({ trusted: false, reason });
  });

  it('hashes the labels on disk: calibrated for matching labels, labels-mismatch after they change', async () => {
    const labels = [label({ criterionId: 'Z-01.C1', status: 'PASS' })];
    writeLabelsFile(dir, 'x-judged', { schemaVersion: 1, labels });
    writeAgreementFile(dir, 'x-judged', agreementFor(judgedSuite(), { labelsSha256: labelsSha256(labels) }));
    const { h } = l1Harness();
    expect(await main(['run', '--suite', 'x-judged', '--level', 'L1'], h.deps)).toBe(0);
    expect(readRun(runDirs()[0]!).judgeTrust).toMatchObject({ trusted: true, reason: 'calibrated' });

    writeLabelsFile(dir, 'x-judged', { schemaVersion: 1, labels: [...labels, label({ criterionId: 'Z-01.C2', status: 'FAIL' })] });
    h.setNow('2026-10-25T10:05:00.000Z');
    expect(await main(['run', '--suite', 'x-judged', '--level', 'L1'], h.deps)).toBe(0);
    const latest = runDirs().find((id) => id.startsWith('2026-10-25T10-05'))!;
    expect(readRun(latest).judgeTrust).toMatchObject({ trusted: false, reason: 'labels-mismatch' });
  });

  it('is untrusted fingerprint-mismatch:guidanceSha256 after guidance was edited', async () => {
    writeAgreementFile(dir, 'x-judged', agreementFor(judgedSuite()));
    const { h, setSuite } = l1Harness();
    setSuite(judgedSuite({ guidance: 'Edited guidance.' }));
    expect(await main(['run', '--suite', 'x-judged', '--level', 'L1'], h.deps)).toBe(0);
    expect(readRun(runDirs()[0]!).judgeTrust).toMatchObject({ trusted: false, reason: 'fingerprint-mismatch:guidanceSha256' });
  });

  it('refuses a SIM_JUDGE_MODEL override without --allow-unpinned-judge, writing nothing and never printing the value', async () => {
    const { h, configs } = l1Harness({ env: { SIM_JUDGE_MODEL: OTHER_MODEL } });
    expect(await main(['run', '--suite', 'x-judged', '--level', 'L1'], h.deps)).toBe(1);
    expect(h.err).toEqual([
      '[suite] SIM_JUDGE_MODEL differs from the pinned judge model gpt-4o; pass --allow-unpinned-judge for an untrusted run',
    ]);
    expect(configs).toEqual([]);
    expect(runDirs()).toEqual([]);
    expect([...h.out, ...h.err].join('\n')).not.toContain(OTHER_MODEL);
  });

  it('runs an unpinned judge with --allow-unpinned-judge: untrusted, records the model called, keeps the pin', async () => {
    writeAgreementFile(dir, 'x-judged', agreementFor(judgedSuite()));
    const { h, configs } = l1Harness({ env: { SIM_JUDGE_MODEL: OTHER_MODEL } });
    expect(await main(['run', '--suite', 'x-judged', '--level', 'L1', '--allow-unpinned-judge'], h.deps)).toBe(0);
    const report = readRun(runDirs()[0]!);
    expect(report.judgeTrust).toMatchObject({ trusted: false, reason: 'unpinned-judge' });
    expect(report.judgeTrust.pin!.model).toBe('gpt-4o');
    expect(report.models.judge).toBe(OTHER_MODEL);
    expect(configs).toEqual([{ ...RUNNER_CONFIG.judge, model: OTHER_MODEL }]);
  });

  it.each([undefined, '', 'gpt-4o'])('treats SIM_JUDGE_MODEL %j as the pin', async (value) => {
    const { h, configs } = l1Harness({ env: { SIM_JUDGE_MODEL: value } });
    expect(await main(['run', '--suite', 'x-judged', '--level', 'L1'], h.deps)).toBe(0);
    expect(readRun(runDirs()[0]!).judgeTrust.reason).toBe('no-agreement');
    expect(configs).toEqual([RUNNER_CONFIG.judge]);
  });

  it('ignores SIM_JUDGE_MODEL and the flag at L0 and prints the fingerprint none line', async () => {
    const h = harness({ env: { SIM_JUDGE_MODEL: OTHER_MODEL } });
    expect(await main(['run', '--suite', 'x-suite', '--level', 'L0', '--allow-unpinned-judge'], h.deps)).toBe(0);
    const [runId] = runDirs();
    const report = readRun(runId!);
    expect(report.judgeTrust).toEqual({ trusted: false, reason: 'no-judge-at-level', pin: null, agreement: null });
    expect(report.models.judge).toBeNull();
    expect(report.qaReview).toEqual([]);
    const markdown = readMarkdown(runId!);
    expect(markdown).toContain('- Judge fingerprint: none (no judge at L0)');
    expect(markdown).toContain('## QA review\n\nNone.');
    expect(h.out).toContain('[suite] meaning checks: advisory (uncalibrated) (no-judge-at-level)');
    expect(h.out.some((line) => line.includes('QA review'))).toBe(false);
  });

  it('refuses an L1 run when no judge is wired, writing nothing', async () => {
    const { h } = l1Harness({ judge: false });
    expect(await main(['run', '--suite', 'x-judged', '--level', 'L1'], h.deps)).toBe(1);
    expect(h.err).toEqual(['[suite] L1 run needs a judge; this entry wires none (suite:run:live wires the pinned judge)']);
    expect(runDirs()).toEqual([]);
  });

  it('the default entry still refuses L1 with the live-entry message and builds no judge', async () => {
    const { h, configs } = l1Harness();
    h.deps.createExecutor = defaultDeps().createExecutor;
    expect(await main(['run', '--suite', 'smoke-v1', '--level', 'L1'], h.deps)).toBe(1);
    expect(h.err).toEqual([L1_REFUSAL]);
    expect(configs).toEqual([]);
    expect(runDirs()).toEqual([]);
    expect(defaultDeps().createRunJudge).toBeUndefined();
  });

  it('parses --allow-unpinned-judge and polices the judge model', () => {
    expect(parseArgs(['run', '--suite', 'p-v1', '--level', 'L1', '--allow-unpinned-judge'])).toEqual({
      command: 'run',
      suite: 'p-v1',
      level: 'L1',
      runs: 1,
      allowUnpinnedJudge: true,
    });
    expect(judgeModelToCall('gpt-4o', undefined, false)).toEqual({ model: 'gpt-4o', unpinned: false });
    expect(judgeModelToCall('gpt-4o', 'x', true)).toEqual({ model: 'x', unpinned: true });
    expect(() => judgeModelToCall('gpt-4o', 'x', false)).toThrow(/differs from the pinned judge model gpt-4o/);
    expect(judgeModelToCall('gpt-4o', ' gpt-4o', false)).toEqual({ model: 'gpt-4o', unpinned: false });
    expect(judgeModelToCall('gpt-4o', 'gpt-4o\n', false)).toEqual({ model: 'gpt-4o', unpinned: false });
    expect(judgeModelToCall('gpt-4o', '   ', false)).toEqual({ model: 'gpt-4o', unpinned: false });
    expect(judgeModelToCall('gpt-4o', ' other \n', true)).toEqual({ model: 'other', unpinned: true });
  });

  describe('suite:baseline:accept of an L1 run', () => {
    async function l1Run(h: Harness, extra: string[] = []): Promise<string> {
      const before = new Set(runDirs());
      expect(await main(['run', '--suite', 'x-judged', '--level', 'L1', '--runs', '5', ...extra], h.deps)).toBe(0);
      return runDirs().find((id) => !before.has(id))!;
    }
    const baselineFile = () => join(dir, 'baselines', 'x-judged', 'L1.json');

    it('accepts a run whose pin matches the current fingerprint and records it', async () => {
      const { h } = l1Harness({ decide: () => 'PASS' });
      const runId = await l1Run(h);
      expect(await main(['baseline:accept', '--run', runId], h.deps)).toBe(0);
      const baseline = BaselineSchema.parse(JSON.parse(readFileSync(baselineFile(), 'utf8')));
      expect(baseline.judge).toEqual({ fingerprint: computeJudgeFingerprint(RUNNER_CONFIG.judge, judgedSuite()), agreement: null });
    });

    it('accepts a calibrated run with its agreement, and the diff against that baseline is not baseline-invalid', async () => {
      const agreement = agreementFor(judgedSuite());
      writeAgreementFile(dir, 'x-judged', agreement);
      const { h } = l1Harness({ decide: () => 'PASS' });
      const runId = await l1Run(h);
      expect(readRun(runId).judgeTrust).toMatchObject({ trusted: true, reason: 'calibrated' });
      expect(await main(['baseline:accept', '--run', runId], h.deps)).toBe(0);
      const baseline = BaselineSchema.parse(JSON.parse(readFileSync(baselineFile(), 'utf8')));
      expect(baseline.judge.agreement).toEqual(agreement);
      expect(await main(['diff', '--run', runId], h.deps)).toBe(0);
      expect(readRun(runId).diff!.outcome).not.toBe('baseline-invalid');
    });

    it('refuses a run whose pin differs from the current fingerprint (edited guidance)', async () => {
      const { h, setSuite } = l1Harness({ decide: () => 'PASS' });
      const runId = await l1Run(h);
      setSuite(judgedSuite({ guidance: 'Edited guidance.' }));
      expect(await main(['baseline:accept', '--run', runId], h.deps)).toBe(1);
      expect(h.err).toEqual([`[suite] baseline:accept refused run ${runId}:`, '[suite]   - judge fingerprint of the run differs from the current one']);
      expect(existsSync(baselineFile())).toBe(false);
    });

    it('refuses an unpinned run: the called model is not the pin', async () => {
      const { h } = l1Harness({ env: { SIM_JUDGE_MODEL: OTHER_MODEL }, decide: () => 'PASS' });
      const runId = await l1Run(h, ['--allow-unpinned-judge']);
      expect(await main(['baseline:accept', '--run', runId], h.deps)).toBe(1);
      expect(h.err).toContain(`[suite]   - run called judge model ${OTHER_MODEL}, not the pinned gpt-4o`);
      expect(existsSync(baselineFile())).toBe(false);
    });
  });
});

describe('suite:diff', () => {
  const reportPath = (runId: string) => join(dir, 'runs', 'suites', runId, 'report.json');
  const readReport = (runId: string) => SuiteRunReportSchema.parse(JSON.parse(readFileSync(reportPath(runId), 'utf8')));

  async function acceptedRun(h: Harness): Promise<string> {
    expect(await main(['run', '--suite', 'x-suite', '--level', 'L0'], h.deps)).toBe(0);
    const runId = runDirs()[0]!;
    expect(await main(['baseline:accept', '--run', runId], h.deps)).toBe(0);
    return runId;
  }

  /** Rewrites one result of a run report on disk. */
  function setStatus(runId: string, key: string, status: 'PASS' | 'FAIL' | 'ERROR', passCount: number): void {
    const report = JSON.parse(readFileSync(reportPath(runId), 'utf8'));
    report.results[key] = { ...report.results[key], status, passCount };
    writeFileSync(reportPath(runId), JSON.stringify(report));
  }

  it('writes the diff into report.json and report.md and prints lost-coverage first', async () => {
    const h = harness();
    const runId = await acceptedRun(h);
    setStatus(runId, 'X-01.A1/X-01.C1', 'ERROR', 0);
    setStatus(runId, 'X-02/X-02.C1', 'FAIL', 0);
    h.out.length = 0;

    expect(await main(['diff', '--run', runId], h.deps)).toBe(1);
    expect(h.err).toEqual([]);
    const report = readReport(runId);
    expect(report.diff).toMatchObject({
      outcome: 'failed',
      exitCode: 1,
      baseline: { kind: 'default', ref: null, path: join('baselines', 'x-suite', 'L0.json'), missing: false },
      acceptedFrom: { runId },
    });
    expect(report.diff!.tests.counts).toMatchObject({ 'lost-coverage': 1, regressed: 1 });
    expect(readFileSync(join(dir, 'runs', 'suites', runId, 'report.md'), 'utf8')).toContain('## Diff');

    const categoryLines = h.out.filter((line) => /^\[suite\] diff (tests|journeys) [a-z-]+ /.test(line));
    expect(categoryLines[0]).toMatch(/^\[suite\] diff tests lost-coverage X-01\.A1\/X-01\.C1 /);
    expect(categoryLines[1]).toMatch(/^\[suite\] diff tests regressed X-02\/X-02\.C1 /);
    expect(h.out).toContain('[suite] diff outcome: failed (exit 1)');

    // A second diff replaces the first.
    expect(await main(['diff', '--run', runId, '--baseline', join('baselines', 'x-suite', 'L0.json')], h.deps)).toBe(1);
    expect(readReport(runId).diff!.baseline.kind).toBe('path');
  });

  it('exits 0 with every pair new when the default baseline is absent', async () => {
    const h = harness();
    expect(await main(['run', '--suite', 'x-suite', '--level', 'L0'], h.deps)).toBe(0);
    const runId = runDirs()[0]!;
    expect(await main(['diff', '--run', runId], h.deps)).toBe(0);
    expect(h.out).toContain(`[suite] diff: no baseline at ${join('baselines', 'x-suite', 'L0.json')}; every pair is new`);
    const diff = readReport(runId).diff!;
    expect(diff).toMatchObject({ outcome: 'no-baseline', exitCode: 0, baseline: { missing: true } });
    expect(diff.tests.entries.every((entry) => entry.category === 'new')).toBe(true);
  });

  it('exits 2 for an explicit --baseline that is missing or invalid, and when provenance differs', async () => {
    const h = harness();
    const runId = await acceptedRun(h);
    expect(await main(['diff', '--run', runId, '--baseline', 'nope.json'], h.deps)).toBe(2);
    expect(h.out).toContain('[suite] diff: baseline-invalid: baseline file nope.json not found');
    expect(readReport(runId).diff).toMatchObject({ outcome: 'baseline-invalid', baseline: { kind: 'path', missing: true } });

    writeFileSync(join(dir, 'broken.json'), '{ nope');
    expect(await main(['diff', '--run', runId, '--baseline', 'broken.json'], h.deps)).toBe(2);
    expect(readReport(runId).diff!.reasons[0]).toMatch(/^baseline broken.json is not valid JSON/);

    const path = join(dir, 'baselines', 'x-suite', 'L0.json');
    const baseline = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...baseline, coach: { model: 'gpt-4o' } }));
    expect(await main(['diff', '--run', runId], h.deps)).toBe(2);
    const diff = readReport(runId).diff!;
    expect(diff).toMatchObject({ outcome: 'baseline-invalid', exitCode: 2, tests: { entries: [] } });
    expect(diff.reasons).toEqual(["baseline coach model gpt-4o differs from the run's null"]);
  });

  it('exits 3 on judge errors and 4 on budget-exceeded', async () => {
    const h = harness();
    const runId = await acceptedRun(h);
    const report = JSON.parse(readFileSync(reportPath(runId), 'utf8'));
    writeFileSync(reportPath(runId), JSON.stringify({ ...report, judgeErrors: [{ key: 'X-01.A1/X-01.C1', reason: 'judge-timeout' }] }));
    expect(await main(['diff', '--run', runId], h.deps)).toBe(3);
    const key = 'X-01.A1/X-01.C1';
    writeFileSync(
      reportPath(runId),
      JSON.stringify({ ...report, results: { ...report.results, [key]: { ...report.results[key], status: 'ERROR', passCount: 0, reason: 'budget-exceeded' } } }),
    );
    expect(await main(['diff', '--run', runId], h.deps)).toBe(4);
    expect(h.out).toContain('[suite] diff outcome: budget-exceeded (exit 4)');
  });

  it('exits 1 and writes nothing on usage errors and an unknown or invalid run', async () => {
    const h = harness();
    expect(await main(['diff'], h.deps)).toBe(1);
    expect(h.err[0]).toBe('[suite] diff: --run <runId> is required');
    expect(await main(['diff', '--run', 'r1', '--baseline', 'b.json', '--merge-base'], h.deps)).toBe(1);
    expect(await main(['diff', '--run', 'nope'], h.deps)).toBe(1);
    expect(h.err).toContain('[suite] diff: run nope not found under runs/suites/');
    mkdirSync(join(dir, 'runs', 'suites', 'broken'), { recursive: true });
    writeFileSync(join(dir, 'runs', 'suites', 'broken', 'report.json'), '{"schemaVersion": 2}');
    expect(await main(['diff', '--run', 'broken'], h.deps)).toBe(1);
    expect(h.err.at(-1)).toMatch(/^\[suite\] diff: run broken: report.json is invalid/);
    expect(existsSync(join(dir, 'runs', 'suites', 'broken', 'report.md'))).toBe(false);
    expect(runDirs()).toEqual(['broken']);
  });

  it('exits 2 when git cannot resolve the merge-base', async () => {
    const h = harness();
    expect(await main(['run', '--suite', 'x-suite', '--level', 'L0'], h.deps)).toBe(0);
    const runId = runDirs()[0]!;
    h.deps.mergeBase = () => {
      throw new Error('[suite] git merge-base HEAD origin/main failed (no merge base)');
    };
    expect(await main(['diff', '--run', runId, '--merge-base'], h.deps)).toBe(2);
    expect(readReport(runId).diff).toMatchObject({
      outcome: 'baseline-invalid',
      reasons: ['git merge-base HEAD origin/main failed (no merge base)'],
      baseline: { kind: 'merge-base', ref: null },
    });
  });
});

describe('suite:diff --merge-base in a real git repo', () => {
  let root: string;
  const git = (...args: string[]) => {
    const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], {
      cwd: root,
      encoding: 'utf8',
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'suite-git-'));
    rmSync(dir, { recursive: true, force: true });
    dir = join(root, 'packages', 'conversation-sim');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'suite.config.json'), JSON.stringify(RUNNER_CONFIG));
    writeFileSync(join(root, '.gitignore'), 'runs/\n');
    git('init', '-q', '-b', 'main');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reads baseline A from the merge-base, not working-tree baseline B', async () => {
    const h = harness();
    expect(await main(['run', '--suite', 'x-suite', '--level', 'L0'], h.deps)).toBe(0);
    const runId = runDirs()[0]!;
    const path = join(dir, 'baselines', 'x-suite', 'L0.json');

    // No baseline at the merge-base yet: every pair is new, exit 0.
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    expect(await main(['diff', '--run', runId, '--merge-base'], h.deps)).toBe(0);
    expect(readFileSync(join(dir, 'runs', 'suites', runId, 'report.json'), 'utf8')).toContain('"outcome": "no-baseline"');

    // Baseline A (accepted from the run itself) at origin/main.
    expect(await main(['baseline:accept', '--run', runId], h.deps)).toBe(0);
    git('add', '.');
    git('commit', '-q', '-m', 'baseline A');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    const mergeBase = git('rev-parse', 'HEAD');

    // Baseline C committed on HEAD after the merge-base, so merge-base != HEAD.
    const committed = JSON.parse(readFileSync(path, 'utf8'));
    committed.results['X-02/X-02.C1'] = { ...committed.results['X-02/X-02.C1'], status: 'FAIL', passCount: 0 };
    writeFileSync(path, JSON.stringify(committed));
    git('commit', '-q', '-am', 'baseline C');
    expect(git('rev-parse', 'HEAD')).not.toBe(mergeBase);

    // Working-tree baseline B: X-01.A1/X-01.C1 was FAIL, which would make the run `fixed`.
    const baseline = JSON.parse(readFileSync(path, 'utf8'));
    baseline.results['X-01.A1/X-01.C1'] = { ...baseline.results['X-01.A1/X-01.C1'], status: 'FAIL', passCount: 0 };
    writeFileSync(path, JSON.stringify(baseline));

    expect(await main(['diff', '--run', runId], h.deps)).toBe(0);
    const fromTree = SuiteRunReportSchema.parse(JSON.parse(readFileSync(join(dir, 'runs', 'suites', runId, 'report.json'), 'utf8'))).diff!;
    // B builds on C, so both changed keys are `fixed` against the working tree.
    expect(fromTree.tests.counts.fixed).toBe(2);

    expect(await main(['diff', '--run', runId, '--merge-base'], h.deps)).toBe(0);
    const diff = SuiteRunReportSchema.parse(JSON.parse(readFileSync(join(dir, 'runs', 'suites', runId, 'report.json'), 'utf8'))).diff!;
    expect(diff.baseline).toEqual({
      kind: 'merge-base',
      ref: mergeBase,
      path: 'packages/conversation-sim/baselines/x-suite/L0.json',
      missing: false,
    });
    expect(diff.tests.counts.fixed).toBe(0);
    expect(diff.tests.entries.every((entry) => entry.category === 'unchanged')).toBe(true);
  });

  it('exits 2 when the real git merge-base fails (no origin/main)', async () => {
    const h = harness();
    expect(await main(['run', '--suite', 'x-suite', '--level', 'L0'], h.deps)).toBe(0);
    const runId = runDirs()[0]!;
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    expect(await main(['diff', '--run', runId, '--merge-base'], h.deps)).toBe(2);
    const diff = SuiteRunReportSchema.parse(JSON.parse(readFileSync(join(dir, 'runs', 'suites', runId, 'report.json'), 'utf8'))).diff!;
    expect(diff.outcome).toBe('baseline-invalid');
    expect(diff.reasons.some((reason) => reason.includes('git merge-base HEAD origin/main failed'))).toBe(true);
  });
});

describe('suite:calibrate', () => {
  const labelsFile = () => join(dir, 'calibration', 'x-suite', 'labels.json');
  const agreementFile = () => join(dir, 'calibration', 'x-suite', 'agreement.json');
  const exportFile = () => join(dir, 'qa', 'export.json');
  // X-01.C1 is meaning-judged only in X-01.J at reply:2: user, coach, user, coach.
  const DIALOGUE = [
    { role: 'user', text: 'Hi.' },
    { role: 'coach', text: 'Hello. What is on your plate?' },
    { role: 'user', text: 'Two releases this week.' },
    { role: 'coach', text: 'Got it. Which deadline is first?' },
    { role: 'user', text: 'The API one.' },
    { role: 'coach', text: 'Good. What would make it easier?' },
  ] as const;

  function writeExport(statuses: Array<{ criterionId: string; status: 'PASS' | 'FAIL'; replyIndex: number | null }>, ref = 'qa-session-1'): void {
    mkdirSync(join(dir, 'qa'), { recursive: true });
    writeFileSync(
      exportFile(),
      JSON.stringify({
        schemaVersion: 1,
        sessions: [{ ref, labeler: 'qa-anna', labeledAt: '2026-10-20T09:00:00.000Z', dialogue: DIALOGUE, statuses }],
      }),
    );
  }

  function labelsOnDisk() {
    return LabelsFileSchema.parse(JSON.parse(readFileSync(labelsFile(), 'utf8')));
  }

  /** A harness whose calibration judge is a fake (no model) answering by `decide`. */
  function judged(decide: (input: JudgeInput) => 'PASS' | 'FAIL' | 'reject', suite?: () => LoadedSuite) {
    const h = harness({ env: { INIT_CWD: dir } });
    const fake = fakeJudge(decide);
    const configs: unknown[] = [];
    const callOptions: unknown[] = [];
    h.deps.createCalibrationJudge = (judge, options) => {
      configs.push(judge);
      callOptions.push(options);
      return fake.judge;
    };
    if (suite) h.deps.loadSuite = () => suite();
    return { h, fake, configs, callOptions };
  }

  it('builds the calibration judge with budgets.judgeCallTimeoutMs from the config', async () => {
    writeFileSync(join(dir, 'suite.config.json'), JSON.stringify({ ...RUNNER_CONFIG, budgets: { ...RUNNER_CONFIG.budgets, judgeCallTimeoutMs: 1234 } }));
    writeExport([twoStatuses[0]!]);
    const { h, callOptions } = judged(() => 'PASS');
    expect(await main(['calibrate', '--suite', 'x-suite', '--import', 'qa/export.json'], h.deps)).toBe(0);
    expect(callOptions).toEqual([{ callTimeoutMs: 1234 }]);
  });

  const twoStatuses = [
    { criterionId: 'X-01.C1', status: 'PASS' as const, replyIndex: 3 },
    { criterionId: 'X-01.C1', status: 'FAIL' as const, replyIndex: 5 },
  ];

  it('imports a new export: labels file created with truncated transcripts and qa-session provenance', async () => {
    writeExport(twoStatuses);
    const h = harness({ env: { INIT_CWD: dir } });
    expect(await main(['calibrate', '--suite', 'x-suite', '--import', 'qa/export.json'], h.deps)).toBe(0);
    const { labels } = labelsOnDisk();
    expect(labels).toHaveLength(2);
    expect(labels[0]).toEqual({
      criterionId: 'X-01.C1',
      status: 'PASS',
      transcript: { turns: DIALOGUE.slice(0, 4), evaluatedReplyIndex: 3 },
      source: { kind: 'qa-session', ref: 'qa-session-1' },
      labeler: 'qa-anna',
      labeledAt: '2026-10-20T09:00:00.000Z',
    });
    expect(labels[1]!.transcript.turns).toHaveLength(6);
    expect(h.out).toContain('[suite] import: 2 label(s) added, 0 duplicate(s) skipped; calibration/x-suite/labels.json has 2 label(s)');
    expect(h.out.some((line) => line.includes('calibration skipped') && line.includes('suite:calibrate:live'))).toBe(true);
    expect(existsSync(agreementFile())).toBe(false);
  });

  it('leaves the file unchanged on a repeated import, with one skip warning per label', async () => {
    writeExport(twoStatuses);
    const h = harness({ env: { INIT_CWD: dir } });
    expect(await main(['calibrate', '--suite', 'x-suite', '--import', 'qa/export.json'], h.deps)).toBe(0);
    const before = readFileSync(labelsFile(), 'utf8');
    expect(await main(['calibrate', '--suite', 'x-suite', '--import', 'qa/export.json'], h.deps)).toBe(0);
    expect(readFileSync(labelsFile(), 'utf8')).toBe(before);
    expect(h.out.filter((line) => line.startsWith('[suite] warning: skipped duplicate label'))).toHaveLength(2);
  });

  it('keeps the existing label on a conflicting duplicate and names both statuses', async () => {
    writeExport([twoStatuses[0]!]);
    const h = harness({ env: { INIT_CWD: dir } });
    expect(await main(['calibrate', '--suite', 'x-suite', '--import', 'qa/export.json'], h.deps)).toBe(0);
    writeExport([{ ...twoStatuses[0]!, status: 'FAIL' }], 'qa-session-2');
    expect(await main(['calibrate', '--suite', 'x-suite', '--import', exportFile()], h.deps)).toBe(0);
    const { labels } = labelsOnDisk();
    expect(labels.map((entry) => [entry.status, entry.source.ref])).toEqual([['PASS', 'qa-session-1']]);
    expect(h.out).toContainEqual(expect.stringMatching(/from session qa-session-2 .*the export says FAIL, the kept label says PASS/));
  });

  it.each([
    ['replyIndex on a user turn', { criterionId: 'X-01.C1', status: 'PASS' as const, replyIndex: 2 }, /session qa-session-1, X-01\.C1: .*coach turn/],
    ['an unknown criterion', { criterionId: 'X-09.C1', status: 'PASS' as const, replyIndex: 3 }, /session qa-session-1, X-09\.C1: unknown-criterion/],
  ])('rejects a bad export (%s) and writes nothing', async (_name, bad, message) => {
    writeExport([twoStatuses[0]!, bad]);
    const h = harness({ env: { INIT_CWD: dir } });
    expect(await main(['calibrate', '--suite', 'x-suite', '--import', 'qa/export.json'], h.deps)).toBe(1);
    expect(h.err.join('\n')).toMatch(message);
    expect(h.err).toContain('[suite] import: rejected; nothing was written');
    expect(existsSync(join(dir, 'calibration'))).toBe(false);
  });

  it('exits 1 on an unreadable export', async () => {
    const h = harness({ env: { INIT_CWD: dir } });
    expect(await main(['calibrate', '--suite', 'x-suite', '--import', 'missing.json'], h.deps)).toBe(1);
    expect(h.err[0]).toMatch(/\[suite\] import: cannot read missing\.json as JSON/);
  });

  it('calibrates with agreement 1 when the judge matches every label; the judge got buildJudgeInput inputs', async () => {
    writeExport([twoStatuses[0]!]);
    const { h, fake, configs } = judged(() => 'PASS');
    expect(await main(['calibrate', '--suite', 'x-suite', '--import', 'qa/export.json'], h.deps)).toBe(0);
    expect(configs).toEqual([RUNNER_CONFIG.judge]);

    const suite = fakeSuite();
    const journey = suite.tests.find((test) => test.id === 'X-01.J')!;
    const run = syntheticRun('X-01.J', ['Hello. What is on your plate?', 'Got it. Which deadline is first?']);
    run.steps[0]!.userText = 'Hi.';
    run.steps[1]!.userText = 'Two releases this week.';
    const c1 = journey.criteria.find((criterion) => criterion.id === 'X-01.C1')!;
    expect(fake.inputs).toEqual([buildJudgeInput(journey, run, c1).input]);

    const agreement = AgreementFileSchema.parse(JSON.parse(readFileSync(agreementFile(), 'utf8')));
    expect(agreement.overall).toBe(1);
    expect(agreement.perLayer.P).toEqual({ n: 1, overall: 1, kappa: null });
    expect(agreement.fingerprint).toEqual(computeJudgeFingerprint(RUNNER_CONFIG.judge, suite));
    expect(agreement.labelsSha256).toBe(labelsSha256(labelsOnDisk().labels));
    expect(agreement.computedAt).toBe('2026-10-25T10:00:00.000Z');
    expect(h.out).toContain('[suite] agreement: calibration/x-suite/agreement.json');
    expect(h.out.filter((line) => line.startsWith('[suite] disagreement:'))).toEqual([]);
  });

  it('prints a disagreement line when the judge FAILs a PASS label', async () => {
    writeExport(twoStatuses);
    const { h } = judged(() => 'FAIL');
    expect(await main(['calibrate', '--suite', 'x-suite', '--import', 'qa/export.json'], h.deps)).toBe(0);
    const agreement = AgreementFileSchema.parse(JSON.parse(readFileSync(agreementFile(), 'utf8')));
    expect(agreement.overall).toBe(0.5);
    expect(h.out.filter((line) => line.startsWith('[suite] disagreement:'))).toEqual([
      '[suite] disagreement: X-01.C1 label PASS judge FAIL ref qa-session-1 labeledAt 2026-10-20T09:00:00.000Z: judged FAIL',
    ]);
    expect(h.out).toContain('[suite] judge usage: 2 calls, 20 input tokens, 10 output tokens, 30 total tokens');
  });

  it('counts a rejecting judge as a disagreement, still writes the file and exits 3', async () => {
    writeExport(twoStatuses);
    const h = harness({ env: { INIT_CWD: dir } });
    expect(await main(['calibrate', '--suite', 'x-suite', '--import', 'qa/export.json'], h.deps)).toBe(0);
    let call = 0;
    const { h: judgedHarness } = judged(() => (call++ === 0 ? 'reject' : 'FAIL'));
    expect(await main(['calibrate', '--suite', 'x-suite'], judgedHarness.deps)).toBe(3);
    const agreement = AgreementFileSchema.parse(JSON.parse(readFileSync(agreementFile(), 'utf8')));
    expect(agreement.n).toBe(2);
    expect(agreement.overall).toBe(0.5);
    expect(judgedHarness.out).toContainEqual(expect.stringMatching(/^\[suite\] disagreement: X-01\.C1 label PASS judge ERROR .*: judge-transport: /));
    expect(judgedHarness.err).toContain('[suite] calibrate: 1 label(s) judged ERROR (counted as disagreements)');
  });

  it('warns below minLabels and still writes the file', async () => {
    writeExport([...twoStatuses, { criterionId: 'X-01.C1', status: 'PASS', replyIndex: 1 }]);
    const { h } = judged((input) => (input.transcript.evaluatedReplyIndex === 5 ? 'FAIL' : 'PASS'));
    expect(await main(['calibrate', '--suite', 'x-suite', '--import', 'qa/export.json'], h.deps)).toBe(0);
    expect(h.out).toContain('[suite] warning: 3 labels is below minLabels 40');
    expect(AgreementFileSchema.parse(JSON.parse(readFileSync(agreementFile(), 'utf8')))).toMatchObject({ n: 3, overall: 1 });
  });

  it('writes n 0 with null agreement and a warning when there is no labels file', async () => {
    const { h, fake } = judged(() => 'PASS');
    expect(await main(['calibrate', '--suite', 'x-suite'], h.deps)).toBe(0);
    const agreement = AgreementFileSchema.parse(JSON.parse(readFileSync(agreementFile(), 'utf8')));
    expect(agreement).toMatchObject({ n: 0, overall: null, kappa: null });
    expect(Object.values(agreement.perLayer)).toEqual(Array(4).fill({ n: 0, overall: null, kappa: null }));
    expect(h.out).toContain('[suite] warning: 0 labels is below minLabels 40');
    expect(fake.inputs).toEqual([]);
    expect(existsSync(labelsFile())).toBe(false);
  });

  it('refuses an ambiguous label context before any judge call', async () => {
    const ambiguous = () => {
      const modules = validModules();
      const atomic = modules.tests[0] as { criteria: Array<Record<string, unknown>> };
      atomic.criteria[0] = { ...atomic.criteria[0], checks: [{ type: 'rule', rule: 'events-only' }, { type: 'meaning' }], judgeGuidance: 'Atomic guidance.' };
      return validateSuite('x-suite', modules, TEST_RULES);
    };
    mkdirSync(join(dir, 'calibration', 'x-suite'), { recursive: true });
    writeFileSync(
      labelsFile(),
      JSON.stringify({
        schemaVersion: 1,
        labels: [
          {
            criterionId: 'X-01.C1',
            status: 'PASS',
            transcript: { turns: DIALOGUE.slice(0, 4), evaluatedReplyIndex: 3 },
            source: { kind: 'suite-run', ref: 'run-1' },
            labeler: 'qa-anna',
            labeledAt: '2026-10-20T09:00:00.000Z',
          },
        ],
      }),
    );
    const { h, fake } = judged(() => 'PASS', ambiguous);
    expect(await main(['calibrate', '--suite', 'x-suite'], h.deps)).toBe(1);
    expect(h.err.join('\n')).toMatch(/X-01\.C1 \(run-1\): ambiguous-context: X-01\.C1 is judged with a different judgeGuidance/);
    expect(fake.inputs).toEqual([]);
    expect(existsSync(agreementFile())).toBe(false);
  });

  it('exits 1 on an invalid labels file', async () => {
    mkdirSync(join(dir, 'calibration', 'x-suite'), { recursive: true });
    writeFileSync(labelsFile(), JSON.stringify({ schemaVersion: 1, labels: [{ criterionId: 'X-01.C1', status: 'MAYBE' }] }));
    const { h } = judged(() => 'PASS');
    expect(await main(['calibrate', '--suite', 'x-suite'], h.deps)).toBe(1);
    expect(h.err[0]).toMatch(/x-suite labels are invalid at labels\.0/);
  });

  it('without a judge, exits 1 with the suite:calibrate:live hint and writes nothing', async () => {
    const h = harness();
    expect(await main(['calibrate', '--suite', 'x-suite'], h.deps)).toBe(1);
    expect(h.err.some((line) => line.includes('pnpm suite:calibrate:live --suite x-suite --live-judge'))).toBe(true);
    expect(existsSync(join(dir, 'calibration'))).toBe(false);
    expect(runDirs()).toEqual([]);
  });

  it('builds the judge before importing, so a failing factory exits 1 with nothing written', async () => {
    writeExport(twoStatuses);
    const h = harness({ env: { INIT_CWD: dir } });
    h.deps.createCalibrationJudge = () => {
      throw new Error('[suite] live judge: OPENAI_API_KEY is required');
    };
    expect(await main(['calibrate', '--suite', 'x-suite', '--import', 'qa/export.json'], h.deps)).toBe(1);
    expect(h.err).toContain('[suite] live judge: OPENAI_API_KEY is required');
    expect(existsSync(join(dir, 'calibration'))).toBe(false);
  });

  it('exits 1 on an unknown suite', async () => {
    const { h } = judged(() => 'PASS');
    expect(await main(['calibrate', '--suite', 'nope'], h.deps)).toBe(1);
    expect(h.err[0]).toMatch(/unknown suite nope/);
  });

  it('never prints environment values', async () => {
    writeExport(twoStatuses);
    const h = harness({ env: { INIT_CWD: dir, OPENAI_API_KEY: SECRET } });
    h.deps.createCalibrationJudge = () => fakeJudge(() => 'PASS').judge;
    expect(await main(['calibrate', '--suite', 'x-suite', '--import', 'qa/export.json'], h.deps)).toBe(0);
    expect([...h.out, ...h.err].join('\n')).not.toContain(SECRET);
  });
});

describe('suite:ci', () => {
  const summaryFile = () => join(dir, 'out', 'summary.md');
  const writeConfig = (suites: string[]) => writeFileSync(join(dir, 'suite.config.json'), JSON.stringify({ ...RUNNER_CONFIG, suites }));
  const xTwo = () => validateSuite('x-two', validModules(), TEST_RULES);

  /** Harness whose loader also knows `x-two` and whose merge-base reader serves `files[suiteId]`. */
  function ciHarness(files: Record<string, string | null> = {}, executor?: () => SuiteExecutor): Harness {
    const h = harness(executor ? { executor } : {});
    const load = h.deps.loadSuite;
    h.deps.loadSuite = (id) => (id === 'x-two' ? xTwo() : load(id));
    h.deps.mergeBase = (path) => {
      const suiteId = path.split(/[\\/]/)[1]!;
      return { ref: 'base0000', path: `packages/conversation-sim/${path}`, text: files[suiteId] ?? null };
    };
    return h;
  }

  it('aggregates exit codes by precedence 2 > 3 > 4 > 1', () => {
    expect(aggregateCiExitCode([])).toBe(0);
    expect(aggregateCiExitCode([0, 0])).toBe(0);
    expect(aggregateCiExitCode([1, 4])).toBe(4);
    expect(aggregateCiExitCode([1, 4, 3])).toBe(3);
    expect(aggregateCiExitCode([3, 1, 2, 4])).toBe(2);
    expect(aggregateCiExitCode([0, 1])).toBe(1);
  });

  it('skips every empty registered suite, writes the summary and exits 0 with no run folder', async () => {
    writeConfig(['p-v1', 'smoke-v1']);
    const h = ciHarness();
    expect(await main(['ci', '--level', 'L0', '--summary', summaryFile()], h.deps)).toBe(0);
    expect(h.err).toEqual([]);
    expect(h.out).toEqual([
      '[suite] ci: p-v1 skipped (no tests)',
      '[suite] ci: smoke-v1 skipped (no tests)',
      '[suite] ci: no registered suite has tests; L0 gate passes with nothing to check',
      '[suite] ci: L0 gate exit 0',
    ]);
    const summary = readFileSync(summaryFile(), 'utf8');
    expect(summary).toContain('No registered suite has tests; L0 gate passes with nothing to check.');
    expect(summary).toContain('- p-v1: skipped (no tests)');
    expect(summary).toContain('- smoke-v1: skipped (no tests)');
    expect(runDirs()).toEqual([]);

    // Appends, never truncates.
    expect(await main(['ci', '--level', 'L0', '--summary', summaryFile()], h.deps)).toBe(0);
    expect(readFileSync(summaryFile(), 'utf8')).toBe(summary + summary);
  });

  it('runs and merge-base-diffs a suite with tests and summarizes layers, verdict and diff', async () => {
    writeConfig(['p-v1', 'smoke-v1', 'x-suite']);
    const h = ciHarness();
    expect(await main(['ci', '--level', 'L0', '--summary', summaryFile()], h.deps)).toBe(0);
    expect(h.err).toEqual([]);
    const [runId] = runDirs();
    expect(runDirs()).toHaveLength(1);
    const report = SuiteRunReportSchema.parse(JSON.parse(readFileSync(join(dir, 'runs', 'suites', runId!, 'report.json'), 'utf8')));
    expect(report.diff).toMatchObject({ outcome: 'no-baseline', exitCode: 0, baseline: { kind: 'merge-base', ref: 'base0000', missing: true } });
    expect(h.out).toContain('[suite] ci: x-suite exit 0');
    const summary = readFileSync(summaryFile(), 'utf8');
    expect(summary).not.toContain('nothing to check');
    expect(summary).toContain(`- x-suite: ran (exit 0), run ${runId}`);
    expect(summary).toContain(`### x-suite L0 — ${runId}`);
    expect(summary).toContain('| P+D+C |');
    expect(summary).toMatch(/- Verdict: \*\*[A-Z ]+\*\*/);
    expect(summary).toContain('- Diff: **no-baseline** (exit 0)');
    expect(summary).toContain('- Baseline: merge-base packages/conversation-sim/baselines/x-suite/L0.json at base0000 (missing)');
    expect(summary).toMatch(/\*\*Tests:\*\* lost-coverage 0 · regressed 0 · fixed 0 · gained-coverage 0 · new \d+/);
    expect(summary).toContain('| new | X-01.A1/X-01.C1 |');
  });

  it('exits 1 on a regression and lists the gating entry, and keeps run ids unique', async () => {
    writeConfig(['p-v1', 'smoke-v1', 'x-suite']);
    let failing = false;
    const executor = () =>
      fakeExecutor((test, attempt) =>
        cleanRun(test, attempt, failing && test.id === 'X-02' ? [{ kind: 'product', step: 0, reason: 'scripted-output-missing:1', message: '' }] : []),
      );
    const seed = harness({ executor });
    expect(await main(['run', '--suite', 'x-suite', '--level', 'L0'], seed.deps)).toBe(0);
    const seedRun = runDirs()[0]!;
    expect(await main(['baseline:accept', '--run', seedRun], seed.deps)).toBe(0);
    const baseline = readFileSync(join(dir, 'baselines', 'x-suite', 'L0.json'), 'utf8');

    failing = true;
    const h = ciHarness({ 'x-suite': baseline }, executor);
    expect(await main(['ci', '--level', 'L0', '--summary', summaryFile()], h.deps)).toBe(1);
    const runs = runDirs();
    expect(runs).toHaveLength(2);
    expect(new Set(runs).size).toBe(2);
    const summary = readFileSync(summaryFile(), 'utf8');
    expect(summary).toContain('- Diff: **failed** (exit 1)');
    expect(summary).toContain('| lost-coverage | X-02/X-02.C1 | P | rule | yes |');
    expect(summary).toContain('Gate exit code: **1**');
  });

  it('attempts every suite and exits with the highest-precedence code (1 and 2 -> 2)', async () => {
    writeConfig(['x-suite', 'x-two']);
    const seed = harness();
    expect(await main(['run', '--suite', 'x-suite', '--level', 'L0'], seed.deps)).toBe(0);
    expect(await main(['baseline:accept', '--run', runDirs()[0]!], seed.deps)).toBe(0);
    const baseline = readFileSync(join(dir, 'baselines', 'x-suite', 'L0.json'), 'utf8');

    // x-suite loses coverage of X-02 (exit 1); x-two's merge-base baseline is not JSON (exit 2).
    const executor = () =>
      fakeExecutor((test, attempt) =>
        cleanRun(test, attempt, test.id === 'X-02' ? [{ kind: 'product', step: 0, reason: 'scripted-output-missing:1', message: '' }] : []),
      );
    const h = ciHarness({ 'x-suite': baseline, 'x-two': '{ not json' }, executor);
    expect(await main(['ci', '--level', 'L0', '--summary', summaryFile()], h.deps)).toBe(2);
    expect(h.out).toContain('[suite] ci: x-suite exit 1');
    expect(h.out).toContain('[suite] ci: x-two exit 2');
    expect(h.out.at(-1)).toBe('[suite] ci: L0 gate exit 2');
    const summary = readFileSync(summaryFile(), 'utf8');
    expect(summary).toContain('- x-suite: ran (exit 1)');
    expect(summary).toContain('- x-two: ran (exit 2)');
    expect(summary).toContain('- Diff: **baseline-invalid** (exit 2)');
  });

  it('continues after a load failure and a run failure, counting each as 1', async () => {
    writeConfig(['p-v1', 'x-suite', 'x-two', 'smoke-v1']);
    const h = ciHarness();
    const load = h.deps.loadSuite;
    h.deps.loadSuite = (id) => {
      if (id === 'x-suite') throw new Error('[suite] x-suite: case X-01.A1 invalid at steps.0.text');
      return load(id);
    };
    expect(await main(['ci', '--level', 'L0', '--summary', summaryFile()], h.deps)).toBe(1);
    expect(h.err).toEqual(['[suite] ci: x-suite failed to load: [suite] x-suite: case X-01.A1 invalid at steps.0.text']);
    expect(h.out).toContain('[suite] ci: x-two exit 0');
    expect(h.out).toContain('[suite] ci: smoke-v1 skipped (no tests)');
    const summary = readFileSync(summaryFile(), 'utf8');
    expect(summary).toContain('- x-suite: failed (exit 1): [suite] x-suite: case X-01.A1 invalid at steps.0.text');
    expect(summary).toContain('- x-two: ran (exit 0)');

    const crashing = ciHarness({}, () => {
      throw new Error('executor boom');
    });
    writeConfig(['x-suite', 'x-two']);
    expect(await main(['ci', '--level', 'L0'], crashing.deps)).toBe(1);
    expect(crashing.err).toEqual(['[suite] ci: x-suite failed: executor boom', '[suite] ci: x-two failed: executor boom']);
  });

  it('refuses a non-L0 level and a bad config, running nothing', async () => {
    const h = ciHarness();
    expect(await main(['ci', '--level', 'L1'], h.deps)).toBe(1);
    expect(h.err).toEqual([L1_REFUSAL]);
    writeFileSync(join(dir, 'suite.config.json'), '{ not json');
    expect(await main(['ci', '--level', 'L0'], h.deps)).toBe(1);
    expect(h.err.at(-1)).toMatch(/^\[suite\] config: /);
    expect(runDirs()).toEqual([]);
  });

  it('raises the exit code to 1 when the step summary cannot be appended', async () => {
    writeConfig(['p-v1']);
    writeFileSync(join(dir, 'plain-file'), 'x');
    const h = ciHarness();
    expect(await main(['ci', '--level', 'L0', '--summary', join(dir, 'plain-file', 'summary.md')], h.deps)).toBe(1);
    expect(h.err).toHaveLength(1);
    expect(h.err[0]).toMatch(/^\[suite\] ci: could not append the step summary: /);
    expect(h.out.at(-1)).toBe('[suite] ci: L0 gate exit 1');
  });

  it('resolves a relative --summary against INIT_CWD', async () => {
    writeConfig(['p-v1']);
    const h = ciHarness();
    h.deps.env.INIT_CWD = join(dir, 'root');
    expect(await main(['ci', '--level', 'L0', '--summary', 'nested/summary.md'], h.deps)).toBe(0);
    expect(readFileSync(join(dir, 'root', 'nested', 'summary.md'), 'utf8')).toContain('nothing to check');
  });
});

describe('readMergeBaseFile under a detached-HEAD full clone', () => {
  let root: string;
  const gitIn = (cwd: string, ...args: string[]) => {
    const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], {
      cwd,
      encoding: 'utf8',
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'suite-clone-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reads the baseline at the base-branch tip the PR merge commit merges into', () => {
    const origin = join(root, 'origin');
    const pkg = join(origin, 'packages', 'conversation-sim');
    const baselineFile = join(pkg, 'baselines', 'smoke-v1', 'L0.json');
    mkdirSync(join(pkg, 'baselines', 'smoke-v1'), { recursive: true });
    writeFileSync(baselineFile, '{"version":"A"}\n');
    gitIn(origin, 'init', '-q', '-b', 'main');
    gitIn(origin, 'add', '.');
    gitIn(origin, 'commit', '-q', '-m', 'A');
    gitIn(origin, 'checkout', '-q', '-b', 'feature');
    writeFileSync(join(pkg, 'feature.txt'), 'feature\n');
    writeFileSync(baselineFile, '{"version":"PR"}\n');
    gitIn(origin, 'add', '.');
    gitIn(origin, 'commit', '-q', '-m', 'feature');
    gitIn(origin, 'checkout', '-q', 'main');
    writeFileSync(baselineFile, '{"version":"B"}\n');
    gitIn(origin, 'commit', '-q', '-am', 'B');
    const mainTip = gitIn(origin, 'rev-parse', 'HEAD');

    const clone = join(root, 'clone');
    gitIn(root, 'clone', '-q', '--no-local', origin, clone);
    gitIn(clone, 'checkout', '-q', '--detach', 'origin/main');
    // The PR merge commit, as actions/checkout checks out refs/pull/N/merge; keep the PR side of the conflict.
    gitIn(clone, 'merge', '-q', '--no-ff', '-X', 'theirs', 'origin/feature', '-m', 'merge');
    expect(spawnSync('git', ['symbolic-ref', '-q', 'HEAD'], { cwd: clone }).status).not.toBe(0);
    expect(readFileSync(join(clone, 'packages', 'conversation-sim', 'baselines', 'smoke-v1', 'L0.json'), 'utf8')).toContain('PR');

    const file = readMergeBaseFile(join(clone, 'packages', 'conversation-sim'), 'baselines/smoke-v1/L0.json');
    expect(file).toEqual({ ref: mainTip, path: 'packages/conversation-sim/baselines/smoke-v1/L0.json', text: '{"version":"B"}\n' });
  });
});

describe('suite:run at L1 with an injected L1 executor (Story 13.4)', () => {
  withoutLangwatchEnv();
  const COACH = 'openai:gpt-4o-test';
  const REPLY = 'Got it. Which deadline is first?';

  it('writes an L1 report with the coach model, judged meaning criteria, substituted state criteria and AI model events', async () => {
    let providers = 0;
    const h = harness({
      executor: () =>
        new L1OrchestratorExecutor({
          createAiProvider: () => {
            providers += 1;
            return new ScriptedAiProvider({ responses: [{ text: REPLY, confidence: 0.9, containsSurveyProbe: false }] });
          },
          coachModel: COACH,
        }),
    });
    const fake = fakeJudge(() => 'PASS');
    h.deps.createRunJudge = () => fake.judge;
    expect(await main(['run', '--suite', 'x-suite', '--level', 'L1'], h.deps)).toBe(0);
    expect(h.err).toEqual([]);

    const [runId] = runDirs();
    const report = SuiteRunReportSchema.parse(JSON.parse(readFileSync(join(dir, 'runs', 'suites', runId!, 'report.json'), 'utf8')));
    expect(report.level).toBe('L1');
    expect(report.models).toEqual({ coach: COACH, judge: 'gpt-4o' });
    // The atomic and the journey test declare L1; the observation test does not.
    expect(providers).toBe(2);
    expect(report.results['X-01.A1/X-01.C2']).toMatchObject({ method: 'substituted' });
    expect(report.results['X-01.J/X-01.C1']).toMatchObject({ status: 'PASS', checkKind: 'meaning', method: 'n/a' });
    expect(fake.inputs.length).toBeGreaterThan(0);
    for (const judged of fake.inputs) {
      expect(judged.transcript.turns[judged.transcript.evaluatedReplyIndex!]).toEqual({ role: 'coach', text: REPLY });
    }

    const caseRuns = JSON.parse(readFileSync(join(dir, 'runs', 'suites', runId!, 'case-runs.json'), 'utf8')) as {
      caseRuns: Array<{ run: { level: string; events: Array<{ port: string; model?: { name: string; request: unknown; response: unknown } }> } }>;
    };
    expect(caseRuns.caseRuns.map((entry) => entry.run.level)).toEqual(['L1', 'L1']);
    const aiEvents = caseRuns.caseRuns.flatMap((entry) => entry.run.events.filter((event) => event.port === 'aiProvider'));
    expect(aiEvents.length).toBeGreaterThan(0);
    for (const event of aiEvents) expect(event.model).toMatchObject({ name: COACH, request: expect.anything() });
    // No transcript text reaches the log.
    expect(h.out.join('\n')).not.toContain(REPLY);
  });
});

describe('budgets, usage and the L1 baseline path (Story 13.5)', () => {
  const COACH = 'fake-coach-model';
  const readRun = (runId: string) => SuiteRunReportSchema.parse(JSON.parse(readFileSync(join(dir, 'runs', 'suites', runId, 'report.json'), 'utf8')));
  const readMarkdown = (runId: string) => readFileSync(join(dir, 'runs', 'suites', runId, 'report.md'), 'utf8');
  const baselineFile = () => join(dir, 'baselines', 'x-judged', 'L1.json');

  function writeConfig(budgets: Partial<typeof RUNNER_CONFIG.budgets> = {}) {
    writeFileSync(
      join(dir, 'suite.config.json'),
      JSON.stringify({ ...RUNNER_CONFIG, suites: [...RUNNER_CONFIG.suites, 'x-judged'], budgets: { ...RUNNER_CONFIG.budgets, ...budgets } }),
    );
  }

  function l1Harness(options: { callsPerCase?: number } = {}) {
    const h = harness({ executor: () => budgetedExecutor({ callsPerCase: options.callsPerCase ?? 3, coachModel: COACH }) });
    const fallback = h.deps.loadSuite;
    h.deps.loadSuite = (id) => (id === 'x-judged' ? judgedSuite() : fallback(id));
    const fake = fakeJudge(() => 'PASS');
    const judgeOptions: unknown[] = [];
    h.deps.createRunJudge = (_judge, judgeCallOptions) => {
      judgeOptions.push(judgeCallOptions);
      return fake.judge;
    };
    return { h, fake, judgeOptions };
  }

  async function run(h: Harness, argv: string[], expected: number): Promise<string> {
    const before = new Set(runDirs());
    expect(await main(argv, h.deps)).toBe(expected);
    return runDirs().find((id) => !before.has(id))!;
  }

  it('exits 4 when the coach budget is exceeded, still writing the report and case runs', async () => {
    writeConfig({ maxCoachCallsPerRun: 4 });
    const { h } = l1Harness({ callsPerCase: 3 });
    const runId = await run(h, ['run', '--suite', 'x-judged', '--level', 'L1', '--runs', '3'], 4);
    expect(existsSync(join(dir, 'runs', 'suites', runId, 'case-runs.json'))).toBe(true);
    const report = readRun(runId);
    expect(report.provisional).toBe(true);
    expect(report.provisionalReason).toContain('budget exceeded: coach');
    expect(report.budget).toMatchObject({ coachCalls: 4, maxCoachCalls: 4, exceeded: ['coach'] });
    for (const key of ['Z-01.A1/Z-01.C1', 'Z-01.A1/Z-01.C3']) {
      expect(report.results[key]!.samples.slice(1).map((sample) => [sample.status, sample.reason]), key).toEqual([
        ['ERROR', 'budget-exceeded'],
        ['ERROR', 'budget-exceeded'],
      ]);
    }
    expect(h.out).toContain('[suite] budget exceeded: coach (coach 4/4, judge 3/150)');
    // The diff of that run also exits 4.
    expect(await main(['diff', '--run', runId], h.deps)).toBe(4);
  });

  it('exits 4 when the judge budget is exceeded; the refused criterion is not a judge error', async () => {
    writeConfig({ maxJudgeCallsPerRun: 2 });
    const { h } = l1Harness({ callsPerCase: 1 });
    const runId = await run(h, ['run', '--suite', 'x-judged', '--level', 'L1', '--runs', '2'], 4);
    const report = readRun(runId);
    expect(report.budget?.exceeded).toEqual(['judge']);
    expect(report.judgeErrors).toEqual([]);
    expect(report.results['Z-01.A1/Z-01.C4']!.samples[0]).toMatchObject({ status: 'ERROR', reason: 'budget-exceeded' });
  });

  it('shows coach and judge usage per model and the budget line in report.md; passes the judge call timeout', async () => {
    writeConfig({ judgeCallTimeoutMs: 4321 });
    const { h, judgeOptions } = l1Harness();
    const runId = await run(h, ['run', '--suite', 'x-judged', '--level', 'L1'], 0);
    expect(judgeOptions).toEqual([{ callTimeoutMs: 4321 }]);
    const report = readRun(runId);
    expect(report.usage.coachModelCalls).toBe(3);
    expect(report.modelUsage).toEqual([
      { role: 'coach', model: COACH, calls: 3, inputTokens: null, outputTokens: null, totalTokens: null },
      { role: 'judge', model: 'gpt-4o', calls: 3, inputTokens: 30, outputTokens: 15, totalTokens: 45 },
    ]);
    const markdown = readMarkdown(runId);
    expect(markdown).toContain(`| coach | ${COACH} | 3 | n/a | n/a | n/a |`);
    expect(markdown).toContain('| judge | gpt-4o | 3 | 30 | 15 | 45 |');
    expect(markdown).toContain('- Budget: coach 3/600, judge 3/150');
    expect(h.out.some((line) => line.startsWith('[suite] budget exceeded'))).toBe(false);
  });

  it('a five-sample L1 run is accepted as L1.json with judge and coach provenance and advisory per entry; four samples are refused', async () => {
    writeConfig();
    const { h } = l1Harness();
    const runId = await run(h, ['run', '--suite', 'x-judged', '--level', 'L1', '--runs', '5'], 0);
    const report = readRun(runId);
    for (const [key, result] of Object.entries(report.results)) {
      expect(result.n, key).toBe(5);
      expect(result.samples, key).toHaveLength(5);
    }
    expect(report.usage.coachModelCalls).toBe(15);

    expect(await main(['baseline:accept', '--run', runId], h.deps)).toBe(0);
    const baseline = BaselineSchema.parse(JSON.parse(readFileSync(baselineFile(), 'utf8')));
    expect(baseline.level).toBe('L1');
    expect(baseline.judge.fingerprint).toEqual(computeJudgeFingerprint(RUNNER_CONFIG.judge, judgedSuite()));
    expect(baseline.coach).toEqual({ model: COACH });
    expect(baseline.results['Z-01.A1/Z-01.C1']).toMatchObject({ status: 'PASS', passCount: 5, n: 5, advisory: true });
    expect(baseline.results['Z-01.A1/Z-01.C3']).toMatchObject({ status: 'PASS', n: 5, advisory: false });
    for (const entry of Object.values(baseline.results)) expect(typeof entry.advisory).toBe('boolean');
    const advisoryCount = Object.values(baseline.results).filter((entry) => entry.advisory === true).length;
    expect(advisoryCount).toBe(3);
    expect(h.out).toContain(
      '[suite] baseline: 3 meaning result(s) are advisory (no-agreement); they diff as inconclusive until re-accepted from a trusted run',
    );

    rmSync(baselineFile());
    h.setNow('2026-10-25T11:00:00.000Z');
    const four = await run(h, ['run', '--suite', 'x-judged', '--level', 'L1', '--runs', '4'], 0);
    expect(await main(['baseline:accept', '--run', four], h.deps)).toBe(1);
    expect(h.err).toContain('[suite]   - n 4 is below baseline.minSamples.L1 5');
    expect(existsSync(baselineFile())).toBe(false);
  });

  it('a trusted accept logs no advisory line', async () => {
    writeConfig();
    writeAgreementFile(dir, 'x-judged', agreementFor(judgedSuite()));
    const { h } = l1Harness();
    const runId = await run(h, ['run', '--suite', 'x-judged', '--level', 'L1', '--runs', '5'], 0);
    expect(await main(['baseline:accept', '--run', runId], h.deps)).toBe(0);
    expect(h.out.some((line) => line.includes('are advisory'))).toBe(false);
    const baseline = BaselineSchema.parse(JSON.parse(readFileSync(baselineFile(), 'utf8')));
    expect(Object.values(baseline.results).every((entry) => entry.advisory === false)).toBe(true);
  });

  it('the default entry runs smoke-v1 at L0 with zero coach calls, no model rows and exit 0', async () => {
    writeConfig();
    const h = harness({ executor: () => new L0DeterministicExecutor() });
    const runId = await run(h, ['run', '--suite', 'smoke-v1', '--level', 'L0'], 0);
    const report = readRun(runId);
    expect(report.usage.coachModelCalls).toBe(0);
    expect(report.modelUsage).toEqual([]);
    expect(report.budget?.exceeded).toEqual([]);
  });
});

describe('suite:ci --level L1 with an injected executor and judge (Story 13.6)', () => {
  const REPLY = 'Which release deadline comes first?';
  const ADVISORY = 'Meaning checks are advisory (judge uncalibrated): this gate fails only on rule and S regressions or lost coverage.';
  const NOTHING = 'no registered suite has L1 tests and an L1 baseline at the merge-base; L1 gate passes with nothing to check';
  const summaryFile = () => join(dir, 'out', 'summary.md');
  const readRun = (runId: string) => SuiteRunReportSchema.parse(JSON.parse(readFileSync(join(dir, 'runs', 'suites', runId, 'report.json'), 'utf8')));

  beforeEach(() => {
    writeFileSync(join(dir, 'suite.config.json'), JSON.stringify({ ...RUNNER_CONFIG, suites: ['p-v1', 'smoke-v1', 'x-judged'] }));
  });

  /** `reply` drives the executor; `judge` decides meaning checks; `files[suiteId]` is the merge-base baseline text. */
  function l1Ci(options: { reply?: () => string | null; judge?: (input: JudgeInput) => 'PASS' | 'FAIL'; files?: Record<string, string | null> } = {}) {
    let reply = options.reply ?? (() => REPLY);
    let decide = options.judge ?? (() => 'PASS' as const);
    const executor = fakeReplyExecutor(() => reply());
    const h = harness({ executor: () => executor });
    const fallback = h.deps.loadSuite;
    h.deps.loadSuite = (id) => (id === 'x-judged' ? judgedSuite() : fallback(id));
    const judge = fakeJudge((input) => decide(input));
    h.deps.createRunJudge = () => judge.judge;
    const mergeBaseReads: string[] = [];
    let files = options.files ?? {};
    h.deps.mergeBase = (path) => {
      mergeBaseReads.push(path);
      const suiteId = path.split(/[\\/]/)[1]!;
      return { ref: 'base0000', path: `packages/conversation-sim/${path}`, text: files[suiteId] ?? null };
    };
    return {
      h,
      executor,
      judge,
      mergeBaseReads,
      setReply: (next: () => string | null) => (reply = next),
      setJudge: (next: (input: JudgeInput) => 'PASS' | 'FAIL') => (decide = next),
      setFiles: (next: Record<string, string | null>) => (files = next),
    };
  }

  /** A five-sample L1 run of x-judged accepted as a baseline; returns its text (the working-tree file is removed). */
  async function acceptedBaseline(ci: ReturnType<typeof l1Ci>): Promise<string> {
    expect(await main(['run', '--suite', 'x-judged', '--level', 'L1', '--runs', '5'], ci.h.deps)).toBe(0);
    expect(await main(['baseline:accept', '--run', runDirs()[0]!], ci.h.deps)).toBe(0);
    const path = join(dir, 'baselines', 'x-judged', 'L1.json');
    const text = readFileSync(path, 'utf8');
    rmSync(path);
    ci.h.out.length = 0;
    ci.h.setNow('2026-10-25T12:00:00.000Z');
    return text;
  }

  it('the default entry refuses ci --level L1 without a judge, naming suite:run:live and running nothing', async () => {
    const h = harness();
    expect(await main(['ci', '--level', 'L1', '--summary', summaryFile()], h.deps)).toBe(1);
    expect(h.err).toEqual([L1_REFUSAL]);
    expect(h.err[0]).toContain('suite:run:live');
    expect(runDirs()).toEqual([]);
    expect(existsSync(summaryFile())).toBe(false);
  });

  it('still refuses L2, even with a judge', async () => {
    const { h } = l1Ci();
    expect(await main(['ci', '--level', 'L2'], h.deps)).toBe(1);
    expect(h.err).toEqual(['[suite] ci --level L2 is not wired yet (Story 14.3 owns the L2 workflow)']);
  });

  it('skips empty suites as "no L1 tests" and passes with nothing to check, writing no run folder', async () => {
    writeFileSync(join(dir, 'suite.config.json'), JSON.stringify({ ...RUNNER_CONFIG, suites: ['p-v1', 'smoke-v1'] }));
    const { h, executor, mergeBaseReads } = l1Ci();
    expect(await main(['ci', '--level', 'L1', '--summary', summaryFile()], h.deps)).toBe(0);
    expect(h.err).toEqual([]);
    expect(h.out).toEqual([
      '[suite] ci: p-v1 skipped (no L1 tests)',
      '[suite] ci: smoke-v1 skipped (no L1 tests)',
      `[suite] ci: ${NOTHING}`,
      '[suite] ci: L1 gate exit 0',
    ]);
    const summary = readFileSync(summaryFile(), 'utf8');
    expect(summary).toContain('## Suite L1 gate');
    expect(summary).toContain('No registered suite has L1 tests and an L1 baseline at the merge-base; L1 gate passes with nothing to check.');
    expect(summary).toContain('- p-v1: skipped (no L1 tests)');
    expect(summary).not.toContain(ADVISORY);
    expect(runDirs()).toEqual([]);
    expect(executor.calls).toEqual([]);
    expect(mergeBaseReads).toEqual([]);
  });

  it('a suite whose tests declare only L0 is skipped as "no L1 tests"', async () => {
    writeFileSync(join(dir, 'suite.config.json'), JSON.stringify({ ...RUNNER_CONFIG, suites: ['x-suite'] }));
    const l0Only = () => {
      const suite = fakeSuite();
      return { ...suite, tests: suite.tests.filter((test) => !test.levels.includes('L1')) };
    };
    expect(l0Only().tests.length).toBeGreaterThan(0);
    const ci = l1Ci();
    const fallback = ci.h.deps.loadSuite;
    ci.h.deps.loadSuite = (id) => (id === 'x-suite' ? l0Only() : fallback(id));
    expect(await main(['ci', '--level', 'L1'], ci.h.deps)).toBe(0);
    expect(ci.h.out[0]).toBe('[suite] ci: x-suite skipped (no L1 tests)');
    expect(ci.executor.calls).toEqual([]);
    expect(ci.mergeBaseReads).toEqual([]);
  });

  it('skips a suite with L1 tests but no L1 baseline at the merge-base without calling the executor or the judge', async () => {
    const { h, executor, judge, mergeBaseReads } = l1Ci();
    expect(await main(['ci', '--level', 'L1', '--summary', summaryFile()], h.deps)).toBe(0);
    expect(h.err).toEqual([]);
    expect(h.out).toContain('[suite] ci: x-judged skipped (no L1 baseline at merge-base base0000)');
    expect(h.out).toContain(`[suite] ci: ${NOTHING}`);
    expect(mergeBaseReads).toEqual([join('baselines', 'x-judged', 'L1.json')]);
    expect(executor.calls).toEqual([]);
    expect(judge.inputs).toEqual([]);
    expect(runDirs()).toEqual([]);
    expect(readFileSync(summaryFile(), 'utf8')).toContain('- x-judged: skipped (no L1 baseline at merge-base base0000)');
  });

  it('a merge-base read error is a failed suite (exit 1) and runs nothing', async () => {
    const { h, executor } = l1Ci();
    h.deps.mergeBase = () => {
      throw new Error('[suite] git merge-base HEAD origin/main failed (fatal: no such ref)');
    };
    expect(await main(['ci', '--level', 'L1', '--summary', summaryFile()], h.deps)).toBe(1);
    expect(h.err).toEqual([
      '[suite] ci: x-judged failed: cannot read the L1 baseline at the merge-base: git merge-base HEAD origin/main failed (fatal: no such ref)',
    ]);
    expect(h.out).not.toContain(`[suite] ci: ${NOTHING}`);
    expect(executor.calls).toEqual([]);
    expect(runDirs()).toEqual([]);
    expect(readFileSync(summaryFile(), 'utf8')).toContain('- x-judged: failed (exit 1): cannot read the L1 baseline at the merge-base');
  });

  it('runs diff.minSamples.L1 samples against the merge-base baseline; an untrusted meaning regression is advisory (exit 0)', async () => {
    const ci = l1Ci();
    const baseline = await acceptedBaseline(ci);
    ci.setFiles({ 'x-judged': baseline });
    ci.setJudge((input) => (input.layer === 'P' ? 'FAIL' : 'PASS'));
    ci.executor.calls.length = 0;

    expect(await main(['ci', '--level', 'L1', '--summary', summaryFile()], ci.h.deps)).toBe(0);
    expect(ci.h.err).toEqual([]);
    const runId = runDirs().find((id) => readRun(id).n === RUNNER_CONFIG.diff.minSamples.L1)!;
    const report = readRun(runId);
    expect(report.n).toBe(3);
    expect(ci.executor.calls).toHaveLength(3);
    expect(report.judgeTrust.trusted).toBe(false);
    expect(report.diff).toMatchObject({ exitCode: 0, baseline: { kind: 'merge-base', ref: 'base0000', missing: false } });
    expect(ci.h.out).toContain('[suite] ci: x-judged exit 0');
    expect(ci.h.out).toContain(`[suite] ci: ${ADVISORY}`);
    expect(ci.h.out.at(-1)).toBe('[suite] ci: L1 gate exit 0');

    const summary = readFileSync(summaryFile(), 'utf8');
    expect(summary).toContain('## Suite L1 gate');
    expect(summary).toContain(ADVISORY);
    expect(summary).not.toContain('nothing to check');
    expect(summary).toContain(`- x-judged: ran (exit 0), run ${runId}`);
    expect(summary).toContain(`### x-judged L1 — ${runId}`);
    expect(summary).toContain('- Baseline: merge-base packages/conversation-sim/baselines/x-judged/L1.json at base0000');
    expect(summary).toContain('| inconclusive | Z-01.A1/Z-01.C1 |');
    expect(summary).not.toContain(REPLY);
  });

  it('an S rule regression fails the gate (exit 1) while meaning checks stay advisory', async () => {
    const ci = l1Ci();
    const baseline = await acceptedBaseline(ci);
    ci.setFiles({ 'x-judged': baseline });
    ci.setReply(() => null);

    expect(await main(['ci', '--level', 'L1', '--summary', summaryFile()], ci.h.deps)).toBe(1);
    expect(ci.h.out).toContain('[suite] ci: x-judged exit 1');
    const summary = readFileSync(summaryFile(), 'utf8');
    expect(summary).toContain(ADVISORY);
    expect(summary).toContain('Gate exit code: **1**');
    expect(summary).toContain('| regressed | Z-01.A1/Z-01.C3 | S | rule |');
  });

  it('a trusted judge prints no advisory line', async () => {
    writeAgreementFile(dir, 'x-judged', agreementFor(judgedSuite()));
    const ci = l1Ci();
    const baseline = await acceptedBaseline(ci);
    ci.setFiles({ 'x-judged': baseline });
    expect(await main(['ci', '--level', 'L1', '--summary', summaryFile()], ci.h.deps)).toBe(0);
    expect(ci.h.out).not.toContain(`[suite] ci: ${ADVISORY}`);
    expect(readFileSync(summaryFile(), 'utf8')).not.toContain(ADVISORY);
  });

  describe('scheduled runs: --runs N --include-unbaselined (Story 13.7)', () => {
    const NOTHING_SCHEDULED = 'no registered suite has L1 tests; L1 run passes with nothing to check';
    const INCONCLUSIVE_1 =
      'With n = 1 below diff.minSamples.L1 (3), meaning criteria diff as inconclusive; only rule and S regressions or lost coverage can fail this run.';
    const NIGHTLY = ['ci', '--level', 'L1', '--runs', '1', '--include-unbaselined'];
    const ranRun = () => runDirs().find((id) => readRun(id).diff !== undefined && readRun(id).n !== 5)!;

    it('L0 rejects the scheduled flags as usage errors (exit 1) and runs nothing', async () => {
      const h = harness();
      for (const flags of [['--runs', '3'], ['--include-unbaselined']]) {
        h.err.length = 0;
        expect(await main(['ci', '--level', 'L0', ...flags], h.deps)).toBe(1);
        expect(h.err).toEqual(['[suite] ci: --runs and --include-unbaselined are accepted only at L1 and L2', 'Run with --help for usage.']);
      }
      expect(runDirs()).toEqual([]);
    });

    it.each([['0'], ['abc']])('rejects --runs %s (exit 1) and runs nothing', async (runs) => {
      const { h, executor } = l1Ci();
      expect(await main(['ci', '--level', 'L1', '--runs', runs, '--include-unbaselined'], h.deps)).toBe(1);
      expect(h.err[0]).toBe(`[suite] ci: --runs must be a positive integer, got ${runs}`);
      expect(executor.calls).toEqual([]);
      expect(runDirs()).toEqual([]);
    });

    it('the default entry refuses ci --level L1 --runs 1 without a judge and runs nothing', async () => {
      const h = harness();
      expect(await main(['ci', '--level', 'L1', '--runs', '1'], h.deps)).toBe(1);
      expect(await main([...NIGHTLY, '--summary', summaryFile()], h.deps)).toBe(1);
      expect(h.err).toEqual([L1_REFUSAL, L1_REFUSAL]);
      expect(runDirs()).toEqual([]);
      expect(existsSync(summaryFile())).toBe(false);
    });

    it('empty suites: both skipped "no L1 tests", the scheduled nothing-to-check line, exit 0, no run folder', async () => {
      writeFileSync(join(dir, 'suite.config.json'), JSON.stringify({ ...RUNNER_CONFIG, suites: ['p-v1', 'smoke-v1'] }));
      const { h, executor, mergeBaseReads } = l1Ci();
      expect(await main([...NIGHTLY, '--summary', summaryFile()], h.deps)).toBe(0);
      expect(h.err).toEqual([]);
      expect(h.out).toEqual([
        `[suite] ci: ${INCONCLUSIVE_1}`,
        '[suite] ci: p-v1 skipped (no L1 tests)',
        '[suite] ci: smoke-v1 skipped (no L1 tests)',
        `[suite] ci: ${NOTHING_SCHEDULED}`,
        '[suite] ci: L1 gate exit 0',
      ]);
      const summary = readFileSync(summaryFile(), 'utf8');
      expect(summary).toContain('No registered suite has L1 tests; L1 run passes with nothing to check.');
      expect(summary).not.toContain('baseline at the merge-base; L1 gate passes');
      expect(summary).toContain('Samples per suite: n = 1');
      expect(summary).toContain(INCONCLUSIVE_1);
      expect(runDirs()).toEqual([]);
      expect(executor.calls).toEqual([]);
      expect(mergeBaseReads).toEqual([]);
    });

    it('nightly without a merge-base baseline runs n = 1 and the diff reports no baseline (exit 0)', async () => {
      const { h, executor, judge } = l1Ci();
      expect(await main([...NIGHTLY, '--summary', summaryFile()], h.deps)).toBe(0);
      expect(h.err).toEqual([]);
      expect(h.out).toContain(
        '[suite] ci: x-judged has no L1 baseline at merge-base base0000; running without a baseline (diff reports no baseline)',
      );
      expect(h.out).not.toContain('[suite] ci: x-judged skipped (no L1 baseline at merge-base base0000)');
      expect(h.out).toContain(`[suite] ci: ${INCONCLUSIVE_1}`);
      expect(executor.calls).toEqual(['Z-01.A1#1']);
      expect(judge.inputs.length).toBeGreaterThan(0);
      const runId = ranRun();
      const report = readRun(runId);
      expect(report.n).toBe(1);
      expect(report.diff).toMatchObject({ outcome: 'no-baseline', exitCode: 0, baseline: { kind: 'merge-base', ref: 'base0000', missing: true } });
      expect(h.out).toContain('[suite] ci: x-judged exit 0');
      const summary = readFileSync(summaryFile(), 'utf8');
      expect(summary).toContain(`- x-judged: ran (exit 0), run ${runId}`);
      expect(summary).toContain('Samples per suite: n = 1');
      expect(summary).toContain(INCONCLUSIVE_1);
      expect(summary).toContain('- Diff: **no-baseline** (exit 0)');
      expect(summary).toContain('(missing)');
      expect(summary).not.toContain('nothing to check');
    });

    it('nightly against a passing baseline with a trusted judge: a meaning-only regression is inconclusive (exit 0)', async () => {
      writeAgreementFile(dir, 'x-judged', agreementFor(judgedSuite()));
      const ci = l1Ci();
      const baseline = await acceptedBaseline(ci);
      ci.setFiles({ 'x-judged': baseline });
      ci.setJudge((input) => (input.layer === 'P' ? 'FAIL' : 'PASS'));
      ci.executor.calls.length = 0;

      expect(await main([...NIGHTLY, '--summary', summaryFile()], ci.h.deps)).toBe(0);
      expect(ci.h.err).toEqual([]);
      expect(ci.executor.calls).toEqual(['Z-01.A1#1']);
      const runId = ranRun();
      const report = readRun(runId);
      expect(report.n).toBe(1);
      expect(report.judgeTrust.trusted).toBe(true);
      expect(report.diff).toMatchObject({ exitCode: 0, baseline: { kind: 'merge-base', ref: 'base0000', missing: false } });
      expect(report.diff!.tests.entries).toContainEqual(expect.objectContaining({ key: 'Z-01.A1/Z-01.C1', category: 'inconclusive' }));
      expect(ci.h.out).not.toContain(`[suite] ci: ${ADVISORY}`);
      expect(ci.h.out.at(-1)).toBe('[suite] ci: L1 gate exit 0');

      const summary = readFileSync(summaryFile(), 'utf8');
      expect(summary).toContain('| Layer | PASS | FAIL | Pass rate |');
      expect(summary).toContain('- Verdict: **');
      expect(summary).toContain('- Diff: **clean** (exit 0)');
      expect(summary).toContain('| inconclusive | Z-01.A1/Z-01.C1 |');
      expect(summary).toContain('Samples per suite: n = 1');
      expect(summary).toContain(INCONCLUSIVE_1);
      expect(summary).toContain('Gate exit code: **0**');
    });

    it('nightly: a rule criterion failing against a passing baseline fails the run (exit 1)', async () => {
      const ci = l1Ci();
      const baseline = await acceptedBaseline(ci);
      ci.setFiles({ 'x-judged': baseline });
      ci.setReply(() => 'Which deadline? Which release? Who owns it? When is the review?');

      expect(await main([...NIGHTLY, '--summary', summaryFile()], ci.h.deps)).toBe(1);
      expect(ci.h.out).toContain('[suite] ci: x-judged exit 1');
      const summary = readFileSync(summaryFile(), 'utf8');
      expect(summary).toContain('Gate exit code: **1**');
      expect(summary).toContain('| regressed | Z-01.A1/Z-01.C4 | C | rule |');
    });

    it('weekly --runs 5 against a baseline: five samples and no inconclusive-n line', async () => {
      const ci = l1Ci();
      const baseline = await acceptedBaseline(ci);
      ci.setFiles({ 'x-judged': baseline });
      ci.executor.calls.length = 0;

      expect(await main(['ci', '--level', 'L1', '--runs', '5', '--include-unbaselined', '--summary', summaryFile()], ci.h.deps)).toBe(0);
      expect(ci.executor.calls).toHaveLength(5);
      expect(ci.h.out.some((line) => line.includes('below diff.minSamples'))).toBe(false);
      const summary = readFileSync(summaryFile(), 'utf8');
      expect(summary).toContain('Samples per suite: n = 5');
      expect(summary).not.toContain('below diff.minSamples');
      expect(summary).toContain('- Samples: n = 5');
    });

    it('weekly --runs 5 with a trusted judge: a meaning-only regression is regressed, not inconclusive (exit 1)', async () => {
      writeAgreementFile(dir, 'x-judged', agreementFor(judgedSuite()));
      const ci = l1Ci();
      const baseline = await acceptedBaseline(ci);
      ci.setFiles({ 'x-judged': baseline });
      ci.setJudge((input) => (input.layer === 'P' ? 'FAIL' : 'PASS'));
      ci.executor.calls.length = 0;

      expect(await main(['ci', '--level', 'L1', '--runs', '5', '--include-unbaselined', '--summary', summaryFile()], ci.h.deps)).toBe(1);
      expect(ci.executor.calls).toHaveLength(5);
      const runId = runDirs().find((id) => readRun(id).diff !== undefined)!;
      const report = readRun(runId);
      expect(report.n).toBe(5);
      expect(report.judgeTrust.trusted).toBe(true);
      expect(report.diff).toMatchObject({ exitCode: 1, baseline: { kind: 'merge-base', ref: 'base0000', missing: false } });
      const entry = report.diff!.tests.entries.find((candidate) => candidate.key === 'Z-01.A1/Z-01.C1');
      expect(entry).toMatchObject({ category: 'regressed' });
      expect(ci.h.out).toContain('[suite] ci: x-judged exit 1');
      expect(ci.h.out.at(-1)).toBe('[suite] ci: L1 gate exit 1');
      const summary = readFileSync(summaryFile(), 'utf8');
      expect(summary).toContain('Gate exit code: **1**');
      expect(summary).not.toContain('| inconclusive | Z-01.A1/Z-01.C1 |');
      expect(summary).not.toContain('below diff.minSamples');
    });

    it('without the new flags the gate is unchanged: no samples lines, a missing baseline is skipped', async () => {
      const { h, executor } = l1Ci();
      expect(await main(['ci', '--level', 'L1', '--summary', summaryFile()], h.deps)).toBe(0);
      expect(h.out).toEqual([
        '[suite] ci: p-v1 skipped (no L1 tests)',
        '[suite] ci: smoke-v1 skipped (no L1 tests)',
        '[suite] ci: x-judged skipped (no L1 baseline at merge-base base0000)',
        `[suite] ci: ${NOTHING}`,
        '[suite] ci: L1 gate exit 0',
      ]);
      expect(executor.calls).toEqual([]);
      expect(readFileSync(summaryFile(), 'utf8')).not.toContain('Samples per suite');
    });

    it('--runs without --include-unbaselined still skips a suite without a baseline', async () => {
      const { h, executor } = l1Ci();
      expect(await main(['ci', '--level', 'L1', '--runs', '5'], h.deps)).toBe(0);
      expect(h.out).toContain('[suite] ci: x-judged skipped (no L1 baseline at merge-base base0000)');
      expect(h.out).toContain(`[suite] ci: ${NOTHING}`);
      expect(executor.calls).toEqual([]);
    });

    it('a merge-base read error stays a failed suite with --include-unbaselined', async () => {
      const { h, executor } = l1Ci();
      h.deps.mergeBase = () => {
        throw new Error('[suite] git merge-base HEAD origin/main failed (fatal: no such ref)');
      };
      expect(await main(NIGHTLY, h.deps)).toBe(1);
      expect(h.err).toEqual([
        '[suite] ci: x-judged failed: cannot read the L1 baseline at the merge-base: git merge-base HEAD origin/main failed (fatal: no such ref)',
      ]);
      expect(executor.calls).toEqual([]);
      expect(runDirs()).toEqual([]);
    });
  });
});

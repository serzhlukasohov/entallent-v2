import { spawnSync } from 'node:child_process';
import { realpathSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs as parseNodeArgs } from 'node:util';
import {
  baselineRefusals,
  buildBaseline,
  currentJudgeFingerprint,
  readRunReport,
  writeBaseline,
} from './baseline';
import { loadSuiteConfig } from './config';
import { L0DeterministicExecutor } from './executors/l0-deterministic-executor';
import type { SuiteExecutor } from './executors/types';
import { loadSuite } from './loader';
import { writeSuiteReport } from './report';
import type { RuleRegistry } from './rules/registry';
import { runSuite } from './runner';
import { LevelSchema, type Level, type LoadedSuite, type SuiteRunReport } from './schema';

/**
 * `suite:run` and `suite:baseline:accept` (architecture AD-11, AD-14). Exit 0 when a report
 * (or baseline) was written, whatever the verdict; 1 on usage, config, load or refusal
 * errors. Gating exit codes belong to `suite:diff` (12.9). This CLI never loads `.env` and
 * never prints environment values.
 */

export interface GitState {
  /** Full sha (`git rev-parse HEAD`), recorded in the report. */
  sha: string | null;
  /** Short sha, used only in the run id. */
  shortSha: string | null;
  dirty: boolean;
}

export interface CliDeps {
  env: Record<string, string | undefined>;
  packageDir: string;
  now: () => Date;
  git: () => GitState;
  log: (line: string) => void;
  error: (line: string) => void;
  loadSuite: (suiteId: string) => LoadedSuite;
  createExecutor: (level: Level) => SuiteExecutor;
  rules?: RuleRegistry;
}

const PACKAGE_DIR = resolve(__dirname, '..', '..');

export const HELP = `Usage:
  suite:run --suite <id> --level L0 [--runs N] [--case <id>]
      Runs a suite and writes runs/suites/<runId>/report.{json,md} and case-runs.json.
      Only L0 runs today (L1 lands in Epic 13, L2 in Epic 14).
  suite:baseline:accept --run <runId> [--allow-incomplete] [--allow-dirty] [--ci-run-url <url>]
      Writes baselines/<suiteId>/<level>.json from a run report.

Exit codes: 0 report or baseline written; 1 usage, config, load or refusal error.`;

export type ParsedCommand =
  | { command: 'help' }
  | { command: 'run'; suite: string; level: Level; runs: number; case?: string }
  | { command: 'baseline:accept'; run: string; allowIncomplete: boolean; allowDirty: boolean; ciRunUrl?: string };

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

export function parseArgs(argv: readonly string[]): ParsedCommand {
  const args = argv[0] === '--' ? argv.slice(1) : [...argv];
  const [command, ...rest] = args;
  if (command === undefined || command === '--help' || command === '-h' || command === 'help') return { command: 'help' };
  const tail = rest[0] === '--' ? rest.slice(1) : rest;
  try {
    if (command === 'run') {
      const { values } = parseNodeArgs({
        args: tail,
        strict: true,
        allowPositionals: false,
        options: {
          suite: { type: 'string' },
          level: { type: 'string' },
          runs: { type: 'string' },
          case: { type: 'string' },
          help: { type: 'boolean', short: 'h' },
        },
      });
      if (values.help) return { command: 'help' };
      if (!values.suite) throw new CliUsageError('[suite] run: --suite <id> is required');
      if (!values.level) throw new CliUsageError('[suite] run: --level <L0|L1|L2> is required');
      const level = LevelSchema.safeParse(values.level);
      if (!level.success) throw new CliUsageError(`[suite] run: --level must be L0, L1 or L2, got ${values.level}`);
      const runs = values.runs === undefined ? 1 : Number(values.runs);
      if (!/^\d+$/.test(values.runs ?? '1') || !Number.isInteger(runs) || runs < 1) {
        throw new CliUsageError(`[suite] run: --runs must be a positive integer, got ${values.runs}`);
      }
      if (values.case !== undefined && values.case.trim() === '') throw new CliUsageError('[suite] run: --case must not be empty');
      return { command: 'run', suite: values.suite, level: level.data, runs, ...(values.case !== undefined ? { case: values.case } : {}) };
    }
    if (command === 'baseline:accept') {
      const { values } = parseNodeArgs({
        args: tail,
        strict: true,
        allowPositionals: false,
        options: {
          run: { type: 'string' },
          'allow-incomplete': { type: 'boolean' },
          'allow-dirty': { type: 'boolean' },
          'ci-run-url': { type: 'string' },
          help: { type: 'boolean', short: 'h' },
        },
      });
      if (values.help) return { command: 'help' };
      if (!values.run) throw new CliUsageError('[suite] baseline:accept: --run <runId> is required');
      const ciRunUrl = values['ci-run-url'];
      if (ciRunUrl !== undefined && (ciRunUrl.trim() === '' || !URL.canParse(ciRunUrl))) {
        throw new CliUsageError(`[suite] baseline:accept: --ci-run-url must be a URL, got ${JSON.stringify(ciRunUrl)}`);
      }
      return {
        command: 'baseline:accept',
        run: values.run,
        allowIncomplete: values['allow-incomplete'] === true,
        allowDirty: values['allow-dirty'] === true,
        ...(ciRunUrl !== undefined ? { ciRunUrl } : {}),
      };
    }
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError(`[suite] ${command}: ${(error as Error).message}`);
  }
  throw new CliUsageError(`[suite] unknown command ${command}; expected run or baseline:accept`);
}

/** Model credentials removed before an L0 run; returns the removed key names (never values). */
export function scrubModelCredentials(env: Record<string, string | undefined>): string[] {
  const removed = Object.keys(env)
    .filter((key) => key === 'OPENAI_API_KEY' || key.startsWith('AZURE_OPENAI_'))
    .sort();
  for (const key of removed) delete env[key];
  return removed;
}

export function runIdFor(now: Date, shortSha: string | null): string {
  return `${now.toISOString().replace(/[:.]/g, '-')}-${shortSha ?? 'unknown'}`;
}

export function ciRunUrlFromEnv(env: Record<string, string | undefined>): string | undefined {
  const server = env.GITHUB_SERVER_URL;
  const repository = env.GITHUB_REPOSITORY;
  const runId = env.GITHUB_RUN_ID;
  if (!server || !repository || !runId) return undefined;
  return `${server.replace(/\/$/, '')}/${repository}/actions/runs/${runId}`;
}

export function defaultDeps(): CliDeps {
  return {
    env: process.env,
    packageDir: PACKAGE_DIR,
    now: () => new Date(),
    git: () => readGitState(PACKAGE_DIR),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
    loadSuite: (suiteId) => loadSuite(suiteId),
    createExecutor: (level) => {
      if (level !== 'L0') throw new Error(unsupportedLevel(level));
      return new L0DeterministicExecutor();
    },
  };
}

export async function main(argv: readonly string[], deps: CliDeps = defaultDeps()): Promise<number> {
  try {
    const parsed = parseArgs(argv);
    if (parsed.command === 'help') {
      deps.log(HELP);
      return 0;
    }
    if (parsed.command === 'run') return await runCommand(parsed, deps);
    return acceptCommand(parsed, deps);
  } catch (error) {
    deps.error(error instanceof Error ? error.message : String(error));
    if (error instanceof CliUsageError) deps.error('Run with --help for usage.');
    return 1;
  }
}

async function runCommand(parsed: Extract<ParsedCommand, { command: 'run' }>, deps: CliDeps): Promise<number> {
  const config = loadSuiteConfig(join(deps.packageDir, 'suite.config.json'));
  if (parsed.level !== 'L0') throw new Error(unsupportedLevel(parsed.level));
  if (!config.suites.includes(parsed.suite)) {
    throw new Error(`[suite] unknown suite ${parsed.suite}; known suites: ${config.suites.join(', ')}`);
  }
  if (!config.levels.includes(parsed.level)) {
    throw new Error(`[suite] level ${parsed.level} is not enabled in suite.config.json`);
  }

  const removed = scrubModelCredentials(deps.env);
  if (removed.length > 0) deps.log(`[suite] L0: removed model credentials from the environment (${removed.join(', ')})`);

  const suite = deps.loadSuite(parsed.suite);
  const executor = deps.createExecutor(parsed.level);
  const git = deps.git();
  const runId = runIdFor(deps.now(), git.shortSha);
  deps.log(`[suite] run ${runId}: ${suite.id} ${parsed.level} n=${parsed.runs}${parsed.case ? ` case=${parsed.case}` : ''}`);

  const { report, caseRuns } = await runSuite({
    suite,
    level: parsed.level,
    n: parsed.runs,
    executor,
    config,
    runId,
    git: { sha: git.sha, dirty: git.dirty },
    ...(parsed.case !== undefined ? { caseFilter: parsed.case } : {}),
    ...(deps.rules ? { rules: deps.rules } : {}),
    log: deps.log,
  });

  const paths = writeSuiteReport(report, deps.packageDir);
  const caseRunsPath = join(deps.packageDir, 'runs', 'suites', report.runId, 'case-runs.json');
  writeFileSync(caseRunsPath, `${JSON.stringify({ schemaVersion: 1, runId: report.runId, caseRuns }, null, 2)}\n`);

  for (const line of summaryLines(report)) deps.log(line);
  deps.log(`[suite] report: ${relative(deps.packageDir, paths.json)}`);
  deps.log(`[suite] report: ${relative(deps.packageDir, paths.markdown)}`);
  deps.log(`[suite] case runs: ${relative(deps.packageDir, caseRunsPath)}`);
  return 0;
}

function acceptCommand(parsed: Extract<ParsedCommand, { command: 'baseline:accept' }>, deps: CliDeps): number {
  const config = loadSuiteConfig(join(deps.packageDir, 'suite.config.json'));
  const report = readRunReport(deps.packageDir, parsed.run);
  const refusals: string[] = [];
  let currentFingerprint: ReturnType<typeof currentJudgeFingerprint> = null;
  try {
    currentFingerprint = currentJudgeFingerprint(report.level);
  } catch (error) {
    refusals.push((error as Error).message.replace(/^\[suite\] /, ''));
  }
  refusals.push(
    ...baselineRefusals(report, {
      config,
      currentFingerprint,
      allowIncomplete: parsed.allowIncomplete,
      allowDirty: parsed.allowDirty,
    }),
  );
  if (refusals.length > 0) {
    deps.error(`[suite] baseline:accept refused run ${report.runId}:`);
    for (const reason of refusals) deps.error(`[suite]   - ${reason}`);
    return 1;
  }
  const ciRunUrl = parsed.ciRunUrl ?? ciRunUrlFromEnv(deps.env);
  const baseline = buildBaseline(report, {
    acceptedAt: deps.now().toISOString(),
    ...(ciRunUrl !== undefined ? { ciRunUrl } : {}),
  });
  const path = writeBaseline(baseline, deps.packageDir);
  deps.log(
    `[suite] baseline ${baseline.suiteId} ${baseline.level}${baseline.provisional ? ' (provisional)' : ''} from run ${report.runId}: ${relative(deps.packageDir, path)}`,
  );
  return 0;
}

/** Layer table and verdict for the console. */
export function summaryLines(report: SuiteRunReport): string[] {
  const lines = [`[suite] ${report.suiteId} ${report.level} n=${report.n}`];
  if (report.layers) {
    lines.push('[suite] layer  PASS  FAIL  rate');
    const format = (label: string, pass: number, fail: number, passRate: number | null) =>
      `[suite] ${label.padEnd(5)}  ${String(pass).padStart(4)}  ${String(fail).padStart(4)}  ${passRate === null ? 'n/a' : `${(passRate * 100).toFixed(1)}%`}`;
    for (const row of report.layers.rows) lines.push(format(row.layer, row.pass, row.fail, row.passRate));
    const pdc = report.layers.combinedPdc;
    lines.push(format('P+D+C', pdc.pass, pdc.fail, pdc.passRate));
  } else {
    lines.push('[suite] layers: n/a (journeys only)');
  }
  lines.push(
    `[suite] verdict: ${report.verdict}${report.provisional ? ' (provisional)' : ''} · ${report.complete ? 'COMPLETE' : 'INCOMPLETE'}`,
  );
  if (report.provisionalReason) lines.push(`[suite] provisional: ${report.provisionalReason}`);
  return lines;
}

function unsupportedLevel(level: Level): string {
  return level === 'L2' ? '[suite] L2 executor lands in Epic 14' : `[suite] ${level} executor lands in Epic 13`;
}

function readGitState(cwd: string): GitState {
  const git = (args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  const full = git(['rev-parse', 'HEAD']);
  const short = git(['rev-parse', '--short', 'HEAD']);
  const status = git(['status', '--porcelain']);
  return {
    sha: full.status === 0 ? full.stdout.trim() : null,
    shortSha: short.status === 0 ? short.stdout.trim() : null,
    dirty: status.status === 0 ? status.stdout.trim().length > 0 : true,
  };
}

function isEntryPoint(): boolean {
  if (process.argv[1] === undefined) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(__filename);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

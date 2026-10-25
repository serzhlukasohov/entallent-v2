import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs as parseNodeArgs } from 'node:util';
import {
  baselinePath,
  baselineRefusals,
  buildBaseline,
  currentJudgeFingerprint,
  readRunReport,
  writeBaseline,
} from './baseline';
import { loadSuiteConfig } from './config';
import { diffRun, diffSummaryLines, parseBaselineJson } from './diff';
import { L0DeterministicExecutor } from './executors/l0-deterministic-executor';
import type { SuiteExecutor } from './executors/types';
import { loadSuite } from './loader';
import { renderCiSummary, writeSuiteReport } from './report';
import type { RuleRegistry } from './rules/registry';
import { runSuite } from './runner';
import {
  LevelSchema,
  type Baseline,
  type DiffBaselineSource,
  type Level,
  type LoadedSuite,
  type SuiteRunReport,
} from './schema';

/**
 * `suite:run`, `suite:baseline:accept`, `suite:diff`, `suite:ci` and the `suite:calibrate`
 * stub (architecture AD-11, AD-13, AD-14, AD-15).
 * `run` and `baseline:accept` exit 0 when a report (or baseline) was written, whatever the
 * verdict, and 1 on usage, config, load or refusal errors. `diff` exits 0 clean, 1 gating
 * entry, 2 baseline-invalid, 3 judge infrastructure, 4 budget exceeded; usage errors and an
 * unreadable run report are 1 and write nothing. `ci` runs and merge-base-diffs every
 * registered suite that has tests and exits with the first code present by precedence
 * 2 > 3 > 4 > 1 over all suites (a load or run failure counts as 1), else 0. `calibrate`
 * exits 1 until Epic 13. This CLI never loads `.env` and never prints environment values.
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
  /** Reads a package-relative file at the merge-base with origin/main; defaults to `git` in `packageDir`. */
  mergeBase?: (packageRelativePath: string) => MergeBaseFile;
}

export interface MergeBaseFile {
  /** The merge-base commit sha. */
  ref: string;
  /** The repo-relative path read with `git show <ref>:<path>`. */
  path: string;
  /** `null` when the file does not exist at the merge-base. */
  text: string | null;
}

const PACKAGE_DIR = resolve(__dirname, '..', '..');

export const HELP = `Usage:
  suite:run --suite <id> --level L0 [--runs N] [--case <id>]
      Runs a suite and writes runs/suites/<runId>/report.{json,md} and case-runs.json.
      Only L0 runs today (L1 lands in Epic 13, L2 in Epic 14).
  suite:baseline:accept --run <runId> [--allow-incomplete] [--allow-dirty] [--ci-run-url <url>]
      Writes baselines/<suiteId>/<level>.json from a run report.
  suite:diff --run <runId> [--baseline <path> | --merge-base]
      Diffs a run against a baseline (default: working-tree baselines/<suite>/<level>.json;
      --merge-base: the file at git merge-base HEAD origin/main) and writes it into the report.
  suite:ci --level L0 [--summary <path>]
      For every suite in suite.config.json that has tests: suite:run (n=1) then
      suite:diff --merge-base. Suites without tests are skipped. --summary appends a
      Markdown step summary (no evidence or transcript text) to <path>.
  suite:calibrate
      Lands in Epic 13; exits 1.

Exit codes (run, baseline:accept): 0 report or baseline written; 1 usage, config, load or refusal error.
Exit codes (diff): 0 clean or no baseline; 1 gating regression or lost coverage (also usage errors
  and an unreadable run report); 2 baseline invalid; 3 judge infrastructure; 4 budget exceeded.
Exit code (ci): the first present over all suites by precedence 2 > 3 > 4 > 1 (a load or run
  failure counts as 1); 0 when every suite is clean, has no baseline, or is skipped.
Exit code (calibrate): 1.`;

export type ParsedCommand =
  | { command: 'help' }
  | { command: 'run'; suite: string; level: Level; runs: number; case?: string }
  | { command: 'baseline:accept'; run: string; allowIncomplete: boolean; allowDirty: boolean; ciRunUrl?: string }
  | { command: 'diff'; run: string; baseline?: string; mergeBase: boolean }
  | { command: 'ci'; level: Level; summary?: string }
  | { command: 'calibrate' };

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
    if (command === 'diff') {
      const { values } = parseNodeArgs({
        args: tail,
        strict: true,
        allowPositionals: false,
        options: {
          run: { type: 'string' },
          baseline: { type: 'string' },
          'merge-base': { type: 'boolean' },
          help: { type: 'boolean', short: 'h' },
        },
      });
      if (values.help) return { command: 'help' };
      if (!values.run) throw new CliUsageError('[suite] diff: --run <runId> is required');
      if (values.baseline !== undefined && values['merge-base']) {
        throw new CliUsageError('[suite] diff: pass either --baseline <path> or --merge-base, not both');
      }
      if (values.baseline !== undefined && values.baseline.trim() === '') {
        throw new CliUsageError('[suite] diff: --baseline must not be empty');
      }
      return {
        command: 'diff',
        run: values.run,
        ...(values.baseline !== undefined ? { baseline: values.baseline } : {}),
        mergeBase: values['merge-base'] === true,
      };
    }
    if (command === 'ci') {
      const { values } = parseNodeArgs({
        args: tail,
        strict: true,
        allowPositionals: false,
        options: {
          level: { type: 'string' },
          summary: { type: 'string' },
          help: { type: 'boolean', short: 'h' },
        },
      });
      if (values.help) return { command: 'help' };
      if (!values.level) throw new CliUsageError('[suite] ci: --level <L0|L1|L2> is required');
      const level = LevelSchema.safeParse(values.level);
      if (!level.success) throw new CliUsageError(`[suite] ci: --level must be L0, L1 or L2, got ${values.level}`);
      if (values.summary !== undefined && values.summary.trim() === '') throw new CliUsageError('[suite] ci: --summary must not be empty');
      return { command: 'ci', level: level.data, ...(values.summary !== undefined ? { summary: values.summary } : {}) };
    }
    if (command === 'calibrate') return { command: 'calibrate' };
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    throw new CliUsageError(`[suite] ${command}: ${(error as Error).message}`);
  }
  throw new CliUsageError(`[suite] unknown command ${command}; expected run, baseline:accept, diff, ci or calibrate`);
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
    if (parsed.command === 'diff') return diffCommand(parsed, deps);
    if (parsed.command === 'ci') return await ciCommand(parsed, deps);
    if (parsed.command === 'calibrate') {
      deps.error('[suite] calibrate lands in Epic 13');
      return 1;
    }
    return acceptCommand(parsed, deps);
  } catch (error) {
    deps.error(error instanceof Error ? error.message : String(error));
    if (error instanceof CliUsageError) deps.error('Run with --help for usage.');
    return 1;
  }
}

async function runCommand(parsed: Extract<ParsedCommand, { command: 'run' }>, deps: CliDeps): Promise<number> {
  await performRun(parsed, deps);
  return 0;
}

interface RunOverrides {
  /** An already loaded suite (`ci` loads first to skip empty suites). */
  suite?: LoadedSuite;
  /** Picks the run id; `ci` uses it to keep run ids unique within one invocation. */
  runId?: (shortSha: string | null) => string;
}

/** The `suite:run` path; returns the written report's run id. */
async function performRun(
  parsed: Extract<ParsedCommand, { command: 'run' }>,
  deps: CliDeps,
  overrides: RunOverrides = {},
): Promise<string> {
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

  const suite = overrides.suite ?? deps.loadSuite(parsed.suite);
  const executor = deps.createExecutor(parsed.level);
  const git = deps.git();
  const runId = overrides.runId ? overrides.runId(git.shortSha) : runIdFor(deps.now(), git.shortSha);
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
  return report.runId;
}

export interface CiSuiteOutcome {
  suiteId: string;
  status: 'skipped' | 'ran' | 'failed';
  exitCode: number;
  runId?: string;
  /** Load or run failure message (never environment values). */
  error?: string;
}

/** Exit-code precedence of `suite:ci` over all suites: 2 > 3 > 4 > 1, else 0. */
export function aggregateCiExitCode(codes: readonly number[]): number {
  for (const code of [2, 3, 4, 1]) if (codes.includes(code)) return code;
  return 0;
}

/**
 * `suite:ci` (AD-15): exactly `suite:run --suite <id> --level <L> --runs 1` then
 * `suite:diff --run <runId> --merge-base` per registered suite that has tests, in config
 * order, attempting every suite even after a failure.
 */
async function ciCommand(parsed: Extract<ParsedCommand, { command: 'ci' }>, deps: CliDeps): Promise<number> {
  const config = loadSuiteConfig(join(deps.packageDir, 'suite.config.json'));
  if (parsed.level !== 'L0') throw new Error(unsupportedLevel(parsed.level));
  if (!config.levels.includes(parsed.level)) {
    throw new Error(`[suite] level ${parsed.level} is not enabled in suite.config.json`);
  }

  const outcomes: CiSuiteOutcome[] = [];
  const reports: SuiteRunReport[] = [];
  const usedRunIds = new Set<string>();
  const uniqueRunId = (shortSha: string | null) => {
    const start = deps.now().getTime();
    for (let offset = 0; ; offset += 1) {
      const id = runIdFor(new Date(start + offset), shortSha);
      if (!usedRunIds.has(id) && !existsSync(join(deps.packageDir, 'runs', 'suites', id))) {
        usedRunIds.add(id);
        return id;
      }
    }
  };

  for (const suiteId of config.suites) {
    let suite: LoadedSuite;
    try {
      suite = deps.loadSuite(suiteId);
    } catch (error) {
      const message = errorMessage(error);
      deps.error(`[suite] ci: ${suiteId} failed to load: ${message}`);
      outcomes.push({ suiteId, status: 'failed', exitCode: 1, error: message });
      continue;
    }
    if (suite.tests.length === 0) {
      deps.log(`[suite] ci: ${suiteId} skipped (no tests)`);
      outcomes.push({ suiteId, status: 'skipped', exitCode: 0 });
      continue;
    }
    let runId: string | undefined;
    try {
      runId = await performRun({ command: 'run', suite: suiteId, level: parsed.level, runs: 1 }, deps, { suite, runId: uniqueRunId });
      const exitCode = diffCommand({ command: 'diff', run: runId, mergeBase: true }, deps);
      // A failed re-read only drops this suite's summary section; the diff exit code stands.
      try {
        reports.push(readRunReport(deps.packageDir, runId));
      } catch (error) {
        deps.error(`[suite] ci: ${suiteId}: could not re-read run ${runId} for the summary: ${errorMessage(error)}`);
      }
      outcomes.push({ suiteId, status: 'ran', exitCode, runId });
      deps.log(`[suite] ci: ${suiteId} exit ${exitCode}`);
    } catch (error) {
      const message = errorMessage(error);
      deps.error(`[suite] ci: ${suiteId} failed: ${message}`);
      outcomes.push({ suiteId, status: 'failed', exitCode: 1, ...(runId !== undefined ? { runId } : {}), error: message });
    }
  }

  let exitCode = aggregateCiExitCode(outcomes.map((outcome) => outcome.exitCode));
  const nothingToCheck = !outcomes.some((outcome) => outcome.status !== 'skipped');
  if (nothingToCheck) deps.log(`[suite] ci: no registered suite has tests; ${parsed.level} gate passes with nothing to check`);

  if (parsed.summary !== undefined) {
    const path = resolve(deps.env.INIT_CWD ?? process.cwd(), parsed.summary);
    try {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, ciSummaryMarkdown(parsed.level, outcomes, reports, exitCode));
    } catch (error) {
      deps.error(`[suite] ci: could not append the step summary: ${errorMessage(error)}`);
      exitCode = aggregateCiExitCode([exitCode, 1]);
    }
  }
  deps.log(`[suite] ci: ${parsed.level} gate exit ${exitCode}`);
  return exitCode;
}

function ciSummaryMarkdown(level: Level, outcomes: readonly CiSuiteOutcome[], reports: readonly SuiteRunReport[], exitCode: number): string {
  const lines = [`## Suite ${level} gate`, ''];
  if (!outcomes.some((outcome) => outcome.status !== 'skipped')) {
    lines.push(`No registered suite has tests; ${level} gate passes with nothing to check.`, '');
  }
  lines.push(`Gate exit code: **${exitCode}**`, '');
  for (const outcome of outcomes) {
    if (outcome.status === 'skipped') lines.push(`- ${outcome.suiteId}: skipped (no tests)`);
    else if (outcome.status === 'failed') {
      lines.push(`- ${outcome.suiteId}: failed (exit 1): ${firstLine(outcome.error).replace(/\|/g, '\\|')}`);
    } else lines.push(`- ${outcome.suiteId}: ran (exit ${outcome.exitCode}), run ${outcome.runId}`);
  }
  lines.push('');
  const body = reports.map((report) => renderCiSummary(report)).join('\n');
  return `${lines.join('\n')}${body ? `\n${body}` : ''}\n`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function diffCommand(parsed: Extract<ParsedCommand, { command: 'diff' }>, deps: CliDeps): number {
  const config = loadSuiteConfig(join(deps.packageDir, 'suite.config.json'));
  let report: SuiteRunReport;
  try {
    report = readRunReport(deps.packageDir, parsed.run);
  } catch (error) {
    throw new Error((error as Error).message.replace(/^\[suite\] /, '[suite] diff: '));
  }
  const relativeBaseline = relative(deps.packageDir, baselinePath(deps.packageDir, report.suiteId, report.level));

  let source: DiffBaselineSource;
  let baseline: Baseline | null = null;
  const loadErrors: string[] = [];
  const load = (text: string, origin: string) => {
    const parsedBaseline = parseBaselineJson(text, origin);
    if (parsedBaseline.ok) baseline = parsedBaseline.baseline;
    else loadErrors.push(parsedBaseline.reason);
  };

  if (parsed.mergeBase) {
    try {
      const file = (deps.mergeBase ?? ((path: string) => readMergeBaseFile(deps.packageDir, path)))(relativeBaseline);
      source = { kind: 'merge-base', ref: file.ref, path: file.path, missing: file.text === null };
      if (file.text !== null) load(file.text, `${file.ref}:${file.path}`);
    } catch (error) {
      source = { kind: 'merge-base', ref: null, path: relativeBaseline, missing: true };
      loadErrors.push((error as Error).message.replace(/^\[suite\] /, ''));
    }
  } else if (parsed.baseline !== undefined) {
    const path = resolve(deps.packageDir, parsed.baseline);
    const shown = relative(deps.packageDir, path) || path;
    const exists = existsSync(path);
    source = { kind: 'path', ref: null, path: shown, missing: !exists };
    if (!exists) loadErrors.push(`baseline file ${shown} not found`);
    else load(readFileSync(path, 'utf8'), shown);
  } else {
    const path = join(deps.packageDir, relativeBaseline);
    const exists = existsSync(path);
    source = { kind: 'default', ref: null, path: relativeBaseline, missing: !exists };
    if (exists) load(readFileSync(path, 'utf8'), relativeBaseline);
  }

  const diff = diffRun(report, baseline, config, source, loadErrors);
  const paths = writeSuiteReport({ ...report, diff }, deps.packageDir);
  for (const line of diffSummaryLines(diff, report.runId)) deps.log(line);
  deps.log(`[suite] report: ${relative(deps.packageDir, paths.json)}`);
  deps.log(`[suite] report: ${relative(deps.packageDir, paths.markdown)}`);
  return diff.exitCode;
}

/**
 * The file at `git merge-base HEAD origin/main`, never the working tree (AD-13). Throws
 * when git cannot resolve the prefix or the merge-base; `text` is null when the file does
 * not exist at that commit.
 */
export function readMergeBaseFile(packageDir: string, packageRelativePath: string): MergeBaseFile {
  const git = (args: string[]) => spawnSync('git', args, { cwd: packageDir, encoding: 'utf8' });
  const prefix = git(['rev-parse', '--show-prefix']);
  if (prefix.status !== 0) throw new Error(`[suite] git rev-parse --show-prefix failed (${firstLine(prefix.stderr)})`);
  const base = git(['merge-base', 'HEAD', 'origin/main']);
  if (base.status !== 0) throw new Error(`[suite] git merge-base HEAD origin/main failed (${firstLine(base.stderr)})`);
  const ref = base.stdout.trim();
  const path = `${prefix.stdout.trim()}${packageRelativePath.split('\\').join('/')}`;
  const listed = git(['ls-tree', '--full-tree', '--name-only', ref, '--', path]);
  if (listed.status !== 0) throw new Error(`[suite] git ls-tree ${ref} -- ${path} failed (${firstLine(listed.stderr)})`);
  if (listed.stdout.trim() === '') return { ref, path, text: null };
  const show = git(['show', `${ref}:${path}`]);
  if (show.status !== 0) throw new Error(`[suite] git show ${ref}:${path} failed (${firstLine(show.stderr)})`);
  return { ref, path, text: show.stdout };
}

function firstLine(text: string | null | undefined): string {
  return (text ?? '').trim().split('\n')[0] || 'no output';
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

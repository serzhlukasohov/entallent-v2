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
import {
  calibrate,
  calibrationLines,
  importQaExport,
  labelsPath,
  labelsSha256,
  readAgreementFile,
  readLabelsFile,
  writeAgreementFile,
  writeLabelsFile,
} from './judge/calibrate';
import type { CriterionJudge } from './judge/criterion-judge';
import type { SuiteExecutor } from './executors/types';
import { loadSuite } from './loader';
import { renderCiSummary, writeSuiteReport } from './report';
import type { RuleRegistry } from './rules/registry';
import { runSuite, type RunJudging } from './runner';
import {
  LevelSchema,
  type Baseline,
  type DiffBaselineSource,
  type Level,
  type LoadedSuite,
  type SuiteConfig,
  type SuiteRunReport,
} from './schema';

/**
 * `suite:run`, `suite:baseline:accept`, `suite:diff`, `suite:ci` and `suite:calibrate`
 * (architecture AD-8, AD-11, AD-13, AD-14, AD-15).
 * `run` and `baseline:accept` exit 0 when a report (or baseline) was written, whatever the
 * verdict, and 1 on usage, config, load or refusal errors; `run` exits 4 when a call budget
 * was exceeded (the report and case runs are still written). `diff` exits 0 clean, 1 gating
 * entry, 2 baseline-invalid, 3 judge infrastructure, 4 budget exceeded; usage errors and an
 * unreadable run report are 1 and write nothing. `ci` runs and merge-base-diffs every
 * registered suite that has tests and exits with the first code present by precedence
 * 2 > 3 > 4 > 1 over all suites (a load or run failure counts as 1), else 0. `calibrate`
 * exits 0 when the import or agreement file was written, 1 on usage, config, load, label
 * or export errors (and without a judge unless `--import` is given), 3 when any label was
 * judged ERROR (the file is still written). This entry wires no judge and no L1 executor:
 * the live judge is reachable only through `judge/calibrate-live.ts` and `run-live.ts`, the
 * live coach provider only through `run-live.ts`. This CLI never loads `.env` and never
 * prints environment values.
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
  /** The judge `suite:calibrate` judges labels with; absent in the default entry (no model egress). */
  createCalibrationJudge?: (judge: SuiteConfig['judge'], options: JudgeCallOptions) => CriterionJudge;
  /**
   * The judge an L1/L2 `suite:run` calls, built with the model actually called; absent in
   * the default entry (no model egress). `suite/run-live.ts` wires the live pinned judge.
   */
  createRunJudge?: (judge: SuiteConfig['judge'], options: JudgeCallOptions) => CriterionJudge;
}

/** Per-call judge settings from `suite.config.json` that are not part of the fingerprint. */
export interface JudgeCallOptions {
  /** `budgets.judgeCallTimeoutMs`. */
  callTimeoutMs: number;
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
  suite:run --suite <id> --level L0 [--runs N] [--case <id>] [--allow-unpinned-judge]
      Runs a suite and writes runs/suites/<runId>/report.{json,md} and case-runs.json.
      Only L0 runs from this entry (offline, no model credentials). L1 calls live models and
      runs only from the gated live entry (L2 lands in Epic 14):
  suite:run:live --suite <id> --level L1 --live-model [--runs N] [--case <id>] [--allow-unpinned-judge]
      Runs L1 through the real orchestrator with the live coach provider and the pinned judge
      (calls OpenAI or Azure OpenAI; human-run, never in CI; LANGWATCH_API_KEY optionally streams
      the conversations). Refuses without --live-model. At L1/L2 SIM_JUDGE_MODEL must be unset
      or equal the pinned judge model; with --allow-unpinned-judge a different model is called
      and the run is untrusted (unpinned-judge). Meaning checks count only when the judge is calibrated.
      Budgets (suite.config.json budgets): at most maxCoachCallsPerRun coach and maxJudgeCallsPerRun
      judge calls per invocation (all --runs samples and retries together); once one is spent the
      remaining cases are ERROR budget-exceeded, the run is provisional and the command exits 4.
      Each coach call times out after coachCallTimeoutMs, each judge call after judgeCallTimeoutMs.
  suite:baseline:accept --run <runId> [--allow-incomplete] [--allow-dirty] [--ci-run-url <url>]
      Writes baselines/<suiteId>/<level>.json from a run report. An L1/L2 run from an untrusted
      judge is accepted with its meaning results marked advisory; they diff as inconclusive until
      re-accepted from a trusted run.
  suite:diff --run <runId> [--baseline <path> | --merge-base]
      Diffs a run against a baseline (default: working-tree baselines/<suite>/<level>.json;
      --merge-base: the file at git merge-base HEAD origin/main) and writes it into the report.
  suite:ci --level L0 [--summary <path>]
      For every suite in suite.config.json that has tests: suite:run (n=1) then
      suite:diff --merge-base. Suites without tests are skipped. --summary appends a
      Markdown step summary (no evidence or transcript text) to <path>.
  suite:calibrate --suite <id> [--import <qa-export.json>]
      --import appends the QA export's labels to calibration/<id>/labels.json (deduplicated on
      criterion and transcript hash; any invalid entry rejects the whole import). Without a
      wired judge, calibration itself is skipped; this entry wires none, so a calibration run
      is suite:calibrate:live --suite <id> --live-judge (calls the pinned judge model; human-run).
      With a judge it judges every label and writes the agreement file under calibration/<id>/.

Exit codes (run, baseline:accept): 0 report or baseline written; 1 usage, config, load or refusal error;
  4 (run) a call budget was exceeded (the report is still written).
Exit codes (diff): 0 clean or no baseline; 1 gating regression or lost coverage (also usage errors
  and an unreadable run report); 2 baseline invalid; 3 judge infrastructure; 4 budget exceeded.
Exit code (ci): the first present over all suites by precedence 2 > 3 > 4 > 1 (a load or run
  failure counts as 1); 0 when every suite is clean, has no baseline, or is skipped.
Exit codes (calibrate): 0 import done or agreement file written; 1 usage, config, unknown suite,
  load, invalid labels or export, unresolvable label, or no judge without --import; 3 any judge ERROR
  (the agreement file is still written).`;

export type ParsedCommand =
  | { command: 'help' }
  | { command: 'run'; suite: string; level: Level; runs: number; case?: string; allowUnpinnedJudge?: true }
  | { command: 'baseline:accept'; run: string; allowIncomplete: boolean; allowDirty: boolean; ciRunUrl?: string }
  | { command: 'diff'; run: string; baseline?: string; mergeBase: boolean }
  | { command: 'ci'; level: Level; summary?: string }
  | { command: 'calibrate'; suite: string; import?: string };

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
          'allow-unpinned-judge': { type: 'boolean' },
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
      return {
        command: 'run',
        suite: values.suite,
        level: level.data,
        runs,
        ...(values.case !== undefined ? { case: values.case } : {}),
        ...(values['allow-unpinned-judge'] === true ? { allowUnpinnedJudge: true as const } : {}),
      };
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
    if (command === 'calibrate') {
      const { values } = parseNodeArgs({
        args: tail,
        strict: true,
        allowPositionals: false,
        options: {
          suite: { type: 'string' },
          import: { type: 'string' },
          help: { type: 'boolean', short: 'h' },
        },
      });
      if (values.help) return { command: 'help' };
      if (!values.suite) throw new CliUsageError('[suite] calibrate: --suite <id> is required');
      if (values.import !== undefined && values.import.trim() === '') throw new CliUsageError('[suite] calibrate: --import must not be empty');
      return { command: 'calibrate', suite: values.suite, ...(values.import !== undefined ? { import: values.import } : {}) };
    }
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
    if (parsed.command === 'calibrate') return await calibrateCommand(parsed, deps);
    return acceptCommand(parsed, deps);
  } catch (error) {
    deps.error(error instanceof Error ? error.message : String(error));
    if (error instanceof CliUsageError) deps.error('Run with --help for usage.');
    return 1;
  }
}

async function runCommand(parsed: Extract<ParsedCommand, { command: 'run' }>, deps: CliDeps): Promise<number> {
  const report = await performRun(parsed, deps);
  return (report.budget?.exceeded.length ?? 0) > 0 ? 4 : 0;
}

interface RunOverrides {
  /** An already loaded suite (`ci` loads first to skip empty suites). */
  suite?: LoadedSuite;
  /** Picks the run id; `ci` uses it to keep run ids unique within one invocation. */
  runId?: (shortSha: string | null) => string;
}

/** The `suite:run` path; returns the written report. */
async function performRun(
  parsed: Extract<ParsedCommand, { command: 'run' }>,
  deps: CliDeps,
  overrides: RunOverrides = {},
): Promise<SuiteRunReport> {
  const config = loadSuiteConfig(join(deps.packageDir, 'suite.config.json'));
  if (!config.suites.includes(parsed.suite)) {
    throw new Error(`[suite] unknown suite ${parsed.suite}; known suites: ${config.suites.join(', ')}`);
  }
  if (!config.levels.includes(parsed.level)) {
    throw new Error(`[suite] level ${parsed.level} is not enabled in suite.config.json`);
  }

  let calledModel: { model: string; unpinned: boolean } | null = null;
  if (parsed.level === 'L0') {
    const removed = scrubModelCredentials(deps.env);
    if (removed.length > 0) deps.log(`[suite] L0: removed model credentials from the environment (${removed.join(', ')})`);
  } else {
    calledModel = judgeModelToCall(config.judge.model, deps.env.SIM_JUDGE_MODEL, parsed.allowUnpinnedJudge === true);
  }

  const suite = overrides.suite ?? deps.loadSuite(parsed.suite);
  const executor = deps.createExecutor(parsed.level);
  let judging: RunJudging | undefined;
  if (calledModel !== null) {
    if (!deps.createRunJudge) {
      throw new Error(`[suite] ${parsed.level} run needs a judge; this entry wires none (suite:run:live wires the pinned judge)`);
    }
    const labels = readLabelsFile(deps.packageDir, suite.id);
    const agreement = readAgreementFile(deps.packageDir, suite.id);
    judging = {
      judge: deps.createRunJudge({ ...config.judge, model: calledModel.model }, { callTimeoutMs: config.budgets.judgeCallTimeoutMs }),
      model: calledModel.model,
      unpinned: calledModel.unpinned,
      agreement,
      labelsSha256: labelsSha256(labels.labels),
    };
    if (calledModel.unpinned) deps.log(`[suite] judge model differs from the pin ${config.judge.model}; this run is untrusted (unpinned-judge)`);
  }
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
    ...(judging !== undefined ? { judging } : {}),
    log: deps.log,
  });

  const paths = writeSuiteReport(report, deps.packageDir);
  const caseRunsPath = join(deps.packageDir, 'runs', 'suites', report.runId, 'case-runs.json');
  writeFileSync(caseRunsPath, `${JSON.stringify({ schemaVersion: 1, runId: report.runId, caseRuns }, null, 2)}\n`);

  for (const line of summaryLines(report)) deps.log(line);
  deps.log(`[suite] report: ${relative(deps.packageDir, paths.json)}`);
  deps.log(`[suite] report: ${relative(deps.packageDir, paths.markdown)}`);
  deps.log(`[suite] case runs: ${relative(deps.packageDir, caseRunsPath)}`);
  return report;
}

/**
 * The judge model an L1/L2 run calls (AD-8): the pin unless `SIM_JUDGE_MODEL` names another
 * model, which is refused without `--allow-unpinned-judge`. Never prints the env value.
 */
export function judgeModelToCall(
  pinned: string,
  override: string | undefined,
  allowUnpinned: boolean,
): { model: string; unpinned: boolean } {
  const model = override?.trim() ?? '';
  if (model === '' || model === pinned) return { model: pinned, unpinned: false };
  if (!allowUnpinned) {
    throw new Error(`[suite] SIM_JUDGE_MODEL differs from the pinned judge model ${pinned}; pass --allow-unpinned-judge for an untrusted run`);
  }
  return { model, unpinned: true };
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
      runId = (await performRun({ command: 'run', suite: suiteId, level: parsed.level, runs: 1 }, deps, { suite, runId: uniqueRunId })).runId;
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

const liveHint = (suiteId: string) => `pnpm suite:calibrate:live --suite ${suiteId} --live-judge`;

/** `suite:calibrate` (AD-8): optional QA-export import, then calibration when a judge is wired. */
async function calibrateCommand(parsed: Extract<ParsedCommand, { command: 'calibrate' }>, deps: CliDeps): Promise<number> {
  const config = loadSuiteConfig(join(deps.packageDir, 'suite.config.json'));
  if (!config.suites.includes(parsed.suite)) {
    throw new Error(`[suite] unknown suite ${parsed.suite}; known suites: ${config.suites.join(', ')}`);
  }
  if (!deps.createCalibrationJudge && parsed.import === undefined) {
    deps.error(`[suite] calibrate: this entry wires no judge, so nothing was calibrated or written.`);
    deps.error(`[suite] calibrate: to judge the labels with the pinned model (human-run, model egress), run ${liveHint(parsed.suite)}`);
    return 1;
  }
  // Built before any import, so a failing factory (e.g. missing credentials) writes nothing.
  const judge = deps.createCalibrationJudge
    ? deps.createCalibrationJudge(config.judge, { callTimeoutMs: config.budgets.judgeCallTimeoutMs })
    : null;
  const suite = deps.loadSuite(parsed.suite);
  const shownLabels = relative(deps.packageDir, labelsPath(deps.packageDir, suite.id));

  if (parsed.import !== undefined) {
    const path = resolve(deps.env.INIT_CWD ?? process.cwd(), parsed.import);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw new Error(`[suite] import: cannot read ${parsed.import} as JSON (${errorMessage(error)})`);
    }
    const existing = readLabelsFile(deps.packageDir, suite.id);
    const imported = importQaExport(suite, existing, raw);
    if (!imported.ok) {
      for (const line of imported.errors) deps.error(line);
      deps.error(`[suite] import: rejected; nothing was written`);
      return 1;
    }
    for (const line of imported.warnings) deps.log(line);
    if (imported.added.length > 0) writeLabelsFile(deps.packageDir, suite.id, imported.file);
    deps.log(
      `[suite] import: ${imported.added.length} label(s) added, ${imported.warnings.length} duplicate(s) skipped; ${shownLabels} has ${imported.file.labels.length} label(s)`,
    );
    if (!judge) {
      deps.log(`[suite] calibrate: calibration skipped (no judge wired); run ${liveHint(parsed.suite)} to calibrate`);
      return 0;
    }
  }

  const labels = readLabelsFile(deps.packageDir, suite.id);
  deps.log(`[suite] calibrate ${suite.id}: ${labels.labels.length} label(s), judge ${config.judge.provider}/${config.judge.model}`);
  if (!judge) throw new Error('[suite] calibrate: no judge wired');
  const result = await calibrate({ suite, labels, judge, judgeConfig: config.judge, now: deps.now });
  const written = writeAgreementFile(deps.packageDir, suite.id, result.agreement);
  for (const line of calibrationLines(result, config.judge.minLabels)) deps.log(line);
  deps.log(`[suite] agreement: ${relative(deps.packageDir, written)}`);
  if (result.judgeErrors > 0) {
    deps.error(`[suite] calibrate: ${result.judgeErrors} label(s) judged ERROR (counted as disagreements)`);
    return 3;
  }
  return 0;
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
    currentFingerprint = currentJudgeFingerprint(report.level, config, report.level === 'L0' ? null : deps.loadSuite(report.suiteId));
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
  const advisory = Object.values(baseline.results).filter((entry) => entry.advisory === true).length;
  if (advisory > 0) {
    deps.log(
      `[suite] baseline: ${advisory} meaning result(s) are advisory (${report.judgeTrust.reason}); they diff as inconclusive until re-accepted from a trusted run`,
    );
  }
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
  const budget = report.budget;
  if (budget !== undefined && budget.exceeded.length > 0) {
    lines.push(
      `[suite] budget exceeded: ${budget.exceeded.join(', ')} (coach ${budget.coachCalls}/${budget.maxCoachCalls}, judge ${budget.judgeCalls}/${budget.maxJudgeCalls})`,
    );
  }
  const trust = report.judgeTrust;
  lines.push(`[suite] meaning checks: ${trust.trusted ? 'trusted' : 'advisory (uncalibrated)'} (${trust.reason})`);
  const qa = report.qaReview?.length ?? 0;
  if (qa > 0) lines.push(`[suite] QA review: ${qa} meaning FAIL(s) listed in report.md`);
  return lines;
}

function unsupportedLevel(level: Level): string {
  if (level === 'L2') return '[suite] L2 executor lands in Epic 14';
  return `[suite] ${level} runs call live models; run suite:run:live with --live-model (model egress and cost are a human boundary)`;
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

import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { config as loadEnv } from 'dotenv';
import type { ScenarioRunReport } from '../harness/report';
import { classifyFailure } from './failure-classifier';

interface GateConfig {
  runs: number;
  infraRetries: number;
  scenarios: GateScenario[];
}

interface GateScenario {
  id: string;
  name: string;
  file: string;
  hardPasses: number;
  judgePasses: number;
  migrationCases?: string[];
  manualReviewRequired?: boolean;
}

interface SampleResult {
  scenarioId: string;
  runNumber: number;
  attempts: number;
  runId: string;
  status: 'hard_passed' | 'hard_failed' | 'infra_failed';
  hardPassed: boolean;
  judgePassed: boolean;
  exitCode: number | null;
  durationMs: number;
  logFile: string;
  reportFiles: string[];
  judgeFailures: string[];
  failureReason: string | null;
}

type GateStatus = 'passed' | 'failed' | 'manual_review_required';

interface ScenarioSummary {
  id: string;
  name: string;
  file: string;
  migrationCases: string[];
  manualReviewRequired: boolean;
  status: GateStatus;
  requiredHardPasses: number;
  requiredJudgePasses: number;
  hardPasses: number;
  judgePasses: number;
  infraFailures: number;
  hardFailures: number;
  samples: SampleResult[];
}

interface GateSummary {
  schemaVersion: 1;
  gateId: string;
  runAt: string;
  status: GateStatus;
  git: {
    sha: string | null;
    dirty: boolean;
  };
  models: {
    coachBalanced: string | null;
    simulator: string | null;
    judge: string | null;
    azureTestingDeployment: string | null;
  };
  config: {
    runs: number;
    infraRetries: number;
  };
  manualReview: {
    requiredScenarioIds: string[];
    requiredCaseIds: string[];
  };
  scenarios: ScenarioSummary[];
}

const PACKAGE_DIR = process.cwd();
const REPO_ROOT = join(PACKAGE_DIR, '../..');
const CONFIG_PATH = join(PACKAGE_DIR, 'gate.config.json');

loadEnv({ path: join(REPO_ROOT, '.env') });

async function main(): Promise<void> {
  const config = readGateConfig();
  const runs = readRunsOverride(config.runs);
  const git = readGitState();
  const gateId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${git.sha ?? 'unknown'}`;
  const reportDir = join(PACKAGE_DIR, 'runs', 'gates', gateId);

  mkdirSync(reportDir, { recursive: true });

  console.log(`[sim:gate] gate=${gateId} runs=${runs} reports=${relative(reportDir)}`);

  const scenarios: ScenarioSummary[] = [];
  for (const scenario of config.scenarios) {
    const samples: SampleResult[] = [];
    console.log(`[sim:gate] scenario=${scenario.id} file=${scenario.file}`);

    for (let runNumber = 1; runNumber <= runs; runNumber += 1) {
      const sample = runSampleWithRetry({
        gateId,
        reportDir,
        scenario,
        runNumber,
        infraRetries: config.infraRetries,
        gitSha: git.sha,
      });
      samples.push(sample);
      console.log(
        `[sim:gate] ${scenario.id} ${runNumber}/${runs} ${sample.status} hard=${formatBool(sample.hardPassed)} judge=${formatBool(sample.judgePassed)} attempts=${sample.attempts}`,
      );
    }

    const requiredHardPasses = scaleThreshold(scenario.hardPasses, config.runs, runs);
    const requiredJudgePasses = scaleThreshold(scenario.judgePasses, config.runs, runs);
    const hardPasses = samples.filter((sample) => sample.hardPassed).length;
    const judgePasses = samples.filter((sample) => sample.judgePassed).length;
    const infraFailures = samples.filter((sample) => sample.status === 'infra_failed').length;
    const hardFailures = samples.filter((sample) => sample.status === 'hard_failed').length;
    const thresholdStatus =
      hardPasses >= requiredHardPasses && judgePasses >= requiredJudgePasses && infraFailures === 0
        ? 'passed'
        : 'failed';
    const status =
      thresholdStatus === 'passed' && scenario.manualReviewRequired
        ? 'manual_review_required'
        : thresholdStatus;

    scenarios.push({
      id: scenario.id,
      name: scenario.name,
      file: scenario.file,
      migrationCases: scenario.migrationCases ?? [],
      manualReviewRequired: scenario.manualReviewRequired === true,
      status,
      requiredHardPasses,
      requiredJudgePasses,
      hardPasses,
      judgePasses,
      infraFailures,
      hardFailures,
      samples,
    });
  }

  const summary: GateSummary = {
    schemaVersion: 1,
    gateId,
    runAt: new Date().toISOString(),
    status: summarizeGateStatus(scenarios),
    git,
    models: {
      coachBalanced: process.env.OPENAI_MODEL_BALANCED ?? null,
      simulator: process.env.SIM_SIMULATOR_MODEL ?? 'gpt-4o-mini',
      judge: process.env.SIM_JUDGE_MODEL ?? 'gpt-4o',
      azureTestingDeployment: process.env.AZURE_OPENAI_TESTING_DEPLOYMENT ?? null,
    },
    config: {
      runs,
      infraRetries: config.infraRetries,
    },
    manualReview: {
      requiredScenarioIds: scenarios
        .filter((scenario) => scenario.manualReviewRequired)
        .map((scenario) => scenario.id),
      requiredCaseIds: [
        ...new Set(
          scenarios
            .filter((scenario) => scenario.manualReviewRequired)
            .flatMap((scenario) => scenario.migrationCases),
        ),
      ],
    },
    scenarios,
  };

  writeFileSync(join(reportDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  writeFileSync(join(reportDir, 'summary.md'), buildSummaryMarkdown(summary), 'utf8');

  console.log(
    `[sim:gate] status=${summary.status} summary=${relative(join(reportDir, 'summary.md'))}`,
  );
  if (summary.status !== 'passed') {
    process.exitCode = 1;
  }
}

function runSampleWithRetry(args: {
  gateId: string;
  reportDir: string;
  scenario: GateScenario;
  runNumber: number;
  infraRetries: number;
  gitSha: string | null;
}): SampleResult {
  let lastResult: SampleResult | null = null;
  const maxAttempts = args.infraRetries + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = runSample({
      ...args,
      attempt,
      runId: `${args.scenario.id}-${args.runNumber}-attempt-${attempt}`,
    });

    lastResult = result;
    if (result.status !== 'infra_failed') return result;
  }

  return lastResult!;
}

function runSample(args: {
  gateId: string;
  reportDir: string;
  scenario: GateScenario;
  runNumber: number;
  attempt: number;
  runId: string;
  gitSha: string | null;
}): SampleResult {
  const startedAt = Date.now();
  const command = spawnSync('pnpm', ['exec', 'vitest', 'run', args.scenario.file], {
    cwd: PACKAGE_DIR,
    encoding: 'utf8',
    maxBuffer: 40 * 1024 * 1024,
    env: {
      ...process.env,
      SIM_GATE_ID: args.gateId,
      SIM_GATE_RUN_ID: args.runId,
      SIM_GATE_SCENARIO_ID: args.scenario.id,
      SIM_GATE_ATTEMPT: String(args.attempt),
      SIM_GATE_REPORT_DIR: args.reportDir,
      SIM_GATE_GIT_SHA: args.gitSha ?? '',
    },
  });
  const durationMs = Date.now() - startedAt;
  const output = `${command.stdout ?? ''}\n${command.stderr ?? ''}`;
  const logFile = join(args.reportDir, `${slugify(args.runId)}.log`);
  writeFileSync(logFile, output, 'utf8');

  const reports = readReports(args.reportDir, args.gateId, args.runId);
  const reportFiles = reports.map((report) => `${report.scenarioSlug}-${slugify(args.runId)}.json`);
  const hardPassed = command.status === 0 && reports.length > 0;
  const evaluatedJudgeReports = reports.filter((report) => report.judge.evaluated !== false);
  const judgeRequired = args.scenario.judgePasses > 0;
  const judgePassed = judgeRequired
    ? evaluatedJudgeReports.length > 0 &&
      evaluatedJudgeReports.every((report) => report.judge.passed)
    : true;
  const judgeFailures = evaluatedJudgeReports
    .filter((report) => !report.judge.passed)
    .map(
      (report) =>
        `${report.scenarioName}: ${report.judge.reasoning ?? 'judge failed without reasoning'}`,
    );
  if (judgeRequired && evaluatedJudgeReports.length === 0) {
    judgeFailures.push(
      'No evaluated LLM judge report was produced for a scenario with judgePasses > 0.',
    );
  }
  const failureReason = buildFailureReason(command.status, output, reports);
  const failureKind = classifyFailure({
    exitCode: command.status,
    output,
    reportCount: reports.length,
  });
  const status = hardPassed
    ? 'hard_passed'
    : failureKind === 'infrastructure'
      ? 'infra_failed'
      : 'hard_failed';

  return {
    scenarioId: args.scenario.id,
    runNumber: args.runNumber,
    attempts: args.attempt,
    runId: args.runId,
    status,
    hardPassed,
    judgePassed,
    exitCode: command.status,
    durationMs,
    logFile: relative(logFile),
    reportFiles,
    judgeFailures,
    failureReason,
  };
}

function readReports(reportDir: string, gateId: string, runId: string): ScenarioRunReport[] {
  return readdirSync(reportDir)
    .filter((fileName) => fileName.endsWith('.json') && fileName !== 'summary.json')
    .map((fileName) => {
      const raw = readFileSync(join(reportDir, fileName), 'utf8');
      return JSON.parse(raw) as ScenarioRunReport;
    })
    .filter((report) => report.gateId === gateId && report.gateRunId === runId);
}

function readGateConfig(): GateConfig {
  const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as GateConfig;
  if (!Number.isInteger(parsed.runs) || parsed.runs < 1) {
    throw new Error('gate.config.json must define runs as a positive integer.');
  }
  if (!Number.isInteger(parsed.infraRetries) || parsed.infraRetries < 0) {
    throw new Error('gate.config.json must define infraRetries as a non-negative integer.');
  }
  if (!Array.isArray(parsed.scenarios) || parsed.scenarios.length === 0) {
    throw new Error('gate.config.json must define at least one scenario.');
  }
  return parsed;
}

function readRunsOverride(defaultRuns: number): number {
  const value = process.env.SIM_GATE_RUNS;
  if (!value) return defaultRuns;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`SIM_GATE_RUNS must be a positive integer, received ${value}.`);
  }
  return parsed;
}

function summarizeGateStatus(scenarios: ScenarioSummary[]): GateStatus {
  if (scenarios.some((scenario) => scenario.status === 'failed')) return 'failed';
  if (scenarios.some((scenario) => scenario.status === 'manual_review_required')) {
    return 'manual_review_required';
  }
  return 'passed';
}

function scaleThreshold(
  configuredThreshold: number,
  configuredRuns: number,
  actualRuns: number,
): number {
  return Math.min(actualRuns, Math.ceil((configuredThreshold / configuredRuns) * actualRuns));
}

function readGitState(): GateSummary['git'] {
  const sha = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  const dirty = spawnSync('git', ['status', '--porcelain'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return {
    sha: sha.status === 0 ? sha.stdout.trim() : null,
    dirty: dirty.status === 0 ? dirty.stdout.trim().length > 0 : true,
  };
}

function buildFailureReason(
  exitCode: number | null,
  output: string,
  reports: ScenarioRunReport[],
): string | null {
  if (exitCode === 0 && reports.length > 0) return null;
  if (reports.length === 0) {
    return 'Vitest produced no scenario JSON report. See the sample log for the subprocess output.';
  }
  const deterministicFailures = reports.flatMap((report) =>
    report.deterministic.violations.map(
      (violation) =>
        `${report.scenarioName} turn ${violation.turn} ${violation.rule}: ${violation.detail}`,
    ),
  );
  if (deterministicFailures.length > 0) return deterministicFailures.join('\n');
  const assertionLine = output
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('AssertionError'));
  if (assertionLine) return assertionLine;

  const failLine = output
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.includes('FAIL  src/'));
  return failLine ?? `Vitest exited with code ${exitCode ?? 'unknown'}.`;
}

function buildSummaryMarkdown(summary: GateSummary): string {
  const lines = [
    '# Conversation Sim Gate',
    '',
    `Run at ${summary.runAt}`,
    `Status: ${summary.status.toUpperCase()}`,
    `Git: ${summary.git.sha ?? 'unknown'}${summary.git.dirty ? ' (dirty)' : ''}`,
    `Models: coach=${summary.models.coachBalanced ?? 'default'} simulator=${summary.models.simulator ?? 'default'} judge=${summary.models.judge ?? 'default'} azureTestingDeployment=${summary.models.azureTestingDeployment ?? 'none'}`,
    `Config: ${summary.config.runs} runs, ${summary.config.infraRetries} infra retry per sample`,
    '',
    '| Scenario | Hard | Judge | Infra | Status |',
    '| --- | ---: | ---: | ---: | --- |',
    ...summary.scenarios.map(
      (scenario) =>
        `| ${scenario.name} | ${scenario.hardPasses}/${summary.config.runs} need ${scenario.requiredHardPasses} | ${scenario.judgePasses}/${summary.config.runs} need ${scenario.requiredJudgePasses} | ${scenario.infraFailures} | ${scenario.status.toUpperCase()} |`,
    ),
    '',
    '## Manual review required',
    '',
    summary.manualReview.requiredScenarioIds.length === 0
      ? 'none'
      : summary.manualReview.requiredScenarioIds
          .map((scenarioId) => {
            const scenario = summary.scenarios.find((entry) => entry.id === scenarioId);
            const cases = scenario?.migrationCases.join(', ') || 'unmapped';
            return `- ${scenario?.name ?? scenarioId}: ${cases}`;
          })
          .join('\n'),
    '',
    '## Samples',
    '',
    ...summary.scenarios.flatMap((scenario) => [
      `### ${scenario.name}`,
      '',
      '| Run | Hard | Judge | Attempts | Duration | Log | Reports |',
      '| ---: | --- | --- | ---: | ---: | --- | --- |',
      ...scenario.samples.map(
        (sample) =>
          `| ${sample.runNumber} | ${formatBool(sample.hardPassed)} | ${formatBool(sample.judgePassed)} | ${sample.attempts} | ${Math.round(sample.durationMs / 1000)}s | ${basename(sample.logFile)} | ${sample.reportFiles.join(', ') || 'none'} |`,
      ),
      '',
      ...scenario.samples
        .filter((sample) => sample.failureReason || sample.judgeFailures.length > 0)
        .flatMap((sample) => [
          `Run ${sample.runNumber} notes:`,
          sample.failureReason ? `- hard: ${sample.failureReason}` : '',
          ...sample.judgeFailures.map((failure) => `- judge: ${failure}`),
          '',
        ])
        .filter((line) => line !== ''),
    ]),
  ];
  return lines.join('\n');
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function relative(path: string): string {
  return path.startsWith(`${PACKAGE_DIR}/`) ? path.slice(PACKAGE_DIR.length + 1) : path;
}

function formatBool(value: boolean): string {
  return value ? 'PASS' : 'FAIL';
}

void main();

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeJudgeFingerprint } from './judge/fingerprint';
import {
  BaselineSchema,
  SuiteRunReportSchema,
  type Baseline,
  type BaselineResult,
  type JudgeFingerprint,
  type Level,
  type LoadedSuite,
  type SuiteConfig,
  type SuiteRunReport,
} from './schema';

/**
 * Baseline acceptance (architecture AD-11): refusal rules, a deterministic baseline built
 * from a run report, and the only file I/O for `baselines/<suiteId>/<level>.json`.
 */

const SAFE_ID = /^[A-Za-z0-9._-]+$/;

export function isSafeId(id: string): boolean {
  return SAFE_ID.test(id) && !/^\.+$/.test(id);
}

/** The current judge fingerprint for a level: none at L0, else the configured pin over the suite (AD-8). */
export function currentJudgeFingerprint(
  level: Level,
  config: Pick<SuiteConfig, 'judge'>,
  suite: Pick<LoadedSuite, 'tests'> | null,
): JudgeFingerprint | null {
  if (level === 'L0') return null;
  if (suite === null) throw new Error(`[suite] judge fingerprint for ${level} needs the suite`);
  return computeJudgeFingerprint(config.judge, suite);
}

export interface BaselineRefusalOptions {
  config: SuiteConfig;
  currentFingerprint: JudgeFingerprint | null;
  allowIncomplete: boolean;
  allowDirty: boolean;
}

/** Every reason the run cannot become the baseline; empty when it can. */
export function baselineRefusals(report: SuiteRunReport, options: BaselineRefusalOptions): string[] {
  const refusals: string[] = [];
  const minSamples = options.config.baseline.minSamples[report.level];
  if (!options.config.suites.includes(report.suiteId)) {
    refusals.push(`suite ${report.suiteId} is not registered in suite.config.json`);
  }
  if (report.n < minSamples) {
    refusals.push(`n ${report.n} is below baseline.minSamples.${report.level} ${minSamples}`);
  }
  if (!report.complete && !options.allowIncomplete) {
    refusals.push(
      `run is INCOMPLETE${report.provisionalReason ? ` (${report.provisionalReason})` : ''}; pass --allow-incomplete to accept it as provisional`,
    );
  }
  if (report.git.dirty && !options.allowDirty) {
    refusals.push('run was made from a dirty working tree; pass --allow-dirty to accept it');
  }
  if (report.git.sha === null) refusals.push('run has no git sha');
  if (report.selection !== undefined) {
    refusals.push(`run was narrowed with --case ${report.selection.case}; accept only a full-suite run`);
  }
  if (stableJson(report.judgeTrust.pin ?? null) !== stableJson(options.currentFingerprint)) {
    refusals.push('judge fingerprint of the run differs from the current one');
  }
  // The pin stays the configured fingerprint on an unpinned run, so compare the model called.
  const pin = report.judgeTrust.pin;
  if (report.level !== 'L0' && pin !== null && report.models.judge !== pin.model) {
    refusals.push(`run called judge model ${report.models.judge ?? 'none'}, not the pinned ${pin.model}`);
  }
  // Manifest NOT TESTABLE rows (testKind null) are in scope but no test executed them.
  if (!Object.values(report.results).some((result) => result.inScope && result.testKind !== null)) {
    refusals.push('run has no in-scope test criteria');
  }
  return refusals;
}

/** Baseline from a run: in-scope results only, keys sorted, so accepting twice differs only in `acceptedAt`. */
export function buildBaseline(report: SuiteRunReport, options: { acceptedAt: string; ciRunUrl?: string }): Baseline {
  if (report.git.sha === null) throw new Error('[suite] baseline: run has no git sha');
  const results: Record<string, BaselineResult> = {};
  for (const key of Object.keys(report.results).sort()) {
    const result = report.results[key]!;
    if (!result.inScope) continue;
    results[key] = {
      status: result.status,
      passCount: result.passCount,
      n: result.n,
      layer: result.layer,
      testKind: result.testKind,
      checkKind: result.checkKind,
    };
  }
  const baseline = {
    schemaVersion: 1 as const,
    suiteId: report.suiteId,
    level: report.level,
    judge: { fingerprint: report.judgeTrust.pin ?? null, agreement: report.judgeTrust.agreement ?? null },
    coach: { model: report.models.coach },
    acceptedFrom: {
      runId: report.runId,
      gitSha: report.git.sha,
      ...(options.ciRunUrl !== undefined ? { ciRunUrl: options.ciRunUrl } : {}),
    },
    acceptedAt: options.acceptedAt,
    provisional: report.provisional || !report.complete,
    results,
  };
  return BaselineSchema.parse(baseline) as Baseline;
}

export function baselinePath(packageDir: string, suiteId: string, level: Level): string {
  if (!isSafeId(suiteId)) throw new Error(`[suite] baseline: unsafe suite id ${suiteId}`);
  return join(packageDir, 'baselines', suiteId, `${level}.json`);
}

export function serializeBaseline(baseline: Baseline): string {
  return `${JSON.stringify(BaselineSchema.parse(baseline), null, 2)}\n`;
}

/** Writes `<packageDir>/baselines/<suiteId>/<level>.json`; returns the path. */
export function writeBaseline(baseline: Baseline, packageDir: string): string {
  const path = baselinePath(packageDir, baseline.suiteId, baseline.level);
  mkdirSync(join(packageDir, 'baselines', baseline.suiteId), { recursive: true });
  writeFileSync(path, serializeBaseline(baseline));
  return path;
}

/** Reads `<packageDir>/runs/suites/<runId>/report.json` and validates it. */
export function readRunReport(packageDir: string, runId: string): SuiteRunReport {
  if (!isSafeId(runId)) throw new Error(`[suite] unsafe run id ${runId}`);
  const path = join(packageDir, 'runs', 'suites', runId, 'report.json');
  if (!existsSync(path)) throw new Error(`[suite] run ${runId} not found under runs/suites/`);
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`[suite] run ${runId}: report.json is not valid JSON (${(error as Error).message})`);
  }
  const parsed = SuiteRunReportSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`[suite] run ${runId}: report.json is invalid at ${issue?.path.join('.') || '(root)'}: ${issue?.message ?? 'invalid'}`);
  }
  if (parsed.data.runId !== runId) throw new Error(`[suite] run ${runId}: report.json names run ${parsed.data.runId}`);
  return parsed.data as SuiteRunReport;
}

/** JSON with object keys sorted at every level. */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

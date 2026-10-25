import { stableJson } from './baseline';
import {
  BaselineSchema,
  DiffCategorySchema,
  SuiteDiffSchema,
  type Baseline,
  type BaselineResult,
  type CheckKind,
  type CriterionStatus,
  type DiffBaselineSource,
  type DiffCategory,
  type DiffEntry,
  type DiffSection,
  type Layer,
  type ScoredCriterion,
  type SuiteConfig,
  type SuiteDiff,
  type SuiteRunReport,
  type TestKind,
} from './schema';

/**
 * Per-criterion diff of a run against a baseline (architecture AD-13). Pure: the CLI reads
 * the baseline (path, working tree or merge-base) and writes the result into the report.
 *
 * Exit codes, first match wins: 2 baseline-invalid, 3 judge infrastructure, 4 budget
 * exceeded, 1 any gating entry, 0 otherwise.
 */

export const DIFF_CATEGORIES: readonly DiffCategory[] = DiffCategorySchema.options;

const DECIDED: readonly CriterionStatus[] = ['PASS', 'FAIL'];
const UNDECIDED: readonly CriterionStatus[] = ['NOT_RUN', 'ERROR', 'INVALID'];

export type ParsedBaseline = { ok: true; baseline: Baseline } | { ok: false; reason: string };

/** Parses and validates a baseline file's text; `origin` names it in the reason. */
export function parseBaselineJson(text: string, origin: string): ParsedBaseline {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { ok: false, reason: `baseline ${origin} is not valid JSON (${(error as Error).message})` };
  }
  const parsed = BaselineSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      reason: `baseline ${origin} is invalid at ${issue?.path.join('.') || '(root)'}: ${issue?.message ?? 'invalid'}`,
    };
  }
  return { ok: true, baseline: parsed.data as Baseline };
}

/** Provenance mismatches that make the baseline unusable for this run; empty when usable. */
export function baselineInvalidReasons(report: SuiteRunReport, baseline: Baseline): string[] {
  const reasons: string[] = [];
  if (baseline.suiteId !== report.suiteId) reasons.push(`baseline suite ${baseline.suiteId} differs from the run's ${report.suiteId}`);
  if (baseline.level !== report.level) reasons.push(`baseline level ${baseline.level} differs from the run's ${report.level}`);
  if (stableJson(baseline.judge.fingerprint ?? null) !== stableJson(report.judgeTrust.pin ?? null)) {
    reasons.push('baseline judge fingerprint differs from the run');
  }
  if (stableJson(baseline.coach.model) !== stableJson(report.models.coach)) {
    reasons.push(`baseline coach model ${baseline.coach.model ?? 'null'} differs from the run's ${report.models.coach ?? 'null'}`);
  }
  return reasons;
}

/**
 * Classifies every `<testId>/<criterionId>` pair. `baseline` is `null` when no baseline exists
 * at the source (every pair `new`); `loadErrors` (an explicit `--baseline` missing, an
 * unparseable file, a git failure) make the diff `baseline-invalid` without classifying.
 */
export function diffRun(
  report: SuiteRunReport,
  baseline: Baseline | null,
  config: SuiteConfig,
  source: DiffBaselineSource,
  loadErrors: readonly string[] = [],
): SuiteDiff {
  const invalid = [...loadErrors, ...(baseline ? baselineInvalidReasons(report, baseline) : [])];
  const meta = {
    schemaVersion: 1 as const,
    baseline: source,
    acceptedFrom: baseline?.acceptedFrom ?? null,
    provisional: baseline?.provisional ?? false,
  };
  if (invalid.length > 0) {
    return SuiteDiffSchema.parse({
      ...meta,
      outcome: 'baseline-invalid',
      exitCode: 2,
      reasons: invalid,
      tests: section([]),
      journeys: section([]),
    }) as SuiteDiff;
  }

  const entries = classify(report, baseline, config);
  const tests = entries.filter((entry) => entry.testKind !== 'journey');
  const journeys = entries.filter((entry) => entry.testKind === 'journey');

  const reasons: string[] = [];
  let outcome: SuiteDiff['outcome'];
  let exitCode: number;
  const budget = budgetExceededKeys(report);
  const gating = entries.filter((entry) => entry.gating);
  if (report.judgeErrors.length > 0) {
    outcome = 'judge-infrastructure';
    exitCode = 3;
    reasons.push(`${report.judgeErrors.length} judge error(s): ${report.judgeErrors.map((error) => error.key).join(', ')}`);
  } else if (budget.length > 0) {
    outcome = 'budget-exceeded';
    exitCode = 4;
    reasons.push(`budget exceeded at ${budget.join(', ')}`);
  } else if (gating.length > 0) {
    outcome = 'failed';
    exitCode = 1;
    reasons.push(`${gating.length} gating entr${gating.length === 1 ? 'y' : 'ies'}: ${gating.map((entry) => entry.key).join(', ')}`);
  } else {
    outcome = baseline === null ? 'no-baseline' : 'clean';
    exitCode = 0;
  }
  if (baseline === null) reasons.push(`no baseline at ${source.path}`);

  return SuiteDiffSchema.parse({ ...meta, outcome, exitCode, reasons, tests: section(tests), journeys: section(journeys) }) as SuiteDiff;
}

interface Pair {
  key: string;
  testId: string;
  criterionId: string;
  run?: ScoredCriterion;
  base?: BaselineResult;
}

function classify(report: SuiteRunReport, baseline: Baseline | null, config: SuiteConfig): DiffEntry[] {
  const pairs = new Map<string, Pair>();
  for (const [key, result] of Object.entries(report.results)) {
    // Out-of-scope results take no part: the key counts as missing from the run.
    if (!result.inScope) continue;
    pairs.set(key, { key, testId: result.testId, criterionId: result.criterionId, run: result });
  }
  for (const [key, result] of Object.entries(baseline?.results ?? {})) {
    const ids = splitKey(key);
    if (!ids) continue;
    const pair = pairs.get(key);
    if (pair) {
      pair.base = result;
      continue;
    }
    if (!selected(report, key, ids)) continue;
    pairs.set(key, { key, ...ids, base: result });
  }

  const minSamples = (config.diff.minSamples as Partial<Record<string, number>>)[report.level] ?? Number.POSITIVE_INFINITY;
  return [...pairs.values()]
    .map((pair) => entry(pair, minSamples))
    .sort((a, b) => DIFF_CATEGORIES.indexOf(a.category) - DIFF_CATEGORIES.indexOf(b.category) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * A run narrowed with `--case` is compared only with baseline keys of that test id or
 * source case (plus keys the run itself has, such as its manifest NOT TESTABLE rows).
 */
function selected(report: SuiteRunReport, key: string, ids: { testId: string; criterionId: string }): boolean {
  if (report.selection === undefined) return true;
  if (key in report.results) return true;
  const sourceCase = ids.criterionId.replace(/\.C\d+$/, '');
  return ids.testId === report.selection.case || sourceCase === report.selection.case;
}

function splitKey(key: string): { testId: string; criterionId: string } | null {
  const slash = key.lastIndexOf('/');
  if (slash <= 0 || slash === key.length - 1) return null;
  return { testId: key.slice(0, slash), criterionId: key.slice(slash + 1) };
}

function entry(pair: Pair, minSamples: number): DiffEntry {
  const { run, base } = pair;
  // A re-layered criterion is judged by its current definition; a vanished one by the baseline's.
  const layer: Layer = (run?.layer ?? base?.layer)!;
  const testKind: TestKind | null = run ? run.testKind : (base?.testKind ?? null);
  const checkKind: CheckKind | null = run ? run.checkKind : (base?.checkKind ?? null);
  const meaning = checkKind === 'meaning';
  const needed = run ? run.minPasses : 0;
  const category = categorize(run, base, meaning, needed, minSamples);
  const gating =
    (category === 'regressed' || category === 'lost-coverage') &&
    (layer === 'S' || checkKind === 'rule' || (category === 'regressed' && meaning && testKind !== 'journey'));
  return {
    key: pair.key,
    testId: pair.testId,
    criterionId: pair.criterionId,
    layer,
    testKind,
    checkKind,
    category,
    gating,
    baseline: base ? { status: base.status, passCount: base.passCount, n: base.n } : null,
    current: run ? { status: run.status, passCount: run.passCount, n: run.n, minPasses: needed } : null,
  };
}

function categorize(
  run: ScoredCriterion | undefined,
  base: BaselineResult | undefined,
  meaning: boolean,
  needed: number,
  minSamples: number,
): DiffCategory {
  if (!base) return 'new';
  const baseDecided = DECIDED.includes(base.status);
  if (!run) return baseDecided ? 'lost-coverage' : 'retired';
  const runDecided = DECIDED.includes(run.status);
  if (run.status === 'NOT_TESTABLE') return base.status === 'NOT_TESTABLE' ? 'unchanged' : 'retired';
  if (base.status === 'NOT_TESTABLE') return runDecided ? 'gained-coverage' : 'unchanged';
  const baseUndecided = UNDECIDED.includes(base.status);
  const runUndecided = UNDECIDED.includes(run.status);
  if (baseDecided && runUndecided) return 'lost-coverage';
  if (baseUndecided && runDecided) return 'gained-coverage';
  if (baseUndecided && runUndecided) return 'unchanged';
  // Both decided. L0 has no `diff.minSamples` entry (no judge), so meaning is always inconclusive there.
  if (meaning && (run.n < minSamples || run.advisory)) return 'inconclusive';
  if (base.status === 'PASS' && run.passCount < needed) return 'regressed';
  if (base.status === 'FAIL' && run.passCount >= needed) return 'fixed';
  return 'unchanged';
}

function section(entries: DiffEntry[]): DiffSection {
  const counts = Object.fromEntries(DIFF_CATEGORIES.map((category) => [category, 0])) as Record<DiffCategory, number>;
  for (const item of entries) counts[item.category] += 1;
  return { entries, counts };
}

function budgetExceededKeys(report: SuiteRunReport): string[] {
  const isBudget = (reason: string | undefined) => reason === 'budget-exceeded' || (reason?.startsWith('budget-exceeded:') ?? false);
  return Object.entries(report.results)
    .filter(([, result]) => result.inScope && (isBudget(result.reason) || result.samples.some((sample) => isBudget(sample.reason))))
    .map(([key]) => key)
    .sort();
}

/** `[suite]` console lines: entries by category (`lost-coverage` first), counts only for `unchanged`. */
export function diffSummaryLines(diff: SuiteDiff, runId: string): string[] {
  const lines: string[] = [];
  const where = diff.baseline.ref ? `${diff.baseline.path} at ${diff.baseline.ref}` : diff.baseline.path;
  lines.push(`[suite] diff ${runId} vs ${diff.baseline.kind} baseline ${where}`);
  if (diff.baseline.missing && diff.outcome !== 'baseline-invalid') lines.push(`[suite] diff: no baseline at ${where}; every pair is new`);
  if (diff.acceptedFrom) {
    lines.push(
      `[suite] diff: baseline accepted from run ${diff.acceptedFrom.runId} (${diff.acceptedFrom.gitSha})${diff.provisional ? ' (provisional)' : ''}`,
    );
  }
  if (diff.outcome === 'baseline-invalid') {
    for (const reason of diff.reasons) lines.push(`[suite] diff: baseline-invalid: ${reason}`);
  }
  const sections: Array<[string, DiffSection]> = [
    ['tests', diff.tests],
    ['journeys', diff.journeys],
  ];
  for (const category of DIFF_CATEGORIES) {
    if (category === 'unchanged') continue;
    for (const [name, part] of sections) {
      for (const item of part.entries.filter((entry) => entry.category === category)) {
        lines.push(`[suite] diff ${name} ${category} ${describeEntry(item)}`);
      }
    }
  }
  for (const [name, part] of sections) {
    lines.push(`[suite] diff ${name}: ${DIFF_CATEGORIES.map((category) => `${category} ${part.counts[category] ?? 0}`).join(', ')}`);
  }
  lines.push(`[suite] diff outcome: ${diff.outcome} (exit ${diff.exitCode})`);
  if (diff.outcome !== 'baseline-invalid') {
    for (const reason of diff.reasons.filter((entry) => !entry.startsWith('no baseline at '))) lines.push(`[suite] diff: ${reason}`);
  }
  return lines;
}

export function describeEntry(item: DiffEntry): string {
  const before = item.baseline ? `${item.baseline.status} ${item.baseline.passCount}/${item.baseline.n}` : 'none';
  const after = item.current
    ? `${item.current.status} ${item.current.passCount}/${item.current.n} (min ${item.current.minPasses})`
    : 'missing';
  return `${item.key} ${item.layer} ${item.checkKind ?? 'n/a'}: ${before} -> ${after}${item.gating ? ' [gating]' : ''}`;
}

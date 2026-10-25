import type {
  CriterionResult,
  CriterionSample,
  CriterionStatus,
  JourneySection,
  Layer,
  LayerRow,
  LayerTable,
  Level,
  LoadedSuite,
  ScoredCriterion,
  SuiteScore,
  Verdict,
} from './schema';

export interface ScoreInput {
  suite: LoadedSuite;
  level: Level;
  /** Samples per test; `results` holds n results per evaluated criterion. */
  n: number;
  results: readonly CriterionResult[];
}

/**
 * Framework v2.1.1, section 6 (verdict): "Any S FAIL makes the run NOT ADEQUATE.
 * Otherwise, a combined P+D+C pass rate of at least 0.90 is ADEQUATE, 0.75-0.89 is
 * ACCEPTABLE WITH ISSUES, and anything lower is NOT ADEQUATE."
 */
export const ADEQUATE_THRESHOLD = 0.9;
/** Framework v2.1.1, section 6: lower bound of ACCEPTABLE WITH ISSUES (75%). */
export const ACCEPTABLE_THRESHOLD = 0.75;
/** Meaning-decided criteria pass with ceil(0.8 n) passes; rule-decided ones need n/n. */
export const MEANING_PASS_RATIO = 0.8;

const LAYERS: readonly Layer[] = ['P', 'D', 'C', 'S'];
const UNDECIDED_PRECEDENCE: readonly CriterionStatus[] = ['NOT_TESTABLE', 'INVALID', 'ERROR', 'NOT_RUN'];

export function testCriterionKey(testId: string, criterionId: string): string {
  return `${testId}/${criterionId}`;
}

/** Passes needed for PASS over n samples (architecture AD-13). */
export function minPasses(n: number, meaningDecided: boolean): number {
  return meaningDecided ? Math.ceil(MEANING_PASS_RATIO * n) : n;
}

/**
 * Pure scoring of one run (architecture AD-9, Framework v2.1.1 sections 5 and 6):
 * aggregates samples per `<testId>/<criterionId>`, adds one NOT_TESTABLE row per
 * manifest NOT TESTABLE criterion keyed `<sourceCase>/<criterionId>`, builds the layer
 * table over non-advisory atomic and observation results, reports journeys separately
 * and decides COMPLETE, the verdict and whether it is provisional.
 *
 * Framework v2.1.1, section 5: "Layer pass rate = PASS / (PASS + FAIL)"; a run is
 * COMPLETE when every in-scope criterion is PASS, FAIL or pre-declared NOT TESTABLE, and
 * an INCOMPLETE run carries a provisional verdict.
 */
export function score(input: ScoreInput): SuiteScore {
  const { suite, level, n } = input;
  if (!Number.isInteger(n) || n < 1) throw new Error(`[suite] score: n must be a positive integer, got ${n}`);

  const results = [...aggregate(input), ...manifestNotTestable(suite, n)];
  const counted = results.filter(countsTowardVerdict);
  // No in-scope test result (an empty suite, or every test out of scope) is not a
  // journeys-only run: nothing was decided, so the run is INCOMPLETE.
  const hasInScopeTest = input.results.some((result) => result.inScope);
  const journeysOnly =
    hasInScopeTest && !input.results.some((result) => result.inScope && result.testKind !== 'journey');

  const inScope = results.filter((result) => result.inScope);
  const undecided = inScope.filter((result) => !['PASS', 'FAIL', 'NOT_TESTABLE'].includes(result.status));
  const complete = hasInScopeTest && undecided.length === 0;
  const provisionalReasons: string[] = [];
  if (!hasInScopeTest) provisionalReasons.push('incomplete: no in-scope test criteria');
  else if (!complete) provisionalReasons.push(`incomplete: ${describeUndecided(undecided)}`);

  let layers: LayerTable | null = null;
  let verdict: Verdict = 'n/a (journeys only)';
  if (!journeysOnly) {
    layers = layerTable(counted);
    const decision = decideVerdict(layers);
    verdict = decision.verdict;
    if (decision.reason) provisionalReasons.push(decision.reason);
  }

  return {
    suite,
    level,
    n,
    results,
    layers,
    verdict,
    complete,
    provisional: provisionalReasons.length > 0,
    ...(provisionalReasons.length > 0 ? { provisionalReason: provisionalReasons.join('; ') } : {}),
    journeys: journeySection(results),
  };
}

function aggregate(input: ScoreInput): ScoredCriterion[] {
  const groups = new Map<string, CriterionResult[]>();
  for (const result of input.results) {
    if (result.level !== input.level) {
      throw new Error(`[suite] score: result ${result.testId}/${result.criterionId} is ${result.level}, run is ${input.level}`);
    }
    const key = testCriterionKey(result.testId, result.criterionId);
    const group = groups.get(key);
    if (group) group.push(result);
    else groups.set(key, [result]);
  }

  const meaningCriteria = new Set(
    input.suite.tests.flatMap((test) =>
      test.criteria
        .filter((criterion) => criterion.checks.some((check) => check.type === 'meaning'))
        .map((criterion) => testCriterionKey(test.id, criterion.id)),
    ),
  );

  return [...groups.entries()].map(([key, samples]) => {
    if (samples.length > input.n) {
      throw new Error(`[suite] score: ${key} has ${samples.length} samples, n is ${input.n}`);
    }
    const first = samples[0]!;
    const passCount = samples.filter((sample) => sample.status === 'PASS').length;
    // Meaning applied when the criterion has a meaning check that was not skipped.
    const meaningDecided = meaningCriteria.has(key) && samples.some((sample) => sample.meaningSkipped !== true);
    const needed = minPasses(input.n, meaningDecided);
    const undecided = UNDECIDED_PRECEDENCE.map((status) => samples.find((sample) => sample.status === status)).find(
      (sample) => sample !== undefined,
    );
    const representative =
      undecided ?? (passCount >= needed ? first : (samples.find((sample) => sample.status === 'FAIL') ?? first));
    // Samples missing from n (never produced) cannot count as passes.
    const status: CriterionStatus = undecided ? undecided.status : passCount >= needed ? 'PASS' : 'FAIL';
    // FAIL with no FAIL sample: fewer samples than n were produced.
    const shortReason =
      status === 'FAIL' && representative.status !== 'FAIL' ? `passes-below-min:${passCount}/${needed}` : undefined;

    return {
      testId: first.testId,
      criterionId: first.criterionId,
      sourceCase: first.sourceCase,
      testKind: first.testKind,
      layer: first.layer,
      inScope: first.inScope,
      status,
      passCount,
      n: input.n,
      minPasses: needed,
      advisory: samples.some((sample) => sample.advisory),
      method: first.method,
      ...optional('reason', status === 'PASS' ? undefined : (shortReason ?? representative.reason)),
      ...optional('evidence', status === 'PASS' || shortReason ? undefined : representative.evidence),
      samples: samples.map(toSample),
    };
  });
}

function manifestNotTestable(suite: LoadedSuite, n: number): ScoredCriterion[] {
  return suite.sources.flatMap((source) =>
    source.criteria
      .filter((criterion) => criterion.notTestableReason !== undefined)
      .map((criterion) => ({
        testId: source.id,
        criterionId: criterion.id,
        sourceCase: source.id,
        testKind: null,
        layer: criterion.layer,
        inScope: true,
        status: 'NOT_TESTABLE' as const,
        passCount: 0,
        n,
        minPasses: 0,
        advisory: false,
        method: 'n/a' as const,
        reason: criterion.notTestableReason!,
        samples: [],
      })),
  );
}

function countsTowardVerdict(result: ScoredCriterion): boolean {
  return (
    result.inScope &&
    !result.advisory &&
    (result.testKind === 'atomic' || result.testKind === 'observation') &&
    (result.status === 'PASS' || result.status === 'FAIL')
  );
}

function layerTable(counted: readonly ScoredCriterion[]): LayerTable {
  const rows: LayerRow[] = LAYERS.map((layer) => {
    const inLayer = counted.filter((result) => result.layer === layer);
    return row(layer, inLayer);
  });
  const pdc = row('P', counted.filter((result) => result.layer !== 'S'));
  return { rows, combinedPdc: { pass: pdc.pass, fail: pdc.fail, passRate: pdc.passRate } };
}

function row(layer: Layer, results: readonly ScoredCriterion[]): LayerRow {
  const pass = results.filter((result) => result.status === 'PASS').length;
  const fail = results.filter((result) => result.status === 'FAIL').length;
  return { layer, pass, fail, passRate: pass + fail === 0 ? null : pass / (pass + fail) };
}

/**
 * Framework v2.1.1, section 6: S FAIL first, then the combined P+D+C pass rate:
 * >= 0.90 ADEQUATE, 0.75-0.89 ACCEPTABLE WITH ISSUES, below 0.75 NOT ADEQUATE.
 */
export function decideVerdict(layers: LayerTable): { verdict: Verdict; reason?: string } {
  const s = layers.rows.find((entry) => entry.layer === 'S');
  if (s && s.fail > 0) return { verdict: 'NOT ADEQUATE' };
  const rate = layers.combinedPdc.passRate;
  // No decided P/D/C criterion: nothing supports an adequacy claim.
  if (rate === null) return { verdict: 'NOT ADEQUATE', reason: 'no decided P/D/C criterion' };
  if (rate >= ADEQUATE_THRESHOLD) return { verdict: 'ADEQUATE' };
  if (rate >= ACCEPTABLE_THRESHOLD) return { verdict: 'ACCEPTABLE WITH ISSUES' };
  return { verdict: 'NOT ADEQUATE' };
}

function journeySection(results: readonly ScoredCriterion[]): JourneySection {
  const journeys = results.filter((result) => result.testKind === 'journey' && result.inScope);
  const counts: JourneySection['counts'] = {};
  for (const result of journeys) counts[result.status] = (counts[result.status] ?? 0) + 1;
  return { keys: journeys.map((result) => testCriterionKey(result.testId, result.criterionId)), counts };
}

function describeUndecided(undecided: readonly ScoredCriterion[]): string {
  const counts = new Map<CriterionStatus, number>();
  for (const result of undecided) counts.set(result.status, (counts.get(result.status) ?? 0) + 1);
  return [...counts.entries()].map(([status, count]) => `${count} ${status}`).join(', ');
}

function toSample(result: CriterionResult): CriterionSample {
  return {
    status: result.status,
    advisory: result.advisory,
    ...optional('reason', result.reason),
    ...optional('evidence', result.evidence),
    ...optional('meaningSkipped', result.meaningSkipped),
  };
}

function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

export type PulseMetricKind = 'index' | 'engagement';

export interface PulseMetricAnswer {
  questionKey: string;
  value: number | null | undefined;
}

export interface PulseMetricParticipant {
  participantId: string;
  answers: readonly PulseMetricAnswer[];
}

/** Callers supply authorized, frozen scope membership and raw answers, never rounded means. */
export interface PulseMetricCalculationInput {
  expectedQuestionKeys: readonly string[];
  participants: readonly PulseMetricParticipant[];
}

export interface PulseMetricInvalidInput {
  status: 'invalid_input';
}

export type PulseMetricCalculationResult<K extends PulseMetricKind = PulseMetricKind> =
  | PulseMetricInvalidInput
  | { status: 'calculated'; metricKind: K; rawMean: number | null; completeCount: number };

export interface PulseMetricValue<K extends PulseMetricKind = PulseMetricKind> {
  kind: K;
  rawMean: number;
}

type PulseIndexMode = 'intermediate_overall' | 'intermediate_team' | 'final_diagnostic';
type PulseEngagementMode = 'final_overall' | 'final_team';

/** rosterCount is already adjusted for full withdrawals by the scope owner. */
export type PulseMetricEligibilityInput = {
  rosterCount: number;
  completeCount: number;
} & (
  | { mode: PulseIndexMode; metricKind: 'index' }
  | { mode: PulseEngagementMode; metricKind: 'engagement' }
);

export type PulseMetricEligibilityResult =
  | PulseMetricInvalidInput
  | { status: 'eligible' | 'insufficient_data'; requiredCount: number };

export type PulseIndexCategory = 'critical' | 'needs_attention' | 'healthy';
export type PulseMetricDirection = 'improving' | 'stable' | 'declining' | 'baseline_established';

/** RPT-05 owns selecting a compatible previous completed final cycle in the same scope. */
export type PulseMetricComparisonInput =
  | { current: PulseMetricValue<'index'>; previousFinal: PulseMetricValue<'index'> | null }
  | { current: PulseMetricValue<'engagement'>; previousFinal: PulseMetricValue<'engagement'> | null };

function invalidInput(): PulseMetricInvalidInput {
  return { status: 'invalid_input' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isKey(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRawMetric(value: unknown, kind: PulseMetricKind): value is number {
  return typeof value === 'number' && Number.isFinite(value)
    && value >= (kind === 'index' ? 0 : 1) && value <= (kind === 'index' ? 100 : 10);
}

function isMetricValue(value: unknown): value is PulseMetricValue {
  return isRecord(value) && (value.kind === 'index' || value.kind === 'engagement')
    && isRawMetric(value.rawMean, value.kind);
}

function calculateMetric<K extends PulseMetricKind>(
  input: PulseMetricCalculationInput,
  metricKind: K,
): PulseMetricCalculationResult<K> {
  if (!isRecord(input) || !Array.isArray(input.expectedQuestionKeys)
    || !Array.isArray(input.participants)) return invalidInput();
  const keys: unknown[] = input.expectedQuestionKeys;
  if (keys.length !== 3 || !Array.from(keys).every(isKey) || new Set(keys).size !== 3) return invalidInput();
  const expectedKeys = new Set(keys);
  const participantIds = new Set<string>();
  let completeCount = 0;
  let answerTotal = 0;
  for (const participant of input.participants as unknown[]) {
    if (!isRecord(participant) || !isKey(participant.participantId)
      || !Array.isArray(participant.answers) || participantIds.has(participant.participantId)) {
      return invalidInput();
    }
    participantIds.add(participant.participantId);
    const seenKeys = new Set<string>();
    let personTotal = 0;
    let complete = participant.answers.length === 3;
    for (const answer of participant.answers as unknown[]) {
      if (!isRecord(answer) || !isKey(answer.questionKey)
        || !expectedKeys.has(answer.questionKey) || seenKeys.has(answer.questionKey)) {
        return invalidInput();
      }
      seenKeys.add(answer.questionKey);
      if (!isRawMetric(answer.value, metricKind) || !Number.isInteger(answer.value)) {
        complete = false;
      } else {
        personTotal += answer.value;
      }
    }
    if (complete) {
      completeCount += 1;
      answerTotal += personTotal;
      if (!Number.isSafeInteger(answerTotal)) return invalidInput();
    }
  }
  // Every complete person has three integer values: this is the equal-person mean
  // without floating-point person means introducing input-order-dependent rounding.
  return {
    status: 'calculated', metricKind, completeCount,
    rawMean: completeCount === 0 ? null : answerTotal / (3 * completeCount),
  };
}

export function calculatePulseIndexMetric(input: PulseMetricCalculationInput): PulseMetricCalculationResult<'index'> {
  return calculateMetric(input, 'index');
}

export function calculatePulseEngagementMetric(input: PulseMetricCalculationInput): PulseMetricCalculationResult<'engagement'> {
  return calculateMetric(input, 'engagement');
}

export function evaluatePulseMetricEligibility(input: PulseMetricEligibilityInput): PulseMetricEligibilityResult {
  if (!isRecord(input)) return invalidInput();
  const { mode, metricKind, rosterCount, completeCount } = input;
  const validPair = metricKind === 'index'
    ? mode === 'intermediate_overall' || mode === 'intermediate_team' || mode === 'final_diagnostic'
    : metricKind === 'engagement' && (mode === 'final_overall' || mode === 'final_team');
  if (!validPair || !Number.isSafeInteger(rosterCount) || !Number.isSafeInteger(completeCount)
    || rosterCount < 0 || completeCount < 0 || completeCount > rosterCount) return invalidInput();
  // Integer arithmetic avoids 0.8*N rounding up exact large multiples of five.
  const requiredCount = mode === 'intermediate_overall'
    ? Math.max(5, rosterCount - Math.floor(rosterCount / 5)) : 5;
  return { status: completeCount >= requiredCount ? 'eligible' : 'insufficient_data', requiredCount };
}

export function classifyPulseIndex(rawMean: number):
  PulseMetricInvalidInput | { status: 'classified'; category: PulseIndexCategory } {
  if (!isRawMetric(rawMean, 'index')) return invalidInput();
  return { status: 'classified', category: rawMean < 40 ? 'critical' : rawMean < 70 ? 'needs_attention' : 'healthy' };
}

export function comparePulseMetric(input: PulseMetricComparisonInput):
  PulseMetricInvalidInput | { status: 'compared'; direction: PulseMetricDirection } {
  if (!isRecord(input) || !isMetricValue(input.current)) return invalidInput();
  const { current, previousFinal } = input;
  if (previousFinal === null) return { status: 'compared', direction: 'baseline_established' };
  if (!isMetricValue(previousFinal) || previousFinal.kind !== current.kind) return invalidInput();
  return {
    status: 'compared',
    direction: current.rawMean > previousFinal.rawMean ? 'improving'
      : current.rawMean < previousFinal.rawMean ? 'declining' : 'stable',
  };
}

export function formatPulseMetric(metric: PulseMetricValue):
  PulseMetricInvalidInput | { status: 'formatted'; value: string } {
  if (!isMetricValue(metric)) return invalidInput();
  return { status: 'formatted', value: metric.rawMean.toFixed(1) };
}

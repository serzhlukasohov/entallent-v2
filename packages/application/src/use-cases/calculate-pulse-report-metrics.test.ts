import { describe, expect, it } from 'vitest';
import {
  calculatePulseIndexMetric,
  calculatePulseEngagementMetric,
  classifyPulseIndex,
  comparePulseMetric,
  evaluatePulseMetricEligibility,
  formatPulseMetric,
} from './calculate-pulse-report-metrics';
import type {
  PulseMetricCalculationInput,
  PulseMetricEligibilityInput,
  PulseMetricComparisonInput,
  PulseMetricParticipant,
  PulseMetricValue,
} from './calculate-pulse-report-metrics';

const expectedQuestionKeys = ['q1', 'q2', 'q3'] as const;
function person(participantId: string, values: readonly (number | null | undefined)[]): PulseMetricParticipant {
  return { participantId, answers: values.map((value, i) => ({ questionKey: expectedQuestionKeys[i]!, value })) };
}
function input(participants: readonly PulseMetricParticipant[]): PulseMetricCalculationInput {
  return { expectedQuestionKeys, participants };
}
const index = (rawMean: number): PulseMetricValue<'index'> => ({ kind: 'index', rawMean });
const engagement = (rawMean: number): PulseMetricValue<'engagement'> => ({ kind: 'engagement', rawMean });

describe('Pulse report metric calculations', () => {
  it('averages exactly three Index scores and Engagement answers without eNPS conversion', () => {
    expect(calculatePulseIndexMetric(input([person('a', [60, 80, 70])]))).toEqual({
      status: 'calculated', metricKind: 'index', rawMean: 70, completeCount: 1,
    });
    expect(calculatePulseEngagementMetric(input([person('a', [6, 8, 10])]))).toEqual({
      status: 'calculated', metricKind: 'engagement', rawMean: 8, completeCount: 1,
    });
  });

  it('weights all authorized people equally, including TLs supplied only to overall input', () => {
    const teamA = Array.from({ length: 5 }, (_, n) => person(`a${n}`, [60, 60, 60]));
    const teamB = Array.from({ length: 5 }, (_, n) => person(`b${n}`, [80, 80, 80]));
    expect(calculatePulseIndexMetric(input([
      ...teamA, ...teamB, person('tlA', [90, 90, 90]), person('tlB', [30, 30, 30]),
    ]))).toMatchObject({ rawMean: 820 / 12, completeCount: 12 });
    expect(calculatePulseIndexMetric(input(teamA))).toMatchObject({ rawMean: 60, completeCount: 5 });
    expect(calculatePulseIndexMetric(input(teamB))).toMatchObject({ rawMean: 80, completeCount: 5 });
  });

  it('weights unequal team sizes by people rather than team means', () => {
    const people = [person('a', [0, 0, 0]), ...Array.from({ length: 5 }, (_, n) => person(`b${n}`, [90, 90, 90]))];
    expect(calculatePulseIndexMetric(input(people))).toMatchObject({ rawMean: 75, completeCount: 6 });
  });

  it('keeps fractional means raw and order independent', () => {
    const people = [person('a', [0, 0, 1]), person('b', [0, 0, 2]), person('c', [1, 1, 2])];
    const forward = calculatePulseIndexMetric(input(people));
    const reversed = calculatePulseIndexMetric(input([...people].reverse().map((p) => ({ ...p, answers: [...p.answers].reverse() }))));
    expect(forward).toEqual({ status: 'calculated', metricKind: 'index', rawMean: 7 / 9, completeCount: 3 });
    expect(reversed).toEqual(forward);
    expect(calculatePulseEngagementMetric(input([person('a', [1, 1, 2]), person('b', [1, 1, 1])]))).toMatchObject({ rawMean: 7 / 6 });
  });

  it.each([null, undefined, NaN, Infinity, -Infinity, -1, 101, 70.5])('excludes an incomplete Index person for answer %s without zero filling', (value) => {
    expect(calculatePulseIndexMetric(input([person('good', [60, 60, 60]), person('bad', [80, value, 80])]))).toMatchObject({ rawMean: 60, completeCount: 1 });
  });

  it.each([null, undefined, NaN, Infinity, -Infinity, 0, 11, 7.5])('excludes an invalid Engagement person for answer %s', (value) => {
    expect(calculatePulseEngagementMetric(input([person('good', [6, 8, 10]), person('bad', [8, value, 8])]))).toMatchObject({ rawMean: 8, completeCount: 1 });
  });

  it.each(['7', true, {}, [], 7n])('does not coerce malformed numeric answers %s', (value) => {
    const malformed = person('bad', [7, value as number, 7]);
    expect(calculatePulseEngagementMetric(input([malformed]))).toMatchObject({ rawMean: null, completeCount: 0 });
    expect(calculatePulseIndexMetric(input([malformed]))).toMatchObject({ rawMean: null, completeCount: 0 });
  });

  it('keeps valid scale endpoints and uses every Engagement person beyond five', () => {
    expect(calculatePulseIndexMetric(input([person('a', [0, 0, 0]), person('b', [100, 100, 100])]))).toMatchObject({ rawMean: 50, completeCount: 2 });
    const people = [...Array.from({ length: 5 }, (_, n) => person(`a${n}`, [1, 1, 1])), person('sixth', [10, 10, 10])];
    expect(calculatePulseEngagementMetric(input(people))).toMatchObject({ rawMean: 2.5, completeCount: 6 });
  });

  it.each([[], [60], [60, 80], [null, null, null]])('returns no metric for incomplete-only input %s', (...values) => {
    expect(calculatePulseIndexMetric(input([person('a', values as (number | null)[])]))).toMatchObject({ status: 'calculated', rawMean: null, completeCount: 0 });
  });

  it('returns null for an empty scope and does not hide raw metrics below the publication floor', () => {
    expect(calculatePulseIndexMetric(input([]))).toMatchObject({ status: 'calculated', rawMean: null, completeCount: 0 });
    expect(calculatePulseEngagementMetric(input([]))).toMatchObject({ status: 'calculated', rawMean: null, completeCount: 0 });
    expect(calculatePulseIndexMetric(input([person('a', [60, 60, 60])]))).toMatchObject({ rawMean: 60, completeCount: 1 });
  });

  it.each([
    [person('same', [60, 60, 60]), person('same', [60, 60, 60])],
    [person('same', []), person('same', [60, 60, 60])],
    [{ participantId: 'a', answers: [{ questionKey: 'q1', value: null }, { questionKey: 'q1', value: 60 }] }],
    [{ participantId: 'a', answers: [{ questionKey: 'unexpected', value: null }] }],
    [person('', [60, 60, 60])],
    [person('   ', [60, 60, 60])],
  ])('invalidates conflicting identities or question records %#', (...participants) => {
    for (const calculate of [calculatePulseIndexMetric, calculatePulseEngagementMetric]) {
      expect(calculate(input(participants))).toMatchObject({ status: 'invalid_input' });
    }
  });

  it.each([[], ['q1', 'q2'], ['q1', 'q2', 'q3', 'q4'], ['q1', 'q1', 'q3'], ['q1', '', 'q3']])('rejects invalid expected key set %#', (...keys) => {
    expect(calculatePulseIndexMetric({ expectedQuestionKeys: keys, participants: [] })).toMatchObject({ status: 'invalid_input' });
  });

  it('rejects sparse expected key sets without treating a hole as a third question', () => {
    const keys = ['q1', 'q2'];
    keys.length = 3;
    expect(calculatePulseIndexMetric({ expectedQuestionKeys: keys, participants: [] })).toMatchObject({ status: 'invalid_input' });
  });

  it.each([null, {}, { expectedQuestionKeys, participants: null }, { expectedQuestionKeys, participants: [null] }, { expectedQuestionKeys, participants: [{ participantId: 'a', answers: null }] }])('fails closed for malformed input shape %#', (malformed) => {
    expect(calculatePulseIndexMetric(malformed as unknown as PulseMetricCalculationInput)).toMatchObject({ status: 'invalid_input' });
  });
});

describe('Pulse publication eligibility', () => {
  it.each([[5, 5], [6, 5], [10, 8], [8, 7]])('requires the intermediate overall threshold for N=%i', (rosterCount, requiredCount) => {
    expect(evaluatePulseMetricEligibility({ mode: 'intermediate_overall', metricKind: 'index', rosterCount, completeCount: requiredCount })).toEqual({ status: 'eligible', requiredCount });
    expect(evaluatePulseMetricEligibility({ mode: 'intermediate_overall', metricKind: 'index', rosterCount, completeCount: requiredCount - 1 })).toEqual({ status: 'insufficient_data', requiredCount });
  });

  it('distinguishes a withdrawal-adjusted roster of eight from an unchanged roster of ten', () => {
    expect(evaluatePulseMetricEligibility({ mode: 'intermediate_overall', metricKind: 'index', rosterCount: 8, completeCount: 7 }).status).toBe('eligible');
    expect(evaluatePulseMetricEligibility({ mode: 'intermediate_overall', metricKind: 'index', rosterCount: 10, completeCount: 7 }).status).toBe('insufficient_data');
  });

  it.each([
    { mode: 'intermediate_team', metricKind: 'index' },
    { mode: 'final_diagnostic', metricKind: 'index' },
    { mode: 'final_overall', metricKind: 'engagement' },
    { mode: 'final_team', metricKind: 'engagement' },
  ] as const)('uses the five-person floor independent of 80 percent: $mode', (mode) => {
    expect(evaluatePulseMetricEligibility({ ...mode, rosterCount: 100, completeCount: 5 })).toEqual({ status: 'eligible', requiredCount: 5 });
    expect(evaluatePulseMetricEligibility({ ...mode, rosterCount: 100, completeCount: 4 })).toEqual({ status: 'insufficient_data', requiredCount: 5 });
  });

  it.each([0, 1, 4])('treats undersized roster %i as insufficient rather than malformed', (rosterCount) => {
    expect(evaluatePulseMetricEligibility({ mode: 'intermediate_overall', metricKind: 'index', rosterCount, completeCount: rosterCount })).toEqual({ status: 'insufficient_data', requiredCount: 5 });
  });

  it.each([[-1, 0], [5, -1], [5, 6], [5.5, 5], [5, 4.5], [Infinity, 5], [5, NaN], [Number.MAX_SAFE_INTEGER + 1, 5], ['5', 5], [5, '5'], [null, 0]])('rejects malformed counts %#', (rosterCount, completeCount) => {
    expect(evaluatePulseMetricEligibility({ mode: 'final_overall', metricKind: 'engagement', rosterCount, completeCount } as PulseMetricEligibilityInput)).toMatchObject({ status: 'invalid_input' });
  });

  it.each([
    ['intermediate_overall', 'engagement'], ['intermediate_team', 'engagement'],
    ['final_diagnostic', 'engagement'], ['final_overall', 'index'], ['final_team', 'index'],
    ['unknown', 'index'], ['final_team', 'unknown'],
  ])('rejects runtime unsupported metric/mode pair %s/%s', (mode, metricKind) => {
    expect(evaluatePulseMetricEligibility({ mode, metricKind, rosterCount: 5, completeCount: 5 } as PulseMetricEligibilityInput)).toMatchObject({ status: 'invalid_input' });
  });

  it.each([null, undefined, {}, [], { mode: 'final_team', metricKind: 'engagement' }])('fails closed on malformed eligibility shape %#', (malformed) => {
    expect(evaluatePulseMetricEligibility(malformed as PulseMetricEligibilityInput)).toMatchObject({ status: 'invalid_input' });
  });

  it('rejects invalid mode-kind combinations at compile time as well', () => {
    // @ts-expect-error Engagement cannot authorize an intermediate Index publication.
    evaluatePulseMetricEligibility({ mode: 'intermediate_overall', metricKind: 'engagement', rosterCount: 5, completeCount: 5 });
    // @ts-expect-error An Index cannot authorize a final Engagement publication.
    evaluatePulseMetricEligibility({ mode: 'final_team', metricKind: 'index', rosterCount: 5, completeCount: 5 });
  });
});

describe('Pulse raw metric interpretation', () => {
  it.each([[0, 'critical'], [39.999, 'critical'], [40, 'needs_attention'], [69.999, 'needs_attention'], [70, 'healthy'], [100, 'healthy']] as const)('classifies unrounded Index %s', (value, category) => {
    expect(classifyPulseIndex(value)).toEqual({ status: 'classified', category });
  });

  it.each([NaN, Infinity, -Infinity, -0.001, 100.001, null, '70'])('rejects invalid Index category input %s', (value) => {
    expect(classifyPulseIndex(value as number)).toMatchObject({ status: 'invalid_input' });
  });

  it.each([
    [index(69.999), index(69.998), 'improving'], [index(69.998), index(69.999), 'declining'],
    [index(70), index(70), 'stable'], [engagement(8), null, 'baseline_established'],
    [engagement(8.001), engagement(8), 'improving'], [engagement(8), engagement(8.001), 'declining'],
    [engagement(8), engagement(8), 'stable'], [index(0), null, 'baseline_established'],
    [index(1 + Number.EPSILON), index(1), 'improving'],
  ] as const)('compares raw current and comparable previous-final values %#', (current, previousFinal, direction) => {
    expect(comparePulseMetric({ current, previousFinal } as PulseMetricComparisonInput)).toEqual({ status: 'compared', direction });
  });

  it('can display rounded equality while retaining a nonzero direction', () => {
    expect(formatPulseMetric(index(69.999))).toEqual({ status: 'formatted', value: '70.0' });
    expect(formatPulseMetric(index(69.998))).toEqual({ status: 'formatted', value: '70.0' });
    expect(comparePulseMetric({ current: index(69.999), previousFinal: index(69.998) })).toMatchObject({ direction: 'improving' });
  });

  it.each([
    [index(0), '0.0'], [index(100), '100.0'], [engagement(1), '1.0'],
    [engagement(10), '10.0'], [engagement(7 / 3), '2.3'],
  ] as const)('formats a valid metric to exactly one decimal %#', (metric, value) => {
    expect(formatPulseMetric(metric)).toEqual({ status: 'formatted', value });
  });

  it.each([index(NaN), index(Infinity), index(-1), index(101), engagement(0), engagement(11), { kind: 'index', rawMean: '70' }, { kind: 'unknown', rawMean: 8 }, null])('rejects invalid current, baseline and formatted values %#', (metric) => {
    expect(formatPulseMetric(metric as PulseMetricValue)).toMatchObject({ status: 'invalid_input' });
    expect(comparePulseMetric({ current: metric, previousFinal: null } as PulseMetricComparisonInput)).toMatchObject({ status: 'invalid_input' });
    if (metric !== null) {
      expect(comparePulseMetric({ current: index(70), previousFinal: metric } as PulseMetricComparisonInput)).toMatchObject({ status: 'invalid_input' });
    }
  });

  it.each([null, undefined, {}, { current: index(70) }, { current: null, previousFinal: null }])('rejects malformed comparison shape %#', (malformed) => {
    expect(comparePulseMetric(malformed as unknown as PulseMetricComparisonInput)).toMatchObject({ status: 'invalid_input' });
  });

  it('rejects mismatched metric baselines at runtime and compile time', () => {
    // @ts-expect-error A prior Engagement value is not an Index baseline.
    expect(comparePulseMetric({ current: index(8), previousFinal: engagement(8) })).toMatchObject({ status: 'invalid_input' });
    // @ts-expect-error A prior Index value is not an Engagement baseline.
    expect(comparePulseMetric({ current: engagement(8), previousFinal: index(8) })).toMatchObject({ status: 'invalid_input' });
  });
});

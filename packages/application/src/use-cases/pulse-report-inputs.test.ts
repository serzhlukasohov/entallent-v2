import { describe, expect, it } from 'vitest';
import type {
  PulseAllowedDataset,
  PulseInputContext,
  PulseCompletedFinal,
} from '@entalent/contracts';
import {
  computePulseReportInputs,
  PreparePulseReportInputsUseCase,
} from './prepare-pulse-report-inputs.use-case';
import { selectPulseReportBaseline } from './select-pulse-report-baseline';
const context: PulseInputContext = {
  tenantId: 'tenant',
  cycleId: 'current',
  scopeId: 'scope',
  purpose: 'final',
  frontier: '2026-10-26T00:00:00.000001Z',
  formationStartedAt: '2026-10-26T00:00:00.000001Z',
  generation: 1,
  periodStart: '2026-10-19T00:00:00.000000Z',
  periodEnd: '2026-10-26T00:00:00.000000Z',
  historyKey: 'same',
  boundaryFingerprint: 'boundary',
  compositionFingerprint: 'roster',
  compatibilitySignature: 'contract',
  scopeKind: 'manager_overall',
  projection: 'manager_overall',
};
function dataset(n = 100, complete = 5): PulseAllowedDataset {
  return {
    context,
    roster: Array.from({ length: n }, (_, i) => String(i)),
    questionKeys: { engagement: ['a', 'b', 'c'], autonomy: ['x', 'y', 'z'] },
    topics: Array.from({ length: complete }, (_, i) =>
      ['a', 'b', 'c'].map((questionKey) => ({
        subjectId: String(i),
        lineageId: i + questionKey,
        revisionId: i + questionKey,
        questionKey,
        questionGroup: 'engagement',
        kind: 'engagement' as const,
        value: 8,
        support: 'literal_answer' as const,
      })),
    ).flat(),
  };
}
describe('RPT05 allowed metrics and native completed history', () => {
  it('five of100 is eligible despite all Index/team data being insufficient', () => {
    expect(computePulseReportInputs(dataset())).toMatchObject({
      finalGate: 'eligible',
      metrics: [
        { rawMean: 8, completeCount: 5, status: 'eligible' },
        { rawMean: null, completeCount: 0, status: 'insufficient_data' },
      ],
    });
  });
  it('four of100 becomes insufficiency only after repository certifies settlement', () => {
    expect(computePulseReportInputs(dataset(100, 4)).finalGate).toBe('insufficient_data');
  });
  it.each([
    ['team_lead_overall', 5, 'insufficient_data', 8],
    ['team_lead_overall', 8, 'eligible', 8],
    ['manager_team', 5, 'eligible', 5],
    ['manager_overall', 5, 'insufficient_data', 8],
  ] as const)('intermediate %s complete%d =>%s', (projection, complete, status, requiredCount) => {
    const d = dataset(10, 0);
    d.context = {
      ...context,
      purpose: 'intermediate',
      scopeKind: projection === 'manager_overall' ? 'manager_overall' : 'team',
      projection,
    };
    d.questionKeys = { autonomy: ['x', 'y', 'z'] };
    d.topics = Array.from({ length: complete }, (_, i) =>
      ['x', 'y', 'z'].map((questionKey, j) => ({
        subjectId: String(i),
        lineageId: i + questionKey,
        revisionId: i + questionKey,
        questionKey,
        questionGroup: 'autonomy',
        kind: 'index' as const,
        value: [60, 80, 70][j],
        support: 'safe_permanent_summary' as const,
      })),
    ).flat();
    expect(computePulseReportInputs(d).metrics[0]).toMatchObject({
      rawMean: 70,
      completeCount: complete,
      status,
      requiredCount,
    });
  });
  const metric = {
    metricKey: 'engagement',
    kind: 'engagement' as const,
    rawMean: 7.0401,
    completeCount: 5,
    status: 'eligible' as const,
    requiredCount: 5,
  };
  const prior: PulseCompletedFinal = {
    cycleId: 'previous',
    periodStart: '2026-10-12T00:00:00.000000Z',
    periodEnd: context.periodStart,
    historyKey: 'same',
    boundaryFingerprint: 'boundary',
    compositionFingerprint: 'old',
    compatibilitySignature: 'contract',
    authorized: true,
    metrics: [{ ...metric, rawMean: 7.04 }],
  };
  it('raw nonzero comparison survives rounded equality and composition is a structured caveat', () => {
    expect(selectPulseReportBaseline(context, metric, [prior])).toMatchObject({
      status: 'comparable',
      direction: 'improving',
      compositionChanged: true,
    });
  });
  it.each(['compatibilitySignature', 'boundaryFingerprint'] as const)(
    'incompatible immediately previous %s cannot fall back to older compatible final',
    (key) => {
      const latest = { ...prior, cycleId: 'latest', [key]: 'changed' };
      const older = {
        ...prior,
        periodStart: '2026-10-05T00:00:00.000000Z',
        periodEnd: '2026-10-12T00:00:00.000000Z',
      };
      expect(selectPulseReportBaseline(context, metric, [older, latest])).toEqual({
        status: 'baseline_established',
      });
    },
  );
  it.each([
    { authorized: false },
    { metrics: [] },
    { metrics: [{ ...metric, status: 'insufficient_data' as const, completeCount: 4 }] },
    { periodEnd: '2026-10-20T00:00:00.000000Z' },
  ])('missing/unusable/overlap previous final is a new baseline', (change) => {
    expect(selectPulseReportBaseline(context, metric, [{ ...prior, ...change }])).toEqual({
      status: 'baseline_established',
    });
  });
  it('readiness never invokes providers/recovery when repository is pending', async () => {
    const useCase = new PreparePulseReportInputsUseCase({
      prepare: async () => ({ status: 'pending', reason: 'unresolved_stage' }),
    });
    expect(await useCase.execute(context)).toEqual({
      status: 'pending',
      reason: 'unresolved_stage',
    });
  });
});

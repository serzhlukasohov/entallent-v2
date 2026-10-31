import type {
  PulseAllowedDataset,
  PulseInputRequest,
  PulseMetricCandidate,
  PulsePreparationResult,
  PulsePreparedSet,
  PulseCompletedFinal,
  PulseBaseline,
  PulsePreparedSection,
  BuildPulseReportRequest,
} from '@entalent/contracts';
import type { PulseReportHistoryRepositoryPort } from '../ports/pulse-report-history.repository.port';
import { selectPulseReportBaseline } from './select-pulse-report-baseline';
import type { PulseReportInputRepositoryPort } from '../ports/pulse-report-input.repository.port';
import {
  calculatePulseIndexMetric,
  calculatePulseEngagementMetric,
  evaluatePulseMetricEligibility,
} from './calculate-pulse-report-metrics';
export function computePulseReportInputs(dataset: PulseAllowedDataset): {
  metrics: PulseMetricCandidate[];
  finalGate: 'eligible' | 'insufficient_data' | null;
} {
  const metrics: PulseMetricCandidate[] = [];
  for (const [metricKey, expectedQuestionKeys] of Object.entries(dataset.questionKeys)) {
    const kind = metricKey === 'engagement' ? 'engagement' : 'index';
    if (kind === 'engagement' && dataset.context.purpose === 'intermediate') continue;
    const participants = dataset.roster.map((participantId) => ({
      participantId,
      answers: dataset.topics
        .filter(
          (t) =>
            t.subjectId === participantId &&
            t.kind === kind &&
            (kind === 'engagement' || t.questionGroup === metricKey),
        )
        .map((t) => ({ questionKey: t.questionKey, value: t.value })),
    }));
    const result =
      kind === 'index'
        ? calculatePulseIndexMetric({ expectedQuestionKeys, participants })
        : calculatePulseEngagementMetric({ expectedQuestionKeys, participants });
    if (result.status !== 'calculated') throw new Error('pulse_input_metric_integrity');
    const rosterCount = dataset.roster.length;
    const gate =
      kind === 'engagement'
        ? evaluatePulseMetricEligibility({
            metricKind: kind,
            mode: dataset.context.scopeKind === 'team' ? 'final_team' : 'final_overall',
            rosterCount,
            completeCount: result.completeCount,
          })
        : evaluatePulseMetricEligibility({
            metricKind: kind,
            mode:
              dataset.context.purpose === 'final'
                ? 'final_diagnostic'
                : dataset.context.projection === 'manager_team'
                  ? 'intermediate_team'
                  : 'intermediate_overall',
            rosterCount,
            completeCount: result.completeCount,
          });
    if (gate.status === 'invalid_input') throw new Error('pulse_input_gate_integrity');
    metrics.push({
      metricKey,
      kind,
      rawMean: result.rawMean,
      completeCount: result.completeCount,
      status: gate.status,
      requiredCount: gate.requiredCount,
    });
  }
  return {
    metrics,
    finalGate:
      dataset.context.purpose === 'final'
        ? (metrics.find((m) => m.kind === 'engagement')?.status ?? 'insufficient_data')
        : null,
  };
}
export class PreparePulseReportInputsUseCase {
  constructor(
    private readonly repository: PulseReportInputRepositoryPort,
    private readonly history?: PulseReportHistoryRepositoryPort,
  ) {}
  async execute(input: PulseInputRequest) {
    const prepared = await this.repository.prepare(input, computePulseReportInputs);
    return this.attachBaselines(prepared, input.tenantId);
  }
  async preparePresentationSet(inputs: readonly PulseInputRequest[]): Promise<PulsePreparedSet> {
    if (!this.repository.preparePresentationSet)
      return { status: 'blocked', reason: 'missing_batch_adapter' };
    const result = await this.repository.preparePresentationSet(inputs, computePulseReportInputs);
    if (result.status !== 'prepared') return result;
    const sections = [];
    for (const section of result.sections) {
      const withBaseline = await this.attachBaselines(section, section.context.tenantId);
      if (withBaseline.status !== 'prepared') return withBaseline;
      sections.push(withBaseline);
    }
    return { status: 'prepared', sections };
  }
  /** Restricted lifecycle recovery: current candidate/frontier/metrics/evidence never change. */
  async refreshHistoricalSelection(
    sections: readonly import('@entalent/contracts').PulsePreparedSection[],
  ) {
    const refreshed = [];
    for (const section of sections) {
      const next = await this.attachBaselines(section, section.context.tenantId);
      if (next.status !== 'prepared') throw Error('pulse_history_refresh_invalid');
      refreshed.push(next);
    }
    return refreshed;
  }
  private async attachBaselines(prepared: PulsePreparationResult, tenantId: string) {
    if (prepared.status !== 'prepared') return prepared;
    const history = (
      (await this.history?.completed(tenantId, prepared.context.historyKey)) ?? []
    ).filter(
      (h) => h.cycleId !== prepared.context.cycleId && h.periodEnd <= prepared.context.periodStart,
    );
    const baselines = Object.fromEntries(
      prepared.metrics.map((m) => [
        m.metricKey,
        selectPulseReportBaseline(prepared.context, m, history),
      ]),
    );
    return { ...prepared, baselineInventory: minimizePulseHistory(history, baselines), baselines };
  }
}

/** Inventory identity stays complete; scalar storage is limited to actually compared metrics. */
export function minimizePulseHistory(
  history: readonly PulseCompletedFinal[],
  baselines: Readonly<Record<string, PulseBaseline>>,
): PulseCompletedFinal[] {
  return history.map((h) => ({
    ...h,
    metrics: h.authorized
      ? h.metrics.filter((m) => {
          const selected = baselines[m.metricKey];
          return selected?.status === 'comparable' && selected.priorCycleId === h.cycleId;
        })
      : [],
  }));
}
export function pulseUsedCandidateIds(sections: readonly PulsePreparedSection[]): string[] {
  return [
    ...new Set(
      sections.flatMap((s) => [
        s.candidateId,
        ...(s.baselineInventory ?? [])
          .filter(
            (h) =>
              h.authorized &&
              h.metrics.length > 0 &&
              Object.values(s.baselines ?? {}).some(
                (b) => b.status === 'comparable' && b.priorCycleId === h.cycleId,
              ),
          )
          .flatMap((h) => (h.candidateId ? [h.candidateId] : [])),
      ]),
    ),
  ].sort();
}

/** Persist only comparisons actually displayed by this exact report variant. */
export function restrictPulsePresentationHistory(
  sections: readonly PulsePreparedSection[],
  request: BuildPulseReportRequest,
): PulsePreparedSection[] {
  const key = request.purpose === 'final' ? 'engagement' : request.indexKey!;
  return sections.map((s) => {
    const visible =
      (request.purpose !== 'final' || sections[0]?.finalGate === 'eligible') &&
      s.metrics.some((m) => m.metricKey === key && m.status === 'eligible');
    const baselines = visible && s.baselines?.[key] ? { [key]: s.baselines[key]! } : {};
    return {
      ...s,
      baselines,
      baselineInventory: minimizePulseHistory(s.baselineInventory ?? [], baselines),
    };
  });
}

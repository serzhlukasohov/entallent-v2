import type {
  PulseBaseline,
  PulseCompletedFinal,
  PulseInputContext,
  PulseMetricCandidate,
} from '@entalent/contracts';
import { comparePulseMetric } from './calculate-pulse-report-metrics';
// PostgreSQL's canonical ISO timestamp strings retain microseconds and sort chronologically.
export function selectPulseReportBaseline(
  current: PulseInputContext,
  metric: PulseMetricCandidate,
  history: readonly PulseCompletedFinal[],
): PulseBaseline {
  const prior = history
    .filter(
      (h) =>
        h.historyKey === current.historyKey &&
        h.cycleId !== current.cycleId &&
        h.periodEnd <= current.periodStart,
    )
    .sort(
      (a, b) =>
        b.periodEnd.localeCompare(a.periodEnd) || b.periodStart.localeCompare(a.periodStart),
    )[0];
  const previous = prior?.metrics.find(
    (m) => m.metricKey === metric.metricKey && m.kind === metric.kind,
  );
  if (
    !prior ||
    !prior.authorized ||
    prior.boundaryFingerprint !== current.boundaryFingerprint ||
    prior.compatibilitySignature !== current.compatibilitySignature ||
    !previous ||
    previous.status !== 'eligible' ||
    previous.completeCount < 5 ||
    previous.rawMean === null ||
    metric.status !== 'eligible' ||
    metric.rawMean === null
  )
    return { status: 'baseline_established' };
  const compared = comparePulseMetric({
    current: { kind: metric.kind, rawMean: metric.rawMean },
    previousFinal: { kind: metric.kind, rawMean: previous.rawMean },
  } as Parameters<typeof comparePulseMetric>[0]);
  if (compared.status !== 'compared' || compared.direction === 'baseline_established')
    return { status: 'baseline_established' };
  return {
    status: 'comparable',
    priorCycleId: prior.cycleId,
    previousRawMean: previous.rawMean,
    rawDelta: metric.rawMean - previous.rawMean,
    direction: compared.direction,
    compositionChanged: current.compositionFingerprint !== prior.compositionFingerprint,
  };
}

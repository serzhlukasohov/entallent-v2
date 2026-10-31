import type {
  PulseAllowedDataset,
  PulseInputRequest,
  PulseMetricCandidate,
  PulsePreparationResult,
  PulseSettlementResult,
  PulsePreparedSet,
} from '@entalent/contracts';
export interface PulseReportInputRepositoryPort {
  preparePresentationSet?(
    inputs: readonly PulseInputRequest[],
    compute: (dataset: PulseAllowedDataset) => {
      metrics: PulseMetricCandidate[];
      finalGate: 'eligible' | 'insufficient_data' | null;
    },
  ): Promise<PulsePreparedSet>;
  /** Runs selection and candidate persistence under one closed-set transaction. */
  prepare(
    input: PulseInputRequest,
    compute: (dataset: PulseAllowedDataset) => {
      metrics: PulseMetricCandidate[];
      finalGate: 'eligible' | 'insufficient_data' | null;
    },
  ): Promise<PulsePreparationResult>;
}
export type PulseInputObservation = PulseSettlementResult;

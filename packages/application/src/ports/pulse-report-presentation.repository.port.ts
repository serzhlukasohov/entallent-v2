import type {
  BuildPulseReportRequest,
  PulseAssemblyContext,
  PulsePreparedSection,
} from '@entalent/contracts';
export interface PulseReportPresentationRepositoryPort {
  read(input: BuildPulseReportRequest): Promise<PulseAssemblyContext | null>;
  /** Cooperating cycle→sorted union-of-current-and-prior-subject locks; never refreshes frontier. */
  validate(
    context: PulseAssemblyContext,
    sections: readonly PulsePreparedSection[],
  ): Promise<boolean>;
}

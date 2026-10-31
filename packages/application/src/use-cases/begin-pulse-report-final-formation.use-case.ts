import type { PulseReportFinalScheduleRepositoryPort } from '../ports/pulse-report-final-schedule.repository.port';
/** Manually invoked boundary. The repository owns serialization and the first DB clock. */
export class BeginPulseReportFinalFormationUseCase {
  constructor(private readonly repository: PulseReportFinalScheduleRepositoryPort) {}
  execute(input: {
    tenantId: string;
    cycleScoringPolicyId: string;
    expectedConfigRevision: number;
  }) {
    return this.repository.begin(
      input.tenantId,
      input.cycleScoringPolicyId,
      input.expectedConfigRevision,
    );
  }
}

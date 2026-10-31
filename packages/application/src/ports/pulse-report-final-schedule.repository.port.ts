import type {
  BeginPulseReportFinalFormationResult,
  PulseReportFinalTiming,
} from '@entalent/contracts';
export interface PulseReportFinalScheduleRepositoryPort {
  refresh(tenantId: string, cycleScoringPolicyId: string): Promise<PulseReportFinalTiming | null>;
  read(tenantId: string, cycleScoringPolicyId: string): Promise<PulseReportFinalTiming | null>;
  begin(
    tenantId: string,
    cycleScoringPolicyId: string,
    expectedConfigRevision: number,
  ): Promise<BeginPulseReportFinalFormationResult>;
}

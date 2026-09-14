import type { OutboxPort } from '../ports/outbox.port';
import type {
  FindReportingCohortsReadyForFinalReportsParams,
  SurveyRepositoryPort,
} from '../ports/survey.repository.port';

const FINAL_REPORT_QUESTION_GROUPS = [
  'autonomy',
  'growth',
  'purpose',
  'belonging',
  'engagement',
] as const;

export interface CloseSurveyReportingCycleResult {
  cohortCount: number;
  queuedReportCount: number;
  expiredTemporaryCount: number;
}

export class CloseSurveyReportingCycleUseCase {
  constructor(
    private readonly surveyRepo: SurveyRepositoryPort,
    private readonly outbox: Pick<OutboxPort, 'enqueueGroupReport'>,
  ) {}

  async execute(
    input: FindReportingCohortsReadyForFinalReportsParams,
  ): Promise<CloseSurveyReportingCycleResult> {
    if (!input.tenantId.trim() || !Number.isFinite(input.now.getTime())) {
      throw new Error('survey_reporting_cycle_close_invalid_input');
    }

    const cohorts = await this.surveyRepo.findReportingCohortsReadyForFinalReports(input);
    const expiredTemporaryCount = await this.surveyRepo.expireTemporaryGroupStatesForClosedCohorts(input);
    for (const cohort of cohorts) {
      await this.outbox.enqueueGroupReport({
        reportingCohortId: cohort.id,
        tenantId: cohort.tenantId,
        teamId: cohort.teamId,
        questionGroup: 'cycle',
        questionGroups: [...FINAL_REPORT_QUESTION_GROUPS],
        reportKind: 'final',
        traceId: `final-report:${cohort.id}:cycle:${input.now.toISOString()}`,
      });
    }

    return {
      cohortCount: cohorts.length,
      queuedReportCount: cohorts.length,
      expiredTemporaryCount,
    };
  }
}
